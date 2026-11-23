import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

test("全局智能体顺序独立保存，升级、重启和配置增删改保持顺序", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-agent-order-"));
  const origin = "http://localhost:3180";
  const options = { dataDir: dir, publicUrl: origin };
  let server = await createApp(options);
  try {
    const session = randomUUID();
    server.store.db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(session), "owner", Date.now() + 60000);
    const headers = { origin, cookie: `relay_session=${session}` };
    const save = (agentIds: string[], requestHeaders: Record<string, string> = headers) =>
      server.app.inject({ method: "PUT", url: "/api/agents/order", headers: requestHeaders, payload: { agentIds } });
    const listIds = async () => {
      const state = await server.app.inject({ url: "/api/state", headers });
      return state.json().agents.map((agent: { id: string }) => agent.id);
    };

    const env = server.store.put("environments", { name: "环境" });
    const a = server.service.save("agents", { name: "甲" });
    const b = server.service.save("agents", { name: "乙", environmentId: env.id });
    const c = server.service.save("agents", { name: "丙", supportedRuntimes: ["claude"] });
    assert.deepEqual(await listIds(), [a.id, b.id, c.id]);
    const order = [c.id, b.id, a.id];
    assert.equal((await save(order, { origin })).statusCode, 401);
    assert.equal((await save(order, { ...headers, origin: "https://example.invalid" })).statusCode, 403);
    assert.deepEqual((await save(order)).json(), { agentIds: order });
    assert.deepEqual((await save(order)).json(), { agentIds: order });
    await server.app.close();
    server = await createApp(options);
    assert.deepEqual(await listIds(), order);
    assert.deepEqual(server.service.list("agents"), [c, b, a]);
    server.service.save("agents", { ...a, name: "修改" }, a.id, a.version);
    const d = server.service.save("agents", { name: "丁" });
    for (const invalid of [order, [...order, b.id], [...order, randomUUID()]]) {
      const result = await save(invalid);
      assert.equal(result.statusCode, 409);
      assert.equal(result.json().code, "CONFLICT");
    }
    assert.equal((await save(["invalid"])).statusCode, 400);
    assert.deepEqual(await listIds(), [...order, d.id]);
    server.service.remove("agents", b.id);
    assert.deepEqual(await listIds(), [c.id, a.id, d.id]);
  } finally {
    await server.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
