import { message as i18nMessage, translate } from "../shared/i18n.js";
import { connectorStorageError } from "../shared/connector-storage-errors.js";
import { Worker } from "node:worker_threads";
import { AppError, ensure } from "../shared/contracts.js";
import { activeUpdate } from "./update-installation.js";
/** 有界请求桥接；超时仅表示结果未知，不重放任何有副作用的操作。 */
export class EngineClient {
  private worker: Worker;
  private next = 0;
  private closeRequest: number | null = null;
  private failed = false;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: any) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    dir: string,
    notify: (method: string, params: any) => void,
    handoff: (params: any) => Promise<any>,
    diagnostic: (event: string, fields: any) => void,
  ) {
    const source = import.meta.url.endsWith(".ts");
    this.worker = source
      ? new Worker(
          `import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(new URL("./engine-thread.ts", import.meta.url).href)}, ${JSON.stringify(import.meta.url)}))`,
          { eval: true, workerData: { dir } },
        )
      : new Worker(new URL("./engine-thread.js", import.meta.url), {
          workerData: { dir },
        });
    this.worker.on("message", (m) => {
      if (m.notify) {
        try {
          notify(m.notify, m.params);
        } catch {}
      }
      if (m.diagnostic) diagnostic(m.diagnostic, m.fields);
      if (m.handoff)
        void handoff(m.params).then(
          (result) => this.worker.postMessage({ handoff: m.handoff, result }),
          (e) =>
            this.worker.postMessage({
              handoff: m.handoff,
              errorCode: e instanceof AppError ? e.code : undefined,
              error:
                e instanceof AppError
                  ? e.code +
                    " " +
                    e.message +
                    ((m.params.method?.startsWith("light.") || m.params.method?.startsWith("board.")) && e.messageKey
                      ? " / " + translate("en", e.messageKey, e.messageParams)
                      : "")
                  : "操作失败 / Operation failed",
            }),
        );
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error)
        p.reject(
          Object.assign(
            new AppError(m.error.code, m.error.message, m.error.status),
            {
              messageKey: m.error.messageKey,
              messageParams: m.error.messageParams,
              messages: m.error.messages,
              retryable: m.error.retryable,
              field: m.error.field,
            },
          ),
        );
      else p.resolve(m.result);
      if (m.id === this.closeRequest) {
        this.failed = true;
        for (const other of this.pending.values()) {
          clearTimeout(other.timer);
          other.reject(connectorStorageError("ENGINE_UNAVAILABLE"));
        }
        this.pending.clear();
        void this.worker.terminate();
      }
    });
    const fail = () => {
      this.failed = true;
      diagnostic("engine.failure", { reason: "WORKER_EXIT" });
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(connectorStorageError("ENGINE_UNAVAILABLE"));
      }
      this.pending.clear();
    };
    this.worker.once("error", fail);
    this.worker.once("exit", () => {
      if (!this.failed) fail();
    });
  }
  async busyForUpdate(): Promise<boolean> {
    return (await this.call("$busyForUpdate", {})) !== false;
  }
  async call(method: string, params: any, timeout = 30000): Promise<any> {
    if (this.failed) throw connectorStorageError("ENGINE_UNAVAILABLE");
    if (method !== "$close" && this.pending.size >= 128)
      throw connectorStorageError("ENGINE_BUSY");
    if (
      method !== "$close" &&
      ![
        "$health",
        "$busyForUpdate",
        "connector.update.blockers",
        "$disconnectUploads",
        "execution.status",
        "execution.result",
      ].includes(method)
    )
      ensure(
        !activeUpdate(),
        "UPDATE_IN_PROGRESS",
        i18nMessage(
          "errors.UPDATE_IN_PROGRESS.the.connector.is.undergoing.update.maintenance",
        ),
        409,
      );
    const id = ++this.next;
    if (method === "$close") this.closeRequest = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // 保留槽位直到真实返回，避免超时请求继续堆积。
        reject(connectorStorageError("ENGINE_TIMEOUT"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, method, params });
    });
  }
  private closePromise?: Promise<void>;
  close() {
    return (this.closePromise ??= this.closeInternal());
  }
  private async closeInternal() {
    try {
      await this.call("$close", {}, 5000);
    } finally {
      // 已收到关闭结果才退出线程；超时不冒充已停止，也不提前取消子进程清理。
      if (!this.pending.size) {
        this.failed = true;
        await this.worker.terminate();
      }
    }
  }
}
