import { z } from "zod";
import { directorySchema, ensure, type Board } from "../shared/contracts.js";
import { attachmentsSchema, uploadEntriesSchema } from "../shared/uploads.js";
import { message } from "../shared/i18n.js";
import { FILE_TTL } from "../shared/files.js";
import { handoffError } from "../shared/stage-handoff.js";
import type { FilePushTransfers } from "./file-push.js";
import type { Service, BoardAttachmentBatch } from "./service.js";
import type { Vault } from "./security.js";

const scopeSchema = z.object({
  stageId: z.uuid(),
  operationId: z.uuid(),
  itemId: z.uuid().optional(),
  editVersion: z.number().int().positive().optional(),
  directory: directorySchema.optional(),
});
const proofSchema = scopeSchema.extend({
  kind: z.literal("board-attachments"),
  owner: z.string(),
  boardId: z.uuid(),
  directory: directorySchema,
  cwd: z.string(),
  files: attachmentsSchema.min(1),
  expires: z.number(),
  itemVersion: z.number().optional(),
});
type Directory = z.infer<typeof directorySchema>;
function sameDirectory(
  a: Omit<Directory, "environmentId"> & { environmentId: string | null },
  b: Directory,
) {
  return (
    a.environmentId === b.environmentId &&
    a.rootId === b.rootId &&
    a.relativePath === b.relativePath
  );
}

/** 凭据只封装本次授权和已落盘元信息，业务记录在最终提交时一次写入。 */
export class BoardUploads {
  constructor(
    private service: Service,
    private transfers: FilePushTransfers,
    private vault: Vault,
  ) {}

  private target(boardId: string, scope: z.infer<typeof scopeSchema>) {
    const store = this.service.store;
    const board = store.get<Board>("boards", boardId);
    let stage = board.stages.find((s) => s.id === scope.stageId);
    const item = scope.itemId ? store.get("items", scope.itemId) : undefined;
    if (scope.editVersion !== undefined) {
      ensure(
        item && item.boardId === board.id,
        "FILE_SCOPE",
        message("uploads.directory"),
        403,
      );
      stage = this.service.requireEditableItem(
        item,
        board,
        scope.stageId,
        scope.editVersion,
      );
    } else
      ensure(
        stage &&
          (!item ||
            (item.boardId === board.id &&
              !item.archived &&
              board.stages
                .find((s) => s.id === item.stageId)
                ?.targets.includes(stage.id))),
        "INVALID_TRANSITION",
        message(
          "errors.INVALID_TRANSITION.this.transition.is.not.allowed.from",
        ),
      );
    const directories: Directory[] = store.get(
      "projects",
      board.projectId,
    ).directories;
    const selected =
      scope.directory ??
      (stage.type === "agent"
        ? stage
        : directories.length === 1
          ? directories[0]
          : undefined);
    const directory = directories.find(
      (d) => selected && sameDirectory(selected, d),
    );
    ensure(
      directory && (stage.type !== "agent" || sameDirectory(stage, directory)),
      "DIRECTORY_MISMATCH",
      message("uploads.directory"),
      403,
    );
    const env = store.get("environments", directory.environmentId);
    ensure(
      env.approved && !env.revoked,
      "FILE_SCOPE",
      message("errors.FILE_SCOPE.file.access.authorization.has.changed"),
      403,
    );
    const peer = this.service.peer(env.id);
    ensure(
      env.capabilities?.includes("board-attachments-v1"),
      "CONNECTOR_UPGRADE",
      message("uploads.upgrade"),
      409,
    );
    ensure(
      !this.service.updating(env.id),
      "UPLOAD_BLOCKED",
      message("uploads.blocked"),
      409,
    );
    return {
      directory,
      peer,
      itemVersion: item?.version,
      environmentName: env.name as string,
    };
  }

