import test from "node:test";
import assert from "node:assert/strict";
import { ConnectorStore } from "../src/connector/store.js";
import { Engine } from "../src/connector/engine.js";
import {
  currentUpdateCompatibility,
  updateCompatibilityReason,
} from "../src/shared/connector-update.js";

/** 大历史夹具禁止状态路径读取事件，记录真实查询耗时。 */
test("八万条约五十 MiB 历史不进入健康、防重及状态查询", async (t) => {
  const store = new ConnectorStore(":memory:");
  try {
    store.transaction(() => {
      const insert = store.db.prepare("INSERT INTO local_events VALUES(?,?,?)");
      for (let i = 0; i < 80; i++) {
        store.put(
          "localExecutions",
          {
            sessionId: `s${i}`,
            operationId: `o${i}`,
            status: "completed",
            sequence: 1000,
            reply: "final",
            events: [],
          },
          `e${i}`,
        );
        for (let n = 1; n <= 1000; n++)
          insert.run(
            `e${i}`,
            n,
            JSON.stringify({
              sequence: n,
              type: "delta",
              data: { text: "x".repeat(620) },
            }),
          );
      }
    });
    const bytes = Number(
      store.db.prepare("SELECT SUM(bytes) AS n FROM event_cache_sizes").get()!
        .n,
    );
    assert.ok(bytes > 50 * 1024 * 1024);
    store.executionEvents = () => {
      throw new Error("状态查询不得读取事件");
    };
    const engine = new Engine(
      store,
      () => ({ roots: [] }),
      () => {},
      async () => {},
    );
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      assert.equal(engine.busyForUpdate(), false);
      assert.equal(
        (await engine.call("execution.status", { executionId: "e1" })).status,
        "completed",
      );
      assert.equal(
        (await engine.call("execution.result", { executionId: "e1" })).reply,
        "final",
      );
      assert.equal(
        store.findBy("localExecutions", "operationId", "o1").length,
        1,
      );
    }
    t.diagnostic(
      JSON.stringify({
        events: 80000,
        bytes,
        queries: 400,
        elapsedMs: performance.now() - start,
      }),
    );
    engine.close();
  } finally {
    store.close();
  }
});

/** 淘汰只影响缓存，必要结果与防重身份必须独立持久保留。 */
test("条数、字节、全局预算和过期清理保留业务事实", () => {
  const store = new ConnectorStore(":memory:");
  try {
    store.put(
      "localExecutions",
      { status: "running", operationId: "stable", sequence: 0, events: [] },
      "e",
    );
    for (let n = 1; n <= 1100; n++)
      store.put(
        "localExecutions",
        {
          sequence: n,
          events: [
            { sequence: n, type: "delta", data: { text: "x".repeat(9000) } },
          ],
        },
        "e",
      );
    const size = store.db
      .prepare("SELECT * FROM event_cache_sizes WHERE execution_id='e'")
      .get()!;
    assert.ok(Number(size.bytes) <= 8 * 1024 * 1024);
    assert.ok(Number(size.count) <= 1000);
    store.put(
      "localExecutions",
      {
        status: "completed",
        sequence: 1102,
        events: [
          { sequence: 1101, type: "runtime/config", data: { model: "test" } },
          { sequence: 1102, type: "result", data: { result: "final" } },
        ],
      },
      "e",
    );
    while (store.maintainEvents(Date.now() + 2 * 86400000)) {}
    assert.deepEqual(store.executionEvents("e"), []);
    const entity = store.get("localExecutions", "e");
    assert.equal(entity.reply, "final");
    assert.deepEqual(entity.runtimeConfig, { model: "test" });
    assert.equal(entity.operationId, "stable");
    assert.equal(entity.gap, true);
    for (let i = 0; i < 20; i++)
      store.put(
        "localExecutions",
        {
          status: "completed",
          sequence: 1,
          events: [
            {
              sequence: 1,
              type: "result",
              data: { result: "x".repeat(4 * 1024 * 1024) },
            },
          ],
        },
        `g${i}`,
      );
    assert.ok(
      Number(
        store.db.prepare("SELECT SUM(bytes) AS n FROM event_cache_sizes").get()!
          .n,
      ) <=
        64 * 1024 * 1024,
    );
    assert.equal(
      store.get("localExecutions", "g19").reply.length,
      4 * 1024 * 1024,
    );
    assert.equal(store.get("localExecutions", "g19").gap, true);
  } finally {
    store.close();
  }
});

test("薄更新不要求回滚承诺且拒绝旧节点及不兼容契约", () => {
  const current = {
    updateProtocol: 3,
    dataFormat: 2,
    compatibility: currentUpdateCompatibility,
  };
  const target = { ...current, rollbackCompatible: false };
  assert.equal(updateCompatibilityReason(current, target), null);
  assert.equal(
    updateCompatibilityReason({ ...current, updateProtocol: 2 }, target),
    "BOOTSTRAP_REQUIRED",
  );
  assert.equal(
    updateCompatibilityReason(current, { ...target, updateProtocol: 2 }),
    "UPDATE_PROTOCOL_UNSUPPORTED",
  );
  assert.equal(
    updateCompatibilityReason(current, {
      ...target,
      compatibility: {
        ...currentUpdateCompatibility,
        ledger: { format: 2, contract: "different" },
      },
    }),
    "DATA_FORMAT_INCOMPATIBLE",
  );
});

/** 维护中断和业务写入使用相同事务边界，不能留下半清理的必要事实。 */
test("缓存清理写失败回滚，未知执行不因本机健康而放行", () => {
  const store = new ConnectorStore(":memory:");
  try {
    store.put(
      "localExecutions",
      {
        status: "completed",
        sequence: 1,
        events: [
          { sequence: 1, type: "runtime/config", data: { model: "test" } },
        ],
      },
      "e",
    );
    store.db.exec(
      `CREATE TRIGGER fail_cleanup BEFORE UPDATE ON entities WHEN NEW.id='e' BEGIN SELECT RAISE(ABORT,'injected'); END`,
    );
    assert.throws(() => store.maintainEvents(Date.now() + 2 * 86400000));
    assert.equal(store.executionEvents("e").length, 1);
    store.db.exec("DROP TRIGGER fail_cleanup");
    store.put(
      "localExecutions",
      { status: "unknown", sequence: 0, events: [] },
      "unknown",
    );
    const engine = new Engine(
      store,
      () => ({ roots: [] }),
      () => {},
      async () => {},
    );
    assert.equal(engine.locallyHealthy(), true);
    assert.equal(engine.busyForUpdate(), true);
    engine.close();
  } finally {
    store.close();
  }
});
