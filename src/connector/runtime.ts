import { boardInstruction, boardTool, boardTools, type BoardTool } from "../shared/session-boards.js";
import {
  docsQuery,
  publishInput,
  appTarget,
  feedbackQuery,
  versionsQuery,
  sessionProductContext,
} from "../shared/light-apps.js";
import { resumedLightTools } from "./resumed-light-tools.js";
import { isCodexAsyncQuestion } from "../shared/user-questions.js";
import { message as i18nMessage } from "../shared/i18n.js";
import {
  workflowTargets,
  workflowPrompt,
  handoffLabel,
} from "../shared/stage-handoff.js";
import { resolveRuntimeOptions } from "../shared/runtime-options.js";
import {
  nativeMentionText,
  type Mention,
  type MentionItem,
} from "../shared/mentions.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cliInvocation, hostCli } from "./host-cli.js";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { loadClaudeSdk } from "./claude-sdk.js";
import { z } from "zod";
import { AppError, ensure } from "../shared/contracts.js";
const docsDescription = "Read Light App authoring constraints before building. Topics cover the runtime, dedicated environment backend, version storage and debugging.";
const publishDescription =
  "Publish the selected static assets from this environment conversation as a BugPaw Relay Light App, with user consent. Optionally bind a running dedicated service (see backend docs). Returns appId, versionId, number and hasBackend.";
const versionsDescription =
  "List apps and versions from this conversation, including listing status, publication time and feedback and runtime error counts. Optionally filter by appId.";
const lifecycleTools = [
  { name: "relay_light_unlist", method: "light.unlist", description: "Unlist one explicitly selected app from this conversation. Preserves versions and feedback. Report pending confirmation when requested." },
  { name: "relay_light_delete", method: "light.delete", description: "Request platform confirmation to permanently delete the selected app, all version files and feedback. Clarify ambiguous removal requests first." },
] as const;
function lightMethod(name: string) {
  const lifecycle = lifecycleTools.find(tool => tool.name === name);
  if (lifecycle) return lifecycle.method;
  if (name === "relay_light_docs") return "light.docs";
  if (name === "relay_light_publish") return "light.publish";
  if (name === "relay_light_versions") return "light.versions";
  return "light.feedback";
}
function environmentInstructions(session: any, workflow: any, light: boolean) {
  const context = sessionProductContext(
    light && (!workflow || !!workflow.allowArtifacts),
    light,
  );
  return [
    context,
    session.boardTools && boardInstruction,
    session.agent?.injection !== "inherit" && session.agent?.instructions,
  ]
    .filter(Boolean)
    .join("\n\n");
}
const feedbackDescription =
  "读取当前来源会话的指定版本反馈与运行报错 / Read feedback and runtime diagnostics for a version from this session.";
