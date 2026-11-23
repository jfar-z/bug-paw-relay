import { z } from "zod";
import { AppError } from "./contracts.js";
import {
  isMessageKey,
  translate,
  messages,
  type Locale,
  type MessageKey,
  type MessageParams,
} from "./i18n.js";

/** 旧端没有消息键时，仅接受无歧义的稳定错误码映射。 */
export function errorKey(error: {
  code?: unknown;
  messageKey?: unknown;
}): MessageKey {
  if (isMessageKey(error.messageKey)) return error.messageKey;
  if (error.code === "ROOT_ABSOLUTE") return "connector.roots.absoluteRequired";
  if (error.code === "ROOT_INVALID") return "connector.roots.invalid";
  if (typeof error.code === "string" && /^[A-Z_]+$/.test(error.code)) {
    const matches = (Object.keys(messages) as MessageKey[]).filter((key) =>
      key.startsWith(`errors.${error.code}.`),
    );
    if (matches.length === 1) return matches[0];
  }
  return "common.failure";
}
/** 仅输出资源声明的安全标量，不透传原始请求、供应商错误或未知参数。 */
export function safeMessageParams(
  key: MessageKey,
  input: unknown,
): MessageParams {
  const result: MessageParams = {};
  if (!input || typeof input !== "object") return result;
  if (key.startsWith("project.directory.")) {
    for (const name of ["environment", "path"]) {
      const value = (input as Record<string, unknown>)[name];
      if (typeof value === "string") result[name] = value;
    }
  }
  // 上游模型错误仅允许受控 HTTP 状态码。
  if (
    [
      "connector.model.authorization",
      "connector.model.notFound",
      "connector.model.rateLimit",
      "connector.model.upstream",
    ].includes(key)
  ) {
    const value = (input as Record<string, unknown>).status;
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    )
      result.status = value;
  }
  if (["board.flowOccupied", "board.flowExit", "board.flowPath"].includes(key)) {
    for (const name of ["stage", "target"]) {
      const value = (input as Record<string, unknown>)[name];
      if (typeof value === "string") result[name] = value;
    }
  }
  if (key === "board.stageAgentInvalid") {
    const stage = (input as Record<string, unknown>).stage;
    if (typeof stage === "string") result.stage = stage;
  }
  if (key === "board.flowBlocked") {
    const value = (input as Record<string, unknown>).count;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      result.count = value;
  }
  if (key === "questions.invalid") {
    const value = (input as Record<string, unknown>).question;
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 100
    )
      result.question = value;
  }
  return result;
}
/** 兼容旧 code/message；已知新错误带可重新渲染的键与白名单参数。 */
export function errorBody(error: unknown, locale: Locale) {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((issue) => {
      const custom =
        issue.code === "custom" ? issue.params?.messageKey : undefined;
      const map: Record<string, MessageKey> = {
        invalid_type: "validation.required",
        too_small: "validation.tooSmall",
        too_big: "validation.tooBig",
        invalid_format: "validation.format",
        invalid_value: "validation.option",
        unrecognized_keys: "validation.unknownFields",
      };
      const messageKey = isMessageKey(custom)
        ? custom
        : map[issue.code] || "validation.invalid";
      return {
        path: issue.path,
        messageKey,
        messageParams: {},
        message: translate(locale, messageKey),
      };
    });
    return {
      code: "VALIDATION",
      messageKey: "validation.invalid",
      messageParams: {},
      message: translate(locale, "validation.invalid"),
      issues,
    };
  }
  const known = error instanceof AppError;
  const messageKey = known ? errorKey(error) : "common.failure";
  const messageParams = known
    ? safeMessageParams(messageKey, error.messageParams)
    : {};
  return {
    code: known ? error.code : "INTERNAL",
    message: translate(locale, messageKey, messageParams),
    messageKey,
    messageParams,
    ...(known && error.retryable !== undefined
      ? { retryable: error.retryable }
      : {}),
    ...(known && error.messageKey ? { params: messageParams } : {}),
    ...(known && error.field ? { field: error.field } : {}),
  };
}
/** 客户端只按结构化键渲染，旧版本未知错误安全降级，不解析中文原句。 */
export function localizeError(
  locale: Locale,
  error: { code?: unknown; messageKey?: unknown; messageParams?: unknown },
): string {
  const key = errorKey(error);
  return translate(locale, key, safeMessageParams(key, error.messageParams));
}
