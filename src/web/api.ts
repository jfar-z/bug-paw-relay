import { errorKey, safeMessageParams } from "../shared/i18n-errors.js";
import {
  FeedbackError,
  feedback,
  caughtFeedback,
  type UiFeedback,
} from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
let retryAt = 0;

/** 同一标签页的后台读取共用服务端退避期限，写操作仍由用户发起。 */
export function canPoll() {
  return !document.hidden && Date.now() >= retryAt;
}

/** 串行调度可见页面的读取，前台恢复时立即校准，卸载后停止调度。 */
export function pollVisible(read: () => Promise<unknown>, interval: number | (() => number), events: string[] = []) {
  let stopped = false;
  let reading = false;
  let timer: ReturnType<typeof setTimeout>;
  function schedule(delay = 0) {
    clearTimeout(timer);
    if (!stopped && !reading && !document.hidden)
      timer = setTimeout(run, Math.max(delay, retryAt - Date.now()));
  }
  async function run() {
    if (!canPoll()) return schedule();
    reading = true;
    try {
      await read();
    } finally {
      reading = false;
      schedule(typeof interval === "number" ? interval : interval());
    }
  }
  const wake = () => schedule();
  document.addEventListener("visibilitychange", wake);
  events.forEach(event => window.addEventListener(event, wake));
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", wake);
    events.forEach(event => window.removeEventListener(event, wake));
  };
}

/** 统一同源 API，写入离线时不入队，避免重新联网后意外执行。 */
export async function api(
  path: string,
  body?: unknown,
  method?: string,
  timeoutMs?: number,
): Promise<any> {
  if (body !== undefined && !navigator.onLine)
    throw new FeedbackError(feedback("web.youAreOfflineYourDraftIsKeptSendIt"));
  const response = await fetch("/api" + path, {
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      "Accept-Language": currentLocale(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 429 && body === undefined && (!method || method === "GET")) {
    const header = response.headers.get("Retry-After")?.trim() ?? "";
    const now = Date.now();
    const deadline = /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
    retryAt = Math.max(retryAt, Number.isFinite(deadline) ? deadline : now + 1000);
  }
  // 代理错误页不透传；仅保存安全的产品资源键。
  const fallback =
    response.status === 401
      ? "web.yourLoginHasExpiredPleaseSignInAgain"
      : response.status >= 500
        ? "web.theServiceIsTemporarilyUnavailablePleaseTryAgainLater"
        : response.ok
          ? "web.theServiceReturnedUnexpectedDataPleaseTryAgainLater"
          : "web.requestFailedPleaseTryAgainLater";
  if (response.status === 204 && response.ok) return undefined;
  const context = `HTTP ${response.status}, /api${path.split("?")[0]}`;
  const failure = () => new FeedbackError({ messageKey: fallback, context });
  const contentType = response.headers.get("content-type") || "";
  if (!/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(contentType))
    throw failure();
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw failure();
  }
  if (!response.ok) {
    const key = data ? errorKey(data) : fallback;
    const error = Object.assign(
      new FeedbackError({
        messageKey: key,
        messageParams: safeMessageParams(key, data?.messageParams),
        context,
      }),
      { code: data?.code, status: response.status },
    );
    throw error;
  }
  return data;
}
