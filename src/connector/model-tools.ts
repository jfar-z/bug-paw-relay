import { message as i18nMessage } from "../shared/i18n.js";
import {
  modelDraft,
  modelSelection,
  modelOperation,
} from "../shared/environment-model-config.js";
import type { z } from "zod";
import { AppError, ensure } from "../shared/contracts.js";
import { ConnectorConfig } from "./config.js";

/** 按原生运行时的 URL 拼接规则保留代理路径，拒绝 URL 内嵌凭据。 */
function endpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      "INVALID_URL",
      i18nMessage("connector.model.invalidUrl"),
    );
  }
  ensure(
    ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "INVALID_URL",
    i18nMessage("errors.INVALID_URL.the.api.url.must.use.http"),
  );
  return url.href.replace(/\/+$/, "");
}

/** 请求有超时与大小上限；禁止重定向和透传上游错误，避免凭据泄露。 */
async function request(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  body?: unknown,
) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal,
    });
  } catch {
    throw new AppError(
      "CONNECTION_FAILED",
      i18nMessage(
        signal.aborted
          ? "connector.model.timeout"
          : "connector.model.connectionFailed",
      ),
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const key =
      response.status === 401 || response.status === 403
        ? "connector.model.authorization"
        : response.status === 404
          ? "connector.model.notFound"
          : response.status === 429
            ? "connector.model.rateLimit"
            : "connector.model.upstream";
    throw new AppError(
      "UPSTREAM_HTTP",
      i18nMessage(key, { status: response.status }),
    );
  }
  const reader = response.body?.getReader();
  ensure(
    reader,
    "EMPTY_RESPONSE",
    i18nMessage("errors.EMPTY_RESPONSE.the.api.returned.an.empty.response"),
  );
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      ensure(
        size <= 2 * 1024 * 1024,
        "RESPONSE_TOO_LARGE",
        i18nMessage("errors.RESPONSE_TOO_LARGE.the.api.response.is.too.large"),
      );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (signal.aborted)
      throw new AppError("TIMEOUT", i18nMessage("connector.model.timeout"));
    throw error;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(
      "INVALID_RESPONSE",
      i18nMessage("connector.model.invalidJson"),
    );
  }
}

/** 同端点、同认证方式才能复用已加密的凭据。 */
function resolveDraft(settings: ConnectorConfig, input: unknown) {
  const parsed = modelDraft.safeParse(input);
  ensure(
    parsed.success,
    "INVALID_CONFIG",
    i18nMessage("errors.INVALID_CONFIG.check.the.provider.api.url.and"),
  );
  const draft = parsed.data;
  if (draft.provider === "codex") draft.authType = "key";
  const base = endpoint(draft.baseUrl);
  const config = settings.read();
  const saved = config[draft.provider];
  // 更换端点后不自动发送旧密钥，避免把已有凭据提交给新服务。
  let apiKey = draft.apiKey;
  if (!apiKey && saved.apiKey) {
    ensure(
      saved.baseUrl &&
        endpoint(saved.baseUrl) === base &&
        (saved.authType ?? "key") === draft.authType,
      "KEY_REQUIRED",
      i18nMessage("errors.KEY_REQUIRED.the.api.url.has.changed.re"),
    );
    apiKey = settings.vault.open(saved.apiKey);
  }
  ensure(
    apiKey && !/[\r\n]/.test(apiKey),
    "KEY_REQUIRED",
    i18nMessage("errors.KEY_REQUIRED.enter.an.api.key"),
  );
  return { config, draft, base, apiKey };
}

