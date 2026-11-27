import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyApproval,
  ensurePermissionAllowed,
} from "../src/shared/permission-policy.js";

test("Codex 命令与文件审批可自动批准", () => {
  assert.deepEqual(
    classifyApproval("item/commandExecution/requestApproval", {})?.answer,
    { decision: "accept" },
  );
  assert.equal(
    classifyApproval("item/fileChange/requestApproval", {})?.kind,
    "permission",
  );
});

test("提问、计划确认和未知交互不自动处理", () => {
  for (const m of [
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
    "UnknownTool",
    "mcp__example__confirm",
    "AskUserQuestion",
    "ExitPlanMode",
    "mcp__relay__ask_user",
  ])
    assert.equal(classifyApproval(m, {}), null, m);
});

test("Claude 工具权限批准一次", () => {
  assert.deepEqual(classifyApproval("Bash", {})?.answer, { approve: true });
});

test("已知 root Claude 拒绝完全权限，其他情况放行", () => {
  const root = { tools: { claude: { runsAsRoot: true } } };
  assert.throws(() => ensurePermissionAllowed("full", ["claude"], root));
  ensurePermissionAllowed("auto", ["claude"], root);
  ensurePermissionAllowed("full", ["codex"], root);
  ensurePermissionAllowed("full", null, root);
  ensurePermissionAllowed("full", ["claude"], { tools: {} });
});

test("结构化权限与明确标记的 MCP 工具审批只授权本次", () => {
  const permissions = { fileSystem: { read: ["/workspace/docs"] }, network: { enabled: true } };
  const kind = "item/permissions/requestApproval";
  assert.deepEqual(classifyApproval(kind, { permissions }), {
    kind: "permission", answer: { permissions, scope: "turn" }, decline: { permissions: {}, scope: "turn" },
  });
  for (const invalid of [[], { network: "yes" }, { fileSystem: { read: [false] } }, { unknown: true }])
    assert.equal(classifyApproval(kind, { permissions: invalid }), null);
  const method = "mcpServer/elicitation/request";
  const params = { mode: "form", message: "Allow tool?", _meta: { codex_approval_kind: "mcp_tool_call", tool_name: "lookup", persist: "always" },
    requestedSchema: { type: "object", properties: {} } };
  assert.deepEqual(classifyApproval(method, params), { kind: "permission", answer: { action: "accept" }, decline: { action: "decline" } });
  for (const change of [{ _meta: {} }, { mode: "url" }, { _meta: { ...params._meta, codex_requires_user_input: true } },
    { requestedSchema: { type: "object", properties: { name: { type: "string" } } } }])
    assert.equal(classifyApproval(method, { ...params, ...change }), null);
  for (const legacy of ["applyPatchApproval", "execCommandApproval"])
    assert.equal(classifyApproval(legacy, {})?.answer.decision, "approved");
  assert.equal(classifyApproval("item/commandExecution/requestApproval", { availableDecisions: ["acceptForSession", "cancel"] }), null);
});
