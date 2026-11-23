import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import { boardNameSchema } from "../src/shared/contracts.js";

test("标题统一校验：空白、控制字符与 UTF-16 边界", () => {
  for (const name of [
    "",
    "   ",
    "\n标题",
    "标题\n",
    "a\tb",
    "a\u0000b",
    "a\u0085b",
    "a\u2028b",
    "x".repeat(101),
    "😀".repeat(50) + "x",
  ])
    assert.equal(
      boardNameSchema.safeParse(name).success,
      false,
      JSON.stringify(name),
    );
  for (const name of [
    "一",
    "x".repeat(100),
    "😀".repeat(50),
    "<script>alert(1)</script>",
  ])
    assert.equal(boardNameSchema.parse(name), name);
  assert.equal(boardNameSchema.parse("  看板  标题  "), "看板  标题");
});

test("标题 HTTP 接口：认证、冲突、隔离、审计及持久读取", async () => {
  // 仅在临时目录生成测试数据与随机会话，不使用部署配置。
  const dir = mkdtempSync(join(tmpdir(), "relay-title-test-"));
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
    const project = service.save("projects", { name: "测试", directories: [] });
    const done = randomUUID();
    const board = service.save("boards", {
      name: "原名",
      projectId: project.id,
      stages: [
        {
          fixedRole: "start",
          id: randomUUID(),
          name: "需求",
          type: "human",
          targets: [done],
        },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    const copy = service.copyBoard(board.id);
    const url = `/api/boards/${board.id}/title`;
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: "PATCH", url, headers, payload });
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url,
          headers: { origin },
          payload: { name: "越权", version: 1 },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url,
          headers: { ...headers, origin: "https://evil.invalid" },
          payload: { name: "越权", version: 1 },
        })
      ).statusCode,
      403,
    );
    for (const payload of [
      { name: "\n错误", version: 1 },
      { name: " ", version: 1 },
      { name: "a", version: 0 },
      { name: "a" },
      { name: "a", version: 1, projectId: project.id },
    ])
      assert.equal((await patch(payload)).statusCode, 400);
    const first = await patch({ name: "  新  标题  ", version: board.version });
    assert.equal(first.statusCode, 200);
    const updated = first.json();
    assert.equal(updated.name, "新  标题");
    assert.equal(updated.version, 2);
    assert.deepEqual(updated.stages, board.stages);
    assert.equal(updated.projectId, board.projectId);
    assert.equal((await patch({ name: "重复", version: 1 })).statusCode, 409);
    assert.equal(
      (await patch({ name: "新  标题", version: 2 })).json().version,
      2,
    );
    // 模拟已有历史与在途数据；标题写入不能触及工作项或执行记录。
    const item = store.put("items", {
      boardId: board.id,
      stageId: board.stages[0].id,
      status: "running",
    });
    store.db
      .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        item.id,
        randomUUID(),
        randomUUID(),
        "running",
        "{}",
        new Date().toISOString(),
      );
    const before = store.db.prepare("SELECT * FROM executions").all();
    assert.equal(
      (await patch({ name: copy.name, version: 2 })).statusCode,
      200,
    );
    assert.deepEqual(store.get("items", item.id), item);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM executions").all(),
      before,
    );
    assert.deepEqual(store.get("boards", copy.id), copy);
    assert.throws(() =>
      service.save("boards", { ...board, name: "\t无效" }, board.id, 3),
    );
    const state = (await app.inject({ url: "/api/state", headers })).json();
    assert.equal(
      state.boards.find((b: any) => b.id === board.id).name,
      copy.name,
    );
    assert.equal(state.boardTitleAudit, undefined);
    const audit = store.list("boardTitleAudit");
    assert.ok(
      audit.some(
        (entry) => entry.statusCode === 409 && entry.result === "failure",
      ),
    );
    assert.ok(
      audit.some(
        (entry) => entry.actorId === "owner" && entry.statusCode === 200,
      ),
    );
    assert.ok(!JSON.stringify(audit).includes(session));
    assert.ok(!JSON.stringify(audit).includes("新  标题"));
    store.remove("boards", board.id);
    assert.equal((await patch({ name: "不重建", version: 3 })).statusCode, 404);
    assert.throws(() => store.get("boards", board.id));
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
