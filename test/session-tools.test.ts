import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store.js";
import { Vault } from "../src/server/security.js";
import { Service } from "../src/server/service.js";
import {
  SessionWaiter,
  readSessionHistory,
} from "../src/server/session-tools.js";

/** 隔离数据库和环境桩，验证真实业务边界而不调用供应商。 */
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "relay-session-tools-"));
  const store = new Store(join(dir, "test.db"));
  const service = new Service(store, new Vault(dir));
  const environment = store.put("environments", { name: "fixture" });
  const session = store.put("sessions", {
    environmentId: environment.id,
    status: "running",
    title: "fixture",
  });
  const executionId = randomUUID();
  store.db
    .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
    .run(
      executionId,
      null,
      session.id,
      environment.id,
      "running",
      "{}",
      new Date().toISOString(),
    );
  store.put("sessions", { executionId }, session.id);
  const calls: string[] = [];
  let status = "running";
  let history: any = { events: [] };
  service.peers.set(environment.id, {
    call: async (method: string) => {
      calls.push(method);
      if (method === "session.history") return history;
      assert.equal(method, "execution.result");
      return {
        status,
        executionId,
        reply: status === "completed" ? "任务完成" : "",
      };
    },
  } as any);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    service,
    session,
    executionId,
    environment,
    calls,
    waiter: new SessionWaiter(service),
    state: (value: string) => {
      status = value;
      service.setState(executionId, value);
    },
    history: (value: any) => {
      history = value;
    },
  };
}

test("等待由状态事件唤醒，正文风暴不增加 RPC，重复查询转为等待", async (t) => {
  const f = fixture(t);
  assert.equal((await f.waiter.result(f.executionId)).status, "running");
  let finished = false;
  const pending = f.waiter.result(f.executionId).then((r) => {
    finished = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 20));
  for (let i = 0; i < 100; i++)
    f.service.sessionEvents.emit(f.session.id, { type: "update" });
  assert.equal(finished, false);
  assert.equal(f.calls.length, 2);
  f.state("completed");
  const result = await pending;
  assert.equal(result.reply, "任务完成");
  assert.equal(result.status, "completed");
  assert.equal(f.calls.length, 3);
  assert.equal(f.service.sessionEvents.listenerCount(f.session.id), 0);
});

test("等待超时、人工交互、停止和离线均释放监听且不取消环境任务", async (t) => {
  const f = fixture(t);
  const timeout = await f.waiter.wait([f.executionId], 25);
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.results[0].status, "running");
  const abort = new AbortController();
  const pending = f.waiter.wait([f.executionId], 10000, abort.signal);
  abort.abort();
  await assert.rejects(pending, /环境任务继续/);
  assert.equal(f.service.execution(f.executionId).state, "running");
  const approval = f.waiter.wait([f.executionId], 10000);
  f.state("waiting");
  assert.equal((await approval).nextAction, "open_session");
  f.service.peers.delete(f.environment.id);
  assert.equal(
    (await f.waiter.wait([f.executionId], 10000)).results[0].status,
    "offline",
  );
  assert.equal(f.service.sessionEvents.listenerCount(f.session.id), 0);
  assert.ok(f.calls.every((c) => c === "execution.result"));
});

