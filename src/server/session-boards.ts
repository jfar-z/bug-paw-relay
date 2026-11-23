import { posix, win32 } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  ensure,
  type Entity,
  type Board,
  type Stage,
  directorySchema,
  workItemSchema,
} from "../shared/contracts.js";
import {
  boardCapability,
  boardTools,
  type BoardTool,
} from "../shared/session-boards.js";
import { message, translate } from "../shared/i18n.js";
import { attachmentLink } from "../shared/uploads.js";
import type { RpcPeer } from "../shared/rpc.js";
import type { Service, BoardAttachmentBatch } from "./service.js";
import type { FileTransfers } from "./file-transfers.js";
import type { FilePushTransfers } from "./file-push.js";
import type { BoardUploads } from "./board-uploads.js";
import { digest } from "./security.js";

function scope(ok: unknown): asserts ok {
  ensure(ok, "BOARD_SCOPE", message("board.referenceUnavailable"), 403);
}

type Directory = z.infer<typeof directorySchema>;

/** 保留配置路径用于显示；按目标系统解析完整目录后比较。 */
function boardDirectory(
  service: Service,
  binding: Partial<Directory> & { [key: string]: unknown },
) {
  const environment = binding.environmentId
    ? service.store.findBy("environments", "id", binding.environmentId)[0]
    : undefined;
  const root = environment?.roots?.find(
    (r: { id: string }) => r.id === binding.rootId,
  );
  const windows = environment?.platform?.startsWith("win32");
  const path = windows ? win32 : posix;
  const cwd =
    environment?.platform &&
    root?.path &&
    path.isAbsolute(root.path) &&
    typeof binding.relativePath === "string"
      ? path.resolve(root.path, binding.relativePath)
      : null;
  return {
    environmentId: binding.environmentId,
    environmentName: environment?.name,
    rootId: binding.rootId,
    relativePath: binding.relativePath,
    configuredCwd: cwd,
    cwd,
    windows,
  };
}
type Binding = ReturnType<typeof boardDirectory>;
function match(source: Binding, target: Binding) {
  if (!source.configuredCwd || !target.configuredCwd) return "unknown";
  if (source.environmentId !== target.environmentId)
    return "different_environment";
  if (!source.cwd || !target.cwd) return "unknown";
  const same = target.windows
    ? win32.relative(source.cwd, target.cwd) === ""
    : source.cwd === target.cwd;
  return same ? "same_directory" : "different_directory";
}

export class SessionBoards {
  private busy = new Map<string, Promise<unknown>>();
  constructor(
    private service: Service,
    private files: FileTransfers,
    private pushes: FilePushTransfers,
    private uploads: BoardUploads,
  ) {}
  private get store() {
    return this.service.store;
  }

