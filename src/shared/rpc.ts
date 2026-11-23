import { message as i18nMessage } from "./i18n.js";
import { connectorStorageDetails } from "./connector-storage-errors.js";
import { randomUUID } from "node:crypto";
import { AppError } from "./contracts.js";
/** 双向 JSON-RPC：请求超时只结束等待，不重放有副作用的操作。 */
export class RpcPeer {
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    private send: (data: string) => void,
    private handle: (method: string, params: any) => Promise<any>,
  ) {}
  async receive(raw: string) {
    let m: any;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    // 公网对端可能发送任意合法 JSON；先验证结构，不能让 null 导致进程级拒绝。
    if (!m || typeof m !== "object" || Array.isArray(m) || m.jsonrpc !== "2.0")
      return;
    if (
      m.id !== undefined &&
      typeof m.id !== "string" &&
      typeof m.id !== "number"
    )
      return;
    if (m.method !== undefined && typeof m.method !== "string") return;
    if (m.method) {
      try {
        const result = await this.handle(m.method, m.params);
        if (m.id !== undefined)
          this.respond(
            JSON.stringify({
              jsonrpc: "2.0",
              id: m.id,
              result: result ?? null,
            }),
          );
      } catch (e) {
        if (m.id !== undefined)
          this.respond(
            JSON.stringify({
              jsonrpc: "2.0",
              id: m.id,
              error: {
                code: -32000,
                message: e instanceof AppError ? e.message : "环境操作失败",
                data: {
                  code: e instanceof AppError ? e.code : "INTERNAL",
                  status: e instanceof AppError ? e.status : 500,
                  ...(e instanceof AppError && e.messageKey
                    ? {
                        messageKey: e.messageKey,
                        messages: e.messages,
                        messageParams: e.messageParams,
                        retryable: e.retryable,
                        field: e.field,
                      }
                    : {}),
                  ...connectorStorageDetails(
                    e instanceof AppError ? e.code : "INTERNAL",
                  ),
                },
              },
            }),
          );
      }
    } else {
      const p = this.pending.get(String(m.id));
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(String(m.id));
      m.error
        ? p.reject(
            Object.assign(
              new AppError(
                m.error.data?.code || "RPC_ERROR",
                m.error.message,
                Number.isInteger(m.error.data?.status) &&
                  m.error.data.status >= 400 &&
                  m.error.data.status <= 599
                  ? m.error.data.status
                  : 400,
              ),
              {
                messageKey: m.error.data?.messageKey,
                messages: m.error.data?.messages,
                messageParams: m.error.data?.messageParams,
                retryable: m.error.data?.retryable,
                field: m.error.data?.field,
              },
            ),
          )
        : p.resolve(m.result);
    }
  }
  /** 请求处理期间连接可能关闭；发送失败不再抛出未处理的异步异常。 */
  private respond(data: string) {
    try {
      this.send(data);
    } catch {
      // 连接生命周期负责清理在途调用，已断开的响应无需重试。
    }
  }
  call(method: string, params: any = {}, timeout = 20000): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new AppError(
            "STATUS_UNKNOWN",
            i18nMessage(
              "errors.STATUS_UNKNOWN.the.request.timed.out.check.the",
            ),
            504,
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  notify(method: string, params: any) {
    this.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }
  close() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(
        new AppError(
          "OFFLINE",
          i18nMessage("errors.OFFLINE.the.environment.has.disconnected"),
          409,
        ),
      );
    }
    this.pending.clear();
  }
}