test("历史跨轮分页稳定、正文工具隔离、大小受限且不写入环境历史副本", async (t) => {
  const f = fixture(t);
  const turn = (n: number) => ({
    id: `turn-${n}`,
    status: "completed",
    items: [
      {
        id: `user-${n}`,
        type: "userMessage",
        content: [{ type: "input_text", text: `问题${n}` }],
      },
      {
        id: `tool-${n}`,
        type: "commandExecution",
        command: "pwd",
        aggregatedOutput: "工作目录",
      },
      { id: `answer-${n}`, type: "agentMessage", text: `回答${n}` },
    ],
  });
  const history = {
    nativeHistory: { thread: { turns: [turn(1), turn(2)] } },
    events: [],
  };
  f.history(history);
  const page = await readSessionHistory(f.service, {
    sessionId: f.session.id,
    limit: 2,
  });
  assert.deepEqual(
    page.messages.map((m: any) => m.content),
    ["问题2", "回答2"],
  );
  assert.equal(page.hasMore, true);
  history.nativeHistory.thread.turns.push(turn(3));
  const older = await readSessionHistory(f.service, {
    sessionId: f.session.id,
    limit: 2,
    before: page.nextCursor,
  });
  assert.deepEqual(
    older.messages.map((m: any) => m.content),
    ["问题1", "回答1"],
  );
  assert.equal(older.hasMore, false);
  assert.equal(
    (
      await readSessionHistory(f.service, {
        sessionId: f.session.id,
        includeTools: true,
      })
    ).messages.filter((m: any) => m.role === "tool").length,
    3,
  );
  await assert.rejects(
    readSessionHistory(f.service, {
      sessionId: f.session.id,
      before: page.nextCursor,
      includeTools: true,
    }),
    /游标/,
  );
  await assert.rejects(
    readSessionHistory(f.service, { sessionId: f.session.id, limit: 1000 }),
  );
  f.history({
    events: [
      {
        type: "user",
        sequence: 1,
        executionId: f.executionId,
        data: { text: "长".repeat(5000) },
      },
    ],
    gap: true,
    historyError: "读取失败，仅缓冲",
  });
  const partial = await readSessionHistory(f.service, {
    sessionId: f.session.id,
  });
  assert.equal(partial.truncated, true);
  assert.equal(partial.gap, true);
  assert.equal(partial.messages[0].executionId, f.executionId);
  assert.equal(partial.messages[0].content.length, 4000);
  assert.doesNotMatch(
    JSON.stringify(f.store.list("sessions")),
    /问题|回答|长长/,
  );
  f.service.peers.delete(f.environment.id);
  await assert.rejects(
    readSessionHistory(f.service, { sessionId: f.session.id }),
    /离线/,
  );
});

test("Claude 历史保留较早回复，工具结果不混入用户正文", async (t) => {
  const f = fixture(t);
  f.history({
    nativeHistory: [
      { type: "user", uuid: "u1", message: { content: "第一问" } },
      {
        type: "assistant",
        uuid: "a1",
        message: {
          id: "m1",
          content: [
            { type: "text", text: "第一答" },
            {
              type: "tool_use",
              id: "tool1",
              name: "Read",
              input: { path: "README.md" },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "u2",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tool1", content: "读取结果" },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "a2",
        message: { id: "m2", content: [{ type: "text", text: "第二答" }] },
      },
    ],
    events: [],
  });
  const page = await readSessionHistory(f.service, { sessionId: f.session.id });
  assert.deepEqual(
    page.messages.map((m: any) => m.content),
    ["第一问", "第一答", "第二答"],
  );
  const tools = await readSessionHistory(f.service, {
    sessionId: f.session.id,
    includeTools: true,
  });
  assert.match(
    tools.messages.find((m: any) => m.role === "tool")!.content,
    /读取结果/,
  );
});

test("多执行等待不被慢环境阻塞，失败和取消均提前返回", async (t) => {
  const f = fixture(t);
  const slowEnvironment = f.store.put("environments", { name: "slow" });
  const slowId = randomUUID();
  f.store.db
    .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
    .run(
      slowId,
      null,
      f.session.id,
      slowEnvironment.id,
      "running",
      "{}",
      new Date().toISOString(),
    );
  let release!: (value: any) => void;
  f.service.peers.set(slowEnvironment.id, {
    call: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  } as any);
  const pending = f.waiter.wait([slowId, f.executionId], 5000);
  f.state("failed");
  const result = await pending;
  assert.equal(result.timedOut, false);
  assert.equal(result.results[1].status, "failed");
  assert.equal(result.results[0].resultAvailable, false);
  release({ status: "running", reply: "" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(result.results[0].status, "unknown");
  const cancelled = fixture(t);
  cancelled.state("cancelled");
  assert.equal(
    (await cancelled.waiter.wait([cancelled.executionId], 5000)).results[0]
      .status,
    "cancelled",
  );
});
