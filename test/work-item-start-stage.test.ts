import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunContext } from "@openai/agents";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { Workbench } from "../src/server/workbench.js";
import { Vault, digest } from "../src/server/security.js";
import { createApp } from "../src/server/app.js";
import { itemCreationMessages } from "../src/shared/work-item-creation.js";

/** 使用隔离 SQLite 文件验证重启防重，环境不连接真实模型。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "item-start-"));
  let store = new Store(join(dir, "test.db"));
  let service = new Service(store, new Vault(dir));
  const environment = store.put("environments", {
    name: "fixture",
    status: "offline",
  });
  const directory = {
    environmentId: environment.id,
    rootId: "fixture",
    relativePath: ".",
  };
  const project = service.save("projects", {
    name: "fixture",
    directories: [directory],
  });
  const agent = service.save("agents", {
    name: "fixture",
    environmentId: environment.id,
    instructions: "测试职责",
    supportedRuntimes: ["codex"],
  });
  const first = randomUUID(),
    human = randomUUID(),
    auto = randomUUID(),
    done = randomUUID();
  const board = service.save("boards", {
    name: "fixture",
    projectId: project.id,
    stages: [
      {
        fixedRole: "start",
        id: first,
        name: "产品",
        type: "human",
        targets: [done],
      },
      { id: human, name: "人工", type: "human", targets: [done] },
      {
        id: auto,
        name: "开发",
        type: "agent",
        targets: [done],
        ...directory,
        agentId: agent.id,
        runtime: "codex",
        permission: "full",
        instructions: "仅执行开发阶段",
        concurrency: 2,
      },
      { id: done, name: "完成", type: "done", targets: [] },
    ],
  });
  return {
    get store() {
      return store;
    },
    get service() {
      return service;
    },
    dir,
    board,
    first,
    human,
    auto,
    done,
    project,
    agent,
    environment,
    input: { boardId: board.id, title: "调整样式" },
    restart() {
      store.close();
      store = new Store(join(dir, "test.db"));
      service = new Service(store, new Vault(dir));
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 错误断言使用稳定业务码，不依赖中文文本。 */
const code = (expected: string) => (error: any) => error.code === expected;

test("离线人工阶段可编辑，推进、归档及删除阶段均拒绝旧表单", () => {
  const f = fixture();
  try {
    const item = f.service.createItem({ ...f.input, startStageId: f.human });
    const body = {
      title: "更新",
      content: "",
      expectedStageId: f.human,
      expectedVersion: item.version,
      operationId: randomUUID(),
    };
    const saved = f.service.editItem(item.id, body);
    assert.equal(saved.stageId, f.human);
    assert.deepEqual(f.service.itemEditView(item.id).attachments, []);
    assert.equal(f.store.list("sessions").length, 0);
    f.restart();
    assert.deepEqual(f.service.editItem(item.id, body), saved);
    const next = {
      ...body,
      operationId: randomUUID(),
      expectedVersion: saved.version,
    };
    f.service.advance(item.id, f.done, "", randomUUID());
    assert.throws(() => f.service.editItem(item.id, next), code("CONFLICT"));
    for (const patch of [
      { stageId: f.done },
      { stageId: f.auto },
      { stageId: randomUUID() },
      { stageId: f.human, archived: true },
    ]) {
      const current = f.store.put("items", patch, item.id);
      assert.throws(
        () =>
          f.service.editItem(item.id, {
            ...next,
            expectedStageId: current.stageId,
            expectedVersion: current.version,
          }),
        code("CONFLICT"),
      );
    }
  } finally {
    f.close();
  }
});

