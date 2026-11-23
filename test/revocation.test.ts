import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/connector/engine.js";

test("SEC-09 撤销关闭全部运行时，重复关闭安全，单个异常不跳过其他句柄", () => {
  const engine = Object.create(Engine.prototype);
  const closed: number[] = [];
  const cancelled: string[] = [];
  engine.pendingEvents = new Map();
  // 原型测试夹具显式提供新增上传接收器，关闭检查仍覆盖全部原生句柄。
  let terminalClosed = 0;
  engine.terminals = { close: () => {
    if (++terminalClosed === 1) throw Error("terminal fixture");
  } };
  let uploadClosed = 0;
  engine.uploads = { close: async () => { uploadClosed++; } };
  engine.state = (id: string, status: string) => {
    assert.equal(status, "cancelled");
    cancelled.push(id);
  };
  engine.handles = new Map([
    [
      "a",
      {
        close() {
          closed.push(1);
          throw Error("fake");
        },
      },
    ],
    [
      "b",
      {
        close() {
          closed.push(2);
        },
      },
    ],
  ]);
  assert.throws(() => engine.close(), (error) =>
    error instanceof AggregateError && error.errors.length === 2,
  );
  assert.equal(terminalClosed, 1);
  assert.deepEqual(closed, [1, 2]);
  assert.equal(uploadClosed, 1);
  assert.equal(engine.handles.size, 0);
  assert.deepEqual(cancelled, ["b"]);
  engine.close();
});

/** 假原生进程拒绝 SIGTERM，验证宽限期后实际被终止。 */
test("SEC-09 原生进程拒绝正常退出时限定时间强制终止", { timeout: 12000 }, async () => {
  const { CodexRuntime } = await import("../src/connector/runtime.js");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { once } = await import("node:events");
  const dir = mkdtempSync(join(tmpdir(), "relay-stop-"));
  const command = join(dir, "fake-codex");
  writeFileSync(command, `#!${process.execPath}\nprocess.on('SIGTERM',()=>{});process.stdout.write('ready\\n');setInterval(()=>{},1000);`, { mode: 0o700 });
  const runtime = new CodexRuntime({ event() {}, native() {}, interaction() {}, done() {}, handoff: async () => ({}) }, { command });
  const child = (runtime as any).process;
  try {
    await once(child.stdout, "data");
    const exit = once(child, "exit");
    runtime.close();
    const [, signal] = await exit;
    assert.equal(signal, "SIGKILL");
  } finally { child.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
});
