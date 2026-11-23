import { z } from "zod";

/** 只有首个词是单段斜杠名称才进入分派，路径与正文保持原文。 */
export function slashInput(text: string) {
  const match = /^\/([^\s/\\]*)(?=\s|$)/u.exec(text);
  return match
    ? { name: match[1], args: text.slice(match[0].length).trim() }
    : null;
}

export const commandCapability = "session-slash-commands-v1";
export const fixedCommands = ["rename", "resume", "model", "new"] as const;
export const commandScope = z.object({
  environmentId: z.string().uuid(),
  runtime: z.enum(["codex", "claude"]),
  projectId: z.string().uuid(),
  rootId: z.string().min(1),
  relativePath: z.string(),
});
export type CommandScope = z.infer<typeof commandScope>;
export const commandChange = z
  .object({
    name: z.string().min(1),
    identity: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

/** RPC 回包只接受命令元数据，浏览器保存开关时原样回传 identity。 */
export const nativeCommandSchema = z.object({
  name: z.string().min(1),
  canonical: z.string().min(1),
  source: z.enum(["builtin", "project"]),
  description: z.string(),
  argumentHint: z.string(),
  execution: z.enum(["template", "compact", "skill", "rename"]).nullable(),
  path: z.string().optional(),
});
export type NativeCommand = z.infer<typeof nativeCommandSchema>;
export const commandEntry = nativeCommandSchema.extend({
  identity: z.string().min(1),
  enabled: z.boolean(),
});