  begin(boardId: string, owner: string, input: unknown, checkExecution?: () => void) {
    const { files, ...scope } = scopeSchema
      .extend({ files: uploadEntriesSchema })
      .strict()
      .parse(input);
    const { directory, peer, itemVersion } = this.target(boardId, scope);
    const frozen = { ...scope, directory };
    const revalidate = () => {
      if (checkExecution) checkExecution();
      else ensure(
        this.service.store.db
          .prepare("SELECT 1 FROM auth_sessions WHERE hash=? AND expires>?")
          .get(owner, Date.now()),
        "UNAUTHENTICATED",
        message("errors.UNAUTHENTICATED.your.login.has.expired.sign.in"),
        401,
      );
      const current = this.target(boardId, frozen);
      if (current.itemVersion !== itemVersion)
        handoffError("ITEM_ADVANCE_CONFLICT");
      ensure(
        current.peer === peer,
        "OFFLINE",
        message("errors.OFFLINE.the.environment.connection.has.changed.try"),
        409,
      );
    };
    return this.transfers.create(
      owner,
      {
        peer,
        revalidate,
        destination: {
          kind: "board-attachments",
          rootId: directory.rootId,
          relativePath: directory.relativePath,
        },
        receipt: (cwd, value) => {
          const completed = attachmentsSchema.parse(value);
          ensure(
            completed.length === files.length &&
              completed.every(
                (a, i) =>
                  a.name === files[i]!.name && a.size === files[i]!.size,
              ),
            "UPLOAD_INCOMPLETE",
            message("uploads.incomplete"),
            409,
          );
          return this.vault.seal(
            JSON.stringify({
              ...frozen,
              boardId,
              owner,
              cwd,
              itemVersion,
              kind: "board-attachments",
              files: completed,
              expires: Date.now() + FILE_TTL,
            }),
          );
        },
      },
      files,
    );
  }

  async prepare(
    owner: string,
    input: unknown,
  ): Promise<BoardAttachmentBatch | undefined> {
    const { attachmentReceipt: receipt, operationId } = z
      .object({
        attachmentReceipt: z.string().min(1).max(131072).optional(),
        attachments: z.never().optional(),
        operationId: z.uuid().optional(),
      })
      .parse(input);
    if (!receipt) return;
    let proof: z.infer<typeof proofSchema> | undefined;
    try {
      proof = proofSchema.parse(JSON.parse(this.vault.open(receipt)));
    } catch {
      // 下方统一处理无效凭据。
    }
    ensure(
      proof && proof.owner === owner && proof.operationId === operationId,
      "FILE_SCOPE",
      message("errors.FILE_SCOPE.file.access.authorization.has.changed"),
      403,
    );
    const saved = proof;
    const check = () => {
      ensure(
        saved.expires > Date.now(),
        "UPLOAD_EXPIRED",
        message("uploads.expired"),
        409,
      );
      const target = this.target(saved.boardId, saved);
      if (target.itemVersion !== saved.itemVersion)
        handoffError("ITEM_ADVANCE_CONFLICT");
      return target;
    };
    // 已完成操作由业务账本校验哈希并回放，即使目标已离线。
    const replay = this.service.store.db
      .prepare("SELECT 1 FROM operations WHERE id=?")
      .get(saved.operationId);
    const target = replay ? undefined : check();
    if (target) {
      const { rootId, relativePath } = saved.directory;
      z.object({ ok: z.literal(true) }).parse(
        await target.peer.call("board.attachments.verify", {
          rootId,
          relativePath,
          cwd: saved.cwd,
          files: saved.files,
        }),
      );
    }
    return {
      receipt,
      bind: (boardId, stageId, op, itemId, editVersion) => {
        ensure(
          target &&
            check().peer === target.peer &&
            boardId === saved.boardId &&
            stageId === saved.stageId &&
            itemId === saved.itemId &&
            editVersion === saved.editVersion &&
            op === saved.operationId,
          "FILE_SCOPE",
          message("errors.FILE_SCOPE.file.access.authorization.has.changed"),
          403,
        );
        return saved.files.map((a) => ({
          ...a,
          ...saved.directory,
          cwd: saved.cwd,
          environmentName: target.environmentName,
        }));
      },
    };
  }
}
