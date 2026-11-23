import {
  translate,
  type MessageDescriptor,
  type MessageParams,
} from "./i18n.js";
import { runtimeOptionsSchema } from "./runtime-options.js";
import { attachmentsSchema } from "./uploads.js";
import { mentionsSchema } from "./mentions.js";
import { z } from "zod";
/** 跨浏览器、服务端和连接器共享的版本化业务契约。 */
export const protocolVersion = 1;
export const cliRuntimeSchema = z.enum(["codex", "claude"]);
export type CliRuntime = z.infer<typeof cliRuntimeSchema>;
export const idSchema = z.string().uuid();
/** ask 为询问模式，auto 为服务端自动批准工具权限审批，full 为原生完全权限。 */
export const permissionSchema = z.enum(["ask", "auto", "full"]);
export const directorySchema = z.object({
  environmentId: idSchema,
  rootId: z.string().min(1),
  relativePath: z.string().default("."),
});
export const projectSchema = z.object({
  name: z.string().min(1).max(100),
  directories: z.array(directorySchema).default([]),
});
export const agentSchema = z.object({
  /** 只用于新会话和新阶段初始化，不追改已保存权限。 */
  defaultPermission: permissionSchema.default("ask"),
  runtimeOptions: z
    .object({
      codex: runtimeOptionsSchema
        .refine((v) => !v.thinking, "Codex 不支持 Claude 思考方式")
        .optional(),
      claude: runtimeOptionsSchema.optional(),
    })
    .strict()
    .optional(),
  name: z.string().min(1).max(100),
  environmentId: idSchema.nullable().default(null),
  avatar: z.string().max(3000000).default(""),
  instructions: z.string().max(40000).default(""),
  /** null 表示全部 CLI；缺失字段兼容已有智能体，指定范围至少包含一项。 */
  supportedRuntimes: z
    .array(z.enum(["codex", "claude"]))
    .min(1)
    .max(2)
    .refine((values) => new Set(values).size === values.length, "CLI 不可重复")
    .nullable()
    .default(null),
  injection: z.enum(["inherit", "append", "replace"]).default("append"),
});
export const stageSchema = z.object({
  /** 服务端分配；旧客户端和未保存草稿可省略。 */
  shortId: z
    .string()
    .regex(/^S[1-9][0-9]*$/)
    .refine((v) => Number.isSafeInteger(Number(v.slice(1))))
    .optional()
    .describe("只读阶段短编号 / Read-only stage short ID; omit for new stages"),
  /** 固定起点角色独立于名称，保存后不能转移到其他阶段。 */
  fixedRole: z.literal("start").optional(),
  /** 仅系统默认名携带资源键；自定义名称省略此字段。 */
  nameKey: z.enum(["board.stage.notStarted", "board.stage.done"]).optional(),
  runtimeOptions: runtimeOptionsSchema.optional(),
  id: idSchema,
  name: z.string().min(1).max(80),
  type: z.enum(["human", "agent", "done"]),
  targets: z.array(idSchema),
  concurrency: z.number().int().min(1).max(16).default(1),
  environmentId: idSchema.nullable().default(null),
  rootId: z.string().default(""),
  relativePath: z.string().default("."),
  agentId: idSchema.nullable().default(null),
  runtime: z.enum(["codex", "claude"]).default("codex"),
  permission: permissionSchema.default("ask"),
  instructions: z.string().max(40000).default(""),
  /** 仅显式开启的 Agent 阶段允许在交接时提交文件。 */
  allowArtifacts: z.boolean().default(false),
});
/** 看板名称按 UTF-16 长度校验；先拒绝控制字符，避免 trim 掩盖换行。 */
export const boardNameSchema = z
  .string()
  .regex(
    /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]*$/u,
    "看板标题不能包含换行或控制字符",
  )
  .trim()
  .min(1, "请输入看板标题")
  .max(100, "看板标题不能超过 100 个长度单位")
  // 显式采用 JavaScript UTF-16 长度，不依赖校验库的 Unicode 计数实现。
  .refine((value) => value.length <= 100, "看板标题不能超过 100 个长度单位");
/** 标题更新只接受名称和已读取的版本，禁止夹带流程配置。 */
export const boardTitleUpdateSchema = z
  .object({
    name: boardNameSchema,
    version: z.number().int().positive(),
  })
  .strict();
