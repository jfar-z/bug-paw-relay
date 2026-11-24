import { boardCapability } from "../shared/session-boards.js";
import { systemLocale } from "../shared/system-locale.js";
import { preference, translate, type Locale } from "../shared/i18n.js";
import { message as i18nMessage } from "../shared/i18n.js";
import { autoApprovalCapability, ensurePermissionAllowed } from "../shared/permission-policy.js";
import { itemCreationError } from "../shared/work-item-creation.js";
import { numberStages } from "./stage-numbering.js";
import {
  boardSessionTitleCapability,
  handoffCapability,
  attachmentHistoryText,
  handoffLabel,
  handoffError,
  readHandoff,
  handoffProjection,
  stageDescriptor,
} from "../shared/stage-handoff.js";
import { updateTerminal } from "../shared/connector-update.js";
import {
  runtimeOptionsSchema,
  hasRuntimeOptions,
} from "../shared/runtime-options.js";
import { agentSupportsRuntime } from "../shared/contracts.js";
import {
  attachmentsSchema,
  uploadCapability,
  type Attachment,
} from "../shared/uploads.js";
import { validMentions, type Mention } from "../shared/mentions.js";
import { sessionDisplay } from "../shared/session-display.js";
import { connectorUpdate, type ConnectorRelease } from "./connector-release.js";
import { compareSessionActivity } from "../shared/session-order.js";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "./store.js";
import { Vault, digest } from "./security.js";
import {
  AppError,
  ensure,
  agentSchema,
  permissionSchema,
  boardSchema,
  boardTitleUpdateSchema,
  cliRuntimeSchema,
  type CliRuntime,
  idSchema,
  stageSchema,
  projectSchema,
  modelSchema,
  sessionSchema,
  workItemSchema,
  workItemEditSchema,
  type Entity,
  type Session,
  type Board,
  type Stage,
} from "../shared/contracts.js";
import type { RpcPeer } from "../shared/rpc.js";
export type Execution = {
  id: string;
  item_id: string | null;
  session_id: string;
  environment_id: string;
  state: string;
  snapshot: string;
  created_at: string;
};
export interface BoardAttachmentBatch {
  receipt: string;
  bind(
    boardId: string,
    stageId: string,
    operationId?: string,
    itemId?: string,
    editVersion?: number,
  ): Array<
    Attachment & {
      environmentId: string;
      environmentName: string;
      rootId: string;
      relativePath: string;
      cwd: string;
    }
  >;
}
/** 从完成阶段反向遍历，回环和重新进入阶段都按普通流转处理。 */
function stagesReachingDone(stages: Stage[]) {
  const pending = [stages.find((stage) => stage.type === "done")!.id];
  const reachable = new Set(pending);
  while (pending.length) {
    const target = pending.pop()!;
    for (const stage of stages) {
      if (!reachable.has(stage.id) && stage.targets.includes(target)) {
        reachable.add(stage.id);
        pending.push(stage.id);
      }
    }
  }
  return reachable;
}

/** 所有用户界面与平台工具复用的业务入口。环境正文只经 RPC 临时返回。 */
export class Service {
  peers = new Map<string, RpcPeer>();
  updateView?: (id: string) => any;
  /** 所有执行入口共用持久化维护锁，看板等待不占并发名额。 */
  updating(id: string) {
    return this.store
      .list("connectorUpdates")
      .some((o) => o.environmentId === id && !updateTerminal(o.state));
  }
  /** 只转发给在线页面，不在服务端保存环境正文。 */
  sessionEvents = new EventEmitter().setMaxListeners(0);

  /** 置顶只修改服务端列表索引，重复请求保留已确认的顺序。 */
  setSessionPinned(id: string, pinned: boolean) {
    return this.store.transaction(() => {
      const session = this.store.get<Session>("sessions", id);
      ensure(!session.archived, "ARCHIVED", i18nMessage("errors.ARCHIVED.restore.the.archived.session.first"), 409);
      let pinOrder = session.pinOrder ?? null;
      if (pinned === (pinOrder !== null)) return { id, pinOrder };

      if (pinned) {
        // 归档会话也占用原序号，恢复后仍能回到原来的位置。
        const row = this.store.db.prepare(
          "SELECT COALESCE(MAX(json_extract(body, '$.pinOrder')), 0) + 1 AS nextOrder FROM entities WHERE kind='sessions'",
        ).get() as { nextOrder: number };
        pinOrder = row.nextOrder;
      } else {
        pinOrder = null;
      }
      this.store.put("sessions", { pinOrder }, id);
      return { id, pinOrder };
    });
  }

  /** 批量操作先完整校验再提交，任何忙碌会话都会阻止整批变更。 */
  manageSessions(ids: string[], action: "delete" | "archive" | "restore") {
    const unique = [...new Set(ids)];
    this.store.transaction(() => {
      for (const id of unique) {
        const session = this.store.get("sessions", id);
        const active = this.store.db
          .prepare(
            "SELECT id FROM executions WHERE session_id=? AND state IN ('queued','dispatching','running','waiting','unknown','stopping')",
          )
          .get(id);
        ensure(
          !active &&
            ![
              "queued",
              "dispatching",
              "running",
              "waiting",
              "unknown",
              "stopping",
            ].includes(session.status),
          "BUSY",
          i18nMessage("errors.BUSY.selected.sessions.are.running.or.waiting"),
          409,
        );
      }
      for (const id of unique) {
        if (action === "delete") {
          // 执行与交接账本仍保留关联 ID；索引物理删除后不再接受迟到事件重建。
          this.store.remove("sessions", id);
          this.store.db.prepare("DELETE FROM operations WHERE scope=?").run(id);
        } else
          this.store.put("sessions", { archived: action === "archive" }, id);
      }
    });
    for (const id of unique)
      this.sessionEvents.emit(id, {
        type: action === "delete" ? "deleted" : "metadata",
      });
    return { ok: true, ids: unique };
  }

  /** 仅同步已登记会话的环境标题，禁止重建已删除索引。 */
  syncSessionTitle(sessionId: string, title: unknown) {
    if (typeof title !== "string" || !title.trim()) return;
    const session = this.store.list("sessions").find((s) => s.id === sessionId);
    const normalized = title.trim().slice(0, 200);
    if (session && session.title !== normalized) {
      this.store.put("sessions", { title: normalized }, sessionId);
      this.sessionEvents.emit(sessionId, {
        type: "metadata",
        title: normalized,
      });
    }
  }

  /** 原生读取可能较慢；页面先订阅增量，历史仅用于初始化及重连对账。 */
  async sessionHistory(id: string) {
    const session = this.store.get("sessions", id);
    const history = await this.peer(session.environmentId).call(
      "session.history",
      { sessionId: id },
    );
    this.syncSessionTitle(id, history.title);
    // 读取期间执行状态可能变化，使用服务端当前索引状态，不能被旧快照回退。
    const current = this.store.get("sessions", id);
    // 兼容没有事件时间的连接器，以平台执行账本提供会话时间线的时间边界。
    const executionStarts = this.store.db
      .prepare("SELECT id, created_at AS createdAt, json_extract(snapshot,'$.boardIds') AS boardIds FROM executions WHERE session_id=?")
      .all(id);
    return {
      ...sessionDisplay(history),
      executionStarts: executionStarts.map(({ id, createdAt, boardIds }) => ({ id, createdAt,
        ...(typeof boardIds === "string" ? { boardIds: JSON.parse(boardIds) } : {}) })),
      ...(history.boardCards ? { boardCards: history.boardCards } : {}),
      // 问答契约是纯文本结构，必须逐字回显，不能套用工具日志的长编码裁剪。
      ...(history.questionRecords
        ? { questionRecords: history.questionRecords }
        : {}),
      status: current.status,
    };
  }

  /** 已发出自动批准的交互，同一请求只发送一次决定。 */
  private autoApproved = new Map<string, Set<string>>();
  private manualApprovals = new Map<string, Set<string>>();
  /**
   * 自动审批执行下，连接器明确标注为工具权限审批的交互由服务端批准一次，
   * 并从发给浏览器的待处理列表中剔除；其余交互原样保留。
   */
  private autoApprove(execution: Execution, interactions: any[]) {
    const snapshot = JSON.parse(execution.snapshot);
    if (snapshot.permission !== "auto") return interactions;
    const peer = this.peers.get(execution.environment_id);
    if (!peer) return interactions;
    const decided = this.autoApproved.get(execution.id) ?? new Set<string>();
    this.autoApproved.set(execution.id, decided);
    const remaining: any[] = [];
    for (const item of interactions) {
      if (this.manualApprovals.get(execution.id)?.has(item.id) || item.executionId !== execution.id || item.question || item.approval?.kind !== "permission") {
        remaining.push(item);
        continue;
      }
      if (decided.has(item.id)) continue;
      decided.add(item.id);
      peer
        .call("interaction.answer", {
          executionId: execution.id,
          interactionId: item.id,
          answer: item.approval.answer,
          decisionSource: "policy",
        })
        .catch((error: any) => {
          // 请求已过期或被处理则无需恢复；其他送达失败恢复为待人工处理。
          if (error?.code === "STALE_INTERACTION") return;
          if (this.autoApproved.get(execution.id) !== decided) return;
          const current = this.store.findBy("sessions", "executionId", execution.id)[0];
          if (!current || current.status !== "waiting") return;
          const manual = this.manualApprovals.get(execution.id) ?? new Set<string>();
          manual.add(item.id);
          this.manualApprovals.set(execution.id, manual);
          this.sessionEvents.emit(execution.session_id, {
            type: "update",
            executionId: execution.id,
            interactions: interactions.filter(i => !decided.has(i.id) || manual.has(i.id)),
          });
        });
    }
    return remaining;
  }

  /** 校验节点归属后转发增量；删除后到达的通知不能恢复会话。 */
  sessionEvent(environmentId: string, data: any) {
    const execution = this.execution(data.executionId);
    ensure(
      execution.environment_id === environmentId,
      "SCOPE",
      i18nMessage("errors.SCOPE.the.execution.environment.does.not.match"),
      403,
    );
    if (!this.store.list("sessions").some((s) => s.id === execution.session_id))
      return;
    const stateAccepted =
      !data.status ||
      this.setState(execution.id, data.status, data.stateVersion) !== false;
    this.syncSessionTitle(execution.session_id, data.title);
    const session = this.store.get("sessions", execution.session_id);
    // 旧连接器也在服务端投影后再发给浏览器，升级前避免图片进入 SSE。
    const { status, interactions: all, ...rest } = sessionDisplay(data);
    const interactions = all && session.executionId === execution.id && stateAccepted &&
      !["completed", "failed", "cancelled"].includes(session.status)
      ? this.autoApprove(execution, all)
      : all;
    this.sessionEvents.emit(execution.session_id, {
      ...rest,
      ...(data.questionRecords
        ? { questionRecords: data.questionRecords }
        : {}),
      type: "update",
      ...(session.executionId === execution.id && stateAccepted
        ? {
            status: session.status,
            ...(interactions ? { interactions } : {}),
          }
        : {}),
    });
  }
  constructor(
    public store: Store,
    public vault: Vault,
    private connectorRelease: ConnectorRelease | null = null,
  ) {}
  /** 已保存的项按配置排列，新项按原创建顺序追加，删除项自然跳过。 */
  private orderedEntities(entities: Entity[], savedIds: string[]): Entity[] {
    const remaining = new Map(entities.map((entity) => [entity.id, entity]));
    const ordered: Entity[] = [];
    for (const id of savedIds) {
      const entity = remaining.get(id);
      if (entity) {
        ordered.push(entity);
        remaining.delete(id);
      }
    }
    return ordered.concat(Array.from(remaining.values()));
  }

