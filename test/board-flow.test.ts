import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { createApp } from "../src/server/app.js";
import { parseBoardWrite } from "../src/server/board-tool.js";
import { Vault, digest } from "../src/server/security.js";

/** 使用独立内存库和临时加密目录，不接触运行数据。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "board-flow-"));
  const store = new Store(":memory:");
  const service = new Service(store, new Vault(dir));
  const project = service.save("projects", { name: "测试", directories: [] });
  const first = randomUUID(),
    removed = randomUUID(),
    done = randomUUID();
  const board = service.save("boards", {
    name: "看板",
    projectId: project.id,
    stages: [
      {
        fixedRole: "start",
        id: first,
        name: "起点",
        type: "human",
        targets: [removed, done],
      },
      { id: removed, name: "旧阶段", type: "human", targets: [done] },
      { id: done, name: "完成", type: "done", targets: [] },
    ],
  });
  const draft = {
    ...board,
    stages: board.stages
      .filter((s: any) => s.id !== removed)
      .map((s: any) => ({
        ...s,
        targets: s.targets.filter((id: string) => id !== removed),
      })),
  };
  return {
    store,
    service,
    board,
    draft,
    first,
    removed,
    done,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("在途计数涵盖已结束待推进项，阶段名称可随时编辑", () => {
  for (const completed of [false, true])
    for (const archived of [false, true]) {
      const f = fixture();
      try {
        assert.equal(f.service.boardEditability(f.board.id).editable, true);
        const item = f.service.createItem({
          boardId: f.board.id,
          title: "测试",
        });
        f.store.put(
          "items",
          {
            stageId: completed ? f.done : f.first,
            archived,
            status: "completed",
          },
          item.id,
        );
        assert.equal(
          f.service.boardEditability(f.board.id).editable,
          true,
        );
        const draft = {
          ...f.board,
          stages: f.board.stages.map((s: any) => ({
            ...s,
            name: s.name + "新",
          })),
        };
        assert.equal(f.service.boardEditability(f.board.id).blockingItemCount, completed || archived ? 0 : 1);
        f.service.save("boards", draft, f.board.id, f.board.version);
        if (archived && !completed) {
          f.service.archiveItem(item.id, false);
          assert.equal(
            f.service.boardEditability(f.board.id).blockingItemCount,
            1,
          );
        }
      } finally {
        f.close();
      }
    }
});

test("删除影响去重、限定清理、缺失标记、恢复拒绝与幂等", () => {
  const f = fixture();
  try {
    const item = f.service.createItem({
      boardId: f.board.id,
      title: "正文保留",
      content: "内容",
    });
    f.store.put("items", { stageId: f.removed, archived: true }, item.id);
    const lost = f.store.put("handoffs", {
      itemId: item.id,
      from: f.first,
      to: f.removed,
      artifacts: [{ id: randomUUID() }],
    });
    const kept = f.store.put("handoffs", {
      itemId: item.id,
      from: f.first,
      to: f.done,
      artifacts: [],
    });
    const preview = f.service.previewBoardFlow(f.board.id, f.draft, 1);
    assert.deepEqual(
      [preview.affectedItemCount, preview.handoffCount, preview.artifactCount],
      [1, 1, 1],
    );
    assert.equal(f.store.list("handoffs").length, 2);
    assert.throws(
      () => f.service.save("boards", f.draft, f.board.id, 1),
      /重新评估/,
    );
    const input = {
      ...f.draft,
      confirmationToken: preview.confirmationToken,
      operationId: randomUUID(),
    };
    const saved = f.service.save("boards", input, f.board.id, 1);
    assert.deepEqual(f.service.save("boards", input, f.board.id, 1), saved);
    assert.equal(
      f.store.list("board_flow_changes").filter((x) => x.result === "success")
        .length,
      1,
    );
    assert.throws(() => f.store.get("handoffs", lost.id));
    assert.equal(f.store.get("handoffs", kept.id).id, kept.id);
    const historical = f.store.get("items", item.id);
    assert.equal(historical.content, "内容");
    assert.equal(historical.stageDeleted, true);
    assert.equal(historical.historyIncomplete, true);
    assert.throws(() => f.service.archiveItem(item.id, false), /原阶段已删除/);
    assert.throws(() => f.service.retry(item.id), /先恢复/);
    assert.equal(f.store.get("items", item.id).archived, true);
    assert.equal(
      f.service.createItem({ boardId: f.board.id, title: "新任务" }).stageId,
      f.first,
    );
  } finally {
    f.close();
  }
});

test("影响变化、状态竞争、版本竞争和固定终点均拒绝旧保存", () => {
  const f = fixture();
  try {
    const item = f.service.createItem({ boardId: f.board.id, title: "归档" });
    f.service.archiveItem(item.id, true);
    const preview = f.service.previewBoardFlow(f.board.id, f.draft, 1);
    f.store.put("handoffs", { itemId: item.id, from: f.removed, to: f.done });
    assert.throws(
      () =>
        f.service.save(
          "boards",
          { ...f.draft, confirmationToken: preview.confirmationToken },
          f.board.id,
          1,
        ),
      /重新评估/,
    );
    f.service.archiveItem(item.id, false);
    assert.throws(
      () => f.service.save("boards", f.draft, f.board.id, 1),
      /S1 · 起点.*S2 · 旧阶段/,
    );
    f.service.archiveItem(item.id, true);
    const updated = f.service.save(
      "boards",
      { ...f.board, name: "改名" },
      f.board.id,
      1,
    );
    assert.throws(
      () => f.service.save("boards", f.draft, f.board.id, 1),
      /版本/,
    );
    assert.throws(
      () =>
        f.service.save(
          "boards",
          {
            ...updated,
            stages: updated.stages.map((s: any) =>
              s.id === f.done
                ? { ...s, id: randomUUID() }
                : { ...s, targets: [] },
            ),
          },
          updated.id,
          updated.version,
        ),
      /固定完成终点/,
    );
  } finally {
    f.close();
  }
});

test("事务中途失败回滚流程、交接与缺失标记", () => {
  const f = fixture();
  try {
    const item = f.service.createItem({ boardId: f.board.id, title: "归档" });
    f.service.archiveItem(item.id, true);
    const record = f.store.put("handoffs", {
      itemId: item.id,
      from: f.removed,
      to: f.done,
    });
    const preview = f.service.previewBoardFlow(f.board.id, f.draft, 1);
    const put = f.store.put.bind(f.store);
    f.store.put = (kind, ...args) => {
      if (kind === "boards") throw new Error("模拟写入失败");
      return put(kind, ...args);
    };
    assert.throws(
      () =>
        f.service.save(
          "boards",
          { ...f.draft, confirmationToken: preview.confirmationToken },
          f.board.id,
          1,
        ),
      /模拟/,
    );
    assert.equal(f.store.get("boards", f.board.id).version, 1);
    assert.equal(f.store.get("handoffs", record.id).id, record.id);
    assert.equal(f.store.get("items", item.id).historyIncomplete, undefined);
  } finally {
    f.close();
  }
});

/** HTTP 入口与工具参数都复用同一业务规则，认证及同源校验保持生效。 */
test("HTTP 准入、预评估、保存以及工具确认字段", async () => {
  const f = fixture();
  const origin = "http://localhost:3180";
  const dir = mkdtempSync(join(tmpdir(), "board-flow-http-"));
  const { app, store } = await createApp({
    dataDir: dir,
    publicUrl: origin,
    secureCookie: false,
  });
  try {
    for (const kind of ["projects", "boards"])
      for (const entity of f.store.list(kind))
        store.put(kind, entity, entity.id);
    const url = `/api/boards/${f.board.id}`;
    assert.equal((await app.inject(url + "/editability")).statusCode, 401);
    const raw = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(raw), "owner", Date.now() + 60000);
    const headers = { cookie: `relay_session=${raw}`, origin };
    assert.equal(
      (await app.inject({ url: url + "/editability", headers })).json()
        .editable,
      true,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: url + "/flow-preview",
          headers: { ...headers, origin: "https://invalid.example" },
          payload: { version: 1, board: f.draft },
        })
      ).statusCode,
      403,
    );
    const preview = await app.inject({
      method: "POST",
      url: url + "/flow-preview",
      headers,
      payload: { version: 1, board: f.draft },
    });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().handoffCount, 0);
    const parsed = parseBoardWrite({
      action: "update",
      id: f.board.id,
      version: 1,
      board: f.draft,
      confirmationToken: preview.json().confirmationToken,
      operationId: randomUUID(),
    });
    assert.equal(parsed.action, "update");
    const result = await app.inject({
      method: "PUT",
      url,
      headers,
      payload: {
        ...f.draft,
        version: 1,
        confirmationToken: preview.json().confirmationToken,
      },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().stages.length, 2);
  } finally {
    await app.close();
    f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("删除下游阶段保留替代路径，预览计入在途工作项的历史", () => {
  const f = fixture();
  try {
    const item = f.service.createItem({ boardId: f.board.id, title: "修订" });
    const review = { ...f.board.stages[1], shortId: undefined, id: randomUUID(), name: "复核" };
    const [start, old, done] = f.board.stages;
    // 先让卡片离开起点，再修改空起点的出口。
    f.service.advance(item.id, old.id, "处理", randomUUID());
    const board = f.service.save("boards", {
      ...f.board, stages: [{ ...start, targets: [done.id, review.id] }, { ...old, targets: [done.id, start.id] }, review, done],
    }, f.board.id, f.board.version);
    f.service.advance(item.id, start.id, "返回", randomUUID());
    const draft = { ...board, stages: board.stages.filter((s: any) => s.id !== old.id) };
    const preview = f.service.previewBoardFlow(board.id, draft, board.version);
    assert.equal(preview.affectedItemCount, 1);
    assert.equal(preview.handoffCount, 2);
    f.service.save("boards", { ...draft, confirmationToken: preview.confirmationToken }, board.id, board.version);
    assert.equal(f.store.get("items", item.id).historyIncomplete, true);
  } finally {
    f.close();
  }
});
