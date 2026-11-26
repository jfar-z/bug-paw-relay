import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { terminalHistoryState } from "../src/server/history-sync.js";
import { digest } from "../src/server/security.js";

test("按页读取独立版本，外部写入、归档、待处理和详情使用相同记录", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-state-query-"));
  const origin = "http://localhost:3180";
  const { app, store, service } = await createApp({ dataDir: dir, publicUrl: origin });
  try {
    const session = randomUUID();
    store.db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)").run(digest(session), "owner", Date.now() + 60000);
    const headers = { origin, cookie: "relay_session=" + session };
    const url = "/api/state/query";
    const query = (payload: object) => app.inject({ method: "POST", url, headers, payload });
    const groups = ["sessions", "boardSummaries"];
    assert.equal((await app.inject({ method: "POST", url, headers: { origin }, payload: { groups } })).statusCode, 401);
    assert.equal((await query({ groups: ["handoffs"] })).statusCode, 400);
    assert.equal((await query({ groups: ["boardPage"] })).statusCode, 400);
    const stageId = randomUUID();
    const board = store.put("boards", { name: "看板", stages: [{ id: stageId, type: "human" }] });
    const item = store.put("items", { boardId: board.id, stageId, content: "需求正文", tags: [] });
    store.put("handoffs", { itemId: item.id, record: "交接正文" });
    const first = await query({ groups });
    assert.equal(first.statusCode, 200);
    assert.doesNotMatch(first.body, /需求正文|交接正文/);
    const { changes } = first.json();
    const summary = changes.boardSummaries.value[0];
    assert.equal(summary.pendingCount, service.stateSnapshot().boards[0].pendingCount);
    assert.equal(summary.itemCount, 1);
    const known = { sessions: changes.sessions.revision, boardSummaries: changes.boardSummaries.revision };
    assert.deepEqual((await query({ groups, known })).json(), { changes: {} });
    store.put("items", { archived: true }, item.id);
    const after = (await query({ groups, known })).json().changes;
    assert.deepEqual(Object.keys(after), ["boardSummaries"]);
    assert.equal(after.boardSummaries.value[0].pendingCount, 0);
    const scope = { groups: ["boardPage"], boardId: board.id };
    assert.deepEqual((await query(scope)).json().changes.boardPage.value.items, []);
    const archived = await query({ ...scope, includeArchived: true });
    assert.equal(archived.json().changes.boardPage.value.items[0].id, item.id);
    assert.doesNotMatch(archived.body, /需求正文|交接正文/);
    const detail = await app.inject({ url: "/api/boards/" + board.id + "/items/" + item.id, headers });
    assert.equal(detail.json().handoffs[0].record, "交接正文");
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codex 终态早于历史，直到同一轮最终工具内容可读才确认", () => {
  const executionId = randomUUID();
  const item = { id: "tool", type: "commandExecution", aggregatedOutput: "完成" };
  const turn = { id: "turn", status: "completed", items: [] as typeof item[] };
  const history = { nativeHistory: { thread: { turns: [turn] } }, events: [
    { executionId, sequence: 1, type: "item/completed", data: { turnId: turn.id, item } },
    { executionId, sequence: 2, type: "turn/completed", data: { turn } },
  ] };
  const read = () => terminalHistoryState(history, executionId, "codex");
  assert.equal(read(), "pending");
  turn.items = [{ ...item, aggregatedOutput: "" }];
  assert.equal(read(), "pending");
  turn.items = [item];
  assert.equal(read(), "confirmed");
  assert.equal(terminalHistoryState(history, randomUUID(), "codex"), "unverified");
});

test("Claude 分块和工具回执逐条核对，同名消息或缓冲缺口不能确认", () => {
  const executionId = randomUUID();
  const blocks = ["a", "b"].map(uuid => ({ type: "assistant", uuid, message: { id: "message", content: [uuid] } }));
  const history = { nativeHistory: blocks.slice(0, 1), events: [
    ...blocks.map((data, index) => ({ type: data.type, executionId, sequence: index + 1, data })),
    { type: "result", executionId, sequence: 3 },
  ] };
  const read = () => terminalHistoryState(history, executionId, "claude");
  assert.equal(read(), "pending");
  history.nativeHistory.push(blocks[1]);
  assert.equal(read(), "confirmed");
  history.events.shift();
  assert.equal(read(), "unverified");
});

test("历史读取途中结束或换轮，保留当前标题和归属，旧审批不复活", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-history-race-"));
  const { app, store, service } = await createApp({ dataDir: dir, publicUrl: "http://localhost:3180" });
  try {
    const env = store.put("environments", {});
    const executionId = randomUUID();
    const session = store.put("sessions", { title: "初始", runtime: "codex", environmentId: env.id, executionId, status: "running" });
    const history = { status: "completed", title: "旧标题", interactions: [{ id: "old" }] };
    let finish!: (value: typeof history) => void;
    service.peers.set(env.id, { call: () => new Promise(resolve => { finish = resolve; }), close() {} } as any);
    const first = service.sessionHistory(session.id);
    store.put("sessions", { title: "新标题", status: "completed" }, session.id);
    finish(history);
    const ended = await first;
    assert.equal(ended.title, "新标题");
    assert.equal(ended.terminalHistory, "pending");
    assert.deepEqual(ended.interactions, []);
    const second = service.sessionHistory(session.id);
    const next = randomUUID();
    store.put("sessions", { executionId: next, status: "waiting" }, session.id);
    finish(history);
    const changed = await second;
    assert.equal(changed.executionId, next);
    assert.equal(changed.historyExecutionId, executionId);
    assert.equal(changed.terminalHistory, undefined);
    assert.deepEqual(changed.interactions, []);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
