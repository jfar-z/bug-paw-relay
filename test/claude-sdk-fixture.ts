import { after, before } from "node:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sdkDirectory } from "../src/connector/claude-sdk.js";

/** 将开发依赖放入隔离的已安装布局，协议用例无需访问 npm 或读写真实用户目录。 */
export function useInstalledClaudeSdk() {
  const previous = process.env.BUGPAW_HOME;
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "relay-sdk-test-"));
    const root = sdkDirectory(dir);
    mkdirSync(root, { recursive: true });
    cpSync(dirname(fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk"))), join(root, "install-fixture", "package"), { recursive: true });
    writeFileSync(join(root, "current"), "install-fixture");
    process.env.BUGPAW_HOME = dir;
  });
  after(() => {
    if (previous === undefined) delete process.env.BUGPAW_HOME;
    else process.env.BUGPAW_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  });
}
