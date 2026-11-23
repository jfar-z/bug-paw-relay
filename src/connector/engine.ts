import { displayBoardHistory } from "../shared/session-events.js";
import { type BoardTool } from "../shared/session-boards.js";
import { commandChange, commandScope, slashInput } from "../shared/slash-commands.js";
import { SlashCatalog } from "./slash-commands.js";
import { blockerIdentity } from "../shared/connector-update.js";
import { ClaudeTerminals } from "./claude-terminal.js";
import { terminalAction } from "../shared/claude-terminal.js";
import { publishInput, parseLightInput } from "../shared/light-apps.js";
import {
  questionForm,
  isCodexAsyncQuestion,
  validateQuestionAnswer,
  nativeQuestionAnswer,
  type QuestionRecord,
} from "../shared/user-questions.js";
import { translate } from "../shared/i18n.js";
import { message as i18nMessage } from "../shared/i18n.js";
import { classifyApproval } from "../shared/permission-policy.js";
import { connectorStorageError } from "../shared/connector-storage-errors.js";
import { activeUpdate } from "./update-installation.js";
import { resolveRuntimeOptions } from "../shared/runtime-options.js";
import { runtimeCatalog } from "./runtime-catalog.js";
import { z } from "zod";
import { EnvironmentMentions } from "./mentions.js";
import {
  mentionsSchema,
  validMentions,
  nativeMentionText,
} from "../shared/mentions.js";
import {
  sessionDisplay,
  sessionProjection,
} from "../shared/session-display.js";
import { FilePushReceiver } from "./file-push.js";
import { attachmentSink, validateAttachments } from "./attachments.js";
import { attachmentsSchema, attachmentMessage } from "../shared/uploads.js";
import { EnvironmentFiles } from "./files.js";
import { realpath, mkdir, stat, readdir } from "node:fs/promises";
import { relative, resolve, isAbsolute, sep, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import { digest } from "../server/security.js";
import { ensure, AppError } from "../shared/contracts.js";
import { loadClaudeSdk } from "./claude-sdk.js";
import {
  renameClaudeSession,
  CodexRuntime,
  ClaudeRuntime,
  type RuntimeHandle,
  type RuntimeAnswer,
} from "./runtime.js";
const busyExecutionsFrom = `FROM entities WHERE kind='localExecutions'
  AND json_extract(body, '$.status') IN ('starting','running','waiting','stopping','unknown')`;

/** 使用真实路径检查工作根目录，阻止 ..、符号链接及 junction 穿越。 */
export async function resolveDirectory(
  roots: any[],
  rootId: string,
  path: string,
) {
  const root = roots.find((r) => r.id === rootId);
  ensure(
    root,
    "ROOT_UNKNOWN",
    i18nMessage("errors.ROOT_UNKNOWN.workspace.root.not.found"),
  );
  ensure(
    !isAbsolute(path),
    "PATH_INVALID",
    i18nMessage("errors.PATH_INVALID.enter.a.relative.path"),
  );
  const base = await realpath(root.path);
  const target = await realpath(resolve(base, path));
  ensure(
    (await stat(target)).isDirectory(),
    "NOT_DIRECTORY",
    i18nMessage("errors.NOT_DIRECTORY.the.target.is.not.a.directory"),
  );
  checkDirectoryBoundary(base, target);
  return target;
}

function checkDirectoryBoundary(base: string, target: string) {
  const rel = relative(base, target);
  ensure(
    rel !== ".." &&
      !rel.startsWith(".." + sep) &&
      !isAbsolute(rel),
    "PATH_ESCAPE",
    i18nMessage("errors.PATH_ESCAPE.the.target.is.outside.the.allowed"),
  );
}

/** 每次只在已核验的真实父目录下创建一级，重试及并发创建均复用已有目录。 */
async function ensureProjectDirectory(roots: any[], rootId: string, path: string) {
  ensure(typeof path === "string" && !win32.isAbsolute(path) && !/^[A-Za-z]:/.test(path)
    && !path.includes("\0"), "PATH_INVALID", i18nMessage("errors.PATH_INVALID.enter.a.relative.path"));
  const base = await resolveDirectory(roots, rootId, ".");
  const target = resolve(base, path);
  checkDirectoryBoundary(base, target);
  let parent = base;
  for (const name of relative(base, target).split(sep).filter(Boolean)) {
    // Win32 会折叠尾随点和空格，设备名及数据流也不能作为普通目录处理。
    if (process.platform === "win32")
      ensure(!/[<>:"|?*\x00-\x1f]|[. ]$/.test(name) &&
        !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name),
        "PATH_INVALID", i18nMessage("errors.PATH_INVALID.invalid.directory.name"));
    const child = resolve(parent, name);
    try {
      parent = await realpath(child);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await mkdir(child);
      } catch (creationError) {
        if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError;
      }
      // 并发创建或悬空链接均须再次确认真实目标。
      parent = await realpath(child).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new AppError("NOT_DIRECTORY", i18nMessage("errors.NOT_DIRECTORY.the.target.is.not.a.directory"));
        throw error;
      });
    }
    checkDirectoryBoundary(base, parent);
    ensure((await stat(parent)).isDirectory(), "NOT_DIRECTORY",
      i18nMessage("errors.NOT_DIRECTORY.the.target.is.not.a.directory"));
  }
}
/** 等待提交的队列；超大单事件不排队，沿用 10 MiB 消息上限直接提交。 */
interface EventBatch {
  sessionId: string;
  events: {
    type: string;
    data: any;
    displayNotices?: import("../shared/session-display.js").DisplayNotice[];
  }[];
  bytes: number;
  since: number;
  timer?: NodeJS.Timeout;
}
/** 环境本地执行账本，防重先于启动原生运行时，断网不关闭任务。 */
export class Engine {
  private commands: SlashCatalog;
  private mentions = new EnvironmentMentions(() => this.config());
  private terminals = new ClaudeTerminals();
  private uploads = new FilePushReceiver();
  private uploadEpoch = 0;
  disconnectUploads() {
    this.uploadEpoch++;
    return this.uploads.disconnect();
  }
  private files = new EnvironmentFiles(() => this.config().roots);
  private starts = new Map<string, { hash: string; promise: Promise<any>; sessionId: string; executionId: string }>();
  private sessionStarts = new Set<string>();
  private handles = new Map<string, RuntimeHandle>();
  private answers = new Map<string, RuntimeAnswer>();
  constructor(
    public store: Store,
    private config: () => any,
    private notify: (m: string, p: any) => void,
    private handoff: (p: any) => Promise<any>,
    private diagnostic: (event: string, fields: any) => void = () => {},
  ) {
    this.commands = new SlashCatalog(store);
    for (const e of store.list("localExecutions")) {
      const interrupted = [
        "running",
        "waiting",
        "starting",
        "stopping",
      ].includes(e.status);
      const unresolved = (e.questionRecords || []).some((q: QuestionRecord) =>
        ["waiting", "submitting", "unknown"].includes(q.status),
      );
      if (!interrupted && !unresolved) continue;
      store.put(
        "localExecutions",
        {
          ...(interrupted
            ? {
                status: "failed",
                stateVersion: (e.stateVersion || 0) + 1,
                error: "连接器重启，原生执行状态不再可确认；不会自动重放。",
                errorDetails: i18nMessage("connector.execution.interrupted"),
                interactions: [],
              }
            : {}),
          // 终态落盘与回答回执之间也可能崩溃，不能遗留永久“提交中”。
          questionRecords: (e.questionRecords || []).map((q: QuestionRecord) =>
            ["answered", "invalidated"].includes(q.status)
              ? q
              : {
                  ...q,
                  status: "invalidated",
                  reason: "connector.execution.interrupted",
                },
          ),
        },
        e.id,
      );
    }
  }