test("兼容默认、任意人工及完成起点，不伪造执行与交接", () => {
  const f = fixture();
  try {
    assert.equal(f.service.createItem(f.input).stageId, f.first);
    const human = f.service.createItem({ ...f.input, startStageId: f.human });
    assert.equal(human.stageId, f.human);
    assert.equal(human.status, "human");
    const done = f.service.createItem({ ...f.input, startStageId: f.done });
    assert.equal(done.status, "done");
    assert.equal(done.archived, false);
    assert.equal(
      f.service.list("items").find((i) => i.id === done.id)?.needsAttention,
      false,
    );
    assert.equal(f.store.list("sessions").length, 0);
    assert.equal(f.store.list("handoffs").length, 0);
    assert.equal(
      f.store.db.prepare("SELECT * FROM executions").all().length,
      0,
    );
    assert.equal(f.service.createItem(f.input).stageId, f.first);
  } finally {
    f.close();
  }
});

test("离线 Agent 起点只入队一次并准确保存所选权限、目录及交接快照", () => {
  const f = fixture();
  try {
    const input = {
      ...f.input,
      startStageId: f.auto,
      boardVersion: f.board.version,
      operationId: randomUUID(),
    };
    const item = f.service.createItem(input);
    assert.equal(item.stageId, f.auto);
    assert.equal(item.status, "queued");
    assert.ok(item.executionId);
    const execution = f.service.execution(item.executionId);
    assert.equal(execution.state, "queued");
    const snapshot = JSON.parse(execution.snapshot);
    assert.equal(snapshot.stage.permission, "full");
    assert.equal(snapshot.stage.instructions, "仅执行开发阶段");
    assert.equal(snapshot.stage.concurrency, 2);
    assert.equal(snapshot.agent.id, f.agent.id);
    assert.equal(snapshot.currentStage.id, f.auto);
    assert.deepEqual(
      snapshot.allowedTargets.map((s: any) => s.id),
      [f.done],
    );
    const session = f.store.get("sessions", execution.session_id);
    assert.equal(session.environmentId, f.environment.id);
    assert.equal(session.permission, "full");
    assert.equal(session.rootId, "fixture");
    assert.equal(session.runtime, "codex");
    assert.equal(f.store.list("handoffs").length, 0);
    f.restart();
    f.store.put(
      "boards",
      { stages: [...f.board.stages].reverse() },
      f.board.id,
    );
    f.store.put("items", { status: "running" }, item.id);
    assert.deepEqual(f.service.createItem(input), item);
    assert.equal(f.store.list("sessions").length, 1);
    assert.equal(
      f.store.db.prepare("SELECT * FROM executions").all().length,
      1,
    );
    assert.throws(
      () => f.service.createItem({ ...input, title: "不同参数" }),
      code("IDEMPOTENCY_CONFLICT"),
    );
  } finally {
    f.close();
  }
});

test("失效阶段、旧版本、格式错误及无默认起点均零写入", () => {
  const f = fixture();
  try {
    for (const value of [null, "", "invalid"]) {
      assert.throws(() =>
        f.service.createItem({ ...f.input, startStageId: value }),
      );
    }
    for (const value of [null, 0, -1, 1.5, "1"]) {
      assert.throws(() =>
        f.service.createItem({ ...f.input, boardVersion: value }),
      );
    }
    assert.throws(
      () => f.service.createItem({ ...f.input, startStageId: randomUUID() }),
      code("INVALID_START_STAGE"),
    );
    const other = f.service.copyBoard(f.board.id);
    assert.throws(
      () =>
        f.service.createItem({ ...f.input, startStageId: other.stages[0].id }),
      code("INVALID_START_STAGE"),
    );
    assert.throws(
      () => f.service.createItem({ ...f.input, boardVersion: 999 }),
      code("BOARD_VERSION_CONFLICT"),
    );
    f.store.put(
      "boards",
      { stages: f.board.stages.filter((s: any) => s.type === "done") },
      f.board.id,
    );
    assert.throws(() => f.service.createItem(f.input), code("NO_START_STAGE"));
    assert.throws(
      () => f.service.createItem({ ...f.input, startStageId: f.human }),
      code("INVALID_START_STAGE"),
    );
    assert.equal(f.store.list("items").length, 0);
    assert.equal(f.store.list("sessions").length, 0);
    assert.equal(
      f.store.db
        .prepare("SELECT * FROM operations WHERE scope LIKE 'item-create:%'")
        .all().length,
      0,
    );
  } finally {
    f.close();
  }
});

