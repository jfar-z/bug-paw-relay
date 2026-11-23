import { attachmentLink } from "./uploads.js";
import { z } from "zod";
/** 引用只携带环境端对象标识，不上传文件或 Skill 正文。 */
export const mentionItemSchema = z.object({
  kind: z.enum(["skill", "folder", "file", "board"]),
  name: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  description: z.string().max(2000).optional(),
});
export const mentionSchema = mentionItemSchema.extend({
  start: z.number().int().min(0).max(100000),
  end: z.number().int().min(1).max(100000),
});
export const mentionsSchema = z.array(mentionSchema).max(50);
export type MentionItem = z.infer<typeof mentionItemSchema>;
export type Mention = z.infer<typeof mentionSchema>;
/** 环境和服务端使用同一匹配等级；相同等级保留项目遍历顺序。 */
export function mentionRank(item: Pick<MentionItem, "name" | "path">, query: string) {
  const normalize = (value: string) => value.replaceAll("\\", "/").toLowerCase();
  const needle = normalize(query.trim());
  if (!needle) return 3;
  const name = normalize(item.name);
  if (name === needle || normalize(item.path) === needle) return 0;
  if (name.startsWith(needle)) return 1;
  return name.includes(needle) ? 2 : 3;
}
/** 可见文本与结构化引用一起校验，编辑过的文本不继续携带旧授权。 */
export function mentionText(item: MentionItem) {
  return "@" + item.name;
}
export function validMentions(text: string, mentions: Mention[]) {
  let end = 0;
  return mentions.every((m) => {
    const valid =
      m.start >= end &&
      m.end > m.start &&
      m.end <= text.length &&
      text.slice(m.start, m.end) === mentionText(m) &&
      (m.start === 0 || text[m.start - 1] === " ");
    end = m.end;
    return valid;
  });
}
/** 仅开头或普通空格后的 @ 触发；邮箱、换行和选中引用内部不触发。 */
export function mentionQuery(text: string, caret: number, mentions: Mention[]) {
  if (caret < 0) return null;
  if (mentions.some((m) => caret > m.start && caret <= m.end)) return null;
  const match = /(?:^| )@([^@\n\r]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  const start = caret - match[1].length - 1;
  if (mentions.some((m) => start >= m.start && start < m.end)) return null;
  return { start, end: caret, query: match[1] };
}
/** 根据单次编辑的公共前后缀移动引用；与编辑重叠的引用退回普通文字。 */
export function editMentions(
  before: string,
  after: string,
  mentions: Mention[],
) {
  if (before === after) return mentions;
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const oldEnd = before.length - tail;
  const delta = after.length - before.length;
  return mentions.flatMap((m) => {
    const next =
      m.end <= start
        ? m
        : m.start >= oldEnd
          ? { ...m, start: m.start + delta, end: m.end + delta }
          : null;
    return next && validMentions(after, [next]) ? [next] : [];
  });
}
/** 仅替换已经选中并校验的引用，保留用户其他原文。 */
export function nativeMentionText(
  text: string,
  mentions: Mention[],
  runtime: "codex" | "claude",
) {
  for (const m of [...mentions].reverse()) {
    const value =
      m.kind === "board" ? `@${m.name} (boardId=${m.path})` : m.kind === "skill"
        ? (runtime === "codex" ? "$" : "/") + m.name
        : m.kind === "file" &&
            /(?:^|[\\/])attachments[\\/]relay-[a-f0-9-]{36}[\\/]/.test(m.path)
          ? attachmentLink(m.name, m.path.replaceAll("\\", "/"))
          : JSON.stringify(m.path);
    text = text.slice(0, m.start) + value + text.slice(m.end);
  }
  return text;
}
