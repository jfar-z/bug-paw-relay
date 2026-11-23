import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { AppError } from "../shared/contracts.js";
import { message, type MessageKey } from "../shared/i18n.js";
import { hostCli, officialClaudePath, probeCli } from "./host-cli.js";
import { detectClaudeSdk, loadClaudeSdk, openSdk, sdkDigest, sdkDirectory, sdkSource, sdkVersion } from "./claude-sdk.js";

type Config = { mode: "environment" | "custom"; command?: string };
const windows = process.platform === "win32";
const cliSource = windows ? "https://claude.ai/install.ps1" : "https://claude.ai/install.sh";
const run = promisify(execFile);

export async function claudeSupportStatus(dir: string, config: Config) {
  const check = await probeCli("claude", { ...config, mode: "environment" });
  const sdkReady = await loadClaudeSdk(dir).then(() => true, () => false);
  const explicitInvalid = !check.available && !!config.command?.trim() && config.command.trim() !== "claude";
  const plan = [];
  if (!check.available && !explicitInvalid) plan.push({ component: "cli", source: cliSource, destination: officialClaudePath() });
  if (config.mode === "custom" && !sdkReady && !explicitInvalid) plan.push({ component: "sdk", source: sdkSource, destination: sdkDirectory(dir) });
  return {
    mode: config.mode, command: config.command?.trim() || "claude", account: userInfo().username,
    cli: { available: check.available, version: check.version, path: check.available ? hostCli("claude", config) : config.command, explicitInvalid },
    sdk: { required: config.mode === "custom", available: sdkReady, version: sdkVersion },
    plan, ready: check.available && (config.mode === "environment" || sdkReady),
  };
}

/** 读连接仅检测本机安装器持有的排他锁，首次查询不会创建数据库。 */
export async function remoteSdkStatus(dir: string, config: Config) {
  const file = join(dir, "components", "install.sqlite");
  let db: DatabaseSync | undefined;
  let installing = false;
  try {
    if (statSync(file, { throwIfNoEntry: false })) {
      db = new DatabaseSync(file, { readOnly: true });
      db.prepare("SELECT count(*) FROM sqlite_schema").get();
    }
  } catch (error) {
    if ((error as { errcode?: number }).errcode !== 5)
      throw new AppError("CLAUDE_INSTALL_FAILED", message("connector.support.storage"));
    installing = true;
  } finally {
    db?.close();
  }
  return { mode: config.mode, version: sdkVersion, state: await detectClaudeSdk(dir), installing };
}

/** 安装源固定在产品内，子进程输出不进入控制台或 API 错误。 */
export async function installClaudeSupport(
  dir: string,
  config: Config,
  progress: (key: MessageKey) => void,
  approvedComponents?: readonly ("cli" | "sdk")[],
) {
  await installComponents(dir, config, progress, async () => {
    const status = await claudeSupportStatus(dir, config);
    if (status.cli.explicitInvalid) throw new AppError("CLAUDE_PATH_INVALID", message("connector.support.path"));
    if (approvedComponents && status.plan.some(item => !approvedComponents.some(component => component === item.component)))
      throw new AppError("CLAUDE_PLAN_CHANGED", message("console.claudePlanChanged"));
    return status.plan;
  });
  return claudeSupportStatus(dir, config);
}

export async function installRemoteSdk(dir: string, readConfig: () => Config) {
  // 配置和实际可加载状态均在本机锁内复核，不执行 CLI 安装计划。
  await installComponents(dir, {}, () => {}, async () => {
    if (readConfig().mode !== "custom")
      throw new AppError("SDK_NOT_REQUIRED", message("connector.support.notRequired"), 409);
    const state = await detectClaudeSdk(dir);
    if (state === "unknown")
      throw new AppError("SDK_STATUS_UNKNOWN", message("connector.support.unknown"), 409);
    return state === "installed" ? [] : [{ component: "sdk", source: sdkSource }];
  });
  return remoteSdkStatus(dir, readConfig());
}

async function installComponents(
  dir: string,
  config: { command?: string },
  progress: (key: MessageKey) => void,
  plan: () => Promise<{ component: string; source: string }[]>,
) {
  let failure: MessageKey = "connector.support.storage";
  let lock: DatabaseSync | undefined;
  let staging: string | undefined;
  try {
    const root = sdkDirectory(dir);
    await mkdir(root, { recursive: true, mode: 0o700 });
    // SQLite 的排他事务跨 CLI 和 Web 进程互斥，进程退出时由系统释放。
    lock = new DatabaseSync(join(dir, "components", "install.sqlite"));
    lock.exec("BEGIN EXCLUSIVE");
    for (const item of await plan()) {
      const cli = item.component === "cli";
      failure = cli ? "connector.support.cliDownload" : "connector.support.sdkDownload";
      progress(failure);
      const response = await fetch(item.source, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error("DOWNLOAD");
      const bytes = Buffer.from(await response.arrayBuffer());
      failure = "connector.support.storage";
      staging = await mkdtemp(join(root, "install-"));
      if (cli) {
        const script = join(staging, windows ? "install.ps1" : "install.sh");
        await writeFile(script, bytes);
        failure = "connector.support.cliInstall";
        progress(failure);
        await run(windows ? "powershell.exe" : "bash", windows ? ["-NoProfile", "-NonInteractive", "-File", script] : [script], { windowsHide: true });
        if (!(await probeCli("claude", { ...config, mode: "environment" })).available) throw Error("CLI_VERSION");
      } else {
        failure = "connector.support.integrity";
        progress(failure);
        if (createHash("sha512").update(bytes).digest("base64") !== sdkDigest) throw Error("DIGEST");
        failure = "connector.support.storage";
        const archive = join(staging, "sdk.tgz");
        await writeFile(archive, bytes);
        failure = "connector.support.unpack";
        progress(failure);
        await run(windows ? "tar.exe" : "tar", ["-xzf", archive, "-C", staging]);
        await rm(archive);
        await openSdk(staging);
        failure = "connector.support.storage";
        const pointer = join(staging, "pointer");
        await writeFile(pointer, basename(staging));
        await rename(pointer, join(root, "current"));
        staging = undefined;
      }
      if (staging) await rm(staging, { recursive: true, force: true });
      staging = undefined;
    }
    progress("connector.support.check");
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (["EACCES", "EPERM", "ENOSPC", "EROFS"].includes((err as NodeJS.ErrnoException)?.code ?? "")) failure = "connector.support.storage";
    if ((err as { errcode?: number })?.errcode === 5)
      throw new AppError("CLAUDE_INSTALL_BUSY", message("connector.support.busy"), 409);
    throw new AppError("CLAUDE_INSTALL_FAILED", message(failure));
  } finally {
    try {
      if (staging) await rm(staging, { recursive: true, force: true });
    } finally {
      lock?.close();
    }
  }
}
