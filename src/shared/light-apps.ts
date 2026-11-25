import { z } from "zod";
import { extname } from "node:path";
import { AppError } from "./contracts.js";
import { message } from "./i18n.js";

export const lightCapability = "light-apps-v1";
export const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".avif": "image/avif",
};
// 仅接受明确列出的静态文件，排除隐藏目录、相对跳转和常见凭据名称。
export function safeAsset(path: string) {
  return (
    path.length <= 512 &&
    path
      .split("/")
      .every(
        (part) =>
          /^[\p{L}\p{N}_-][\p{L}\p{N}_. -]*$/u.test(part) &&
          !/[. ]$/.test(part) &&
          !/^(?:credentials?|secrets?|tokens?|id_rsa|service.account)(?:[._-]|$)/i.test(
            part,
          ),
      ) &&
    Object.hasOwn(mimeTypes, extname(path).toLowerCase())
  );
}
export const lifecycleCapability = "light-apps-v3";
export const appTarget = z.object({ appId: z.uuid() }).strict();
export const versionsCapability = "light-apps-v2";
export function sessionProductContext(publish: boolean, query: boolean) {
  const feature = [
    "In BugPaw Relay, a “Light App” (轻应用) has a static frontend and can bind a dedicated HTTP service running in its source environment. Users can open a version from a conversation or the Light Apps page and give feedback. Small browser games, interactive demos, and prototypes are good candidates.",
    publish &&
      "Before building a Light App, call the Light App docs tool to read its runtime constraints. A request such as “make an X Light App” is a request to build and publish it. If the user asks to publish a Light App, use the publishing tool. If you suggest publishing it yourself, ask first.",
    query &&
      "When the user refers to an earlier app or feedback, look up the relevant version in this conversation.",
    "If a Light App tool is unavailable, direct the user to the Light Apps page. Clarify ambiguous removal requests (unlist or permanently delete) and ask the user to select among ambiguous matches. Report the platform result, including pending confirmation or incomplete cleanup.",
    !publish &&
      !query &&
      "Users can ask an environment agent to publish from a conversation that supports Light App publishing.",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    "You are connected to the user through BugPaw Relay. BugPaw Relay lets users work with coding agents in their own development environments through conversations and task boards. Respond in the user’s language.\n\n" +
    feature
  );
}
export const publishInput = z
  .object({
    appId: z
      .uuid()
      .optional()
      .describe(
        "Omit on first publish. To update, use the appId from this conversation's publish result or versions tool.",
      ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        "Required on first publish (1–120 characters). Omit on update to keep the current title.",
      ),
    directory: z
      .string()
      .min(1)
      .max(512)
      .default(".")
      .describe(
        "Output directory relative to the session root (the working directory at session creation, unaffected by later shell directory changes). Defaults to '.'.",
      ),
    entry: z
      .string()
      .min(1)
      .max(512)
      .default("index.html")
      .describe("HTML entry relative to directory. Defaults to index.html."),
    backendServiceId: z.uuid().optional().describe("Optional dedicated service ID registered in this session. Read Light App backend docs before binding."),
    files: z
      .array(z.string().min(1).max(512))
      .max(128)
      .optional()
      .describe(
        "Additional credential-free static assets relative to directory. The entry is included automatically. Omit for a single file.",
      ),
  })
  .strict();
// 字段顺序保留旧版指纹的序列化顺序，旧请求重放仍可命中。
export const publishRequest = z
  .object({ operationId: z.uuid(), ...publishInput.shape })
  .strict();
export const versionsQuery = z
  .object({
    appId: z
      .uuid()
      .optional()
      .describe(
        "Filter by an appId from this conversation. Omit to list all its apps and versions.",
      ),
  })
  .strict();
export const feedbackQuery = z
  .object({
    versionId: z
      .uuid()
      .describe(
        "Version ID from this conversation's versions or publish result.",
      ),
  })
  .strict();
export function parseLightInput<T extends z.ZodType>(
  schema: T,
  args: unknown,
): z.output<T> {
  const result = schema.safeParse(args);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field =
    issue.path.join(".") ||
    (issue.code === "unrecognized_keys" ? issue.keys.join(", ") : "args");
  const detail = issue.code === "invalid_format" && issue.format === "uuid"
    ? message("light.invalidUuid", {field})
    : message("light.invalidInput", {field});
  throw Object.assign(
    new AppError("LIGHT_INPUT", detail),
    { field },
  );
}
export function lightError(
  code:
    | "LIGHT_DELETED"
    | "LIGHT_SCOPE_CHANGED"
    | "LIGHT_SCOPE"
    | "LIGHT_FILE"
    | "LIGHT_LIMIT"
    | "LIGHT_HOST"
    | "LIGHT_ACCESS"
    | "LIGHT_OFFLINE"
    | "LIGHT_CONFLICT"
    | "LIGHT_UPGRADE",
  status: number,
): never {
  throw new AppError(code, message(`errors.${code}.light`), status);
}

export function lightSandbox(prefix: string, origin: string) {
    return `sandbox allow-scripts; default-src 'none'; script-src ${prefix} 'unsafe-inline'; style-src ${prefix} 'unsafe-inline'; img-src ${prefix} data: blob:; media-src ${prefix} blob:; font-src ${prefix} data:; connect-src ${prefix}; worker-src 'none'; form-action 'none'; base-uri ${prefix}; frame-ancestors ${origin}`;
  }
export const docsQuery = z.object({ topic: z.enum(["overview", "runtime", "storage", "debugging", "backend"]).default("overview") }).strict();

export const backendCapability = "light-apps-backend-v1";
export const backendByteLimit = 64 * 1024;
export const backendPort = z.int().min(1024).max(65535);
const jsonText = z.string().max(backendByteLimit).refine(value => {
  if (Buffer.byteLength(value) > backendByteLimit) return false;
  try { JSON.parse(value); return true; } catch { return false; }
});
export const backendCall = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().max(2048).regex(/^\/(?!\/)[!-~]*$/).refine(value => !/[\\#]/.test(value)),
  body: jsonText.optional(),
}).strict().refine(call => call.method !== "GET" || call.body === undefined);
export const backendResult = z.object({
  status: z.int().min(200).max(599),
  body: jsonText.nullable(),
}).strict();
