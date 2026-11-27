import { z } from "zod";
import { AppError } from "./contracts.js";
import { message as i18nMessage } from "./i18n.js";

/** 自动审批能力标识，连接器在握手时上报。 */
export const autoApprovalCapability = "auto-approval-v1";

/** 环境上报 Claude 以 root 运行时，原生完全权限不可用。 */
export function claudeRunsAsRoot(env: { tools?: any } | null | undefined) {
  return env?.tools?.claude?.runsAsRoot === true;
}

/** 目标已知受限时拒绝完全权限；未知身份不推断为 root，由连接器启动前复核。 */
export function ensurePermissionAllowed(
  permission: string | undefined,
  runtimes: string[] | null | undefined,
  env: any,
) {
  if (permission !== "full" || !claudeRunsAsRoot(env)) return;
  // 智能体可同时支持 Codex 时，完全权限仍可用于 Codex，运行时到达启动点再校验。
  if (!runtimes || runtimes.some((r) => r !== "claude")) return;
  throw new AppError(
    "PERMISSION_UNAVAILABLE",
    i18nMessage("errors.PERMISSION_UNAVAILABLE.claude.root.full"),
    409,
  );
}

const pathSpec = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("path"), path: z.string() }),
  z.strictObject({ type: z.literal("glob_pattern"), pattern: z.string() }),
  z.strictObject({ type: z.literal("special"), value: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.enum(["root", "minimal", "tmpdir", "slash_tmp"]) }),
    z.strictObject({ kind: z.literal("project_roots"), subpath: z.string().nullish() }),
    z.strictObject({ kind: z.literal("unknown"), path: z.string(), subpath: z.string().nullish() }),
  ]) }),
]);
const permissions = z.strictObject({
  network: z.strictObject({ enabled: z.boolean().nullish() }).nullish(),
  fileSystem: z.strictObject({
    read: z.array(z.string()).nullish(),
    write: z.array(z.string()).nullish(),
    entries: z.array(z.strictObject({ path: pathSpec, access: z.enum(["read", "write", "deny"]) })).nullish(),
    globScanMaxDepth: z.number().int().positive().nullish(),
  }).nullish(),
});

function permission(answer: Record<string, unknown>, decline: Record<string, unknown>) {
  return { kind: "permission" as const, answer, decline };
}

/** 批准与拒绝都限定在原请求范围内，永远不生成持久授权。 */
export function classifyApproval(method: string, params: any, runtime?: string) {
  if (["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep", "WebFetch", "WebSearch"].includes(method))
    return runtime === "codex" ? null : permission({ approve: true }, { approve: false });
  if (runtime === "claude") return null;
  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    const offered = params?.availableDecisions;
    if (offered == null) return permission({ decision: "accept" }, { decision: "decline" });
    if (!Array.isArray(offered) || !offered.includes("accept")) return null;
    const decline = offered.includes("decline") ? "decline" : offered.includes("cancel") ? "cancel" : null;
    return decline ? permission({ decision: "accept" }, { decision: decline }) : null;
  }
  if (method === "execCommandApproval" || method === "applyPatchApproval")
    return permission({ decision: "approved" }, { decision: { denied: { rejection: "User declined" } } });
  if (method === "item/permissions/requestApproval" && permissions.safeParse(params?.permissions).success)
    return permission({ permissions: params.permissions, scope: "turn" }, { permissions: {}, scope: "turn" });
  if (method === "mcpServer/elicitation/request") {
    // Codex 工具审批与业务表单共用方法。只识别明确标记、无需用户输入的空对象模式。
    const meta = params?._meta;
    const schema = params?.requestedSchema;
    if (params?.mode === "form" && meta?.codex_approval_kind === "mcp_tool_call" &&
        typeof meta.tool_name === "string" && meta.tool_name.trim() &&
        !meta.codex_requires_user_input && !meta.codex_sensitive_action && !meta.codex_strict_auto_review &&
        schema?.type === "object" && schema.properties && typeof schema.properties === "object" &&
        !Array.isArray(schema.properties) && !Object.keys(schema.properties).length &&
        Object.keys(schema).every(key => ["type", "properties", "required", "$schema"].includes(key)) &&
        (schema.required == null || (Array.isArray(schema.required) && !schema.required.length)))
      return permission({ action: "accept" }, { action: "decline" });
  }
  return null;
}