  sessionProjectIds(projects: Entity[]): string[] {
    const saved = this.store.list("sessionProjectOrder")[0]?.projectIds ?? [];
    return this.orderedEntities(projects, saved).map((project) => project.id);
  }

  /** 在同一写事务内核对全量成员和保存顺序，避免覆盖期间发生的增删。 */
  private validateOrder(current: string[], ids: string[]) {
    const requested = new Set(ids);
    ensure(
      requested.size === ids.length && current.length === ids.length &&
        current.every((id) => requested.has(id)),
      "CONFLICT",
      i18nMessage("errors.CONFLICT.the.data.has.changed.refresh.and"),
      409,
    );
  }

  saveSessionProjectOrder(projectIds: string[]) {
    return this.store.transaction(() => {
      const current = this.sessionProjectIds(this.store.list("projects"));
      this.validateOrder(current, projectIds);
      if (current.some((id, index) => id !== projectIds[index]))
        this.store.put("sessionProjectOrder", { projectIds }, "session-project-order");
      return { projectIds };
    });
  }

  private orderedAgents(): Entity[] {
    const saved = this.store.list("agentOrder")[0]?.agentIds ?? [];
    return this.orderedEntities(this.store.list("agents"), saved);
  }

  saveAgentOrder(agentIds: string[]) {
    return this.store.transaction(() => {
      const current = this.orderedAgents().map((agent) => agent.id);
      this.validateOrder(current, agentIds);
      if (current.some((id, index) => id !== agentIds[index]))
        this.store.put("agentOrder", { agentIds }, "agent-order");
      return { agentIds };
    });
  }
  /** 旧环境没有策略字段，沿用原有两项 CLI。连接器每次重报只更新 tools。 */
  private enabledRuntimes(env: Entity): CliRuntime[] {
    return env.enabledRuntimes ?? cliRuntimeSchema.options;
  }
  requireEnabledRuntime(env: Entity, runtime: CliRuntime) {
    ensure(
      this.enabledRuntimes(env).includes(runtime),
      "CLI_DISABLED",
      i18nMessage("errors.CLI_DISABLED.environment"),
      409,
    );
  }
  runtimeSettings(env: Entity) {
    return { enabledRuntimes: this.enabledRuntimes(env), tools: env.tools ?? {} };
  }
  setRuntimeEnabled(id: string, runtime: CliRuntime, enabled: boolean) {
    const env = this.store.get("environments", id);
    const previous = this.enabledRuntimes(env);
    if (previous.includes(runtime) === enabled) return this.runtimeSettings(env);
    const enabledRuntimes = cliRuntimeSchema.options.filter((r) =>
      r === runtime ? enabled : previous.includes(r),
    );
    return this.runtimeSettings(this.store.put("environments", { enabledRuntimes }, id));
  }
  /** 同一快照内共用索引和工作项状态，保持库中顺序，不跨请求缓存。 */
  stateSnapshot() {
    const projects = this.list("projects");
    const boards = this.store.list<Board>("boards");
    const sessions = this.list("sessions");
    const environments = this.list("environments");
    const records = this.store.list("items");
    // 主键索引只取当前工作项引用的执行，避免读取无关的历史执行快照。
    const executions = this.store.db.prepare(`
      SELECT * FROM executions WHERE id IN (
        SELECT json_extract(body, '$.executionId') FROM entities WHERE kind='items'
      )
    `).all() as unknown as Execution[];
    const refs = {
      boards: new Map(boards.map(b => [b.id, b])),
      sessions: new Map(sessions.map(s => [s.id, s])),
      environments: new Map(environments.map(e => [e.id, e])),
      executions: new Map(executions.map(e => [e.id, e])),
    };
    const items = records.map(item => this.itemStatus(item, refs));
    const boardItems = new Map(boards.map(b => [b.id, [] as typeof items]));
    for (const item of items) {
      if (!item.archived) boardItems.get(item.boardId)?.push(item);
    }
    return {
      projects, agents: this.list("agents"),
      boards: boards.map(board => this.boardSummary(board, boardItems.get(board.id)!)),
      items, handoffs: this.list("handoffs"), environments, sessions, models: this.list("models"),
      sessionProjectIds: this.sessionProjectIds(projects),
    };
  }

  /** 看板列表与全量快照使用相同的待处理及同步状态计算。 */
  private boardSummary(board: Entity, items: ReturnType<Service["itemStatus"]>[]) {
    return {
      ...board,
      pendingCount: items.filter(item => item.needsAttention).length,
      syncStatus: items.some(item => item.syncStatus === "pending") ? "pending" : "synced",
    };
  }
  list(kind: string): Entity[] {
    if (kind === "boards")
      return this.store.list(kind).map((board) => {
        const items = this.store
          .list("items")
          .filter((item) => item.boardId === board.id && !item.archived)
          .map((item) => this.itemStatus(item));
        return this.boardSummary(board, items);
      });
    if (kind === "items")
      return this.store.list(kind).map((item) => this.itemStatus(item));
    if (kind === "agents")
      return this.orderedAgents().map((agent) => ({
        ...agent,
        defaultPermission: permissionSchema.parse(
          agent.defaultPermission ?? "ask",
        ),
      }));
    if (kind === "sessions") {
      return this.store
        .list(kind)
        .map((session) => ({
          ...session,
          pinOrder: session.pinOrder ?? null,
          lastUserMessageAt: session.lastUserMessageAt ?? null,
        }))
        .sort(compareSessionActivity);
    }
    return this.store.list(kind).map((v) =>
      kind === "models"
        ? this.publicModel(v)
        : kind === "environments"
          ? {
              ...v,
              enabledRuntimes: this.enabledRuntimes(v),
              tools: Object.fromEntries(this.enabledRuntimes(v)
                .filter((runtime) => Object.hasOwn(v.tools ?? {}, runtime))
                .map((runtime) => [runtime, v.tools[runtime]])),
              online: this.peers.has(v.id),
              connectorUpdate: {
                ...connectorUpdate(
                  v.connectorVersion,
                  v.platform,
                  this.connectorRelease,
                ),
                ...this.updateView?.(v.id),
              },
            }
          : v,
    );
  }
  /** 从当前阶段与执行推导提醒；未知状态保留最后可核实的原因。 */
  /** 按看板读取页面使用的状态，仅返回当前仍存在的阶段会话入口。 */
  workbenchItems(boardId: string, itemId: string | null) {
    const board = this.store.get("boards", boardId);
    const records = itemId ? [this.store.get("items", itemId)] : this.store.findBy("items", "boardId", boardId);
    return records.map((record) => {
      ensure(record.boardId === boardId, "TOOL_SCOPE", i18nMessage("errors.NOT_FOUND.record.not.found"), 403);
      const item = this.itemStatus(record);
      const stage = board.stages.find((stage: any) => stage.id === record.stageId);
      const session = record.executionId && this.store.findBy("sessions", "executionId", record.executionId)[0];
      return {
        itemId: record.id, title: record.title, archived: !!record.archived,
        stageId: record.stageId, stageName: stage?.name, stageType: stage?.type,
        status: item.status, syncStatus: item.syncStatus, needsAttention: item.needsAttention,
        attentionReasons: item.attentionReasons, waitingReason: item.waitingReason,
        executionId: record.executionId ?? null, sessionUrl: session ? "/#chat/" + session.id : null,
      };
    });
  }

  private itemStatus(item: Entity, refs?: {
    boards: Map<string, Board>; sessions: Map<string, Entity>;
    environments: Map<string, Entity>; executions: Map<string, Execution>;
  }): Entity & { needsAttention: boolean; syncStatus: string } {
    const board = refs?.boards.get(item.boardId) ?? this.store.get<Board>("boards", item.boardId);
    const stage = board.stages.find((s) => s.id === item.stageId);
    const execution = item.executionId
      ? refs?.executions.get(item.executionId) ?? this.execution(item.executionId)
      : null;
    const session =
      execution &&
      (refs ? refs.sessions.get(execution.session_id) : this.store.list("sessions").find((s) => s.id === execution.session_id));
    // 归档记录仅供历史查看，不再参与同步状态判断。
    const unresolved =
      !item.archived &&
      stage?.type === "agent" &&
      (!execution ||
        !session ||
        session.executionId !== execution.id ||
        !this.peers.has(execution.environment_id) ||
        item.status === "unknown");
    const status =
      item.status === "unknown"
        ? item.lastKnownStatus || "unknown"
        : item.status;
    const queuedEnvironment = execution?.state === "queued"
      ? refs?.environments.get(execution.environment_id) ?? this.store.get("environments", execution.environment_id)
      : null;
    const blockedByRuntime = queuedEnvironment && session &&
      !this.enabledRuntimes(queuedEnvironment).includes(session.runtime);
    const reasons =
      item.archived || stage?.type === "done"
        ? []
        : stage?.type === "human"
          ? ["human_waiting"]
          : status === "waiting"
            ? ["interaction_required"]
            : status === "failed"
              ? ["execution_failed"]
              : status === "completed"
                ? ["ended_without_handoff"]
                : [];
    const requiredCapability = queuedEnvironment && session?.permission === "auto" &&
      !queuedEnvironment.capabilities?.includes(autoApprovalCapability) ? autoApprovalCapability : handoffCapability;
    if (blockedByRuntime && !item.archived) reasons.push("cli_disabled");
    return {
      ...item,
      status,
      ...(queuedEnvironment && !blockedByRuntime && execution &&
      JSON.parse(execution.snapshot).handoffContractVersion === 2 &&
      !queuedEnvironment.capabilities?.includes(requiredCapability)
        ? {
            waitingReason: "connector_upgrade_required",
            requiredCapability,
          }
        : {}),
      ...(blockedByRuntime ? { waitingReason: "cli_disabled" } : {}),
      attentionReasons: reasons,
      needsAttention: reasons.length > 0,
      syncStatus: unresolved ? "pending" : "synced",
    };
  }

  /** 仅当前阶段实例的精确会话可以续接，重入阶段产生不同会话。 */
  private currentItem(sessionId: string) {
    return this.store.list("items").find((item) => {
      if (item.archived || !item.executionId) return false;
      const execution = this.execution(item.executionId);
      const board = this.store.get<Board>("boards", item.boardId);
      return (
        execution.session_id === sessionId &&
        execution.item_id === item.id &&
        board.stages.some(
          (stage) => stage.id === item.stageId && stage.type === "agent",
        )
      );
    });
  }

  /** 诊断只保留标识和状态，不记录回答、输出或凭据；有界保留最近 1000 条。 */
  private stateAudit(
    execution: Execution,
    before: string,
    after: string,
    outcome: string,
  ) {
    if (!execution.item_id) return;
    const snapshot = JSON.parse(execution.snapshot);
    const reason = (state: string) =>
      state === "waiting"
        ? ["interaction_required"]
        : state === "failed"
          ? ["execution_failed"]
          : state === "completed"
            ? ["ended_without_handoff"]
            : [];
    this.store.put("board_state_changes", {
      itemId: execution.item_id,
      stageId: snapshot.stage?.id,
      sessionId: execution.session_id,
      executionId: execution.id,
      operationId: snapshot.continuation?.operationId || execution.id,
      before,
      after,
      beforeReasons: reason(before),
      afterReasons: reason(after),
      outcome,
    });
    const rows = this.store.list("board_state_changes");
    for (const row of rows.slice(0, Math.max(0, rows.length - 1000)))
      this.store.remove("board_state_changes", row.id);
  }