  private source(
    executionId: string,
    envId: string,
    peer: RpcPeer,
    confirming = false,
  ) {
    const e = this.service.execution(executionId);
    const session = this.store.get("sessions", e.session_id);
    const env = this.store.get("environments", envId);
    scope(
      env.approved &&
        !env.revoked &&
        env.capabilities?.includes(boardCapability) &&
        this.service.peers.get(envId) === peer &&
        session.environmentId === envId &&
        e.environment_id === envId &&
        !session.archived &&
        session.executionId === e.id &&
        (["running", "waiting", "dispatching"].includes(e.state) ||
          (confirming && e.state === "completed")),
    );
    const snapshot = JSON.parse(e.snapshot);
    let full =
      session.permission === "full" &&
      (snapshot.permission ?? snapshot.stage?.permission) === "full";
    if (e.item_id) {
      const item = this.store.get("items", e.item_id);
      const stage = this.store
        .get<Board>("boards", item.boardId)
        .stages.find((s) => s.id === item.stageId);
      scope(
        !item.archived &&
          item.executionId === e.id &&
          stage?.type === "agent" &&
          stage.id === snapshot.stage?.id,
      );
      full &&= stage.permission === "full";
    }
    return { session, snapshot, full };
  }
  private board(session: Entity, id: string) {
    scope(session.boardIds?.includes(id));
    const board = this.store.get<Board>("boards", id);
    scope(board.ownerId === session.ownerId);
    return board;
  }
  private item(board: Board, id: string) {
    const item = this.store.get("items", id);
    scope(item.boardId === board.id && item.ownerId === board.ownerId);
    return item;
  }
  detail(boardId: string, itemId: string) {
    const board = this.store.get<Board>("boards", boardId);
    const item = this.item(board, itemId);
    return { boardId, ...this.service.itemEditView(item.id), handoffs: this.store.findBy("handoffs", "itemId", item.id) };
  }
  private summary(board: Board, item: Entity) {
    const stage = board.stages.find((s) => s.id === item.stageId);
    return {
      boardId: board.id,
      boardName: board.name,
      itemId: item.id,
      title: item.title,
      stageId: item.stageId,
      stageName: stage?.name ?? null,
      stageNameKey: stage?.nameKey,
      archived: !!item.archived,
      status: item.status,
    };
  }
  private async binding(
    binding: Partial<Directory> & { [key: string]: unknown },
    sessionId?: string,
  ) {
    const target = boardDirectory(this.service, binding);
    if (target.cwd && target.environmentId) {
      const peer = this.service.peers.get(target.environmentId);
      try {
        const reply = await peer?.call(
          sessionId ? "board.sessionCwd" : "directory.validate",
          sessionId
            ? { sessionId }
            : { rootId: target.rootId, relativePath: target.relativePath },
        );
        target.cwd = typeof reply?.path === "string" ? reply.path : null;
      } catch {
        target.cwd = null;
      }
    }
    return target;
  }
  private async definition(session: Entity, board: Board) {
    const source = await this.binding(session, session.id);
    return {
      boardId: board.id,
      name: board.name,
      version: board.version,
      source,
      defaultStartId: board.stages.find((s) => s.fixedRole === "start")?.id,
      startStageIds: board.stages.map((s) => s.id),
      stages: await Promise.all(
        board.stages.map(async (s) => {
          const target =
            s.type === "agent"
              ? await this.binding({
                  ...s,
                  environmentId: s.environmentId ?? undefined,
                })
              : null;
          const relation = target ? match(source, target) : "not_applicable";
          return {
            id: s.id,
            name: s.name,
            nameKey: s.nameKey,
            type: s.type,
            instructions: s.instructions,
            agentId: s.agentId,
            responsibility: s.agentId
              ? this.store.findBy("agents", "id", s.agentId)[0]?.instructions
              : undefined,
            targets: s.targets,
            target,
            match: relation,
            ...(relation === "unknown"
              ? { missing: !source.cwd ? "source_binding" : "target_binding" }
              : {}),
          };
        }),
      ),
    };
  }

