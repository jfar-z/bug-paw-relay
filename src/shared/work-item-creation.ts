import { messages } from "./i18n.js";
import { AppError } from "./contracts.js";

/** 创建入口共享双语资源；用户阶段名和协议枚举保持原文。 */
export const itemCreationMessages = {
  INVALID_START_STAGE: messages["workItemCreation.INVALID_START_STAGE"],
  BOARD_VERSION_CONFLICT: messages["workItemCreation.BOARD_VERSION_CONFLICT"],
  NO_START_STAGE: messages["workItemCreation.NO_START_STAGE"],
  IDEMPOTENCY_CONFLICT: messages["workItemCreation.IDEMPOTENCY_CONFLICT"],
  human: messages["workItemCreation.human"],
  agent: messages["workItemCreation.agent"],
  done: messages["workItemCreation.done"],
};

/** 稳定错误码供客户端分支判断，文案仅供展示。 */
export function itemCreationError(
  code:
    | "INVALID_START_STAGE"
    | "BOARD_VERSION_CONFLICT"
    | "NO_START_STAGE"
    | "IDEMPOTENCY_CONFLICT",
): never {
  const messages = itemCreationMessages[code];
  const error = new AppError(code, messages["zh-CN"], 409);
  Object.assign(error, {
    messageKey: `workItemCreation.${code}`,
    messages,
    retryable: false,
  });
  throw error;
}
