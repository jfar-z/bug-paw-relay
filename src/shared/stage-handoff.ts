import { stageName } from "./board-stages.js";
import { messages, type Locale } from "./i18n.js";
import { z } from "zod";
import { AppError } from "./contracts.js";

export const boardSessionTitleCapability = "board-session-title-v1";
export const handoffCapability = "stage-handoff-short-id-v1";
/** 新增可见文案集中维护双语；协议值和用户阶段名称不翻译。 */
export const handoffMessages = {
  ITEM_ADVANCE_CONFLICT: messages["handoff.ITEM_ADVANCE_CONFLICT"],
  INVALID_HANDOFF_TARGET: messages["handoff.INVALID_HANDOFF_TARGET"],
  HANDOFF_SNAPSHOT_INVALID: messages["handoff.HANDOFF_SNAPSHOT_INVALID"],
  HANDOFF_CONTRACT_UNSUPPORTED:
    messages["handoff.HANDOFF_CONTRACT_UNSUPPORTED"],
  STAGE_SHORT_ID_INVALID: messages["handoff.STAGE_SHORT_ID_INVALID"],
  STAGE_SHORT_ID_EXHAUSTED: messages["handoff.STAGE_SHORT_ID_EXHAUSTED"],
  CONNECTOR_UPGRADE: messages["handoff.CONNECTOR_UPGRADE"],
  stageContext: messages["handoff.stageContext"],
  tool: messages["handoff.tool"],
  noTargets: messages["handoff.noTargets"],
} as const;
export function handoffError(
  code: keyof typeof handoffMessages,
  field?: string,
): never {
  const error = new AppError(code, handoffMessages[code]["zh-CN"], 409);
  Object.assign(error, {
    messageKey: `handoff.${code}`,
    messages: handoffMessages[code],
    retryable: false,
    ...(field ? { field } : {}),
  });
  throw error;
}
export const shortIdSchema = z
  .string()
  .regex(/^S[1-9][0-9]*$/)
  .refine((v) => Number.isSafeInteger(Number(v.slice(1))));
const descriptorSchema = z.object({
  id: z.string().uuid(),
  shortId: shortIdSchema,
  name: z.string().min(1),
  nameKey: z.enum(["board.stage.notStarted", "board.stage.done"]).optional(),
  type: z.enum(["human", "agent", "done"]),
});
export const handoffSnapshotSchema = z
  .object({
    handoffContractVersion: z.literal(2),
    boardId: z.string().uuid(),
    currentStage: descriptorSchema,
    allowedTargets: z.array(descriptorSchema),
  })
  .superRefine((v, ctx) => {
    const all = [v.currentStage, ...v.allowedTargets];
    if (
      new Set(all.map((s) => s.id)).size !== all.length ||
      new Set(all.map((s) => s.shortId)).size !== all.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate stage mapping" });
  });
/** 可信映射只在服务端入队时建立；恢复时验证而不重建。 */
export function stageDescriptor(stage: any) {
  return descriptorSchema.parse(stage);
}
export function readHandoff(snapshot: any) {
  if (snapshot.handoffContractVersion !== 2)
    handoffError("HANDOFF_CONTRACT_UNSUPPORTED");
  const parsed = handoffSnapshotSchema.safeParse(snapshot);
  if (
    !parsed.success ||
    parsed.data.currentStage.id !== snapshot.stage?.id ||
    JSON.stringify(parsed.data.allowedTargets.map((s) => s.id)) !==
      JSON.stringify(snapshot.stage.targets)
  )
    handoffError("HANDOFF_SNAPSHOT_INVALID");
  return parsed.data;
}
/** 下发投影不包含可供模型误用的 UUID 映射。 */
export function handoffProjection(snapshot: any) {
  const v = readHandoff(snapshot);
  const visible = ({ id, ...descriptor }: typeof v.currentStage) => descriptor;
  return {
    handoffContractVersion: 2,
    ...(snapshot.locale ? { locale: snapshot.locale } : {}),
    currentStage: visible(v.currentStage),
    allowedTargets: v.allowedTargets.map(visible),
  };
}
/** 两个运行时共享目标与上下文，空出口不注册工具。 */
export function workflowTargets(workflow: any): string[] {
  if (!workflow) return [];
  if (workflow.handoffContractVersion !== 2)
    handoffError("HANDOFF_CONTRACT_UNSUPPORTED");
  const visible = descriptorSchema.omit({ id: true });
  if (
    !visible.safeParse(workflow.currentStage).success ||
    !z.array(visible).safeParse(workflow.allowedTargets).success
  )
    handoffError("HANDOFF_SNAPSHOT_INVALID");
  const ids = workflow.allowedTargets.map((s: any) => s.shortId);
  if (
    new Set(ids).size !== ids.length ||
    ids.includes(workflow.currentStage.shortId)
  )
    handoffError("HANDOFF_SNAPSHOT_INVALID");
  return ids;
}
/** 旧执行没有语言快照，继续生成原双语包装以保持重放一致。 */
export function handoffLabel(key: keyof typeof messages, locale?: Locale) {
  if (locale === "en" || locale === "zh-CN") return messages[key][locale];
  return `${messages[key]["zh-CN"]} / ${messages[key].en}`;
}

/** 动态围栏完整容纳原文中的标题、表格及代码块，防止吞并后续记录。 */
function fenced(text: string) {
  const length =
    Array.from(text.matchAll(/`+/g)).reduce(
      (max, match) => Math.max(max, match[0].length),
      2,
    ) + 1;
  const fence = "`".repeat(length);
  return `${fence}markdown\n${text}\n${fence}`;
}

/** 元信息转义为单行 Markdown 文本，避免名称伪造章节；不改写用户正文。 */
function inline(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]/g, (c) => (c === "\r" ? "&#13;" : "&#10;"))
    .replace(/[\\`*_[\]{}()#+.!|~-]/g, "\\$&");
}

function visibleStage(value: any, locale?: Locale) {
  const parsed = descriptorSchema.omit({ id: true }).safeParse(value);
  if (!parsed.success) return handoffLabel("handoff.unknownStage", locale);
  const { shortId, name, type } = parsed.data;
  return `${shortId} · ${inline(locale ? stageName(parsed.data, locale) : name)} · ${handoffLabel(`handoff.${type}`, locale)}`;
}

/** 仅呈现历史白名单字段；复制后稳定排序，不修改原始账本或冻结快照。 */
export function attachmentHistoryText(attachments: any[], locale?: Locale) {
  return [
    handoffLabel("handoff.attachments", locale),
    fenced(
      JSON.stringify(
        attachments.map(
          ({ name, environmentName, environmentId, cwd, path }) => ({
            name,
            environment: environmentName,
            environmentId,
            cwd,
            path,
          }),
        ),
        null,
        2,
      ),
    ),
  ].join("\n\n");
}

function historyMarkdown(handoffs: any[] = [], locale?: Locale) {
  if (!handoffs.length) return handoffLabel("handoff.noHistory", locale);
  const timestamp = (value: any) => {
    const time =
      typeof value.createdAt === "string" ? Date.parse(value.createdAt) : NaN;
    return Number.isFinite(time) ? time : Infinity;
  };
  return [...handoffs]
    .sort((a, b) => timestamp(a) - timestamp(b))
    .map((entry, index) => {
      const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : [];
      return [
        `### ${index + 1}. ${entry.createdAt ? inline(entry.createdAt) : handoffLabel("handoff.unknownTime", locale)}`,
        entry.kind === "created"
          ? handoffLabel("handoff.created", locale)
          : entry.kind === "edited"
            ? handoffLabel("handoff.edited", locale)
            : `${handoffLabel("handoff.from", locale)}: ${visibleStage(entry.fromStage, locale)}`,
        `${handoffLabel("handoff.to", locale)}: ${visibleStage(entry.toStage, locale)}`,
        `**${handoffLabel("handoff.record", locale)}**`,
        fenced(entry.record ?? ""),
        ...(entry.attachments?.length
          ? [attachmentHistoryText(entry.attachments, locale)]
          : []),
        ...(artifacts.length
          ? [
              `**${handoffLabel("handoff.artifacts", locale)}**`,
              artifacts
                .map(
                  (artifact: any) =>
                    `- ${typeof artifact?.name === "string" && artifact.name.trim() ? inline(artifact.name) : handoffLabel("handoff.unnamed", locale)}`,
                )
                .join("\n"),
            ]
          : []),
      ].join("\n\n");
    })
    .join("\n\n---\n\n");
}

