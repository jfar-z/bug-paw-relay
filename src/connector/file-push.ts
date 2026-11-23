import { randomUUID, createHash, type Hash } from "node:crypto";
import { ensure } from "../shared/contracts.js";
import { message } from "../shared/i18n.js";
import { FILE_CHUNK_SIZE, FILE_TTL } from "../shared/files.js";
import {
  uploadChunkSchema,
  uploadEntriesSchema,
  type UploadEntry,
} from "../shared/uploads.js";
/** 目标适配器拥有落盘与发布策略；通用下发器不依赖会话、项目或附件路径。 */
export interface PushSink {
  write(bytes: Buffer, offset: number): Promise<void>;
  finish(sha256: string): Promise<unknown>;
  abort(): Promise<void>;
}
type Batch = {
  entries: UploadEntry[];
  sinks: PushSink[];
  offsets: number[];
  hashes: Hash[];
  results: unknown[];
  check: () => Promise<void>;
  expires: number;
  busy: boolean;
  cancelled: boolean;
};
/** 每批最多一块在途；大小、顺序与摘要验证失败立即释放临时材料。 */
export class FilePushReceiver {
  private batches = new Map<string, Batch>();
  private opening = 0;
  private generation = 0;
  private timer = setInterval(() => {
    for (const [id, b] of this.batches)
      if (b.expires <= Date.now()) void this.cancel(id);
  }, 30000).unref();
  get busy() {
    return this.opening > 0 || this.batches.size > 0;
  }
  async begin(
    entries: unknown,
    check: () => Promise<void>,
    create: (entry: UploadEntry) => Promise<PushSink>,
  ) {
    const parsed = uploadEntriesSchema.parse(entries);
    ensure(
      this.batches.size + this.opening < 16,
      "UPLOAD_LIMIT",
      message("uploads.limit"),
      429,
    );
    this.opening++;
    const generation = this.generation;
    const sinks: PushSink[] = [];
    try {
      await check();
      for (const entry of parsed) sinks.push(await create(entry));
      await check();
      ensure(
        generation === this.generation,
        "UPLOAD_EXPIRED",
        message("uploads.expired"),
        409,
      );
      const id = randomUUID();
      this.batches.set(id, {
        entries: parsed,
        sinks,
        offsets: parsed.map(() => 0),
        hashes: parsed.map(() => createHash("sha256")),
        results: parsed.map(() => null),
        check,
        expires: Date.now() + FILE_TTL,
        busy: false,
        cancelled: false,
      });
      return {
        id,
        chunkSize: FILE_CHUNK_SIZE,
        expiresAt: Date.now() + FILE_TTL,
      };
    } catch (e) {
      await Promise.allSettled(sinks.map((s) => s.abort()));
      throw e;
    } finally {
      this.opening--;
    }
  }
  async call(id: string, action: "write" | "finish", input: unknown) {
    const b = this.batches.get(id);
    ensure(
      b && !b.cancelled && b.expires > Date.now(),
      "UPLOAD_EXPIRED",
      message("uploads.expired"),
      404,
    );
    ensure(!b.busy, "UPLOAD_BUSY", message("uploads.busy"), 409);
    b.busy = true;
    try {
      await b.check();
      if (action === "write") {
        const p = uploadChunkSchema.parse(input);
        const bytes = Buffer.from(p.data, "base64");
        ensure(
          p.index < b.entries.length &&
            b.results[p.index] === null &&
            p.offset === b.offsets[p.index] &&
            bytes.length > 0 &&
            bytes.length <= FILE_CHUNK_SIZE &&
            p.offset + bytes.length <= b.entries[p.index]!.size &&
            bytes.toString("base64") === p.data &&
            createHash("sha256").update(bytes).digest("hex") === p.sha256,
          "UPLOAD_CORRUPT",
          message("uploads.corrupt"),
        );
        await b.sinks[p.index]!.write(bytes, p.offset);
        await b.check();
        ensure(!b.cancelled, "UPLOAD_EXPIRED", message("uploads.expired"), 409);
        b.hashes[p.index]!.update(bytes);
        b.offsets[p.index]! += bytes.length;
        b.expires = Date.now() + FILE_TTL;
        return { offset: b.offsets[p.index] };
      }
      ensure(
        b.entries.every((f, i) => f.size === b.offsets[i]),
        "UPLOAD_INCOMPLETE",
        message("uploads.incomplete"),
        409,
      );
      for (let i = 0; i < b.entries.length; i++) {
        await b.check();
        ensure(!b.cancelled, "UPLOAD_EXPIRED", message("uploads.expired"), 409);
        b.results[i] = await b.sinks[i]!.finish(b.hashes[i]!.digest("hex"));
      }
      await b.check();
      ensure(!b.cancelled, "UPLOAD_EXPIRED", message("uploads.expired"), 409);
      this.batches.delete(id);
      return { files: b.results };
    } catch (e) {
      b.cancelled = true;
      this.batches.delete(id);
      await Promise.allSettled(b.sinks.map((s) => s.abort()));
      throw e;
    } finally {
      b.busy = false;
      if (b.cancelled) await Promise.allSettled(b.sinks.map((s) => s.abort()));
    }
  }
  async cancel(id: string) {
    const b = this.batches.get(id);
    if (!b) return;
    b.cancelled = true;
    this.batches.delete(id);
    if (!b.busy) await Promise.allSettled(b.sinks.map((s) => s.abort()));
  }
  async disconnect() {
    this.generation++;
    await Promise.allSettled(
      [...this.batches.keys()].map((id) => this.cancel(id)),
    );
  }
  close() {
    clearInterval(this.timer);
    return this.disconnect();
  }
}