  publicModel(v: Entity) {
    const { secret, ...rest } = v;
    return { ...rest, hasKey: !!secret };
  }
  /** 在新执行入队前重新读取配置；已经入队的执行继续使用已保存的快照。 */
  private requireStageAgent(stage: Stage) {
    const environment = this.store.get("environments", stage.environmentId!);
    this.requireEnabledRuntime(environment, stage.runtime);
    const agent = stage.agentId
      ? this.store.findBy("agents", "id", stage.agentId)[0]
      : undefined;
    const message = i18nMessage("board.stageAgentInvalid", {
      stage: [stage.shortId, stage.name].filter(Boolean).join(" · "),
    });
    ensure(agent, "STAGE_AGENT_INVALID", message);
    ensure(!agent.environmentId || agent.environmentId === environment.id, "AGENT_SCOPE", message);
    ensure(agentSupportsRuntime(agent, stage.runtime), "AGENT_RUNTIME", message);
    return agent;
  }
  validateReferences(kind: string, data: any, previous?: Entity) {
    if (kind === "projects")
      for (const d of data.directories)
        this.store.get("environments", d.environmentId);
    if (kind === "agents" && data.environmentId) {
      const env = this.store.get("environments", data.environmentId);
      // 已保存的完全权限保留原值；仅新设置或改选时对已知 root Claude 拒绝。
      if (previous?.defaultPermission !== data.defaultPermission)
        ensurePermissionAllowed(data.defaultPermission, data.supportedRuntimes, env);
    }
    if (kind === "boards") {
      const project = this.store.get("projects", data.projectId);
      for (const s of data.stages)
        if (s.type === "agent") {
          ensure(
            s.runtime !== "codex" || !s.runtimeOptions?.thinking,
            "UNSUPPORTED_THINKING",
            i18nMessage(
              "errors.UNSUPPORTED_THINKING.codex.does.not.support.claude.thinking",
            ),
          );
          ensure(
            project.directories.some(
              (d: any) =>
                d.environmentId === s.environmentId &&
                d.rootId === s.rootId &&
                d.relativePath === s.relativePath,
            ),
            "DIRECTORY_MISMATCH",
            i18nMessage(
              "errors.DIRECTORY_MISMATCH.the.stage.directory.must.belong.to",
            ),
          );
          // 存量阶段可单独修复；仅改名、连线或权限时保留原执行配置。
          const old = previous?.stages.find((stage: Stage) => stage.id === s.id);
          if (old?.permission !== s.permission)
            ensurePermissionAllowed(
              s.permission,
              [s.runtime],
              this.store.get("environments", s.environmentId),
            );
          if (old?.type !== "agent" || old.environmentId !== s.environmentId ||
              old.rootId !== s.rootId || old.relativePath !== s.relativePath ||
              old.runtime !== s.runtime || (old.agentId ?? null) !== s.agentId)
            this.requireStageAgent(s);
        }
    }
  }
  /** 原子修改标题，不校验或回写旧流程引用，也不触发执行调度。 */
  renameBoard(id: string, input: unknown): Entity {
    idSchema.parse(id);
    const { name, version } = boardTitleUpdateSchema.parse(input);
    return this.store.transaction(() => {
      const board = this.store.get("boards", id);
      ensure(
        board.version === version,
        "CONFLICT",
        i18nMessage("errors.CONFLICT.the.board.has.changed.review.the"),
        409,
      );
      // 相同名称不制造新版本；旧版本即使同名也必须先处理冲突。
      if (board.name === name) return board;
      return this.store.put("boards", { name }, id, version);
    });
  }
  private inFlightItems(board: Board) {
    const done = board.stages.find((stage) => stage.type === "done")!;
    return this.store.list("items").filter((item) =>
      item.boardId === board.id && !item.archived && item.stageId !== done.id,
    );
  }

  /** 占用阶段用于编辑提示，最终保护条件在保存事务中重新计算。 */
  boardEditability(id: string) {
    const board = this.store.get<Board>("boards", id);
    const items = this.inFlightItems(board);
    return {
      version: board.version,
      editable: !board.archived,
      blockingItemCount: items.length,
      occupiedStageIds: [...new Set(items.map((item) => item.stageId as string))],
    };
  }

  /** 精确计算删除阶段影响；同一记录及产物仅计数一次。 */
  private flowImpact(id: string, input: any) {
    const board = this.store.get<Board>("boards", id);
    const data = boardSchema.parse(input);
    const deletedStages = board.stages
      .filter((stage) => !data.stages.some((next) => next.id === stage.id))
      .map(({ id, name }) => ({ id, name }));
    const deleted = new Set(deletedStages.map((stage) => stage.id));
    const items = new Set(
      this.store
        .list("items")
        .filter((item) => item.boardId === id)
        .map((item) => item.id),
    );
    const handoffs = this.store
      .list("handoffs")
      .filter(
        (record) =>
          items.has(record.itemId) &&
          (deleted.has(record.from) || deleted.has(record.to)),
      );
    const handoffIds = handoffs.map((record) => record.id).sort();
    const artifactIds = [
      ...new Set(
        handoffs.flatMap((record) =>
          (record.artifacts || []).map((artifact: any) => artifact.id),
        ),
      ),
    ].sort();
    const summary = {
      deletedStages,
      affectedItemCount: new Set(handoffs.map((record) => record.itemId)).size,
      handoffCount: handoffIds.length,
      artifactCount: artifactIds.length,
    };
    return {
      summary,
      handoffIds,
      affectedItemIds: new Set(handoffs.map((record) => record.itemId)),
      hash: digest(
        JSON.stringify({
          id,
          version: board.version,
          data,
          handoffs,
          artifactIds,
        }),
      ),
    };
  }

  /** 评估只保存确认凭据，不修改流程或历史；确认绑定本次草稿和影响范围。 */
  previewBoardFlow(id: string, input: any, version: number) {
    return this.store.transaction(() => {
      const board = this.store.get<Board>("boards", id);
      ensure(
        board.version === version,
        "CONFLICT",
        i18nMessage("errors.CONFLICT.the.data.version.has.changed"),
        409,
      );
      const data = boardSchema.parse(input);
      this.validateReferences("boards", data, board);
      const typeChanges = this.validateFlowChange(board, data);
      const impact = this.flowImpact(id, input);
      // 清理过期评估，避免反复预览无限积累临时确认凭据。
      for (const entry of this.store.list("flow_confirmations")) {
        if (!entry.expiresAt || entry.expiresAt <= Date.now())
          this.store.remove("flow_confirmations", entry.id);
      }
      const confirmationToken = randomUUID();
      this.store.put(
        "flow_confirmations",
        {
          boardId: id,
          hash: impact.hash,
          expiresAt: Date.now() + 30 * 60 * 1000,
        },
        confirmationToken,
      );
      return {
        ...this.boardEditability(id),
        ...impact.summary,
        typeChanges,
        confirmationToken,
      };
    });
  }

  /** 固定终点和项目归属保持不变；被删除的阶段身份不能再次使用。 */
  private validateFlowChange(old: Board, data: z.infer<typeof boardSchema>) {
    const done = old.stages.find((stage: any) => stage.type === "done");
    const start = old.stages.find((stage: any) => stage.fixedRole === "start");
    ensure(
      start &&
        data.stages[0]?.id === start.id &&
        data.stages[0]?.fixedRole === "start" &&
        data.stages[0]?.type === "human",
      "START_IMMUTABLE",
      i18nMessage("errors.START_IMMUTABLE"),
      409,
    );
    ensure(
      data.projectId === old.projectId,
      "PROJECT_IMMUTABLE",
      i18nMessage(
        "errors.PROJECT_IMMUTABLE.flow.editing.cannot.move.the.board",
      ),
      409,
    );
    ensure(
      data.stages.find((stage: any) => stage.id === done?.id)?.type === "done",
      "DONE_IMMUTABLE",
      i18nMessage("errors.DONE_IMMUTABLE.the.original.fixed.done.stage.must"),
      409,
    );
    ensure(
      !data.stages.some((stage: any) =>
        (old.deletedStageIds || []).includes(stage.id),
      ),
      "STAGE_DELETED",
      i18nMessage("errors.STAGE_DELETED.deleted.stage.ids.cannot.be.reused"),
      409,
    );
    for (const [index, stage] of data.stages.entries()) {
      const saved = old.stages.find((s: any) => s.id === stage.id);
      if (stage.shortId !== undefined && stage.shortId !== saved?.shortId)
        handoffError("STAGE_SHORT_ID_INVALID", `stages.${index}.shortId`);
      if (saved) stage.shortId = saved.shortId;
    }
    ensure(!old.archived, "FLOW_BLOCKED", i18nMessage("board.flowArchived"), 409);
    const before = new Map(old.stages.map((stage) => [stage.id, stage]));
    const after = new Map(data.stages.map((stage) => [stage.id, stage]));
    const beforePaths = stagesReachingDone(old.stages);
    const afterPaths = stagesReachingDone(data.stages);
    const reachableTargets = new Set<string>();
    const label = (stage: Stage) => `${stage.shortId} · ${stage.name}`;

    for (const item of this.inFlightItems(old)) {
      const source = before.get(item.stageId)!;
      const next = after.get(source.id);
      ensure(next && next.type === source.type, "FLOW_BLOCKED",
        i18nMessage("board.flowOccupied", { stage: label(source) }), 409);
      for (const id of source.targets) {
        ensure(next.targets.includes(id), "FLOW_BLOCKED",
          i18nMessage("board.flowExit", { stage: label(source), target: label(before.get(id)!) }), 409);
      }

      // 每张卡片可能在不同版本入队，第一跳只能使用本次执行的目标。
      let firstHops = next.targets;
      if (source.type === "agent" && item.executionId) {
        const snapshot = JSON.parse(this.execution(item.executionId).snapshot);
        firstHops = next.targets.filter((id) => snapshot.allowedTargets?.some((target: { id: string }) => target.id === id));
      }
      for (const id of firstHops) reachableTargets.add(id);
      const hadPath = firstHops.some((id) => source.targets.includes(id) && beforePaths.has(id));
      ensure(!hadPath || firstHops.some((id) => afterPaths.has(id)), "FLOW_BLOCKED",
        i18nMessage("board.flowPath", { stage: label(source) }), 409);
    }
    return data.stages.filter((stage) => reachableTargets.has(stage.id) &&
      before.has(stage.id) && stage.type !== before.get(stage.id)!.type).map(stageDescriptor);
  }

  /** 恢复必须在事务内重新检查原阶段，避免恢复已失效的执行入口。 */
  archiveItem(id: string, archived: boolean) {
    return this.store.transaction(() => {
      const item = this.store.get("items", id);
      ensure(
        ![
          "running",
          "waiting",
          "unknown",
          "dispatching",
          "stopping",
          "queued",
        ].includes(item.status),
        "BUSY",
        i18nMessage("errors.BUSY.stop.or.cancel.the.execution.first"),
      );
      const board = this.store.get<Board>("boards", item.boardId);
      ensure(
        archived || board.stages.some((stage) => stage.id === item.stageId),
        "STAGE_DELETED",
        i18nMessage("errors.STAGE_DELETED.the.original.stage.was.deleted.this"),
        409,
      );
      return this.store.put("items", { archived }, id);
    });
  }

