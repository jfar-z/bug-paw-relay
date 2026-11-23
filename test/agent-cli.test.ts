import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { Vault } from "../src/server/security.js";
import { errorBody } from "../src/shared/i18n-errors.js";
import { agentSchema, agentAvailable } from "../src/shared/contracts.js";

/** 旧数据保持全 CLI 通用，显式范围不接受空集合、重复项或未知 CLI。 */
test("智能体 CLI 契约与环境交叉过滤", () => {
  assert.equal(agentSchema.parse({ name: "旧配置" }).supportedRuntimes, null);
  for (const values of [[], ["codex", "codex"], ["unknown"]])
    assert.equal(
      agentSchema.safeParse({ name: "非法", supportedRuntimes: values })
        .success,
      false,
    );
  assert.equal(agentAvailable({}, "env", "claude"), true);
  assert.equal(
    agentAvailable({ supportedRuntimes: ["codex"] }, "env", "claude"),
    false,
  );
  assert.equal(
    agentAvailable(
      { environmentId: "other", supportedRuntimes: ["codex"] },
      "env",
      "codex",
    ),
    false,
  );
  assert.equal(
    agentAvailable(
      { environmentId: "env", supportedRuntimes: ["codex", "claude"] },
      "env",
      "claude",
    ),
    true,
  );
});

/** 服务端所有引用入口都校验 CLI；收窄范围后不允许旧会话继续误用。 */
test("智能体 CLI 持久化、旧客户端更新、会话与看板引用校验", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-agent-cli-"));
  const store = new Store(join(dir, "relay.db"));
  const service = new Service(store, new Vault(dir));
  try {
    const env = store.put("environments", { name: "环境" });
    service.peers.set(env.id, {
      call: async () => ({ status: "running" }),
    } as any);
    const directory = {
      environmentId: env.id,
      rootId: "root",
      relativePath: ".",
    };
    const project = service.save("projects", {
      name: "项目",
      directories: [directory],
    });
    let agent = service.save("agents", {
      name: "Codex 专用",
      supportedRuntimes: ["codex"],
    });
    agent = service.save(
      "agents",
      { name: "修改名称" },
      agent.id,
      agent.version,
    );
    assert.deepEqual(agent.supportedRuntimes, ["codex"]);
    const input = {
      title: "会话",
      projectId: project.id,
      ...directory,
      agentId: agent.id,
      runtime: "claude",
    };
    assert.throws(() => service.createSession(input), /不适用于当前 CLI/);
    assert.throws(() => service.createSession({ ...input, agentId: null }), { code: "AGENT_REQUIRED" });
    assert.equal(store.list("sessions").length, 0);
    const session = store.put("sessions", { ...input, agentId: null, permission: "ask", status: "idle" });
    assert.throws(
      () =>
        service.configureSession(session.id, {
          agentId: agent.id,
          permission: "ask",
        }),
      /不适用于当前 CLI/,
    );
    const done = randomUUID();
    const board = {
      name: "流程",
      projectId: project.id,
      stages: [
        {
          id: randomUUID(),
          fixedRole: "start",
          name: "起点",
          type: "human",
          targets: [],
        },
        {
          id: randomUUID(),
          name: "开发",
          type: "agent",
          targets: [done],
          ...directory,
          runtime: "claude",
          agentId: agent.id,
        },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    };
    assert.throws(() => service.save("boards", board), { code: "AGENT_RUNTIME" });
    agent = service.save(
      "agents",
      { ...agent, supportedRuntimes: null },
      agent.id,
      agent.version,
    );
    service.configureSession(session.id, {
      agentId: agent.id,
      permission: "ask",
    });
    const savedBoard = service.save("boards", board);
    agent = service.save(
      "agents",
      { ...agent, supportedRuntimes: ["codex"] },
      agent.id,
      agent.version,
    );
    await assert.rejects(
      service.send(session.id, randomUUID(), "任务"),
      /不适用于当前 CLI/,
    );
    assert.throws(
      () =>
        service.createItem({
          boardId: savedBoard.id,
          startStageId: savedBoard.stages[1].id,
          title: "任务",
        }),
      { code: "AGENT_RUNTIME" },
    );
    assert.equal(store.list("items").length, 0);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM executions").get()!.n,
      0,
    );
    // 模拟历史空职责阶段。允许无关编辑，变更执行配置或进入阶段都需要修复。
    const emptyStages = savedBoard.stages.map((stage: any) => ({ ...stage, agentId: null }));
    let legacy = store.put("boards", { stages: emptyStages }, savedBoard.id);
    legacy = service.save("boards", { ...legacy, name: "旧流程" }, legacy.id, legacy.version);
    const enter = () => service.createItem({
      boardId: legacy.id, startStageId: emptyStages[1].id, title: "旧阶段",
    });
    assert.throws(enter, (error) => {
      const body = errorBody(error, "en");
      assert.equal(body.code, "STAGE_AGENT_INVALID");
      assert.match(body.message, /S2 · 开发/);
      assert.match(body.message, /select an agent/i);
      return true;
    });
    const repaired = emptyStages.map((stage: any) =>
      stage.type === "agent" ? { ...stage, runtime: "codex" } : stage,
    );
    const draft = { ...legacy, stages: repaired };
    assert.throws(() => service.previewBoardFlow(legacy.id, draft, legacy.version), { code: "STAGE_AGENT_INVALID" });
    assert.throws(() => service.save("boards", draft, legacy.id, legacy.version), { code: "STAGE_AGENT_INVALID" });
    repaired[1].agentId = agent.id;
    service.save("boards", draft, legacy.id, legacy.version);
    const item = enter();
    const queued = service.execution(item.executionId);
    store.remove("agents", agent.id);
    assert.equal(JSON.parse(queued.snapshot).agent.id, agent.id);
    service.setState(queued.id, "failed");
    assert.throws(() => service.retry(item.id), { code: "STAGE_AGENT_INVALID" });
    assert.equal(store.get("items", item.id).executionId, queued.id);
    assert.equal(store.get("items", item.id).status, "failed");
    assert.equal(store.list("sessions").length, 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
