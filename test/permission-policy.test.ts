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
