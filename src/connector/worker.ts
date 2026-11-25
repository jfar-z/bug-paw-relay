import { LightBackend } from "./light-backend.js";
import { backendCapability } from "../shared/light-apps.js";
import { boardSessionTitleCapability } from "../shared/stage-handoff.js";
import { boardCapability } from "../shared/session-boards.js";
import { commandCapability } from "../shared/slash-commands.js";
import { updateBlockersCapability } from "../shared/connector-update.js";
import { autoApprovalCapability } from "../shared/permission-policy.js";
import { claudeSdkCapability } from "../shared/claude-sdk-install.js";
import { installRemoteSdk, remoteSdkStatus } from "./claude-support.js";
import { environmentModelConfig } from "./model-tools.js";
import {
  modelConfigCapability,
  modelOperation,
} from "../shared/environment-model-config.js";
import { errorBody } from "../shared/i18n-errors.js";
import { message as i18nMessage } from "../shared/i18n.js";
import {
  connectorStorageZh,
  connectorStorageDetails,
} from "../shared/connector-storage-errors.js";
import { claimInstallation } from "./update-installation.js";
import { ConnectorUpdater } from "./updater.js";
import { nodeAuthVersion, nodeProofText } from "../shared/node-identity.js";
import { sign, randomUUID } from "node:crypto";
import {
  readFileSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  openSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import Fastify from "fastify";
import { EngineClient } from "./engine-client.js";
import { ConnectorDiagnostics } from "./diagnostics.js";
import {
  ConnectionDiagnostics,
  closeCategory,
} from "../shared/connection-diagnostics.js";
import { token } from "../server/security.js";
import { RpcPeer } from "../shared/rpc.js";
import { AppError, ensure } from "../shared/contracts.js";
import { ConnectorConfig, validateServerUrl } from "./config.js";
import { workerStatus } from "./process.js";
import { readConnectorVersion } from "./version.js";
import { probeCli } from "./host-cli.js";
/** 独立连接器进程，网页关闭不停止任务；控制通道用于跨平台安全启停。 */
export async function runWorker(settings: ConnectorConfig) {
  const config = settings.read();
  ensure(
    config.environmentId && config.privateKey,
    "NOT_REGISTERED",
    i18nMessage("errors.NOT_REGISTERED.run.web.or.configure.register.to"),
  );
  validateServerUrl(config.serverUrl);
  claimInstallation(settings.dir);
  ensure(
    !(await workerStatus(settings)).running,
    "ALREADY_RUNNING",
    i18nMessage("errors.ALREADY_RUNNING.the.connector.is.already.running"),
  );
  const lock = join(settings.dir, "worker.lock");
  if (existsSync(lock)) {
    let alive = false;
    try {
      process.kill(Number(readFileSync(lock, "utf8")), 0);
      alive = true;
    } catch {}
    ensure(
      !alive,
      "STARTING",
      i18nMessage("errors.STARTING.another.startup.is.in.progress.try"),
    );
    unlinkSync(lock);
  }
  const fd = openSync(lock, "wx", 0o600);
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  const instanceId = randomUUID(),
    secret = token();
  const statePath = join(settings.dir, "worker.json");
  const diagnostics = new ConnectorDiagnostics(settings.dir, {
    instanceId,
    environmentId: config.environmentId,
    connectorVersion: readConnectorVersion(),
  });
  let peer: RpcPeer | null = null,
    socket: WebSocket | null = null,
    stopped = false,
    delay = 1000,
    status = "connecting",
    lastError = "";
  let lastErrorDetails: ReturnType<typeof errorBody> | undefined;
  let retry: NodeJS.Timeout | undefined;
  let engineErrorCode: "STORAGE_UNAVAILABLE" | "SHUTDOWN_FAILED" | null = null;
  const lightBackend = new LightBackend(settings.dir);
  const engine = new EngineClient(
    settings.dir,
    (method, params) => {
      if (socket?.readyState === 1) peer?.notify(method, params);
    },
    async (params) => {
      ensure(
        peer && socket?.readyState === 1,
        "OFFLINE",
        i18nMessage("errors.OFFLINE.the.server.is.offline.handoff.is"),
      );
      const { method, ...payload } = params;
      if (method === "light.publish") {
        try {
          return await peer.call(method, payload, 180000);
        } catch (error) {
          if (
            !(error instanceof AppError) ||
            !["STATUS_UNKNOWN", "OFFLINE"].includes(error.code)
          )
            throw error;
          // 只查询原操作，不在响应丢失后重新创建版本。
          const result =
            socket?.readyState === 1 &&
            (await peer
              ?.call("light.publish.status", {
                executionId: payload.executionId,
                args: { operationId: payload.args.operationId },
              })
              .catch(() => null));
          if (result?.versionId) return result;
          throw new AppError(
            "STATUS_UNKNOWN",
            i18nMessage("light.pending"),
            504,
          );
        }
      }
      if (method === "light.docs" && payload.args.topic === "backend") {
        const docs = await peer.call(method, payload);
        return { ...docs, registrationDirectory: join(settings.dir, "light-services", docs.sessionId) };
      }
      if (method?.startsWith("board.")) return peer.call(method, payload, 180000);
      if (["light.docs", "light.versions", "light.feedback", "light.unlist", "light.delete"].includes(method))
        return peer.call(method, payload, 180000);
      let result = await peer.call("workflow.handoff", payload);
      // 大文件交接使用短请求查询原操作，超时重试不重新创建上传。
      while (result?.status === "uploading") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        ensure(
          peer && socket?.readyState === 1,
          "OFFLINE",
          i18nMessage(
            "errors.OFFLINE.the.connection.was.interrupted.retry.the",
          ),
        );
        result = await peer.call("workflow.handoff.status", {
          operationId: params.operationId,
          executionId: params.executionId,
          itemId: params.itemId,
        });
      }
      return result;
    },
    (event, fields) => {
      diagnostics.write(event, fields);
      if (event === "storage.failure" || event === "engine.failure") {
        engineErrorCode = "STORAGE_UNAVAILABLE";
        lastError = connectorStorageZh.STORAGE_UNAVAILABLE;
      }
    },
  );
  const updater = new ConnectorUpdater(
    settings,
    () => engine.busyForUpdate(),
    (report) => {
      if (socket?.readyState === 1)
        peer?.notify("connector.update.report", report);
    },
    async (operationId) => {
      ensure(
        peer && socket?.readyState === 1,
        "DOWNLOAD_FAILED",
        i18nMessage(
          "errors.DOWNLOAD_FAILED.online.server.confirmation.is.required.before",
        ),
      );
      return peer.call("connector.update.grant", { operationId });
    },
  );
  const connectorBuildId = (() => {
    try {
      return (
        JSON.parse(
          readFileSync(new URL("./release.json", import.meta.url), "utf8"),
        ).revision || null
      );
    } catch {
      return null;
    }
  })();
  const control = Fastify({ logger: false, bodyLimit: 1024 });
  control.addHook("onRequest", async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${secret}`)
      return reply.code(403).send({ error: "forbidden" });
  });
  control.get("/status", async () => ({
    instanceId,
    pid: process.pid,
    connectorVersion: readConnectorVersion(),
    connectorBuildId,
    localHealthy: await engine.call("$health", {}, 500).then(
      (r) => r.healthy === true,
      () => false,
    ),
    status:
      status === "revoked"
        ? status
        : engineErrorCode
          ? "storage_error"
          : status,
    lastError: engineErrorCode
      ? connectorStorageZh[engineErrorCode]
      : lastError,
    errorCode: engineErrorCode,
    ...(engineErrorCode
      ? { lastErrorDetails: connectorStorageDetails(engineErrorCode) }
      : lastErrorDetails
        ? { lastErrorDetails }
        : {}),
    environmentId: config.environmentId,
  }));
  let finishing = false;
  async function shutdown() {
    if (finishing) return;
    finishing = true;
    stopped = true;
    clearTimeout(retry);
    socket?.terminate();
    peer?.close();
    try {
      await engine.close();
    } catch {
      status = "storage_error";
      engineErrorCode = "SHUTDOWN_FAILED";
      lastError = connectorStorageZh.SHUTDOWN_FAILED;
      diagnostics.write("shutdown.failure", {
        reason: "FLUSH_FAILED_OR_TIMEOUT",
        deadlineMs: 5000,
        pendingEvents: null,
      });
      finishing = false;
      return;
    }
    await control.close();
    for (const file of [statePath, lock])
      if (existsSync(file)) unlinkSync(file);
  }
  control.post("/stop", async () => {
    setImmediate(() => void shutdown());
    return { status: "stopping" };
  });
  try {
    await control.listen({ host: "127.0.0.1", port: 0 });
    const address = control.server.address() as { port: number };
    writeFileSync(
      statePath,
      JSON.stringify({
        instanceId,
        pid: process.pid,
        port: address.port,
        token: secret,
      }),
      { mode: 0o600 },
    );
  } catch (e) {
    await shutdown();
    throw e;
  }
  /** 撤销保留控制台可见状态，但停止重连及全部本地执行。 */
  async function revoke(ws: WebSocket) {
    updater.revoke();
    stopped = true;
    status = "revoked";
    clearTimeout(retry);
    try {
      await engine.close();
    } catch {
      lastErrorDetails = errorBody(
        new AppError("REVOKED", i18nMessage("connector.worker.revokeFailed")),
        "en",
      );
      lastError = lastErrorDetails.message;
    } finally {
      ws.close();
    }
  }
  let attempt = 0;
  let disconnectedAt: number | null = null;
  function connect() {
    if (stopped) return;
    const url = new URL("/api/node/connect", config.serverUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    status = "connecting";
    socket = new WebSocket(url, { maxPayload: 10 * 1024 * 1024 });
    const ws = socket;
    const connectionId = randomUUID();
    const connectedAt = performance.now();
    const log = (event: string, fields: any = {}) =>
      diagnostics.write(event, { connectionId, ...fields });
    const monitor = new ConnectionDiagnostics(log);
    log("connection.connecting", { attempt: ++attempt });
    ws.on("open", () => log("connection.open"));
    ws.on("ping", () => monitor.receivedPing());
    let authenticated = false;
    let challenged = false;
    peer = new RpcPeer(
      (data) => ws.send(data),
      async (method, params) => {
        if (method === "identity.challenge") {
          ensure(
            !challenged,
            "AUTH_PROTOCOL",
            i18nMessage(
              "errors.AUTH_PROTOCOL.duplicate.identity.challenges.are.not.accepted",
            ),
            403,
          );
          challenged = true;
          const toolConfig = settings.read();
          const [codex, claude] = await Promise.all([
            probeCli("codex", toolConfig.codex),
            probeCli("claude", toolConfig.claude),
          ]);
          if (socket !== ws || stopped) return;
          try {
            ensure(
              params.authVersion === nodeAuthVersion &&
                params.audience === new URL(config.serverUrl).origin,
              "AUTH_PROTOCOL",
              i18nMessage(
                "errors.AUTH_PROTOCOL.identity.protocol.mismatch.upgrade.the.server",
              ),
            );
            await engine.call("$health", {});
            await current.call("identity.authenticate", {
              authVersion: nodeAuthVersion,
              environmentId: config.environmentId,
              signature: sign(
                null,
                Buffer.from(
                  nodeProofText(
                    config.serverUrl,
                    "connect",
                    config.environmentId,
                    config.publicKey,
                    "",
                    params.challenge,
                  ),
                ),
                settings.vault.open(config.privateKey),
              ).toString("base64"),
              protocol: 1,
              capabilities: [
                "claude-terminal-v1",
                modelConfigCapability,
                claudeSdkCapability,
                "connector-update-v3",
                updateBlockersCapability,
                "files-v1",
                "file-push-v1",
                "board-attachments-v1",
                commandCapability,
                "mentions-v1",
                boardCapability,
                "runtime-options-v1",
                "board-resume-v1",
                "light-apps-v1",
                "light-apps-v2",
                "light-apps-v3",
                "light-apps-v4",
                backendCapability,
                "stage-handoff-short-id-v1",
                boardSessionTitleCapability,
                "user-questions-v1",
                autoApprovalCapability,
              ],
              connectorVersion: readConnectorVersion(),
              connectorBuildId,
              updateInstallation: updater.installation(),
              roots: config.roots,
              tools: {
                codex,
                claude: {
                  ...claude,
                  mode: toolConfig.claude.mode,
                  runsAsRoot: process.geteuid?.() === 0,
                },
              },
              platform: process.platform + "/" + process.arch,
            });
            if (socket !== ws || stopped) return;
            authenticated = true;
            log("connection.authenticated", {
              recoveryMs:
                disconnectedAt === null
                  ? null
                  : performance.now() - disconnectedAt,
              authenticationMs: performance.now() - connectedAt,
            });
            disconnectedAt = null;
            attempt = 0;
            delay = 1000;
            status = "online";
            lastError = "";
            lastErrorDetails = undefined;
          } catch (e) {
            log("connection.authentication_failed", {
              reason:
                e instanceof AppError &&
                [
                  "PENDING",
                  "REVOKED",
                  "AUTH_PROTOCOL",
                  "SIGNATURE_INVALID",
                  "DUPLICATE_CONNECTION",
                ].includes(e.code)
                  ? e.code
                  : "AUTH_FAILED",
            });
            if (socket !== ws) return;
            lastErrorDetails = errorBody(
              e instanceof AppError
                ? e
                : new AppError(
                    "AUTH_FAILED",
                    i18nMessage("connector.worker.authenticationFailed"),
                  ),
              "en",
            );
            lastError = lastErrorDetails.message;
            status =
              e instanceof AppError && e.code === "PENDING"
                ? "pending"
                : "offline";
            if (e instanceof AppError && e.code === "REVOKED") {
              await revoke(ws);
            }
            ws.close();
          }
          return;
        }
        // TLS 校验服务端身份，应用握手完成前仍禁止派发任何环境操作。
        ensure(
          authenticated && socket === ws && !stopped,
          "UNAUTHENTICATED",
          i18nMessage(
            "errors.UNAUTHENTICATED.connection.authentication.has.not.completed",
          ),
          401,
        );
        if (method === "identity.revoked") {
          await revoke(ws);
          return;
        }
        if (method === "light.backend.probe" || method === "light.backend.call")
          return lightBackend.handle(method, params);
        if (method === "environment.modelConfig")
          return environmentModelConfig(
            settings,
            modelOperation.parse(params.operation),
            params.input,
          );
        if (method === "connector.update.prepare")
          return updater.prepare(params);
        if (method === "connector.update.start")
          return updater.start(params.operationId, params.grant);
        if (method === "claude.sdk.status")
          return remoteSdkStatus(settings.dir, settings.read().claude);
        if (method === "claude.sdk.install")
          return installRemoteSdk(settings.dir, () => settings.read().claude);
        if (method === "claude.settings") {
          const config = settings.read().claude;
          return {
            ...await probeCli("claude", config),
            mode: config.mode,
            runsAsRoot: process.geteuid?.() === 0,
          };
        }
        if (method === "connector.update.status")
          return updater.status(params.operationId);
        if (
          ["connector.update.recover", "connector.update.confirm"].includes(
            method,
          )
        ) {
          // 断连或重启后的旧健康结果不能代替本次解除维护前的实时检查。
          const health = await engine.call("$health", {});
          ensure(
            health.healthy === true,
            "RECOVERY_REQUIRED",
            i18nMessage(
              "errors.RECOVERY_REQUIRED.the.update.has.not.passed.local",
            ),
            409,
          );
        }
        if (method === "connector.update.recover")
          return updater.recover(params);
        if (method === "connector.update.confirm")
          return updater.confirm(params.operationId, params.targetSha256);
        return engine.call(method, params);
      },
    );
    const current = peer;
    ws.on("message", (data) => void current.receive(data.toString()));
    ws.on("error", () => {
      log("connection.error", { reason: "TRANSPORT_ERROR" });
      if (socket !== ws) return;
      lastErrorDetails = errorBody(
        new AppError("OFFLINE", i18nMessage("connector.worker.offline")),
        "en",
      );
      lastError = lastErrorDetails.message;
    });
    ws.on("close", (code, reason) => {
      log("connection.close", {
        ...monitor.snapshot(),
        closeCode: code,
        closeReason: closeCategory(code, reason.toString()),
        initiator: stopped ? "connector" : "unknown",
        reason: stopped ? "local_stop" : closeCategory(code, reason.toString()),
      });
      monitor.close();
      current.close();
      if (socket !== ws) return;
      peer = null;
      void engine.call("$disconnectUploads", {}).catch(() => {});
      disconnectedAt ??= performance.now();
      if (!stopped) {
        if (status !== "pending") status = "offline";
        const retryMs = delay + Math.random() * 500;
        log("connection.reconnect_scheduled", {
          retryMs,
          attempt: attempt + 1,
        });
        retry = setTimeout(connect, retryMs);
        delay = Math.min(delay * 2, 30000);
      }
    });
  }
  connect();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => void shutdown());
}
