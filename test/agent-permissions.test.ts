import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { parseBoardWrite } from "../src/server/board-tool.js";
import { Vault } from "../src/server/security.js";

/** 隔离数据库验证兼容更新、默认值与执行快照。 */
test("智能体默认权限与双 CLI 快照保护", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-permission-"));
  const store = new Store(join(dir, "test.db"));
  const service = new Service(store, new Vault(dir));
  try {
    const env = store.put("environments", { name: "测试环境" });
    const directory = {
      environmentId: env.id,
      rootId: "root",
      relativePath: ".",
    };
    service.peers.set(env.id, {
      call: async () => ({ status: "running" }),
    } as any);
    const project = service.save("projects", {
      name: "项目",
      directories: [directory],
    });
    const legacy = store.put("agents", { name: "旧数据" });
    assert.equal(service.list("agents")[0].defaultPermission, "ask");
    for (const environmentId of [null, env.id]) {
      let agent = service.save("agents", { name: "智能体", environmentId });
      assert.equal(agent.defaultPermission, "ask");
      agent = service.save(
        "agents",
        { ...agent, defaultPermission: "full" },
        agent.id,
        agent.version,
      );
      const stale = agent.version;
      agent = service.save(
        "agents",
        { name: "旧客户端", environmentId },
        agent.id,
        agent.version,
      );
      assert.equal(agent.defaultPermission, "full");
      const count = store.list("agent_permission_changes").length;
      for (const defaultPermission of [null, "", "bad"])
        assert.throws(() =>
          service.save(
            "agents",
            { ...agent, defaultPermission },
            agent.id,
            agent.version,
          ),
        );
      assert.throws(
        () =>
          service.save(
            "agents",
            { ...agent, defaultPermission: "ask" },
            agent.id,
            stale,
          ),
        /版本/,
      );
      assert.equal(store.list("agent_permission_changes").length, count);
      for (const runtime of ["codex", "claude"]) {
        const input = {
          title: "会话",
          projectId: project.id,
          ...directory,
          runtime,
          agentId: agent.id,
        };
        const session = service.createSession(input);
        assert.equal(session.permission, "full");
        assert.equal(
          service.createSession({ ...input, permission: "ask" }).permission,
          "ask",
        );
        assert.equal(
          service.createSession({ ...input, agentId: legacy.id }).permission,
          "ask",
        );
        assert.throws(
          () => service.createSession({ ...input, agentId: null }),
          { code: "AGENT_REQUIRED" },
        );
        assert.throws(
          () => service.createSession({ ...input, agentId: randomUUID() }),
          /不存在/,
        );
        assert.throws(() =>
          service.createSession({ ...input, permission: null }),
        );
        const done = randomUUID();
        const board = service.save("boards", {
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
              name: "执行",
              type: "agent",
              targets: [done],
              ...directory,
              runtime,
              agentId: agent.id,
            },
            { id: done, name: "完成", type: "done", targets: [] },
          ],
        });
        assert.equal(board.stages[1].permission, "full");
        const toolInput = parseBoardWrite({
          action: "create",
          board: {
            ...board,
            stages: board.stages.map(
              ({ permission, shortId, ...stage }: any) => stage,
            ),
          },
        });
        assert.ok(toolInput.action === "create");
        assert.equal(toolInput.board.stages[1].permission, undefined);
        assert.equal(
          service.save("boards", toolInput.board).stages[1].permission,
          "full",
        );
        // 历史阶段缺失权限仍按询问执行和复制，不能继承当前 full。
        const historical = store.put(
          "boards",
          {
            ...board,
            stages: board.stages.map(({ permission, ...stage }: any) => stage),
          },
          randomUUID(),
        );
        assert.equal(
          service.copyBoard(historical.id).stages[1].permission,
          "ask",
        );
        const historicalItem = service.createItem({
          boardId: historical.id,
          startStageId: historical.stages[1].id,
          title: "历史任务",
        });
        const historicalExecution = store.db
          .prepare("SELECT snapshot FROM executions WHERE item_id=?")
          .get(historicalItem.id) as any;
        assert.equal(
          JSON.parse(historicalExecution.snapshot).stage.permission,
          "ask",
        );
        const copy = service.copyBoard(board.id);
        assert.equal(copy.stages[1].permission, "full");
        const item = service.createItem({
          boardId: board.id,
          startStageId: board.stages[1].id,
          title: "测试",
        });
        const snapshot = (
          store.db
            .prepare("SELECT snapshot FROM executions WHERE item_id=?")
            .get(item.id) as any
        ).snapshot;
        assert.equal(JSON.parse(snapshot).stage.permission, "full");
        assert.equal(JSON.parse(snapshot).permission, "full");
        // 看板首次派发也要用执行自己的权限快照，后续默认值变更不影响本次决定。
        const autoBoard = service.save("boards", { name: "审批流程", projectId: project.id, stages: board.stages.map(({ shortId, ...stage }: any) =>
          stage.type === "agent" ? { ...stage, permission: "auto" } : stage) });
        const autoItem = service.createItem({ boardId: autoBoard.id, startStageId: autoBoard.stages[1].id, title: "自动审批" });
        const run = service.execution(autoItem.executionId);
        assert.equal(JSON.parse(run.snapshot).permission, "auto");
        const calls: any[] = [];
        service.peers.set(env.id, { call: async (method: string, request: any) => calls.push({ method, request }) } as any);
        const update = { executionId: run.id, interactions: [
          { executionId: run.id, id: randomUUID(), method: "Write", approval: { kind: "permission", answer: { approve: true } } },
          { id: randomUUID(), method: "AskUserQuestion" },
        ] };
        service.setState(run.id, "running");
        service.sessionEvent(env.id, update);
        service.sessionEvent(env.id, update);
        assert.deepEqual(calls, [{ method: "interaction.answer", request: {
          executionId: run.id, interactionId: update.interactions[0].id, decisionSource: "policy", answer: { approve: true },
        } }]);
        agent = service.save(
          "agents",
          { ...agent, defaultPermission: "ask" },
          agent.id,
          agent.version,
        );
        assert.equal(store.get("sessions", session.id).permission, "full");
        assert.equal(
          store.get("boards", board.id).stages[1].permission,
          "full",
        );
        assert.equal(
          (
            store.db
              .prepare("SELECT snapshot FROM executions WHERE item_id=?")
              .get(item.id) as any
          ).snapshot,
          snapshot,
        );
        assert.equal(service.createSession(input).permission, "ask");
        assert.equal(
          service.createSession({ ...input, permission: "full" }).permission,
          "full",
        );
        const stages = copy.stages.map(
          ({ permission, ...stage }: any) => stage,
        );
        assert.equal(
          service.save("boards", { ...copy, stages }, copy.id, copy.version)
            .stages[1].permission,
          "full",
        );
        agent = service.save(
          "agents",
          { ...agent, defaultPermission: "full" },
          agent.id,
          agent.version,
        );
      }
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
