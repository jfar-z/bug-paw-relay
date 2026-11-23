import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sdkDirectory, sdkSource } from "../src/connector/claude-sdk.js";
import { claudeSupportStatus, installClaudeSupport, installRemoteSdk, remoteSdkStatus } from "../src/connector/claude-support.js";

test("本地组件计划遵守模式与显式路径，失败不切换已保存版本", async t => {
  const dir = await mkdtemp(join(tmpdir(), "relay support "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const command = join(dir, "cli.cjs");
  await writeFile(command, 'console.log("1.0")', { mode: 0o700 });
  const config = { command, mode: "custom" } as const;
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("offline"); });
  const check = () => claudeSupportStatus(dir, config);
  const install = () => installClaudeSupport(dir, config, () => {});
  assert.deepEqual((await check()).plan.map(item => item.source), [sdkSource]);
  assert.equal((await installClaudeSupport(dir, { command, mode: "environment" }, () => {})).ready, true);
  await assert.rejects(installClaudeSupport(dir, { command: join(dir, "missing"), mode: "custom" }, () => {}), { code: "CLAUDE_PATH_INVALID" });
  await assert.rejects(
    installClaudeSupport(dir, config, () => {}, ["cli"]),
    { code: "CLAUDE_PLAN_CHANGED" },
  );
  assert.equal(fetch.mock.callCount(), 0);
  const root = sdkDirectory(dir);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "current"), "install-previous");
  const lock = new DatabaseSync(join(dir, "components", "install.sqlite"));
  try {
    lock.exec("BEGIN EXCLUSIVE");
    await assert.rejects(install(), { code: "CLAUDE_INSTALL_BUSY" });
  } finally { lock.close(); }
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(install(), { messageKey: "connector.support.sdkDownload" });
  fetch.mock.mockImplementation(async () => new Response("corrupt archive"));
  await assert.rejects(install(), { messageKey: "connector.support.integrity" });
  assert.equal(await readFile(join(root, "current"), "utf8"), "install-previous");
  assert.equal((await check()).ready, false);
});

test("远程仅补装 SDK，识别跨入口互斥、未知状态和本机模式", async t => {
  const dir = await mkdtemp(join(tmpdir(), "relay-remote-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = { mode: "custom", command: join(dir, "missing-cli") } as const;
  const urls: string[] = [];
  let started!: () => void;
  let finish!: (response: Response) => void;
  const fetchStarted = new Promise<void>(resolve => { started = resolve; });
  const download = new Promise<Response>(resolve => { finish = resolve; });
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    started();
    return download;
  });
  const status = () => remoteSdkStatus(dir, config);
  const install = () => installRemoteSdk(dir, () => config);
  assert.equal((await status()).state, "missing");
  await assert.rejects(installRemoteSdk(dir, () => ({ mode: "environment" })), { code: "SDK_NOT_REQUIRED" });
  const pending = install();
  await fetchStarted;
  try {
    assert.equal((await status()).installing, true);
    await assert.rejects(install(), { code: "CLAUDE_INSTALL_BUSY" });
    await assert.rejects(installClaudeSupport(dir, config, () => {}), { code: "CLAUDE_INSTALL_BUSY" });
  } finally {
    finish(new Response("invalid"));
    await assert.rejects(pending, { messageKey: "connector.support.integrity" });
  }
  assert.equal((await status()).installing, false);
  await writeFile(join(sdkDirectory(dir), "current"), "invalid");
  assert.equal((await status()).state, "unknown");
  await assert.rejects(install(), { code: "SDK_STATUS_UNKNOWN" });
  assert.deepEqual(urls, [sdkSource]);
});
