import { useInstalledClaudeSdk } from "./claude-sdk-fixture.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cliSearchPath, hostCli, probeCli } from "../src/connector/host-cli.js";

test("Windows 工作线程按大小写变体读取完整搜索路径，Linux 仅使用 PATH", () => {
  const dirs = String.raw`C:\Program Files\CLI;D:\npm`;
  for (const key of ["Path", "PATH", "pAtH"]) {
    assert.equal(cliSearchPath({ [key]: dirs }, "win32"), dirs);
  }
  assert.equal(cliSearchPath({ PATH: "", Path: dirs }, "win32"), "");
  assert.equal(cliSearchPath({}, "win32"), "");
  assert.equal(cliSearchPath({ Path: dirs }, "linux"), "");
});

test("按 PATH 探测两种 CLI，显式配置覆盖 PATH，失败独立上报", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay cli "));
  const original = process.env.PATH;
  try {
    process.env.PATH = dir;
    const missing = await probeCli("codex", {});
    assert.equal(missing.available, false);
    assert.equal(missing.messageKey, "connector.cli.missing");

    const file = join(dir, "external.cjs");
    writeFileSync(
      file,
      'console.log(process.argv[2] === "--version" ? "1.2.3" : "unexpected")',
      { mode: 0o700 },
    );
    assert.deepEqual(await probeCli("codex", { command: file }), {
      available: true,
      version: "1.2.3",
    });
    assert.equal(hostCli("codex", { command: "external.cjs" }), file);
    assert.equal(
      (await probeCli("claude", { command: file })).messageKey,
      "connector.runtime.claudeConfig",
    );
    assert.equal(
      (
        await probeCli("claude", {
          command: file,
          baseUrl: "http://localhost",
          apiKey: "fixture",
        })
      ).available,
      true,
    );
    assert.equal((await probeCli("claude", { command: file, mode: "environment" })).available, true);
    if (process.platform !== "win32") {
      writeFileSync(join(dir, "codex"), "#!/bin/sh\necho 1.0", { mode: 0o700 });
      assert.equal((await probeCli("codex", {})).version, "1.0");
      assert.equal(
        (await probeCli("codex", { command: join(dir, "missing") })).available,
        false,
      );
    }
    writeFileSync(file, 'console.error("private-sentinel"); process.exit(1)');
    const failed = await probeCli("claude", { command: file });
    assert.equal(failed.messageKey, "connector.cli.launchFailed");
    assert.equal(JSON.stringify(failed).includes("private-sentinel"), false);
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("旧 Claude 配置与模式热切换保留加密凭据和端点", async () => {
  const { ConnectorConfig } = await import("../src/connector/config.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-claude-mode-"));
  try {
    const config = new ConnectorConfig(dir);
    const key = config.vault.seal("fixture");
    config.save({
      serverUrl: "http://localhost:1", name: "fixture", roots: [{ id: "test", path: dir }],
      claude: { apiKey: key, baseUrl: "http://localhost:2", authType: "bearer", model: "custom" },
    });
    const old = config.read().claude;
    assert.equal(old.mode, "custom");
    for (const mode of ["environment", "custom"]) {
      const saved = config.read();
      config.save({ ...saved, claude: { ...saved.claude, mode } });
      const reopened = new ConnectorConfig(dir);
      assert.deepEqual(reopened.read().claude, { ...old, mode });
      assert.equal(reopened.runtime().claude.apiKey, "fixture");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

useInstalledClaudeSdk();