test("Agent 配置失败整体回滚，修复后可用原操作重试", () => {
  const f = fixture();
  try {
    const input = {
      ...f.input,
      startStageId: f.auto,
      operationId: randomUUID(),
    };
    f.store.put("projects", { directories: [] }, f.project.id);
    assert.throws(
      () => f.service.createItem(input),
      code("DIRECTORY_MISMATCH"),
    );
    assert.equal(f.store.list("items").length, 0);
    f.store.put(
      "projects",
      { directories: f.project.directories },
      f.project.id,
    );
    f.store.put("agents", { supportedRuntimes: ["claude"] }, f.agent.id);
    assert.throws(() => f.service.createItem(input), code("AGENT_RUNTIME"));
    assert.equal(f.store.list("items").length, 0);
    assert.equal(f.store.list("sessions").length, 0);
    assert.equal(
      f.store.db.prepare("SELECT * FROM operations").all().length,
      0,
    );
    f.store.put("agents", { supportedRuntimes: ["codex"] }, f.agent.id);
    assert.ok(f.service.createItem(input).executionId);
  } finally {
    f.close();
  }
});

test("成功创建的防重墓碑在删除看板后不复活对象", () => {
  const f = fixture();
  try {
    const input = {
      ...f.input,
      startStageId: f.done,
      operationId: randomUUID(),
    };
    f.service.createItem(input);
    f.service.remove("boards", f.board.id);
    assert.throws(() => f.service.createItem(input), code("NOT_FOUND"));
    assert.equal(f.store.list("items").length, 0);
  } finally {
    f.close();
  }
});

