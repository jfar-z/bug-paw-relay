import { messages, message } from "./i18n.js";
import { AppError } from "./contracts.js";
/** 存储与线程故障使用稳定键；不把 SQLite 路径、SQL 或事件正文透传给用户。 */
export const connectorStorageZh = {
  STORAGE_UNAVAILABLE:
    messages["connector.storage.STORAGE_UNAVAILABLE"]["zh-CN"],
  ENGINE_UNAVAILABLE: messages["connector.storage.ENGINE_UNAVAILABLE"]["zh-CN"],
  ENGINE_TIMEOUT: messages["connector.storage.ENGINE_TIMEOUT"]["zh-CN"],
  ENGINE_FAILURE: messages["connector.storage.ENGINE_FAILURE"]["zh-CN"],
  ENGINE_BUSY: messages["connector.storage.ENGINE_BUSY"]["zh-CN"],
  SHUTDOWN_FAILED: messages["connector.storage.SHUTDOWN_FAILED"]["zh-CN"],
};
export const connectorStorageEn: Record<
  keyof typeof connectorStorageZh,
  string
> = {
  STORAGE_UNAVAILABLE: messages["connector.storage.STORAGE_UNAVAILABLE"].en,
  ENGINE_UNAVAILABLE: messages["connector.storage.ENGINE_UNAVAILABLE"].en,
  ENGINE_TIMEOUT: messages["connector.storage.ENGINE_TIMEOUT"].en,
  ENGINE_FAILURE: messages["connector.storage.ENGINE_FAILURE"].en,
  ENGINE_BUSY: messages["connector.storage.ENGINE_BUSY"].en,
  SHUTDOWN_FAILED: messages["connector.storage.SHUTDOWN_FAILED"].en,
};
export function connectorStorageDetails(code: string) {
  return Object.hasOwn(connectorStorageZh, code)
    ? { messageKey: `connector.storage.${code}`, messageParams: {} }
    : {};
}
export function connectorStorageError(code: keyof typeof connectorStorageZh) {
  return new AppError(code, message(`connector.storage.${code}`), 503);
}