/** 原生运行时适配事件均由环境本地记录，服务端仅接收状态索引。 */
export interface RuntimeHooks {
  event: (type: string, data: any) => void;
  native: (id: string) => void;
  initialTitleResult?: (title: string | null) => void;
  interaction: (
    id: string,
    method: string,
    params: any,
    answer: RuntimeAnswer,
  ) => void;
  done: (status: string) => void;
  board?: (tool: BoardTool, args: unknown, callId: string) => Promise<unknown>;
  light?: (
    method: "light.docs" | "light.publish" | "light.feedback" | "light.versions" | "light.unlist" | "light.delete",
    args: unknown,
    callId?: string,
  ) => Promise<unknown>;
  handoff: (args: any) => Promise<any>;
}
/** 元数据写入失败只报告诊断，保留首轮执行及其终态。 */
async function confirmInitialTitle(hooks: RuntimeHooks, title: string, write: () => Promise<void>) {
  try {
    await write();
  } catch {
    hooks.initialTitleResult?.(null);
    return;
  }
  hooks.initialTitleResult?.(title);
}
/** Claude 的原生标题写入后按同一项目目录回读。 */
export async function renameClaudeSession(nativeId: string, cwd: string, title: string) {
  const sdk = await loadClaudeSdk();
  await sdk.renameSession(nativeId, title, { dir: cwd });
  const info = await sdk.getSessionInfo(nativeId, { dir: cwd });
  ensure(info?.customTitle === title, "COMMAND_RENAME", i18nMessage("slash.renameFailed"));
}
export type RuntimeAnswer = (
  value: any,
) => void | Promise<void | { answerTurnId: string }>;
export interface RuntimeHandle {
  cancel: () => Promise<void>;
  history: () => Promise<any>;
  close: () => void;
}
/** Codex stdio JSON-RPC 独立进程，不暴露 app-server 端口。 */
export class CodexRuntime implements RuntimeHandle {
  private process: ChildProcessWithoutNullStreams;
  private pending = new Map<
    string,
    {
      resolve: (x: any) => void;
      reject: (e: any) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private questionReceipts = new Map<
    string,
    { resolve: () => void; reject: (e: Error) => void }
  >();
  private threadId = "";
  private turnId = "";
  private resumedBoardTools?: Awaited<ReturnType<typeof resumedLightTools>>;
  private resumedTools?: Awaited<ReturnType<typeof resumedLightTools>>;
  private finished = false;
  private asyncQuestions = new Set<string>();
  private answerQueue = Promise.resolve();
  private cancelling = false;
  constructor(
    private hooks: RuntimeHooks,
    private config: any,
  ) {
    const { command, prefix } = cliInvocation(hostCli("codex", config));
    const args = [...prefix, "app-server"];
    const env = { ...process.env };
    if (config.home) env.CODEX_HOME = config.home;
    if (config.baseUrl) {
      ensure(
        config.apiKey && config.model,
        "CONFIG_REQUIRED",
        i18nMessage(
          "errors.CONFIG_REQUIRED.a.custom.codex.endpoint.requires.a",
        ),
      );
      env.BUGPAW_CODEX_KEY = config.apiKey;
      args.push(
        "-c",
        'model_provider="bugpaw"',
        "-c",
        `model=${JSON.stringify(config.model)}`,
        "-c",
        `model_providers.bugpaw={name="BugPaw endpoint",base_url=${JSON.stringify(config.baseUrl)},env_key="BUGPAW_CODEX_KEY",wire_api="responses"}`,
      );
    }
    this.process = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process.stderr.on("data", () => {});
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        // 原生进程偶尔输出非 JSON 诊断行；不得将原文或凭据写入日志。
        return;
      }
      try {
        this.receive(message);
      } catch {
        // 业务处理失败不能与非协议输出一起吞掉，也不重放可能已提交的动作。
        console.error(
          JSON.stringify({
            time: new Date().toISOString(),
            event: "runtime.message_failed",
            runtime: "codex",
            threadId: this.threadId || null,
            turnId: this.turnId || null,
            reason: "MESSAGE_HANDLER_FAILED",
          }),
        );
      }
    });
    this.process.on("error", () => this.exit());
    this.process.on("exit", () => this.exit());
  }
  private exit() {
    this.resumedBoardTools?.close();
    this.resumedTools?.close();
    for (const receipt of this.questionReceipts.values())
      receipt.reject(new Error("RUNTIME_EXIT"));
    this.questionReceipts.clear();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(
        new AppError(
          "RUNTIME_EXIT",
          i18nMessage("errors.RUNTIME_EXIT.the.codex.process.has.exited"),
        ),
      );
    }
    this.pending.clear();
    if (!this.finished) {
      this.finished = true;
      this.hooks.done("failed");
    }
  }
  private write(value: any) {
    this.process.stdin.write(JSON.stringify(value) + "\n");
  }
  private call(method: string, params: any): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new AppError(
            "NATIVE_TIMEOUT",
            i18nMessage(
              "errors.NATIVE_TIMEOUT.the.native.request.timed.out.check",
            ),
          ),
        );
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  private receive(m: any) {
    if (m.method) {
      if (m.id !== undefined) {
        const board = m.method === "item/tool/call" && boardTool(String(m.params.tool));
        if (board && this.hooks.board) {
          const respond = (success: boolean, text: string) => this.write({
            id: m.id, result: { success, contentItems: [{ type: "inputText", text }] },
          });
          void this.hooks.board(board, m.params.arguments, String(m.params.callId ?? m.id))
            .then(value => respond(true, JSON.stringify(value)), error => respond(false, error.message));
          return;
        }
        if (
          m.method === "item/tool/call" &&
          this.hooks.light &&
          [
            "relay_light_publish",
            "relay_light_docs",
            "relay_light_feedback",
            "relay_light_versions",
            ...lifecycleTools.map(tool => tool.name),
          ].includes(m.params.tool)
        ) {
          const method = lightMethod(m.params.tool);
          const respond = (success: boolean, text: string) =>
            this.write({
              id: m.id,
              result: { success, contentItems: [{ type: "inputText", text }] },
            });
          // 旧线程的历史 schema 仍可能要求 operationId，内部标识始终由连接器分配。
          let args = m.params.arguments;
          if (
            this.resumedTools &&
            method === "light.publish" &&
            args &&
            typeof args === "object"
          ) {
            const { operationId: ignored, ...selected } = args;
            args = selected;
          }
          void this.hooks
            .light(method, args, String(m.params.callId ?? m.id))
            .then(
              (v) => respond(true, JSON.stringify(v)),
              (e) => respond(false, e.message),
            );
          return;
        }
        if (
          m.method === "item/tool/call" &&
          m.params.tool === "relay_handoff"
        ) {
          void this.hooks
            .handoff(m.params.arguments)
            .then((result) =>
              this.write({
                id: m.id,
                result: {
                  contentItems: [
                    { type: "inputText", text: JSON.stringify(result) },
                  ],
                  success: true,
                },
              }),
            )
            .catch(() =>
              this.write({
                id: m.id,
                result: {
                  contentItems: [
                    {
                      type: "inputText",
                      text: "交接失败，请检查目标和连接状态",
                    },
                  ],
                  success: false,
                },
              }),
            );
          return;
        }
        this.hooks.interaction(String(m.id), m.method, m.params, (value) => {
          if (m.method !== "item/tool/requestUserInput") {
            // 管道写入失败时让调用方收到错误，避免留下成功审批记录。
            return new Promise<void>((resolve, reject) => {
              this.process.stdin.write(JSON.stringify({ id: m.id, result: value }) + "\n",
                error => error ? reject(error) : resolve());
            });
          }
          return new Promise<void>((resolve, reject) => {
            // 用户提问等待原生 resolved 回执；管道写入成功不等于工具已接收。
            this.questionReceipts.set(String(m.id), { resolve, reject });
            this.process.stdin.write(
              JSON.stringify({ id: m.id, result: value }) + "\n",
              (error) => {
                if (error) {
                  this.questionReceipts.delete(String(m.id));
                  reject(error);
                }
              },
            );
          });
        });
        return;
      }
      if (m.method === "serverRequest/resolved") {
        const id = String(m.params.requestId);
        this.questionReceipts.get(id)?.resolve();
        this.questionReceipts.delete(id);
      }
      this.hooks.event(m.method, m.params);
      if (m.method === "turn/started") this.turnId = m.params.turn.id;
      const item = m.params?.item;
      if (
        m.method === "item/completed" &&
        isCodexAsyncQuestion(item) &&
        m.params.threadId === this.threadId &&
        !this.cancelling
      ) {
        this.registerAsyncQuestion(item);
      }
      if (m.method === "turn/completed") {
        for (const receipt of this.questionReceipts.values())
          receipt.reject(new Error("NATIVE_TURN_ENDED"));
        this.questionReceipts.clear();
        this.turnId = "";
        // 原生异步工具已返回；保留执行供稍后在原线程提交回答。
        if (m.params.turn.status === "completed" && this.asyncQuestions.size)
          return;
        this.resumedBoardTools?.close();
        this.resumedTools?.close();
        this.finished = true;
        this.hooks.done(
          m.params.turn.status === "completed"
            ? "completed"
            : m.params.turn.status === "interrupted"
              ? "cancelled"
              : "failed",
        );
      }
    } else {
      const p = this.pending.get(String(m.id));
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(String(m.id));
        m.error
          ? p.reject(new AppError("NATIVE_ERROR", m.error.message))
          : p.resolve(m.result);
      }
    }
  }
  private registerAsyncQuestion(item: {
    id: string;
    questions: { title: string }[];
  }) {
    this.asyncQuestions.add(item.id);
    this.hooks.interaction(
      item.id,
      "request_user_input_async",
      { questions: item.questions },
      (value) => {
        // 同一线程的多张卡片串行回传，避免空闲线程同时开启两个后续回合。
        const delivery = this.answerQueue.then(async () => {
          if (this.finished || !this.asyncQuestions.has(item.id))
            throw new Error("STALE_INTERACTION");
          const input = [
            {
              type: "text",
              text: JSON.stringify({
                requestId: item.id,
                answers: item.questions.map(
                  (q: { title: string }, i: number) => ({
                    question: q.title,
                    answers: value.answers[String(i)].answers,
                  }),
                ),
              }),
            },
          ];
          const params = { threadId: this.threadId, input };
          if (this.turnId) {
            const answerTurnId = this.turnId;
            await this.call("turn/steer", {
              ...params,
              expectedTurnId: answerTurnId,
            });
            return { answerTurnId };
          }
          const result = await this.call("turn/start", params);
          this.turnId = result.turn.id;
          return { answerTurnId: this.turnId };
        });
        const settle = (status: string) => {
          this.asyncQuestions.delete(item.id);
          if (
            !this.finished &&
            !this.cancelling &&
            !this.turnId &&
            !this.asyncQuestions.size
          ) {
            this.finished = true;
            this.hooks.done(status);
          }
        };
        this.answerQueue = delivery.then(
          () => settle("completed"),
          () => settle("failed"),
        );
        return delivery;
      },
    );
  }
  async start(
    cwd: string,
    session: any,
    message: string,
    workflow: any,
    nativeId?: string,
    mentions: Mention[] = [],
  ) {
    ensure(
      session.agent?.injection !== "replace",
      "UNSUPPORTED_INJECTION",
      i18nMessage(
        "errors.UNSUPPORTED_INJECTION.exact.user.instruction.replacement.is.unverified",
      ),
    );
    await this.call("initialize", {
      clientInfo: { name: "bug_paw_relay", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.write({ method: "initialized", params: {} });
    const resolved = resolveRuntimeOptions("codex", session, this.config);
    const params: any = {
      ...(resolved.options.model ? { model: resolved.options.model } : {}),
      config: {
        "features.default_mode_request_user_input": true,
        ...(resolved.options.effort
          ? { model_reasoning_effort: resolved.options.effort }
          : {}),
      },
      cwd,
      approvalPolicy: session.permission === "full" ? "never" : "on-request",
      sandbox:
        session.permission === "full"
          ? "danger-full-access"
          : "workspace-write",
      developerInstructions: environmentInstructions(
        session,
        workflow,
        !!this.hooks.light,
      ),
    };
    const targets = workflowTargets(workflow);
    if (workflow && targets.length !== 0)
      params.dynamicTools = [
        {
          type: "function",
          name: "relay_handoff",
          description: handoffLabel("handoff.tool", workflow.locale),
          inputSchema: {
            type: "object",
            properties: {
              targetId: {
                type: "string",
                enum: targets,
              },
              record: { type: "string" },
              ...(workflow.allowArtifacts
                ? {
                    artifacts: {
                      type: "array",
                      maxItems: 16,
                      description:
                        "随交接上传的文件；相对路径以工作目录为基准。单件最多 128 MiB，总计 256 MiB。",
                      items: {
                        type: "object",
                        properties: {
                          path: { type: "string" },
                          name: { type: "string" },
                        },
                        required: ["path"],
                        additionalProperties: false,
                      },
                    },
                  }
                : {}),
            },
            required: ["targetId", "record"],
            additionalProperties: false,
          },
        },
      ];
    if (this.hooks.light) {
      params.dynamicTools ||= [];
      if (!workflow || workflow.allowArtifacts)
        params.dynamicTools.push({
          type: "function", name: "relay_light_docs", description: docsDescription,
          inputSchema: z.toJSONSchema(docsQuery, { io: "input" }),
        }, {
          type: "function",
          name: "relay_light_publish",
          description: publishDescription,
          inputSchema: z.toJSONSchema(publishInput, { io: "input" }),
        });
      if (!workflow || workflow.allowArtifacts)
        for (const tool of lifecycleTools)
          params.dynamicTools.push({
            type: "function", name: tool.name, description: tool.description,
            inputSchema: z.toJSONSchema(appTarget),
          });
      params.dynamicTools.push({
        type: "function",
        name: "relay_light_versions",
        description: versionsDescription,
        inputSchema: z.toJSONSchema(versionsQuery),
      });
      params.dynamicTools.push({
        type: "function",
        name: "relay_light_feedback",
        description: feedbackDescription,
        inputSchema: z.toJSONSchema(feedbackQuery),
      });
    }
    if (session.boardTools && this.hooks.board) {
      const tools = Object.entries(boardTools).map(([key, tool]) => ({
        name: "relay_board_" + key, description: tool.description,
        inputSchema: z.toJSONSchema(tool.schema, { io: "input" }) as any,
      }));
      if (nativeId && !session.nativeBoardTools) {
        const invoke = this.hooks.board;
        this.resumedBoardTools = await resumedLightTools(tools, (name, args, id) =>
          invoke(boardTool(name)!, args, "mcp:" + id));
        params.config["mcp_servers.relay_board"] = this.resumedBoardTools.config;
      } else {
        params.dynamicTools ||= [];
        params.dynamicTools.push(...tools.map(tool => ({ ...tool, type: "function" })));
      }
    }
    if (
      nativeId &&
      this.hooks.light &&
      session.nativeLightTools !==
        (!workflow || workflow.allowArtifacts ? "publish-v4" : "read-v2")
    ) {
      const call = this.hooks.light;
      const tools = params.dynamicTools
        .filter((t: any) => t.name.startsWith("relay_light_"))
        .map(({ type, ...t }: any) => t);
      this.resumedTools = await resumedLightTools(tools, (name, args, id) =>
        call(
          lightMethod(name),
          args,
          "mcp:" + id,
        ),
      );
      params.config["mcp_servers.relay_light"] = this.resumedTools.config;
    }
    const result = await this.call(
      nativeId ? "thread/resume" : "thread/start",
      { ...params, ...(nativeId ? { threadId: nativeId } : {}) },
    );
    this.hooks.event("runtime/config", {
      ...resolved,
      actual: { model: result.model, effort: result.reasoningEffort },
    });
    this.threadId = result.thread.id;
    this.hooks.native(this.threadId);
    message = nativeMentionText(message, mentions, "codex");
    const prompt = workflowPrompt(workflow, message, "codex");
    const turn = await this.call("turn/start", {
      ...(resolved.options.model ? { model: resolved.options.model } : {}),
      ...(resolved.options.effort ? { effort: resolved.options.effort } : {}),
      threadId: this.threadId,
      input: [
        { type: "text", text: prompt },
        ...mentions
          .filter((m) => m.kind === "skill")
          .map((m) => ({ type: "skill", name: m.name, path: m.path })),
      ],
    });
    this.turnId = turn.turn.id;
    if (!nativeId && session.initialSessionTitle)
      await confirmInitialTitle(this.hooks, session.initialSessionTitle, () =>
        this.renameThread(this.threadId, session.initialSessionTitle));
  }
  /** 模型及思考档位由当前 CLI 返回，不维护硬编码模型清单。 */
  catalogDefaultModel: string | undefined;
  async listModels(cwd: string) {
    await this.call("initialize", {
      clientInfo: { name: "bug_paw_relay_models", version: "0.1.0" },
    });
    this.write({ method: "initialized", params: {} });
    // 只保留默认模型字段，不将原生配置正文传出环境。
    try {
      this.catalogDefaultModel =
        (await this.call("config/read", { cwd, includeLayers: false })).config
          ?.model || undefined;
    } catch {
      /* 旧 CLI 不支持读取时由模型目录提供建议默认值。 */
    }
    const models: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await this.call("model/list", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (!this.catalogDefaultModel)
        this.catalogDefaultModel = result.data.find(
          (m: any) => m.isDefault,
        )?.model;
      models.push(
        ...result.data.map((m: any) => ({
          id: m.model || m.id,
          name: m.displayName || m.model || m.id,
          efforts: m.supportedReasoningEfforts?.map(
            (e: any) => e.reasoningEffort,
          ),
          defaultEffort: m.defaultReasoningEffort,
        })),
      );
      if (!result.nextCursor) return models;
      ensure(
        result.nextCursor !== cursor,
        "MODEL_PAGINATION",
        i18nMessage("errors.MODEL_PAGINATION.invalid.model.pagination"),
      );
      cursor = result.nextCursor;
    }
    throw new AppError(
      "TOO_MANY_MODELS",
      i18nMessage("connector.model.tooMany"),
    );
  }
  /** 原生发现只初始化 app-server，不创建线程、不请求模型。 */
  async listSkills(cwd: string): Promise<MentionItem[]> {
    await this.call("initialize", {
      clientInfo: { name: "bug_paw_relay_skills", version: "0.1.0" },
    });
    this.write({ method: "initialized", params: {} });
    const result = await this.call("skills/list", {
      cwds: [cwd],
      forceReload: true,
    });
    return (result.data || []).flatMap((entry: any) =>
      (entry.skills || [])
        .filter((s: any) => s.enabled !== false)
        .map((s: any) => ({
          kind: "skill",
          name: s.name,
          path: s.path,
          description: String(s.description || "").slice(0, 2000),
        })),
    );
  }
  /** 标题查询关闭回合正文，避免周期同步读取完整历史。 */
  async readStored(nativeId: string, includeTurns = true) {
    await this.call("initialize", {
      clientInfo: { name: "bug_paw_relay_history", version: "0.1.0" },
    });
    this.write({ method: "initialized", params: {} });
    this.threadId = nativeId;
    return this.call("thread/read", { threadId: nativeId, includeTurns });
  }
  /** 使用独立 app-server 修改已落盘线程，回读成功后才更新列表索引。 */
  async renameStored(nativeId: string, title: string) {
    await this.readStored(nativeId, false);
    await this.renameThread(nativeId, title);
  }
  private async renameThread(nativeId: string, title: string) {
    await this.call("thread/name/set", { threadId: nativeId, name: title });
    const result = await this.call("thread/read", { threadId: nativeId, includeTurns: false });
    ensure(result.thread?.name === title, "COMMAND_RENAME", i18nMessage("slash.renameFailed"));
  }
  async cancel() {
    this.cancelling = true;
    const waitingBetweenTurns = !this.turnId && this.asyncQuestions.size > 0;
    this.asyncQuestions.clear();
    if (waitingBetweenTurns) await this.answerQueue;
    if (waitingBetweenTurns && !this.turnId && !this.finished) {
      this.finished = true;
      this.hooks.done("cancelled");
      return;
    }
    // resolved 不携带取消原因，发出停止前将尚未确认的回执保守判为未知。
    for (const receipt of this.questionReceipts.values())
      receipt.reject(new Error("NATIVE_CANCELLED"));
    this.questionReceipts.clear();
    if (this.turnId)
      await this.call("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.turnId,
      });
  }
  async history() {
    return this.call("thread/read", {
      threadId: this.threadId,
      includeTurns: true,
    });
  }
  close() {
    this.finished = true;
    this.process.kill();
    // 宽限期后强制结束拒绝正常退出的原生进程。
    const timer = setTimeout(() => {
      if (this.process.exitCode === null && this.process.signalCode === null)
        this.process.kill("SIGKILL");
    }, 3000);
    timer.unref();
    this.process.once("exit", () => clearTimeout(timer));
  }
}
/** Claude SDK 只接收显式环境端凭据，禁止意外回退本机订阅登录。 */
export class ClaudeRuntime implements RuntimeHandle {
  private abort = new AbortController();
  private questionReceipts = new Map<
    string,
    { resolve: () => void; reject: (e: Error) => void }
  >();
  /** 原生失败或结束时不能把尚未确认的回答伪装成已接受。 */
  private rejectQuestionReceipts() {
    for (const receipt of this.questionReceipts.values())
      receipt.reject(new Error("RUNTIME_EXIT"));
    this.questionReceipts.clear();
  }
  private nativeId = "";
  private cwd = "";
  constructor(
    private hooks: RuntimeHooks,
    private config: any,
  ) {}
  async start(
    cwd: string,
    session: any,
    message: string,
    workflow: any,
    nativeId?: string,
    mentions: Mention[] = [],
  ) {
    ensure(
      this.config.apiKey && this.config.baseUrl,
      "CONFIG_REQUIRED",
      i18nMessage(
        workflow ? "connector.native.automation" : "errors.CONFIG_REQUIRED.configure.the.custom.claude.endpoint.and",
      ),
    );
    ensure(
      session.agent?.injection !== "replace",
      "UNSUPPORTED_INJECTION",
      i18nMessage(
        "errors.UNSUPPORTED_INJECTION.exact.user.instruction.replacement.is.unverified.detail2",
      ),
    );
    this.cwd = cwd;
    const env: Record<string, string | undefined> = {
      ...process.env,
      // 由连接器管理供应商，防止 Claude 用户配置覆盖请求端点和凭据。
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
      ANTHROPIC_BASE_URL: this.config.baseUrl,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
    };
    if (this.config.home) env.CLAUDE_CONFIG_DIR = this.config.home;
    if (this.config.authType === "bearer")
      env.ANTHROPIC_AUTH_TOKEN = this.config.apiKey;
    else env.ANTHROPIC_API_KEY = this.config.apiKey;
    const { query, createSdkMcpServer, tool: claudeTool } = await loadClaudeSdk();
    const targets = workflowTargets(workflow);
    const lightTools = [];
    if (session.boardTools && this.hooks.board) {
      const invoke = this.hooks.board;
      for (const [key, tool] of Object.entries(boardTools))
        lightTools.push(claudeTool("board_" + key, tool.description, tool.schema.shape as any, async (args, extra) => {
          const context = extra as { _meta?: Record<string, unknown>; requestId?: string | number };
          const id = context?._meta?.["claudecode/toolUseId"] ?? context?.requestId;
          ensure(typeof id === "number" || typeof id === "string", "INVALID_PARAMS", i18nMessage("common.failure"));
          const result = await invoke(key as BoardTool, args, String(id));
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }));
    }
    if (this.hooks.light) {
      const call = this.hooks.light;
      if (!workflow || workflow.allowArtifacts)
        lightTools.push(
          claudeTool("light_docs", docsDescription, docsQuery.shape, async args => ({
            content: [{ type: "text", text: JSON.stringify(await call("light.docs", args)) }],
          })),
          claudeTool(
            "light_publish",
            publishDescription,
            publishInput.shape,
            async (args, extra) => ({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    await call(
                      "light.publish",
                      args,
                      String(
                        (extra as { requestId?: string | number })?.requestId ??
                          randomUUID(),
                      ),
                    ),
                  ),
                },
              ],
            }),
          ),
        );
      if (!workflow || workflow.allowArtifacts)
        for (const tool of lifecycleTools)
          lightTools.push(claudeTool(tool.name.replace("relay_", ""), tool.description, appTarget.shape,
            async args => ({ content: [{ type: "text", text: JSON.stringify(await call(tool.method, args)) }] })));
      lightTools.push(
        claudeTool(
          "light_versions",
          versionsDescription,
          versionsQuery.shape,
          async (args) => ({
            content: [
              {
                type: "text",
                text: JSON.stringify(await call("light.versions", args)),
              },
            ],
          }),
        ),
        claudeTool(
          "light_feedback",
          feedbackDescription,
          feedbackQuery.shape,
          async (args) => ({
            content: [
              {
                type: "text",
                text: JSON.stringify(await call("light.feedback", args)),
              },
            ],
          }),
        ),
      );
    }
    const mcp =
      lightTools.length || (workflow && targets.length !== 0)
        ? createSdkMcpServer({
            name: "relay",
            tools: [
              ...lightTools,
              ...(workflow && targets.length
                ? [
                    claudeTool(
                      "handoff",
                      handoffLabel("handoff.tool", workflow.locale),
                      {
                        targetId: z.enum(targets as [string, ...string[]]),
                        record: z.string(),
                        ...(workflow.allowArtifacts
                          ? {
                              artifacts: z
                                .array(
                                  z
                                    .object({
                                      path: z.string().min(1).max(4096),
                                      name: z
                                        .string()
                                        .min(1)
                                        .max(255)
                                        .optional(),
                                    })
                                    .strict(),
                                )
                                .max(16)
                                .optional()
                                .describe(
                                  "随交接上传的文件，相对工作目录；单件 128 MiB，总计 256 MiB",
                                ),
                            }
                          : {}),
                      },
                      async (args) => ({
                        content: [
                          {
                            type: "text",
                            text: JSON.stringify(
                              await this.hooks.handoff(args),
                            ),
                          },
                        ],
                      }),
                    ),
                  ]
                : []),
            ],
          })
        : undefined;
    message = nativeMentionText(message, mentions, "claude");
    const prompt = workflowPrompt(workflow, message, "claude");
    const resolved = resolveRuntimeOptions("claude", session, this.config);
    if (resolved.options.effort)
      env.CLAUDE_CODE_EFFORT_LEVEL = resolved.options.effort;
    this.hooks.event("runtime/config", { ...resolved, actual: {} });
    const stream = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: hostCli("claude", this.config),
        cwd,
        env,
        // 恢复原生会话时省略 model 会沿用旧覆盖；default 显式回到 CLI 默认模型。
        model: resolved.options.model || "default",
        effort: resolved.options.effort as any,
        thinking: resolved.options.thinking || undefined,
        abortController: this.abort,
        resume: nativeId,
        title: nativeId ? undefined : session.initialSessionTitle,
        includePartialMessages: true,
        settingSources: ["user", "project", "local"],
        permissionMode:
          session.permission === "full" ? "bypassPermissions" : "default",
        allowDangerouslySkipPermissions: session.permission === "full",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: environmentInstructions(
            session,
            workflow,
            !!this.hooks.light,
          ),
        },
        mcpServers: mcp ? { relay: mcp } : {},
        // 原生前置钩子只要求提问回到人工回调，不在有时限的 hook 内等待回答。
        hooks: {
          PreToolUse: [
            {
              matcher: "AskUserQuestion",
              onFailure: "block",
              hooks: [
                async () => ({
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "ask",
                  },
                }),
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "AskUserQuestion",
              hooks: [
                async (_event, id) => {
                  if (id) {
                    this.questionReceipts.get(id)?.resolve();
                    this.questionReceipts.delete(id);
                  }
                  return {};
                },
              ],
            },
          ],
          PostToolUseFailure: [
            {
              matcher: "AskUserQuestion",
              hooks: [
                async (_event, id) => {
                  if (id) {
                    this.questionReceipts
                      .get(id)
                      ?.reject(new Error("NATIVE_QUESTION_FAILED"));
                    this.questionReceipts.delete(id);
                  }
                  return {};
                },
              ],
            },
          ],
        },
        canUseTool: async (name, input, context) => {
          // 写操作由服务端生成业务审批，仅放行当前 SDK 自己注册的看板工具。
          const platformBoardTool = session.boardTools &&
            context.mcpServer?.source === "sdk" && context.mcpServer.name === "relay" &&
            name.startsWith("mcp__relay__board_") && boardTool(name.replace("mcp__relay__", "relay_"));
          if (name === "mcp__relay__handoff" || platformBoardTool)
            return { behavior: "allow", updatedInput: input };
          return new Promise((resolve) => {
            const id = context.toolUseID || randomUUID();
            const abort = () => {
              this.hooks.event("serverRequest/resolved", { requestId: id });
              this.questionReceipts
                .get(id)
                ?.reject(new Error("NATIVE_CANCELLED"));
              this.questionReceipts.delete(id);
              resolve({
                behavior: "deny",
                message: "请求已取消 / Request cancelled",
              });
            };
            if (context.signal.aborted) {
              abort();
              return;
            }
            context.signal.addEventListener("abort", abort, { once: true });
            // 缺少原生工具编号时，交互仍可答复，但不能把临时编号当作工具归属。
            const params = context.toolUseID ? { input, itemId: context.toolUseID } : { input };
            this.hooks.interaction(id, name, params, (answer) => {
              context.signal.removeEventListener("abort", abort);
              // PostToolUse 确认原调用已消费 updatedInput 后才返回已回答。
              const receipt =
                name === "AskUserQuestion"
                  ? new Promise<void>((resolve, reject) =>
                      this.questionReceipts.set(id, { resolve, reject }),
                    )
                  : undefined;
              resolve(
                answer.approve
                  ? {
                      behavior: "allow",
                      updatedInput: answer.updatedInput || input,
                    }
                  : { behavior: "deny", message: "用户拒绝" },
              );
              return receipt;
            });
          });
        },
      },
    });
    void (async () => {
      try {
        for await (const event of stream) {
          if ("session_id" in event && event.session_id) {
            this.nativeId = event.session_id;
            this.hooks.native(this.nativeId);
          }
          // SDK 在初始化时设置标题，首轮结束时记录已落盘，可回读并兼容忽略初始标题的 CLI。
          if (event.type === "result" && !nativeId && session.initialSessionTitle) {
            const title = session.initialSessionTitle;
            await confirmInitialTitle(this.hooks, title, async () => {
              const info = await (await loadClaudeSdk()).getSessionInfo(this.nativeId, { dir: cwd });
              if (info?.customTitle !== title) await renameClaudeSession(this.nativeId, cwd, title);
            });
          }
          if (event.type === "system" && event.subtype === "init")
            this.hooks.event("runtime/config", {
              ...resolved,
              actual: { model: event.model },
            });
          this.hooks.event(event.type, event);
          if (event.type === "result") {
            this.rejectQuestionReceipts();
            this.hooks.done(
              event.subtype === "success" && !event.is_error ? "completed" : "failed",
            );
          }
        }
      } catch {
        this.rejectQuestionReceipts();
        this.hooks.done(this.abort.signal.aborted ? "cancelled" : "failed");
      }
    })();
  }
  async cancel() {
    this.abort.abort();
    this.rejectQuestionReceipts();
  }
  async history() {
    return (await loadClaudeSdk()).getSessionMessages(this.nativeId, { dir: this.cwd });
  }
  close() {
    this.abort.abort();
    this.rejectQuestionReceipts();
  }
}

