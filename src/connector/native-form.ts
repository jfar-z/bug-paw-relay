import { isDeepStrictEqual } from "node:util";
import { ElicitRequestFormParamsSchema } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

/** 仅接受 MCP 声明的平面字段，SDK 丢弃的未知约束不能静默降级。 */
export function nativeForm(method: string, params: any) {
  if (method !== "mcpServer/elicitation/request" || params?.mode !== "form" ||
      params._meta?.codex_approval_kind || typeof params.requestedSchema !== "object" || params.requestedSchema === null) return;
  // app-server 可把 Rust 可选字段编码为 null。
  const schema = JSON.parse(JSON.stringify(params.requestedSchema, (_, v) => v === null ? undefined : v));
  delete schema.$schema;
  const parsed = ElicitRequestFormParamsSchema.safeParse({ mode: "form", message: params.message, requestedSchema: schema });
  if (!parsed.success || !isDeepStrictEqual(parsed.data.requestedSchema, schema)) return;
  const names = Object.keys(schema.properties);
  if (!names.length || schema.required?.some((key: string) => !Object.hasOwn(schema.properties, key))) return;
  try {
    const validate = new AjvJsonSchemaValidator().getValidator({ ...schema, additionalProperties: false });
    return { schema, validate };
  } catch {
    return;
  }
}
