import { message as i18nMessage } from "../shared/i18n.js";
import { z } from "zod";
import { AppError, ensure } from "../shared/contracts.js";
import { historyEvents, sessionActivity } from "../shared/session-events.js";
import { sessionDisplay } from "../shared/session-display.js";
import type { Service } from "./service.js";

export const historyQuery = z.object({
  sessionId: z.string().uuid(),
  before: z.string().max(2000).nullable().default(null),
  limit: z.number().int().min(1).max(50).default(20),
  includeTools: z.boolean().default(false),
});

/** 工作台只读取有界历史页，不在服务端保存环境正文副本。 */
export async function readSessionHistory(service: Service, input: unknown) {
  const query = historyQuery.parse(input);
  const history = await service.sessionHistory(query.sessionId);
  const projection = JSON.stringify(history);
  const sourceTruncated =
    /\[(?:其余条目已省略|展示内容已截断|嵌套过深，展示已省略)/.test(projection);
  const metadata = new Map<string, any>();
  // 原生时间仅使用实际提供的字段，不能用本次查询时间冒充消息时间。
  if (Array.isArray(history.nativeHistory))
    for (const message of history.nativeHistory) {
      const meta = { executionId: null, timestamp: message.timestamp ?? null };
      const id = `claude:${message.uuid || message.message?.id}`;
      metadata.set(id, meta);
      for (let i = 0; i < (message.message?.content?.length || 0); i++)
        metadata.set(`${id}:${i}`, meta);
    }
  for (const event of history.events || []) {
    const item = event.data?.item;
    const message = event.data;
    const meta = {
      executionId: event.executionId ?? null,
      timestamp: event.timestamp ?? null,
    };
    metadata.set(`user:${event.executionId}:${event.sequence}`, meta);
    if (item?.id) metadata.set(`item:${item.id}`, meta);
    if (event.data?.itemId) metadata.set(`item:${event.data.itemId}`, meta);
    if (message?.uuid) {
      metadata.set(`claude:${message.uuid}`, meta);
      for (let i = 0; i < (message.message?.content?.length || 0); i++)
        metadata.set(`claude:${message.uuid}:${i}`, meta);
    }
  }
  const rows = historyEvents(history).flatMap((event) => {
    const activity = sessionActivity(event);
    if (activity && !query.includeTools) return [];
    const content = activity
      ? JSON.stringify(activity)
      : (event.data?.text ??
        event.data?.item?.text ??
        event.data?.message?.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n") ??
        JSON.stringify(event.data));
    return [
      {
        id: event.id,
        role: activity
          ? "tool"
          : event.type === "user"
            ? "user"
            : event.type === "error" || event.type === "result"
              ? "error"
              : "assistant",
        ...{ executionId: null, timestamp: null, ...metadata.get(event.id) },
        content: content.slice(0, 4000),
        truncated: content.length > 4000 || content.includes("截断"),
      },
    ];
  });
  let end = rows.length;
  if (query.before) {
    let cursor: any;
    try {
      cursor = JSON.parse(
        Buffer.from(query.before, "base64url").toString("utf8"),
      );
    } catch {
      throw new AppError(
        "INVALID_CURSOR",
        i18nMessage(
          "errors.INVALID_CURSOR.invalid.history.cursor.read.the.latest",
        ),
      );
    }
    ensure(
      cursor?.sessionId === query.sessionId &&
        cursor?.includeTools === query.includeTools,
      "INVALID_CURSOR",
      i18nMessage("errors.INVALID_CURSOR.the.cursor.does.not.belong.to"),
    );
    end = rows.findIndex((row) => row.id === cursor.id);
    ensure(
      end >= 0,
      "CURSOR_EXPIRED",
      i18nMessage("errors.CURSOR_EXPIRED.history.has.changed.read.the.latest"),
    );
  }
  const start = Math.max(0, end - query.limit);
  const messages = rows.slice(start, end);
  return {
    sessionId: query.sessionId,
    sessionUrl: "/#chat/" + query.sessionId,
    status: history.status,
    messages,
    hasMore: start > 0,
    nextCursor:
      start > 0
        ? Buffer.from(
            JSON.stringify({
              sessionId: query.sessionId,
              includeTools: query.includeTools,
              id: messages[0].id,
            }),
          ).toString("base64url")
        : null,
    gap: Boolean(history.gap || history.historyError || sourceTruncated),
    historyError: history.historyError || null,
    truncated: sourceTruncated || messages.some((m) => m.truncated),
  };
}

/** 等待由程序执行，事件唤醒与低频对账均不消耗模型轮次。 */
export class SessionWaiter {
  /** 只保存查询时间，不缓存环境正文。 */
  private reads = new Map<string, number>();
  constructor(private service: Service) {}

  /** 高频状态查询自动转为等待，防止模型以另一工具名绕过等待。 */
  result(executionId: string, signal?: AbortSignal) {
    const now = Date.now();
    const previous = this.reads.get(executionId);
    this.reads.set(executionId, now);
    for (const [id, time] of this.reads)
      if (now - time > 120000) this.reads.delete(id);
    return this.wait(
      [executionId],
      previous !== undefined && now - previous < 5000 ? 60000 : 0,
      signal,
    ).then((value) => ({
      ...value.results[0],
      timedOut: value.timedOut,
      nextAction: value.nextAction,
    }));
  }

  /** 任一执行需要处理即返回；中止仅结束等待，不发送环境取消命令。 */
  wait(
    executionIds: string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<any> {
    const executions = [...new Set(executionIds)].map((id) => {
      const e = this.service.execution(id);
      this.service.store.get("sessions", e.session_id);
      return e;
    });
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      let done = false;
      const inFlight = new Set<string>();
      const dirty = new Set(executionIds);
      const lastRead = new Map<string, number>();
      const received = new Set<string>();
      const active = [
        "queued",
        "dispatching",
        "starting",
        "running",
        "stopping",
      ];
      const results: any[] = executions.map((e) => ({
        executionId: e.id,
        sessionId: e.session_id,
        sessionUrl: "/#chat/" + e.session_id,
        status: "unknown",
        resultAvailable: false,
        reply: "",
      }));
      const cleanup = () => {
        done = true;
        clearInterval(timer);
        clearTimeout(expiry);
        signal?.removeEventListener("abort", abort);
        for (const e of executions)
          this.service.sessionEvents.off(e.session_id, wake);
      };
      const finish = (timedOut: boolean) => {
        if (done) return;
        cleanup();
        resolve({
          results,
          timedOut,
          nextAction: results.some((r) => r.status === "waiting")
            ? "open_session"
            : timedOut ||
                results.every((r) =>
                  [
                    "queued",
                    "dispatching",
                    "starting",
                    "running",
                    "stopping",
                  ].includes(r.status),
                )
              ? "session_wait"
              : "inspect_results",
        });
      };
      const abort = () => {
        if (done) return;
        cleanup();
        reject(
          new AppError(
            "WAIT_CANCELLED",
            i18nMessage(
              "errors.WAIT_CANCELLED.waiting.stopped.the.environment.task.continues",
            ),
          ),
        );
      };
      const wake = (event: any) => {
        // 正文流式增量不触发查询，只有目标执行的状态变化才唤醒。
        if (
          event.type !== "execution-state" ||
          !executionIds.includes(event.executionId)
        )
          return;
        dirty.add(event.executionId);
        check();
      };
      const check = () => {
        if (done) return;
        executions.forEach((e, index) => {
          if (done) return;
          if (!this.service.peers.has(e.environment_id)) {
            results[index] = {
              ...results[index],
              status: "offline",
              resultAvailable: false,
              reply: "",
            };
            finish(false);
            return;
          }
          if (
            inFlight.has(e.id) ||
            (!dirty.has(e.id) && Date.now() - (lastRead.get(e.id) || 0) < 15000)
          )
            return;
          inFlight.add(e.id);
          dirty.delete(e.id);
          lastRead.set(e.id, Date.now());
          // 每个执行独立查询，慢环境不能阻止其他执行的事件唤醒。
          void (async () => {
            let result: any;
            try {
              const value = await this.service
                .peer(e.environment_id)
                .call(
                  "execution.result",
                  { executionId: e.id },
                  Math.max(
                    1,
                    Math.min(20000, timeoutMs ? deadline - Date.now() : 20000),
                  ),
                );
              result = { ...sessionDisplay(value), resultAvailable: true };
            } catch (error) {
              if (!(error instanceof AppError)) {
                if (!done) {
                  cleanup();
                  reject(error);
                }
                return;
              }
              result = {
                status: error.code === "OFFLINE" ? "offline" : "unknown",
                error: error.code,
                resultAvailable: false,
                reply: "",
              };
            } finally {
              inFlight.delete(e.id);
            }
            if (done) return;
            results[index] = {
              ...result,
              executionId: e.id,
              sessionId: e.session_id,
              sessionUrl: "/#chat/" + e.session_id,
            };
            received.add(e.id);
            if (!active.includes(result.status)) finish(false);
            else if (!timeoutMs && received.size === executions.length)
              finish(false);
            else if (dirty.has(e.id)) check();
          })();
        });
      };
      const timer = setInterval(() => void check(), 1000);
      const expiry = setTimeout(() => finish(true), timeoutMs || 20000);
      for (const e of executions)
        this.service.sessionEvents.on(e.session_id, wake);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else void check();
    });
  }
}