  /** 环境逐项确认后才登记项目；部分成功的目录保留供用户重试。 */
  async createProject(input: unknown) {
    const project = projectSchema.parse(input);
    for (const [index, directory] of project.directories.entries()) {
      let environment = directory.environmentId;
      try {
        const node = this.store.get("environments", directory.environmentId);
        environment = node.name || environment;
        const result = await this.peer(directory.environmentId).call("directory.ensure", directory);
        ensure(result?.ok === true, "STATUS_UNKNOWN", i18nMessage("common.failure"), 502);
      } catch (error) {
        const reasons = {
          PATH_INVALID: "invalid", PATH_ESCAPE: "outside", NOT_DIRECTORY: "conflict",
          DIRECTORY_PERMISSION: "permission", DIRECTORY_STORAGE: "storage", ROOT_UNKNOWN: "root",
          OFFLINE: "offline", NOT_FOUND: "offline", METHOD_NOT_FOUND: "upgrade",
        } as const;
        const code = error instanceof AppError ? error.code : "STATUS_UNKNOWN";
        const reason = Object.hasOwn(reasons, code) ? reasons[code as keyof typeof reasons] : "unknown";
        const failure = new AppError(code, i18nMessage(`project.directory.${reason}`, {
          environment, path: directory.relativePath || ".",
        }), error instanceof AppError ? error.status : 502);
        failure.field = `directories.${index}.relativePath`;
        throw failure;
      }
    }
    try {
      return this.save("projects", project);
    } catch {
      throw new AppError("PROJECT_SAVE_FAILED", i18nMessage("project.saveFailed"), 500);
    }
  }

  /** 流程失败记录固定业务码，避免将节点指令或请求正文写入审计。 */
  save(kind: string, input: any, id?: string, version?: number): Entity {
    try {
      return this.saveEntity(kind, input, id, version);
    } catch (error) {
      if (kind === "boards" && id)
        this.store.put("board_flow_changes", {
          boardId: id,
          actorId: "owner",
          beforeVersion: version,
          result: "rejected",
          reason:
            error instanceof AppError
              ? error.code
              : "VALIDATION_OR_INTERNAL_ERROR",
        });
      throw error;
    }
  }

  /** 统一配置保存，在同步事务中完成版本、准入和历史处理。 */
  private saveEntity(
    kind: string,
    input: any,
    id?: string,
    version?: number,
  ): Entity {
    const schemas: Record<string, z.ZodType> = {
      projects: projectSchema,
      agents: agentSchema,
      boards: boardSchema,
      models: modelSchema,
    };
    ensure(
      schemas[kind],
      "INVALID_KIND",
      i18nMessage("errors.INVALID_KIND.unsupported.object.type"),
    );
    // 省略字段的旧客户端不能覆盖已保存的权限或 CLI 范围。
    const previous = id ? this.store.get(kind, id) : undefined;
    const value =
      kind === "agents" && previous
        ? {
            ...input,
            supportedRuntimes:
              input.supportedRuntimes === undefined
                ? (previous.supportedRuntimes ?? null)
                : input.supportedRuntimes,
            defaultPermission:
              input.defaultPermission === undefined
                ? (previous.defaultPermission ?? "ask")
                : input.defaultPermission,
          }
        : input;
    const data: any = schemas[kind].parse(value);
    return this.store.transaction(() => {
      const operationId = kind === "boards" ? input.operationId : undefined;
      if (operationId) {
        z.string().uuid().parse(operationId);
        const prior = this.store.db
          .prepare("SELECT * FROM operations WHERE id=?")
          .get(operationId) as any;
        if (prior) {
          ensure(
            prior.scope === (id ? "board-flow:" + id : "board-create") &&
              prior.hash === digest(JSON.stringify(input)),
            "IDEMPOTENCY_CONFLICT",
            i18nMessage(
              "errors.IDEMPOTENCY_CONFLICT.repeated.operation.parameters.do.not.match",
            ),
            409,
          );
          return JSON.parse(prior.result);
        }
      }

      this.validateReferences(kind, data, previous);
      if (kind === "boards") {
        // 已保存阶段省略权限时保持原值；只有新增阶段才解析智能体默认值。
        for (const [index, stage] of data.stages.entries()) {
          if (
            stage.type !== "agent" ||
            input.stages[index].permission !== undefined
          )
            continue;
          const old = previous?.stages.find(
            (entry: any) => entry.id === stage.id,
          );
          stage.permission = old
            ? permissionSchema.parse(old.permission ?? "ask")
            : permissionSchema.parse(
                this.store.get("agents", stage.agentId).defaultPermission ?? "ask",
              );
        }
      }
      if (id) {
        const old = this.store.get(kind, id);
        ensure(
          version === old.version,
          "CONFLICT",
          i18nMessage("errors.CONFLICT.the.data.version.has.changed"),
          409,
        );
        if (kind === "boards") {
          this.validateFlowChange(old as Board, data);
          const impact = this.flowImpact(id, input);
          if (impact.summary.deletedStages.length) {
            const confirmation = this.store
              .list("flow_confirmations")
              .find((entry) => entry.id === input.confirmationToken);
            ensure(
              confirmation?.boardId === id &&
                confirmation.hash === impact.hash &&
                confirmation.expiresAt > Date.now(),
              "FLOW_CONFIRMATION_REQUIRED",
              i18nMessage(
                "errors.FLOW_CONFIRMATION_REQUIRED.re.evaluate.the.deletion.impact.and",
              ),
              409,
            );
            this.store.remove("flow_confirmations", confirmation!.id);
            for (const handoffId of impact.handoffIds)
              this.store.remove("handoffs", handoffId);
            const affected = this.store
              .list("items")
              .filter((item) => item.boardId === id);
            for (const item of affected) {
              const removed = impact.summary.deletedStages.some(
                (stage) => stage.id === item.stageId,
              );
              if (removed || impact.affectedItemIds.has(item.id))
                this.store.put(
                  "items",
                  {
                    ...(removed ? { stageDeleted: true } : {}),
                    historyIncomplete:
                      item.historyIncomplete ||
                      impact.affectedItemIds.has(item.id),
                  },
                  item.id,
                );
            }
            data.deletedStageIds = [
              ...(old.deletedStageIds || []),
              ...impact.summary.deletedStages.map((stage) => stage.id),
            ];
          }
          this.store.put("board_flow_changes", {
            boardId: id,
            actorId: "owner",
            beforeVersion: old.version,
            afterVersion: old.version + 1,
            ...impact.summary,
            confirmed: !!input.confirmationToken,
            result: "success",
          });
        }
        if (
          kind === "projects" &&
          this.store.list("sessions").some((s) => s.projectId === id)
        )
          ensure(
            JSON.stringify(old.directories) ===
              JSON.stringify(data.directories),
            "REFERENCED",
            i18nMessage(
              "errors.REFERENCED.an.existing.session.s.project.directory",
            ),
          );
      }
      if (kind === "models") {
        ensure(
          !Object.keys(data.extra).some((k) =>
            [
              "messages",
              "input",
              "tools",
              "instructions",
              "model",
              "stream",
              "apiKey",
              "headers",
              "baseURL",
              "tool_choice",
              "system",
              "parallel_tool_calls",
              "prompt",
              "toolChoice",
              "abortSignal",
              "fetch",
              "httpAgent",
              "dangerouslyAllowBrowser",
              "previous_response_id",
              "conversation",
              "store",
              "tracing",
              "metadata",
            ].includes(k),
          ),
          "RESERVED_PARAMETER",
          i18nMessage(
            "errors.RESERVED_PARAMETER.custom.parameters.must.not.override.model",
          ),
        );
        const { apiKey, ...rest } = data;
        return this.publicModel(
          this.store.put(
            kind,
            { ...rest, ...(apiKey ? { secret: this.vault.seal(apiKey) } : {}) },
            id,
            version,
          ),
        );
      }
      if (kind === "boards")
        numberStages(data, id ? this.store.get(kind, id) : undefined);
      const saved = this.store.put(kind, data, id, version);
      if (operationId)
        this.store.db
          .prepare("INSERT INTO operations VALUES(?,?,?,?,?)")
          .run(
            operationId,
            id ? "board-flow:" + id : "board-create",
            digest(JSON.stringify(input)),
            "completed",
            JSON.stringify(saved),
          );
      if (
        kind === "agents" &&
        (!previous || previous.defaultPermission !== saved.defaultPermission)
      ) {
        // 与配置写入处于同一事务，仅记录权限差异，不保存提示词正文。
        this.store.put("agent_permission_changes", {
          agentId: saved.id,
          actorId: saved.ownerId,
          before: previous ? (previous.defaultPermission ?? "ask") : null,
          after: saved.defaultPermission,
          agentVersion: saved.version,
        });
      }
      return saved;
    });
  }
  remove(kind: string, id: string) {
    if (kind === "boards") return this.removeBoard(id);
    this.store.get(kind, id);
    const refs =
      this.store
        .list("boards")
        .some(
          (b) =>
            b.projectId === id ||
            b.stages.some(
              (s: any) => s.agentId === id || s.environmentId === id,
            ),
        ) ||
      this.store
        .list("sessions")
        .some((s) => [s.projectId, s.agentId, s.environmentId].includes(id)) ||
      this.store.list("items").some((i) => i.boardId === id) ||
      this.store.list("workbench").some((w) => w.modelId === id);
    ensure(
      !refs,
      "REFERENCED",
      i18nMessage("errors.REFERENCED.the.object.is.still.referenced.and"),
    );
    this.store.remove(kind, id);
    return { ok: true };
  }
  /** 删除已无未完成且未归档工作项的看板，保留独立会话及执行历史。 */
  private removeBoard(id: string) {
    return this.store.transaction(() => {
      const board = this.store.get<Board>("boards", id);
      const items = this.store
        .list("items")
        .filter((item) => item.boardId === id);
      ensure(
        !items.some(
          (item) =>
            !item.archived &&
            board.stages.find((stage) => stage.id === item.stageId)?.type !==
              "done",
        ),
        "REFERENCED",
        i18nMessage(
          "errors.REFERENCED.the.board.has.unfinished.unarchived.work",
        ),
      );
      const itemIds = new Set(items.map((item) => item.id));
      // 工作项移除后解除执行关联，迟到的执行状态仍可更新独立会话。
      for (const item of items) {
        // 兼容旧版本归档后重试留下的排队执行，删除后不得继续派发。
        const queued = this.store.db
          .prepare(
            "SELECT id FROM executions WHERE item_id=? AND state='queued'",
          )
          .all(item.id);
        for (const execution of queued)
          this.setState(String(execution.id), "cancelled");
        this.store.db
          .prepare("UPDATE executions SET item_id=NULL WHERE item_id=?")
          .run(item.id);
        this.store.db
          .prepare("DELETE FROM operations WHERE scope=?")
          .run(item.id);
        this.store.remove("items", item.id);
      }
      for (const handoff of this.store.list("handoffs")) {
        if (itemIds.has(handoff.itemId))
          this.store.remove("handoffs", handoff.id);
      }
      this.store.remove("boards", id);
      return { ok: true };
    });
  }
  /** 复制保留编号与高水位，独立 UUID 和防重操作在同一事务内提交。 */
  copyBoard(id: string, operationId?: string, locale: Locale = "en") {
    if (operationId) idSchema.parse(operationId);
    return this.store.transaction(() => {
      const scope = "board-copy:" + id;
      const old = operationId
        ? (this.store.db
            .prepare("SELECT * FROM operations WHERE id=?")
            .get(operationId) as any)
        : null;
      if (old) {
        ensure(
          old.scope === scope,
          "IDEMPOTENCY_CONFLICT",
          i18nMessage(
            "errors.IDEMPOTENCY_CONFLICT.repeated.operation.parameters.do.not.match",
          ),
          409,
        );
        return JSON.parse(old.result);
      }
      const b = this.store.get("boards", id);
      const ids = new Map<string, string>(
        b.stages.map((s: any) => [s.id, randomUUID()]),
      );
      const data = boardSchema.parse({
        ...b,
        name: translate(locale, "board.copyName", { name: b.name }),
        stages: b.stages.map((s: any) => ({
          ...s,
          id: ids.get(s.id),
          targets: s.targets.map((t: string) => ids.get(t)),
        })),
      });
      this.validateReferences("boards", data);
      const saved = this.store.put("boards", {
        ...data,
        stageShortIdHighWater: b.stageShortIdHighWater,
      });
      if (operationId)
        this.store.db
          .prepare("INSERT INTO operations VALUES(?,?,?,?,?)")
          .run(
            operationId,
            scope,
            digest(scope),
            "completed",
            JSON.stringify(saved),
          );
      return saved;
    });
  }
  /** 同步解析真实起点；工作台在审批前冻结此配置，创建时再次校验版本。 */
  resolveItemStart(data: ReturnType<typeof workItemSchema.parse>) {
    const board = this.store.get<Board>("boards", data.boardId);
    if (data.boardVersion !== undefined && data.boardVersion !== board.version)
      itemCreationError("BOARD_VERSION_CONFLICT");
    const stage =
      data.startStageId === undefined
        ? board.stages.find((s) => s.fixedRole === "start")
        : board.stages.find((s) => s.id === data.startStageId);
    if (!stage)
      itemCreationError(
        data.startStageId === undefined
          ? "NO_START_STAGE"
          : "INVALID_START_STAGE",
      );
    return { board, stage: stageSchema.parse(stage) };
  }

