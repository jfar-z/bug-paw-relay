import { AppError } from "./contracts.js";
import { message as i18nMessage } from "./i18n.js";
import { z } from "zod";
/** 留空表示跟随上层配置，不把继承误写成关闭思考。 */
export const runtimeOptionsSchema = z
  .object({
    model: z.string().trim().min(1).max(512).nullable().optional(),
    effort: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,31}$/)
      .nullable()
      .optional(),
    thinking: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("adaptive") }).strict(),
        z.object({ type: z.literal("disabled") }).strict(),
        z
          .object({
            type: z.literal("enabled"),
            budgetTokens: z.number().int().min(1024).max(100000),
          })
          .strict(),
      ])
      .nullable()
      .optional(),
  })
  .strict();
export type RuntimeOptions = z.infer<typeof runtimeOptionsSchema>;
export const runtimeCatalogSchema = z.object({
  models: z
    .array(
      z.object({
        id: z.string().max(512),
        name: z.string().max(512),
        resolvedModel: z.string().optional(),
        efforts: z.array(z.string().max(32)).max(20).optional(),
        defaultEffort: z.string().optional(),
        thinkingModes: z
          .array(z.enum(["adaptive", "enabled", "disabled"]))
          .optional(),
      }),
    )
    .max(5000),
  defaults: runtimeOptionsSchema,
  nativeModel: z.string().max(512).optional(),
  warning: z.string().max(2000).optional(),
  warningDetails: z
    .object({ messageKey: z.string().max(200), messageParams: z.object({}) })
    .optional(),
});
export type RuntimeCatalog = z.infer<typeof runtimeCatalogSchema>;
/** 每一字段独立继承；原生默认保持未设置，不复制猜测值。 */
export function resolveRuntimeOptions(
  runtime: string,
  session: any,
  environment: any = {},
) {
  const agent = runtimeOptionsSchema.parse(
    session.agent?.runtimeOptions?.[runtime] || {},
  );
  const override = runtimeOptionsSchema.parse(session.runtimeOptions || {});
  const defaults = runtimeOptionsSchema.parse({
    model: environment.model || null,
  });
  const options: RuntimeOptions = {};
  const sources: Record<string, string> = {};
  for (const key of ["model", "effort", "thinking"] as const) {
    const source =
      override[key] != null
        ? "会话/阶段"
        : agent[key] != null
          ? "智能体"
          : defaults[key] != null
            ? "环境"
            : "CLI 原生默认";
    const value = override[key] ?? agent[key] ?? defaults[key];
    if (value != null) (options as any)[key] = value;
    sources[key] = source;
  }
  if (runtime === "codex" && options.thinking)
    throw new AppError(
      "UNSUPPORTED_THINKING",
      i18nMessage(
        "errors.UNSUPPORTED_THINKING.codex.does.not.support.claude.thinking",
      ),
    );
  return { options, sources };
}
/** 有显式参数时，旧连接器不能静默退回原有模型。 */
export function hasRuntimeOptions(session: any, agent: any) {
  return [
    session.runtimeOptions,
    agent?.runtimeOptions?.[session.runtime],
  ].some(
    (options) =>
      options && Object.values(options).some((value) => value != null),
  );
}
