import { AppError } from "../shared/contracts.js";
import { connectorStorageError } from "../shared/connector-storage-errors.js";
import { parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { ConnectorStore } from "./store.js";
import { Engine } from "./engine.js";
import { ConnectorConfig } from "./config.js";
import { ConnectionDiagnostics } from "../shared/connection-diagnostics.js";
/** 执行与 SQLite 均隔离到此线程，磁盘锁等待不会阻塞 WSS 和本机控制接口。 */
const port = parentPort!;
const settings = new ConnectorConfig(workerData.dir);
const store = new ConnectorStore(join(settings.dir, "environment.db"));
// 短暂锁冲突明确失败，不在原生审批与关闭路径等待五秒。
store.db.exec("PRAGMA busy_timeout=50");
let next = 0;
const handoffs = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: any) => void }
>();
const diagnostic = (event: string, fields: any) =>
  port.postMessage({ diagnostic: event, fields });
const monitor = new ConnectionDiagnostics(diagnostic);
const engine = new Engine(
  store,
  () => settings.runtime(),
  (method, params) => port.postMessage({ notify: method, params }),
  (params) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      handoffs.set(id, { resolve, reject });
      port.postMessage({ handoff: id, params });
    }),
  diagnostic,
);
const summary = setInterval(
  () => diagnostic("storage.summary", engine.storageSnapshot()),
  60000,
);
summary.unref();
// 小事务后台收敛旧缓存，失败后锁定业务写入，不在健康查询中清理。
const maintenance = setInterval(() => {
  try {
    store.maintainEvents();
  } catch {
    engine.storageFault();
  }
}, 1000);
maintenance.unref();
port.on("message", async (m) => {
  if (m.handoff) {
    const p = handoffs.get(m.handoff);
    handoffs.delete(m.handoff);
    if (m.error) p?.reject(m.errorCode ? new AppError(m.errorCode, m.error) : new Error(m.error));
    else p?.resolve(m.result);
    return;
  }
  try {
    let result;
    if (m.method === "$health") {
      // 只有账本初始化和引擎恢复完成后才响应本机更新健康检查。
      store.db.prepare("SELECT 1").get();
      result = { healthy: engine.locallyHealthy() };
    } else if (m.method === "$busyForUpdate") {
      // 只在升级门禁处读取实时执行与传输状态。
      result = engine.busyForUpdate();
    } else if (m.method === "$disconnectUploads") {
      await engine.disconnectUploads();
      result = { ok: true };
    } else if (m.method === "$close") {
      try {
        await engine.disconnectUploads();
        engine.close();
      } finally {
        clearInterval(summary);
        clearInterval(maintenance);
        monitor.close();
        store.close();
        // 保留运行时三秒强杀兜底定时器，线程退出不能遗留拒绝 SIGTERM 的子进程。
        await new Promise((resolve) => setTimeout(resolve, 3100));
      }
      result = { ok: true };
    } else result = await engine.call(m.method, m.params);
    port.postMessage({ id: m.id, result });
  } catch (e: any) {
    if (m.method === "$close")
      diagnostic("shutdown.failure", {
        ...engine.storageSnapshot(),
        reason: "FLUSH_FAILED",
      });
    if (String(e.code).includes("SQLITE")) {
      engine.storageFault();
      e = connectorStorageError("STORAGE_UNAVAILABLE");
    }
    if (!(e instanceof AppError))
      e = connectorStorageError(
        m.method === "$close" ? "SHUTDOWN_FAILED" : "ENGINE_FAILURE",
      );
    port.postMessage({
      id: m.id,
      error: {
        code: e.code || "ENGINE_FAILURE",
        message: e.code ? e.message : "执行引擎处理失败",
        status: e.status || 503,
        // 保留逐题校验的双语键及安全题号，不传递题目和回答正文。
        messageKey: e.messageKey,
        messageParams: e.messageParams,
        messages: e.messages,
        retryable: e.retryable,
        field: e.field,
      },
    });
  }
});
