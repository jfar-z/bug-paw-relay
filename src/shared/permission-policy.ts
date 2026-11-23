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

/**
 * 按原生请求含义归类交互。只有明确的工具权限审批返回批准答案；
 * 提问、计划确认与未知类型返回 null，不能自动处理。
 */
export function classifyApproval(
  method: string,
  params: any,
): { kind: "permission"; answer: Record<string, unknown> } | null {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  )
    return { kind: "permission", answer: { decision: "accept" } };
  if (method === "item/permissions/requestApproval") {
    return params?.permissions && typeof params.permissions === "object"
      ? {
          kind: "permission",
          answer: { permissions: params.permissions, scope: "turn" },
        }
      : null;
  }
  // 只识别已知原生工具的权限回调。新工具、MCP 与业务提问均留给用户决定。
  if (["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep", "WebFetch", "WebSearch"].includes(method))
    return { kind: "permission", answer: { approve: true } };
  return null;
}
