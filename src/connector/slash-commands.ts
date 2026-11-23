import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { Store } from "../server/store.js";
import { digest } from "../server/security.js";
import { ensure } from "../shared/contracts.js";
import { message } from "../shared/i18n.js";
import {
  fixedCommands,
  type CommandScope,
  type NativeCommand,
} from "../shared/slash-commands.js";
import { discoverClaudeCommands, discoverSkills } from "./runtime.js";

const fixed = new Set<string>(fixedCommands);

/** SDK 的名称优先于别名，同名内置行优先。无法唯一解析的别名只展示。 */
export function claudeCatalog(commands: SlashCommand[]): NativeCommand[] {
  const spellings = new Set(
    commands.flatMap((c) => [c.name, ...(c.aliases || [])]),
  );
  return [...spellings]
    .filter((name) => !fixed.has(name))
    .map((name) => {
      const named = commands.filter((c) => c.name === name);
      const builtin = named.filter((c) => c.builtin);
      const candidates = builtin.length
        ? builtin
        : named.length
          ? named
          : commands.filter((c) => c.aliases?.includes(name));
      const row = candidates[0];
      const execution =
        candidates.length !== 1
          ? null
          : !row.builtin
            ? "template"
            : row.name === "rename"
              ? "rename"
              : row.name === "compact"
                ? "compact"
                : null;
      return {
        name,
        canonical: row.name,
        description: row.description,
        argumentHint: row.argumentHint,
        source: row.builtin ? "builtin" : "project",
        execution,
      };
    });
}

export async function nativeCatalog(
  scope: CommandScope,
  cwd: string,
  config: any,
): Promise<NativeCommand[]> {
  if (scope.runtime === "claude")
    return claudeCatalog(await discoverClaudeCommands(cwd, config));
  const skills = await discoverSkills("codex", cwd, config);
  return skills
    .filter(
      (s, i) =>
        !fixed.has(s.name) &&
        skills.findIndex((other) => other.name === s.name) === i,
    )
    .map((s) => ({
      name: s.name,
      canonical: s.name,
      description: s.description || "",
      argumentHint: "",
      path: s.path,
      source: "project",
      execution:
        skills.filter((other) => other.name === s.name).length === 1
          ? "skill"
          : null,
    }));
}

/** 内置按环境与 CLI 授权，扩展额外绑定项目、实际目录与原生身份。 */
export class SlashCatalog {
  constructor(
    private store: Store,
    private discover = nativeCatalog,
  ) {}

  private key(scope: CommandScope, cwd: string) {
    return digest(
      JSON.stringify([
        scope.environmentId,
        scope.runtime,
        scope.projectId,
        cwd,
      ]),
    );
  }

  private entry(scope: CommandScope, cwd: string, row: NativeCommand) {
    const key =
      row.source === "builtin"
        ? [scope.environmentId, scope.runtime]
        : [this.key(scope, cwd)];
    const identity = digest(
      JSON.stringify([
        ...key,
        row.source,
        row.name,
        row.canonical,
        row.path,
        row.execution,
      ]),
    );
    const enabled =
      !!row.execution &&
      this.store.findBy("slashGrants", "id", identity)[0]?.enabled === true;
    return { ...row, identity, enabled };
  }

  async list(scope: CommandScope, cwd: string, config: any, cached = false) {
    const id = this.key(scope, cwd);
    const previous = this.store.findBy("slashCatalogs", "id", id)[0];
    if (cached)
      ensure(previous, "COMMAND_NO_CACHE", message("slash.noCache"), 404);
    const rows: NativeCommand[] = cached
      ? previous.rows
      : await this.discover(scope, cwd, config);
    if (!cached) {
      const current = this.store.findBy("slashCatalogs", "id", id)[0];
      if (JSON.stringify(current?.rows) !== JSON.stringify(rows)) {
        this.store.transaction(() => {
          // 项目条目消失或改为其他解析目标时撤销旧授权；内置授权仍供其他目录使用。
          const remaining = new Set(
            rows.map((row) => this.entry(scope, cwd, row).identity),
          );
          for (const old of (current?.rows || []) as NativeCommand[]) {
            if (old.source !== "project") continue;
            const entry = this.entry(scope, cwd, old);
            if (entry.enabled && !remaining.has(entry.identity))
              this.store.remove("slashGrants", entry.identity);
          }
          this.store.put("slashCatalogs", { rows }, id);
        });
      }
    }
    return rows.map((row) => this.entry(scope, cwd, row));
  }

  async resolve(scope: CommandScope, cwd: string, config: any, name: string) {
    const row = (await this.list(scope, cwd, config)).find(
      (r) => r.name === name,
    );
    ensure(
      row?.execution,
      "COMMAND_UNSUPPORTED",
      message("slash.unsupported"),
      409,
    );
    ensure(row.enabled, "COMMAND_DISABLED", message("slash.disabled"), 409);
    return row;
  }

  async save(
    scope: CommandScope,
    cwd: string,
    config: any,
    change: { name: string; identity: string; enabled: boolean },
  ) {
    const row = (await this.list(scope, cwd, config)).find(
      (r) => r.name === change.name,
    );
    ensure(
      row?.execution && row.identity === change.identity,
      "COMMAND_STALE",
      message("slash.stale"),
      409,
    );
    this.store.put("slashGrants", { enabled: change.enabled }, row.identity);
    return { ...row, enabled: change.enabled };
  }
}
