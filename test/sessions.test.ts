import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { Vault } from "../src/server/security.js";
import { Engine } from "../src/connector/engine.js";
import {
  historyEvents,
  sessionTimeline,
  sessionPublicationEvents,
  sessionActivity,
  mergeSessionEvents,
} from "../src/web/session-events.js";

/** 会话删除只改变服务端索引，归档和批量操作仍受执行状态约束。 */
test("批量归档原子性、取消归档、物理删除与迟到事件防复活", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-sessions-"));
  const store = new Store(join(dir, "server.db"));
  const local = new Store(join(dir, "local.db"));
  const service = new Service(store, new Vault(dir));
  const env = store.put("environments", { name: "test" });
  const ids = [randomUUID(), randomUUID()];
  const executions = [randomUUID(), randomUUID()];
  try {
    ids.forEach((id, i) => {
      store.put(
        "sessions",
        {
          title: "占位",
          environmentId: env.id,
          status: i ? "queued" : "completed",
          executionId: executions[i],
        },
        id,
      );
      local.put("localSessions", { title: "环境标题", runtime: "codex" }, id);
      store.db
        .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
        .run(
          executions[i],
          null,
          id,
          env.id,
          i ? "queued" : "completed",
          "{}",
          new Date().toISOString(),
        );
    });
    const handoff = store.put("handoffs", {
      executionId: executions[0],
      record: "交接仍在",
    });
    assert.throws(() => service.manageSessions(ids, "archive"), /先停止/);
    assert.equal(store.get("sessions", ids[0]).archived, undefined);
    assert.throws(() => service.manageSessions(ids, "delete"), /先停止/);
    assert.equal(store.list("sessions").length, 2);
    service.setState(executions[1], "cancelled");
    service.manageSessions(ids, "archive");
    await assert.rejects(
      service.send(ids[0], randomUUID(), "禁止续发"),
      /取消归档/,
    );
    service.manageSessions(ids, "restore");
    assert.equal(store.get("sessions", ids[1]).archived, false);
    assert.throws(
      () =>
        service.sessionEvent(randomUUID(), {
          executionId: executions[0],
          title: "越权标题",
        }),
      /环境不匹配/,
    );
    service.sessionEvent(env.id, {
      executionId: executions[0],
      title: "原生标题",
    });
    assert.equal(store.get("sessions", ids[0]).title, "原生标题");
    store.put("sessions", { status: "running" }, ids[0]);
    assert.throws(() => service.manageSessions(ids, "delete"), /先停止/);
    service.setState(executions[0], "completed");
    assert.equal(store.get("sessions", ids[0]).status, "completed");
    const next = randomUUID();
    store.db
      .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(
        next,
        null,
        ids[0],
        env.id,
        "running",
        "{}",
        new Date().toISOString(),
      );
    store.put("sessions", { executionId: next, status: "running" }, ids[0]);
    service.setState(executions[0], "completed");
    assert.equal(store.get("sessions", ids[0]).status, "running");
    service.setState(next, "completed");
    service.manageSessions(ids, "delete");
    service.sessionEvent(env.id, {
      executionId: executions[0],
      status: "completed",
      title: "迟到标题",
    });
    service.setState(executions[1], "cancelled");
    service.syncSessionTitle(ids[0], "迟到读取");
    assert.equal(store.list("sessions").length, 0);
    assert.equal(local.list("localSessions").length, 2);
    assert.equal(store.get("handoffs", handoff.id).record, "交接仍在");
    assert.equal(service.execution(executions[0]).session_id, ids[0]);
  } finally {
    store.close();
    local.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 原生历史读取期间发生的事件必须带执行标识，否则不同轮次的序号会碰撞。 */
test("环境历史包含标题、跨轮次事件 ID，标题同步不导入其他会话", async () => {
  const store = new Store(":memory:");
  const engine = new Engine(
    store,
    () => ({}),
    () => {},
    async () => ({}),
  );
  try {
    store.put("localSessions", { title: "环境维护的标题" }, "session");
    for (const id of ["run1", "run2"])
      store.put(
        "localExecutions",
        {
          sessionId: "session",
          status: "completed",
          events: [{ sequence: 1, type: "user", data: { text: id } }],
        },
        id,
      );
    const history = await engine.call("session.history", {
      sessionId: "session",
    });
    assert.equal(history.title, "环境维护的标题");
    assert.deepEqual(
      history.events.map((e: any) => e.executionId),
      ["run1", "run2"],
    );
    assert.equal(mergeSessionEvents(history.events, history.events).length, 2);
    assert.deepEqual(
      await engine.call("session.titles", { ids: ["missing"] }),
      [],
    );
  } finally {
    engine.close();
    store.close();
  }
});

/** 原生快照可能为空或滞后，渲染必须保留已完成消息、自己的消息及运行中的工具。 */
test("Codex 流式与滞后历史合并、终态去重、不可变快照", () => {
  const events = [
    { executionId: "r", sequence: 1, type: "user", data: { text: "任务" } },
    {
      executionId: "r",
      sequence: 2,
      type: "item/agentMessage/delta",
      data: { itemId: "a", delta: "开始" },
    },
    {
      executionId: "r",
      sequence: 3,
      type: "item/agentMessage/delta",
      data: { itemId: "a", delta: "处理" },
    },
    {
      executionId: "r",
      sequence: 4,
      type: "item/started",
      data: { item: { id: "t", type: "commandExecution", command: "pwd" } },
    },
    {
      executionId: "r",
      sequence: 5,
      type: "item/commandExecution/outputDelta",
      data: { itemId: "t", delta: "/workspace" },
    },
  ];
  const history = { nativeHistory: { thread: { turns: [] } }, events };
  const before = JSON.stringify(history);
  let rows = historyEvents(history);
  assert.equal(rows[0].data.text, "任务");
  assert.equal(rows[1].data.item.text, "开始处理");
  assert.equal(rows[2].data.item.aggregatedOutput, "/workspace");
  assert.equal(JSON.stringify(history), before);
  assert.deepEqual(historyEvents(history), rows);
  events.push({
    executionId: "r",
    sequence: 6,
    type: "item/completed",
    data: { item: { id: "a", type: "agentMessage", text: "开始处理，已完成" } },
  } as any);
  rows = historyEvents(history);
  assert.equal(rows.filter((r) => r.data.item?.id === "a").length, 1);
  assert.ok(rows.some((r) => r.data.item?.text === "开始处理，已完成"));
  const nativeHistory = {
    thread: {
      turns: [
        {
          items: [
            {
              id: "u",
              type: "userMessage",
              content: [{ type: "text", text: "任务" }],
            },
            { id: "a", type: "agentMessage", text: "开始处理，已完成" },
          ],
        },
      ],
    },
  };
  rows = historyEvents({ nativeHistory, events });
  assert.equal(rows.filter((r) => r.type === "user").length, 1);
  assert.equal(rows.filter((r) => r.data.item?.id === "a").length, 1);
});

test("Claude 多文本块、工具参数流与工具结果不混成用户消息", () => {
  const events: any[] = [];
  const emit = (type: string, data: any) =>
    events.push({ executionId: "r", sequence: events.length + 1, type, data });
  const stream = (event: any) => emit("stream_event", { event });
  stream({ type: "message_start", message: { id: "m" } });
  stream({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  stream({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "先检查" },
  });
  stream({
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "tool", name: "Read", input: {} },
  });
  stream({
    type: "content_block_delta",
    index: 1,
    delta: {
      type: "input_json_delta",
      partial_json: '{"file_path":"test.ts"}',
    },
  });
  let rows = historyEvents({ events });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].data.message.content[0].text, "先检查");
  assert.match(rows[1].data.item.input, /test.ts/);
  emit("assistant", {
    type: "assistant",
    uuid: "u",
    message: {
      id: "m",
      content: [
        { type: "text", text: "先检查" },
        {
          type: "tool_use",
          id: "tool",
          name: "Read",
          input: { file_path: "test.ts" },
        },
      ],
    },
  });
  emit("user", {
    type: "user",
    uuid: "result",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "tool", content: "文件内容" },
      ],
    },
  });
  rows = historyEvents({ events });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].data.item.output, "文件内容");
  assert.equal(rows[1].data.item.status, "已完成");
});

