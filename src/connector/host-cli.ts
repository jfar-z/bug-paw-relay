import { execFile } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { AppError } from "../shared/contracts.js";
import { message, type MessageDescriptor } from "../shared/i18n.js";

import { loadClaudeSdk } from "./claude-sdk.js";
import { homedir } from "node:os";

export function officialClaudePath() {
  return join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
}

type Runtime = "codex" | "claude";

/** Windows 的 npm 全局命令通常是 cmd 包装器，直接读取同目录已安装包的入口，避免启动 shell。 */
function windowsEntry(path: string, runtime: Runtime) {
  if (!extname(path) && existsSync(path + ".exe")) return path + ".exe";
  const shim = extname(path) ? path : path + ".cmd";
  if (!shim.toLowerCase().endsWith(".cmd") || !existsSync(shim)) return path;
  const packageDir = join(
    dirname(shim),
    "node_modules",
    runtime === "codex" ? "@openai/codex" : "@anthropic-ai/claude-code",
  );
  const manifest = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  );
  const entry =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[runtime];
  return typeof entry === "string" ? resolve(packageDir, entry) : shim;
}

/** Windows 工作线程的环境副本区分键名大小写，查找时沿用宿主的 PATH 语义。 */
export function cliSearchPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  if (platform !== "win32" || env.PATH !== undefined) return env.PATH ?? "";
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  return key === undefined ? "" : env[key] ?? "";
}

/** 显式路径只尝试自身；PATH 解析在连接器进程内完成，避免 SDK 在项目目录中另选命令。 */
export function hostCli(runtime: Runtime, config: { command?: string } = {}) {
  const name = config.command?.trim() || runtime;
  const paths = /[/\\]/.test(name)
    ? [resolve(name)]
    : cliSearchPath(process.env, process.platform)
        .split(delimiter)
        .filter(Boolean)
        .map((dir) => resolve(dir, name));
  if (runtime === "claude" && name === "claude") paths.push(officialClaudePath());
  let denied = false;
  for (const path of paths) {
    try {
      const file =
        process.platform === "win32" ? windowsEntry(path, runtime) : path;
      if (!statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EACCES") denied = true;
    }
  }
  throw new AppError(
    "CLI_UNAVAILABLE",
    message(denied ? "connector.cli.launchFailed" : "connector.cli.missing", {
      runtime,
    }),
  );
}

/** npm 安装的 JS 入口可直接交给连接器的 Node 执行。 */
export function cliInvocation(file: string) {
  return /\.[cm]?js$/i.test(file)
    ? { command: process.execPath, prefix: [file] }
    : { command: file, prefix: [] };
}

/** 探测仅报告可展示的诊断，避免将原始 stderr、命令路径或凭据上传。 */
export async function probeCli(
  runtime: Runtime,
  config: { mode?: string; command?: string; baseUrl?: string; apiKey?: string },
): Promise<
  { available: boolean; version: string | null } & Partial<MessageDescriptor>
> {
  try {
    const file = hostCli(runtime, config);
    const { command, prefix } = cliInvocation(file);
    const { stdout } = await promisify(execFile)(
      command,
      [...prefix, "--version"],
      {
        timeout: 5000,
        killSignal: "SIGKILL",
        windowsHide: true,
        maxBuffer: 8192,
      },
    );
    const version = stdout.trim().split(/\r?\n/)[0].slice(0, 120);
    if (runtime === "claude" && config.mode !== "environment") {
      try {
        await loadClaudeSdk();
      } catch {
        return { available: false, version, ...message("connector.support.required") };
      }
    }
    if (runtime === "claude" && config.mode !== "environment" && !(config.baseUrl && config.apiKey))
      return {
        available: false,
        version,
        ...message("connector.runtime.claudeConfig"),
      };
    return { available: true, version };
  } catch (error) {
    const reason =
      error instanceof AppError && error.messageKey === "connector.cli.missing"
        ? "connector.cli.missing"
        : "connector.cli.launchFailed";
    return { available: false, version: null, ...message(reason, { runtime }) };
  }
}