  /** 创建、入队和防重结果原子提交；重试先回读首次结果，不重新解释默认起点。 */
  createItem(input: any, batch?: BoardAttachmentBatch, recordCreation?: (item: Entity) => void) {
    const { operationId, ...data } = workItemSchema.parse(input);
    const hash = digest(
      JSON.stringify(batch ? { ...data, receipt: batch.receipt } : data),
    );
    return this.store.transaction(() => {
      const old = operationId
        ? (this.store.db
            .prepare("SELECT * FROM operations WHERE id=?")
            .get(operationId) as any)
        : null;
      if (old) {
        if (
          old.hash !== hash ||
          old.state !== "completed" ||
          !old.scope.startsWith("item-create:")
        )
          itemCreationError("IDEMPOTENCY_CONFLICT");
        const result = JSON.parse(old.result);
        // 删除后的对象不可借助历史结果复活；保留账本作为操作墓碑。
        this.store.get("boards", data.boardId);
        this.store.get("items", result.id);
        return result;
      }
      const { board, stage } = this.resolveItemStart(data);
      const attachments = batch?.bind(board.id, stage.id, operationId);
      const { startStageId, boardVersion, ...fields } = data;
      const item = this.store.put("items", {
        ...fields,
        stageId: stage.id,
        archived: false,
        status: stage.type === "agent" ? "queued" : stage.type,
      });
      if (attachments)
        this.store.put("handoffs", {
          kind: "created",
          itemId: item.id,
          to: stage.id,
          toStage: stageDescriptor(stage),
          record: "",
          attachments,
        });
      if (stage.type === "agent") {
        this.store.get("environments", stage.environmentId!);
        this.queue(item, board);
      }
      const result = this.store.get("items", item.id);
      if (operationId)
        this.store.db
          .prepare("INSERT INTO operations VALUES(?,?,?,?,?)")
          .run(
            operationId,
            "item-create:" + data.boardId,
            hash,
            "completed",
            JSON.stringify(result),
          );
      recordCreation?.(result);
      return result;
    });
  }
  requireEditableItem(
    item: Entity,
    board: Board,
    stageId: string,
    version: number,
  ) {
    const stage = board.stages.find((s) => s.id === item.stageId);
    ensure(
      stage?.type === "human" &&
        !item.archived &&
        !item.stageDeleted &&
        stage.id === stageId &&
        item.version === version,
      "CONFLICT",
      i18nMessage("errors.CONFLICT.the.data.has.changed.refresh.and"),
      409,
    );
    return stage;
  }

  /** 引用标识取自不可变历史；展示和派发共享过滤规则，历史详情仍读取原始快照。 */
  private deliveryHistory(item: Entity) {
    const removed = new Set<string>(item.removedAttachmentIds);
    return this.store
      .list("handoffs")
      .filter((h) => h.itemId === item.id)
      .map((h) =>
        h.attachments
          ? {
              ...h,
              attachments: (h.attachments as Attachment[])
                .map((a, index) => ({
                  ...a,
                  referenceId: h.id + ":" + index,
                }))
                .filter((a) => !removed.has(a.referenceId)),
            }
          : h,
      );
  }

  itemEditView(id: string) {
    const item = this.store.get("items", id);
    return {
      item,
      attachments: this.deliveryHistory(item).flatMap(
        (h) => h.attachments ?? [],
      ),
    };
  }

  editItem(id: string, input: unknown, batch?: BoardAttachmentBatch) {
    const data = workItemEditSchema.parse(input);
    const scope = "item-edit:" + id;
    const hash = digest(JSON.stringify(data));
    return this.store.transaction(() => {
      const item = this.store.get("items", id);
      const old = this.store.db
        .prepare("SELECT * FROM operations WHERE id=?")
        .get(data.operationId);
      if (old) {
        ensure(
          old.scope === scope && old.hash === hash,
          "IDEMPOTENCY_CONFLICT",
          i18nMessage(
            "errors.IDEMPOTENCY_CONFLICT.repeated.operation.parameters.do.not.match",
          ),
          409,
        );
        return JSON.parse(String(old.result));
      }
      const board = this.store.get<Board>("boards", item.boardId);
      const stage = this.requireEditableItem(
        item,
        board,
        data.expectedStageId,
        data.expectedVersion,
      );
      const removed = new Set(data.removeAttachmentIds);
      if (removed.size) {
        const active = new Set(
          this.itemEditView(id).attachments.map((a) => a.referenceId),
        );
        ensure(
          [...removed].every((ref) => active.has(ref)),
          "CONFLICT",
          i18nMessage("errors.CONFLICT.the.data.has.changed.refresh.and"),
          409,
        );
      }
      const attachments = batch?.bind(
        board.id,
        stage.id,
        data.operationId,
        id,
        item.version,
      );
      if (attachments)
        this.store.put("handoffs", {
          kind: "edited",
          itemId: id,
          from: stage.id,
          to: stage.id,
          fromStage: stageDescriptor(stage),
          toStage: stageDescriptor(stage),
          record: "",
          attachments,
        });
      const saved = this.store.put(
        "items",
        {
          title: data.title,
          content: data.content,
          ...(removed.size
            ? {
                removedAttachmentIds: [
                  ...(item.removedAttachmentIds ?? []),
                  ...removed,
                ],
              }
            : {}),
        },
        id,
        data.expectedVersion,
      );
      this.store.db
        .prepare("INSERT INTO operations VALUES(?,?,?,?,?)")
        .run(data.operationId, scope, hash, "completed", JSON.stringify(saved));
      return saved;
    });
  }

