import { isMessageKey, messages } from "../shared/i18n.js";
import { z } from "zod";
import { AppError, boardSchema, idSchema } from "../shared/contracts.js";

/** 看板工具复用业务契约；动作分别校验，防止未知动作意外创建。 */
const boardWriteSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), board: boardSchema }).strict(),
  z
    .object({
      action: z.enum(["update", "preview"]),
      id: idSchema,
      version: z.number().int().min(1),
      board: boardSchema,
      confirmationToken: idSchema.optional(),
      operationId: idSchema.optional(),
    })
    .strict(),
  z.object({ action: z.literal("delete"), id: idSchema }).strict(),
]);

/** 向模型公开真实结构化字段与默认值。 */
const boardJsonSchema = z.toJSONSchema(
  z
    .object({
      action: z.enum(["create", "update", "preview", "delete"]),
      id: idSchema.optional(),
      version: z.number().int().min(1).optional(),
      board: boardSchema.optional(),
      confirmationToken: idSchema.optional(),
      operationId: idSchema.optional(),
    })
    .strict(),
  { io: "input" },
);

// Zod 的 JSON Schema 对象带 Standard Schema 元信息；转为纯 JSON 防止 SDK 误判。
export const boardToolParameters = JSON.parse(JSON.stringify(boardJsonSchema));
// 动态默认值由服务端解析，工具 schema 不承诺固定询问模式。
delete boardToolParameters.properties.board.properties.stages.items.properties
  .permission.default;

/** 只接受结构化参数，未知字段交由同一业务契约拒绝。 */
export function parseBoardWrite(input: any) {
  const parsed = boardWriteSchema.parse(input);
  // 保留调用方省略权限的意图，让业务层区分新增阶段与已保存阶段。
  if (parsed.action !== "delete")
    for (const [index, stage] of parsed.board.stages.entries())
      if (input.board.stages[index].permission === undefined)
        Reflect.deleteProperty(stage, "permission");
  return parsed;
}

/** 仅返回字段位置、固定校验信息和允许的业务错误，不回显输入或内部异常。 */
export function boardToolError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issues = error.issues.slice(0, 20).map((issue) => {
      const path =
        issue.path
          .map((part) =>
            typeof part === "number" ? `[${part}]` : String(part),
          )
          .join(".")
          .replace(/\.\[/g, "[") || "参数";
      const messageKey =
        issue.code === "custom" ? issue.params?.messageKey : undefined;
      const message =
        issue.code === "custom"
          ? isMessageKey(messageKey)
            ? `${messages[messageKey]["zh-CN"]} / ${messages[messageKey].en}`
            : issue.message
          : issue.code === "invalid_value"
            ? "取值不合法，请使用工具 schema 中的枚举值"
            : issue.code === "unrecognized_keys"
              ? `${messages["tool.board.unsupportedFields"]["zh-CN"]} / ${messages["tool.board.unsupportedFields"].en}`
              : issue.code === "invalid_format"
                ? "格式不合法，标识必须为 UUID"
                : issue.code === "too_small" || issue.code === "too_big"
                  ? "数量、长度或数值超出工具 schema 范围"
                  : "缺失必填字段或字段类型错误";
      return {
        path,
        message,
        ...(isMessageKey(messageKey) ? { messageKey } : {}),
      };
    });
    return (
      "工具执行失败：" + JSON.stringify({ code: "VALIDATION_ERROR", issues })
    );
  }
  if (
    error instanceof AppError &&
    [
      "NOT_FOUND",
      "CONFLICT",
      "REFERENCED",
      "FLOW_BLOCKED",
      "FLOW_CONFIRMATION_REQUIRED",
      "DONE_IMMUTABLE",
      "START_IMMUTABLE",
      "PROJECT_IMMUTABLE",
      "STAGE_DELETED",
      "STAGE_SHORT_ID_INVALID",
      "STAGE_SHORT_ID_EXHAUSTED",
      "IDEMPOTENCY_CONFLICT",
      "DIRECTORY_MISMATCH",
      "STAGE_AGENT_INVALID",
      "AGENT_SCOPE",
      "AGENT_RUNTIME",
      "UNSUPPORTED_THINKING",
    ].includes(error.code)
  ) {
    return (
      "工具执行失败：" +
      JSON.stringify({
        code: error.code,
        message: error.message,
        ...(error.messageKey
          ? {
              messageKey: error.messageKey,
              messageParams: error.messageParams,
              messages: error.messages,
              field: error.field,
              retryable: error.retryable,
            }
          : {}),
      })
    );
  }
  return "工具执行失败，请核对参数和目标状态后重试。";
}