  private pendingEvents = new Map<string, EventBatch>();
  private closing = false;
  private storageFailure = false;
  private metrics = {
    received: 0,
    committed: 0,
    failures: 0,
    batches: 0,
    batchEvents: 0,
    batchBytes: 0,
    writeMs: 0,
    maxWriteMs: 0,
    maxQueueEvents: 0,
    maxQueueBytes: 0,
  };
  /** 仅输出计数与耗时，绝不把事件正文传入诊断。 */
  storageSnapshot() {
    const batches = [...this.pendingEvents.values()];
    return {
      ...this.metrics,
      pendingEvents: batches.reduce((n, b) => n + b.events.length, 0),
      pendingBytes: batches.reduce((n, b) => n + b.bytes, 0),
      oldestMs: batches.length
        ? Math.max(...batches.map((b) => performance.now() - b.since))
        : 0,
    };
  }
  /** 首条事件启动固定窗口；上限先到即提交，不延长窗口或静默丢弃。 */
  private enqueueEvent(id: string, sessionId: string, type: string, data: any) {
    if (this.storageFailure || this.closing) return;
    this.metrics.received++;
    const projection = sessionProjection(data);
    const safe = projection.value;
    const bytes =
      Buffer.byteLength(
        JSON.stringify({ data: safe, displayNotices: projection.notices }),
      ) +
      Buffer.byteLength(type) +
      128;
    if (bytes > 10 * 1024 * 1024) {
      this.failStorage(id, "QUEUE_LIMIT");
      return;
    }
    if (bytes > 4 * 1024 * 1024) {
      this.flushEvents(id);
      this.commitEvents(id, {
        sessionId,
        events: [{ type, data: safe, displayNotices: projection.notices }],
        bytes,
        since: performance.now(),
      });
      return;
    }
    let batch = this.pendingEvents.get(id);
    if (
      batch &&
      (batch.bytes + bytes > 4 * 1024 * 1024 || batch.events.length >= 1000)
    ) {
      this.flushEvents(id);
      batch = undefined;
    }
    if (!batch) {
      batch = {
        sessionId,
        events: [],
        bytes: 0,
        since: performance.now(),
        timer: setTimeout(() => {
          try {
            this.flushEvents(id);
          } catch {
            /* 失败已锁定引擎并停止运行时。 */
          }
        }, 50),
      };
      this.pendingEvents.set(id, batch);
    }
    batch.events.push({ type, data: safe, displayNotices: projection.notices });
    batch.bytes += bytes;
    this.metrics.maxQueueEvents = Math.max(
      this.metrics.maxQueueEvents,
      batch.events.length,
    );
    this.metrics.maxQueueBytes = Math.max(
      this.metrics.maxQueueBytes,
      batch.bytes,
    );
    if (batch.events.length >= 1000 || batch.bytes >= 4 * 1024 * 1024)
      this.flushEvents(id);
  }
  /** 非事件写入发生 SQLite 故障时，同样锁定防重与原生执行。 */
  storageFault() {
    this.failStorage("", "SQLITE_WRITE_FAILED");
  }
  private failStorage(id: string, reason: string) {
    if (this.storageFailure) return;
    this.storageFailure = true;
    this.metrics.failures++;
    this.diagnostic("storage.failure", {
      executionId: id,
      reason,
      pendingEvents: [...this.pendingEvents.values()].reduce(
        (n, b) => n + b.events.length,
        0,
      ),
    });
    for (const b of this.pendingEvents.values()) clearTimeout(b.timer);
    // 先锁定失败状态，再终止所有原生运行时，避免关闭回调发布伪成功。
    for (const h of this.handles.values()) {
      try {
        h.close();
      } catch {}
    }
    this.handles.clear();
  }
  /** 事务提交事件、回复和标题后才按原顺序发布；失败不发布任何批次内容。 */
  flushEvents(id?: string) {
    if (this.storageFailure) throw connectorStorageError("STORAGE_UNAVAILABLE");
    for (const key of id ? [id] : [...this.pendingEvents.keys()]) {
      const batch = this.pendingEvents.get(key);
      if (!batch) continue;
      clearTimeout(batch.timer);
      this.commitEvents(key, batch);
    }
  }
  private commitEvents(key: string, batch: EventBatch) {
    const started = performance.now();
    const notifications: any[] = [];
    let resolved = false;
    const removeAnswers: string[] = [];
    try {
      this.store.transaction(() => {
        const e = this.store.get("localExecutions", key);
        const events: any[] = [...(e.events || [])];
        let title: string | undefined;
        for (const { type, data, displayNotices } of batch.events) {
          const event = {
            type,
            data,
            displayNotices,
            sequence: ++e.sequence,
            executionId: key,
          };
          events.push(event);
          // 与原生事件同事务记录首个定位标识，缓存淘汰后仍可投影看板输入。
          if (e.boardInput && !e.boardInput.anchor) {
            const anchor = type === "turn/started" && data.turn?.id ? "turn:" + data.turn.id
              : data.item?.type === "userMessage" && data.item.id ? "item:" + data.item.id
              : type === "assistant" && data.uuid ? "claude:" + data.uuid : undefined;
            if (anchor) e.boardInput = { ...e.boardInput, anchor };
          }
          if (type === "serverRequest/resolved") {
            const nativeId = String(data.requestId);
            removeAnswers.push(
              ...e.interactions
                .filter((i: any) => i.nativeId === nativeId)
                .map((i: any) => i.id),
            );
            e.questionRecords = (e.questionRecords || []).map(
              (q: QuestionRecord) =>
                q.nativeId === nativeId && q.status === "waiting"
                  ? { ...q, status: "invalidated", reason: "questions.stale" }
                  : q,
            );
            e.interactions = e.interactions.filter(
              (i: any) => i.nativeId !== nativeId,
            );
            resolved = true;
          }
          if (
            type === "item/completed" &&
            data.item?.type === "agentMessage" &&
            !isCodexAsyncQuestion(data.item)
          )
            e.reply = data.item.text;
          if (type === "result" && data.result) e.reply = data.result;
          if (type === "runtime/config") e.runtimeConfig = data;
          const candidate =
            type === "thread/name/updated"
              ? data.threadName
              : type === "thread/started"
                ? data.thread?.name || this.store.get("localSessions", batch.sessionId).customTitle || data.thread?.preview
                : undefined;
          if (typeof candidate === "string" && candidate.trim())
            title = candidate;
          notifications.push({
            executionId: key,
            event,
            title: candidate,
            interactions: e.interactions,
            ...(type === "serverRequest/resolved"
              ? { questionRecords: e.questionRecords || [] }
              : {}),
          });
        }
        this.store.put(
          "localExecutions",
          {
            ...(e.boardInput ? { boardInput: e.boardInput } : {}),
            events: events.slice(-1000),
            sequence: e.sequence,
            gap: e.gap || e.sequence > 1000,
            reply: e.reply || "",
            runtimeConfig: e.runtimeConfig,
            interactions: e.interactions,
            questionRecords: e.questionRecords || [],
          },
          key,
        );
        if (title) this.store.put("localSessions", { title }, batch.sessionId);
      });
    } catch {
      this.failStorage(key, "SQLITE_WRITE_FAILED");
      throw connectorStorageError("STORAGE_UNAVAILABLE");
    }
    this.pendingEvents.delete(key);
    for (const answer of removeAnswers) this.answers.delete(answer);
    this.metrics.committed += batch.events.length;
    this.metrics.batches++;
    this.metrics.batchEvents = batch.events.length;
    this.metrics.batchBytes = batch.bytes;
    this.metrics.writeMs = performance.now() - started;
    this.metrics.maxWriteMs = Math.max(
      this.metrics.maxWriteMs,
      this.metrics.writeMs,
    );
    this.diagnostic("storage.batch", {
      executionId: key,
      events: batch.events.length,
      bytes: batch.bytes,
      writeMs: performance.now() - started,
      oldestMs: performance.now() - batch.since,
      pendingEvents: 0,
      pendingBytes: 0,
    });
    for (const notification of notifications)
      this.notify("execution.event", notification);
    if (resolved) {
      const e = this.store.get("localExecutions", key);
      if (e.status === "waiting" && !e.interactions.length)
        this.state(key, "running");
    }
  }
  /** 本机可用性只取决于存储和引擎初始化；未知历史执行仍由调度门闩独立保护。 */
  locallyHealthy() {
    return !this.closing && !this.storageFailure;
  }
  private inFlight = 0;
  /** 同步进入门闩，覆盖启动预检中的 await、文件传输和目录写入。 */
  busyForUpdate() {
    if (this.closing || this.storageFailure) return true;
    return (
      this.terminals.busy ||
      this.inFlight > 0 ||
      this.uploads.busy ||
      this.starts.size > 0 ||
      // 健康与更新预检只查执行状态，禁止为每次探测装载全部历史事件正文。
      !!this.store.db
        .prepare(
          `SELECT 1 ${busyExecutionsFrom} LIMIT 1`,
        )
        .get()
    );
  }
  async call(method: string, p: any): Promise<any> {
    if (this.closing) throw connectorStorageError("ENGINE_UNAVAILABLE");
    // 明细查询自身不能占用更新门闩；只投影身份和状态，不向服务端传输交互正文。
    if (method === "connector.update.blockers") {
      const rows = this.store.db.prepare(
        `SELECT id, json_extract(body, '$.sessionId') AS sessionId,
          json_extract(body, '$.status') AS status,
          CASE WHEN json_extract(body,'$.status')='waiting' THEN CASE
            WHEN EXISTS (SELECT 1 FROM json_each(body,'$.interactions') WHERE json_type(value,'$.question')='object') THEN 'answer'
            WHEN EXISTS (SELECT 1 FROM json_each(body,'$.interactions') WHERE json_type(value,'$.approval')='object') THEN 'approval'
            ELSE 'interaction' END END AS waitingFor ${busyExecutionsFrom}`,
      ).all();
      const reasons: string[] = [];
      if (this.terminals.busy) reasons.push("terminal");
      if (this.uploads.busy) reasons.push("transfer");
      if (this.inFlight || this.starts.size) reasons.push("activity");
      if (this.storageFailure) reasons.push("storage");
      const executions = rows.map(({ id, sessionId, status, waitingFor }) => ({
        executionId: id, sessionId, status, waitingFor,
        canStop: !this.storageFailure && this.handles.has(String(id)) && status !== "stopping",
      }));
      // 启动预检可能仍在等待目录或运行时，尚未写入执行账本。
      for (const { sessionId, executionId } of this.starts.values()) {
        if (!executions.some(row => row.executionId === executionId))
          executions.push({ executionId, sessionId, status: "starting", waitingFor: null, canStop: false });
      }
      return { executions, reasons };
    }
    this.flushEvents();
    if (["execution.status", "execution.result"].includes(method))
      return this.callInternal(method, p);
    ensure(
      !activeUpdate(),
      "UPDATE_IN_PROGRESS",
      i18nMessage(
        "errors.UPDATE_IN_PROGRESS.the.connector.is.undergoing.update.maintenance",
      ),
      409,
    );
    this.inFlight++;
    try {
      return await this.callInternal(method, p);
    } finally {
      this.inFlight--;
    }
  }
  private async callInternal(method: string, p: any): Promise<any> {
    if (method === "claude.terminal") {
      const request = z.object({
        sessionId: z.uuid(), rootId: z.string(), relativePath: z.string(), input: terminalAction,
      }).strict().parse(p);
      if (request.input.action === "close") return this.terminals.stop(request.sessionId);
      const config = this.config();
      const cwd = await resolveDirectory(config.roots, request.rootId, request.relativePath);
      return this.terminals.call(this.store, request.sessionId, cwd, config.claude.command, request.input);
    }
    if (method === "runtime.catalog") {
      const input = z
        .object({
          runtime: z.enum(["codex", "claude"]),
          rootId: z.string().optional(),
          relativePath: z.string().default("."),
        })
        .strict()
        .parse(p);
      const config = this.config();
      const cwd = await resolveDirectory(
        config.roots,
        input.rootId || config.roots[0]?.id,
        input.relativePath,
      );
      return runtimeCatalog(cwd, input.runtime, config[input.runtime] || {});
    }
    if (["commands.list", "commands.save", "commands.resolve", "commands.rename"].includes(method)) {
      const scope = commandScope.parse(p);
      const config = this.config();
      const cwd = await resolveDirectory(config.roots, scope.rootId, scope.relativePath);
      if (method === "commands.list") return this.commands.list(scope, cwd, config[scope.runtime], p.cached === true);
      if (method === "commands.save") return this.commands.save(scope, cwd, config[scope.runtime], commandChange.parse(p.change));
      if (method === "commands.resolve") return this.commands.resolve(scope, cwd, config[scope.runtime], p.name);

      const title = z.string().trim().min(1).max(200).parse(p.title);
      if (p.name !== "rename") {
        const row = await this.commands.resolve(scope, cwd, config[scope.runtime], p.name);
        ensure(row.execution === "rename", "COMMAND_STALE", i18nMessage("slash.stale"), 409);
      }
      const session = this.store.findBy("localSessions", "id", p.sessionId)[0];
      ensure(session?.nativeId && session.cwd === cwd && session.runtime === scope.runtime &&
        session.projectId === scope.projectId, "COMMAND_NO_THREAD", i18nMessage("slash.noThread"), 409);
      const receiptId = digest(JSON.stringify(["slashRename", session.id, z.uuid().parse(p.operationId)]));
      const receipt = this.store.findBy("slashRenames", "id", receiptId)[0];
      if (receipt) {
        ensure(receipt.title === title, "IDEMPOTENCY_CONFLICT", i18nMessage("errors.IDEMPOTENCY_CONFLICT.operation.parameters.conflict"), 409);
        return { title: session.title };
      }
      // 改名与启动复用同一会话占位，避免并发写入两个标题或覆盖刚启动的线程。
      ensure(!this.sessionStarts.has(session.id) && !this.store.findBy("localExecutions", "sessionId", session.id)
        .some(e => ["starting", "running", "waiting", "stopping"].includes(e.status)), "BUSY",
        i18nMessage("errors.BUSY.this.session.is.running"), 409);
      this.sessionStarts.add(session.id);
      try {
        if (session.runtime === "claude") {
          await renameClaudeSession(session.nativeId, cwd, title);
        } else {
          const reader = new CodexRuntime({ event() {}, native() {}, interaction() {}, done() {}, handoff: async () => {} }, config.codex);
          try {
            await reader.renameStored(session.nativeId, title);
          } finally {
            reader.close();
          }
        }
        this.store.transaction(() => {
          this.store.put("localSessions", { title, customTitle: title }, session.id);
          this.store.put("slashRenames", { title }, receiptId);
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("COMMAND_RENAME", i18nMessage("slash.renameFailed"), 409);
      } finally {
        this.sessionStarts.delete(session.id);
      }
      return { title };
    }
    if (method === "mentions.search") {
      const input = z
        .object({
          rootId: z.string(),
          relativePath: z.string(),
          runtime: z.enum(["codex", "claude"]),
          query: z.string().max(512),
        })
        .parse(p);
      const cwd = await resolveDirectory(
        this.config().roots,
        input.rootId,
        input.relativePath,
      );
      return this.mentions.search(cwd, input.runtime, input.query);
    }
    if (method === "board.attachments.verify") {
      const data = z
        .object({
          rootId: z.string(),
          relativePath: z.string(),
          cwd: z.string(),
          files: attachmentsSchema.min(1),
        })
        .strict()
        .parse(p);
      ensure(
        (await resolveDirectory(
          this.config().roots,
          data.rootId,
          data.relativePath,
        )) === data.cwd,
        "UPLOAD_PATH",
        i18nMessage("uploads.path"),
        403,
      );
      await validateAttachments(this.files, data, data.files);
      return { ok: true };
    }
    if (method.startsWith("files.push.")) {
      try {
        if (method === "files.push.begin") {
          const epoch = this.uploadEpoch;
          const input = z
            .object({
              destination: z.union([
                z
                  .object({
                    kind: z.literal("session-attachments"),
                    sessionId: z.string().min(1),
                    rootId: z.string().min(1),
                    relativePath: z.string(),
                  })
                  .strict(),
                z
                  .object({
                    kind: z.literal("board-attachments"),
                    rootId: z.string().min(1),
                    relativePath: z.string(),
                  })
                  .strict(),
              ]),
              files: z.unknown(),
            })
            .strict()
            .parse(p);
          const d = input.destination;
          const cwd = await resolveDirectory(
            this.config().roots,
            d.rootId,
            d.relativePath,
          );
          const check = async () => {
            ensure(
              (await resolveDirectory(
                this.config().roots,
                d.rootId,
                d.relativePath,
              )) === cwd &&
                epoch === this.uploadEpoch &&
                (d.kind === "board-attachments" ||
                  (!this.sessionStarts.has(d.sessionId) &&
                    !this.store
                      .findBy("localExecutions", "sessionId", d.sessionId)
                      .some((e) =>
                        [
                          "starting",
                          "running",
                          "waiting",
                          "stopping",
                          "unknown",
                        ].includes(e.status),
                      ) &&
                    !this.store
                      .findBy("preparedExecutions", "sessionId", d.sessionId)
                      .some((e) => e.status === "queued"))),
              "UPLOAD_BLOCKED",
              i18nMessage("uploads.blocked"),
              409,
            );
          };
          const batch = await this.uploads.begin(input.files, check, (entry) =>
            attachmentSink(cwd, entry, check, this.files, d),
          );
          return d.kind === "board-attachments" ? { ...batch, cwd } : batch;
        }
        const { id } = z.object({ id: z.uuid() }).parse(p);
        if (method === "files.push.cancel") {
          await this.uploads.cancel(id);
          return { ok: true };
        }
        const { id: _, ...data } = p;
        ensure(
          method === "files.push.write" || method === "files.push.finish",
          "INVALID_PARAMS",
          i18nMessage("uploads.corrupt"),
        );
        return await this.uploads.call(
          id,
          method === "files.push.write" ? "write" : "finish",
          data,
        );
      } catch (e) {
        if (e instanceof AppError || e instanceof z.ZodError) throw e;
        throw new AppError("UPLOAD_WRITE", i18nMessage("uploads.write"));
      }
    }
    if (method === "files.inspect" || method === "files.read")
      return this.files.call(method, p);
    if (method === "directory.list") {
      const path = await resolveDirectory(
        this.config().roots,
        p.rootId,
        p.relativePath || ".",
      );
      const entries = await readdir(path, { withFileTypes: true });
      // 不跟随目录链接；执行入口仍通过 realpath 校验，目录浏览不能绕过根目录边界。
      return {
        path,
        directories: entries
          .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b)),
      };
    }
    if (method === "directory.ensure") {
      try {
        await ensureProjectDirectory(this.config().roots, p.rootId, p.relativePath);
      } catch (error) {
        if (error instanceof AppError) throw error;
        const code = (error as NodeJS.ErrnoException).code ?? "";
        const reasons: Record<string, string> = {
          EACCES: "DIRECTORY_PERMISSION", EPERM: "DIRECTORY_PERMISSION", EROFS: "DIRECTORY_PERMISSION",
          ENOSPC: "DIRECTORY_STORAGE", EDQUOT: "DIRECTORY_STORAGE",
          EINVAL: "PATH_INVALID", ENAMETOOLONG: "PATH_INVALID", ELOOP: "NOT_DIRECTORY",
          ENOTDIR: "NOT_DIRECTORY", ENOENT: "ROOT_UNKNOWN",
        };
        throw new AppError(reasons[code] ?? "DIRECTORY_IO", i18nMessage("common.failure"));
      }
      return { ok: true };
    }
    if (method === "directory.validate")
      return {
        path: await resolveDirectory(
          this.config().roots,
          p.rootId,
          p.relativePath,
        ),
      };
    if (method === "directory.create") {
      const parent = await resolveDirectory(
        this.config().roots,
        p.rootId,
        p.parent || ".",
      );
      ensure(
        typeof p.name === "string" &&
          /^[^\\/]+$/.test(p.name) &&
          ![".", ".."].includes(p.name),
        "PATH_INVALID",
        i18nMessage("errors.PATH_INVALID.invalid.directory.name"),
      );
      await mkdir(resolve(parent, p.name));
      return { ok: true };
    }
    if (method === "execution.prepare") {
      this.ensureStartPermission(p);
      ensure(
        p.workflow?.itemId && typeof p.message === "string",
        "INVALID_PARAMS",
        i18nMessage("errors.INVALID_PARAMS.invalid.resume.parameters"),
      );
      const known = this.knownOperation(p);
      if (known) return this.executionState(known);
      // 路径校验含异步 IO；完成后再同步检查并占位，避免并发 prepare 越过忙碌检查。
      await resolveDirectory(
        this.config().roots,
        p.session.rootId,
        p.session.relativePath,
      );
      await validateAttachments(
        this.files,
        p.session,
        attachmentsSchema.parse(p.attachments || []),
      );
      const previous = this.knownOperation(p);
      if (previous) return this.executionState(previous);
      const hash = digest(JSON.stringify(p));
      ensure(
        !this.store
          .list("preparedExecutions")
          .some((e) => e.sessionId === p.session.id && e.status === "queued"),
        "BUSY",
        i18nMessage("errors.BUSY.this.session.already.has.a.queued"),
        409,
      );
      ensure(
        !this.store
          .findBy("localExecutions", "sessionId", p.session.id)
          .some(
            (e) =>
              e.sessionId === p.session.id &&
              ["starting", "running", "waiting", "stopping"].includes(e.status),
          ),
        "BUSY",
        i18nMessage("errors.BUSY.this.session.is.running"),
        409,
      );
      ensure(
        !this.sessionStarts.has(p.session.id),
        "BUSY",
        i18nMessage("errors.BUSY.this.session.is.starting"),
      );
      ensure(
        validMentions(p.message, mentionsSchema.parse(p.mentions || [])),
        "MENTION_INVALID",
        i18nMessage(
          "errors.MENTION_INVALID.references.do.not.match.the.message",
        ),
      );
      // 仅环境端保存待派发正文，服务端只保存执行引用。
      this.store.put(
        "preparedExecutions",
        {
          operationId: p.operationId,
          sessionId: p.session.id,
          hash,
          payload: p,
          status: "queued",
        },
        p.executionId,
      );
      return { status: "queued", stateVersion: 0 };
    }
    if (method === "execution.startPrepared") {
      const execution = this.store.findBy(
        "localExecutions",
        "id",
        p.executionId,
      )[0];
      if (execution) {
        await this.starts.get(execution.operationId)?.promise.catch(() => {});
        return this.call("execution.status", p);
      }
      const prepared = this.store.get("preparedExecutions", p.executionId);
      // 已取消或失败的占位是持久化终态，重派只返回事实，不能复活任务。
      if (prepared.status !== "queued")
        return { status: prepared.status, stateVersion: 0 };
      return this.call("execution.start", prepared.payload);
    }
    if (method === "execution.start") {
      this.ensureStartPermission(p);
      const hash = digest(JSON.stringify(p));
      const previous = this.starts.get(p.operationId);
      if (previous) {
        ensure(
          previous.hash === hash,
          "IDEMPOTENCY_CONFLICT",
          i18nMessage(
            "errors.IDEMPOTENCY_CONFLICT.operation.parameters.conflict",
          ),
        );
        return previous.promise;
      }
      // 已落账的重发是查询，另一新尝试的启动锁不能改变原操作结果。
      const known = this.knownOperation(p);
      if (known && known.status !== "queued") return this.executionState(known);
      ensure(
        !this.sessionStarts.has(p.session.id),
        "BUSY",
        i18nMessage("errors.BUSY.this.session.is.starting"),
      );
      this.sessionStarts.add(p.session.id);
      const promise = this.start(p).finally(() => {
        this.starts.delete(p.operationId);
        this.sessionStarts.delete(p.session.id);
      });
      this.starts.set(p.operationId, { hash, promise, sessionId: p.session.id, executionId: p.executionId });
      return promise;
    }
    if (method === "execution.status") {
      try {
        const e = this.store.get("localExecutions", p.executionId);
        return {
          status: e.status === "starting" ? "dispatching" : e.status,
          stateVersion: e.stateVersion || 0,
        };
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "NOT_FOUND")
          throw error;
        const prepared = this.store.findBy(
          "preparedExecutions",
          "id",
          p.executionId,
        )[0];
        return { status: prepared?.status || "not_found", stateVersion: 0 };
      }
    }
    if (method === "execution.result") {
      const e = this.store.get("localExecutions", p.executionId);
      return {
        status: e.status,
        reply: e.reply || "",
        executionId: e.id,
        ...(e.errorDetails
          ? { error: e.error, errorDetails: e.errorDetails }
          : {}),
      };
    }
    if (method === "session.titles") {
      ensure(
        Array.isArray(p.ids) && p.ids.length <= 20,
        "INVALID_PARAMS",
        i18nMessage(
          "errors.INVALID_PARAMS.invalid.title.synchronization.batch",
        ),
      );
      const sessions = (p.ids as string[]).flatMap((id) =>
        this.store.findBy("localSessions", "id", id),
      );
      return Promise.all(
        sessions.map(async (s) => {
          let title = s.title;
          if (s.nativeId) {
            try {
              if (s.runtime === "claude") {
                const info = await (await loadClaudeSdk()).getSessionInfo(s.nativeId, { dir: s.cwd });
                title = info?.customTitle || s.customTitle || info?.summary || title;
              } else {
                const reader = new CodexRuntime(
                  {
                    event: () => {},
                    native: () => {},
                    interaction: () => {},
                    done: () => {},
                    handoff: async () => {},
                  },
                  this.config().codex || {},
                );
                try {
                  const metadata = await reader.readStored(s.nativeId, false);
                  title =
                    metadata?.thread?.name || s.customTitle ||
                    metadata?.thread?.preview ||
                    title;
                } finally {
                  reader.close();
                }
              }
            } catch {
              // 原生元信息暂不可用时保留已有标题，不加载历史正文兜底。
            }
          }
          if (title && title !== s.title)
            this.store.put("localSessions", { title }, s.id);
          return { id: s.id, title };
        }),
      );
    }
    if (method === "board.sessionCwd") return { path: this.store.get("localSessions", p.sessionId).cwd };
    if (method === "board.card.record") {
      const execution = this.store.get("localExecutions", p.executionId);
      const id = z.uuid().parse(p.card.id);
      if (!this.store.findBy("boardCards", "id", id).length)
        this.store.put("boardCards", { ...p.card, sessionId: execution.sessionId, executionId: execution.id }, id);
      return { ok: true };
    }
    if (method === "session.history") {
      const session = this.store.findBy("localSessions", "id", p.sessionId)[0];
      if (!session)
        return { events: [], interactions: [], status: "idle", gap: false };
      let executions = this.store.findBy(
        "localExecutions",
        "sessionId",
        session.id,
      );
      let nativeHistory: any = null;
      let historyError: string | null = null;
      let title = session.title;
      if (session.nativeId) {
        try {
          if (session.runtime === "claude") {
            nativeHistory = await (await loadClaudeSdk()).getSessionMessages(session.nativeId, {
              dir: session.cwd,
            });
            const info = await (await loadClaudeSdk()).getSessionInfo(session.nativeId, {
              dir: session.cwd,
            });
            title = info?.customTitle || session.customTitle || info?.summary || title;
          } else {
            const active = executions
              .map((e) => this.handles.get(e.id))
              .filter(Boolean)
              .at(-1);
            if (active) nativeHistory = await active.history();
            else {
              const reader = new CodexRuntime(
                {
                  event: () => {},
                  native: () => {},
                  interaction: () => {},
                  done: () => {},
                  handoff: async () => {},
                },
                this.config().codex || {},
              );
              try {
                nativeHistory = await reader.readStored(session.nativeId);
              } finally {
                reader.close();
              }
            }
          }
          if (session.runtime === "codex")
            title =
              nativeHistory?.thread?.name || session.customTitle ||
              nativeHistory?.thread?.preview ||
              title;
        } catch {
          historyError = "环境原生历史读取失败，仅显示事件缓冲。";
        }
      }
      if (title && title !== session.title)
        this.store.put("localSessions", { title }, session.id);
      this.flushEvents();
      executions = this.store.findBy(
        "localExecutions",
        "sessionId",
        session.id,
      );
      const recordedHistoryFailure =
        !historyError &&
        executions.some(
          (e) =>
            e.errorDetails?.messageKey ===
            "connector.execution.recoveryLimited",
        );
      if (recordedHistoryFailure)
        historyError = translate(
          "zh-CN",
          "connector.execution.recoveryLimited",
        );
      const bindings = new Map(executions.filter(e => e.boardInput?.anchor)
        .map(e => [e.boardInput.anchor as string, { ...e.boardInput, executionId: e.id }] as const));
      const nativeProjection = sessionProjection(displayBoardHistory(nativeHistory, bindings));
      let cachedEvents: any[] = [];
      let cachedBytes = 0;
      for (const execution of [...executions].reverse()) {
        const window = this.store.executionEvents(execution.id);
        cachedBytes += Buffer.byteLength(JSON.stringify(window));
        cachedEvents = window
          .map((event) => ({
            ...sessionDisplay(event),
            executionId: execution.id,
          }))
          .concat(cachedEvents)
          .slice(-1000);
        if (cachedEvents.length >= 1000 || cachedBytes >= 8 * 1024 * 1024)
          break;
      }
      return {
        title,
        nativeHistory: nativeProjection.value,
        nativeDisplayNotices: nativeProjection.notices,
        historyError,
        ...(historyError
          ? {
              historyErrorDetails: i18nMessage(
                recordedHistoryFailure
                  ? "connector.execution.recoveryLimited"
                  : "connector.history.failed",
              ),
            }
          : {}),
        nativeId: session.nativeId,
        runtimeConfig: executions
          .map((e) => this.store.executionRuntimeConfig(e.id))
          .filter(Boolean)
          .at(-1),
        boardCards: this.store.findBy("boardCards", "sessionId", session.id),
        events: cachedEvents,
        interactions: executions.flatMap((e) => e.interactions || []),
        questionRecords: executions.flatMap((e) => e.questionRecords || []),
        questionProtocol: 1,
        gap:
          executions.some((e) => e.gap) ||
          executions.reduce((n, e) => n + (e.sequence || 0), 0) >
            cachedEvents.length,
        status: executions.at(-1)?.status || "idle",
      };
    }
    if (method === "interaction.status") {
      const e = this.store.get("localExecutions", p.executionId);
      const record = (e.questionRecords || []).find(
        (q: QuestionRecord) => q.id === p.interactionId,
      );
      ensure(record, "STALE_INTERACTION", i18nMessage("questions.stale"), 409);
      return { record };
    }
    if (method === "interaction.answer") {
      const e = this.store.get("localExecutions", p.executionId);
      const record = (e.questionRecords || []).find(
        (q: QuestionRecord) => q.id === p.interactionId,
      );
      if (record) return this.answerQuestion(e, record, p.answer);
      const item = e.interactions.find((i: any) => i.id === p.interactionId);
      ensure(
        item && this.answers.has(p.interactionId),
        "STALE_INTERACTION",
        i18nMessage(
          "errors.STALE_INTERACTION.the.native.interaction.has.expired",
        ),
        409,
      );
      this.validateAnswer(item, p.answer);
      const answer = this.answers.get(p.interactionId)!;
      this.answers.delete(p.interactionId);
      this.store.put(
        "localExecutions",
        {
          interactions: e.interactions.filter(
            (i: any) => i.id !== p.interactionId,
          ),
        },
        e.id,
      );
      answer(p.answer);
      // 策略决定写入会话活动，使历史可区分自动与人工批准。
      if (p.decisionSource === "policy")
        this.enqueueEvent(e.id, e.sessionId, "relay/approval/auto", {
          interactionId: item.id,
          method: item.method,
          source: "policy",
        });
      this.state(
        e.id,
        this.store.get("localExecutions", e.id).interactions.length
          ? "waiting"
          : "running",
      );
      return { ok: true };
    }
    if (method === "connector.update.stopBlocker") {
      const { sessionId, executionId } = blockerIdentity.parse(p);
      const local = this.store.get("localExecutions", executionId);
      ensure(local.sessionId === sessionId, "NOT_FOUND",
        i18nMessage("errors.NOT_FOUND.execution.not.found"), 404);
      if (["completed", "cancelled", "failed"].includes(local.status))
        return { outcome: "alreadyEnded", status: local.status };
      // 始终按不可复用的执行编号寻址；同一会话的新一轮有独立句柄。
      await this.callInternal("execution.cancel", { executionId });
      return { outcome: "requested" };
    }
    if (method === "execution.cancel") {
      const prepared = this.store.findBy(
        "preparedExecutions",
        "id",
        p.executionId,
      )[0];
      // 启动已在途时等待其落账，不能把即将运行的任务误标为仅取消暂存。
      const pending =
        prepared ||
        this.store.findBy("localExecutions", "id", p.executionId)[0];
      if (pending)
        await this.starts.get(pending.operationId)?.promise.catch(() => {});
      if (
        prepared &&
        !this.store.findBy("localExecutions", "id", p.executionId).length
      ) {
        if (prepared.status !== "queued") return { status: prepared.status };
        this.store.put(
          "preparedExecutions",
          { status: "cancelled" },
          prepared.id,
        );
        return { status: "cancelled" };
      }
      const e = this.store.get("localExecutions", p.executionId);
      if (["completed", "cancelled", "failed", "stopping"].includes(e.status))
        return { status: e.status };
      ensure(
        this.handles.has(e.id),
        "STATUS_UNKNOWN",
        i18nMessage("errors.STATUS_UNKNOWN.the.native.process.is.unavailable"),
      );
      this.state(e.id, "stopping");
      await this.handles.get(e.id)!.cancel();
      return { status: "stopping" };
    }
    throw new AppError(
      "METHOD_NOT_FOUND",
      i18nMessage("errors.METHOD_NOT_FOUND.unsupported.method"),
    );
  }
  /** 先持久化占位再交给原回调；未知结果禁止重放，刷新可按原交互 ID 对账。 */
  private async answerQuestion(e: any, record: QuestionRecord, value: unknown) {
    const answer = validateQuestionAnswer(record.form, value);
    if (["answered", "submitting", "unknown"].includes(record.status)) {
      ensure(
        JSON.stringify(record.answer) === JSON.stringify(answer),
        "ANSWER_CONFLICT",
        i18nMessage("questions.conflict"),
        409,
      );
      return { ok: record.status === "answered", record };
    }
    const item = e.interactions.find((i: any) => i.id === record.id);
    ensure(
      record.status === "waiting" &&
        ["running", "waiting"].includes(e.status) &&
        item &&
        this.answers.has(record.id),
      "STALE_INTERACTION",
      i18nMessage("questions.stale"),
      409,
    );
    const callback = this.answers.get(record.id)!;
    const save = (status: QuestionRecord["status"], answerTurnId?: string) => {
      const current = this.store.get("localExecutions", e.id);
      const updated = {
        ...record,
        status,
        answer,
        ...(answerTurnId ? { answerTurnId } : {}),
        ...(status === "unknown" ? { reason: "questions.unknown" } : {}),
      };
      this.store.put(
        "localExecutions",
        {
          questionRecords: current.questionRecords.map((q: QuestionRecord) =>
            q.id === record.id ? updated : q,
          ),
          ...(status === "answered"
            ? {
                interactions: current.interactions.filter(
                  (i: any) => i.id !== record.id,
                ),
              }
            : {}),
        },
        e.id,
      );
      return updated;
    };
    save("submitting");
    this.answers.delete(record.id);
    this.notify("execution.event", {
      executionId: e.id,
      questionRecords: this.store.get("localExecutions", e.id).questionRecords,
    });
    let result: QuestionRecord;
    try {
      const receipt = await callback(
        nativeQuestionAnswer(record.form, item.params, answer),
      );
      result = save("answered", receipt?.answerTurnId);
    } catch {
      result = save("unknown");
    }
    if (
      ["running", "waiting", "starting"].includes(
        this.store.get("localExecutions", e.id).status,
      )
    )
      this.state(e.id, "running");
    // 原生进程可能在回调期间结束；仍转发最终回执，但不把终态改回运行中。
    this.notify("execution.event", {
      executionId: e.id,
      questionRecords: this.store.get("localExecutions", e.id).questionRecords,
    });
    return { ok: result.status === "answered", record: result };
  }
  private validateAnswer(item: any, a: any) {
    ensure(
      a && typeof a === "object",
      "INVALID_ANSWER",
      i18nMessage("errors.INVALID_ANSWER.invalid.answer.format"),
    );
    if (
      item.method.includes("commandExecution/requestApproval") ||
      item.method.includes("fileChange/requestApproval")
    )
      ensure(
        ["accept", "decline", "cancel"].includes(a.decision),
        "INVALID_ANSWER",
        i18nMessage("errors.INVALID_ANSWER.invalid.approval.decision"),
      );
    else if (item.method.includes("requestUserInput"))
      ensure(
        a.answers && typeof a.answers === "object",
        "INVALID_ANSWER",
        i18nMessage("errors.INVALID_ANSWER.an.answer.is.missing"),
      );
    else if (item.method === "item/permissions/requestApproval")
      ensure(
        a.permissions && a.scope !== "session",
        "INVALID_ANSWER",
        i18nMessage(
          "errors.INVALID_ANSWER.only.a.permission.response.for.this",
        ),
      );
    else if (item.method === "mcpServer/elicitation/request")
      ensure(
        ["accept", "decline", "cancel"].includes(a.action),
        "INVALID_ANSWER",
        i18nMessage("errors.INVALID_ANSWER.invalid.interaction.decision"),
      );
    else
      ensure(
        typeof a.approve === "boolean",
        "INVALID_ANSWER",
        i18nMessage(
          "errors.INVALID_ANSWER.explicit.approval.or.rejection.is.required",
        ),
      );
  }
  private state(id: string, status: string) {
    this.flushEvents(id);
    const e = this.store.get("localExecutions", id);
    if (["completed", "failed", "cancelled"].includes(e.status)) return;
    // 尚有其他有效交互时，启动/回复不能把整体状态误报为运行中。
    if (status === "running" && e.interactions?.length) status = "waiting";
    const stateVersion = (e.stateVersion || 0) + 1;
    const terminal = ["completed", "failed", "cancelled"].includes(status);
    if (terminal)
      for (const i of e.interactions || []) this.answers.delete(i.id);
    this.store.put(
      "localExecutions",
      {
        status,
        stateVersion,
        questionRecords: (e.questionRecords || []).map((q: QuestionRecord) =>
          (terminal || status === "stopping") && q.status === "waiting"
            ? { ...q, status: "invalidated", reason: "questions.stale" }
            : q,
        ),
        ...(terminal ? { interactions: [] } : {}),
      },
      id,
    );
    this.notify("execution.event", {
      executionId: id,
      stateVersion,
      status,
      interactions: terminal ? [] : e.interactions,
      questionRecords: this.store.get("localExecutions", id).questionRecords,
    });
  }
  /** 操作身份在暂存与正式账本间连续，冲突请求不能改写历史。 */
  private knownOperation(p: any) {
    const existing = [
      ...this.store.findBy("localExecutions", "operationId", p.operationId),
      ...this.store.findBy("preparedExecutions", "operationId", p.operationId),
      ...this.store.findBy("localExecutions", "id", p.executionId),
      ...this.store.findBy("preparedExecutions", "id", p.executionId),
    ].find((e) => e.operationId === p.operationId || e.id === p.executionId);
    if (existing)
      ensure(
        existing.hash === digest(JSON.stringify(p)),
        "IDEMPOTENCY_CONFLICT",
        i18nMessage(
          "errors.IDEMPOTENCY_CONFLICT.the.operation.content.has.changed",
        ),
      );
    return existing;
  }
  private executionState(e: any) {
    return {
      status: e.status === "starting" ? "dispatching" : e.status,
      stateVersion: e.stateVersion || 0,
    };
  }
  /** 启动前按实际运行身份复核：Claude 以 root 运行时拒绝完全权限。 */
  private ensureStartPermission(p: any) {
    ensure(
      !(
        p.session?.permission === "full" &&
        p.session?.runtime === "claude" &&
        process.geteuid?.() === 0
      ),
      "PERMISSION_UNAVAILABLE",
      i18nMessage("errors.PERMISSION_UNAVAILABLE.claude.root.full"),
      409,
    );
  }
  private async start(p: any) {
    const hash = digest(JSON.stringify(p));
    const existing = this.store.findBy(
      "localExecutions",
      "operationId",
      p.operationId,
    )[0];
    if (existing) {
      ensure(
        existing.hash === hash,
        "IDEMPOTENCY_CONFLICT",
        i18nMessage(
          "errors.IDEMPOTENCY_CONFLICT.the.operation.content.has.changed",
        ),
      );
      return {
        status: existing.status,
        stateVersion: existing.stateVersion || 0,
      };
    }
    const prepared = this.store.findBy(
      "preparedExecutions",
      "operationId",
      p.operationId,
    )[0];
    if (prepared) {
      ensure(
        prepared.hash === hash,
        "IDEMPOTENCY_CONFLICT",
        i18nMessage(
          "errors.IDEMPOTENCY_CONFLICT.operation.parameters.conflict",
        ),
      );
      if (prepared.status !== "queued")
        return { status: prepared.status, stateVersion: 0 };
    }
    ensure(
      !this.store
        .list("preparedExecutions")
        .some(
          (e) =>
            e.sessionId === p.session.id &&
            e.status === "queued" &&
            e.id !== p.executionId,
        ),
      "BUSY",
      i18nMessage("errors.BUSY.this.session.already.has.a.queued"),
    );
    ensure(
      !this.store
        .findBy("localExecutions", "sessionId", p.session.id)
        .some(
          (e) =>
            e.sessionId === p.session.id &&
            ["running", "starting", "waiting", "stopping"].includes(e.status),
        ),
      "BUSY",
      i18nMessage("errors.BUSY.this.session.already.has.an.execution"),
    );
    const cwd = await resolveDirectory(
      this.config().roots,
      p.session.rootId,
      p.session.relativePath,
    );
    if (p.workflow && p.session.runtime === "claude") {
      const claude = this.config().claude;
      ensure(claude?.baseUrl && claude?.apiKey, "CONFIG_REQUIRED", i18nMessage("connector.native.automation"));
    }
    const resolved = resolveRuntimeOptions(
      p.session.runtime,
      p.session,
      this.config()[p.session.runtime] || {},
    );
    if (resolved.options.effort || resolved.options.thinking) {
      const catalog = await runtimeCatalog(
        cwd,
        p.session.runtime,
        this.config()[p.session.runtime] || {},
      );
      const model = catalog.models.find(
        (m) =>
          m.id === (resolved.options.model || catalog.nativeModel) ||
          m.resolvedModel === (resolved.options.model || catalog.nativeModel),
      );
      ensure(
        model,
        "MODEL_CAPABILITY_UNKNOWN",
        i18nMessage(
          "errors.MODEL_CAPABILITY_UNKNOWN.model.capabilities.are.unknown.select.a",
        ),
      );
      if (resolved.options.effort)
        ensure(
          model.efforts?.includes(resolved.options.effort),
          "UNSUPPORTED_EFFORT",
          i18nMessage(
            "errors.UNSUPPORTED_EFFORT.the.model.does.not.support.or",
          ),
        );
      if (resolved.options.thinking) {
        ensure(
          model.thinkingModes?.includes(resolved.options.thinking.type),
          "UNSUPPORTED_THINKING",
          i18nMessage(
            "errors.UNSUPPORTED_THINKING.the.model.does.not.support.or",
          ),
        );
        ensure(
          resolved.options.thinking.type !== "disabled" ||
            !["xhigh", "max"].includes(resolved.options.effort || ""),
          "UNSUPPORTED_THINKING",
          i18nMessage(
            "errors.UNSUPPORTED_THINKING.thinking.cannot.be.disabled.with.xhigh",
          ),
        );
      }
    }
    const attachments = attachmentsSchema.parse(p.attachments || []);
    await validateAttachments(this.files, p.session, attachments);
    let messageWithAttachments = attachmentMessage(p.message, attachments);
    const mentions = mentionsSchema.parse(p.mentions || []);
    ensure(
      validMentions(p.message, mentions),
      "MENTION_INVALID",
      i18nMessage(
        "errors.MENTION_INVALID.references.do.not.match.the.message.detail2",
      ),
    );
    await this.mentions.validate(cwd, p.session.runtime, mentions);
    const historyMessage = attachmentMessage(
      nativeMentionText(
        p.message,
        mentions.filter(
          (m) =>
            m.kind === "file" &&
            /(?:^|[\\/])attachments[\\/]relay-[a-f0-9-]{36}[\\/]/.test(m.path),
        ),
        p.session.runtime,
      ),
      attachments,
    );
    if (p.commandIdentity) {
      const scope = commandScope.parse(p.session);
      const input = slashInput(p.message);
      ensure(input, "COMMAND_STALE", i18nMessage("slash.stale"));
      const row = await this.commands.resolve(scope, cwd, this.config()[scope.runtime], input.name);
      ensure(row.identity === p.commandIdentity && (row.execution === "template" || row.execution === "skill" || row.execution === "compact"),
        "COMMAND_STALE", i18nMessage("slash.stale"), 409);
      if (row.execution === "skill") {
        // 斜杠与 @ 占位符等长，参数中已有的结构化引用仍保持原位置。
        messageWithAttachments = "@" + messageWithAttachments.slice(1);
        mentions.unshift({ kind: "skill", name: row.name, path: row.path!, start: 0, end: row.name.length + 1 });
      }
    }
    const boardInput = mentions.some(m => m.kind === "board") ? {
      text: historyMessage,
      nativeText: nativeMentionText(messageWithAttachments, mentions, p.session.runtime),
    } : undefined;
    const userData = {
      text: historyMessage,
      operationId: p.operationId,
      ...(boardInput ? { nativeText: boardInput.nativeText } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
    const old = this.store
      .list("localSessions")
      .find((s) => s.id === p.session.id);
    ensure(
      !old || old.runtime === p.session.runtime,
      "SESSION_RUNTIME",
      i18nMessage("errors.SESSION_RUNTIME.the.cli.cannot.be.changed.for"),
    );
    const local = this.store.transaction(() => {
      // 类型切换、会话元数据与首条增量事件一并提交，失败完整回滚。
      this.store.promoteExecution(p.executionId, hash, p.session.id);
      const local = this.store.put(
        "localSessions",
        {
          ...p.session,
          cwd,
          title:
            old?.title ||
            p.message.trim().slice(0, 200) ||
            translate("en", "connector.session.defaultTitle"),
        },
        p.session.id,
      );
      this.store.put(
        "localExecutions",
        {
          operationId: p.operationId,
          handoffOperationId: randomUUID(),
          ...(boardInput ? { boardInput } : {}),
          workflow: p.workflow,
          hash,
          sessionId: local.id,
          status: "starting",
          events: [
            {
              type: "user",
              data: userData,
              sequence: 1,
            },
          ],
          sequence: 1,
          interactions: [],
        },
        p.executionId,
      );
      return local;
    });
    this.notify("execution.event", {
      executionId: p.executionId,
      title: local.title,
      event: {
        type: "user",
        data: userData,
        sequence: 1,
        executionId: p.executionId,
      },
    });
    // 同一原生工具调用重投时复用发布标识，新调用独立分配。
    const publishOperations = new Map<string, string>();
    const hooks = {
      initialTitleResult: (title: string | null) => {
        if (title === null) {
          this.diagnostic("board.sessionTitle.failed", { sessionId: local.id, executionId: p.executionId });
          return;
        }
        this.store.put("localSessions", { title, customTitle: title }, local.id);
        this.notify("execution.event", { executionId: p.executionId, title });
      },
      board: p.session.boardTools ? (tool: BoardTool, args: unknown, callId: string) =>
        this.handoff({ method: "board." + tool, executionId: p.executionId, args, callId }) : undefined,
      native: (nativeId: string) => {
        if (this.storageFailure || this.closing) return;
        try {
          this.store.put(
            "localSessions",
            {
              nativeId,
              ...(!old?.nativeId && p.session.runtime === "codex"
                ? {
                    nativeBoardTools: !!p.session.boardTools,
                    nativeLightTools:
                      !p.workflow || p.workflow.allowArtifacts
                        ? "publish-v4"
                        : "read-v2",
                  }
                : {}),
            },
            local.id,
          );
        } catch {
          this.storageFault();
        }
      },
      event: (type: string, data: any) => {
        try {
          this.enqueueEvent(p.executionId, local.id, type, data);
        } catch {
          /* 故障已记录，不能让流回调逃逸。 */
        }
      },
      interaction: (
        nativeId: string,
        method: string,
        params: any,
        answer: RuntimeAnswer,
      ) => {
        if (this.storageFailure || this.closing) return;
        try {
          this.flushEvents(p.executionId);
          const e = this.store.get("localExecutions", p.executionId);
          if (!["running", "starting", "waiting"].includes(e.status)) return;
          if (
            e.interactions.some(
              (i: any) => i.nativeId === nativeId && i.method === method,
            )
          )
            return;
          if (
            (e.questionRecords || []).some(
              (q: QuestionRecord) => q.nativeId === nativeId,
            )
          )
            return;
          const id = randomUUID();
          const form = questionForm(method, params);
          const approval = form ? null : classifyApproval(method, params);
          // 同步 Codex 的 nativeId 是 RPC 请求号，原生消息定位需读取 itemId。
          const questionItemId =
            method === "item/tool/requestUserInput" ? params?.itemId : nativeId;
          this.answers.set(id, answer);
          this.store.put(
            "localExecutions",
            {
              interactions: [
                ...e.interactions,
                {
                  id,
                  nativeId,
                  executionId: e.id,
                  method,
                  params,
                  ...(approval ? { approval } : {}),
                  ...(form ? { question: form } : {}),
                },
              ],
              ...(form
                ? {
                    questionRecords: [
                      ...(e.questionRecords || []),
                      {
                        id,
                        nativeId,
                        executionId: e.id,
                        sessionId: local.id,
                        afterSequence: e.sequence,
                        ...(typeof questionItemId === "string"
                          ? { questionItemId }
                          : {}),
                        form,
                        status: "waiting",
                      },
                    ],
                  }
                : {}),
            },
            e.id,
          );
          this.state(e.id, "waiting");
        } catch {
          this.storageFault();
        }
      },
      done: (status: string) => {
        if (this.storageFailure || this.closing) return;
        try {
          this.state(p.executionId, status);
        } catch {
          this.storageFault();
          return;
        }
        // 原生标题可能在本轮完成后才写入；只把标题返回服务端索引。
        void this.call("session.history", { sessionId: local.id })
          .then((h) => {
            this.notify("execution.event", {
              executionId: p.executionId,
              title: h.title,
            });
          })
          .catch(() => {});
      },
      light: async (
        method: "light.docs" | "light.publish" | "light.feedback" | "light.versions" | "light.unlist" | "light.delete",
        args: unknown,
        callId?: string,
      ) => {
        if (method === "light.publish") {
          let input;
          try {
            input = parseLightInput(publishInput, args);
          } catch (error) {
            if (error instanceof AppError && error.messageKey)
              throw new Error(error.code + " " + error.message + " / " + translate("en", error.messageKey, error.messageParams));
            throw error;
          }
          const operationId =
            (callId && publishOperations.get(callId)) || randomUUID();
          if (callId) publishOperations.set(callId, operationId);
          const directoryPath = resolve(cwd, input.directory);
          const entryPath = resolve(directoryPath, input.entry);
          const locale = p.workflow?.locale ?? p.session.locale ?? "en";
          try {
            const result = await this.handoff({
              method, args: { ...input, operationId }, executionId: p.executionId,
            });
            return {
              ...result, directoryPath, entryPath,
              openHint: translate(locale, "light.openHint", { number: result.number }),
            };
          } catch (error) {
            if (error instanceof AppError && (error.code === "LIGHT_FILE" || error.code.startsWith("FILE_")))
              throw new Error(error.message + "\n" + translate(locale, "light.checkPaths", { directoryPath, entryPath }));
            throw error;
          }
        }
        return this.handoff({ method, args, executionId: p.executionId });
      },
      handoff: async (args: any) => {
        this.flushEvents(p.executionId);
        ensure(
          p.workflow,
          "NO_WORKFLOW",
          i18nMessage("errors.NO_WORKFLOW.this.session.does.not.belong.to"),
        );
        return this.handoff({
          ...args,
          method: "workflow.handoff",
          executionId: p.executionId,
          operationId: this.store.get("localExecutions", p.executionId)
            .handoffOperationId,
          itemId: p.workflow.itemId,
        });
      },
    };
    // 每个会话仅保留最后一个原生进程用于读取历史，避免续发累积空闲进程。
    for (const previous of this.store.findBy(
      "localExecutions",
      "sessionId",
      local.id,
    ))
      if (
        previous.sessionId === local.id &&
        previous.id !== p.executionId &&
        ["completed", "failed", "cancelled"].includes(previous.status)
      ) {
        this.handles.get(previous.id)?.close();
        this.handles.delete(previous.id);
      }
    let runtime: CodexRuntime | ClaudeRuntime | undefined;
    try {
      // 构造阶段配置错误也属于启动失败，不能永久留下 starting 占位。
      runtime =
        p.session.runtime === "codex"
          ? new CodexRuntime(hooks, this.config().codex || {})
          : new ClaudeRuntime(hooks, this.config().claude || {});
      this.handles.set(p.executionId, runtime);
      if (mentions.some(m => m.kind === "board"))
        await this.handoff({ method: "board.accept", executionId: p.executionId });
      await runtime.start(
        cwd,
        {
          ...p.session,
          nativeBoardTools: old?.nativeBoardTools,
          nativeLightTools: old?.nativeLightTools,
          initialSessionTitle: !old && p.workflow ? p.initialSessionTitle : undefined,
        },
        messageWithAttachments,
        // 暂存执行来自看板会话续发，保留交接工具上下文，仅切换本轮正文。
        prepared ? { ...p.workflow, manualContinuation: true } : p.workflow,
        old?.nativeId,
        mentions,
      );
      this.state(p.executionId, "running");
    } catch (e) {
      this.state(p.executionId, "failed");
      runtime?.close();
      throw e;
    }
    const current = this.store.get("localExecutions", p.executionId);
    return { status: current.status, stateVersion: current.stateVersion || 0 };
  }
  /** 撤销与停止共用终止路径；单个运行时关闭失败不阻止其余任务清理。 */
  close() {
    this.closing = true;
    const errors: unknown[] = [];
    try {
      this.terminals.close();
    } catch (error) {
      errors.push(error);
    }
    void this.uploads.close();
    const cancelled: string[] = [];
    for (const [id, h] of this.handles) {
      try {
        h.close();
        cancelled.push(id);
      } catch (error) {
        errors.push(error);
      } finally {
        this.handles.delete(id);
      }
    }
    for (const id of cancelled) {
      try {
        this.state(id, "cancelled");
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.flushEvents();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "运行时终止失败");
  }
}
