import { message as i18nMessage } from "../shared/i18n.js";
import { crc32, gunzipSync, inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensure } from "../shared/contracts.js";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_EXPANDED_BYTES,
  MAX_PACKAGE_BYTES,
} from "../shared/connector-update.js";

type Entry = { name: string; directory: boolean; data: Buffer; mode: number };
const safe = (ok: unknown) =>
  ensure(
    ok,
    "UNSAFE_ARCHIVE",
    i18nMessage(
      "errors.UNSAFE_ARCHIVE.unsafe.archive.structure.installation.was.refused",
    ),
  );
/** 拒绝所有链接、设备、路径别名及 Windows 特殊文件，解包不调用 shell。 */
export function archivePath(name: string) {
  safe(
    name.length > 0 && name.length <= 4096 && !/[\\:\x00-\x1f\x7f]/.test(name),
  );
  const parts = name.replace(/\/$/, "").split("/");
  safe(
    parts.every(
      (p) =>
        p &&
        p !== "." &&
        p !== ".." &&
        !/[. ]$/.test(p) &&
        !/[<>"|?*]/.test(p) &&
        !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
          p,
        ),
    ),
  );
  return parts.join("/");
}
function tarEntries(bytes: Buffer): Entry[] {
  const raw = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED_BYTES });
  const entries: Entry[] = [];
  let offset = 0,
    longName: string | undefined,
    ended = false;
  const text = (b: Buffer) =>
    new TextDecoder("utf-8", { fatal: true }).decode(b).split("\0")[0];
  const octal = (b: Buffer) => {
    const s = text(b).trim();
    safe(/^[0-7]*$/.test(s));
    return parseInt(s || "0", 8);
  };
  while (offset + 512 <= raw.length) {
    const h = raw.subarray(offset, offset + 512);
    offset += 512;
    if (h.every((b) => b === 0)) {
      safe(
        raw.subarray(offset).length >= 512 &&
          raw.subarray(offset).every((b) => b === 0),
      );
      ended = true;
      break;
    }
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    safe(sum === octal(h.subarray(148, 156)));
    const size = octal(h.subarray(124, 136)),
      mode = octal(h.subarray(100, 108));
    safe(
      Number.isSafeInteger(size) && size >= 0 && offset + size <= raw.length,
    );
    const data = raw.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    const type = h[156];
    if (type === 76) {
      safe(!longName && size <= 4097);
      longName = text(data);
      continue;
    }
    safe(type === 0 || type === 48 || type === 53);
    const prefix = text(h.subarray(345, 500));
    const name =
      longName || (prefix ? prefix + "/" : "") + text(h.subarray(0, 100));
    longName = undefined;
    safe(type !== 53 || size === 0);
    entries.push({ name, directory: type === 53, data, mode });
    safe(entries.length <= MAX_ARCHIVE_ENTRIES);
  }
  safe(ended && !longName && offset <= raw.length);
  return entries;
}
function zipEntries(bytes: Buffer): Entry[] {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  safe(end >= 0);
  safe(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0);
  const count = bytes.readUInt16LE(end + 10),
    start = bytes.readUInt32LE(end + 16),
    length = bytes.readUInt32LE(end + 12);
  safe(
    count > 0 &&
      count <= MAX_ARCHIVE_ENTRIES &&
      count === bytes.readUInt16LE(end + 8) &&
      start + length === end,
  );
  const entries: Entry[] = [];
  let offset = start,
    total = 0;
  const spans: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    safe(offset + 46 <= end && bytes.readUInt32LE(offset) === 0x02014b50);
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10),
      compressed = bytes.readUInt32LE(offset + 20),
      size = bytes.readUInt32LE(offset + 24);
    const nl = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32),
      local = bytes.readUInt32LE(offset + 42);
    safe(
      !(flags & ~0x80e) &&
        [0, 8].includes(method) &&
        bytes.readUInt16LE(offset + 34) === 0,
    );
    safe(
      offset + 46 + nl + extra + comment <= end &&
        local + 30 <= start &&
        bytes.readUInt32LE(local) === 0x04034b50,
    );
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nl);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16,
      kind = mode & 0xf000;
    const directory = name.endsWith("/");
    safe(kind === 0 || kind === (directory ? 0x4000 : 0x8000));
    const localNl = bytes.readUInt16LE(local + 26),
      localExtra = bytes.readUInt16LE(local + 28),
      begin = local + 30 + localNl + localExtra;
    safe(
      bytes.readUInt16LE(local + 6) === flags &&
        bytes.readUInt16LE(local + 8) === method &&
        nameBytes.equals(bytes.subarray(local + 30, local + 30 + localNl)) &&
        begin + compressed <= start,
    );
    spans.push([local, begin + compressed]);
    total += size;
    safe(total <= MAX_EXPANDED_BYTES && (!directory || size === 0));
    const source = bytes.subarray(begin, begin + compressed);
    const data =
      method === 0
        ? source
        : inflateRawSync(source, { maxOutputLength: Math.max(1, size) });
    safe(
      data.length === size && crc32(data) === bytes.readUInt32LE(offset + 16),
    );
    entries.push({ name, directory, data, mode });
    offset += 46 + nl + extra + comment;
  }
  spans.sort((a, b) => a[0] - b[0]);
  safe(spans.every((s, i) => !i || spans[i - 1][1] <= s[0]) && offset === end);
  return entries;
}
/** 先验证全部路径和展开预算，再写入全新专属目录；永不覆盖已有文件。 */
export function extractUpdate(
  bytes: Buffer,
  destination: string,
  folder: string,
  platform: "linux" | "windows",
) {
  safe(bytes.length <= MAX_PACKAGE_BYTES);
  let entries: Entry[];
  try {
    entries = platform === "linux" ? tarEntries(bytes) : zipEntries(bytes);
  } catch {
    ensure(
      false,
      "UNSAFE_ARCHIVE",
      i18nMessage(
        "errors.UNSAFE_ARCHIVE.unsafe.archive.structure.installation.was.refused",
      ),
    );
  }
  const paths = new Map<string, boolean>(),
    spelling = new Map<string, string>();
  let total = 0;
  for (const e of entries!) {
    e.name = archivePath(e.name);
    safe(e.name === folder || e.name.startsWith(folder + "/"));
    const components = e.name.split("/");
    for (let n = 1; n <= components.length; n++) {
      const prefix = components.slice(0, n).join("/"),
        lower = prefix.toUpperCase().toLowerCase();
      safe(!spelling.has(lower) || spelling.get(lower) === prefix);
      spelling.set(lower, prefix);
    }
    const key = e.name.toUpperCase().toLowerCase();
    safe(!paths.has(key));
    paths.set(key, e.directory);
    total += e.data.length;
    safe(total <= MAX_EXPANDED_BYTES);
  }
  for (const [name] of paths) {
    const parts = name.split("/");
    parts.pop();
    while (parts.length) {
      safe(paths.get(parts.join("/")) !== false);
      parts.pop();
    }
  }
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  for (const e of entries!) {
    const target = join(destination, e.name);
    if (e.directory) mkdirSync(target, { recursive: true, mode: 0o700 });
    else {
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, e.data, {
        flag: "wx",
        mode: e.mode & 0o111 ? 0o755 : 0o644,
      });
    }
  }
  return join(destination, folder);
}
