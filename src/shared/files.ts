import { z } from "zod";
/** 通用环境文件传输协议；业务授权由调用方提供，不绑定聊天或存储目的地。 */
export const FILE_CHUNK_SIZE = 256 * 1024;
export const FILE_TTL = 10 * 60 * 1000;
export const fileSourceSchema = z
  .object({
    expectedCwd: z.string().min(1).max(4096).optional(),
    lightAsset: z.literal(true).optional(),
    rootId: z.string().min(1),
    relativePath: z.string().max(4096),
    path: z.string().min(1).max(4096),
  })
  .strict();
export type FileSource = z.infer<typeof fileSourceSchema>;
export const fileInfoSchema = z.object({
  name: z.string().min(1).max(1024),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  modifiedAt: z.string(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  mime: z.string().max(100),
  kind: z.enum(["text", "image", "video", "unsupported"]),
});
export type FileInfo = z.infer<typeof fileInfoSchema>;
export type FileTicket = FileInfo & { id: string; expiresAt: number };
/** 链接语义统一解析；危险协议不进入浏览器或本地读取接口。 */
export function classifyFileLink(raw: string): {
  kind: "web" | "file" | "blocked";
  value: string;
  line?: number;
} {
  const value = raw.trim();
  if (!value || /[\x00-\x1f\x7f]/.test(value))
    return { kind: "blocked", value: "" };
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.username || url.password) return { kind: "blocked", value: "" };
      return { kind: "web", value: url.href };
    } catch {
      return { kind: "blocked", value: "" };
    }
  }
  let path = value;
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost")
        return { kind: "blocked", value: "" };
      path = url.pathname + url.hash;
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } catch {
      return { kind: "blocked", value: "" };
    }
  }
  // Markdown 会把 Windows 反斜杠编码成 %5C；先解码一次，再判断盘符和行号。
  // 解码后重新检查协议，不能借百分号编码绕过危险链接拦截。
  try {
    path = decodeURIComponent(path);
  } catch {
    return { kind: "blocked", value: "" };
  }
  if (
    !path ||
    /[\x00-\x1f\x7f]/.test(path) ||
    /^(\/\/|\\\\)/.test(path) ||
    path.startsWith("#") ||
    (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
  )
    return { kind: "blocked", value: "" };
  const suffix = path.match(
    /(?:#L(\d+)(?:C\d+)?(?:-L?\d+)?|:(\d+)(?::\d+)?)$/i,
  );
  if (suffix) path = path.slice(0, -suffix[0].length);
  return {
    kind: "file",
    value: path,
    line: suffix ? Number(suffix[1] || suffix[2]) : undefined,
  };
}
/** 预览只使用惰性内容白名单，HTML/SVG 作为源码而非活动文档。 */
export function fileFormat(name: string): Pick<FileInfo, "mime" | "kind"> {
  const ext = name.split(".").at(-1)?.toLowerCase() || "";
  const images: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
  };
  const videos: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
  };
  if (images[ext]) return { kind: "image", mime: images[ext] };
  if (videos[ext]) return { kind: "video", mime: videos[ext] };
  if (
    /^(txt|md|mdx|json|jsonl|csv|log|yaml|yml|toml|ini|xml|html|htm|svg|css|scss|js|jsx|ts|tsx|py|java|c|h|cpp|hpp|cs|go|rs|sh|bash|ps1|sql|vue|svelte|properties|gitignore|dockerignore)$/.test(
      ext,
    ) ||
    /^(Dockerfile|Makefile|LICENSE|NOTICE)$/i.test(name)
  )
    return { kind: "text", mime: "text/plain" };
  return { kind: "unsupported", mime: "application/octet-stream" };
}
export const previewLimits = {
  text: 2 * 1024 ** 2,
  image: 20 * 1024 ** 2,
  video: 128 * 1024 ** 2,
  unsupported: 0,
};