  /** 登录前仅公开服务进程语言；实例偏好由已认证接口和后台派发读取。 */
  languageSettings(authenticated = true) {
    const serverLocale = systemLocale();
    const saved = authenticated
      ? this.store.list("settings").find((s) => s.id === "instance-language")
      : undefined;
    const selected = preference(saved?.preference);
    return {
      preference: selected,
      serverLocale,
      locale: selected === "auto" ? serverLocale : selected,
    };
  }
  saveLanguage(input: unknown) {
    const data = z
      .object({ preference: z.enum(["auto", "zh-CN", "en"]) })
      .strict()
      .parse(input);
    this.store.put("settings", data, "instance-language");
    return this.languageSettings();
  }
  /** 旧连接器只识别交接正文，必须先过滤已移除引用再生成正文副本。 */
  private dispatchHistory(
    itemId: string,
    environmentId: string,
    locale?: Locale,
  ) {
    const records = this.deliveryHistory(this.store.get("items", itemId));
    if (
      this.store
        .get("environments", environmentId)
        .capabilities?.includes("board-attachments-v1")
    )
      return records;
    return records.map((h) =>
      h.attachments?.length
        ? {
            ...h,
            record: [
              h.kind === "created"
                ? handoffLabel("handoff.created", locale)
                : h.record,
              attachmentHistoryText(h.attachments, locale),
            ]
              .filter(Boolean)
              .join("\n\n"),
          }
        : h,
    );
  }
  queue(item: Entity, b: Board) {
    // 历史阶段缺少权限时固定为询问，不能在派发时套用智能体新默认值。
    const stage = stageSchema.parse(
      b.stages.find((s) => s.id === item.stageId)!,
    );
    const agent = this.requireStageAgent(stage);
    const id = randomUUID();
    const session = this.createSession(
      { title: item.title.slice(0, 100), projectId: b.projectId, ...stage },
      false,
    );
    // 按入队名称生成原生标题，截断时保留阶段全名并避开半个代理对。
    const suffix = "-" + stage.name.trimEnd();
    const prefix = item.title.trimStart().slice(0, 200 - suffix.length).replace(/[\uD800-\uDBFF]$/u, "");
    const snapshot = {
      initialSessionTitle: prefix + suffix,
      locale: this.languageSettings().locale,
      handoffContractVersion: 2,
      boardId: b.id,
      permission: session.permission,
      currentStage: stageDescriptor(stage),
      allowedTargets: stage.targets.map((id) =>
        stageDescriptor(b.stages.find((s) => s.id === id)),
      ),
      stage,
      agent,
    };
    this.store.db
      .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(
        id,
        item.id,
        session.id,
        stage.environmentId!,
        "queued",
        JSON.stringify(snapshot),
        new Date().toISOString(),
      );
    this.store.put(
      "sessions",
      { executionId: id, status: "queued" },
      session.id,
    );
    this.store.put("items", { executionId: id, status: "queued" }, item.id);
  }
  /** 本机可热切换模式。新建人工会话前读取连接器，旧版沿用握手摘要。 */
  async refreshClaudeSettings(id: string) {
    const env = this.store.get("environments", id);
    if (!env.approved || env.revoked || !env.capabilities?.includes("claude-terminal-v1") || !this.peers.has(id)) return env;
    const peer = this.peer(id);
    const tool = await peer.call("claude.settings");
    const current = this.store.get("environments", id);
    ensure(!current.revoked && this.peer(id) === peer, "OFFLINE", i18nMessage("connector.native.unavailable"), 409);
    if (JSON.stringify(current.tools?.claude) === JSON.stringify(tool)) return current;
    return this.store.put("environments", { tools: { ...current.tools, claude: tool } }, id);
  }
  createSession(input: any, requireOnline = true, interactive = false) {
    const data = sessionSchema.parse(input);
    ensure(
      data.runtime !== "codex" || !data.runtimeOptions?.thinking,
      "UNSUPPORTED_THINKING",
      i18nMessage(
        "errors.UNSUPPORTED_THINKING.codex.does.not.support.claude.thinking",
      ),
    );
    const project = this.store.get("projects", data.projectId);
    ensure(
      project.directories.some(
        (d: any) =>
          d.environmentId === data.environmentId &&
          d.rootId === data.rootId &&
          d.relativePath === data.relativePath,
      ),
      "DIRECTORY_MISMATCH",
      i18nMessage(
        "errors.DIRECTORY_MISMATCH.the.directory.must.be.registered.in",
      ),
    );
    if (requireOnline) {
      this.requireEnabledRuntime(this.store.get("environments", data.environmentId), data.runtime);
      ensure(
        this.peers.has(data.environmentId),
        "OFFLINE",
        i18nMessage("errors.OFFLINE.the.environment.is.offline.a.session"),
        409,
      );
    }
    const environmentMode = interactive && data.runtime === "claude" &&
      this.store.get("environments", data.environmentId).tools?.claude?.mode === "environment";
    ensure(environmentMode || data.agentId, "AGENT_REQUIRED", i18nMessage("errors.AGENT_REQUIRED.select"));
    if (data.agentId) {
      const agent = this.store.get("agents", data.agentId);
      ensure(
        !agent.environmentId || agent.environmentId === data.environmentId,
        "AGENT_SCOPE",
        i18nMessage("errors.AGENT_SCOPE.the.agent.environment.does.not.match"),
      );
      ensure(
        agentSupportsRuntime(agent, data.runtime),
        "AGENT_RUNTIME",
        i18nMessage("errors.AGENT_RUNTIME.the.agent.does.not.support.this"),
      );
    }
    if (input.permission !== undefined)
      ensurePermissionAllowed(
        data.permission,
        [data.runtime],
        this.store.get("environments", data.environmentId),
      );
    // 先校验引用，再解析省略权限；显式选择和工作台继承值始终优先。
    if (input.permission === undefined && data.agentId)
      data.permission = permissionSchema.parse(
        this.store.get("agents", data.agentId).defaultPermission ?? "ask",
      );
    return this.store.put("sessions", { ...data, ...(environmentMode ? { claudeMode: "environment" } : {}), status: "idle" });
  }
  /** 仅调整下一轮的智能体与权限，执行中的会话不可更改配置。 */
  configureSession(id: string, input: unknown) {
    const data = z
      .object({
        runtimeOptions: runtimeOptionsSchema.optional(),
        agentId: z.string().uuid().nullable(),
        permission: permissionSchema,
      })
      .strict()
      .parse(input);
    const session = this.store.get<Session>("sessions", id);
    ensurePermissionAllowed(
      data.permission,
      [session.runtime],
      this.store.get("environments", session.environmentId),
    );
    ensure(
      session.runtime !== "codex" || !data.runtimeOptions?.thinking,
      "UNSUPPORTED_THINKING",
      i18nMessage(
        "errors.UNSUPPORTED_THINKING.codex.does.not.support.claude.thinking",
      ),
    );
    ensure(
      !session.archived,
      "ARCHIVED",
      i18nMessage("errors.ARCHIVED.unarchive.the.session.before.changing.its"),
      409,
    );
    ensure(
      !this.active(id) &&
        ![
          "queued",
          "dispatching",
          "running",
          "waiting",
          "unknown",
          "stopping",
        ].includes(session.status),
      "BUSY",
      i18nMessage("errors.BUSY.this.session.is.running"),
      409,
    );
    ensure(!session.agentId || data.agentId, "AGENT_REQUIRED", i18nMessage("errors.AGENT_REQUIRED.select"));
    if (data.agentId) {
      const agent = this.store.get("agents", data.agentId);
      ensure(
        !agent.environmentId || agent.environmentId === session.environmentId,
        "AGENT_SCOPE",
        i18nMessage("errors.AGENT_SCOPE.the.agent.environment.does.not.match"),
      );
      ensure(
        agentSupportsRuntime(agent, session.runtime),
        "AGENT_RUNTIME",
        i18nMessage("errors.AGENT_RUNTIME.the.agent.does.not.support.this"),
      );
    }
    return this.store.put("sessions", data, id);
  }
  /** 新参数必须由明确声明支持的连接器接收。 */
  private requireRuntimeOptions(session: any, agent: any) {
    if (hasRuntimeOptions(session, agent))
      ensure(
        this.store
          .get("environments", session.environmentId)
          .capabilities?.includes("runtime-options-v1"),
        "CONNECTOR_UPGRADE",
        i18nMessage(
          "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.configure",
        ),
        409,
      );
  }
  execution(id: string) {
    const x = this.store.db
      .prepare("SELECT * FROM executions WHERE id=?")
      .get(id) as unknown as Execution;
    ensure(
      x,
      "NOT_FOUND",
      i18nMessage("errors.NOT_FOUND.execution.not.found"),
      404,
    );
    return x;
  }
  active(sessionId: string) {
    return this.store.db
      .prepare(
        "SELECT * FROM executions WHERE session_id=? AND state IN ('queued','dispatching','running','waiting','unknown','stopping')",
      )
      .get(sessionId) as unknown as Execution | undefined;
  }
  peer(id: string) {
    const p = this.peers.get(id);
    ensure(
      p,
      "OFFLINE",
      i18nMessage("errors.OFFLINE.the.environment.is.offline.session.content"),
      409,
    );
    return p;
  }
  async send(
    sessionId: string,
    operationId: string,
    message: string,
    mentions: Mention[] = [],
    attachments: Attachment[] = [],
    commandIdentity?: string,
  ) {
    ensure(this.store.get("sessions", sessionId).claudeMode !== "environment", "NATIVE_TERMINAL", i18nMessage("connector.native.terminal"), 409);
    attachments = attachmentsSchema.parse(attachments);
    ensure(
      message.trim().length > 0 || attachments.length > 0,
      "MESSAGE_EMPTY",
      i18nMessage("uploads.empty"),
    );
    if (attachments.length) {
      const session = this.store.get<Session>("sessions", sessionId);
      ensure(
        this.store
          .get("environments", session.environmentId)
          .capabilities?.includes(uploadCapability),
        "CONNECTOR_UPGRADE",
        i18nMessage("uploads.upgrade"),
        409,
      );
    }
    const session = this.store.get<Session>("sessions", sessionId);
    ensure(
      !session.archived,
      "ARCHIVED",
      i18nMessage(
        "errors.ARCHIVED.unarchive.the.session.before.sending.messages",
      ),
      409,
    );
    ensure(
      validMentions(message, mentions),
      "MENTION_INVALID",
      i18nMessage(
        "errors.MENTION_INVALID.references.do.not.match.the.message.detail3",
      ),
    );
    if (mentions.length)
      ensure(
        this.store
          .get("environments", session.environmentId)
          .capabilities?.includes("mentions-v1"),
        "CONNECTOR_UPGRADE",
        i18nMessage(
          "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.use.detail2",
        ),
        409,
      );
    const hash = digest(
      JSON.stringify({
        sessionId,
        message,
        ...(commandIdentity ? { commandIdentity } : {}),
        ...(mentions.length ? { mentions } : {}),
        ...(attachments.length ? { attachments } : {}),
      }),
    );
    const old = this.store.db
      .prepare("SELECT * FROM operations WHERE id=?")
      .get(operationId) as any;
    if (old) {
      ensure(
        old.hash === hash && old.scope === sessionId,
        "IDEMPOTENCY_CONFLICT",
        i18nMessage(
          "errors.IDEMPOTENCY_CONFLICT.the.operation.id.was.used.for",
        ),
        409,
      );
      const saved = JSON.parse(old.result);
      return { ...saved, status: this.execution(saved.executionId).state };
    }
    ensure(
      !this.updating(session.environmentId),
      "UPDATE_IN_PROGRESS",
      i18nMessage(
        "errors.UPDATE_IN_PROGRESS.the.environment.is.updating.its.connector",
      ),
      409,
    );
    this.requireEnabledRuntime(
      this.store.get("environments", session.environmentId),
      session.runtime,
    );
    const peer = this.peer(session.environmentId);
    ensure(
      !this.active(sessionId) &&
        ![
          "queued",
          "dispatching",
          "running",
          "waiting",
          "unknown",
          "stopping",
        ].includes(session.status),
      "BUSY",
      i18nMessage("errors.BUSY.this.session.is.running"),
      409,
    );
    const item = this.currentItem(sessionId);
    const previous = item ? this.execution(item.executionId) : null;
    const locale = this.languageSettings().locale;
    if (item)
      ensure(
        this.store
          .get("environments", session.environmentId)
          .capabilities?.includes("board-resume-v1"),
        "CONNECTOR_UPGRADE",
        i18nMessage(
          "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.continue",
        ),
        409,
      );
    if (
      previous &&
      readHandoff(JSON.parse(previous.snapshot)) &&
      !this.store
        .get("environments", session.environmentId)
        .capabilities?.includes(handoffCapability)
    )
      handoffError("CONNECTOR_UPGRADE");
    const boardIds = mentions.filter(m => m.kind === "board").map(m => {
      ensure(this.store.get("environments", session.environmentId).capabilities?.includes(boardCapability), "CONNECTOR_UPGRADE", i18nMessage("board.upgrade"), 409);
      const board = this.store.get("boards", idSchema.parse(m.path));
      ensure(board.ownerId === session.ownerId && board.name === m.name, "MENTION_STALE", i18nMessage("board.referenceUnavailable"), 409);
      return board.id;
    });
    const executionId = randomUUID();
    const result = {
      operationId,
      executionId,
      sessionId,
      status: "dispatching",
    };
    const agent = session.agentId
      ? this.store.get("agents", session.agentId)
      : null;
    // 配置可能在会话创建后调整，每次新执行都重新核对；不改写在途快照。
    if (agent)
      ensure(
        agentSupportsRuntime(agent, session.runtime),
        "AGENT_RUNTIME",
        i18nMessage("errors.AGENT_RUNTIME.the.agent.does.not.support.this"),
      );
    this.requireRuntimeOptions(session, agent);
    ensure(
      session.permission !== "auto" ||
        this.store
          .get("environments", session.environmentId)
          .capabilities?.includes(autoApprovalCapability),
      "CONNECTOR_UPGRADE_REQUIRED",
      i18nMessage("errors.CONNECTOR_UPGRADE_REQUIRED.auto.approval"),
      409,
    );
    this.store.transaction(() => {
      this.store.db
        .prepare("INSERT INTO operations VALUES(?,?,?,?,?)")
        .run(
          operationId,
          sessionId,
          hash,
          "dispatching",
          JSON.stringify(result),
        );
      this.store.db.prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)").run(
        executionId,
        item?.id || null,
        sessionId,
        session.environmentId,
        "dispatching",
        JSON.stringify({
          locale,
          ...(boardIds.length ? { boardIds } : {}),
          ...(previous
            ? {
                ...readHandoff(JSON.parse(previous.snapshot)),
                stage: JSON.parse(previous.snapshot).stage,
                continuation: { operationId, parentExecutionId: previous.id },
              }
            : {}),
          agent,
          permission: session.permission,
          runtimeOptions: session.runtimeOptions,
        }),
        new Date().toISOString(),
      );
      this.store.put(
        "sessions",
        {
          status: "dispatching",
          executionId,
          lastUserMessageAt: new Date().toISOString(),
        },
        sessionId,
      );
      if (item)
        this.store.put(
          "items",
          { executionId, lastKnownStatus: item.status },
          item.id,
        );
    });
    try {
      const accepted = await peer.call(
        item ? "execution.prepare" : "execution.start",
        {
          operationId,
          executionId,
          session: { ...session, boardTools: this.store.get("environments", session.environmentId).capabilities?.includes(boardCapability), agent, locale },
          message,
          ...(commandIdentity ? { commandIdentity } : {}),
          mentions,
          ...(attachments.length ? { attachments } : {}),
          ...(item
            ? {
                workflow: {
                  itemId: item.id,
                  title: item.title,
                  ...JSON.parse(previous!.snapshot).stage,
                  ...handoffProjection(JSON.parse(previous!.snapshot)),
                  locale,
                  handoffs: this.dispatchHistory(
                    item.id,
                    session.environmentId,
                    locale,
                  ),
                },
              }
            : {}),
        },
        60000,
      );
      this.setState(
        executionId,
        accepted.status || "running",
        accepted.stateVersion,
      );
      return { ...result, status: this.execution(executionId).state };
    } catch (e) {
      this.setState(
        executionId,
        e instanceof AppError && ["STATUS_UNKNOWN", "OFFLINE"].includes(e.code)
          ? "unknown"
          : "failed",
      );
      if (
        item &&
        !(
          e instanceof AppError &&
          ["STATUS_UNKNOWN", "OFFLINE"].includes(e.code)
        )
      ) {
        const current = this.store.get("items", item.id);
        if (current.executionId === executionId) {
          this.store.transaction(() => {
            this.store.put(
              "items",
              {
                executionId: previous!.id,
                status: item.status,
                lastKnownStatus: item.status,
              },
              item.id,
            );
            this.store.put(
              "sessions",
              { executionId: previous!.id, status: previous!.state },
              sessionId,
            );
          });
        }
      }
      throw e;
    }
  }
  setState(id: string, state: string, stateVersion?: number) {
    ensure(
      [
        "queued",
        "dispatching",
        "running",
        "waiting",
        "unknown",
        "stopping",
        "completed",
        "cancelled",
        "failed",
      ].includes(state),
      "INVALID_STATE",
      i18nMessage("errors.INVALID_STATE.invalid.execution.state"),
    );
    const e = this.execution(id);
    const snapshot = JSON.parse(e.snapshot);
    if (stateVersion !== undefined) {
      ensure(
        Number.isSafeInteger(stateVersion) && stateVersion >= 0,
        "INVALID_STATE_VERSION",
        i18nMessage(
          "errors.INVALID_STATE_VERSION.invalid.execution.state.version",
        ),
      );
      if (
        stateVersion < (snapshot.stateVersion ?? -1) ||
        (stateVersion === snapshot.stateVersion &&
          e.state !== "unknown" &&
          !(
            ["completed", "cancelled", "failed"].includes(e.state) &&
            ["completed", "cancelled", "failed"].includes(state)
          ))
      ) {
        this.stateAudit(e, e.state, state, "stale_version");
        return false;
      }
      snapshot.stateVersion = stateVersion;
    } else if (
      snapshot.stateVersion !== undefined &&
      state === "running" &&
      e.state === "waiting"
    ) {
      // 旧响应不得覆盖已经确认的原生等待事实。
      return false;
    }
    // 终态执行的迟到通知不能改写新一轮状态，也不能复活已删除会话。
    const session = this.store
      .list("sessions")
      .find((s) => s.id === e.session_id);
    if (!session) return;
    if (["completed", "cancelled", "failed"].includes(state)) {
      this.autoApproved.delete(id);
      this.manualApprovals.delete(id);
    }
    if (["completed", "cancelled", "failed"].includes(e.state)) {
      this.stateAudit(e, e.state, state, "terminal_ignored");
      // 看板交接先结束调度账本，原生结束通知随后补齐当前会话状态。
      if (
        session.executionId === id &&
        session.status !== e.state &&
        ["completed", "cancelled", "failed"].includes(state)
      ) {
        this.store.transaction(() => {
          this.store.db
            .prepare("UPDATE executions SET snapshot=? WHERE id=?")
            .run(JSON.stringify(snapshot), id);
          this.store.put("sessions", { status: e.state }, session.id);
        });
        this.sessionEvents.emit(session.id, {
          type: "execution-state",
          executionId: id,
          status: e.state,
        });
        // 同时允许 sessionEvent 转发终态的交互清理，避免页面继续显示运行或审批。
        return true;
      }
      return false;
    }
    this.store.db
      .prepare("UPDATE executions SET state=?, snapshot=? WHERE id=?")
      .run(state, JSON.stringify(snapshot), id);
    if (session.executionId === id)
      this.store.put("sessions", { status: state }, e.session_id);
    if (e.state !== state)
      this.sessionEvents.emit(e.session_id, {
        type: "execution-state",
        executionId: id,
        status: state,
      });
    if (e.item_id) {
      const item = this.store.get("items", e.item_id);
      if (
        item.executionId === id &&
        !item.archived &&
        snapshot.stage?.id === item.stageId
      ) {
        this.store.put(
          "items",
          {
            status: state,
            ...(state !== "unknown" ? { lastKnownStatus: state } : {}),
          },
          item.id,
        );
        if (item.status !== state)
          this.stateAudit(e, item.status, state, "applied");
      } else this.stateAudit(e, e.state, state, "historical_ignored");
    }
  }
  async stop(id: string) {
    const e = this.execution(id);
    if (["completed", "cancelled", "failed"].includes(e.state))
      return { status: e.state };
    if (e.state === "queued") {
      if (JSON.parse(e.snapshot).continuation) {
        // 先占住停止状态，避免等待取消响应期间被调度器派发。
        this.setState(id, "stopping");
        try {
          const result = await this.peer(e.environment_id).call(
            "execution.cancel",
            { executionId: e.id },
          );
          this.setState(id, result.status);
          return { status: this.execution(id).state };
        } catch (error) {
          this.setState(id, "unknown");
          throw error;
        }
      }
      this.setState(id, "cancelled");
      return { status: "cancelled" };
    }
    this.setState(id, "stopping");
    return this.peer(e.environment_id).call("execution.cancel", {
      executionId: id,
    });
  }
  /** 连接器专用入口；人工与平台内部 advance 继续使用 UUID。 */
  submitHandoff(
    itemId: string,
    targetId: string,
    record: string,
    operationId: string,
    executionId: string,
    artifacts: Entity[] = [],
    artifactRequest?: string,
  ) {
    return this.advance(
      itemId,
      targetId,
      record,
      operationId,
      executionId,
      artifacts,
      artifactRequest,
      true,
    );
  }
  advance(
    itemId: string,
    targetId: string,
    record: string,
    operationId: string,
    sourceExecutionId?: string,
    artifacts: Entity[] = [],
    artifactRequest?: string,
    handoffInput = false,
    expected?: { stageId: string; version: number },
    batch?: BoardAttachmentBatch,
  ) {
    // Agent 工具始终要求正文，不能因人工入口放宽而绕过。
    if (sourceExecutionId)
      ensure(
        typeof record === "string" && record.trim(),
        "HANDOFF_REQUIRED",
        i18nMessage("errors.HANDOFF_REQUIRED.the.handoff.record.must.not.be"),
      );
    // 仅规范空白正文；真实交接内容保持用户原文。
    if (typeof record === "string" && !record.trim()) record = "";
    const rawTargetId = targetId;
    if (sourceExecutionId) this.handoffIdentity(itemId, sourceExecutionId);
    const hash = digest(
      JSON.stringify({
        itemId,
        targetId,
        record,
        sourceExecutionId,
        ...(artifactRequest ? { artifactRequest } : {}),
        ...(expected ? { expected } : {}),
        ...(batch ? { receipt: batch.receipt } : {}),
      }),
    );
    return this.store.transaction(() => {
      const old = this.store.db
        .prepare("SELECT * FROM operations WHERE id=?")
        .get(operationId) as any;
      if (old) {
        ensure(
          old.hash === hash && old.scope === itemId,
          "IDEMPOTENCY_CONFLICT",
          i18nMessage(
            "errors.IDEMPOTENCY_CONFLICT.repeated.operation.parameters.do.not.match",
          ),
          409,
        );
        return JSON.parse(old.result);
      }
      if (sourceExecutionId)
        targetId = this.resolveHandoffTarget(
          itemId,
          sourceExecutionId,
          rawTargetId,
          !handoffInput,
        );
      const item = this.store.get("items", itemId);
      // 防重回放优先于版本检查；新操作必须仍对应用户看到的来源。
      if (
        expected &&
        (item.stageId !== expected.stageId || item.version !== expected.version)
      )
        handoffError("ITEM_ADVANCE_CONFLICT");
      const b = this.store.get<Board>("boards", item.boardId);
      ensure(
        b.stages.some((s) => s.id === item.stageId),
        "STAGE_DELETED",
        i18nMessage("errors.STAGE_DELETED.the.original.stage.was.deleted.the"),
        409,
      );
      // 历史阶段缺少权限时固定为询问，不能在派发时套用智能体新默认值。
      const stage = stageSchema.parse(
        b.stages.find((s) => s.id === item.stageId)!,
      );
      ensure(
        typeof record === "string" &&
          (record.trim() || (stage.type === "human" && !sourceExecutionId)),
        "HANDOFF_REQUIRED",
        i18nMessage("errors.HANDOFF_REQUIRED.the.handoff.record.must.not.be"),
      );
      const target = b.stages.find((s) => s.id === targetId);
      ensure(
        !item.archived && target && stage.targets.includes(targetId),
        "INVALID_TRANSITION",
        i18nMessage(
          "errors.INVALID_TRANSITION.this.transition.is.not.allowed.from",
        ),
      );
      if (sourceExecutionId)
        ensure(
          stage.type === "agent" && item.executionId === sourceExecutionId,
          "STALE_EXECUTION",
          i18nMessage("errors.STALE_EXECUTION.the.execution.has.expired"),
        );
      const execution = item.executionId
        ? this.execution(item.executionId)
        : null;
      if (sourceExecutionId)
        ensure(
          execution &&
            ["running", "waiting", "unknown"].includes(execution.state),
          "STALE_EXECUTION",
          i18nMessage(
            "errors.STALE_EXECUTION.finished.or.stopping.executions.cannot.advance",
          ),
        );
      if (!sourceExecutionId)
        ensure(
          !execution ||
            ![
              "dispatching",
              "running",
              "waiting",
              "unknown",
              "stopping",
            ].includes(execution.state),
          "BUSY",
          i18nMessage(
            "errors.BUSY.stop.the.current.execution.before.advancing",
          ),
        );
      if (artifacts.length) {
        this.validateArtifactHandoff(itemId, sourceExecutionId!, rawTargetId);
        for (const artifact of artifacts) {
          const saved = this.store.get("artifacts", artifact.id);
          ensure(
            saved.operationId === operationId &&
              saved.itemId === itemId &&
              saved.executionId === sourceExecutionId &&
              saved.ready,
            "ARTIFACT_SCOPE",
            i18nMessage("errors.ARTIFACT_SCOPE.the.artifact.is.not.ready.or"),
            403,
          );
        }
      }
      if (execution)
        this.store.db
          .prepare("UPDATE executions SET state='completed' WHERE id=?")
          .run(execution.id);
      const handoff = this.store.put("handoffs", {
        ...(batch
          ? { attachments: batch.bind(b.id, targetId, operationId, itemId) }
          : {}),
        itemId,
        from: stage.id,
        to: targetId,
        fromStage: stageDescriptor(stage),
        toStage: stageDescriptor(target),
        record,
        executionId: item.executionId || null,
        artifacts: artifacts.map((a) => ({
          id: a.id,
          name: a.name,
          size: a.size,
          mime: a.mime,
          kind: a.kind,
          sha256: a.sha256,
        })),
      });
      for (const artifact of artifacts)
        this.store.put("artifacts", { handoffId: handoff.id }, artifact.id);
      const next = this.store.put(
        "items",
        {
          stageId: targetId,
          status:
            target.type === "done"
              ? "done"
              : target.type === "agent"
                ? "queued"
                : "human",
          executionId: null,
        },
        item.id,
      );
      if (target.type === "agent") this.queue(next, b);
      this.store.db
        .prepare("INSERT INTO operations VALUES(?,?,?,?,?)")
        .run(operationId, itemId, hash, "completed", JSON.stringify(next));
      return next;
    });
  }
  /** 完成操作重放仍核对身份及归属，但不要求工作项停在旧阶段。 */
  private handoffIdentity(itemId: string, executionId: string) {
    const execution = this.execution(executionId);
    const item = this.store.get("items", itemId);
    const session = this.store.get("sessions", execution.session_id);
    ensure(
      execution.item_id === itemId &&
        session.environmentId === execution.environment_id &&
        session.projectId === this.store.get("boards", item.boardId).projectId,
      "SCOPE",
      i18nMessage("errors.SCOPE.execution.ownership.does.not.match"),
      403,
    );
    const env = this.store.get("environments", execution.environment_id);
    ensure(
      env.approved && !env.revoked,
      "REVOKED",
      i18nMessage("errors.REVOKED.the.environment.identity.has.been.revoked"),
      403,
    );
    return { execution, item };
  }
  /** 所有交接入口共用执行快照解析；当前配置只能缩小权限，不能扩大。 */
  resolveHandoffTarget(
    itemId: string,
    executionId: string,
    rawTarget: string,
    internal = false,
  ) {
    const { execution, item } = this.handoffIdentity(itemId, executionId);
    const snapshot = JSON.parse(execution.snapshot);
    const contract = readHandoff(snapshot);
    ensure(
      item.executionId === executionId &&
        execution.item_id === itemId &&
        snapshot.stage?.id === item.stageId &&
        !item.archived &&
        ["running", "waiting", "unknown"].includes(execution.state),
      "STALE_EXECUTION",
      i18nMessage(
        "errors.STALE_EXECUTION.the.execution.has.expired.or.stopped",
      ),
      409,
    );
    if (contract.boardId !== item.boardId)
      handoffError("HANDOFF_SNAPSHOT_INVALID");
    const target = contract.allowedTargets.find((s) =>
      internal ? s.id === rawTarget : s.shortId === rawTarget,
    );
    if (!target) handoffError("INVALID_HANDOFF_TARGET");
    const targetId = target.id;
    const board = this.store.get<Board>("boards", item.boardId);
    const source = board.stages.find((s) => s.id === item.stageId);
    ensure(
      source && board.stages.some((s) => s.id === targetId),
      "STAGE_DELETED",
      i18nMessage("errors.STAGE_DELETED.the.stage.was.deleted"),
      409,
    );
    ensure(
      source.type === "agent" &&
        source.targets.includes(targetId) &&
        snapshot.stage.targets.includes(targetId),
      "INVALID_TRANSITION",
      i18nMessage(
        "errors.INVALID_TRANSITION.this.transition.is.not.allowed.from",
      ),
    );
    return targetId;
  }
  /** 上传与最终交接共同校验权限，停止、撤销和关闭开关立即阻止后续分块。 */
  validateArtifactHandoff(
    itemId: string,
    executionId: string,
    targetId: string,
  ) {
    targetId = this.resolveHandoffTarget(itemId, executionId, targetId);
    const item = this.store.get("items", itemId);
    const execution = this.execution(executionId);
    const board = this.store.get<Board>("boards", item.boardId);
    const stage = board.stages.find((s) => s.id === item.stageId);
    ensure(
      !item.archived &&
        item.executionId === executionId &&
        execution.item_id === itemId &&
        ["running", "waiting", "unknown"].includes(execution.state),
      "STALE_EXECUTION",
      i18nMessage(
        "errors.STALE_EXECUTION.the.execution.has.expired.or.stopped",
      ),
      409,
    );
    ensure(
      stage?.type === "agent" && stage.targets.includes(targetId),
      "INVALID_TRANSITION",
      i18nMessage(
        "errors.INVALID_TRANSITION.this.transition.is.not.allowed.from",
      ),
    );
    ensure(
      stage.allowArtifacts &&
        JSON.parse(execution.snapshot).stage?.allowArtifacts,
      "ARTIFACT_DISABLED",
      i18nMessage(
        "errors.ARTIFACT_DISABLED.artifact.submission.is.not.enabled.for",
      ),
      403,
    );
    const environment = this.store.get(
      "environments",
      execution.environment_id,
    );
    ensure(
      environment.approved && !environment.revoked,
      "REVOKED",
      i18nMessage("errors.REVOKED.the.environment.identity.has.been.revoked"),
      403,
    );
    return { execution, stage: JSON.parse(execution.snapshot).stage };
  }
  retry(id: string) {
    return this.store.transaction(() => {
      const item = this.store.get("items", id);
      ensure(
        !item.archived,
        "ARCHIVED",
        i18nMessage("errors.ARCHIVED.restore.the.work.item.before.retrying"),
      );
      ensure(
        ["completed", "failed", "cancelled"].includes(item.status),
        "INVALID_STATE",
        i18nMessage(
          "errors.INVALID_STATE.only.finished.agent.executions.can.be",
        ),
      );
      const b = this.store.get<Board>("boards", item.boardId);
      ensure(
        b.stages.find((s) => s.id === item.stageId)?.type === "agent",
        "INVALID_STAGE",
        i18nMessage("errors.INVALID_STAGE.the.current.stage.is.not.an"),
      );
      this.queue(item, b);
      return this.store.get("items", id);
    });
  }
  private ticking = false;
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const queued = this.store.db
        .prepare(
          "SELECT * FROM executions WHERE state='queued' ORDER BY created_at",
        )
        .all() as unknown as Execution[];
      for (const e of queued) {
        // 队列扫描后可能有人取消；每次派发前复核持久化状态。
        if (this.execution(e.id).state !== "queued") continue;
        const peer = this.peers.get(e.environment_id);
        if (!peer || this.updating(e.environment_id)) continue;
        const snapshot = JSON.parse(e.snapshot);
        const { stage, agent, continuation } = snapshot;
        const session = this.store.get("sessions", e.session_id);
        const environment = this.store.get("environments", e.environment_id);
        if (!this.enabledRuntimes(environment).includes(session.runtime)) continue;
        if (session.permission === "auto" && !environment.capabilities?.includes(autoApprovalCapability)) continue;
        if (
          !environment.capabilities?.includes(handoffCapability)
        )
          continue;
        const currentItem = this.store.get("items", e.item_id!);
        if (
          currentItem.archived ||
          currentItem.executionId !== e.id ||
          currentItem.stageId !== stage.id
        ) {
          this.setState(e.id, "cancelled");
          continue;
        }
        // 配置保存后，所有排队执行共享当前看板的阶段名额，其他参数仍取快照。
        const board = this.store.get<Board>("boards", currentItem.boardId);
        const currentStage = board.stages.find((entry) => entry.id === stage.id)!;
        const occupied = this.store.db.prepare(`
          SELECT count(*) AS n FROM executions e JOIN entities i ON i.id=e.item_id
          WHERE i.kind='items' AND json_extract(i.body,'$.boardId')=?
            AND json_extract(e.snapshot,'$.stage.id')=?
            AND e.state IN ('dispatching','running','waiting','unknown','stopping')
        `).get(board.id, stage.id)!;
        if (Number(occupied.n) >= currentStage.concurrency) continue;
        this.setState(e.id, "dispatching");
        // 阶段任务实际派发时记录输入时间，排队等待不算发送用户消息。
        this.store.put(
          "sessions",
          { lastUserMessageAt: new Date().toISOString() },
          e.session_id,
        );
        const item = this.store.get("items", e.item_id!);
        try {
          this.requireRuntimeOptions(session, agent);
          const supportsTitle = environment.capabilities?.includes(boardSessionTitleCapability);
          if (snapshot.initialSessionTitle && !supportsTitle)
            console.warn(JSON.stringify({ event: "board.sessionTitle.unsupported", sessionId: session.id, executionId: e.id }));
          const result = await peer.call(
            continuation ? "execution.startPrepared" : "execution.start",
            continuation
              ? { executionId: e.id }
              : {
                  ...(supportsTitle && snapshot.initialSessionTitle ? { initialSessionTitle: snapshot.initialSessionTitle } : {}),
                  operationId: e.id,
                  executionId: e.id,
                  session: { ...session, boardTools: this.store.get("environments", session.environmentId).capabilities?.includes(boardCapability), agent },
                  message: item.content,
                  workflow: {
                    itemId: item.id,
                    ...handoffProjection(snapshot),
                    title: item.title,
                    instructions: stage.instructions,
                    allowArtifacts: !!stage.allowArtifacts,
                    handoffs: this.dispatchHistory(
                      item.id,
                      session.environmentId,
                      snapshot.locale,
                    ),
                  },
                },
            60000,
          );
          this.setState(e.id, result.status || "running", result.stateVersion);
        } catch (err) {
          this.setState(
            e.id,
            err instanceof AppError &&
              ["STATUS_UNKNOWN", "OFFLINE"].includes(err.code)
              ? "unknown"
              : "failed",
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }
  /** 连接恢复后从环境同步已登记索引的标题，不发现或导入其他原生会话。 */
  async syncSessionTitles(environmentId: string, peer: RpcPeer) {
    const ids = this.store
      .list("sessions")
      .filter((s) => s.environmentId === environmentId)
      .map((s) => s.id);
    for (let offset = 0; offset < ids.length; offset += 20) {
      const batch = ids.slice(offset, offset + 20);
      try {
        const titles = await peer.call("session.titles", { ids: batch });
        if (Array.isArray(titles))
          for (const row of titles)
            if (batch.includes(row.id))
              this.syncSessionTitle(row.id, row.title);
      } catch {
        // 旧连接器没有标题接口时仍允许连接，在打开会话后继续使用历史同步。
        return;
      }
    }
  }
  reconciliationExecutions(environmentId: string) {
    return this.store.db
      .prepare(
        // 交接完成仅代表调度推进；会话仍忙碌时必须查询原生事实，不能提前标记结束。
        `SELECT e.* FROM executions e WHERE e.environment_id=? AND (
          e.state IN ('dispatching','running','waiting','unknown','stopping') OR (
            e.state IN ('completed','cancelled','failed') AND EXISTS (
              SELECT 1 FROM entities s WHERE s.kind='sessions' AND s.id=e.session_id
                AND json_extract(s.body,'$.executionId')=e.id
                AND json_extract(s.body,'$.status') IN ('queued','dispatching','running','waiting','unknown','stopping')
            )
          )
        )`,
      )
      .all(environmentId) as unknown as Execution[];
  }
  async reconcile(environmentId: string, peer: RpcPeer) {
    const all = this.reconciliationExecutions(environmentId);
    for (const e of all) {
      const result = await peer.call("execution.status", { executionId: e.id });
      this.setState(
        e.id,
        result.status === "not_found" ? "unknown" : result.status,
        result.stateVersion,
      );
    }
  }
}
