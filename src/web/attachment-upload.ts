import { fileRequest, type TransferProgress } from "./file-transfer.js";
import { attachmentSchema, type Attachment } from "../shared/uploads.js";
import { FILE_CHUNK_SIZE } from "../shared/files.js";

/** 单文件独立批次；一次只读取一个分块，取消也覆盖创建响应迟到的情况。 */
export async function uploadAttachment(
  sessionId: string,
  file: File,
  signal: AbortSignal,
  progress: (value: TransferProgress) => void,
): Promise<Attachment> {
  const result = await uploadBatch(
    `/sessions/${sessionId}/uploads`,
    {},
    [file],
    signal,
    progress,
  );
  return attachmentSchema.parse(result.files?.[0]);
}

/** 同一业务操作的全部文件共用一个批次，逐块确认后再提交。 */
export async function uploadBatch(
  path: string,
  scope: object,
  files: File[],
  signal: AbortSignal,
  progress: (value: TransferProgress) => void,
) {
  let id = "";
  let complete = false;
  const cancel = () => {
    if (id && !complete)
      void fileRequest(
        `/file-uploads/${id}`,
        undefined,
        undefined,
        "DELETE",
      ).catch(() => {});
  };
  signal.addEventListener("abort", cancel);
  try {
    signal.throwIfAborted();
    // 创建请求不提前中断，以便取得批次编号并清理服务端已受理的上传。
    const batch = await (
      await fileRequest(path, {
        ...scope,
        files: files.map(({ name, size }) => ({ name, size })),
      })
    ).json();
    id = batch.id;
    signal.throwIfAborted();
    const start = performance.now();
    const total = files.reduce((sum, file) => sum + file.size, 0);
    let received = 0;
    progress({ received: 0, total, speed: 0 });
    for (const [index, file] of files.entries()) {
      for (let offset = 0; offset < file.size;) {
        signal.throwIfAborted();
        const bytes = new Uint8Array(
          await file.slice(offset, offset + FILE_CHUNK_SIZE).arrayBuffer(),
        );
        const hash = new Uint8Array(
          await crypto.subtle.digest("SHA-256", bytes),
        );
        const sha256 = Array.from(hash, (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const result = await (
          await fileRequest(
            `/file-uploads/${id}/write`,
            {
              index,
              offset,
              data: btoa(binary),
              sha256,
            },
            signal,
          )
        ).json();
        if (result.offset !== offset + bytes.length)
          throw new Error("Invalid upload offset");
        offset = result.offset;
        received += bytes.length;
        progress({
          received,
          total,
          speed: (received * 1000) / Math.max(1, performance.now() - start),
        });
      }
    }
    const result = await (
      await fileRequest(`/file-uploads/${id}/finish`, {}, signal)
    ).json();
    signal.throwIfAborted();
    complete = true;
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}
