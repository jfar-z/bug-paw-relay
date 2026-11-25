import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

test("删除接口按阶段返回当次引用，旧会话保留身份并要求重新选择", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "relay-agent-delete-"));
  const origin = "http://localhost:3180";
  const { app, service, store } = await createApp({ dataDir, publicUrl: origin });
  try {
    const token = randomUUID();
    store.db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)").run(digest(token), "owner", Date.now() + 60000);
    const headers = { origin, cookie: `relay_session=${token}`, "accept-language": "en" };
    const env = store.put("environments", {});
    const project = store.put("projects", { name: "项目" });
    const agent = service.save("agents", { name: "开发", environmentId: env.id });
    const other = service.save("agents", { name: "开发" });
    const stages = ["S2", "S3"].map(shortId => ({
      id: randomUUID(), shortId, name: "开发阶段", agentId: agent.id, instructions: "private-stage-data",
    }));
    const board = store.put("boards", { name: "同名看板", projectId: project.id, stages });
    const missingProject = randomUUID();
    const archived = store.put("boards", { name: board.name, archived: true, projectId: missingProject, stages: [stages[0]] });
    for (let index = 0; index < 105; index++)
      store.put("sessions", { environmentId: env.id, runtime: "codex", agentId: agent.id, archived: index % 2 === 1 });
    const sessions = store.list("sessions");
    const remove = (id: string) => app.inject({ method: "DELETE", url: "/api/agents/" + id, headers });
    const result = await remove(agent.id);
    assert.equal(result.statusCode, 400);
    assert.equal(result.json().code, "REFERENCED");
    const positions = stages.map(({ id, name, shortId }) => ({ id, name, shortId }));
    assert.deepEqual(result.json().boardReferences, [
      { boardId: board.id, boardName: board.name, projectId: project.id, projectName: project.name, archived: false, stages: positions },
      { boardId: archived.id, boardName: board.name, projectId: missingProject, projectName: null, archived: true, stages: positions.slice(0, 1) },
    ]);
    assert.doesNotMatch(result.body, /private-stage-data/);
    assert.deepEqual(store.get("boards", board.id), board);
    store.put("boards", { stages: stages.map(s => ({ ...s, agentId: other.id })) }, board.id);
    assert.deepEqual((await remove(agent.id)).json().boardReferences.map((b: any) => b.boardId), [archived.id]);
    store.remove("boards", archived.id);
    assert.deepEqual((await remove(agent.id)).json(), { ok: true });
    assert.equal((await remove(agent.id)).statusCode, 404);
    assert.deepEqual(store.list("sessions"), sessions);
    const send = await app.inject({
      method: "POST", url: `/api/sessions/${sessions[0].id}/send`, headers,
      payload: { operationId: randomUUID(), message: "继续" },
    });
    assert.equal(send.statusCode, 409);
    assert.equal(send.json().code, "SESSION_AGENT_DELETED");
    assert.match(send.json().message, /select another agent/i);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM executions").get()!.n, 0);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