export const boardSchema = z
  .object({
    name: boardNameSchema,
    projectId: idSchema,
    stages: z.array(stageSchema).min(2).max(31),
  })
  .superRefine((b, ctx) => {
    const starts = b.stages.filter((s) => s.fixedRole === "start");
    if (
      starts.length !== 1 ||
      b.stages[0] !== starts[0] ||
      starts[0]?.type !== "human"
    )
      ctx.addIssue({
        code: "custom",
        message: "必须保留唯一首位固定人工起点",
        params: { messageKey: "validation.fixedStart" },
        path: ["stages"],
      });
    const ids = new Set(b.stages.map((s) => s.id));
    if (
      ids.size !== b.stages.length ||
      b.stages.filter((s) => s.type === "done").length !== 1
    )
      ctx.addIssue({
        code: "custom",
        message: "阶段标识须唯一且必须有一个已完成阶段",
        params: { messageKey: "validation.stageUnique" },
        path: ["stages"],
      });
    for (const [index, s] of b.stages.entries()) {
      if (
        s.nameKey &&
        ((s.nameKey === "board.stage.notStarted" && s.fixedRole !== "start") ||
          (s.nameKey === "board.stage.done" && s.type !== "done") ||
          s.name !== translate("en", s.nameKey))
      )
        ctx.addIssue({
          code: "custom",
          message: "默认名称标记与阶段角色或名称不一致",
          params: { messageKey: "validation.stageNameKey" },
          path: ["stages", index, "nameKey"],
        });
      if (
        s.targets.some((t) => !ids.has(t) || t === s.id) ||
        (s.type === "done" && s.targets.length)
      )
        ctx.addIssue({
          code: "custom",
          message: "阶段流转目标无效",
          params: { messageKey: "validation.stageTarget" },
          path: ["stages", index, "targets"],
        });
      if (s.type === "agent" && (!s.environmentId || !s.rootId))
        ctx.addIssue({
          code: "custom",
          message: "Agent 阶段须指定环境和工作目录",
          params: { messageKey: "validation.stageEnvironment" },
          path: [
            "stages",
            index,
            !s.environmentId ? "environmentId" : "rootId",
          ],
        });
    }
  });
export const workItemSchema = z.object({
  boardId: idSchema,
  startStageId: idSchema.optional(),
  boardVersion: z.number().int().positive().optional(),
  operationId: idSchema.optional(),
  title: z.string().min(1).max(200),
  content: z.string().max(100000).default(""),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  tags: z.array(z.string().max(40)).max(20).default([]),
});
export const workItemEditSchema = workItemSchema
  .pick({ title: true, content: true })
  .extend({
    content: workItemSchema.shape.content.removeDefault(),
    expectedStageId: idSchema,
    expectedVersion: z.number().int().positive(),
    operationId: idSchema,
    removeAttachmentIds: z.array(z.string().min(1)).default([]),
    attachmentReceipt: z.string().min(1).max(131072).optional(),
  })
  .strict();
export const sessionSchema = z.object({
  runtimeOptions: runtimeOptionsSchema.optional(),
  title: z.string().min(1).max(100),
  projectId: idSchema,
  environmentId: idSchema,
  rootId: z.string().min(1),
  relativePath: z.string().default("."),
  runtime: z.enum(["codex", "claude"]),
  permission: permissionSchema.default("ask"),
  agentId: idSchema.nullable().default(null),
});
export const modelSchema = z.object({
  name: z.string().min(1).max(100),
  protocol: z.enum(["responses", "chat", "anthropic"]),
  baseUrl: z.url(),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  reasoning: z.enum(["none", "low", "medium", "high"]).default("none"),
  maxTokens: z.number().int().min(256).max(100000).default(4096),
  temperature: z.number().min(0).max(2).nullable().default(null),
  extra: z.record(z.string(), z.unknown()).default({}),
  contextLimit: z.number().int().min(4096).max(2000000).default(100000),
  compressionModelId: idSchema.nullable().default(null),
});
export const sendSchema = z.object({
  operationId: idSchema,
  message: z.string().max(100000),
  attachments: attachmentsSchema.default([]),
  mentions: mentionsSchema.default([]),
});
export type Stage = z.infer<typeof stageSchema>;
export type Board = z.infer<typeof boardSchema> & Entity;
export type Session = z.infer<typeof sessionSchema> &
  Entity & { status: string; executionId?: string };
export type ModelConfig = z.infer<typeof modelSchema> & Entity;
/** 工作台列表只传输侧栏与版本校验所需的元数据。 */
export interface WorkbenchSessionSummary {
  id: string;
  title: string;
  status: string;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  lastUserMessageAt: string | null;
}

export interface Entity {
  id: string;
  ownerId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}
/** 可供界面稳定判断的业务错误，避免将超时视为执行失败。 */
export class AppError extends Error {
  messageKey?: string;
  messageParams?: MessageParams;
  messages?: { "zh-CN": string; en: string };
  retryable?: boolean;
  field?: string;
  constructor(
    public code: string,
    message: string | MessageDescriptor,
    public status = 400,
  ) {
    super(
      typeof message === "string"
        ? message
        : translate("zh-CN", message.messageKey, message.messageParams),
    );
    if (typeof message !== "string") {
      this.messageKey = message.messageKey;
      this.messageParams = message.messageParams;
    }
  }
}
export function ensure(
  value: unknown,
  code: string,
  message: string | MessageDescriptor,
  status = 400,
): asserts value {
  if (!value) throw new AppError(code, message, status);
}

/** 发行包完整版本标识，包含预发提交后缀；不接受路径或任意显示文本。 */
export const connectorVersionSchema = z
  .string()
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/)
  .max(100);

/** 兼容旧配置，并统一判断智能体的 CLI 适用范围。 */
export function agentSupportsRuntime(
  agent: { supportedRuntimes?: string[] | null; [key: string]: unknown },
  runtime: string,
): boolean {
  return (
    agent.supportedRuntimes == null || agent.supportedRuntimes.includes(runtime)
  );
}

/** 选择入口同时受环境归属和 CLI 适用范围约束。 */
export function agentAvailable(
  agent: { environmentId?: string | null; supportedRuntimes?: string[] | null },
  environmentId: string,
  runtime: string,
): boolean {
  return (
    (!agent.environmentId || agent.environmentId === environmentId) &&
    agentSupportsRuntime(agent, runtime)
  );
}
