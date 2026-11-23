import { AppError } from "../shared/contracts.js";
import { message as i18nMessage } from "../shared/i18n.js";
import { hostCli } from "./host-cli.js";
import { loadClaudeSdk } from "./claude-sdk.js";
import { CodexRuntime } from "./runtime.js";
import { modelTools } from "./model-tools.js";
import {
  runtimeCatalogSchema,
  type RuntimeCatalog,
} from "../shared/runtime-options.js";
/** 空输入探测仅初始化 CLI，不发送用户消息、不消耗模型推理额度。 */
export async function runtimeCatalog(
  cwd: string,
  runtime: string,
  config: any,
): Promise<RuntimeCatalog> {
  const result: RuntimeCatalog = {
    models: [],
    defaults: { model: config.model || null },
  };
  if (runtime === "codex") {
    const handle = new CodexRuntime(
      {
        event() {},
        native() {},
        interaction() {},
        done() {},
        handoff: async () => ({}),
      },
      config,
    );
    const timer = setTimeout(() => handle.close(), 15000);
    try {
      result.models = await handle.listModels(cwd);
      result.nativeModel = handle.catalogDefaultModel;
    } finally {
      clearTimeout(timer);
      handle.close();
    }
  } else {
    if (!config.baseUrl || !config.apiKey)
      throw new AppError(
        "CONFIG_REQUIRED",
        i18nMessage("connector.runtime.claudeConfig"),
      );
    const { query } = await loadClaudeSdk();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    async function* idle(): AsyncGenerator<any> {
      await new Promise<void>((resolve) => {
        if (controller.signal.aborted) resolve();
        else
          controller.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
      });
    }
    const stream = query({
      prompt: idle(),
      options: {
        pathToClaudeCodeExecutable: hostCli("claude", config),
        cwd,
        persistSession: false,
        abortController: controller,
        settingSources: ["user", "project", "local"],
        env: {
          ...process.env,
          ...(config.home ? { CLAUDE_CONFIG_DIR: config.home } : {}),
          // 由连接器管理供应商，防止 Claude 用户配置覆盖请求端点和凭据。
          CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
          ANTHROPIC_BASE_URL: config.baseUrl,
          ANTHROPIC_API_KEY: config.authType === "bearer" ? "" : config.apiKey,
          ANTHROPIC_AUTH_TOKEN:
            config.authType === "bearer" ? config.apiKey : "",
          CLAUDE_CODE_OAUTH_TOKEN: "",
        },
      },
    });
    try {
      result.models = (await stream.supportedModels()).map((m) => ({
        id: m.value,
        name: m.displayName,
        resolvedModel: m.resolvedModel,
        efforts: m.supportedEffortLevels,
        thinkingModes: m.supportsAdaptiveThinking ? ["adaptive"] : undefined,
      }));
    } finally {
      clearTimeout(timer);
      controller.abort();
      stream.close();
    }
  }
  if (runtime === "claude")
    result.nativeModel =
      result.models.find((m) => m.id === "default")?.resolvedModel || "default";
  if (config.baseUrl) {
    try {
      const remote = await modelTools(
        { read: () => ({ [runtime]: config }) } as any,
        { ...config, provider: runtime },
        "capabilities",
      );
      for (const m of ("details" in remote ? remote.details : []) || []) {
        const native = result.models.find(
          (n) => n.id === m.id || n.resolvedModel === m.id,
        );
        const capabilities = m.capabilities;
        const efforts = capabilities?.effort
          ? ["low", "medium", "high", "xhigh", "max"].filter(
              (e) => capabilities.effort[e]?.supported,
            )
          : native?.efforts;
        const types = capabilities?.thinking?.types;
        const thinkingModes = types
          ? (["adaptive", "enabled", "disabled"] as const).filter(
              (t) => types[t]?.supported,
            )
          : native?.thinkingModes;
        const item = {
          id: m.id,
          name: m.name || m.id,
          ...(native || {}),
          efforts,
          thinkingModes,
        };
        if (native) Object.assign(native, { efforts, thinkingModes });
        if (!result.models.some((n) => n.id === m.id))
          result.models.push({ ...item, id: m.id });
      }
    } catch {
      result.warningDetails = i18nMessage(
        "connector.runtime.capabilitiesUnavailable",
      );
      result.warning =
        "端点未提供模型能力信息；原生列表不保证当前端点可用，可手动输入模型 ID。";
    }
  }
  return runtimeCatalogSchema.parse(result);
}