  async agent(method: string, envId: string, peer: RpcPeer, raw: any) {
    const { executionId, args, callId } = z
      .object({
        executionId: z.uuid(),
        args: z.unknown().optional(),
        callId: z.string().min(1).max(512).optional(),
      })
      .parse(raw);
    const { session, snapshot, full } = this.source(executionId, envId, peer);
    if (method === "accept") {
      // 只采纳浏览器发送且环境已接收的结构化引用，工具参数不能授予权限。
      const ids = [
        ...new Set([...(session.boardIds || []), ...(snapshot.boardIds || [])]),
      ];
      this.store.put("sessions", { boardIds: ids }, session.id);
      return { ok: true };
    }
    scope(Object.hasOwn(boardTools, method));
    const parsed = boardTools[method as BoardTool].schema.safeParse(args);
    ensure(parsed.success, "INVALID_PARAMS", message("board.toolArguments"));
    const data = parsed.data;
    if (method === "docs")
      return {
        text: translate(
          snapshot.locale ?? this.service.languageSettings().locale,
          "board.toolDocs",
        ),
      };
    if (method === "references")
      return {
        boards: this.store
          .list("boards")
          .filter(
            (b) =>
              b.ownerId === session.ownerId && session.boardIds?.includes(b.id),
          )
          .map((b) => ({
            boardId: b.id,
            name: b.name,
            projectId: b.projectId,
          })),
      };
    scope("boardId" in data);
    const board = this.board(session, data.boardId);
    if (method === "definition") {
      const result = await this.definition(session, board);
      this.board(this.source(executionId, envId, peer).session, board.id);
      return result;
    }
    if (method === "list") {
      const data = boardTools.list.schema.parse(args);
      const rows = this.store
        .findBy("items", "boardId", board.id)
        .filter(
          (i) =>
            i.ownerId === session.ownerId &&
            !!i.archived === data.archived &&
            (!data.stageId || i.stageId === data.stageId) &&
            (!data.keyword ||
              [i.title, i.content].some((text) =>
                text?.toLowerCase().includes(data.keyword!.toLowerCase()),
              )),
        );
      return {
        total: rows.length,
        items: rows
          .slice(data.offset, data.offset + data.limit)
          .map((i) => this.summary(board, i)),
      };
    }
    const item = "itemId" in data ? this.item(board, data.itemId) : null;
    if (method === "detail" && item) return this.detail(board.id, item.id);
    scope(callId);
    const key =
      "session-board:" + digest(JSON.stringify([executionId, method, callId]));
    const fingerprint = digest(JSON.stringify(data));
    let op = this.store.findBy("boardRequests", "id", key)[0];
    if (op) {
      ensure(
        op.fingerprint === fingerprint,
        "IDEMPOTENCY_CONFLICT",
        message("workItemCreation.IDEMPOTENCY_CONFLICT"),
        409,
      );
    } else {
      let plan;
      if (method === "create") {
        const data = boardTools.create.schema.parse(args);
        const { stage } = this.service.resolveItemStart(
          workItemSchema.parse(data),
        );
        plan = await this.plan(session, board, stage, data, peer);
      }
      this.board(this.source(executionId, envId, peer).session, board.id);
      op = this.store.findBy("boardRequests", "id", key)[0];
      if (!op) {
        op = this.store.put(
          "boardRequests",
          {
            sessionId: session.id,
            executionId,
            boardId: board.id,
            method,
            data,
            fingerprint,
            plan,
            operationId: randomUUID(),
            boardVersion: board.version,
            boardName: board.name,
            itemTitle: item?.title,
            status: method === "share" || full ? "ready" : "pending",
          },
          key,
        );
        if (op.status === "pending")
          this.changed(session.id, "board-confirmation");
      }
      scope(op.fingerprint === fingerprint);
    }
    if (op.status === "pending" || op.status === "denied")
      return { status: op.status, requestId: op.id };
    return this.perform(op);
  }
  private changed(sessionId: string, type: string) {
    this.service.sessionEvents.emit(sessionId, { type, sessionId });
  }
  private async plan(
    session: Entity,
    board: Board,
    stage: Stage,
    data: z.infer<typeof boardTools.create.schema>,
    peer: RpcPeer,
  ) {
    const dirs: Directory[] = this.store.get(
      "projects",
      board.projectId,
    ).directories;
    const selected =
      data.materialDirectory ??
      (stage.type === "agent" ? stage : dirs.length === 1 ? dirs[0] : null);
    const target = dirs.find(
      (d) =>
        selected &&
        d.environmentId === selected.environmentId &&
        d.rootId === selected.rootId &&
        d.relativePath === selected.relativePath,
    );
    if (data.files.length)
      ensure(
        target &&
          (stage.type !== "agent" ||
            (target.environmentId === stage.environmentId &&
              target.rootId === stage.rootId &&
              target.relativePath === stage.relativePath)),
        "DIRECTORY_MISMATCH",
        message("uploads.directory"),
      );
    const source = await this.binding(session, session.id);
    const destination = target && (await this.binding(target));
    if (data.files.length)
      ensure(
        source.cwd && destination?.cwd,
        "DIRECTORY_MISMATCH",
        message("uploads.directory"),
      );
    const files = [];
    for (const path of data.files) {
      const info = await peer.call("files.inspect", {
        source: this.fileSource(session, path, source.cwd!),
      });
      files.push({
        path,
        name: info.name,
        size: info.size,
        version: info.version,
      });
    }
    return {
      startStageId: stage.id,
      stageName: stage.name,
      stageNameKey: stage.nameKey,
      schedulesAgent: stage.type === "agent",
      target,
      destination,
      source,
      transfer:
        !!files.length &&
        (!destination || match(source, destination) !== "same_directory"),
      files,
    };
  }
  private fileSource(session: Entity, path: string, cwd: string) {
    return {
      expectedCwd: cwd,
      rootId: session.rootId,
      relativePath: session.relativePath,
      path,
    };
  }
  pending(sessionId: string) {
    this.store.get("sessions", sessionId);
    return this.store
      .findBy("boardRequests", "sessionId", sessionId)
      .filter((op) => op.status === "pending");
  }
  async decide(sessionId: string, id: string, approve: boolean) {
    const op = this.store.get("boardRequests", id);
    scope(op.sessionId === sessionId && op.method !== "share");
    if (!approve && op.status !== "pending") return { status: op.status };
    if (op.status === "pending") {
      this.store.put(
        "boardRequests",
        {
          status: approve ? "approved" : "denied",
          ...(!approve ? { data: null, plan: null } : {}),
        },
        id,
      );
      this.changed(sessionId, "board-confirmation");
    }
    const saved = this.store.get("boardRequests", id);
    return saved.status === "denied"
      ? { status: "denied" }
      : this.perform(saved);
  }

