import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

test("会话项目排序原子保存，重启后保留，增删项目维持相对顺序", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-project-order-"));
  const origin = "http://localhost:3180";
  const options = { dataDir: dir, publicUrl: origin };
  let server = await createApp(options);
  try {
    const session = randomUUID();
    server.store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(session), "owner", Date.now() + 60000);
    const headers = { origin, cookie: `relay_session=${session}` };
    const state = async () =>
      (await server.app.inject({ url: "/api/state", headers })).json();
    const url = "/api/projects/order";
    const save = (projectIds: string[]) =>
      server.app.inject({
        method: "PUT",
        url,
        headers,
        payload: { projectIds },
      });
    const create = (name: string) =>
      server.service.save("projects", { name, directories: [] });
    const projects = ["甲", "乙", "丙"].map(create);
    const [a, b, c] = projects.map((p) => p.id);
    assert.deepEqual((await state()).sessionProjectIds, [a, b, c]);
    const payload = { projectIds: [c, a, b] };
    assert.equal(
      (
        await server.app.inject({
          method: "PUT",
          url,
          headers: { origin },
          payload,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await server.app.inject({
          method: "PUT",
          url,
          headers: { ...headers, origin: "https://example.invalid" },
          payload,
        })
      ).statusCode,
      403,
    );
    assert.deepEqual((await save(payload.projectIds)).json(), payload);
    assert.deepEqual((await save(payload.projectIds)).json(), payload);
    await server.app.close();
    server = await createApp(options);
    assert.deepEqual((await state()).projects, projects);
    assert.deepEqual((await state()).sessionProjectIds, payload.projectIds);
    const d = create("丁").id;
    for (const invalid of [
      [a, b, c],
      [a, b, c, c],
      [a, b, c, randomUUID()],
    ])
      assert.equal((await save(invalid)).statusCode, 409);
    assert.equal((await save(["invalid"])).statusCode, 400);
    assert.deepEqual((await state()).sessionProjectIds, [c, a, b, d]);
    server.service.remove("projects", a);
    assert.deepEqual((await state()).sessionProjectIds, [c, b, d]);
  } finally {
    await server.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
