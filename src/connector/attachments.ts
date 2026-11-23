import { randomUUID, createHash } from "node:crypto";
import {
  type FileHandle,
  appendFile,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ensure, AppError } from "../shared/contracts.js";
import { message } from "../shared/i18n.js";
import { type UploadEntry, type Attachment } from "../shared/uploads.js";
import { fileInfoSchema, FILE_CHUNK_SIZE, FILE_TTL } from "../shared/files.js";
import { EnvironmentFiles } from "./files.js";
import type { PushSink } from "./file-push.js";
/** 仅忽略本次随机生成的两个目录；使用本地 exclude，兼容 linked worktree，不改共享规则。 */
async function ignoreGenerated(cwd: string, paths: string[]) {
  let root = cwd;
  while (true) {
    let marker;
    try {
      marker = await lstat(join(root, ".git"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (marker) {
      ensure(!marker.isSymbolicLink(), "UPLOAD_PATH", message("uploads.path"));
      let gitdir = join(root, ".git");
      if (marker.isFile()) {
        const text = await readFile(gitdir, "utf8");
        ensure(
          text.startsWith("gitdir: "),
          "UPLOAD_PATH",
          message("uploads.path"),
        );
        gitdir = resolve(root, text.slice(8).trim());
      }
      try {
        gitdir = resolve(
          gitdir,
          (await readFile(join(gitdir, "commondir"), "utf8")).trim(),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await mkdir(join(gitdir, "info"), { recursive: true });
      const patterns = paths.map(
        (p) =>
          "/" +
          relative(root, p)
            .split(sep)
            .join("/")
            .replace(/[\\*?\[\] !#]/g, "\\$&") +
          "/",
      );
      await appendFile(
        join(gitdir, "info", "exclude"),
        "\n" + patterns.join("\n") + "\n",
        "utf8",
      );
      return;
    }
    const parent = dirname(root);
    if (parent === root) return;
    root = parent;
  }
}
/** 崩溃遗留材料在再次使用目录时有界回收；只处理本功能保留命名空间中的过期单文件目录。 */
async function pruneTemporary(parent: string) {
  const directory = await opendir(parent);
  let scanned = 0;
  for await (const entry of directory) {
    if (++scanned > 1024) break;
    if (
      !entry.isDirectory() ||
      !/^\.relay-upload-[a-f0-9-]{36}$/.test(entry.name)
    )
      continue;
    const path = join(parent, entry.name);
    const contents = await readdir(path).catch(() => []);
    if (contents.length > 1) continue;
    const metadata = await lstat(path).catch(() => null);
    const file = contents.length
      ? await lstat(join(path, contents[0]!)).catch(() => null)
      : null;
    if (
      !metadata?.isDirectory() ||
      metadata.isSymbolicLink() ||
      (contents.length && (!file?.isFile() || file.isSymbolicLink())) ||
      Math.max(metadata.mtimeMs, file?.mtimeMs || 0) > Date.now() - FILE_TTL
    )
      continue;
    if ((await realpath(path).catch(() => null)) === path)
      await rm(path, { recursive: true, force: true });
  }
}
/** 附件目标适配器：临时目录与完成目录分离，完成时原子发布，不覆盖同名文件。 */
export async function attachmentSink(
  cwd: string,
  entry: UploadEntry,
  check: () => Promise<void>,
  files: EnvironmentFiles,
  source: { rootId: string; relativePath: string },
): Promise<PushSink> {
  const parent = join(cwd, "attachments");
  try {
    await mkdir(parent);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const parentStat = await lstat(parent);
  ensure(
    parentStat.isDirectory() &&
      !parentStat.isSymbolicLink() &&
      (await realpath(parent)) === parent,
    "UPLOAD_PATH",
    message("uploads.path"),
    403,
  );
  await pruneTemporary(parent);
  const id = randomUUID();
  const temporary = join(parent, ".relay-upload-" + id);
  const final = join(parent, "relay-" + id);
  // 原名用于展示；磁盘名移除 Windows 保留字符，UUID 目录保证不会改写旧附件。
  let name = entry.name.replace(/[<>:"|?*#]/g, "_").replace(/[. ]+$/, "_");
  if (
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ||
    name === "." ||
    name === ".."
  )
    name = "_" + name;
  // 保留完整展示名；仅磁盘名按 UTF-8 文件系统上限截短，避免中文名被无谓拒绝。
  while (Buffer.byteLength(name) > 240)
    name = Array.from(name).slice(0, -1).join("");
  if (name.startsWith(".relay-upload-")) name = "_" + name;
  await ignoreGenerated(cwd, [temporary, final]);
  await mkdir(temporary, { mode: 0o700 });
  const directoryStat = await lstat(temporary);
  let handle: FileHandle;
  try {
    handle = await open(
      join(temporary, name),
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        (constants.O_NOFOLLOW || 0),
      0o600,
    );
  } catch (e) {
    await rm(temporary, { recursive: true, force: true });
    throw e;
  }
  const fileStat = await handle.stat();
  let closed = false,
    published = false;
  async function verify() {
    await check();
    const currentParent = await lstat(parent);
    const dir = await lstat(temporary);
    const file = await lstat(join(temporary, name));
    ensure(
      currentParent.isDirectory() &&
        !currentParent.isSymbolicLink() &&
        currentParent.dev === parentStat.dev &&
        currentParent.ino === parentStat.ino &&
        (await realpath(parent)) === parent &&
        !dir.isSymbolicLink() &&
        dir.dev === directoryStat.dev &&
        dir.ino === directoryStat.ino &&
        (await realpath(temporary)) === temporary &&
        file.isFile() &&
        !file.isSymbolicLink() &&
        file.dev === fileStat.dev &&
        file.ino === fileStat.ino,
      "UPLOAD_PATH",
      message("uploads.path"),
      403,
    );
  }
  async function close() {
    if (!closed) {
      closed = true;
      await handle.close();
    }
  }
  return {
    async write(bytes, offset) {
      await verify();
      let written = 0;
      while (written < bytes.length) {
        const result = await handle.write(
          bytes,
          written,
          bytes.length - written,
          offset + written,
        );
        ensure(
          result.bytesWritten > 0,
          "UPLOAD_WRITE",
          message("uploads.write"),
        );
        written += result.bytesWritten;
      }
      await verify();
    },
    async finish(sha256) {
      await verify();
      ensure(
        (await handle.stat()).size === entry.size,
        "UPLOAD_INCOMPLETE",
        message("uploads.incomplete"),
      );
      // 完成前有界重读实际落盘内容，防止磁盘内容与收到的分块摘要不一致。
      const hash = createHash("sha256");
      const buffer = Buffer.alloc(FILE_CHUNK_SIZE);
      for (let offset = 0; offset < entry.size;) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, entry.size - offset),
          offset,
        );
        ensure(
          bytesRead > 0,
          "UPLOAD_INCOMPLETE",
          message("uploads.incomplete"),
        );
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      ensure(
        hash.digest("hex") === sha256,
        "UPLOAD_CORRUPT",
        message("uploads.corrupt"),
      );
      await handle.sync();
      await close();
      await verify();
      try {
        await lstat(final);
        throw new AppError("UPLOAD_PATH", message("uploads.path"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await rename(temporary, final);
      published = true;
      const path = "attachments/relay-" + id + "/" + name;
      const info = fileInfoSchema.parse(
        await files.call("files.inspect", {
          source: {
            rootId: source.rootId,
            relativePath: source.relativePath,
            path,
          },
        }),
      );
      return { ...entry, path, sha256, version: info.version };
    },
    async abort() {
      await close();
      // 成功文件属于用户；取消、草稿移除和会话删除均不删除已发布内容。
      if (!published) {
        const current = await lstat(temporary).catch(() => null);
        const actualParent = await realpath(parent).catch(() => null);
        if (
          actualParent === parent &&
          current?.ino === directoryStat.ino &&
          current?.dev === directoryStat.dev
        )
          await rm(temporary, { recursive: true, force: true });
      }
    },
  };
}
/** 发送前复核真实文件与版本；未完成临时文件不符合附件路径契约。 */
export async function validateAttachments(
  files: EnvironmentFiles,
  source: { rootId: string; relativePath: string },
  attachments: Attachment[],
) {
  for (const a of attachments) {
    const info = fileInfoSchema.parse(
      await files.call("files.inspect", {
        source: {
          rootId: source.rootId,
          relativePath: source.relativePath,
          path: a.path,
        },
      }),
    );
    ensure(
      info.size === a.size && info.version === a.version,
      "FILE_CHANGED",
      message("errors.FILE_CHANGED.the.file.has.changed.open.it"),
      409,
    );
  }
}
