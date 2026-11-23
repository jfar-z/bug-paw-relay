import { message as i18nMessage } from "../shared/i18n.js";
import { mkdir, open, rename, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  ensure,
  idSchema,
  type Entity,
} from "../shared/contracts.js";
import { FILE_CHUNK_SIZE, fileFormat } from "../shared/files.js";
import type { RpcPeer } from "../shared/rpc.js";
import { FileTransfers } from "./file-transfers.js";
import { Service } from "./service.js";

const requestSchema = z
  .object({
    // 兼容旧连接器重复传入的路由字段，计算幂等摘要前将其移除。
    method: z.literal("workflow.handoff").optional(),
    itemId: idSchema,
    executionId: idSchema,
    operationId: idSchema,
    targetId: z.string().min(1).max(100),
    record: z.string().trim().min(1).max(100000),
    artifacts: z
      .array(
        z
          .object({
            path: z.string().min(1).max(4096),
            name: z
              .string()
              .min(1)
              .max(255)
              .refine(
                (v) => !/[\\/\x00-\x1f\x7f]/.test(v),
                "产物名称不能包含路径或控制字符",
              )
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict()
  .transform(({ method, ...payload }) => payload);
type Request = z.infer<typeof requestSchema>;
/** 产物是显式交付快照；复用通用传输，将异步落盘与交接事务分开。 */
export class Artifacts {
  private running = new Map<string, Promise<void>>();
  private directory: string;
  constructor(
    private service: Service,
    private files: FileTransfers,
    dataDir: string,
  ) {
    this.directory = join(dataDir, "artifacts");
  }
  /** 同参数重试复用已完成文件；结果状态持久化，断连不会生成第二份交接。 */
  submit(input: unknown, peer: RpcPeer) {
    const p = requestSchema.parse(input);
    const key = JSON.stringify(p.artifacts);
    const hash = createHash("sha256").update(JSON.stringify(p)).digest("hex");
    const store = this.service.store;
    const old = store
      .list("artifactJobs")
      .find((j) => j.id === `artifact-job:${p.operationId}`);
    ensure(
      !old || old.hash === hash,
      "IDEMPOTENCY_CONFLICT",
      i18nMessage(
        "errors.IDEMPOTENCY_CONFLICT.repeated.operation.parameters.do.not.match",
      ),
      409,
    );
    const completed = store.db
      .prepare("SELECT id FROM operations WHERE id=?")
      .get(p.operationId);
    if (completed)
      return this.service.submitHandoff(
        p.itemId,
        p.targetId,
        p.record,
        p.operationId,
        p.executionId,
        [],
        key,
      );
    if (this.running.has(p.operationId)) return { status: "uploading" };
    ensure(
      this.running.size < 4,
      "ARTIFACT_BUSY",
      i18nMessage("errors.ARTIFACT_BUSY.artifact.upload.is.busy.try.again"),
      429,
    );
    this.service.validateArtifactHandoff(p.itemId, p.executionId, p.targetId);
    store.put(
      "artifactJobs",
      {
        hash,
        itemId: p.itemId,
        executionId: p.executionId,
        status: "uploading",
        error: null,
      },
      `artifact-job:${p.operationId}`,
    );
    const task = this.upload(p, peer)
      .catch((e) => {
        const error =
          e instanceof AppError
            ? {
                code: e.code,
                message: e.message,
                messageKey: e.messageKey,
                messageParams: e.messageParams,
              }
            : {
                code: "ARTIFACT_FAILED",
                message: "产物上传失败，请检查文件或服务端空间后重试",
                ...i18nMessage("artifacts.uploadFailed"),
              };
        store.put(
          "artifactJobs",
          { status: "failed", error },
          `artifact-job:${p.operationId}`,
        );
      })
      .finally(() => this.running.delete(p.operationId));
    this.running.set(p.operationId, task);
    return { status: "uploading" };
  }
  /** 只查询已有操作；失败后的重试必须显式重新调用交接工具。 */
  status(operationId: string, executionId: string, itemId: string) {
    const job = this.service.store.get(
      "artifactJobs",
      `artifact-job:${operationId}`,
    );
    ensure(
      job.executionId === executionId && job.itemId === itemId,
      "SCOPE",
      i18nMessage("errors.SCOPE.handoff.operation.ownership.does.not.match"),
      403,
    );
    const completed = this.service.store.db
      .prepare("SELECT scope,result FROM operations WHERE id=?")
      .get(operationId) as any;
    if (completed) {
      ensure(
        completed.scope === itemId,
        "SCOPE",
        i18nMessage("errors.SCOPE.handoff.operation.ownership.does.not.match"),
        403,
      );
      return JSON.parse(completed.result);
    }
    if (job.status === "completed") return job.result;
    if (job.error)
      throw Object.assign(new AppError(job.error.code, job.error.message), {
        messageKey: job.error.messageKey,
        messageParams: job.error.messageParams,
      });
    ensure(
      this.running.has(operationId),
      "ARTIFACT_INTERRUPTED",
      i18nMessage(
        "errors.ARTIFACT_INTERRUPTED.upload.interrupted.submit.the.same.handoff",
      ),
      409,
    );
    return { status: "uploading" };
  }
  private async upload(p: Request, peer: RpcPeer) {
    const store = this.service.store;
    const { execution, stage } = this.service.validateArtifactHandoff(
      p.itemId,
      p.executionId,
      p.targetId,
    );
    const revalidate = () => {
      this.service.validateArtifactHandoff(p.itemId, p.executionId, p.targetId);
      ensure(
        this.service.peer(execution.environment_id) === peer,
        "OFFLINE",
        i18nMessage(
          "errors.OFFLINE.the.environment.connection.has.changed.retry",
        ),
        409,
      );
    };
    const env = store.get("environments", execution.environment_id);
    ensure(
      env.capabilities?.includes("files-v1"),
      "CONNECTOR_UPGRADE",
      i18nMessage(
        "errors.CONNECTOR_UPGRADE.upgrade.the.connector.to.submit.artifacts",
      ),
      409,
    );
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const saved: Entity[] = [];
    let total = 0;
    for (let index = 0; index < p.artifacts.length; index++) {
      revalidate();
      const input = p.artifacts[index];
      const existing = store
        .list("artifacts")
        .find(
          (a) =>
            a.operationId === p.operationId && a.index === index && a.ready,
        );
      if (existing) {
        ensure(
          (await stat(join(this.directory, existing.id))).size ===
            existing.size,
          "ARTIFACT_MISSING",
          i18nMessage(
            "errors.ARTIFACT_MISSING.an.uploaded.artifact.is.missing.or",
          ),
        );
        total += existing.size;
        saved.push(existing);
        continue;
      }
      const ticket = await this.files.create(p.operationId, {
        peer,
        revalidate,
        source: {
          rootId: stage.rootId,
          relativePath: stage.relativePath,
          path: input.path,
        },
      });
      const id = randomUUID();
      const temp = join(this.directory, id + ".part");
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        total += ticket.size;
        ensure(
          ticket.size <= 128 * 1024 ** 2 && total <= 256 * 1024 ** 2,
          "ARTIFACT_LIMIT",
          i18nMessage("errors.ARTIFACT_LIMIT.each.artifact.may.be.up.to"),
        );
        handle = await open(temp, "wx", 0o600);
        const hash = createHash("sha256");
        let offset = 0;
        do {
          const bytes = await this.files.read(p.operationId, ticket.id, offset);
          hash.update(bytes);
          // writeFile 在句柄当前位置完整写入，避免短写导致不完整文件。
          await handle.writeFile(bytes);
          offset += bytes.length;
        } while (offset < ticket.size);
        await handle.sync();
        await handle.close();
        handle = undefined;
        revalidate();
        await rename(temp, join(this.directory, id));
        saved.push(
          store.put(
            "artifacts",
            {
              operationId: p.operationId,
              executionId: p.executionId,
              itemId: p.itemId,
              index,
              ready: true,
              name: input.name || ticket.name,
              size: ticket.size,
              // 展示名称不改变原始文件类型，防止伪装扩展名改变预览策略。
              ...fileFormat(ticket.name),
              originalName: ticket.name,
              modifiedAt: ticket.modifiedAt,
              sha256: hash.digest("hex"),
            },
            id,
          ),
        );
      } finally {
        await handle?.close();
        await rm(temp, { force: true });
        this.files.cancel(p.operationId, ticket.id);
      }
    }
    revalidate();
    const result = this.service.submitHandoff(
      p.itemId,
      p.targetId,
      p.record,
      p.operationId,
      p.executionId,
      saved,
      JSON.stringify(p.artifacts),
    );
    store.put(
      "artifactJobs",
      { status: "completed", result },
      `artifact-job:${p.operationId}`,
    );
  }
  /** 已绑定交接才可读取；会话或环境离线不影响已交付快照。 */
  get(id: string) {
    idSchema.parse(id);
    const a = this.service.store.get("artifacts", id);
    ensure(
      a.handoffId,
      "ARTIFACT_PENDING",
      i18nMessage(
        "errors.ARTIFACT_PENDING.the.artifact.handoff.is.not.complete",
      ),
      404,
    );
    const handoff = this.service.store.get("handoffs", a.handoffId);
    this.service.store.get("items", handoff.itemId);
    ensure(
      handoff.itemId === a.itemId &&
        handoff.artifacts?.some((v: any) => v.id === id),
      "ARTIFACT_SCOPE",
      i18nMessage("errors.ARTIFACT_SCOPE.artifact.ownership.does.not.match"),
      403,
    );
    return a;
  }
  /** 服务端快照适配通用分块接口，浏览器继续使用同一个传输与预览组件。 */
  async ticket(id: string, owner: string, validateLogin: () => void) {
    const artifact = this.get(id);
    const info = {
      name: artifact.name,
      size: artifact.size,
      modifiedAt: artifact.modifiedAt,
      version: artifact.sha256,
      mime: artifact.mime,
      kind: artifact.kind,
    };
    const revalidate = () => {
      validateLogin();
      this.get(id);
    };
    let verifiedIdentity = "";
    const peer = {
      call: async (method: string, p: any) => {
        revalidate();
        const handle = await open(join(this.directory, id), "r");
        try {
          const identity = async () => {
            const stat = await handle.stat({ bigint: true });
            return [
              stat.dev,
              stat.ino,
              stat.size,
              stat.mtimeNs,
              stat.ctimeNs,
            ].join(":");
          };
          const before = await identity();
          ensure(
            (await handle.stat()).size === artifact.size,
            "ARTIFACT_MISSING",
            i18nMessage("errors.ARTIFACT_MISSING.the.artifact.file.is.damaged"),
          );
          // 同一文件描述符验证整文件；身份或纳秒时间变化时重新校验，避免同大小替换。
          if (verifiedIdentity !== before) {
            const hash = createHash("sha256");
            for await (const chunk of handle.createReadStream({
              autoClose: false,
              start: 0,
            }))
              hash.update(chunk);
            ensure(
              hash.digest("hex") === artifact.sha256 &&
                (await identity()) === before,
              "ARTIFACT_CORRUPT",
              i18nMessage(
                "errors.ARTIFACT_CORRUPT.artifact.integrity.verification.failed",
              ),
              409,
            );
            verifiedIdentity = before;
          }
          if (method === "files.inspect") return info;
          const buffer = Buffer.alloc(
            Math.min(FILE_CHUNK_SIZE, artifact.size - p.offset),
          );
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            p.offset,
          );
          ensure(
            bytesRead === buffer.length,
            "ARTIFACT_MISSING",
            i18nMessage(
              "errors.ARTIFACT_MISSING.the.artifact.file.is.incomplete",
            ),
          );
          ensure(
            (await identity()) === before,
            "ARTIFACT_CORRUPT",
            i18nMessage(
              "errors.ARTIFACT_CORRUPT.the.artifact.changed.while.being.read",
            ),
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
      },
    } as RpcPeer;
    return {
      ...(await this.files.create(owner, {
        peer,
        revalidate,
        source: { rootId: "artifact", relativePath: ".", path: id },
      })),
      originalName: artifact.originalName,
      artifact: true,
    };
  }
  /** 仅回收本模块超过一天且不再被交接引用的文件，活动上传始终保留。 */
  async prune() {
    if (this.running.size) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const keep = new Set(
      this.service.store
        .list("handoffs")
        .flatMap((h) => (h.artifacts || []).map((a: any) => a.id)),
    );
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}(\.part)?$/.test(name) || keep.has(name)) continue;
      if (
        (await stat(join(this.directory, name))).mtimeMs >
        Date.now() - 86400000
      )
        continue;
      await rm(join(this.directory, name), { force: true });
      const entity = this.service.store
        .list("artifacts")
        .find((a) => a.id === name);
      if (entity) this.service.store.remove("artifacts", name);
    }
    for (const job of this.service.store.list("artifactJobs")) {
      if (
        Date.parse(job.updatedAt) < Date.now() - 86400000 &&
        !this.running.has(job.id.replace("artifact-job:", ""))
      )
        this.service.store.remove("artifactJobs", job.id);
    }
  }
  async close() {
    await Promise.allSettled(this.running.values());
  }
}
