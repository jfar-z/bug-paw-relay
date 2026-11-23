import { message as i18nMessage } from "../shared/i18n.js";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { ensure } from "../shared/contracts.js";
import {
  FILE_CHUNK_SIZE,
  FILE_TTL,
  fileInfoSchema,
  type FileInfo,
  type FileSource,
} from "../shared/files.js";
import type { RpcPeer } from "../shared/rpc.js";
/** 调用方提供业务授权复核；传输层不依赖会话模型，也不决定文件最终存储位置。 */
export type FileAuthorization = {
  peer: RpcPeer;
  source: FileSource;
  revalidate: () => void;
};
type Transfer = FileAuthorization & {
  owner: string;
  info: FileInfo;
  expiresAt: number;
  busy: boolean;
};
/** 通用拉取式传输：最多一块在途，短期引用绑定登录会话，内存只保留元信息。 */
export class FileTransfers {
  private transfers = new Map<string, Transfer>();
  private opening = new Map<RpcPeer, number>();
  /** 已打开的传输仍可能继续读下一块，更新必须等待引用关闭或到期。 */
  busyFor(peer: RpcPeer | undefined) {
    this.prune();
    return (
      !!peer &&
      (this.opening.has(peer) ||
        [...this.transfers.values()].some((t) => t.peer === peer))
    );
  }
  private prune() {
    for (const [id, t] of this.transfers)
      if (t.expiresAt <= Date.now()) this.transfers.delete(id);
  }
  async create(owner: string, grant: FileAuthorization) {
    this.prune();
    ensure(
      this.transfers.size +
        [...this.opening.values()].reduce((sum, count) => sum + count, 0) <
        64,
      "TRANSFER_LIMIT",
      i18nMessage("errors.TRANSFER_LIMIT.too.many.open.files.close.other"),
      429,
    );
    this.opening.set(grant.peer, (this.opening.get(grant.peer) ?? 0) + 1);
    try {
      grant.revalidate();
      const info = fileInfoSchema.parse(
        await grant.peer.call("files.inspect", { source: grant.source }),
      );
      grant.revalidate();
      const id = randomUUID(),
        expiresAt = Date.now() + FILE_TTL;
      this.transfers.set(id, { ...grant, owner, info, expiresAt, busy: false });
      return { ...info, id, expiresAt };
    } finally {
      const remaining = this.opening.get(grant.peer)! - 1;
      if (remaining) this.opening.set(grant.peer, remaining);
      else this.opening.delete(grant.peer);
    }
  }
  private get(owner: string, id: string) {
    this.prune();
    const t = this.transfers.get(id);
    ensure(
      t && t.owner === owner,
      "TRANSFER_EXPIRED",
      i18nMessage("errors.TRANSFER_EXPIRED.the.file.reference.expired.open.it"),
      404,
    );
    t.revalidate();
    return t;
  }
  async read(owner: string, id: string, offset: number) {
    const t = this.get(owner, id);
    ensure(
      !t.busy,
      "TRANSFER_BUSY",
      i18nMessage("errors.TRANSFER_BUSY.the.file.is.being.transferred"),
      409,
    );
    ensure(
      Number.isSafeInteger(offset) && offset >= 0 && offset <= t.info.size,
      "RANGE_INVALID",
      i18nMessage("errors.RANGE_INVALID.invalid.read.range"),
      416,
    );
    t.busy = true;
    try {
      const result = z
        .object({
          offset: z.literal(offset),
          data: z.string().max(Math.ceil(FILE_CHUNK_SIZE / 3) * 4),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(
          await t.peer.call("files.read", {
            source: t.source,
            version: t.info.version,
            offset,
            length: FILE_CHUNK_SIZE,
          }),
        );
      this.get(owner, id);
      const bytes = Buffer.from(result.data, "base64");
      ensure(
        bytes.length === Math.min(FILE_CHUNK_SIZE, t.info.size - offset) &&
          createHash("sha256").update(bytes).digest("hex") === result.sha256,
        "TRANSFER_CORRUPT",
        i18nMessage(
          "errors.TRANSFER_CORRUPT.transfer.verification.failed.try.again",
        ),
        502,
      );
      t.expiresAt = Date.now() + FILE_TTL;
      return bytes;
    } finally {
      t.busy = false;
    }
  }
  cancel(owner: string, id: string) {
    const t = this.transfers.get(id);
    if (t?.owner === owner) this.transfers.delete(id);
  }
  close() {
    this.transfers.clear();
  }
}
