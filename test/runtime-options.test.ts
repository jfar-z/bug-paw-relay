import { useInstalledClaudeSdk } from "./claude-sdk-fixture.js";
import Fastify from "fastify";
import { runtimeCatalog } from "../src/connector/runtime-catalog.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { Vault } from "../src/server/security.js";
import { agentSchema } from "../src/shared/contracts.js";
import {
  resolveRuntimeOptions,
  runtimeOptionsSchema,
} from "../src/shared/runtime-options.js";

/** 继承与显式关闭不同，覆盖互不污染另一 CLI 或另一个会话。 */
test("运行配置逐字段继承与契约校验", () => {
  const agent = {
    runtimeOptions: {
      codex: { model: "codex-a", effort: "high" },
      claude: { model: "claude-a", thinking: { type: "adaptive" } },
    },
  };
  const session = { agent, runtimeOptions: { model: "session", effort: null } };
  assert.deepEqual(
    resolveRuntimeOptions("codex", session, { model: "env" }).options,
    { model: "session", effort: "high" },
  );
  assert.deepEqual(resolveRuntimeOptions("claude", { agent }).options, {
    model: "claude-a",
    thinking: { type: "adaptive" },
  });
  assert.deepEqual(resolveRuntimeOptions("codex", {}).options, {});
  assert.equal(
    resolveRuntimeOptions("claude", {
      agent,
      runtimeOptions: { thinking: { type: "disabled" } },
    }).options.thinking?.type,
    "disabled",
  );
  assert.equal(
    runtimeOptionsSchema.safeParse({
      thinking: { type: "enabled", budgetTokens: 100 },
    }).success,
    false,
  );
  assert.equal(
    runtimeOptionsSchema.safeParse({ apiKey: "not-a-real-key" }).success,
    false,
  );
  assert.equal(
    agentSchema.safeParse({
      name: "bad",
      runtimeOptions: { codex: { thinking: { type: "adaptive" } } },
    }).success,
    false,
  );
});

/** 当前会话持久化、旧节点门禁和看板快照均复用服务端业务入口。 */
test("会话固定 CLI、配置隔离、旧节点拒绝与阶段派发快照", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-runtime-options-"));
  const store = new Store(join(dir, "relay.db"));
  const service = new Service(store, new Vault(dir));
  try {
    const env = store.put("environments", { name: "env", capabilities: [] });
    const calls: any[] = [];
    service.peers.set(env.id, {
      call: async (method: string, p: any) => {
        calls.push({ method, p });
        return { status: "running" };
      },
    } as any);
    const directory = {
      environmentId: env.id,
      rootId: "root",
      relativePath: ".",
    };
    const project = service.save("projects", {
      name: "p",
      directories: [directory],
    });
    const agent = service.save("agents", {
      name: "a",
      runtimeOptions: { codex: { model: "agent-model", effort: "high" } },
    });
    const session = service.createSession({
      title: "s",
      projectId: project.id,
      ...directory,
      runtime: "codex",
      agentId: agent.id,
    });
    assert.throws(() =>
      service.configureSession(session.id, {
        agentId: agent.id,
        permission: "ask",
        runtime: "claude",
      }),
    );
    service.configureSession(session.id, {
      agentId: agent.id,
      permission: "ask",
      runtimeOptions: { model: "session-model", effort: "low" },
    });
    assert.equal(
      store.get("agents", agent.id).runtimeOptions.codex.model,
      "agent-model",
    );
    await assert.rejects(
      service.send(session.id, randomUUID(), "hello"),
      /升级环境连接器/,
    );
    assert.equal(calls.length, 0);
    store.put(
      "environments",
      { capabilities: ["runtime-options-v1", "stage-handoff-short-id-v1"] },
      env.id,
    );
    await service.send(session.id, randomUUID(), "hello");
    assert.equal(calls[0].p.session.runtimeOptions.model, "session-model");
    assert.throws(
      () =>
        service.configureSession(session.id, {
          agentId: agent.id,
          permission: "ask",
          runtimeOptions: {},
        }),
      /正在执行/,
    );
    service.setState(
      store.get("sessions", session.id).executionId,
      "completed",
    );
    service.configureSession(session.id, {
      agentId: agent.id,
      permission: "ask",
      runtimeOptions: { model: null, effort: null },
    });
    await service.send(session.id, randomUUID(), "again");
    assert.equal(
      resolveRuntimeOptions("codex", calls.at(-1).p.session).options.model,
      "agent-model",
    );
    const done = randomUUID();
    const board = service.save("boards", {
      name: "b",
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
          name: "run",
          type: "agent",
          targets: [done],
          ...directory,
          agentId: agent.id,
          runtimeOptions: { model: "stage-model", effort: "medium" },
        },
        { id: done, name: "done", type: "done", targets: [] },
      ],
    });
    const item = service.createItem({
      boardId: board.id,
      startStageId: board.stages[1].id,
      title: "task",
      content: "work",
    });
    service.save(
      "agents",
      {
        ...agent,
        runtimeOptions: { codex: { model: "changed", effort: "low" } },
      },
      agent.id,
      store.get("agents", agent.id).version,
    );
    await service.tick();
    const call = calls.at(-1).p;
    assert.equal(call.session.runtimeOptions.model, "stage-model");
    assert.equal(call.session.agent.runtimeOptions.codex.model, "agent-model");
    assert.equal(
      JSON.parse(
        service.execution(store.get("items", item.id).executionId).snapshot,
      ).stage.runtimeOptions.effort,
      "medium",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 两个真实 CLI 只发现模型；供应商能力白名单不夹带凭据和未知响应字段。 */
for (const runtime of ["codex", "claude"])
  test(
    "原生模型能力发现不发起推理：" + runtime,
    { timeout: 30000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "relay-catalog-"));
      const mock = Fastify();
      let inference = 0;
      mock.get("/v1/models", async () => ({
        data: [
          {
            id: "fixture-model",
            display_name: "测试模型",
            apiKey: "private-sentinel",
            capabilities: {
              effort: { low: { supported: true }, high: { supported: true } },
              thinking: {
                types: {
                  adaptive: { supported: true },
                  disabled: { supported: false },
                  enabled: { supported: false },
                },
              },
            },
          },
        ],
        has_more: false,
      }));
      mock.post("/v1/messages", async () => {
        inference++;
        return {};
      });
      mock.post("/v1/responses", async () => {
        inference++;
        return {};
      });
      await mock.listen({ host: "127.0.0.1", port: 0 });
      try {
        const baseUrl =
          `http://127.0.0.1:${(mock.server.address() as any).port}` +
          (runtime === "codex" ? "/v1" : "");
        const result = await runtimeCatalog(dir, runtime, {
          home: dir,
          baseUrl,
          model: "fixture-model",
          apiKey: "fixture-not-real",
          authType: "key",
        });
        assert.equal(result.defaults.model, "fixture-model");
        const model = result.models.find((m) => m.id === "fixture-model");
        assert.ok(model);
        assert.deepEqual(model.efforts, ["low", "high"]);
        assert.deepEqual(model.thinkingModes, ["adaptive"]);
        assert.equal(
          JSON.stringify(result).includes("private-sentinel"),
          false,
        );
        assert.equal(
          JSON.stringify(result).includes("fixture-not-real"),
          false,
        );
        assert.equal(inference, 0);
      } finally {
        await mock.close();
        rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      }
    },
  );

useInstalledClaudeSdk();
