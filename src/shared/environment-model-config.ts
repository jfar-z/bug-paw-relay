import { z } from "zod";

/** 环境详情只允许配置模型字段，不接受命令、目录或节点身份。 */
export const modelConfigCapability = "environment-model-config-v1";
export const modelOperation = z.enum(["read", "models", "test", "save"]);
export const modelSelection = z.object({
  provider: z.enum(["codex", "claude"]),
});
export const modelDraft = modelSelection.extend({
  baseUrl: z.string().trim().min(1),
  apiKey: z.string().max(16384).default(""),
  model: z.string().trim().max(512).default(""),
  authType: z.enum(["key", "bearer"]).default("key"),
});
const summary = modelSelection.extend({
  baseUrl: z.string(),
  model: z.string(),
  authType: z.enum(["key", "bearer"]),
  hasKey: z.boolean(),
  customEndpoint: z.boolean(),
});
export const modelResults = {
  read: summary,
  save: summary,
  models: z.object({ models: z.array(z.string().max(512)).max(5000) }),
  test: z.object({
    ok: z.literal(true),
    elapsedMs: z.number(),
    protocol: z.enum(["Responses", "Messages"]),
  }),
};
