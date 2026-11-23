import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import { readdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import type { Store } from "../server/store.js";
import type { terminalAction } from "../shared/claude-terminal.js";
import { ensure } from "../shared/contracts.js";
import { message } from "../shared/i18n.js";
import { cliInvocation, hostCli } from "./host-cli.js";

/** 原生客户端将会话按项目分目录存放。通过本地生成的 UUID 检查历史，无需 SDK。 */
async function hasTranscript(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return false;
  const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
  let folders;
  try {
    folders = await readdir(projects, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  for (const folder of folders.filter(entry => entry.isDirectory())) {
    try {
      await access(join(projects, folder.name, id + ".jsonl"));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return false;
}

interface Terminal {
  pty: IPty;
  cwd: string;
  output: string;
  end: number;
  exited: boolean;
  exit: Promise<void>;
}

/** 官方客户端独占认证和审批，数据库只保存平台会话到原生 ID 的映射。 */
export class ClaudeTerminals {
  private entries = new Map<string, Terminal>();
  private closing = false;

  get busy() {
    return [...this.entries.values()].some((entry) => !entry.exited);
  }

  async stop(sessionId: string) {
    const entry = this.entries.get(sessionId);
    if (entry && !entry.exited) {
      entry.pty.kill();
      await entry.exit;
    }
    return { ok: true };
  }

  close() {
    this.closing = true;
    const errors: unknown[] = [];
    for (const entry of this.entries.values()) {
      if (entry.exited) continue;
      try {
        entry.pty.kill();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Claude Code 终端关闭失败");
  }

  async call(
    store: Store,
    sessionId: string,
    cwd: string,
    command: string,
    input: Exclude<z.infer<typeof terminalAction>, { action: "close" }>,
  ) {
    // 动态加载让已有 SDK 用户无需初始化原生终端模块。
    const pty = input.action === "open" ? await import("node-pty") : undefined;
    const error = message("connector.native.unavailable");
    let entry = this.entries.get(sessionId);
    ensure(!entry || entry.cwd === cwd, "DIRECTORY_MISMATCH", error, 409);
    let previous;
    let resume = false;
    if (input.action === "open" && (!entry || entry.exited)) {
      previous = store.findBy("claudeTerminals", "id", sessionId)[0];
      ensure(!previous || previous.cwd === cwd, "DIRECTORY_MISMATCH", error, 409);
      // 首次输入前退出时客户端不会写会话。复用原生 ID，并按实际历史选择启动方式。
      resume = !!(previous && await hasTranscript(previous.nativeId));
      entry = this.entries.get(sessionId);
      ensure(!entry || entry.cwd === cwd, "DIRECTORY_MISMATCH", error, 409);
    }
    if (input.action === "open" && (!entry || entry.exited)) {
      ensure(!this.closing, "TERMINAL_CLOSED", error, 409);
      const nativeId = previous?.nativeId ?? randomUUID();
      const cli = cliInvocation(hostCli("claude", { command }));
      const process = pty!.spawn(
        cli.command,
        [
          ...cli.prefix,
          resume ? "--resume" : "--session-id",
          nativeId,
          "--permission-mode",
          "default",
        ],
        { cwd, name: "xterm-256color", cols: input.cols, rows: input.rows },
      );
      let resolveExit!: () => void;
      const exit = new Promise<void>((resolve) => {
        resolveExit = resolve;
      });
      const current = { pty: process, cwd, output: "", end: 0, exited: false, exit };
      process.onData((data) => {
        current.end += data.length;
        current.output = (current.output + data).slice(-131072);
      });
      process.onExit(() => {
        current.exited = true;
        resolveExit();
        // 浏览器读到尾部后即可清理；无人返回时也要释放终端正文。
        setTimeout(() => {
          if (this.entries.get(sessionId) === current)
            this.entries.delete(sessionId);
        }, 60000).unref();
      });
      try {
        if (!previous)
          store.put("claudeTerminals", { nativeId, cwd }, sessionId);
      } catch (e) {
        process.kill();
        throw e;
      }
      this.entries.set(sessionId, current);
      entry = current;
    }
    ensure(entry, "TERMINAL_CLOSED", error, 409);
    if (input.action === "read") {
      const start = entry.end - entry.output.length;
      const gap = input.cursor < start || input.cursor > entry.end;
      return {
        data: entry.output.slice(gap ? 0 : input.cursor - start),
        cursor: entry.end,
        gap,
        exited: entry.exited,
      };
    }
    ensure(!entry.exited, "TERMINAL_CLOSED", error, 409);
    if (input.action === "write") entry.pty.write(input.data);
    if (input.action === "resize") entry.pty.resize(input.cols, input.rows);
    return { ok: true };
  }
}
