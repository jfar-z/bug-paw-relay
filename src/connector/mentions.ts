import { translate, message as i18nMessage } from "../shared/i18n.js";
import { opendir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ensure } from "../shared/contracts.js";
import {
  type Mention,
  type MentionItem,
  mentionItemSchema,
  mentionRank,
} from "../shared/mentions.js";
import { normalizeEnvironmentFilePath } from "./files.js";
import { discoverSkills } from "./runtime.js";
/** 引用搜索有界扫描且只在环境端缓存原生清单，服务端不建立文件索引。 */
export class EnvironmentMentions {
  private cache = new Map<
    string,
    { expires: number; value: Promise<MentionItem[]> }
  >();
  constructor(
    private config: () => any,
    private discover = discoverSkills,
  ) {}
  private within(base: string, path: string) {
    const rel = relative(base, path);
    return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
  }
  private async roots(): Promise<string[]> {
    return (
      await Promise.all(
        this.config().roots.map(async (r: any) => {
          try {
            return await realpath(r.path);
          } catch {
            return null;
          }
        }),
      )
    ).filter((r): r is string => !!r);
  }
  private skills(runtime: "codex" | "claude", cwd: string, fresh = false) {
    const config = this.config()[runtime] || {};
    const key = JSON.stringify([runtime, cwd, config.home, config.command]);
    const old = this.cache.get(key);
    if (!fresh && old && old.expires > Date.now()) return old.value;
    if (this.cache.size >= 16)
      this.cache.delete(this.cache.keys().next().value!);
    const value = this.discover(runtime, cwd, config).then((items) =>
      items.map((i) => mentionItemSchema.parse(i)),
    );
    this.cache.set(key, { expires: Date.now() + 30000, value });
    void value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }
  /** 校验真实路径与对象类型，发送时不信任浏览器传来的任意 Skill 路径。 */
  async validate(
    cwd: string,
    runtime: "codex" | "claude",
    mentions: Mention[],
  ) {
    const roots = await this.roots();
    const skills = mentions.some((m) => m.kind === "skill")
      ? await this.skills(runtime, cwd, true)
      : [];
    for (const m of mentions) {
      if (m.kind === "board") continue;
      if (m.kind === "skill") {
        ensure(
          skills.some((s) => s.name === m.name && s.path === m.path),
          "MENTION_STALE",
          i18nMessage("errors.MENTION_STALE.the.skill.is.no.longer.available"),
        );
      } else {
        const path = await realpath(
          resolve(cwd, normalizeEnvironmentFilePath(m.path)),
        );
        ensure(
          roots.some((root) => this.within(root, path)),
          "PATH_ESCAPE",
          i18nMessage(
            "errors.PATH_ESCAPE.the.reference.is.outside.the.environment",
          ),
          403,
        );
        ensure(
          !path
            .split(/[\\/]/)
            .some((part) => part.startsWith(".relay-upload-")),
          "UPLOAD_INCOMPLETE",
          i18nMessage("uploads.incomplete"),
          403,
        );
        const info = await stat(path);
        ensure(
          m.kind === "folder" ? info.isDirectory() : info.isFile(),
          "MENTION_STALE",
          i18nMessage(
            "errors.MENTION_STALE.the.reference.type.has.changed.select",
          ),
        );
        m.path =
          this.within(cwd, path) &&
          /(?:^|[\\/])attachments[\\/]relay-[a-f0-9-]{36}[\\/]/.test(path)
            ? relative(cwd, path).split(sep).join("/")
            : path;
      }
    }
  }
  async search(cwd: string, runtime: "codex" | "claude", query: string) {
    const roots = await this.roots();
    const needle = query.trim().replaceAll("\\", "/").toLocaleLowerCase();
    const warnings: string[] = [];
    const warningMessages = [];
    let skills: MentionItem[] = [];
    try {
      skills = await this.skills(runtime, cwd);
    } catch {
      warnings.push("Skill 清单暂时不可用，请检查环境端运行时后重试");
      warningMessages.push(i18nMessage("connector.mentions.skillsUnavailable"));
    }
    const matches = (i: MentionItem) =>
      !needle ||
      [i.name, i.path, i.description || ""].some((v) =>
        v.replaceAll("\\", "/").toLocaleLowerCase().includes(needle),
      );
    const rank = (item: MentionItem) => mentionRank(item, needle);
    const items = skills.filter(matches)
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, 10);
    const skip = new Set([".git", "node_modules", ".vibe", ".cache"]);
    const excluded = (part: string) => skip.has(part) || part.startsWith(".relay-upload-");
    const prefix = query.trim().replaceAll("\\", "/");
    const slash = prefix.lastIndexOf("/");
    const bases = slash < 0 ? [resolve(cwd, "attachments"), cwd, ...roots] : [resolve(cwd, prefix.slice(0, slash + 1))];
    const visited = new Set<string>();
    const deadline = Date.now() + 2500;
    let truncated = false;
    // 一次批量读取多个目录项；按项目、其他根的顺序遍历，不按文件数量截断。
    search: for (const base of bases) {
      const queue = [base];
      for (let index = 0; index < queue.length; index++) {
        if (Date.now() >= deadline) {
          truncated = true;
          break search;
        }
        const dir = queue[index];
        if (visited.has(dir)) continue;
        visited.add(dir);
        try {
          const actual = await realpath(dir);
          if (relative(dir, actual) || !roots.some((root) => this.within(root, actual))) continue;
          if (actual.split(sep).some(excluded)) continue;
          const entries = await opendir(dir, { bufferSize: 256 });
          for await (const entry of entries) {
            if (Date.now() >= deadline) {
              truncated = true;
              break search;
            }
            if (excluded(entry.name) || (!entry.isFile() && !entry.isDirectory())) continue;
            const path = resolve(dir, entry.name);
            if (entry.isDirectory()) queue.push(path);
            const name = this.within(cwd, path) ? relative(cwd, path).split(sep).join("/") : path;
            const item: MentionItem = { kind: entry.isDirectory() ? "folder" : "file", name, path };
            // 前缀确定搜索根，最后一段可匹配子树内任意层的名称片段。
            const hit = slash < 0 ? matches(item)
              : relative(base, path).toLowerCase().includes(needle.slice(slash + 1));
            if (!hit || name.length > 512 || path.length > 4096) continue;
            const score = rank(item);
            if (items.length < 10 || score < rank(items.at(-1)!)) {
              items.push(item);
              items.sort((a, b) => rank(a) - rank(b));
              if (items.length > 10) items.pop();
            }
            if (items.length === 10 && (!needle || rank(items[9]) === 0)) break search;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT" &&
              (error as NodeJS.ErrnoException).code !== "ENOTDIR") truncated = true;
        }
      }
    }
    if (truncated) {
      warnings.push(translate("zh-CN", "connector.mentions.scanIncomplete"));
      warningMessages.push(i18nMessage("connector.mentions.scanIncomplete"));
    }
    return { items, warning: warnings.join("；"), warningMessages };
  }
}