  private async perform(op: Entity) {
    const current = this.busy.get(op.id);
    if (current) return current;
    const promise = this.execute(op).finally(() => this.busy.delete(op.id));
    this.busy.set(op.id, promise);
    return promise;
  }
  private async execute(op: Entity) {
    const session = this.store.get("sessions", op.sessionId);
    const peer = this.service.peer(session.environmentId);
    const check = () => {
      const source = this.source(
        op.executionId,
        session.environmentId,
        peer,
        true,
      );
      scope(op.method === "share" || op.status !== "ready" || source.full);
      const board = this.board(source.session, op.boardId);
      if (
        op.method !== "share" &&
        !op.result &&
        board.version !== op.boardVersion
      )
        throw new AppError(
          "BOARD_VERSION_CONFLICT",
          message("workItemCreation.BOARD_VERSION_CONFLICT"),
          409,
        );
      return board;
    };
    const board = check();
    if (op.status === "completed")
      return {
        outcome: "completed",
        ...this.summary(board, this.item(board, op.result.itemId)),
      };
    let result = op.result;
    if (!result) {
      const item =
        op.method === "create"
          ? await this.create(op, session, peer, check)
          : this.item(board, op.data.itemId);
      if (op.method === "archive" && !item.archived)
        this.service.archiveItem(item.id, true);
      result = { itemId: item.id };
      if (op.method !== "create") this.recordResult(op, item);
    }
    if (op.method !== "archive") {
      try {
        await this.deliver(op, board, result.itemId, peer);
      } catch {
        return {
          outcome: "card_pending",
          ...this.summary(board, this.item(board, result.itemId)),
        };
      }
    }
    this.store.put(
      "boardRequests",
      { status: "completed", data: null, plan: null },
      op.id,
    );
    return {
      outcome: "completed",
      ...this.summary(board, this.item(board, result.itemId)),
    };
  }
  /** 创建索引和待投递回执在同一事务中保存；服务端只保留卡片定位信息。 */
  private recordResult(op: Entity, item: Entity) {
    this.store.put(
      "boardRequests",
      {
        result: { itemId: item.id },
        data: null,
        plan: null,
        boardName: null,
        itemTitle: null,
      },
      op.id,
    );
  }
  private async deliver(
    op: Entity,
    board: Board,
    itemId: string,
    peer: RpcPeer,
  ) {
    const card = this.summary(board, this.item(board, itemId));
    await peer.call("board.card.record", {
      executionId: op.executionId,
      card: { ...card, id: op.operationId },
    });
    this.changed(op.sessionId, "board-card");
  }
  /** 回执响应丢失时只补交已经产生的卡片，环境按相同标识去重。 */
  async recoverCards(sessionId: string) {
    const session = this.store.get("sessions", sessionId);
    for (const op of this.store.findBy(
      "boardRequests",
      "sessionId",
      sessionId,
    )) {
      if (
        op.status === "completed" ||
        !op.result ||
        op.method === "archive" ||
        this.busy.has(op.id)
      )
        continue;
      if (
        !session.boardIds?.includes(op.boardId) ||
        !this.store.findBy("boards", "id", op.boardId).length ||
        !this.store.findBy("items", "id", op.result.itemId).length
      )
        continue;
      const board = this.board(session, op.boardId);
      await this.deliver(
        op,
        board,
        op.result.itemId,
        this.service.peer(session.environmentId),
      );
      this.store.put("boardRequests", { status: "completed" }, op.id);
    }
  }
  private async create(
    op: Entity,
    session: Entity,
    peer: RpcPeer,
    check: () => Board,
  ) {
    const plan = op.plan;

    const tickets = [];
    let batch: BoardAttachmentBatch | undefined;
    try {
      if (plan.files.length) {
        const target = await this.binding(plan.target);
        ensure(
          target.cwd && target.cwd === plan.destination.cwd,
          "DIRECTORY_MISMATCH",
          message("uploads.directory"),
        );
      }
      for (const file of plan.files) {
        const ticket = await this.files.create(op.id, {
          peer,
          source: this.fileSource(session, file.path, plan.source.cwd),
          revalidate: check,
        });
        tickets.push(ticket);
        ensure(
          ticket.version === file.version,
          "FILE_CHANGED",
          message("errors.FILE_CHANGED.the.file.has.changed.open.it"),
          409,
        );
      }
      if (plan.transfer) {
        const push = await this.uploads.begin(
          op.boardId,
          op.id,
          {
            stageId: plan.startStageId,
            directory: plan.target,
            operationId: op.operationId,
            files: tickets.map(({ name, size }) => ({ name, size })),
          },
          check,
        );
        try {
          ensure(
            push.cwd === plan.destination.cwd,
            "DIRECTORY_MISMATCH",
            message("uploads.directory"),
          );
          for (const [index, file] of tickets.entries()) {
            for (let offset = 0; offset < file.size;) {
              const bytes = await this.files.read(op.id, file.id, offset);
              await this.pushes.call(op.id, push.id, "write", {
                index,
                offset,
                data: bytes.toString("base64"),
                sha256: createHash("sha256").update(bytes).digest("hex"),
              });
              offset += bytes.length;
            }
          }
          const receipt = await this.pushes.call(op.id, push.id, "finish", {});
          batch = await this.uploads.prepare(op.id, {
            operationId: op.operationId,
            attachmentReceipt: receipt.attachmentReceipt,
          });
        } finally {
          await this.pushes.cancel(op.id, push.id);
        }
      }
      check();
      const links = plan.transfer
        ? []
        : plan.files.map((f: { name: string; path: string }) =>
            attachmentLink(f.name, f.path),
          );
      return this.service.createItem(
        {
          boardId: op.boardId,
          boardVersion: op.boardVersion,
          startStageId: plan.startStageId,
          title: op.data.title,
          content: [op.data.summary, op.data.acceptance, ...links]
            .filter(Boolean)
            .join("\n\n"),
          operationId: op.operationId,
        },
        batch,
        (item) => this.recordResult(op, item),
      );
    } finally {
      for (const ticket of tickets) this.files.cancel(op.id, ticket.id);
    }
  }
}
