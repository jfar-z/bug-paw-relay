import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/store.js";
import { ConnectorStore } from "../src/connector/store.js";
import { Engine } from "../src/connector/engine.js";
import { ConnectorConfig } from "../src/connector/config.js";
import { EngineClient } from "../src/connector/engine-client.js";
import {
  closeCategory,
  ConnectionDiagnostics,
} from "../src/shared/connection-diagnostics.js";

/** 磁盘 SQLite 夹具，通知时直接复核持久化边界。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "relay-batch-"));
  const store = new ConnectorStore(join(dir, "environment.db"));
  const seen: any[] = [];
  const engine = new Engine(
    store,
    () => ({ roots: [] }),
    (_m, p) => {
      const saved = store.get("localExecutions", p.executionId);
      if (p.event) assert.ok(saved.sequence >= p.event.sequence);
      seen.push(p);
    },
    async () => ({}),
  );
  for (const id of ["one", "two"]) {
    store.put("localSessions", { runtime: "claude" }, "s-" + id);
    store.put(
      "localExecutions",
      {
        sessionId: "s-" + id,
        status: "running",
        events: [],
        sequence: 0,
        interactions: [],
        stateVersion: 1,
      },
      id,
    );
  }
  return {
    dir,
    store,
    engine,
    seen,
    enqueue(id: string, type: string, data: any) {
      (engine as any).enqueueEvent(id, "s-" + id, type, data);
    },
    close() {
      try {
        engine.close();
      } catch {}
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("自动批准按原生调用编号落账，缓存淘汰、重复答复与失败均不增加批准次数", async () => {
  const f = fixture();
  try {
    const ids = ["first", "second", "again", "manual", "failed", "legacy"];
    const items = ids.map((id, index) => ({
      id, nativeId: "rpc-" + id, method: "item/commandExecution/requestApproval",
      params: id === "legacy" ? {} : { itemId: index === 1 ? "tool-b" : "tool-a", turnId: "turn" },
      approval: { kind: "permission", answer: { decision: "accept" } },
    }));
    f.store.put("localExecutions", { interactions: items }, "one");
    for (const { id } of items)
      (f.engine as any).answers.set(id, async () => {
        if (id === "failed") throw new Error("delivery failed");
      });
    const answer = (id: string) => f.engine.call("interaction.answer", {
      executionId: "one", interactionId: id, answer: { decision: "accept" },
      ...(id === "manual" ? {} : { decisionSource: "policy" }),
    });
    for (const id of ["second", "first", "again", "manual", "legacy"]) await answer(id);
    await assert.rejects(answer("failed"), /delivery failed/);
    await assert.rejects(answer("first"), (error: any) => error.code === "STALE_INTERACTION");
    const live = f.seen.map(update => update.event).filter(event => event?.type === "relay/approval/auto");
    assert.deepEqual(live.map(e => [e.data.interactionId, e.data.itemId]), [
      ["second", "tool-b"], ["first", "tool-a"], ["again", "tool-a"], ["legacy", undefined],
    ]);
    for (let i = 0; i < 1000; i++) f.enqueue("one", "delta", {});
    const history = await f.engine.call("session.history", { sessionId: "s-one" });
    assert.ok(history.events.every((event: any) => event.type !== "relay/approval/auto"));
    assert.deepEqual(history.autoApprovalEvents, live);
    assert.deepEqual((await f.engine.call("session.history", { sessionId: "s-two" })).autoApprovalEvents, []);
  } finally {
    f.close();
  }
});

test("批次减少写入，提交后按序通知，保留窗口和最终回复一致", async () => {
  const f = fixture();
  try {
    let writes = 0;
    const put = f.store.put.bind(f.store);
    f.store.put = (...args) => {
      writes++;
      return put(...args);
    };
    for (let i = 0; i < 1200; i++)
      f.enqueue("one", "delta", { text: "字 ".repeat(256) });
    f.enqueue("two", "result", { result: "隔离回复" });
    f.enqueue("one", "item/completed", {
      item: { type: "agentMessage", text: "最终回复" },
    });
    (f.engine as any).state("one", "completed");
    assert.equal(writes, 3);
    const result = await f.engine.call("execution.result", {
      executionId: "one",
    });
    assert.equal(result.reply, "最终回复");
    assert.equal(result.status, "completed");
    const saved = f.store.get("localExecutions", "one");
    assert.equal(f.store.executionEvents(saved.id).length, 1000);
    assert.equal(saved.gap, true);
    assert.deepEqual(
      f.store.executionEvents(saved.id).map((e: any) => e.sequence),
      Array.from({ length: 1000 }, (_, i) => 202 + i),
    );
    assert.equal(
      (await f.engine.call("execution.result", { executionId: "two" })).reply,
      "隔离回复",
    );
    assert.equal(
      f.seen.filter((e) => e.event && e.executionId === "one").length,
      1201,
    );
  } finally {
    f.close();
  }
});

test("固定窗口持续来流不延长，查询屏障提交尾批", async () => {
  const f = fixture();
  try {
    f.enqueue("one", "delta", { text: "a" });
    await new Promise((r) => setTimeout(r, 60));
    f.enqueue("one", "delta", { text: "b" });
    await new Promise((r) => setTimeout(r, 65));
    assert.equal(f.store.get("localExecutions", "one").sequence, 2);
    f.enqueue("one", "result", { result: "尾批" });
    assert.equal(
      (await f.engine.call("execution.result", { executionId: "one" })).reply,
      "尾批",
    );
  } finally {
    f.close();
  }
});

test("事务失败不通知、不丢已提交事件、停止运行时且拒绝新工作", async () => {
  const f = fixture();
  try {
    f.enqueue("one", "delta", { text: "已提交" });
    f.engine.flushEvents();
    let stopped = false;
    (f.engine as any).handles.set("one", {
      close() {
        stopped = true;
      },
    });
    f.enqueue("one", "result", { result: "不能发布" });
    f.store.db.exec("PRAGMA query_only=ON");
    assert.throws(() => f.engine.flushEvents(), /存储不可用/);
    assert.equal(stopped, true);
    assert.equal(f.seen.length, 1);
    assert.equal(f.store.get("localExecutions", "one").sequence, 1);
    await assert.rejects(
      f.engine.call("execution.start", {}),
      (e: any) => e.code === "STORAGE_UNAVAILABLE",
    );
    assert.throws(() => f.engine.close(), AggregateError);
  } finally {
    f.close();
  }
});

test("忙锁超时保持原记录，超大事件显式失败，不无限排队", () => {
  const f = fixture();
  const lock = new ConnectorStore(join(f.dir, "environment.db"));
  try {
    f.store.db.exec("PRAGMA busy_timeout=20");
    lock.db.exec("BEGIN IMMEDIATE");
    f.enqueue("one", "delta", { text: "pending" });
    assert.throws(() => f.engine.flushEvents(), /存储不可用/);
    assert.equal(f.store.get("localExecutions", "one").sequence, 0);
    assert.equal(f.seen.length, 0);
  } finally {
    lock.db.exec("ROLLBACK");
    lock.close();
    f.close();
  }
  const g = fixture();
  try {
    g.enqueue("one", "delta", {
      blocks: Array.from({ length: 2000 }, () => "字 ".repeat(2000)),
    });
    assert.equal((g.engine as any).pendingEvents.size, 0);
    assert.throws(() => g.engine.flushEvents(), /存储不可用/);
  } finally {
    g.close();
  }
});

test("正常关闭先终止全部句柄，再提交尾批，新版账本可再次读取", () => {
  const f = fixture();
  try {
    const closed: string[] = [];
    for (const id of ["one", "two"])
      (f.engine as any).handles.set(id, {
        close() {
          closed.push(id);
        },
      });
    f.enqueue("one", "result", { result: "shutdown" });
    f.engine.close();
    assert.deepEqual(closed, ["one", "two"]);
    const reader = new ConnectorStore(join(f.dir, "environment.db"));
    assert.equal(reader.get("localExecutions", "one").reply, "shutdown");
    assert.equal(reader.get("localExecutions", "one").status, "cancelled");
    reader.close();
  } finally {
    f.close();
  }
});

test("执行线程实时核对升级资格，普通请求失败不会遗留忙碌标记", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-thread-"));
  const config = new ConnectorConfig(dir);
  config.save({
    name: "test",
    serverUrl: "http://localhost",
    roots: [{ id: "root", path: dir }],
  });
  const client = new EngineClient(
    dir,
    () => {},
    async () => ({}),
    () => {},
  );
  try {
    assert.deepEqual(
      await client.call("execution.status", { executionId: "absent" }),
      { status: "not_found", stateVersion: 0 },
    );
    await assert.rejects(client.call("missing.method", {}), {
      code: "METHOD_NOT_FOUND",
    });
    assert.equal(await client.busyForUpdate(), false);

    const transfer = await client.call("files.push.begin", {
      destination: { kind: "board-attachments", rootId: "root", relativePath: "." },
      files: [{ name: "example.txt", size: 4 }],
    });
    assert.equal(await client.busyForUpdate(), true);
    await client.call("files.push.cancel", { id: transfer.id });
    assert.equal(await client.busyForUpdate(), false);

    // 直接改变账本，不发状态通知；两次探测都必须反映当前执行事实。
    const ledger = new ConnectorStore(join(dir, "environment.db"));
    try {
      ledger.put("localExecutions", { status: "running" }, "task");
      assert.equal(await client.busyForUpdate(), true);
      ledger.put("localExecutions", { status: "completed" }, "task");
      assert.equal(await client.busyForUpdate(), false);
    } finally {
      ledger.close();
    }
    await client.close();
    await assert.rejects(client.busyForUpdate(), { code: "ENGINE_UNAVAILABLE" });
  } finally {
    await (client as any).worker.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("连接诊断只保留安全关闭分类，RTT 必须关联 payload", () => {
  assert.equal(closeCategory(1006, "Bearer secret"), "abnormal_close");
  const records: any[] = [];
  const d = new ConnectionDiagnostics((event, fields) =>
    records.push({ event, fields }),
  );
  try {
    d.ping();
    d.pong("unknown");
    assert.equal(d.snapshot().rttMs, null);
    const payload = d.ping();
    d.pong(payload);
    assert.ok(d.snapshot().rttMs! >= 0);
    d.warn("delay", {});
    d.warn("delay", {});
    assert.equal(records.length, 1);
  } finally {
    d.close();
  }
});

test("4 MiB 以上合法单事件直接提交，不进入待写队列", () => {
  const f = fixture();
  try {
    f.enqueue("one", "tool", {
      blocks: Array.from({ length: 1600 }, () => "字 ".repeat(1000)),
    });
    assert.equal((f.engine as any).pendingEvents.size, 0);
    assert.equal(f.store.get("localExecutions", "one").sequence, 1);
    assert.equal(f.seen.length, 1);
  } finally {
    f.close();
  }
});

test("存储错误双语与稳定资源键完整，不携带原始错误参数", async () => {
  const { connectorStorageZh, connectorStorageEn, connectorStorageDetails } =
    await import("../src/shared/connector-storage-errors.js");
  assert.deepEqual(
    Object.keys(connectorStorageZh),
    Object.keys(connectorStorageEn),
  );
  for (const code of Object.keys(connectorStorageZh)) {
    assert.deepEqual(connectorStorageDetails(code), {
      messageKey: `connector.storage.${code}`,
      messageParams: {},
    });
    assert.ok(
      !/[\u4e00-\u9fff]/.test(
        connectorStorageEn[code as keyof typeof connectorStorageEn],
      ),
    );
  }
  assert.deepEqual(connectorStorageDetails("untrusted"), {});
});

test("诊断异步轮转保持五份文件，写失败不向业务抛错", async () => {
  const { writeFileSync, readdirSync, statSync } = await import("node:fs");
  const { ConnectorDiagnostics } =
    await import("../src/connector/diagnostics.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-diag-"));
  try {
    const file = join(dir, "connection-diagnostics.log");
    for (let i = 0; i < 5; i++)
      writeFileSync(file + (i ? "." + i : ""), Buffer.alloc(10 * 1024 * 1024));
    const logger = new ConnectorDiagnostics(dir, { instanceId: "fixture" });
    logger.write("connection.close", { reason: "normal_close" });
    const deadline = Date.now() + 5000;
    while ((logger as any).writing && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(readdirSync(dir).length, 5);
    assert.ok(statSync(file).size < 1024);
    // Windows 通过 ACL 控制访问，POSIX 平台还应验证创建模式。
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    const failed = new ConnectorDiagnostics(join(dir, "absent"), {});
    assert.doesNotThrow(() => failed.write("connection.close", {}));
    while ((failed as any).writing) await new Promise((r) => setTimeout(r, 10));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("更新忙碌检查不加载历史正文，并持续识别活动和未知执行", () => {
  const f = fixture();
  try {
    // 正文读取一旦回归就失败，避免用依赖机器性能的毫秒断言代替访问边界。
    f.store.list = () => {
      throw new Error("健康检查不得加载历史事件");
    };
    for (const status of [
      "starting",
      "running",
      "waiting",
      "stopping",
      "unknown",
    ]) {
      f.store.put("localExecutions", { status }, "one");
      f.store.put("localExecutions", { status: "completed" }, "two");
      assert.equal(f.engine.busyForUpdate(), true, status);
    }
    for (const status of ["completed", "cancelled", "failed"]) {
      f.store.put("localExecutions", { status }, "one");
      assert.equal(f.engine.busyForUpdate(), false, status);
    }
    // 尚未持久化的启动和执行请求仍守住更新门闩。
    (f.engine as any).inFlight = 1;
    assert.equal(f.engine.busyForUpdate(), true);
    (f.engine as any).inFlight = 0;
    f.engine.storageFault();
    assert.equal(f.engine.busyForUpdate(), true);
  } finally {
    f.close();
  }
});
