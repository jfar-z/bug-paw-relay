import { message as i18nMessage } from "../shared/i18n.js";
import { connectorStorageDetails } from "../shared/connector-storage-errors.js";
import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ensure, AppError } from "../shared/contracts.js";
import {
  updateMessages,
  blockerIdentity,
  nodeUpdateBlockers,
  updateBlockersCapability,
  type NodeUpdateBlocker,
  updateCompatibilityReason,
  compatibilityErrors,
  updateMessage,
  updateRequestSchema,
  updateTargetSchema,
  updateReportSchema,
  updateTerminal,
  type UpdateTarget,
} from "../shared/connector-update.js";
import { connectorUpdate, readConnectorRelease } from "./connector-release.js";
import type { Execution, Service } from "./service.js";
import type { RpcPeer } from "../shared/rpc.js";

const busyExecutionStates =
  "('dispatching','running','waiting','unknown','stopping')";
const ended = (state: string) =>
  ["completed", "failed", "cancelled"].includes(state);

/** 服务端只保存发行快照和操作索引，节点更新授权不包含浏览器会话。 */
export class ConnectorUpdates {
  private polling = new Set<string>();
  constructor(
    private service: Service,
    private webDir?: string,
    private transferBusy: (id: string) => boolean = () => false,
  ) {
    service.updateView = (id) => this.view(id);
  }
  active(id: string) {
    return this.service.store
      .list("connectorUpdates")
      .find((o) => o.environmentId === id && !updateTerminal(o.state));
  }
  get(id: string, operationId: string) {
    const o = this.service.store.get("connectorUpdates", operationId);
    ensure(
      o.environmentId === id,
      "NOT_FOUND",
      i18nMessage("errors.NOT_FOUND.update.operation.not.found"),
      404,
    );
    return o;
  }
  target(id: string): UpdateTarget | null {
    const env = this.service.store.get("environments", id);
    const release = readConnectorRelease(this.webDir);
    const item = release?.releases.find(
      (r) =>
        `${r.platform === "windows" ? "win32" : "linux"}/${r.arch}` ===
        env.platform,
    );
    const parsed = updateTargetSchema.safeParse({
      ...item,
      version: release?.version,
      buildId: release?.revision,
      updateProtocol: release?.updateProtocol,
      dataFormat: release?.dataFormat,
      rollbackCompatible: release?.rollbackCompatible,
      compatibility: release?.compatibility,
    });
    return parsed.success ? parsed.data : null;
  }
  view(id: string) {
    const env = this.service.store.get("environments", id),
      target = this.target(id),
      activeOperation = this.active(id) || null;
    const busy = this.service.store.db
      .prepare(
        `SELECT id FROM executions WHERE environment_id=? AND state IN ${busyExecutionStates} LIMIT 1`,
      )
      .get(id);
    const capability = !!env.capabilities?.includes("connector-update-v3");
    const compatibilityReason =
      env.updateInstallation?.blockedReason ||
      (target?.updateProtocol === 3 &&
      env.updateInstallation?.current &&
      !/^[a-f0-9]{40}$/.test(env.connectorBuildId || "")
        ? "COMPATIBILITY_UNKNOWN"
        : null) ||
      (target
        ? updateCompatibilityReason(
            env.updateInstallation?.current || null,
            target,
          )
        : null);
    const blockedReason =
      env.revoked || !env.approved
        ? "REVOKED"
        : activeOperation
          ? "UPDATE_IN_PROGRESS"
          : !this.service.peers.has(id)
            ? "ENVIRONMENT_OFFLINE"
            : !capability
              ? "UPDATE_UNSUPPORTED"
              : !env.updateInstallation?.managed
                ? target?.updateProtocol === 3 &&
                  !env.capabilities?.includes("connector-update-v3")
                  ? "BOOTSTRAP_REQUIRED"
                  : env.updateInstallation?.blockedReason || "UNMANAGED_INSTALL"
                : !env.connectorVersion
                  ? "UPDATE_UNSUPPORTED"
                  : !target
                    ? readConnectorRelease(this.webDir)?.releases.some(
                        (r) =>
                          `${r.platform === "windows" ? "win32" : "linux"}/${r.arch}` ===
                          env.platform,
                      )
                      ? "PACKAGE_UNAVAILABLE"
                      : readConnectorRelease(this.webDir)
                        ? "PLATFORM_MISMATCH"
                        : "PACKAGE_UNAVAILABLE"
                    : compatibilityReason
                      ? compatibilityReason
                      : env.connectorVersion === target.version
                        ? "ALREADY_CURRENT"
                        : busy || this.transferBusy(id)
                          ? "ENVIRONMENT_BUSY"
                          : null;
    return {
      ...connectorUpdate(
        env.connectorVersion,
        env.platform,
        readConnectorRelease(this.webDir),
      ),
      capability,
      compatibility: {
        current: env.updateInstallation?.current || null,
        target: target?.compatibility || null,
        reason: compatibilityReason,
      },
      eligible: !blockedReason,
      blockedReason,
      target,
      activeOperation,
      latestOperation:
        this.service.store
          .list("connectorUpdates")
          .filter((o) => o.environmentId === id)
          .at(-1) || null,
    };
  }
  private approvedEnvironment(id: string) {
    const env = this.service.store.get("environments", id);
    ensure(
      env.approved && !env.revoked,
      "REVOKED",
      updateMessage("REVOKED"),
      403,
    );
    return env;
  }
  /** 按需读取两端实时索引。旧节点和断连只影响明细可用性。 */
  async blockers(id: string) {
    const env = this.approvedEnvironment(id);
    const peer = this.service.peers.get(id);
    let nodeDetails = "available";
    let local: NodeUpdateBlocker[] = [];
    const reasons = new Set<string>();
    if (!peer) nodeDetails = "offline";
    else if (!env.capabilities?.includes(updateBlockersCapability)) {
      nodeDetails = "unsupported";
      if (env.capabilities?.includes("connector-update-v3")) {
        // 旧节点只能按已知执行号查询。复用断线对账的候选，涵盖已交接但会话仍忙的执行。
        const deadline = Date.now() + 5000;
        for (const e of this.service.reconciliationExecutions(id)) {
          if (Date.now() >= deadline) break;
          try {
            const result = await peer.call(
              "execution.status",
              { executionId: e.id },
              deadline - Date.now(),
            );
            const status =
              result.status === "dispatching" ? "starting" : result.status;
            if (
              [
                "starting",
                "running",
                "waiting",
                "stopping",
                "unknown",
              ].includes(status)
            ) {
              local.push({
                executionId: e.id,
                sessionId: e.session_id,
                status,
                waitingFor: status === "waiting" ? "interaction" : null,
                canStop: status === "running" || status === "waiting",
              });
            }
          } catch {
            break;
          }
        }
      }
    } else {
      try {
        const result = nodeUpdateBlockers.parse(
          await peer.call("connector.update.blockers"),
        );
        local = result.executions;
        for (const reason of result.reasons) reasons.add(reason);
      } catch {
        nodeDetails = "unavailable";
      }
    }
    this.approvedEnvironment(id);
    if (peer && this.service.peers.get(id) !== peer) {
      nodeDetails = "unavailable";
      local = [];
      reasons.clear();
    }
    if (this.transferBusy(id)) reasons.add("transfer");
    const store = this.service.store;
    const active = store.db
      .prepare(
        `SELECT * FROM executions WHERE environment_id=? AND state IN ${busyExecutionStates}`,
      )
      .all(id) as unknown as Execution[];
    const indexed = new Map(active.map((e) => [e.id, e]));
    const confirmed = new Map<string, NodeUpdateBlocker>();
    for (const row of local) {
      const e =
        indexed.get(row.executionId) ||
        (store.db
          .prepare(
            "SELECT * FROM executions WHERE environment_id=? AND session_id=? AND id=?",
          )
          .get(id, row.sessionId, row.executionId) as unknown as
          Execution | undefined);
      if (!e || e.session_id !== row.sessionId) {
        reasons.add("unidentified");
        continue;
      }
      indexed.set(e.id, e);
      confirmed.set(e.id, row);
    }
    const executions = [...indexed.values()].flatMap((e) => {
      const session = store.findBy("sessions", "id", e.session_id)[0];
      if (session?.environmentId !== id) {
        reasons.add("unidentified");
        return [];
      }
      const project =
        session.projectId &&
        store.findBy("projects", "id", session.projectId)[0];
      const item = e.item_id ? store.findBy("items", "id", e.item_id)[0] : null;
      const node = confirmed.get(e.id);
      return [
        {
          executionId: e.id,
          sessionId: session.id,
          sessionTitle: session.title,
          projectId: session.projectId ?? null,
          projectName: project?.name ?? null,
          itemTitle: item?.title ?? null,
          stageName: JSON.parse(e.snapshot).stage?.name ?? null,
          serverStatus: e.state,
          nodeStatus: node?.status ?? null,
          waitingFor:
            node?.waitingFor ??
            (e.state === "waiting" && !node ? "interaction" : null),
          canStop: node?.canStop === true,
        },
      ];
    });
    return {
      environmentId: id,
      nodeDetails,
      reasons: [...reasons],
      executions,
    };
  }
  async stopBlocker(id: string, input: unknown) {
    const { executionId, sessionId } = blockerIdentity.parse(input);
    const env = this.approvedEnvironment(id);
    const e = this.service.execution(executionId);
    ensure(
      e.environment_id === id &&
        e.session_id === sessionId &&
        this.service.store.get("sessions", sessionId).environmentId === id,
      "NOT_FOUND",
      i18nMessage("errors.NOT_FOUND.execution.not.found"),
      404,
    );
    const scoped = env.capabilities?.includes(updateBlockersCapability);
    ensure(
      scoped || env.capabilities?.includes("connector-update-v3"),
      "UPDATE_UNSUPPORTED",
      updateMessage("UPDATE_UNSUPPORTED"),
      409,
    );
    const peer = this.service.peer(id);
    if (scoped) {
      const result = await peer.call("connector.update.stopBlocker", {
        executionId,
        sessionId,
      });
      if (result?.outcome === "alreadyEnded" && ended(result.status))
        return { outcome: "alreadyEnded", status: result.status };
    } else {
      // 协议三节点的取消与状态查询均按不可复用的执行号寻址，提交前再次读取。
      const { status } = await peer.call("execution.status", { executionId });
      if (ended(status)) return { outcome: "alreadyEnded", status };
      ensure(
        ["running", "waiting", "stopping"].includes(status),
        "STATUS_UNKNOWN",
        i18nMessage("errors.STATUS_UNKNOWN.the.native.process.is.unavailable"),
        409,
      );
      if (status !== "stopping")
        await peer.call("execution.cancel", { executionId });
    }
    // 终止回执只表示已请求，必须由同一连接上的执行账本确认最终状态。
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const { status } = await peer.call(
        "execution.status",
        { executionId },
        deadline - Date.now(),
      );
      if (ended(status)) return { outcome: "ended", status };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new AppError(
      "STATUS_UNKNOWN",
      i18nMessage("errors.STATUS_UNKNOWN.the.request.timed.out.check.the"),
      504,
    );
  }
  /** 同步建立环境锁后才发送 RPC，超时保留原操作供对账。 */
  start(id: string, input: unknown) {
    const request = updateRequestSchema.parse(input),
      store = this.service.store;
    const previous = store
      .list("connectorUpdates")
      .find((o) => o.id === request.operationId);
    if (previous) {
      ensure(
        previous.environmentId === id &&
          JSON.stringify(previous.request) === JSON.stringify(request),
        "IDEMPOTENCY_CONFLICT",
        i18nMessage(
          "errors.IDEMPOTENCY_CONFLICT.the.operation.id.was.used.for",
        ),
        409,
      );
      return previous;
    }
    ensure(
      !store.db
        .prepare("SELECT id FROM entities WHERE id=?")
        .get(request.operationId) &&
        !store.db
          .prepare("SELECT id FROM operations WHERE id=?")
          .get(request.operationId),
      "IDEMPOTENCY_CONFLICT",
      i18nMessage(
        "errors.IDEMPOTENCY_CONFLICT.the.operation.id.has.already.been",
      ),
      409,
    );
    const operation = store.transaction(() => {
      const view = this.view(id),
        env = store.get("environments", id);
      ensure(
        !view.blockedReason,
        view.blockedReason || "UPDATE_IN_PROGRESS",
        updateMessage(view.blockedReason || ""),
        409,
      );
      const target = view.target!;
      ensure(
        env.connectorVersion === request.expectedCurrentVersion &&
          target.version === request.targetVersion &&
          target.sha256 === request.targetSha256,
        "TARGET_CHANGED",
        updateMessage("TARGET_CHANGED"),
        409,
      );
      return store.put(
        "connectorUpdates",
        {
          environmentId: id,
          operationId: request.operationId,
          request,
          target,
          state: "accepted",
          lastConfirmedState: "accepted",
          stateVersion: -1,
          downloadedBytes: 0,
          actualVersion: env.connectorVersion,
          actualBuildId: null,
          previousBuildId: env.connectorBuildId || null,
          errorCode: null,
          message: null,
          retryable: false,
          completedAt: null,
        },
        request.operationId,
      );
    });
    void this.dispatch(id, operation.id);
    return operation;
  }
  private async dispatch(id: string, operationId: string) {
    const peer = this.service.peers.get(id);
    if (!peer) return;
    const operation = this.get(id, operationId);
    try {
      const report = await peer.call("connector.update.prepare", {
        operationId,
        expectedCurrentVersion: operation.request.expectedCurrentVersion,
        target: operation.target,
      });
      await this.report(id, report, peer);
      if (!updateTerminal(this.get(id, operationId).state)) {
        await peer.call("connector.update.start", {
          operationId,
          grant: this.issue(id, operationId),
        });
      }
    } catch (error) {
      // 只有节点明确的无副作用拒绝可释放锁；网络超时不能判成失败。
      if (
        error instanceof AppError &&
        [
          ...compatibilityErrors,
          "ENVIRONMENT_BUSY",
          // 本机只读探测失败时尚未创建升级日志，可以释放服务端维护锁。
          "ENGINE_UNAVAILABLE",
          "ENGINE_BUSY",
          "ENGINE_TIMEOUT",
          "ENGINE_FAILURE",
          "STORAGE_UNAVAILABLE",
          "UNMANAGED_INSTALL",
          "TARGET_CHANGED",
          "INCOMPATIBLE_PACKAGE",
          "INSTALL_PERMISSION_DENIED",
          "INSUFFICIENT_SPACE",
        ].includes(error.code)
      ) {
        const latest = this.get(id, operationId);
        if (latest.stateVersion < 0)
          this.service.store.put(
            "connectorUpdates",
            {
              state: "failed",
              errorCode: error.code,
              message: updateMessages[error.code],
              ...updateMessage(error.code),
              ...connectorStorageDetails(error.code),
              retryable: true,
              completedAt: new Date().toISOString(),
            },
            operationId,
          );
      }
    }
  }
  issue(id: string, operationId: string) {
    const o = this.get(id, operationId),
      env = this.service.store.get("environments", id);
    ensure(
      env.approved && !env.revoked && !updateTerminal(o.state),
      "DOWNLOAD_UNAUTHORIZED",
      updateMessage("DOWNLOAD_UNAUTHORIZED"),
      403,
    );
    const expiresAt = Date.now() + 600000;
    const grant = Buffer.from(
      this.service.vault.seal(
        JSON.stringify({
          purpose: "connector-update",
          environmentId: id,
          operationId,
          file: o.target.file,
          sha256: o.target.sha256,
          expiresAt,
        }),
      ),
      "base64",
    ).toString("base64url");
    return { grant, expiresAt };
  }
  verify(authorization: unknown, operationId: string) {
    let d: any;
    try {
      const header = z
        .string()
        .max(8192)
        .regex(/^Bearer [A-Za-z0-9_-]+$/)
        .parse(authorization);
      d = JSON.parse(
        this.service.vault.open(
          Buffer.from(header.slice(7), "base64url").toString("base64"),
        ),
      );
    } catch {
      throw new AppError(
        "DOWNLOAD_UNAUTHORIZED",
        updateMessage("DOWNLOAD_UNAUTHORIZED"),
        403,
      );
    }
    ensure(
      d.purpose === "connector-update" &&
        d.operationId === operationId &&
        d.expiresAt > Date.now(),
      "DOWNLOAD_EXPIRED",
      updateMessage("DOWNLOAD_EXPIRED"),
      403,
    );
    const o = this.get(d.environmentId, operationId),
      env = this.service.store.get("environments", d.environmentId);
    ensure(
      !env.revoked &&
        env.approved &&
        !updateTerminal(o.state) &&
        d.file === o.target.file &&
        d.sha256 === o.target.sha256,
      "DOWNLOAD_UNAUTHORIZED",
      updateMessage("DOWNLOAD_UNAUTHORIZED"),
      403,
    );
    return o;
  }
  /** 每个 HTTP/Range 请求验证冻结摘要；同名文件被替换时明确拒绝，绝不改目标。 */
  async packageFile(authorization: unknown, operationId: string) {
    const o = this.verify(authorization, operationId);
    const path = join(this.webDir || "", "downloads", o.target.file);
    try {
      ensure(
        statSync(path).size === o.target.size,
        "PACKAGE_UNAVAILABLE",
        updateMessage("PACKAGE_UNAVAILABLE"),
        409,
      );
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      ensure(
        hash.digest("hex") === o.target.sha256,
        "PACKAGE_UNAVAILABLE",
        updateMessage("PACKAGE_UNAVAILABLE"),
        409,
      );
    } catch {
      throw new AppError(
        "PACKAGE_UNAVAILABLE",
        updateMessage("PACKAGE_UNAVAILABLE"),
        409,
      );
    }
    this.verify(authorization, operationId);
    return { path, size: o.target.size };
  }
  async report(id: string, input: unknown, peer: RpcPeer) {
    const r = updateReportSchema.parse(input),
      o = this.get(id, r.operationId);
    ensure(
      JSON.stringify(r.target) === JSON.stringify(o.target),
      "TARGET_CHANGED",
      updateMessage("TARGET_CHANGED"),
      409,
    );
    if (r.stateVersion < o.stateVersion || updateTerminal(o.state)) return o;
    if (
      r.stateVersion === o.stateVersion &&
      !["reconciling", "recovery_required"].includes(o.state)
    )
      return o;
    const env = this.service.store.get("environments", id);
    let state: string = r.state;
    // 成功必须来自新版本认证连接，不能仅相信旧进程的“安装成功”通知。
    if (["succeeded", "reconciling"].includes(state)) {
      if (
        env.connectorVersion !== o.target.version ||
        env.connectorBuildId !== o.target.buildId ||
        r.actualVersion !== o.target.version ||
        r.actualBuildId !== o.target.buildId
      )
        state = "reconciling";
      else {
        await peer.call("connector.update.confirm", {
          operationId: o.id,
          targetSha256: o.target.sha256,
        });
        state = "succeeded";
      }
    }
    if (state === "recovered") {
      ensure(
        env.capabilities?.includes("connector-update-v3") &&
          env.connectorVersion === r.actualVersion &&
          env.connectorBuildId === r.actualBuildId,
        "RECOVERY_REQUIRED",
        updateMessage("RECOVERY_REQUIRED"),
      );
    }
    return this.service.store.put(
      "connectorUpdates",
      {
        ...r,
        state,
        message: r.errorCode
          ? updateMessages[r.errorCode] || updateMessages.RECOVERY_REQUIRED
          : null,
        ...(r.errorCode
          ? updateMessage(r.errorCode)
          : { messageKey: null, messageParams: {} }),
        retryable: state === "failed",
        completedAt: updateTerminal(state) ? new Date().toISOString() : null,
      },
      o.id,
    );
  }
  async reconcile(id: string, peer: RpcPeer) {
    const o = this.active(id);
    if (!o || this.polling.has(id)) return;
    this.polling.add(id);
    try {
      const r = await peer.call("connector.update.status", {
        operationId: o.id,
      });
      const env = this.service.store.get("environments", id);
      if (
        env.capabilities?.includes("connector-update-v3") &&
        (r?.state === "recovery_required" ||
          (r?.state === "not_found" && o.target.updateProtocol === 3)) &&
        env.connectorVersion !== o.request.expectedCurrentVersion
      ) {
        // 手工安装新完整包时原安装日志可能不在新目录；按实际认证版本恢复，禁止重派安装。
        const recovered = await peer.call("connector.update.recover", {
          operationId: o.id,
          target: o.target,
          expectedCurrentVersion: o.request.expectedCurrentVersion,
        });
        await this.report(
          id,
          {
            ...recovered,
            stateVersion: Math.max(recovered.stateVersion, o.stateVersion + 1),
          },
          peer,
        );
      } else if (r?.state === "not_found") {
        if (["accepted", "prechecking"].includes(o.state))
          await this.dispatch(id, o.id);
      } else {
        await this.report(id, r, peer);
        if (["accepted", "prechecking"].includes(r.state))
          await peer.call("connector.update.start", {
            operationId: o.id,
            grant: this.issue(id, o.id),
          });
      }
    } finally {
      this.polling.delete(id);
    }
  }
  async poll() {
    // 超时只改变展示，不释放锁，不伪造节点失败，也不重复安装。
    for (const o of this.service.store.list("connectorUpdates")) {
      if (
        !updateTerminal(o.state) &&
        o.state !== "recovery_required" &&
        !this.service.peers.has(o.environmentId) &&
        Date.now() - Date.parse(o.updatedAt) > 180000
      )
        this.service.store.put(
          "connectorUpdates",
          {
            state: "recovery_required",
            errorCode: "RECOVERY_REQUIRED",
            message: updateMessages.RECOVERY_REQUIRED,
            ...updateMessage("RECOVERY_REQUIRED"),
          },
          o.id,
        );
    }
    await Promise.allSettled(
      [...this.service.peers].map(([id, peer]) => this.reconcile(id, peer)),
    );
  }
}
