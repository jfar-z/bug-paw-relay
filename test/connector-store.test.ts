import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/store.js";
import { ConnectorStore } from "../src/connector/store.js";
/** 当前账本直接初始化，重开不扫描改写业务记录，事实独立于缓存。 */
test("当前账本重开保留事实且不改写实体", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-store-current-"));
  const path = join(dir, "environment.db");
  let store = new ConnectorStore(path);
  try {
    store.put(
      "localExecutions",
      {
        operationId: "operation",
        status: "completed",
        sequence: 2,
        events: [
          { sequence: 1, type: "runtime/config", data: { model: "test" } },
          { sequence: 2, type: "result", data: { result: "回复" } },
        ],
      },
      "execution",
    );
    const before = store.get("localExecutions", "execution");
    store.db
      .exec(`CREATE TRIGGER reject_startup_rewrite BEFORE UPDATE ON entities
      BEGIN SELECT RAISE(ABORT,'unexpected rewrite'); END`);
    store.close();
    store = new ConnectorStore(path);
    assert.deepEqual(store.get("localExecutions", "execution"), before);
    store.db.exec("DROP TRIGGER reject_startup_rewrite");
    store.maintainEvents(Date.now() + 172800000);
    assert.deepEqual(store.executionEvents("execution"), []);
    assert.deepEqual(store.executionRuntimeConfig("execution"), {
      model: "test",
    });
    assert.equal(store.get("localExecutions", "execution").reply, "回复");
    assert.equal(store.get("localExecutions", "execution").gap, true);
    assert.equal(
      store.get("localExecutions", "execution").updatedAt,
      before.updatedAt,
    );
    assert.equal(
      (store.db.prepare("PRAGMA user_version").get() as any).user_version,
      2,
    );
    assert.throws(() => new Store(path, false), /禁止降级/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("事件写入与元数据失败共同回滚，不遗留已发布序号", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-store-rollback-"));
  const store = new ConnectorStore(join(dir, "environment.db"));
  try {
    store.put(
      "localExecutions",
      { sequence: 0, events: [], status: "running" },
      "execution",
    );
    store.db.exec(`CREATE TRIGGER fail_metadata BEFORE UPDATE ON entities
      WHEN NEW.kind='localExecutions' BEGIN SELECT RAISE(ABORT,'injected'); END`);
    assert.throws(() =>
      store.put(
        "localExecutions",
        {
          sequence: 1,
          events: [{ sequence: 1, type: "delta", data: {} }],
        },
        "execution",
      ),
    );
    assert.equal(store.get("localExecutions", "execution").sequence, 0);
    assert.deepEqual(store.executionEvents("execution"), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 强杀隔离子进程，确认已提交事件保留、未提交事务回滚且防重键不丢失。 */
test("进程强杀后 v2 账本保留提交边界", { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-store-kill-"));
  const path = join(dir, "environment.db");
  const script = `
    import { ConnectorStore } from './src/connector/store.ts';
    const store = new ConnectorStore(process.argv[1]);
    store.put('localExecutions', { operationId: 'operation', status: 'running', sequence: 1, events: [{sequence:1,type:'delta',data:{text:'committed'}}]}, 'execution');
    store.transaction(() => {
      const row = store.get('localExecutions', 'execution');
      store.put('localExecutions', {sequence:2, events:[...row.events,{sequence:2,type:'delta',data:{text:'uncommitted'}}]}, 'execution');
      process.stdout.write('ready');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
    });
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script, path],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const exited = once(child, "exit");
  try {
    await Promise.race([
      once(child.stdout!, "data"),
      exited.then(() => {
        throw new Error("子进程提前退出");
      }),
    ]);
    child.kill("SIGKILL");
    await exited;
    const reader = new ConnectorStore(path);
    try {
      const row = reader.get("localExecutions", "execution");
      assert.equal(row.operationId, "operation");
      assert.equal(row.sequence, 1);
      assert.deepEqual(
        reader.executionEvents(row.id).map((event: any) => event.data.text),
        ["committed"],
      );
      assert.equal(
        (reader.db.prepare("PRAGMA integrity_check").get() as any)
          .integrity_check,
        "ok",
      );
    } finally {
      reader.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 不再自动迁移的格式必须明确拒绝，不能悄悄升级并忽略旧正文。 */
test("旧格式拒绝启动且保留原账本", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-old-format-"));
  const path = join(dir, "environment.db");
  const old = new Store(path, false);
  try {
    old.put(
      "localExecutions",
      { events: [{ sequence: 1, type: "result", data: { result: "保留" } }] },
      "execution",
    );
    assert.throws(
      () => new ConnectorStore(path),
      (error: any) => error.code === "STORE_UPGRADE_REQUIRED",
    );
    assert.equal(
      (old.db.prepare("PRAGMA user_version").get() as any).user_version,
      1,
    );
    assert.equal(old.executionEvents("execution")[0].data.result, "保留");
  } finally {
    old.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
