import { type Locale } from "../shared/i18n.js";
import { localizeError } from "../shared/i18n-errors.js";
import { message as i18nMessage } from "../shared/i18n.js";
import { connectorStorageError } from "../shared/connector-storage-errors.js";
import { readFileSync, existsSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { AppError, ensure } from "../shared/contracts.js";
import type { ConnectorConfig } from "./config.js";
export const connectorEntry = fileURLToPath(
  new URL("./main.js", import.meta.url),
);
/** 启动互斥 Promise 只共享机器状态，按每个调用者语言生成可读字段。 */
function localizedStatus(status: any, locale: Locale) {
  return {
    ...status,
    ...(status.messageKey ? { message: localizeError(locale, status) } : {}),
    ...(status.lastErrorDetails
      ? { lastError: localizeError(locale, status.lastErrorDetails) }
      : {}),
  };
}
/** 通过带令牌的回环控制通道识别进程，不根据可能被复用的 PID 杀进程。 */
export async function workerStatus(
  config: ConnectorConfig,
  locale: Locale = "en",
): Promise<any> {
  const path = join(config.dir, "worker.json");
  if (existsSync(path)) {
    try {
      const info = JSON.parse(readFileSync(path, "utf8"));
      const response = await fetch(`http://127.0.0.1:${info.port}/status`, {
        headers: { Authorization: `Bearer ${info.token}` },
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        const status: any = await response.json();
        if (status.instanceId === info.instanceId)
          return {
            ...status,
            ...(status.lastErrorDetails
              ? { lastError: localizeError(locale, status.lastErrorDetails) }
              : {}),
            running: true,
          };
      }
    } catch {}
    // 控制接口超时不等于进程退出；PID 仅用于保守保持未知状态，不用于终止。
    try {
      const info = JSON.parse(readFileSync(path, "utf8"));
      if (!Number.isSafeInteger(info.pid) || info.pid <= 0)
        return { running: true, status: "unknown" };
      process.kill(info.pid, 0);
      return { running: true, status: "unknown" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        return { running: true, status: "unknown" };
    }
  }
  return { running: false, status: "stopped" };
}
let starting: Promise<any> | undefined;
export async function startWorker(
  config: ConnectorConfig,
  locale: Locale = "en",
) {
  if (starting)
    return starting.then((status) => localizedStatus(status, locale));
  starting = (async () => {
    const status = await workerStatus(config);
    if (status.running) return status;
    const data = config.read();
    ensure(
      data.environmentId && data.privateKey,
      "NOT_REGISTERED",
      i18nMessage("errors.NOT_REGISTERED.enter.an.access.code.and.register"),
    );
    const log = openSync(join(config.dir, "connector.log"), "a", 0o600);
    const child = spawn(process.execPath, [connectorEntry, "run"], {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, BUGPAW_HOME: config.dir },
      windowsHide: true,
    });
    closeSync(log);
    let launchError = false;
    child.on("error", () => {
      launchError = true;
    });
    child.unref();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      ensure(
        !launchError,
        "START_FAILED",
        i18nMessage("errors.START_FAILED.the.connector.failed.to.start"),
      );
      const current = await workerStatus(config, locale);
      if (current.running) return current;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new AppError("START_FAILED", i18nMessage("connector.startTimeout"));
  })().finally(() => {
    starting = undefined;
  });
  return starting.then((status) => localizedStatus(status, locale));
}
export async function stopWorker(
  config: ConnectorConfig,
  locale: Locale = "en",
) {
  const status = await workerStatus(config, locale);
  if (!status.running) return { running: false };
  ensure(
    status.status !== "unknown",
    "WORKER_UNREACHABLE",
    i18nMessage("connector.workerUnreachable"),
  );
  const info = JSON.parse(
    readFileSync(join(config.dir, "worker.json"), "utf8"),
  );
  const response = await fetch(`http://127.0.0.1:${info.port}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${info.token}` },
    signal: AbortSignal.timeout(5000),
  });
  ensure(
    response.ok,
    "STOP_FAILED",
    i18nMessage("errors.STOP_FAILED.the.stop.request.failed"),
  );
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const current = await workerStatus(config, locale);
    if (current.status === "storage_error")
      throw connectorStorageError("SHUTDOWN_FAILED");
    if (!current.running) return { running: false };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { running: true, status: "stopping" };
}
