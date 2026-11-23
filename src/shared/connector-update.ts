import { messages, message, isMessageKey } from "./i18n.js";
import { z } from "zod";
import { connectorVersionSchema } from "./contracts.js";

/** 首发仅执行协议三薄更新；旧记录只用于历史展示。 */
export const UPDATE_PROTOCOL = 3;
export const updateBlockersCapability = "connector-update-blockers-v1";
export const blockerIdentity = z
  .object({
    sessionId: z.string().uuid(),
    executionId: z.string().uuid(),
  })
  .strict();
export const nodeUpdateBlockers = z.object({
  executions: z.array(
    blockerIdentity.extend({
      status: z.enum(["starting", "running", "waiting", "stopping", "unknown"]),
      waitingFor: z.enum(["answer", "approval", "interaction"]).nullable(),
      canStop: z.boolean(),
    }),
  ),
  reasons: z.array(z.enum(["transfer", "terminal", "activity", "storage"])),
});
export type NodeUpdateBlocker = z.infer<
  typeof nodeUpdateBlockers
>["executions"][number];
export const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 60000;
export const updateTargetSchema = z
  .object({
    version: connectorVersionSchema,
    buildId: z.string().regex(/^[a-f0-9]{40}$/),
    platform: z.enum(["linux", "windows"]),
    arch: z.literal("x64"),
    file: z
      .string()
      .regex(
        /^bugpaw-relay-[A-Za-z0-9.+-]+-(?:linux|windows)-x64\.(?:tar\.gz|zip)$/,
      ),
    size: z.number().int().positive().max(MAX_PACKAGE_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    updateProtocol: z.unknown().optional(),
    dataFormat: z.unknown().optional(),
    // 仅供已保存目标的历史读取，不参与更新准入或执行。
    rollbackCompatible: z.unknown().optional(),
    compatibility: z.unknown().optional(),
  })
  .strict();
export type UpdateTarget = z.infer<typeof updateTargetSchema>;
export const updateRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    expectedCurrentVersion: connectorVersionSchema,
    targetVersion: connectorVersionSchema,
    targetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const updateStates = [
  "accepted",
  "prechecking",
  "downloading",
  "verifying",
  "installing",
  "restarting",
  "reconciling",
  "succeeded",
  "recovered",
  "failed",
  "recovery_required",
] as const;
export type UpdateState = (typeof updateStates)[number];
export const updateReportSchema = z
  .object({
    operationId: z.string().uuid(),
    target: updateTargetSchema,
    state: z.enum(updateStates),
    lastConfirmedState: z.enum(updateStates),
    stateVersion: z.number().int().nonnegative(),
    downloadedBytes: z.number().int().min(0).max(MAX_PACKAGE_BYTES),
    actualVersion: connectorVersionSchema.nullable(),
    actualBuildId: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    errorCode: z
      .string()
      .regex(/^[A-Z_]{1,80}$/)
      .nullable(),
  })
  .strict();
export type UpdateReport = z.infer<typeof updateReportSchema>;
export const updateTerminal = (state: string) =>
  ["succeeded", "failed", "rolled_back", "recovered"].includes(state);
/** 错误文本固定映射，不能把文件内容、凭据或原始异常透传给页面。 */
export const updateMessages: Record<string, string> = {
  ENVIRONMENT_OFFLINE:
    messages["connector.update.ENVIRONMENT_OFFLINE"]["zh-CN"],
  REVOKED: messages["connector.update.REVOKED"]["zh-CN"],
  UPDATE_UNSUPPORTED: messages["connector.update.UPDATE_UNSUPPORTED"]["zh-CN"],
  UNMANAGED_INSTALL: messages["connector.update.UNMANAGED_INSTALL"]["zh-CN"],
  ENVIRONMENT_BUSY: messages["connector.update.ENVIRONMENT_BUSY"]["zh-CN"],
  UPDATE_IN_PROGRESS: messages["connector.update.UPDATE_IN_PROGRESS"]["zh-CN"],
  TARGET_CHANGED: messages["connector.update.TARGET_CHANGED"]["zh-CN"],
  ALREADY_CURRENT: messages["connector.update.ALREADY_CURRENT"]["zh-CN"],
  PACKAGE_UNAVAILABLE:
    messages["connector.update.PACKAGE_UNAVAILABLE"]["zh-CN"],
  INCOMPATIBLE_PACKAGE:
    messages["connector.update.INCOMPATIBLE_PACKAGE"]["zh-CN"],
  DOWNLOAD_UNAUTHORIZED:
    messages["connector.update.DOWNLOAD_UNAUTHORIZED"]["zh-CN"],
  DOWNLOAD_EXPIRED: messages["connector.update.DOWNLOAD_EXPIRED"]["zh-CN"],
  CHECKSUM_MISMATCH: messages["connector.update.CHECKSUM_MISMATCH"]["zh-CN"],
  UNSAFE_ARCHIVE: messages["connector.update.UNSAFE_ARCHIVE"]["zh-CN"],
  INSUFFICIENT_SPACE: messages["connector.update.INSUFFICIENT_SPACE"]["zh-CN"],
  INSTALL_PERMISSION_DENIED:
    messages["connector.update.INSTALL_PERMISSION_DENIED"]["zh-CN"],
  RESTART_FAILED: messages["connector.update.RESTART_FAILED"]["zh-CN"],
  DATA_FORMAT_INCOMPATIBLE:
    messages["connector.update.DATA_FORMAT_INCOMPATIBLE"]["zh-CN"],
  ROLLBACK_UNSAFE: messages["connector.update.ROLLBACK_UNSAFE"]["zh-CN"],
  UPDATE_PROTOCOL_UNSUPPORTED:
    messages["connector.update.UPDATE_PROTOCOL_UNSUPPORTED"]["zh-CN"],
  COMPATIBILITY_UNKNOWN:
    messages["connector.update.COMPATIBILITY_UNKNOWN"]["zh-CN"],
  COMPATIBILITY_CONFLICT:
    messages["connector.update.COMPATIBILITY_CONFLICT"]["zh-CN"],
  BOOTSTRAP_REQUIRED: messages["connector.update.BOOTSTRAP_REQUIRED"]["zh-CN"],
  PLATFORM_MISMATCH: messages["connector.update.PLATFORM_MISMATCH"]["zh-CN"],
  ACTUAL_FORMAT_MISMATCH:
    messages["connector.update.ACTUAL_FORMAT_MISMATCH"]["zh-CN"],
  RECOVERY_REQUIRED: messages["connector.update.RECOVERY_REQUIRED"]["zh-CN"],
  DOWNLOAD_FAILED: messages["connector.update.DOWNLOAD_FAILED"]["zh-CN"],
};
/** 未识别更新码不透传原始异常。 */
export function updateMessage(code: string) {
  const key = `connector.update.${code}`;
  return message(isMessageKey(key) ? key : "connector.update.unavailable");
}

/** 相同契约代表读写语义不变，不允许首次启动迁移或丢弃已提交增量。 */
const persistenceSchema = z
  .object({
    format: z.number().int().positive(),
    contract: z.string().regex(/^[a-z0-9-]{1,80}$/),
  })
  .strict();
export const updateCompatibilitySchema = z
  .object({
    schema: z.literal(1),
    recoveryProtocol: z.literal(3),
    preservesData: z.boolean(),
    ledger: persistenceSchema,
    config: persistenceSchema,
    journal: persistenceSchema,
  })
  .strict();
export type UpdateCompatibility = z.infer<typeof updateCompatibilitySchema>;
export const currentUpdateCompatibility: UpdateCompatibility = {
  schema: 1,
  recoveryProtocol: 3,
  preservesData: true,
  ledger: { format: 2, contract: "relay-ledger-v2-bounded-cache" },
  config: { format: 1, contract: "relay-config-v1" },
  journal: { format: 1, contract: "relay-update-journal-v3" },
};
export const compatibilityErrors = [
  "DATA_FORMAT_INCOMPATIBLE",
  "ROLLBACK_UNSAFE",
  "UPDATE_PROTOCOL_UNSUPPORTED",
  "COMPATIBILITY_UNKNOWN",
  "COMPATIBILITY_CONFLICT",
  "BOOTSTRAP_REQUIRED",
  "PLATFORM_MISMATCH",
  "ACTUAL_FORMAT_MISMATCH",
] as const;
/** 不由应用主版本推断能力；未知声明拒绝，不通过启动候选探测。 */
export function updateCompatibilityReason(
  current: {
    updateProtocol?: number;
    dataFormat?: number;
    compatibility?: unknown;
  } | null,
  target: Pick<
    UpdateTarget,
    "updateProtocol" | "dataFormat" | "rollbackCompatible" | "compatibility"
  >,
): string | null {
  if (!target.updateProtocol || !target.dataFormat)
    return "COMPATIBILITY_UNKNOWN";
  if (target.updateProtocol !== 3) return "UPDATE_PROTOCOL_UNSUPPORTED";
  if (current?.updateProtocol !== 3) return "BOOTSTRAP_REQUIRED";
  const a = updateCompatibilitySchema.safeParse(current.compatibility);
  const b = updateCompatibilitySchema.safeParse(target.compatibility);
  if (!a.success || !b.success) return "COMPATIBILITY_UNKNOWN";
  if (
    a.data.ledger.format !== current.dataFormat ||
    b.data.ledger.format !== target.dataFormat
  )
    return "COMPATIBILITY_CONFLICT";
  if (!b.data.preservesData) return "DATA_FORMAT_INCOMPATIBLE";
  for (const domain of ["ledger", "config", "journal"] as const)
    if (
      a.data[domain].format !== b.data[domain].format ||
      a.data[domain].contract !== b.data[domain].contract
    )
      return "DATA_FORMAT_INCOMPATIBLE";
  return null;
}