/** 用同一套标题、动态围栏和结尾精确识别原生消息，只抵消整条需求。 */
export function matchesWorkflowInput(prompt: string, text: string) {
  const ending = prompt.slice(prompt.lastIndexOf("\n\n") + 2);
  for (const locale of [undefined, "zh-CN", "en"] as const) {
    const endings = [
      "handoff.noTargets",
      "handoff.callCodex",
      "handoff.callClaude",
    ] as const;
    if (!endings.some((key) => handoffLabel(key, locale) === ending)) continue;
    const heading = (key: keyof typeof messages) =>
      `\n\n## ${handoffLabel(key, locale)}\n\n`;
    return (
      [
        "handoff.currentStage",
        "handoff.allowedTargets",
        "handoff.history",
        "handoff.workItem",
      ].every((key) =>
        prompt.includes(heading(key as keyof typeof messages)),
      ) &&
      prompt.endsWith(
        heading("handoff.request") + fenced(text) + "\n\n" + ending,
      )
    );
  }
  return false;
}

export function workflowPrompt(
  workflow: any,
  message: string,
  runtime: "codex" | "claude",
) {
  if (!workflow) return message;
  workflowTargets(workflow);
  if (workflow.manualContinuation) return message;
  const locale: Locale | undefined = workflow.locale;
  const allowed = workflow.allowedTargets.map(
    (stage: any) => `- ${visibleStage(stage, locale)}`,
  );
  const ending = !allowed.length
    ? handoffLabel("handoff.noTargets", locale)
    : handoffLabel(
        runtime === "codex" ? "handoff.callCodex" : "handoff.callClaude",
        locale,
      );
  return [
    workflow.instructions,
    `## ${handoffLabel("handoff.currentStage", locale)}`,
    `- ${visibleStage(workflow.currentStage, locale)}`,
    `## ${handoffLabel("handoff.allowedTargets", locale)}`,
    allowed.length
      ? allowed.join("\n")
      : handoffLabel("handoff.emptyTargets", locale),
    `## ${handoffLabel("handoff.history", locale)}`,
    historyMarkdown(workflow.handoffs, locale),
    `## ${handoffLabel("handoff.workItem", locale)}`,
    // 旧续发快照可能没有标题，保持空值兼容而不生成虚构内容。
    fenced(workflow.title ?? ""),
    `## ${handoffLabel("handoff.request", locale)}`,
    fenced(message),
    ending,
  ].join("\n\n");
}