/** 保存只更新指定工具。执行引擎为新会话实时读取同一份原子替换的配置。 */
export function environmentModelConfig(
  settings: ConnectorConfig,
  operation: z.infer<typeof modelOperation>,
  input: unknown,
) {
  const { provider } = modelSelection.parse(input);
  if (operation === "models" || operation === "test")
    return modelTools(settings, input, operation);
  let saved;
  if (operation === "save") {
    const { config, draft, base, apiKey } = resolveDraft(settings, input);
    ensure(
      draft.model,
      "MODEL_REQUIRED",
      i18nMessage("errors.MODEL_REQUIRED.enter.or.select.a.model.first"),
    );
    config[provider] = {
      ...config[provider],
      baseUrl: base,
      model: draft.model,
      apiKey: settings.vault.seal(apiKey),
      ...(provider === "claude" ? { authType: draft.authType } : {}),
    };
    saved = settings.save(config)[provider];
  } else {
    saved = settings.read()[provider];
  }
  // 旧版控制台可写入带用户信息或查询串的地址，不能把它们回传给平台。
  let baseUrl = "";
  try {
    if (saved.baseUrl) baseUrl = endpoint(saved.baseUrl);
  } catch {}
  return {
    provider,
    baseUrl,
    model: saved.model,
    authType: saved.authType ?? "key",
    hasKey: !!saved.apiKey,
    customEndpoint: !!saved.baseUrl,
  };
}

/** 获取供应商模型或发起最小生成请求；成功不代表完整 CLI/工具调用验收。 */
export async function modelTools(
  settings: ConnectorConfig,
  input: unknown,
  operation: "models" | "test" | "capabilities",
) {
  const { draft, base, apiKey } = resolveDraft(settings, input);
  const claude = draft.provider === "claude";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (claude) headers["anthropic-version"] = "2023-06-01";
  if (claude && draft.authType === "key") headers["x-api-key"] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;
  // Claude SDK 在 base URL 后追加 /v1；Codex 直接追加 Responses 资源路径。
  const prefix = base + (claude ? "/v1" : "");
  const signal = AbortSignal.timeout(20000);
  if (operation === "models" || operation === "capabilities") {
    const details: any[] = [];
    const models = new Set<string>();
    let after = "";
    for (let page = 0; page < 10; page++) {
      const url = new URL(prefix + "/models");
      if (claude) url.searchParams.set("limit", "100");
      if (after) url.searchParams.set("after_id", after);
      const data = await request(url.href, headers, signal);
      ensure(
        Array.isArray(data?.data),
        "INVALID_MODELS",
        i18nMessage("errors.INVALID_MODELS.the.api.did.not.return.a"),
      );
      if (operation === "capabilities")
        details.push(
          ...data.data.map((m: any) => ({
            id: m.id,
            name: m.display_name,
            capabilities: m.capabilities,
          })),
        );
      for (const item of data.data)
        if (
          typeof item?.id === "string" &&
          item.id.trim() &&
          item.id.length <= 512 &&
          !item.id.includes(apiKey)
        )
          models.add(item.id);
      ensure(
        models.size <= 5000,
        "TOO_MANY_MODELS",
        i18nMessage("errors.TOO_MANY_MODELS.too.many.models.enter.the.model"),
      );
      if (!claude || !data.has_more)
        return {
          models: [...models].sort(),
          ...(operation === "capabilities" ? { details } : {}),
        };
      ensure(
        typeof data.last_id === "string" &&
          data.last_id &&
          data.last_id !== after &&
          page < 9,
        "MODEL_PAGINATION",
        i18nMessage(
          "errors.MODEL_PAGINATION.model.pagination.is.invalid.or.excessive",
        ),
      );
      after = data.last_id;
    }
  }
  ensure(
    draft.model,
    "MODEL_REQUIRED",
    i18nMessage("errors.MODEL_REQUIRED.enter.or.select.a.model.first"),
  );
  const start = Date.now();
  const result = await request(
    prefix + (claude ? "/messages" : "/responses"),
    headers,
    signal,
    claude
      ? {
          model: draft.model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply OK." }],
        }
      : {
          model: draft.model,
          input: "Reply OK.",
          max_output_tokens: 16,
          store: false,
        },
  );
  ensure(
    claude
      ? result?.type === "message" &&
          Array.isArray(result.content) &&
          result.content.length > 0
      : result?.object === "response" &&
          ["completed", "incomplete"].includes(result.status) &&
          Array.isArray(result.output),
    "INVALID_TEST_RESPONSE",
    i18nMessage(
      "errors.INVALID_TEST_RESPONSE.unexpected.generation.response.check.the.protocol",
    ),
  );
  return {
    ok: true,
    elapsedMs: Date.now() - start,
    protocol: claude ? "Messages" : "Responses",
  };
}