test("HTTP 登录边界、并发重试和双语冲突响应", async () => {
  const f = fixture();
  const dir = mkdtempSync(join(tmpdir(), "item-start-http-"));
  const origin = "http://localhost:3180";
  const { app, store } = await createApp({
    dataDir: dir,
    publicUrl: origin,
    secureCookie: false,
  });
  try {
    for (const kind of ["environments", "projects", "agents", "boards"])
      for (const entity of f.store.list(kind))
        store.put(kind, entity, entity.id);
    const payload = {
      ...f.input,
      startStageId: f.auto,
      boardVersion: 1,
      operationId: randomUUID(),
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/items",
          payload,
          headers: { origin },
        })
      ).statusCode,
      401,
    );
    const raw = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(raw), "owner", Date.now() + 60000);
    const headers = { cookie: `relay_session=${raw}`, origin };
    const request = {
      method: "POST" as const,
      url: "/api/items",
      headers,
      payload,
    };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => app.inject(request)),
    );
    for (const result of responses) {
      assert.equal(result.statusCode, 200);
      assert.deepEqual(result.json(), responses[0].json());
    }
    assert.equal(store.list("items").length, 1);
    assert.equal(store.list("sessions").length, 1);
    assert.equal(store.db.prepare("SELECT * FROM executions").all().length, 1);
    for (const locale of ["zh-CN", "en"] as const) {
      const response = await app.inject({
        ...request,
        headers: { ...headers, "accept-language": locale },
        payload: { ...payload, title: "不同参数" },
      });
      assert.equal(response.statusCode, 409);
      assert.equal(
        response.json().messageKey,
        "workItemCreation.IDEMPOTENCY_CONFLICT",
      );
      assert.equal(
        response.json().message,
        itemCreationMessages.IDEMPOTENCY_CONFLICT[locale],
      );
    }
    assert.equal(
      (
        await app.inject({
          ...request,
          payload: { ...payload, startStageId: null },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          ...request,
          headers: { ...headers, origin: "https://invalid.example" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
    f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("工具在审批前冻结默认起点，恢复后拒绝过时配置；完全权限复用原子防重", async () => {
  const f = fixture();
  try {
    f.store.put(
      "boards",
      {
        stages: f.board.stages.map((stage: any) =>
          stage.fixedRole === "start"
            ? {
                ...stage,
                name: "Not started",
                nameKey: "board.stage.notStarted",
              }
            : stage,
        ),
      },
      f.board.id,
    );
    const model = f.service.save("models", {
      name: "fixture",
      protocol: "chat",
      baseUrl: "http://127.0.0.1:1/v1",
      model: "fixture",
      apiKey: "fixture-not-real",
      maxTokens: 2048,
    });
    let workbench = new Workbench(f.service);
    const w = {
      ...workbench.create({
        title: "fixture",
        modelId: model.id,
        permission: "ask",
      }),
      runId: randomUUID(),
    };
    const getTool = (runner: Workbench, record: any) =>
      runner
        .agent(record, f.store.get("models", model.id))
        .tools.find((t) => t.name === "create_work_item") as any;
    let tool = getTool(workbench, w);
    const input = { data: JSON.stringify(f.input) };
    assert.equal(await tool.needsApproval(new RunContext(), input), true);
    const intent: any = Object.values(
      f.store.get("workbench", w.id).itemCreationIntents,
    )[0];
    assert.equal(intent.data.startStageId, f.first);
    assert.equal(intent.startStage.type, "human");
    assert.equal(intent.startStage.fixedRole, "start");
    assert.equal(intent.startStage.nameKey, "board.stage.notStarted");
    assert.equal(f.store.list("items").length, 0);
    f.store.put(
      "boards",
      { stages: [...f.board.stages].reverse() },
      f.board.id,
    );
    f.restart();
    workbench = new Workbench(f.service);
    tool = getTool(workbench, w);
    await tool.invoke(new RunContext(), JSON.stringify(input));
    assert.equal(f.store.list("items").length, 0);
    const full = { ...w, permission: "full", runId: randomUUID() };
    tool = getTool(workbench, full);
    const explicit = {
      data: JSON.stringify({
        ...f.input,
        startStageId: f.auto,
        boardVersion: f.store.get("boards", f.board.id).version,
      }),
    };
    assert.equal(await tool.needsApproval(new RunContext(), explicit), false);
    const first = await tool.invoke(new RunContext(), JSON.stringify(explicit));
    const second = await tool.invoke(
      new RunContext(),
      JSON.stringify(explicit),
    );
    assert.deepEqual(JSON.parse(first), JSON.parse(second));
    assert.equal(JSON.parse(first).stageId, f.auto);
    assert.equal(f.store.list("items").length, 1);
    assert.equal(f.store.list("sessions").length, 1);
    // 预检查失败后对象出现，也不能绕过询问模式审批创建。
    tool = getTool(workbench, { ...w, runId: randomUUID() });
    const missingBoardId = randomUUID();
    const invalid = {
      data: JSON.stringify({ ...f.input, boardId: missingBoardId }),
    };
    assert.equal(await tool.needsApproval(new RunContext(), invalid), false);
    f.store.put("boards", f.board, missingBoardId);
    await tool.invoke(new RunContext(), JSON.stringify(invalid));
    assert.equal(f.store.list("items").length, 1);
  } finally {
    f.close();
  }
});

test("创建资源双语键与参数占位保持一致", () => {
  for (const messages of Object.values(itemCreationMessages)) {
    assert.deepEqual(Object.keys(messages).sort(), ["en", "zh-CN"]);
    assert.ok(messages.en.trim());
    assert.ok(messages["zh-CN"].trim());
    assert.deepEqual(
      messages.en.match(/\{\w+\}/g),
      messages["zh-CN"].match(/\{\w+\}/g),
    );
  }
});
