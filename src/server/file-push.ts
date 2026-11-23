import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ensure } from "../shared/contracts.js";
import { message } from "../shared/i18n.js";
import { FILE_TTL } from "../shared/files.js";
import { uploadEntriesSchema, uploadChunkSchema } from "../shared/uploads.js";
import type { RpcPeer } from "../shared/rpc.js";
/** 通用下发授权由业务入口提供；仅保留元信息，绝不持久化字节或目标正文。 */
export interface PushAuthorization {
  peer: RpcPeer;
  destination: unknown;
  revalidate(): void;
  receipt?(cwd: string, files: unknown): string;
}
type Transfer = PushAuthorization & {
  owner: string;
  remoteId: string;
  expires: number;
  busy: boolean;
  cwd?: string;
};
export class FilePushTransfers {
  private transfers = new Map<string, Transfer>();
  private openings = new Map<RpcPeer, number>();
  private timer = setInterval(() => {
    for (const [id, t] of this.transfers) {
      try {
        t.revalidate();
        if (t.expires <= Date.now()) throw Error();
      } catch {
        void this.cancel(t.owner, id);
      }
    }
  }, 30000).unref();
  busyFor(peer: RpcPeer | undefined) {
    return (
      !!peer &&
      (this.openings.has(peer) ||
        [...this.transfers.values()].some((t) => t.peer === peer))
    );
  }
  async create(owner: string, grant: PushAuthorization, entries: unknown) {
    const files = uploadEntriesSchema.parse(entries);
    ensure(
      this.transfers.size +
        [...this.openings.values()].reduce((a, b) => a + b, 0) <
        32,
      "UPLOAD_LIMIT",
      message("uploads.limit"),
      429,
    );
    grant.revalidate();
    this.openings.set(grant.peer, (this.openings.get(grant.peer) || 0) + 1);
    let remoteId: string | undefined;
    try {
      const result = z
        .object({
          id: z.uuid(),
          chunkSize: z.number(),
          expiresAt: z.number(),
          cwd: z.string().min(1).optional(),
        })
        .parse(
          await grant.peer.call("files.push.begin", {
            destination: grant.destination,
            files,
          }),
        );
      remoteId = result.id;
      grant.revalidate();
      const id = randomUUID();
      this.transfers.set(id, {
        ...grant,
        owner,
        remoteId,
        expires: Date.now() + FILE_TTL,
        busy: false,
        cwd: result.cwd,
      });
      return { ...result, id };
    } catch (e) {
      if (remoteId)
        await grant.peer
          .call("files.push.cancel", { id: remoteId })
          .catch(() => {});
      throw e;
    } finally {
      const count = this.openings.get(grant.peer)! - 1;
      if (count) this.openings.set(grant.peer, count);
      else this.openings.delete(grant.peer);
    }
  }
  async call(
    owner: string,
    id: string,
    action: "write" | "finish",
    input: unknown,
  ) {
    const t = this.transfers.get(id);
    ensure(
      t && t.owner === owner,
      "UPLOAD_EXPIRED",
      message("uploads.expired"),
      404,
    );
    ensure(!t.busy, "UPLOAD_BUSY", message("uploads.busy"), 409);
    t.busy = true;
    try {
      t.revalidate();
      ensure(
        t.expires > Date.now(),
        "UPLOAD_EXPIRED",
        message("uploads.expired"),
        404,
      );
      const data = action === "write" ? uploadChunkSchema.parse(input) : {};
      const result = await t.peer.call("files.push." + action, {
        id: t.remoteId,
        ...data,
      });
      t.revalidate();
      ensure(
        this.transfers.get(id) === t,
        "UPLOAD_EXPIRED",
        message("uploads.expired"),
        409,
      );
      t.expires = Date.now() + FILE_TTL;
      if (action === "finish") {
        this.transfers.delete(id);
        if (t.receipt) {
          const files = z.object({ files: z.unknown() }).parse(result).files;
          return {
            files,
            attachmentReceipt: t.receipt(z.string().min(1).parse(t.cwd), files),
          };
        }
      }
      return result;
    } catch (e) {
      await this.cancel(owner, id);
      throw e;
    } finally {
      t.busy = false;
    }
  }
  async cancel(owner: string, id: string) {
    const t = this.transfers.get(id);
    if (!t || t.owner !== owner) return;
    this.transfers.delete(id);
    await t.peer.call("files.push.cancel", { id: t.remoteId }).catch(() => {});
  }
  async close() {
    clearInterval(this.timer);
    await Promise.allSettled(
      [...this.transfers].map(([id, t]) => this.cancel(t.owner, id)),
    );
  }
}
