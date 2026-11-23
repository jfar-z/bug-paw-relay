import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { Vault } from "../src/server/security.js";
import {
  handoffCapability,
  handoffProjection,
  workflowPrompt,
  workflowTargets,
  handoffMessages,
} from "../src/shared/stage-handoff.js";
import { historyEvents } from "../src/shared/session-events.js";

/** 隔离数据库和凭据目录，所有执行使用内存 RPC 替身，不消耗模型额度。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "handoff-number-"));
  const store = new Store(join(dir, "test.db"));
  const service = new Service(store, new Vault(dir));
  const env = store.put("environments", {
    approved: true,
    capabilities: [handoffCapability, "board-resume-v1"],
  });
  const project = service.save("projects", {
    name: "项目",
    directories: [{ environmentId: env.id, rootId: "root", relativePath: "." }],
  });
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const input = {
    name: "看板",
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
        id: ids[0],
        name: "同名",
        type: "agent",
        agentId: service.save("agents", { name: "执行智能体" }).id,
        targets: [ids[1], ids[2], ids[3]],
        environmentId: env.id,
        rootId: "root",
      },
      { id: ids[1], name: "同名", type: "human", targets: [ids[0]] },
      {
        id: ids[2],
        name: "下游",
        type: "agent",
        agentId: service.save("agents", { name: "执行智能体" }).id,
        targets: [ids[3]],
        environmentId: env.id,
        rootId: "root",
      },
      { id: ids[3], name: "完成", type: "done", targets: [] },
    ],
  };
  const board = service.save("boards", input);
  const calls: any[] = [];
  service.peers.set(env.id, {
    call: async (method: string, params: any) => {
      calls.push({ method, params });
      return { status: method === "execution.prepare" ? "queued" : "running" };
    },
  } as any);
  const running = () => {
    const created = service.createItem({
      boardId: board.id,
      startStageId: board.stages[1].id,
      title: "任务",
    });
    const item = store.get("items", created.id);
    service.setState(item.executionId, "running");
    return item;
  };
  return {
    dir,
    store,
    service,
    env,
    project,
    board,
    input,
    calls,
    running,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const code = (value: string) => (e: any) => e.code === value;

test("稳定编号：重排、省略、篡改、删除最高号和复制高水位、防重保存", () => {
  const f = fixture();
  try {
    assert.deepEqual(
      f.board.stages.map((s: any) => s.shortId),
      ["S1", "S2", "S3", "S4", "S5"],
    );
    let b = f.service.save(
      "boards",
      {
        ...f.board,
        stages: [f.board.stages[0], ...f.board.stages.slice(1).reverse()].map(
          ({ shortId, ...s }: any) => s,
        ),
      },
      f.board.id,
      1,
    );
    assert.deepEqual(
      b.stages.map((s: any) => s.shortId),
      ["S1", "S5", "S4", "S3", "S2"],
    );
    assert.throws(
      () =>
        f.service.save(
          "boards",
          {
            ...b,
            stages: b.stages.map((s: any, i: number) =>
              i === 0 ? { ...s, shortId: "S100" } : s,
            ),
          },
          b.id,
          b.version,
        ),
      code("STAGE_SHORT_ID_INVALID"),
    );
    const added = {
      id: randomUUID(),
      name: "新增",
      type: "human",
      targets: [],
    };
    b = f.service.save(
      "boards",
      { ...b, stages: [...b.stages, added] },
      b.id,
      b.version,
    );
    assert.equal(b.stages.at(-1).shortId, "S6");
    const draft = {
      ...b,
      stages: b.stages.filter((s: any) => s.id !== added.id),
    };
    const preview = f.service.previewBoardFlow(b.id, draft, b.version);
    const op = randomUUID();
    const request = {
      ...draft,
      confirmationToken: preview.confirmationToken,
      operationId: op,
    };
    const version = b.version;
    b = f.service.save("boards", request, b.id, version);
    assert.deepEqual(f.service.save("boards", request, b.id, version), b);
    const copyOp = randomUUID();
    const copy = f.service.copyBoard(b.id, copyOp);
    assert.deepEqual(f.service.copyBoard(b.id, copyOp), copy);
    assert.equal(copy.stageShortIdHighWater, 6);
    assert.deepEqual(
      copy.stages.map((s: any) => s.shortId),
      b.stages.map((s: any) => s.shortId),
    );
    assert.ok(
      copy.stages.every((s: any) => !b.stages.some((x: any) => x.id === s.id)),
    );
    assert.ok(
      copy.stages.every((s: any) =>
        s.targets.every((t: string) =>
          copy.stages.some((x: any) => x.id === t),
        ),
      ),
    );
    const saved = f.service.save(
      "boards",
      { ...copy, stages: [...copy.stages, { ...added, id: randomUUID() }] },
      copy.id,
      copy.version,
    );
    assert.equal(saved.stages.at(-1).shortId, "S7");
    assert.equal(f.store.get("boards", b.id).stageShortIdHighWater, 6);
    const create = { ...f.input, operationId: randomUUID() };
    const first = f.service.save("boards", create);
    assert.deepEqual(f.service.save("boards", create), first);
    assert.throws(
      () => f.service.save("boards", { ...create, name: "变参" }),
      code("IDEMPOTENCY_CONFLICT"),
    );
    assert.throws(
      () => f.service.save("boards", { ...f.input, stages: f.board.stages }),
      code("STAGE_SHORT_ID_INVALID"),
    );
    f.store.put(
      "boards",
      { stageShortIdHighWater: Number.MAX_SAFE_INTEGER },
      copy.id,
    );
    const full = f.store.get("boards", copy.id);
    assert.throws(
      () =>
        f.service.save(
          "boards",
          { ...full, stages: [...full.stages, { ...added, id: randomUUID() }] },
          full.id,
          full.version,
        ),
      code("STAGE_SHORT_ID_EXHAUSTED"),
    );
  } finally {
    f.close();
  }
});

test("v2 快照解析：非法编号、同名目标、改名、三类出口与已完成重放", () => {
  for (const [target, status] of [
    ["S3", "human"],
    ["S4", "queued"],
    ["S5", "done"],
  ]) {
    const f = fixture();
    try {
      const item = f.running();
      const execution = f.service.execution(item.executionId);
      const snap = JSON.parse(execution.snapshot);
      assert.equal(snap.boardId, f.board.id);
      assert.deepEqual(
        snap.allowedTargets.map((s: any) => s.shortId),
        ["S3", "S4", "S5"],
      );
      const projected = handoffProjection(snap);
      assert.ok(!JSON.stringify(projected).includes(f.board.stages[1].id));
      for (const bad of [
        "S2",
        "s2",
        "S02",
        "S100",
        "同名",
        f.board.stages[1].id,
      ])
        assert.throws(
          () =>
            f.service.submitHandoff(
              item.id,
              bad,
              "记录",
              randomUUID(),
              execution.id,
            ),
          code("INVALID_HANDOFF_TARGET"),
        );
      f.store.put(
        "boards",
        { stages: f.board.stages.map((s: any) => ({ ...s, name: "改名" })) },
        f.board.id,
      );
      const op = randomUUID();
      const result = f.service.submitHandoff(
        item.id,
        target!,
        "记录",
        op,
        execution.id,
      );
      assert.equal(result.status, status);
      assert.deepEqual(
        f.service.submitHandoff(item.id, target!, "记录", op, execution.id),
        result,
      );
      assert.throws(
        () =>
          f.service.submitHandoff(item.id, target!, "变参", op, execution.id),
        code("IDEMPOTENCY_CONFLICT"),
      );
      assert.equal(f.store.list("handoffs").length, 1);
      assert.equal(
        (f.store.db.prepare("SELECT count(*) n FROM executions").get() as any)
          .n,
        target === "S4" ? 2 : 1,
      );
      assert.equal(
        JSON.parse(f.service.execution(execution.id).snapshot).allowedTargets[0]
          .name,
        "同名",
      );
    } finally {
      f.close();
    }
  }
});

test("快照及实时权限双重校验：撤销路径、新增路径、映射损坏、停止、归档、跨项", () => {
  for (const mutation of [
    "removed",
    "added",
    "corrupt",
    "version",
    "stopped",
    "archived",
    "revoked",
    "other",
    "deleted",
  ]) {
    const f = fixture();
    try {
      const item = f.running();
      const ex = f.service.execution(item.executionId);
      const snap = JSON.parse(ex.snapshot);
      let target = "S3",
        expected = "INVALID_TRANSITION";
      if (mutation === "removed")
        f.store.put(
          "boards",
          {
            stages: f.board.stages.map((s: any, i: number) =>
              i !== 1 ? s : { ...s, targets: [] },
            ),
          },
          f.board.id,
        );
      if (mutation === "added") {
        snap.stage.targets = snap.stage.targets.slice(1);
        snap.allowedTargets = snap.allowedTargets.slice(1);
        expected = "INVALID_HANDOFF_TARGET";
      }
      if (mutation === "corrupt") {
        snap.allowedTargets[0].shortId = "S4";
        expected = "HANDOFF_SNAPSHOT_INVALID";
      }
      if (mutation === "version") {
        snap.handoffContractVersion = 9;
        expected = "HANDOFF_CONTRACT_UNSUPPORTED";
      }
      if (["added", "corrupt", "version"].includes(mutation))
        f.store.db
          .prepare("UPDATE executions SET snapshot=? WHERE id=?")
          .run(JSON.stringify(snap), ex.id);
      if (mutation === "stopped") {
        f.service.setState(ex.id, "stopping");
        expected = "STALE_EXECUTION";
      }
      if (mutation === "archived") {
        f.store.put("items", { archived: true }, item.id);
        expected = "STALE_EXECUTION";
      }
      if (mutation === "revoked") {
        f.store.put("environments", { revoked: true }, f.env.id);
        expected = "REVOKED";
      }
      if (mutation === "other") {
        const other = f.running();
        item.id = other.id;
        expected = "SCOPE";
      }
      if (mutation === "deleted") {
        f.store.put(
          "boards",
          { stages: f.board.stages.filter((s: any) => s.shortId !== "S3") },
          f.board.id,
        );
        expected = "STAGE_DELETED";
      }
      assert.throws(
        () =>
          f.service.submitHandoff(item.id, target, "记录", randomUUID(), ex.id),
        code(expected),
      );
      assert.equal(f.store.list("handoffs").length, 0);
    } finally {
      f.close();
    }
  }
});

test("能力门禁不占容量；续发冻结映射并保持交接防重", async () => {
  const f = fixture();
  try {
    f.service.saveLanguage({ preference: "zh-CN" });
    const item = f.service.createItem({
      boardId: f.board.id,
      startStageId: f.board.stages[1].id,
      title: "任务",
    });
    f.service.saveLanguage({ preference: "en" });
    const ex = f.service.execution(f.store.get("items", item.id).executionId);
    f.store.put(
      "environments",
      { capabilities: ["board-resume-v1"] },
      f.env.id,
    );
    await f.service.tick();
    assert.equal(f.calls.length, 0);
    {
      assert.equal(
        f.service.list("items")[0].waitingReason,
        "connector_upgrade_required",
      );
      assert.equal(f.service.execution(ex.id).state, "queued");
      f.store.put(
        "environments",
        { capabilities: [handoffCapability, "board-resume-v1"] },
        f.env.id,
      );
      await f.service.tick();
      assert.equal(f.calls[0].params.workflow.locale, "zh-CN");
      assert.equal(f.calls[0].params.workflow.allowedTargets[0].shortId, "S3");
    }
    f.service.setState(ex.id, "completed");
    f.store.put(
      "boards",
      {
        stages: f.board.stages.map((s: any) => ({ ...s, name: "后来名称" })),
      },
      f.board.id,
    );
    const resumed = await f.service.send(ex.session_id, randomUUID(), "继续");
    const snap = JSON.parse(f.service.execution(resumed.executionId).snapshot);
    assert.equal(snap.locale, "en");
    assert.equal(f.calls.at(-1).params.workflow.locale, "en");
    assert.equal(snap.handoffContractVersion, 2);
    assert.equal(snap.allowedTargets[0].name, "同名");
    await f.service.tick();
    assert.throws(
      () => f.service.submitHandoff(item.id, "S3", "迟到", randomUUID(), ex.id),
      code("STALE_EXECUTION"),
    );
    const op = randomUUID();
    const target = "S3";
    const result = f.service.submitHandoff(
      item.id,
      target,
      "记录",
      op,
      resumed.executionId,
    );
    assert.deepEqual(
      f.service.submitHandoff(item.id, target, "记录", op, resumed.executionId),
      result,
    );
  } finally {
    f.close();
  }
});

test("空出口、版本验证、双语资源与新旧原生包装去重", () => {
  for (const texts of Object.values(handoffMessages))
    assert.ok(texts.en && texts["zh-CN"]);
  for (const runtime of ["codex", "claude"] as const) {
    for (const targets of [
      [],
      [{ shortId: "S2", name: "人工", type: "human" }],
    ]) {
      const workflow = {
        instructions: "指令",
        title: "标题",
        handoffContractVersion: 2,
        currentStage: { shortId: "S1", name: "开发", type: "agent" },
        allowedTargets: targets,
        handoffs: [],
      };
      assert.deepEqual(
        workflowTargets(workflow),
        targets.map((s) => s.shortId),
      );
      for (const locale of [undefined, "zh-CN", "en"] as const) {
        const prompt = workflowPrompt({ ...workflow, locale }, "需求", runtime);
        const heading =
          locale === "en"
            ? "Current stage"
            : locale === "zh-CN"
              ? "当前阶段"
              : "当前阶段 / Current stage";
        assert.ok(prompt.includes("## " + heading + "\n"));
        assert.equal(prompt.includes("当前阶段 / Current stage"), !locale);
        const nativeHistory =
          runtime === "codex"
            ? {
                thread: {
                  turns: [
                    {
                      items: [
                        {
                          id: "native",
                          type: "userMessage",
                          content: [{ type: "input_text", text: prompt }],
                        },
                      ],
                    },
                  ],
                },
              }
            : [{ type: "user", uuid: "native", message: { content: prompt } }];
        const events = historyEvents({
          nativeHistory,
          events: [
            {
              type: "user",
              executionId: "e",
              sequence: 1,
              data: { text: "需求" },
            },
            {
              type: "user",
              executionId: "e",
              sequence: 2,
              data: { text: "需求" },
            },
          ],
        });
        assert.equal(events.filter((e: any) => e.type === "user").length, 2);
        assert.ok(events.some((e: any) => e.id === "user:e:2"));
      }
    }
  }
  assert.throws(
    () => workflowTargets({ targets: [randomUUID()] }),
    code("HANDOFF_CONTRACT_UNSUPPORTED"),
  );
  assert.throws(
    () => workflowTargets({ handoffContractVersion: 2 }),
    code("HANDOFF_SNAPSHOT_INVALID"),
  );
});

test("重启保留编号与完成操作，旧执行显式重试升级 v2，环境账本不迁移", () => {
  const f = fixture();
  try {
    const item = f.running();
    const ex = f.service.execution(item.executionId);
    const old = JSON.parse(ex.snapshot);
    for (const key of [
      "handoffContractVersion",
      "boardId",
      "currentStage",
      "allowedTargets",
    ])
      delete old[key];
    f.store.db
      .prepare("UPDATE executions SET snapshot=? WHERE id=?")
      .run(JSON.stringify(old), ex.id);
    f.service.setState(ex.id, "failed");
    const retried = f.service.retry(item.id);
    assert.notEqual(retried.executionId, ex.id);
    assert.equal(
      JSON.parse(f.service.execution(retried.executionId).snapshot)
        .handoffContractVersion,
      2,
    );
    f.service.setState(retried.executionId, "running");
    const op = randomUUID();
    const result = f.service.submitHandoff(
      item.id,
      "S5",
      "交付",
      op,
      retried.executionId,
    );
    const restored = new Store(join(f.dir, "test.db"));
    const service = new Service(restored, new Vault(f.dir));
    assert.deepEqual(
      service.submitHandoff(item.id, "S5", "交付", op, retried.executionId),
      result,
    );
    assert.equal(restored.list("handoffs").length, 1);
    restored.close();
    const local = new Store(join(f.dir, "local.db"), false);
    assert.equal(
      (local.db.prepare("PRAGMA user_version").get() as any).user_version,
      1,
    );
    local.close();
  } finally {
    f.close();
  }
});

test("旧客户端在流程门禁下省略只读编号不构成流程变更", () => {
  const f = fixture();
  try {
    f.running();
    const saved = f.service.save(
      "boards",
      { ...f.board, stages: f.board.stages.map(({ shortId, ...s }: any) => s) },
      f.board.id,
      f.board.version,
    );
    assert.deepEqual(
      saved.stages.map((s: any) => s.shortId),
      ["S1", "S2", "S3", "S4", "S5"],
    );
  } finally {
    f.close();
  }
});

test("Markdown 历史完整保留正文、稳定正序、产物白名单及旧记录兼容", () => {
  const body =
    '# 标题\n| a | b |\n| - | - |\n```json\n{"executionId":"用户原文"}\n```\n````\n[链接](/doc)\n' +
    "长正文".repeat(3000);
  const stage = {
    id: "internal-stage",
    shortId: "S2",
    name: "同名",
    type: "human",
  };
  const workflow = {
    instructions: "节点指令\n完整保留",
    title: "标题",
    handoffContractVersion: 2,
    currentStage: { shortId: "S1", name: "开发", type: "agent" },
    allowedTargets: [stage, { shortId: "S3", name: "同名", type: "done" }],
    handoffs: [
      {
        createdAt: "2026-11-13T04:00:00.123Z",
        record: body,
        fromStage: stage,
        toStage: stage,
        id: "internal-handoff",
        executionId: "internal-execution",
        artifacts: [
          { id: "internal-artifact", name: "接口.md", sha256: "internal-hash" },
          { name: "" },
          { name: "second" },
        ],
      },
      { createdAt: "2026-11-13T11:00:00.123+08:00", record: "较早记录" },
      {
        createdAt: "2026-11-13T03:00:00.123Z",
        record: "同时间后记录",
        artifacts: [],
      },
      { record: "缺失时间仍保留" },
    ],
  };
  const before = JSON.stringify(workflow);
  const prompts = ["codex", "claude"].map((runtime) =>
    workflowPrompt(workflow, body, runtime as "codex" | "claude"),
  );
  for (const prompt of prompts) {
    assert.ok(prompt.startsWith(workflow.instructions));
    assert.ok(prompt.indexOf("较早记录") < prompt.indexOf("同时间后记录"));
    assert.ok(prompt.indexOf("同时间后记录") < prompt.indexOf(body));
    assert.equal(prompt.split(body).length, 3);
    assert.ok(prompt.includes("`````markdown\n" + body + "\n`````"));
    assert.equal(prompt.split("**产物 / Artifacts**").length, 2);
    assert.ok(prompt.includes("未命名产物 / Unnamed artifact"));
    assert.ok(prompt.includes("未知阶段 / Unknown stage"));
    for (const hidden of [
      "internal-stage",
      "internal-handoff",
      "internal-execution",
      "internal-artifact",
      "internal-hash",
      "handoffContractVersion",
    ])
      assert.ok(!prompt.includes(hidden), hidden);
    assert.equal(prompt.split("## 允许推进目标 / Allowed targets").length, 2);
    const events = historyEvents({
      nativeHistory: [
        { type: "user", uuid: "native", message: { content: prompt } },
      ],
      events: [1, 2].map((sequence) => ({
        type: "user",
        executionId: "e",
        sequence,
        data: { text: body },
      })),
    });
    assert.equal(events.filter((e) => e.type === "user").length, 2);
  }
  assert.equal(
    prompts[0].slice(0, prompts[0].lastIndexOf("\n\n")),
    prompts[1].slice(0, prompts[1].lastIndexOf("\n\n")),
  );
  assert.equal(JSON.stringify(workflow), before);
  assert.throws(
    () => workflowPrompt({ targets: ["legacy-uuid"] }, "原文", "codex"),
    code("HANDOFF_CONTRACT_UNSUPPORTED"),
  );
});

test("旧 JSON 包装继续抵消一次回显，普通子串不得去重", () => {
  const prompt =
    '指令\n工作项：任务\n需求\n允许目标：["S2"]\n交接历史：[]\n完成后调用 relay_handoff 工具提交记录并选择合法目标。';
  for (const text of [prompt, "普通内容中包含需求"]) {
    const result = historyEvents({
      nativeHistory: [
        { type: "user", uuid: "native", message: { content: text } },
      ],
      events: [1, 2].map((sequence) => ({
        type: "user",
        executionId: "e",
        sequence,
        data: { text: "需求" },
      })),
    });
    assert.equal(
      result.filter((e) => e.type === "user").length,
      text === prompt ? 2 : 3,
    );
  }
});

// 交接账本先完成，原生回合结束后才同步会话，防止交接后仍在输出时误报空闲。
test("交接后的终态通知同步会话、实时事件和交互清理，拒绝旧版本", () => {
  const f = fixture();
  try {
    const item = f.running();
    const ex = f.service.execution(item.executionId);
    f.service.setState(ex.id, "running", 3);
    f.service.submitHandoff(item.id, "S4", "已交接", randomUUID(), ex.id);
    const next = f.store.get("items", item.id);
    const events: any[] = [];
    f.service.sessionEvents.on(ex.session_id, (event) => events.push(event));
    assert.equal(f.service.execution(ex.id).state, "completed");
    assert.equal(f.store.get("sessions", ex.session_id).status, "running");
    f.service.sessionEvent(f.env.id, {
      executionId: ex.id,
      status: "completed",
      stateVersion: 2,
      interactions: [],
    });
    assert.equal(f.store.get("sessions", ex.session_id).status, "running");
    assert.equal(
      events.some((event) => event.status),
      false,
    );
    events.length = 0;
    f.service.sessionEvent(f.env.id, {
      executionId: ex.id,
      status: "completed",
      stateVersion: 4,
      interactions: [],
    });
    assert.equal(f.store.get("sessions", ex.session_id).status, "completed");
    assert.deepEqual(
      events.map((event) => event.type),
      ["execution-state", "update"],
    );
    assert.equal(events[0].status, "completed");
    assert.equal(events[1].status, "completed");
    assert.deepEqual(events[1].interactions, []);
    assert.deepEqual(f.store.get("items", item.id), next);
    events.length = 0;
    f.service.setState(ex.id, "completed", 4);
    f.service.setState(ex.id, "running", 5);
    assert.equal(events.length, 0);
    assert.equal(f.store.get("sessions", ex.session_id).status, "completed");
  } finally {
    f.close();
  }
});

test("重连核查交接后残留会话，仅原生终态校正且重复对账不重复通知", async () => {
  for (const status of [
    "completed",
    "failed",
    "cancelled",
    "running",
    "waiting",
    "not_found",
  ]) {
    const f = fixture();
    try {
      const item = f.running();
      const ex = f.service.execution(item.executionId);
      f.service.setState(ex.id, "running", 3);
      f.service.submitHandoff(item.id, "S3", "已交接", randomUUID(), ex.id);
      const next = f.store.get("items", item.id);
      const events: any[] = [];
      const calls: string[] = [];
      f.service.sessionEvents.on(ex.session_id, (event) => events.push(event));
      const peer = {
        call: async (method: string, params: any) => {
          assert.equal(method, "execution.status");
          calls.push(params.executionId);
          // 相同版本也可修复旧索引，但较旧版本不能覆盖已知状态。
          return { status, stateVersion: 3 };
        },
      } as any;
      await f.service.reconcile(f.env.id, peer);
      const terminal = ["completed", "failed", "cancelled"].includes(status);
      assert.equal(
        f.store.get("sessions", ex.session_id).status,
        terminal ? "completed" : "running",
        status,
      );
      assert.equal(events.length, terminal ? 1 : 0, status);
      assert.deepEqual(f.store.get("items", item.id), next);
      await f.service.reconcile(f.env.id, peer);
      assert.equal(calls.length, terminal ? 1 : 2, status);
      assert.equal(events.length, terminal ? 1 : 0, status);
    } finally {
      f.close();
    }
  }
});

test("交接残留对账隔离环境、已删除会话及 RPC 等待期间的新执行", async () => {
  for (const race of ["new-execution", "deleted", "other-environment"]) {
    const f = fixture();
    try {
      const item = f.running();
      const ex = f.service.execution(item.executionId);
      f.service.submitHandoff(item.id, "S3", "已交接", randomUUID(), ex.id);
      const events: any[] = [];
      f.service.sessionEvents.on(ex.session_id, (event) => events.push(event));
      let calls = 0;
      const peer = {
        call: async () => {
          calls++;
          if (race === "deleted") f.store.remove("sessions", ex.session_id);
          else
            f.store.put(
              "sessions",
              { executionId: "new-execution", status: "running" },
              ex.session_id,
            );
          return { status: "completed", stateVersion: 4 };
        },
      } as any;
      await f.service.reconcile(
        race === "other-environment" ? randomUUID() : f.env.id,
        peer,
      );
      assert.equal(calls, race === "other-environment" ? 0 : 1);
      assert.equal(events.length, 0);
      if (race === "deleted") assert.equal(f.store.list("sessions").length, 0);
      else
        assert.equal(f.store.get("sessions", ex.session_id).status, "running");
      if (race === "deleted") {
        await f.service.reconcile(f.env.id, peer);
        assert.equal(calls, 1);
      }
    } finally {
      f.close();
    }
  }
});

test("禁用 CLI 保留排队执行和历史，重新启用后只派发一次", async () => {
  const f = fixture();
  try {
    const item = f.service.createItem({
      boardId: f.board.id,
      startStageId: f.board.stages[1].id,
      title: "任务",
    });
    f.service.setRuntimeEnabled(f.env.id, "codex", false);
    await f.service.tick();
    const waiting = f.service.list("items")[0];
    assert.equal(waiting.id, item.id);
    assert.equal(waiting.status, "queued");
    assert.equal(waiting.waitingReason, "cli_disabled");
    assert.equal(waiting.needsAttention, true);
    assert.equal(f.calls.length, 0);
    f.service.setRuntimeEnabled(f.env.id, "codex", true);
    await f.service.tick();
    await f.service.tick();
    assert.deepEqual(f.calls.map((c) => c.method), ["execution.start"]);
    const execution = f.service.execution(waiting.executionId);
    f.service.setRuntimeEnabled(f.env.id, "codex", false);
    f.service.setState(execution.id, "completed");
    assert.equal(f.service.execution(execution.id).state, "completed");
    await assert.rejects(f.service.send(execution.session_id, randomUUID(), "继续"), code("CLI_DISABLED"));
    assert.equal(f.calls.length, 1);
  } finally {
    f.close();
  }
});
