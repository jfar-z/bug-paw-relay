import { z } from "zod";
import { FILE_CHUNK_SIZE } from "./files.js";
/** 下发协议只描述字节和元信息；目标位置及业务授权由调用方决定。 */
export const uploadCapability = "file-push-v1";
export const UPLOAD_FILE_LIMIT = 128 * 1024 ** 2;
export const UPLOAD_TOTAL_LIMIT = 256 * 1024 ** 2;
export const uploadEntrySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(240)
      .refine((v) => !/[\x00-\x1f\x7f/\\]/.test(v)),
    size: z.number().int().min(0).max(UPLOAD_FILE_LIMIT),
  })
  .strict();
export const uploadEntriesSchema = z
  .array(uploadEntrySchema)
  .min(1)
  .max(16)
  .refine((v) => v.reduce((n, f) => n + f.size, 0) <= UPLOAD_TOTAL_LIMIT);
export const uploadChunkSchema = z
  .object({
    index: z.number().int().min(0).max(15),
    offset: z.number().int().min(0).max(UPLOAD_FILE_LIMIT),
    data: z.string().max(Math.ceil(FILE_CHUNK_SIZE / 3) * 4),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const attachmentSchema = uploadEntrySchema.extend({
  path: z.string().regex(/^attachments\/relay-[a-f0-9-]{36}\/[^/\\]+$/),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const attachmentsSchema = z
  .array(attachmentSchema)
  .max(16)
  .refine((v) => v.reduce((n, f) => n + f.size, 0) <= UPLOAD_TOTAL_LIMIT);
export type UploadEntry = z.infer<typeof uploadEntrySchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
/** 使用编码路径和转义标签，文件名不能注入额外 Markdown 或改变链接目标。 */
export function attachmentLink(name: string, path: string) {
  const label = name.replace(/[\\`*_[\]<>]/g, "\\$&");
  const href = path
    .split("/")
    .map((p) =>
      encodeURIComponent(p).replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join("/");
  return `[${label}](${href})`;
}
export function attachmentMessage(text: string, attachments: Attachment[]) {
  if (!attachments.length) return text;
  return (
    text +
    "\n\nAttachments / 附件：\n" +
    attachments.map((a) => "- " + attachmentLink(a.name, a.path)).join("\n")
  );
}
