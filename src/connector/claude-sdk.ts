import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AppError } from "../shared/contracts.js";
import { message } from "../shared/i18n.js";

export const sdkVersion = "0.3.322";
export const sdkSource = "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-" + sdkVersion + ".tgz";
export const sdkDigest = "r88ij7R3SPV2j3BtFuavgrbWZNE8SVVS42AOQ1KxlS+QnSwNNnUhmVXV3Es2dniZySBYX8ENebL43ffhiB0azw==";
export function sdkDirectory(dir = process.env.BUGPAW_HOME || join(homedir(), ".bugpaw-relay")) {
  return join(dir, "components", "claude-sdk", sdkVersion);
}

/** 仅加载连接器指定版本，通过独立目录保留已经被运行中会话引用的模块。 */
export async function openSdk(directory: string): Promise<typeof import("@anthropic-ai/claude-agent-sdk")> {
  const file = join(directory, "package", "sdk.mjs");
  await access(file);
  const manifest = JSON.parse(await readFile(join(directory, "package", "package.json"), "utf8"));
  if (manifest.name !== "@anthropic-ai/claude-agent-sdk" || manifest.version !== sdkVersion)
    throw Error("SDK_VERSION");
  const sdk = await import(pathToFileURL(file).href);
  if (["query", "tool", "createSdkMcpServer", "getSessionMessages", "getSessionInfo"].some(key => typeof sdk[key] !== "function"))
    throw Error("SDK_EXPORTS");
  return sdk;
}

async function loadCurrentSdk(dir?: string) {
  const root = sdkDirectory(dir);
  const generation = await readFile(join(root, "current"), "utf8");
  if (!/^install-[a-zA-Z0-9]+$/.test(generation)) throw Error("SDK_PATH");
  return openSdk(join(root, generation));
}

export async function detectClaudeSdk(dir: string) {
  try {
    await loadCurrentSdk(dir);
    return "installed" as const;
  } catch (error) {
    // 无法读取或验证已有组件时，不依据不完整探测触发远程写入。
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" as const : "unknown" as const;
  }
}

export async function loadClaudeSdk(dir?: string) {
  try {
    return await loadCurrentSdk(dir);
  } catch {
    throw new AppError("CLAUDE_SUPPORT_REQUIRED", message("connector.support.required"));
  }
}
