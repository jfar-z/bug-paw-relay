import { message as i18nMessage } from "../shared/i18n.js";
import { open, realpath, stat } from "node:fs/promises";
import { constants, type Stats } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { safeAsset, lightError } from "../shared/light-apps.js";
import { AppError, ensure } from "../shared/contracts.js";
import {
  FILE_CHUNK_SIZE,
  fileSourceSchema,
  fileFormat,
  type FileSource,
} from "../shared/files.js";
/** Windows 文件链接可能使用 /F:/ URL 路径；仅移除盘符前的单个分隔符，不解码文件名。 */
export function normalizeEnvironmentFilePath(
  value: string,
  platform: NodeJS.Platform = process.platform,
) {
  let path = value;
  if (platform === "win32" && /^[\\/][a-z]:[\\/]/i.test(path))
    path = path.slice(1);
  ensure(
    !/[\x00-\x1f\x7f]/.test(path) && !/^(\\\\|\/\/)/.test(path),
    "PATH_INVALID",
    i18nMessage("errors.PATH_INVALID.invalid.file.path"),
  );
  if (platform === "win32") {
    // 盘符冒号是普通路径的一部分；其余冒号才可能表示 NTFS 数据流。
    ensure(
      !path.replace(/^[a-z]:[\\/]/i, "").includes(":"),
      "PATH_INVALID",
      i18nMessage(
        "errors.PATH_INVALID.device.paths.and.alternate.data.streams",
      ),
    );
    ensure(
      !/^[a-z]:[^\\/]/i.test(path),
      "PATH_INVALID",
      i18nMessage("errors.PATH_INVALID.use.a.full.drive.path.with"),
    );
  }
  return path;
}
/** 文件读取不持有长生命周期句柄；每块验证根目录、路径、文件身份及版本。 */
export class EnvironmentFiles {
  constructor(private roots: () => { id: string; path: string }[]) {}
  private within(base: string, path: string) {
    const rel = relative(base, path);
    return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
  }
  private async locate(source: FileSource) {
    const roots = this.roots();
    const path = normalizeEnvironmentFilePath(source.path);
    if (source.lightAsset && !safeAsset(path)) lightError("LIGHT_FILE", 400);
    if (source.expectedCwd)
      ensure(!isAbsolute(path), "PATH_INVALID", i18nMessage("errors.PATH_INVALID.invalid.file.path"));
    let requested = path;
    // 绝对路径仅由全部工作根目录授权，不依赖当前项目或会话目录是否仍然存在。
    if (!isAbsolute(path)) {
      const root = roots.find((r) => r.id === source.rootId);
      ensure(
        root,
        "ROOT_UNKNOWN",
        i18nMessage("errors.ROOT_UNKNOWN.workspace.root.not.found"),
      );
      ensure(
        !isAbsolute(source.relativePath),
        "PATH_INVALID",
        i18nMessage("errors.PATH_INVALID.invalid.session.working.directory"),
      );
      const base = await realpath(root.path);
      const cwd = await realpath(resolve(base, source.relativePath));
      ensure(
        this.within(base, cwd) && (await stat(cwd)).isDirectory(),
        "PATH_ESCAPE",
        i18nMessage("errors.PATH_ESCAPE.the.working.directory.is.outside.the"),
        403,
      );
      requested = resolve(cwd, path);
      if (source.expectedCwd)
        ensure(source.expectedCwd === cwd && this.within(cwd, requested), "PATH_ESCAPE",
          i18nMessage("errors.PATH_ESCAPE.the.file.is.outside.the.environment"), 403);
      // 发布目录内的符号链接可能把凭据伪装成普通资源，逐块复核真实位置。
      if (source.lightAsset && (await realpath(requested)) !== requested)
        lightError("LIGHT_FILE", 403);
    }
    const target = await realpath(requested);
    if (source.expectedCwd)
      ensure(target === requested, "PATH_ESCAPE", i18nMessage("errors.PATH_ESCAPE.the.file.is.outside.the.environment"), 403);
    ensure(
      ![requested, target].some((p) =>
        p.split(/[\\/]/).some((part) => part.startsWith(".relay-upload-")),
      ),
      "UPLOAD_INCOMPLETE",
      i18nMessage("uploads.incomplete"),
      403,
    );
    const allowed = await Promise.all(
      roots.map(async (r) => {
        try {
          return this.within(await realpath(r.path), target);
        } catch {
          return false;
        }
      }),
    );
    ensure(
      allowed.some(Boolean),
      "PATH_ESCAPE",
      i18nMessage("errors.PATH_ESCAPE.the.file.is.outside.the.environment"),
      403,
    );
    return { requested, target };
  }
  private version(s: Stats) {
    return createHash("sha256")
      .update([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":"))
      .digest("hex");
  }
  async call(method: string, input: unknown) {
    try {
      const data = (
        method === "files.inspect"
          ? z.object({ source: fileSourceSchema }).strict()
          : z
              .object({
                source: fileSourceSchema,
                version: z.string().regex(/^[a-f0-9]{64}$/),
                offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
                length: z.number().int().min(1).max(FILE_CHUNK_SIZE),
              })
              .strict()
      ).parse(input);
      const { requested, target } = await this.locate(data.source);
      const before = await stat(target);
      ensure(
        before.isFile(),
        "NOT_FILE",
        i18nMessage("errors.NOT_FILE.only.regular.files.can.be.read"),
      );
      const handle = await open(
        target,
        constants.O_RDONLY |
          (constants.O_NOFOLLOW || 0) |
          (constants.O_NONBLOCK || 0),
      );
      try {
        const opened = await handle.stat();
        const version = this.version(opened);
        ensure(
          opened.isFile() &&
            version === this.version(before) &&
            (await realpath(requested)) === target,
          "FILE_CHANGED",
          i18nMessage("errors.FILE_CHANGED.the.file.has.changed.open.it"),
          409,
        );
        if (method === "files.inspect")
          return {
            name: basename(target),
            size: opened.size,
            modifiedAt: opened.mtime.toISOString(),
            version,
            ...fileFormat(basename(target)),
          };
        const p = data as typeof data & {
          version: string;
          offset: number;
          length: number;
        };
        ensure(
          p.version === version,
          "FILE_CHANGED",
          i18nMessage("errors.FILE_CHANGED.the.file.has.changed.open.it"),
          409,
        );
        ensure(
          p.offset <= opened.size,
          "RANGE_INVALID",
          i18nMessage("errors.RANGE_INVALID.invalid.read.range"),
          416,
        );
        const buffer = Buffer.alloc(Math.min(p.length, opened.size - p.offset));
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          p.offset,
        );
        ensure(
          bytesRead === buffer.length &&
            this.version(await handle.stat()) === version &&
            (await realpath(requested)) === target,
          "FILE_CHANGED",
          i18nMessage(
            "errors.FILE_CHANGED.the.file.changed.during.transfer.open",
          ),
          409,
        );
        // 目录配置可能在磁盘读取期间被修改，返回内容前再次校验。
        ensure(
          (await this.locate(data.source)).target === target,
          "FILE_CHANGED",
          i18nMessage("errors.FILE_CHANGED.the.file.has.changed.open.it"),
          409,
        );
        return {
          offset: p.offset,
          data: buffer.toString("base64"),
          sha256: createHash("sha256").update(buffer).digest("hex"),
        };
      } finally {
        await handle.close();
      }
    } catch (e) {
      if (e instanceof AppError || e instanceof z.ZodError) throw e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR")
        throw new AppError(
          "FILE_NOT_FOUND",
          i18nMessage("errors.FILE_NOT_FOUND.the.file.does.not.exist.or"),
          404,
        );
      if (code === "EACCES" || code === "EPERM")
        throw new AppError(
          "FILE_DENIED",
          i18nMessage(
            "errors.FILE_DENIED.the.environment.process.does.not.have",
          ),
          403,
        );
      throw new AppError(
        "FILE_READ_FAILED",
        i18nMessage("errors.FILE_READ_FAILED.could.not.read.the.file.open"),
      );
    }
  }
}
