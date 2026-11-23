import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** HTTP 与真实临时 SQLite 覆盖人工推进、冲突及事务防重，不调用模型。 */
test("人工空交接、来源版本保护、认证及 Agent 必填保持", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-advance-"));
  const origin = "http://localhost:3180";
  const { app, store, service } = await createApp({
    dataDir: dir,
    publicUrl: origin,
  });
  try {
    const session = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(session), "owner", Date.now() + 60000);
    const headers = { origin, cookie: `relay_session=${session}` };
    const environment = store.put("environments", {
      name: "test",
      approved: true,
      roots: [{ id: "root", path: dir }],
    });
    const project = service.save("projects", {
      name: "测试",
      directories: [
        { environmentId: environment.id, rootId: "root", relativePath: "." },
      ],
    });
    const human = randomUUID(),
      other = randomUUID(),
      agent = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "拖动",
      projectId: project.id,
      stages: [
        {
          fixedRole: "start",
          id: human,
          name: "人工",
          type: "human",
          targets: [other, agent, done],
        },
        { id: other, name: "复核", type: "human", targets: [human, done] },
        {
          id: agent,
          name: "开发",
          type: "agent",
          agentId: service.save("agents", { name: "执行智能体" }).id,
          targets: [done],
          environmentId: environment.id,
          rootId: "root",
          relativePath: ".",
        },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    const makeItem = () =>
      service.createItem({
        boardId: board.id,
        title: "工作项",
        description: "",
      });
    const send = (item: any, body: any, auth = headers) =>
      app.inject({
        method: "POST",
        url: `/api/items/${item.id}/advance`,
        headers: auth,
        payload: body,
      });
    const payload = (item: any, targetId = done) => ({
      targetId,
      operationId: randomUUID(),
      expectedStageId: item.stageId,
      expectedVersion: item.version,
    });
    for (const record of [undefined, "", " \n\t", "  真实记录  "]) {
      const item = makeItem(),
        body = {
          ...payload(item),
          ...(record === undefined ? {} : { record }),
        };
      const response = await send(item, body);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().status, "done");
      const history = store
        .list("handoffs")
        .filter((h) => h.itemId === item.id);
      assert.equal(history.length, 1);
      assert.equal(history[0].record, record?.trim() ? record : "");
      assert.equal(history[0].from, human);
      assert.equal(history[0].to, done);
      assert.ok(history[0].createdAt);
      assert.equal((await send(item, body)).statusCode, 200);
      assert.equal(
        (await send(item, { ...body, operationId: randomUUID() })).statusCode,
        409,
      );
      assert.equal(
        store.list("handoffs").filter((h) => h.itemId === item.id).length,
        1,
      );
      assert.equal(
        (await send(item, { ...body, targetId: other })).json().code,
        "IDEMPOTENCY_CONFLICT",
      );
    }
    const item = makeItem();
    assert.equal(
      (await send(item, payload(item), { origin } as any)).statusCode,
      401,
    );
    assert.equal(
      (
        await send(item, payload(item), {
          ...headers,
          origin: "https://evil.invalid",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await send(item, { targetId: done, operationId: randomUUID() }))
        .statusCode,
      400,
    );
    assert.equal(
      (await send(item, payload(item, human))).json().code,
      "INVALID_TRANSITION",
    );
    const moved = (await send(item, payload(item, other))).json();
    assert.equal(moved.status, "human");
    const back = (await send(moved, payload(moved, human))).json();
    assert.equal(back.stageId, human);
    const stale = await send(item, payload(item));
    assert.equal(stale.json().code, "ITEM_ADVANCE_CONFLICT");
    assert.ok(stale.json().messageKey);
    const english = await send(item, payload(item), {
      ...headers,
      "accept-language": "en",
    } as any);
    assert.match(english.json().message, /Work item state has changed/);
    const queuedItem = makeItem(),
      request = payload(queuedItem, agent);
    assert.equal((await send(queuedItem, request)).statusCode, 200);
    assert.equal((await send(queuedItem, request)).statusCode, 200);
    assert.equal(
      (
        store.db
          .prepare("SELECT COUNT(*) AS n FROM executions WHERE item_id=?")
          .get(queuedItem.id) as any
      ).n,
      1,
    );
    const queued = store.get("items", queuedItem.id);
    assert.equal(
      (await send(queued, payload(queued))).json().code,
      "HANDOFF_REQUIRED",
    );
    assert.throws(
      () =>
        service.submitHandoff(
          queued.id,
          "S4",
          " \n",
          randomUUID(),
          queued.executionId,
        ),
      /交接记录不能为空/,
    );
    for (const state of [
      "dispatching",
      "running",
      "waiting",
      "unknown",
      "stopping",
    ]) {
      store.db
        .prepare("UPDATE executions SET state=? WHERE id=?")
        .run(state, queued.executionId);
      assert.equal(
        (await send(queued, { ...payload(queued), record: "人工处理" })).json()
          .code,
        "BUSY",
      );
    }
    const archived = makeItem();
    service.archiveItem(archived.id, true);
    const current = store.get("items", archived.id);
    assert.equal(
      (await send(current, payload(current))).json().code,
      "INVALID_TRANSITION",
    );
    const state = (await app.inject({ url: "/api/state", headers })).json();
    assert.ok(state.handoffs.some((h: any) => h.record === ""));
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