/** 查询原生 Skill 清单：等待 SDK 初始化，但不提交用户消息或触发模型生成。 */
export async function discoverSkills(
  runtime: "codex" | "claude",
  cwd: string,
  config: any,
): Promise<MentionItem[]> {
  if (runtime === "codex") {
    const handle = new CodexRuntime(
      {
        event() {},
        native() {},
        interaction() {},
        done() {},
        handoff: async () => ({}),
      },
      config,
    );
    const timer = setTimeout(() => handle.close(), 12000);
    try {
      return await handle.listSkills(cwd);
    } finally {
      clearTimeout(timer);
      handle.close();
    }
  }
  const commands = await discoverClaudeCommands(cwd, config);
  return commands
    .filter(
      (s) =>
        !s.builtin && !commands.some((b) => b.builtin && b.name === s.name),
    )
    .map((s) => ({
      kind: "skill",
      name: s.name,
      path: s.name,
      description: s.description.slice(0, 2000),
    }));
}

/** 返回 SDK 的原始来源标记与别名，供斜杠命令按当前目录解析。 */
export async function discoverClaudeCommands(cwd: string, config: any) {
  const { query } = await loadClaudeSdk();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  // 空输入流保持进程等待，枚举完成后立即关闭，避免产生空白模型调用。
  async function* idle(): AsyncGenerator<any> {
    await new Promise<void>((resolve) => {
      if (controller.signal.aborted) resolve();
      else
        controller.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
    });
  }
  const env = {
    ...process.env,
    ...(config.home ? { CLAUDE_CONFIG_DIR: config.home } : {}),
    // 由连接器管理供应商，防止 Claude 用户配置覆盖请求端点和凭据。
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
    ANTHROPIC_BASE_URL: config.baseUrl,
    ANTHROPIC_API_KEY: config.authType === "bearer" ? "" : config.apiKey || "",
    ANTHROPIC_AUTH_TOKEN:
      config.authType === "bearer" ? config.apiKey || "" : "",
    CLAUDE_CODE_OAUTH_TOKEN: "",
  };
  const stream = query({
    prompt: idle(),
    options: {
      pathToClaudeCodeExecutable: hostCli("claude", config),
      cwd,
      env,
      settingSources: ["user", "project", "local"],
      abortController: controller,
      persistSession: false,
    },
  });
  try {
    return await stream.supportedCommands();
  } finally {
    clearTimeout(timer);
    controller.abort();
    stream.close();
  }
}
