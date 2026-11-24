import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

test("离线会话置顶遵守鉴权、跨项目顺序及归档恢复契约", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-session-pinning-"));
  const origin = "http://localhost:3180";
  const options = { dataDir: dir, publicUrl: origin };
  let server = await createApp(options);
  try {
    const token = randomUUID();
    server.store.db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(token), "owner", Date.now() + 60_000);
    const headers = { origin, cookie: `relay_session=${token}` };
    const save = (id: string, pinned: unknown, requestHeaders: Record<string, string> = headers) =>
      server.app.inject({ method: "PUT", url: `/api/sessions/${id}/pin`, headers: requestHeaders, payload: { pinned } });
    const sessions = async () =>
      (await server.app.inject({ url: "/api/state", headers })).json().sessions;
    const environmentId = server.store.put("environments", { approved: true }).id;
    const old = server.store.put("sessions", { environmentId, projectId: randomUUID(), lastUserMessageAt: "2025-10-01T00:00:00Z" });
    const executionId = randomUUID();
    const board = server.store.put("sessions", { environmentId, projectId: randomUUID(), executionId, status: "queued", lastUserMessageAt: "2025-10-02T00:00:00Z" });
    server.store.db.prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(executionId, randomUUID(), board.id, environmentId, "queued", JSON.stringify({ boardId: randomUUID() }), board.createdAt);
    assert.deepEqual((await sessions()).map((s: any) => s.pinOrder), [null, null]);
    assert.equal((await save(old.id, true, { origin })).statusCode, 401);
    assert.equal((await save(old.id, true, { ...headers, origin: "https://example.invalid" })).statusCode, 403);
    assert.equal((await save(old.id, "true")).statusCode, 400);
    assert.equal((await save(randomUUID(), true)).statusCode, 404);
    const first = (await save(old.id, true)).json();
    assert.deepEqual(first, { id: old.id, pinOrder: 1 });
    server.service.manageSessions([old.id], "archive");
    assert.equal((await save(old.id, false)).statusCode, 409);
    assert.deepEqual((await save(board.id, true)).json(), { id: board.id, pinOrder: 2 });
    server.service.manageSessions([old.id], "restore");
    const version = server.store.get("sessions", old.id).version;
    assert.deepEqual((await save(old.id, true)).json(), first);
    assert.equal(server.store.get("sessions", old.id).version, version);
    await server.app.close();
    server = await createApp(options);
    assert.deepEqual((await sessions()).map((s: any) => [s.id, s.pinOrder]), [[board.id, 2], [old.id, 1]]);
    assert.deepEqual((await save(old.id, false)).json(), { id: old.id, pinOrder: null });
    assert.deepEqual((await save(old.id, true)).json(), { id: old.id, pinOrder: 3 });
    // 提升置顶优先级后，普通列表的用户活动排序仍独立。
    assert.deepEqual((await sessions()).map((s: any) => s.id), [board.id, old.id]);
  } finally {
    await server.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
