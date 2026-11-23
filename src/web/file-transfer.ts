import {
  FeedbackError,
  feedback,
  caughtFeedback,
  type UiFeedback,
} from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import { FILE_CHUNK_SIZE, type FileTicket } from "../shared/files.js";
/** 文件接口使用同源 Cookie；独立信号确保关闭弹窗立即停止后续分块请求。 */
export async function fileRequest(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  method = "POST",
) {
  const response = await fetch("/api" + path, {
    method,
    signal,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "Accept-Language": currentLocale(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new FeedbackError(
      data?.messageKey
        ? data
        : feedback(
            response.status === 401
              ? "web.yourLoginHasExpiredPleaseSignInAgain"
              : "web.fileTransferFailedPleaseTryAgain",
          ),
    );
  }
  return response;
}
export type TransferProgress = {
  received: number;
  total: number;
  speed: number;
};
/** 接收器与展示解耦；后续上传流程可传入自己的流式落盘或消费实现。 */
export async function receiveEnvironmentFile(
  ticket: FileTicket,
  sink: (chunk: Uint8Array) => Promise<void>,
  progress: (value: TransferProgress) => void,
  signal: AbortSignal,
) {
  let received = 0,
    sampleBytes = 0,
    sampleTime = performance.now(),
    speed = 0;
  progress({ received, total: ticket.size, speed });
  // 空文件也请求一块，以复核文件是否在元信息读取之后发生变化。
  do {
    signal.throwIfAborted();
    const response = await fileRequest(
      `/file-transfers/${ticket.id}/read`,
      { offset: received },
      signal,
    );
    if (
      !response.headers
        .get("content-type")
        ?.startsWith("application/octet-stream")
    )
      throw new FeedbackError(
        feedback("web.theServiceReturnedInvalidFileContent"),
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== Math.min(FILE_CHUNK_SIZE, ticket.size - received))
      throw new FeedbackError(
        feedback("web.incompleteFileTransferPleaseTryAgain"),
      );
    signal.throwIfAborted();
    await sink(bytes);
    received += bytes.length;
    const now = performance.now();
    if (now - sampleTime >= 200 || received === ticket.size) {
      speed = ((received - sampleBytes) * 1000) / Math.max(1, now - sampleTime);
      sampleTime = now;
      sampleBytes = received;
    }
    progress({ received, total: ticket.size, speed });
  } while (received < ticket.size);
}
/** 下载优先使用浏览器私有临时文件；没有该能力时只允许有界内存回退。 */
export async function createFileSink(size: number, disk: boolean) {
  let directory: FileSystemDirectoryHandle | undefined,
    name = "",
    writer: FileSystemWritableFileStream | undefined,
    handle: FileSystemFileHandle | undefined;
  const parts: BlobPart[] = [];
  if (disk && navigator.storage?.getDirectory) {
    try {
      directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("relay-file-transfers", { create: true });
      // 意外关闭标签页可能来不及清理；仅回收本模块一天前遗留的临时文件。
      const entries = directory as FileSystemDirectoryHandle & {
        keys(): AsyncIterableIterator<string>;
      };
      for await (const oldName of entries.keys()) {
        if (
          /^\d{13}-[a-f0-9-]{36}$/.test(oldName) &&
          Number(oldName.slice(0, 13)) < Date.now() - 86400000
        )
          await directory.removeEntry(oldName).catch(() => {});
      }
      name = `${Date.now()}-${crypto.randomUUID()}`;
      handle = await directory.getFileHandle(name, { create: true });
      writer = await handle.createWritable();
    } catch {
      if (directory && name) await directory.removeEntry(name).catch(() => {});
      directory = undefined;
      handle = undefined;
    }
  }
  if (!writer && size > 128 * 1024 ** 2)
    throw new FeedbackError(
      feedback("web.thisBrowserDoesNotSupportTemporaryStorageForLarge"),
    );
  return {
    write: async (chunk: Uint8Array) => {
      if (writer) await writer.write(chunk as Uint8Array<ArrayBuffer>);
      else parts.push(chunk as Uint8Array<ArrayBuffer>);
    },
    finish: async (mime: string) => {
      if (writer && handle) {
        await writer.close();
        writer = undefined;
        return await handle.getFile();
      }
      return new Blob(parts, { type: mime });
    },
    cleanup: async () => {
      if (writer) await writer.abort().catch(() => {});
      if (directory && name) await directory.removeEntry(name).catch(() => {});
      parts.length = 0;
    },
  };
}
export function formatBytes(value: number) {
  const index =
    value < 1024 ? 0 : value < 1024 ** 2 ? 1 : value < 1024 ** 3 ? 2 : 3;
  return (
    new Intl.NumberFormat(currentLocale(), {
      maximumFractionDigits: index === 3 ? 2 : index === 0 ? 0 : 1,
    }).format(value / 1024 ** index) +
    " " +
    ["B", "KB", "MB", "GB"][index]
  );
}
