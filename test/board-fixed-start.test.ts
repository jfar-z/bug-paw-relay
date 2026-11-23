import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { Vault } from "../src/server/security.js";
import { errorBody } from "../src/shared/i18n-errors.js";
import { boardSchema, stageSchema } from "../src/shared/contracts.js";
import { defaultBoardStages, stageName } from "../src/shared/board-stages.js";
import { parseBoardWrite, boardToolError } from "../src/server/board-tool.js";

/** 临时数据库只保存合成业务数据，不接触现场库。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fixed-start-"));
  const path = join(dir, "test.db");
  const store = new Store(path);
  const service = new Service(store, new Vault(dir));
  const environment = store.put("environments", { approved: true });
  const directory = {
    environmentId: environment.id,
    rootId: "root",
    relativePath: ".",
  };
  const project = service.save("projects", {
    name: "test",
    directories: [directory],
  });
  const stages = defaultBoardStages(randomUUID(), randomUUID());
  const board = service.save("boards", {
    name: "test",
    projectId: project.id,
    stages,
  });
  return {
    dir,
    path,
    store,
    service,
    board,
    project,
    directory,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("固定起点与终点可改名，副本保留角色、名称与路径，默认创建不执行", () => {
  const f = fixture();
  try {
    assert.equal(stageName(f.board.stages[0], "zh-CN"), "未开始");
    assert.equal(stageName(f.board.stages[0], "en"), "Not started");
    assert.equal(stageName(f.board.stages[1], "zh-CN"), "已完成");
    assert.equal(stageName(f.board.stages[1], "en"), "Done");
    const renamed = f.service.save(
      "boards",
      {
        ...f.board,
        stages: f.board.stages.map(({ nameKey, ...s }: any) => ({
          ...s,
          name: "用户名称",
        })),
      },
      f.board.id,
      f.board.version,
    );
    const copy = f.service.copyBoard(renamed.id);
    assert.equal(
      copy.stages.filter((s: any) => s.fixedRole === "start").length,
      1,
    );
    assert.equal(copy.stages[0].name, "用户名称");
    assert.equal(stageName(copy.stages[0], "en"), "用户名称");
    assert.deepEqual(copy.stages[0].targets, [copy.stages[1].id]);
    const item = f.service.createItem({
      boardId: renamed.id,
      title: "test",
      operationId: randomUUID(),
    });
    assert.equal(item.stageId, renamed.stages[0].id);
    assert.equal(item.status, "human");
    assert.equal(f.store.list("sessions").length, 0);
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM executions").get()!.n,
      0,
    );
    assert.equal(f.service.boardEditability(renamed.id).editable, true);
    assert.throws(
      () => f.service.remove("boards", renamed.id),
      (e: any) => e.code === "REFERENCED",
    );
    const completed = f.service.createItem({
      boardId: renamed.id,
      title: "done",
      startStageId: renamed.stages[1].id,
    });
    assert.equal(completed.status, "done");
  } finally {
    f.close();
  }
});

test("直接写入与工具共用固定身份保护，失败不部分保存", () => {
  const f = fixture();
  try {
    const [start, done] = f.board.stages;
    const invalid = [
      [done],
      [done, start],
      [{ ...start, type: "agent", ...f.directory }, done],
      [{ ...start, fixedRole: undefined }, done],
      [start, { ...done, fixedRole: "start" }],
      [{ ...start, targets: [start.id] }, done],
      [{ ...start, targets: [randomUUID()] }, done],
      [start, { ...done, targets: [start.id] }],
    ];
    for (const stages of invalid) {
      const draft = { ...f.board, stages };
      assert.throws(() =>
        parseBoardWrite({
          action: "update",
          id: f.board.id,
          version: 1,
          board: draft,
        }),
      );
      assert.throws(() => f.service.save("boards", draft, f.board.id, 1));
      const parsed = boardSchema.safeParse(draft);
      assert.equal(parsed.success, false);
      if (!parsed.success) {
        assert.match(boardToolError(parsed.error), /messageKey/);
        assert.ok(
          errorBody(parsed.error, "en").issues?.every(
            (issue) => !/[\u4e00-\u9fff]/.test(issue.message),
          ),
        );
      }
      assert.deepEqual(f.store.get("boards", f.board.id), f.board);
    }
    const replaced = {
      ...f.board,
      stages: [{ ...start, id: randomUUID() }, done],
    };
    for (const action of ["save", "preview"]) {
      assert.throws(
        () =>
          action === "save"
            ? f.service.save("boards", replaced, f.board.id, 1)
            : f.service.previewBoardFlow(f.board.id, replaced, 1),
        (e: any) => {
          assert.equal(e.code, "START_IMMUTABLE");
          assert.match(boardToolError(e), /START_IMMUTABLE/);
          return true;
        },
      );
    }
    assert.deepEqual(f.store.get("boards", f.board.id), f.board);
    assert.throws(() =>
      boardSchema.parse({
        ...f.board,
        stages: [{ ...start, name: "用户名称" }, done],
      }),
    );
  } finally {
    f.close();
  }
});

test("固定起点支持零或多个目标；人工、Agent、完成出口和显式起点沿用调度", () => {
  const f = fixture();
  try {
    const [start, done] = f.board.stages;
    const human = {
      id: randomUUID(),
      name: "human",
      type: "human",
      targets: [start.id],
    };
    const agent = {
      id: randomUUID(),
      name: "agent",
      type: "agent",
      agentId: f.service.save("agents", { name: "执行智能体" }).id,
      targets: [done.id],
      ...f.directory,
    };
    let board = f.service.save(
      "boards",
      { ...f.board, stages: [{ ...start, targets: [] }, human, agent, done] },
      f.board.id,
      1,
    );
    let item = f.service.createItem({ boardId: board.id, title: "empty" });
    assert.throws(
      () =>
        f.service.advance(
          item.id,
          done.id,
          "",
          randomUUID(),
          undefined,
          [],
          undefined,
          false,
          { stageId: item.stageId, version: item.version },
        ),
      (e: any) => e.code === "INVALID_TRANSITION",
    );
    f.service.archiveItem(item.id, true);
    board = f.service.save(
      "boards",
      {
        ...board,
        stages: board.stages.map((s: any) =>
          s.fixedRole ? { ...s, targets: [human.id, agent.id, done.id] } : s,
        ),
      },
      board.id,
      board.version,
    );
    for (const [target, status] of [
      [human.id, "human"],
      [agent.id, "queued"],
      [done.id, "done"],
    ]) {
      item = f.service.createItem({ boardId: board.id, title: "test" });
      const op = randomUUID();
      const moved = f.service.advance(
        item.id,
        target,
        "",
        op,
        undefined,
        [],
        undefined,
        false,
        { stageId: item.stageId, version: item.version },
      );
      assert.equal(moved.status, status);
      assert.deepEqual(
        f.service.advance(
          item.id,
          target,
          "",
          op,
          undefined,
          [],
          undefined,
          false,
          { stageId: item.stageId, version: item.version },
        ),
        moved,
      );
    }
    const explicit = f.service.createItem({
      boardId: board.id,
      title: "explicit",
      startStageId: agent.id,
      boardVersion: board.version,
    });
    assert.equal(explicit.status, "queued");
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM executions").get()!.n,
      2,
    );
  } finally {
    f.close();
  }
});

test("schema 2 升级保留满 30 阶段、同名节点、在途和历史，重启不重复迁移", () => {
  const f = fixture();
  const { dir, path } = f;
  try {
    // 模拟真实旧格式：满额、编号高水位曾删除、首位 Agent 及自定义终点。
    const stages = Array.from({ length: 30 }, (_, i) =>
      stageSchema.parse({
        id: randomUUID(),
        shortId: `S${i + 1}`,
        name: i === 29 ? "结束（自定义）" : "未开始",
        type: i === 29 ? "done" : i === 0 ? "agent" : "human",
        targets: [],
        ...f.directory,
      }),
    );
    stages[0].agentId = f.service.save("agents", { name: "迁移测试智能体" }).id;
    stages[0].targets = [stages[29].id];
    const legacy = f.store.put(
      "boards",
      { stages, stageShortIdHighWater: 40 },
      f.board.id,
    );
    const doneOnly = f.store.put("boards", {
      projectId: f.project.id,
      name: "done only",
      stages: [stages[29]],
      stageShortIdHighWater: 30,
      archived: true,
    });
    const items = ["running", "done", "human"].map((status, i) =>
      f.store.put("items", {
        boardId: legacy.id,
        stageId: stages[i === 1 ? 29 : 0].id,
        status,
        archived: i === 2,
      }),
    );
    const snapshot = JSON.stringify({
      stage: stages[0],
      allowedTargets: [stages[29]],
    });
    f.store.db
      .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        items[0].id,
        randomUUID(),
        f.directory.environmentId,
        "running",
        snapshot,
        "2026-01-01",
      );
    const handoff = f.store.put("handoffs", {
      itemId: items[0].id,
      from: stages[0].id,
      to: stages[29].id,
      record: "history",
      artifacts: [{ id: randomUUID() }],
    });
    const execs = f.store.db.prepare("SELECT * FROM executions").all();
    f.store.db.exec("PRAGMA user_version=2");
    f.store.close();
    let upgraded = new Store(path);
    const board = upgraded.get("boards", legacy.id);
    const upgradedDoneOnly = upgraded.get("boards", doneOnly.id);
    assert.equal(upgradedDoneOnly.archived, true);
    assert.deepEqual(upgradedDoneOnly.stages[0].targets, [stages[29].id]);
    assert.deepEqual(upgradedDoneOnly.stages[1], stages[29]);
    assert.equal(board.version, legacy.version + 1);
    assert.equal(board.stages.length, 31);
    assert.deepEqual(board.stages.slice(1), stages);
    assert.equal(board.stages[0].fixedRole, "start");
    assert.equal(board.stages[0].shortId, "S41");
    assert.deepEqual(board.stages[0].targets, [stages[0].id]);
    assert.equal(board.stageShortIdHighWater, 41);
    assert.ok(boardSchema.safeParse(board).success);
    assert.deepEqual(upgraded.list("items"), items);
    assert.deepEqual(upgraded.list("handoffs"), [handoff]);
    assert.deepEqual(
      upgraded.db.prepare("SELECT * FROM executions").all(),
      execs,
    );
    assert.equal(
      upgraded.db.prepare("PRAGMA user_version").get()!.user_version,
      3,
    );
    const copy = new Service(upgraded, new Vault(dir)).copyBoard(board.id);
    assert.equal(copy.stages.length, 31);
    assert.equal(copy.stages[0].shortId, "S41");
    upgraded.close();
    upgraded = new Store(path);
    assert.deepEqual(upgraded.get("boards", board.id), board);
    upgraded.close();
    assert.throws(() => new Store(path, true, 2), /禁止降级/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("迁移任一看板失败时整体回滚，连接器数据库不迁移", () => {
  const dir = mkdtempSync(join(tmpdir(), "fixed-start-rollback-"));
  const path = join(dir, "test.db");
  try {
    const legacy = new Store(path, true, 2);
    const stages = [
      {
        id: randomUUID(),
        shortId: "S1",
        name: "旧终点",
        type: "done",
        targets: [],
      },
    ];
    const first = legacy.put("boards", { stages, stageShortIdHighWater: 1 });
    legacy.put("boards", { stages: [{ ...stages[0], shortId: "invalid" }] });
    legacy.close();
    assert.throws(() => new Store(path));
    const verify = new Store(path, true, 2);
    assert.deepEqual(verify.get("boards", first.id), first);
    assert.equal(
      verify.db.prepare("PRAGMA user_version").get()!.user_version,
      2,
    );
    verify.close();
    const local = new Store(path, false, 2);
    assert.deepEqual(local.get("boards", first.id), first);
    local.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