/** 真实连接器执行入口与 stdio RPC，验证正文只通过通知转发且原生标题具有优先权。 */
test("连接器在完成前推送用户消息、回答增量和工具事件", async () => {
  const { writeFileSync, chmodSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "relay-event-engine-"));
  const store = new Store(join(dir, "local.db"));
  const command = join(dir, "native-fixture.cjs");
  // 临时原生协议桩不使用任何真实模型或用户凭据。
  writeFileSync(
    command,
    `#!/usr/bin/env node
const readline = require('node:readline');
const send = (x) => process.stdout.write(JSON.stringify(x) + '\\n');
readline.createInterface({input: process.stdin}).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({id:m.id,result:{}});
  if (m.method === 'thread/start') send({id:m.id,result:{thread:{id:'native-session'}}});
  if (m.method === 'thread/read') send({id:m.id,result:{thread:{id:'native-session',name:'原生会话名称',turns:[]}}});
  if (m.method === 'turn/start') {
    send({id:m.id,result:{turn:{id:'turn'}}});
    send({method:'item/agentMessage/delta',params:{itemId:'reply',delta:'第一部分'}});
    send({method:'item/started',params:{item:{id:'tool',type:'commandExecution',command:'pwd'}}});
    setTimeout(() => {
      send({method:'item/completed',params:{item:{id:'reply',type:'agentMessage',text:'完整回答'}}});
      send({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}});
    }, 300);
  }
});
`,
    "utf8",
  );
  chmodSync(command, 0o755);
  const notifications: any[] = [];
  const engine = new Engine(
    store,
    () => ({ roots: [{ id: "root", path: dir }], codex: { command } }),
    (method, data) => notifications.push({ method, ...data }),
    async () => ({}),
  );
  try {
    const executionId = randomUUID();
    await engine.call("execution.start", {
      operationId: randomUUID(),
      executionId,
      session: {
        id: randomUUID(),
        title: "服务端旧标题",
        rootId: "root",
        relativePath: ".",
        runtime: "codex",
        permission: "ask",
      },
      message: "用户本轮消息",
    });
    const deadline = Date.now() + 3000;
    while (
      !notifications.some((n) => n.event?.type === "item/agentMessage/delta") &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(
      notifications.some(
        (n) => n.event?.type === "user" && n.event.data.text === "用户本轮消息",
      ),
    );
    assert.ok(notifications.some((n) => n.event?.data.delta === "第一部分"));
    assert.ok(!notifications.some((n) => n.status === "completed"));
    while (
      !notifications.some((n) => n.title === "原生会话名称") &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(notifications.some((n) => n.status === "completed"));
    assert.ok(notifications.some((n) => n.title === "原生会话名称"));
    const forwarded = notifications.filter((n) => n.event).map((n) => n.event);
    assert.ok(forwarded.every((e) => e.executionId === executionId));
    assert.equal(
      new Set(forwarded.map((e) => e.sequence)).size,
      forwarded.length,
    );
  } finally {
    engine.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 缓冲窗口截断后，以已完成的原生正文为准，残余增量不能截短回答。 */
test("已完成原生正文不会被残余增量覆盖", () => {
  const rows = historyEvents({
    nativeHistory: {
      thread: {
        turns: [
          {
            status: "completed",
            items: [
              { id: "reply", type: "agentMessage", text: "完整的长回答" },
            ],
          },
        ],
      },
    },
    events: [
      {
        executionId: "r",
        sequence: 1001,
        type: "item/agentMessage/delta",
        data: { itemId: "reply", delta: "长回答" },
      },
    ],
  });
  assert.equal(rows[0].data.item.text, "完整的长回答");
});

/** 配置只影响后续派发，并拒绝跨环境智能体、执行中修改和已归档修改。 */
test("会话配置作用于后续执行并校验环境与状态", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-session-config-"));
  const store = new Store(join(dir, "server.db"));
  const service = new Service(store, new Vault(dir));
  try {
    const environmentId = store.put("environments", { approved: true }).id;
    const agent = store.put("agents", {
      name: "开发",
      environmentId,
      instructions: "测试职责",
    });
    const foreign = store.put("agents", { environmentId: randomUUID() });
    const session = store.put("sessions", {
      environmentId,
      runtime: "codex",
      agentId: null,
      permission: "ask",
      status: "idle",
    });
    let dispatched: any;
    service.peers.set(environmentId, {
      call: async (_method: string, input: any) => {
        dispatched = input;
        return { status: "running" };
      },
    } as any);
    assert.throws(
      () =>
        service.configureSession(session.id, {
          agentId: foreign.id,
          permission: "full",
        }),
      /环境不匹配/,
    );
    assert.throws(() =>
      service.configureSession(session.id, { permission: "invalid" }),
    );
    assert.equal(store.get("sessions", session.id).permission, "ask");
    service.configureSession(session.id, {
      agentId: agent.id,
      permission: "full",
    });
    const result = await service.send(session.id, randomUUID(), "执行");
    assert.equal(dispatched.session.permission, "full");
    assert.equal(dispatched.session.agent.id, agent.id);
    assert.throws(
      () =>
        service.configureSession(session.id, {
          agentId: null,
          permission: "ask",
        }),
      /正在执行/,
    );
    service.setState(result.executionId, "completed");
    assert.throws(() => service.configureSession(session.id, { agentId: null, permission: "ask" }), { code: "AGENT_REQUIRED" });
    assert.equal(store.get("sessions", session.id).agentId, agent.id);
    store.put("sessions", { archived: true }, session.id);
    assert.throws(
      () =>
        service.configureSession(session.id, {
          agentId: null,
          permission: "full",
        }),
      /取消归档/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 阶段需求被包装后仍是同一次输入，兼容升级前缓冲且不吞掉后续重复发送。 */
test("阶段会话原生包装与需求回显去重，保留未持久化续发", () => {
  const text = "检查问题\n保留原有行为";
  for (const runtime of ["codex", "claude"]) {
    const prompt = `阶段指令\n工作项：修复问题\n${text}\n允许目标：["done"]\n交接历史:[]`;
    const wrapped =
      prompt.replace("交接历史:", "交接历史：") +
      (runtime === "codex"
        ? "\n完成后调用 relay_handoff 工具提交记录并选择合法目标。"
        : "\n完成后调用 mcp__relay__handoff 工具。");
    const snapshot = (input: string): any =>
      runtime === "codex"
        ? {
            thread: {
              turns: [
                {
                  status: "completed",
                  items: [
                    {
                      id: "u",
                      type: "userMessage",
                      content: [{ type: "text", text: input }],
                    },
                    { id: "a", type: "agentMessage", text: "已完成" },
                  ],
                },
              ],
            },
          }
        : [
            { uuid: "u", type: "user", message: { content: input } },
            {
              uuid: "a",
              type: "assistant",
              message: { id: "a", content: [{ type: "text", text: "已完成" }] },
            },
          ];
    const event = (executionId: string) => ({
      executionId,
      sequence: 1,
      type: "user",
      data: { text },
    });
    const events = [event("stage")];
    const history = { nativeHistory: snapshot(wrapped), events };
    const before = JSON.stringify(history);
    const rows = historyEvents(history);
    assert.equal(rows.length, 2, runtime);
    assert.equal(rows[0].data.text, wrapped);
    assert.notEqual(rows.at(-1)?.type, "user");
    assert.equal(JSON.stringify(history), before);
    assert.deepEqual(historyEvents(history), rows);
    const pending = historyEvents({
      ...history,
      events: [...events, event("followup")],
    });
    assert.equal(pending.filter((r) => r.type === "user").length, 2);
    assert.equal(pending.at(-1)?.data.text, text);
    assert.equal(historyEvents({ events })[0].data.text, text);
    // 普通引用、近似包装和损坏 JSON 均不能掩盖真正的新用户输入。
    for (const unrelated of [
      `请参考：${text}`,
      wrapped.replace("工作项：", "引用："),
      wrapped.replace('["done"]', "invalid"),
      wrapped + "额外内容",
      wrapped.replace(text, text + "其他要求"),
    ]) {
      assert.equal(
        historyEvents({ nativeHistory: snapshot(unrelated), events }).filter(
          (r) => r.type === "user",
        ).length,
        2,
        unrelated,
      );
    }
  }
});

/** 读取已保存的用户时间，改名与状态变化不能挤到最近工作顶部。 */
test("会话排序使用用户时间并保持项目顺序", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-order-"));
  const store = new Store(":memory:");
  const service = new Service(store, new Vault(dir));
  try {
    const first = store.put("projects", { name: "先建项目" });
    const second = store.put("projects", { name: "后建项目" });
    const older = store.put("sessions", {
      projectId: first.id,
      lastUserMessageAt: "2026-01-01T00:00:00Z",
    });
    const newer = store.put("sessions", {
      projectId: second.id,
      lastUserMessageAt: "2026-01-02T00:00:00Z",
    });
    store.db
      .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        null,
        newer.id,
        "env",
        "completed",
        "{}",
        "2026-01-02T00:00:00Z",
      );
    store.put(
      "sessions",
      { title: "助手更新标题", status: "completed" },
      older.id,
    );
    assert.deepEqual(
      service.list("sessions").map((s) => s.id),
      [newer.id, older.id],
    );
    assert.equal(
      service.list("sessions")[0].lastUserMessageAt,
      "2026-01-02T00:00:00Z",
    );
    assert.deepEqual(
      service.list("projects").map((p) => p.id),
      [first.id, second.id],
    );
    store.put(
      "sessions",
      { lastUserMessageAt: "2026-01-03T00:00:00Z" },
      older.id,
    );
    assert.deepEqual(
      service.list("sessions").map((s) => s.id),
      [older.id, newer.id],
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 活动兼容不同 CLI 的未知结构，思考增量与最终历史去重且不改变消息顺序。 */
test("会话活动分组、原始降级及双 CLI reasoning", () => {
  const codex = historyEvents({
    events: [
      {
        type: "item/started",
        data: { item: { id: "think", type: "reasoning" } },
      },
      {
        type: "item/reasoning/summaryTextDelta",
        data: { itemId: "think", delta: "检查" },
      },
      {
        type: "item/reasoning/summaryTextDelta",
        data: { itemId: "think", delta: "边界" },
      },
      {
        type: "item/completed",
        data: {
          item: {
            id: "new",
            type: "futureTool",
            arguments: "broken{",
            result: { custom: false },
          },
        },
      },
      {
        type: "item/completed",
        data: { item: { id: "answer", type: "agentMessage", text: "完成" } },
      },
    ],
  });
  const groups = sessionTimeline(codex);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].blocks.length, 2);
  assert.equal(groups[0].followedByText, true);
  assert.equal(groups[0].blocks[0].name, "reasoning");
  assert.equal(groups[0].blocks[0].raw.summaryText, "检查边界");
  assert.equal(groups[0].blocks[1].arguments, "broken{");
  assert.deepEqual(groups[0].blocks[1].output, { custom: false });
  assert.equal(
    sessionActivity({
      id: "x",
      type: "item/completed",
      data: { item: { type: { unexpected: true }, input: false } },
    })?.name,
    "tool",
  );
  const stream = (event: any) => ({ type: "stream_event", data: { event } });
  const events = [
    stream({ type: "message_start", message: { id: "m" } }),
    stream({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "" },
    }),
    stream({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "分析中" },
    }),
    stream({ type: "content_block_stop", index: 0 }),
  ];
  assert.equal(
    sessionActivity(historyEvents({ events })[0])?.raw.thinking,
    "分析中",
  );
  const message = {
    type: "assistant",
    uuid: "u",
    message: {
      id: "m",
      content: [
        { type: "thinking", thinking: "分析完成", signature: "opaque" },
        { type: "future_block", nested: { preserved: true } },
        { type: "text", text: "答案" },
      ],
    },
  };
  const rows = historyEvents({ nativeHistory: [message], events });
  assert.equal(rows.length, 3);
  assert.equal(sessionActivity(rows[0])?.raw.thinking, "分析完成");
  assert.deepEqual(sessionActivity(rows[1])?.raw.nested, { preserved: true });
  assert.equal(sessionTimeline(rows)[0].followedByText, true);
});

/** 旧连接器的历史与实时转发也必须在服务端去掉图片，浏览器无需接收完整编码。 */
test("旧连接器图片不进入浏览器历史或 SSE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-media-"));
  const store = new Store(":memory:");
  const service = new Service(store, new Vault(dir));
  const env = store.put("environments", { name: "image" });
  const executionId = randomUUID();
  const session = store.put("sessions", {
    environmentId: env.id,
    executionId,
    status: "running",
  });
  store.db
    .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
    .run(
      executionId,
      null,
      session.id,
      env.id,
      "running",
      "{}",
      new Date().toISOString(),
    );
  const binary = "YWJj".repeat(100000);
  const item = {
    id: "image",
    type: "mcpToolCall",
    tool: "Read",
    result: {
      content: [{ type: "image", mimeType: "image/png", data: binary }],
    },
  };
  service.peers.set(env.id, {
    call: async () => ({
      nativeHistory: { thread: { turns: [{ items: [item] }] } },
    }),
  } as any);
  try {
    const history = await service.sessionHistory(session.id);
    assert.ok(JSON.stringify(history).length < 2000);
    let forwarded: any;
    service.sessionEvents.once(session.id, (event) => {
      forwarded = event;
    });
    service.sessionEvent(env.id, {
      executionId,
      event: { type: "item/completed", data: { item } },
    });
    assert.ok(JSON.stringify(forwarded).length < 2000);
    assert.equal(forwarded.event.data.item.tool, "Read");
    assert.equal(item.result.content[0].data, binary);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 两种 CLI 的分段回答跨工具只保留一个身份，新用户输入再开启下一轮。 */
test("环境回答身份按用户轮次展示", () => {
  const answer = (id: string) => ({
    id,
    type: "item/completed",
    data: { item: { type: "agentMessage", text: id } },
  });
  const claude = {
    id: "c",
    type: "assistant",
    data: { message: { content: [{ type: "text", text: "继续" }] } },
  };
  const rows = [
    answer("history"),
    { id: "u", type: "user", data: { text: "开始" } },
    answer("first"),
    {
      id: "tool",
      type: "item/completed",
      data: { item: { type: "commandExecution", command: "pwd" } },
    },
    answer("second"),
    claude,
    { id: "u2", type: "user", data: { text: "下一轮" } },
    claude,
  ];
  assert.deepEqual(
    sessionTimeline(rows)
      .filter((group) => group.showIdentity)
      .map((group) => group.id),
    ["history", "first", "c"],
  );
  assert.equal(
    sessionTimeline(rows.slice(0, 5)).filter((group) => group.showIdentity)
      .length,
    2,
  );
});

/** 重连提示依据原生执行证据更新，不能被其他执行、其他轮次或普通通知误清除。 */
test("原生重试区分恢复、结束与最终错误，刷新后保留正确状态", () => {
  const retry = {
    type: "error",
    executionId: "run",
    sequence: 1,
    data: {
      turnId: "turn",
      willRetry: true,
      error: { message: "Reconnecting... 1/5" },
    },
  };
  const event = (type: string, data: any = {}, executionId = "run") => ({
    type,
    data,
    executionId,
    sequence: 2,
  });
  const state = (following: any[], turns: any[] = []) =>
    historyEvents({
      events: [retry, ...following],
      nativeHistory: { thread: { turns } },
    }).find((row) => row.type === "error")?.retryState;
  assert.equal(state([]), "retrying");
  assert.equal(state([event("deprecationNotice")]), "retrying");
  assert.equal(
    state([event("item/commandExecution/outputDelta", { delta: "output" })]),
    "retrying",
  );
  assert.equal(
    state([event("item/agentMessage/delta", { delta: "answer" }, "other")]),
    "retrying",
  );
  assert.equal(
    state([
      event("item/agentMessage/delta", { delta: "answer", turnId: "other" }),
    ]),
    "retrying",
  );
  assert.equal(
    state([
      event("item/agentMessage/delta", { delta: "answer", turnId: "turn" }),
    ]),
    "recovered",
  );
  assert.equal(
    state([
      event("turn/completed", { turn: { id: "turn", status: "completed" } }),
    ]),
    "recovered",
  );
  for (const status of ["failed", "interrupted"]) {
    assert.equal(
      state([event("turn/completed", { turn: { id: "turn", status } })]),
      "ended",
    );
    assert.equal(state([], [{ id: "turn", status, items: [] }]), "ended");
  }
  assert.equal(
    state([], [{ id: "turn", status: "completed", items: [] }]),
    "recovered",
  );
  assert.equal(
    state([], [{ id: "other", status: "completed", items: [] }]),
    "retrying",
  );
  const fatal = event("error", {
    error: { message: "最终失败" },
    willRetry: false,
  });
  assert.equal(state([fatal]), "ended");
  const rows = historyEvents({ events: [retry, fatal] });
  assert.equal(rows[1].data.error.message, "最终失败");
  assert.equal(rows[1].retryState, undefined);
  assert.equal(retry.data.error.message, "Reconnecting... 1/5");
  assert.equal("retryState" in retry, false);
});

/** 有限事件缓冲、执行跨轮与旧版本记录使用同一套时间边界。 */
test("轻应用按唯一轮次或发布时间定位，早于缓冲的记录随历史恢复", () => {
  const time = (seconds: number) => new Date(seconds * 1000).toISOString();
  const user = (id: string, at: number, executionId?: string) => ({
    id, type: "user", timestamp: at * 1000, executionId,
  });
  const answer = (id: string, executionId: string) => ({
    id, type: "assistant", executionId,
  });
  const versions = [
    { id: "old", createdAt: time(25) },
    { id: "active", executionId: "current", createdAt: time(65) },
    { id: "ambiguous", executionId: "repeat", createdAt: time(55) },
    { id: "z-tie", createdAt: time(45) },
    { id: "a-tie", createdAt: time(45) },
    { id: "a-tie", createdAt: time(45) },
  ];
  const recent = [
    user("middle", 40, "repeat"),
    answer("middle-answer", "repeat"),
    user("later", 50, "repeat"),
    answer("later-answer", "repeat"),
    user("latest", 60, "current"),
    user("next", 70),
  ];
  const ids = (rows: any[]) => rows.map(({ id }) => id);
  assert.deepEqual(
    ids(sessionPublicationEvents(recent, versions, { gap: true })),
    ["middle", "middle-answer", "light:a-tie", "light:z-tie", "later", "later-answer", "light:ambiguous", "latest", "light:active", "next"],
  );
  assert.deepEqual(
    ids(sessionPublicationEvents(
      [user("early", 20), ...recent], versions, { gap: true, nativeHistory: {} },
    )).slice(0, 4),
    ["early", "light:old", "middle", "middle-answer"],
  );
});

test("错序和重复自动批准按原生调用归属，旧记录与跨执行记录保留原位", () => {
  const approval = (sequence: number, interactionId: string, itemId?: string, executionId = "run") =>
    ({ sequence, executionId, type: "relay/approval/auto", data: { interactionId, itemId } });
  const first = approval(1, "one", "b");
  const second = approval(2, "two", "b");
  const legacy = approval(3, "legacy");
  const foreign = approval(1, "foreign", "a", "other");
  for (const runtime of ["codex", "claude"]) {
    const calls = ["a", "b"].map((id, index) => runtime === "codex"
      ? { sequence: 5 + index, executionId: "run", type: "item/completed",
          data: { item: { id, type: "commandExecution", status: "failed" } } }
      : { sequence: 5 + index, executionId: "run", type: "assistant",
          data: { type: "assistant", uuid: id, message: { content: [{ type: "tool_use", id, name: "Write" }] } } });
    const rows = historyEvents({
      events: [first, legacy, ...calls, foreign],
      autoApprovalEvents: [first, second, approval(4, "one", "b")],
    });
    assert.deepEqual(rows.filter(r => r.type === first.type).map(r => r.data.interactionId), ["legacy", "foreign"]);
    const blocks = sessionTimeline(rows).flatMap(g => g.blocks || []);
    assert.deepEqual(blocks.map(b => b.autoApprovals?.length ?? 0), [0, 2]);
    if (runtime === "codex") assert.equal(blocks[1].status, "failed");
    const nativeHistory = runtime === "codex"
      ? { thread: { turns: [{ id: "turn", items: calls.map(c => c.data.item) }] } }
      : calls.map(c => c.data);
    const ambiguous = historyEvents({ nativeHistory, autoApprovalEvents: [first, approval(1, "other", "b", "other")] });
    assert.equal(ambiguous.filter(r => r.type === first.type).length, 2);
    const restored = historyEvents({ nativeHistory, autoApprovalEvents: [first, second] });
    assert.deepEqual(restored.map(r => r.autoApprovals?.length ?? 0), [0, 2]);
  }
});
