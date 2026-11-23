import { Row, FormGrid } from "./ui/index.js";
import { feedback, caughtFeedback, type UiFeedback } from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import { Brain, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  api,
  Button,
  Field,
  Input,
  Modal,
  Select,
  runtimes,
  Alert,
} from "./ui/index.js";
import {
  resolveRuntimeOptions,
  type RuntimeOptions,
  type RuntimeCatalog,
} from "../shared/runtime-options.js";
type RuntimeEnvironment = { id: string; enabledRuntimes?: string[] };

export function enabledCliOptions(
  environments: RuntimeEnvironment[],
  environmentId?: string | null,
) {
  // 未选环境时取可用范围的并集，旧服务响应沿用默认启用。
  return runtimes.filter(({ value }) =>
    environments.some(
      (environment) =>
        (!environmentId || environment.id === environmentId) &&
        (environment.enabledRuntimes?.includes(value) ?? true),
    ),
  );
}

export function CliAvailabilityNotice({
  environmentId,
  binding = false,
}: {
  environmentId?: string | null;
  binding?: boolean;
}) {
  return (
    <Alert
      title={tr(binding ? "web.cliBindingUnavailable" : "web.cliNoneEnabled")}
    >
      <Button
        type="button"
        onClick={() => {
          location.hash = environmentId
            ? `environments/${environmentId}/tools`
            : "environments";
        }}
      >
        {tr("web.cliManageTools")}
      </Button>
    </Alert>
  );
}

/** 三个入口共用能力发现与继承语义；目录改变后丢弃迟到响应。 */
export function RuntimeOptionsEditor({
  runtime,
  environmentId,
  rootId,
  relativePath,
  value = {},
  agent,
  onChange,
  disabled = false,
  thinking = false,
  compact = false,
  expandedCompact = false,
  closeSignal = "",
}: {
  runtime: string;
  environmentId?: string;
  rootId?: string;
  relativePath?: string;
  value?: RuntimeOptions;
  agent?: any;
  onChange: (v: RuntimeOptions) => void;
  disabled?: boolean;
  thinking?: boolean;
  compact?: boolean;
  expandedCompact?: boolean;
  closeSignal?: string;
}) {
  useLocale();
  const [catalog, setCatalog] = useState<RuntimeCatalog | null>(null);
  const [error, setError] = useState<UiFeedback>("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [custom, setCustom] = useState(false);
  const [modelInput, setModelInput] = useState("");
  useEffect(() => {
    setCustom(false);
  }, [closeSignal]);
  useEffect(() => {
    let live = true;
    setCatalog(null);
    setError("");
    setCustom(false);
    if (!environmentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api(`/environments/${environmentId}/runtime-catalog`, {
      runtime,
      ...(rootId ? { rootId } : {}),
      relativePath: relativePath || ".",
    })
      .then((r) => {
        if (live) setCatalog(r);
      })
      .catch((e) => {
        if (live) setError(caughtFeedback(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [environmentId, rootId, relativePath, runtime, reload]);
  const resolved = resolveRuntimeOptions(
    runtime,
    { runtimeOptions: value, agent },
    catalog?.defaults || {},
  );
  const model = catalog?.models.find(
    (m) =>
      m.id === (resolved.options.model || catalog?.nativeModel) ||
      m.resolvedModel === (resolved.options.model || catalog?.nativeModel),
  );
  const models = (catalog?.models || []).map((m) => ({
    value: m.id,
    label: m.name === m.id ? m.id : `${m.name} · ${m.id}`,
  }));
  if (value.model && !models.some((m) => m.value === value.model))
    models.unshift({ value: value.model, label: value.model });
  const efforts = model?.efforts || [];
  const invalidEffort =
    resolved.options.effort &&
    model?.efforts &&
    !efforts.includes(resolved.options.effort);
  const changeModel = (model: string | null) => {
    onChange({ ...value, model, effort: null, thinking: null });
    setCustom(false);
  };
  return (
    <div className={compact ? "runtime-options compact" : "runtime-options"}>
      <div className={compact ? "runtime-toolbar" : "form-grid"}>
        <Field label={tr("web.model")}>
          <Select
            variant="ghost"
            label={tr("web.cliModel")}
            selectedLabel={
              compact
                ? catalog?.models.find((m) => m.id === value.model)?.name
                : undefined
            }
            closeSignal={closeSignal}
            value={value.model || ""}
            disabled={disabled}
            options={[
              { value: "", label: tr("web.useConfiguredValue") },
              ...models,
              { value: "__custom__", label: tr("web.enterModelId") },
            ]}
            onChange={(v) => {
              if (v === "__custom__") {
                setModelInput(value.model || "");
                setCustom(true);
              } else changeModel(v || null);
            }}
          />
        </Field>
        <Field label={tr("web.reasoningDepth")}>
          <Select
            label={tr("web.cliReasoningDepth")}
            closeSignal={closeSignal}
            iconOnly={compact && !expandedCompact}
            trigger={
              compact && !expandedCompact ? (
                <Brain size={18} aria-hidden="true" />
              ) : undefined
            }
            value={value.effort || ""}
            disabled={disabled}
            options={[
              { value: "", label: tr("web.useConfiguredValue") },
              ...[
                ...new Set([
                  ...efforts,
                  ...(value.effort ? [value.effort] : []),
                ]),
              ].map((e) => ({ value: e, label: e })),
            ]}
            onChange={(v) => onChange({ ...value, effort: v || null })}
          />
        </Field>
        {compact && (
          <Button
            shape={expandedCompact ? "text" : "icon"}
            placement="runtime-refresh"
            type="button"

            aria-label={tr("web.refreshModelCapabilities")}
            title={
              loading
                ? tr("web.loadingCapabilities")
                : tr("web.refreshModelCapabilities")
            }
            aria-busy={loading}
            disabled={loading || !environmentId}
            onClick={() => setReload((v) => v + 1)}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {expandedCompact && (
              <span>
                {tr(
                  loading
                    ? "web.loadingCapabilities"
                    : "web.refreshModelCapabilities",
                )}
              </span>
            )}
          </Button>
        )}
      </div>
      {compact && (error || catalog?.warning) && (
        <span className="runtime-toolbar-warning" role="status">
          {displayError(
            error ||
              catalog?.warningDetails ||
              (catalog?.warning ? feedback("common.failure") : ""),
          )}
        </span>
      )}
      {custom && (
        <Modal title={tr("web.customModel")} onClose={() => setCustom(false)}>
          <Row>
            <Input
              aria-label={tr("web.customModelId")}
              placeholder={tr("web.modelId")}
              maxLength={512}
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              disabled={disabled}
            />
            <Button
              type="button"
              disabled={disabled || !modelInput.trim()}
              onClick={() => changeModel(modelInput.trim())}
            >
              {tr("web.applyModel")}
            </Button>
            <Button type="button" onClick={() => setCustom(false)}>
              {tr("web.cancel")}
            </Button>
          </Row>
        </Modal>
      )}
      {thinking && runtime === "claude" && (
        <FormGrid>
          <Field label={tr("web.reasoningMode")}>
            <Select
              label={tr("web.claudeReasoningMode")}
              value={value.thinking?.type || ""}
              disabled={disabled}
              options={[
                { value: "", label: tr("web.useConfiguredValue") },
                ...[
                  ...new Set([
                    ...(model?.thinkingModes || []),
                    ...(value.thinking ? [value.thinking.type] : []),
                  ]),
                ].map((t) => ({
                  value: t,
                  label: {
                    adaptive: tr("web.adaptive"),
                    enabled: tr("web.fixedBudget"),
                    disabled: tr("web.disableReasoning"),
                  }[t],
                })),
              ]}
              onChange={(v) =>
                onChange({
                  ...value,
                  thinking:
                    v === "enabled"
                      ? { type: "enabled", budgetTokens: 4096 }
                      : v
                        ? { type: v as "adaptive" | "disabled" }
                        : null,
                })
              }
            />
          </Field>
          {value.thinking?.type === "enabled" && (
            <Field label={tr("web.reasoningTokenBudget")}>
              <Input
                type="number"
                min={1024}
                max={100000}
                value={value.thinking.budgetTokens}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...value,
                    thinking: {
                      type: "enabled",
                      budgetTokens: Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          )}
        </FormGrid>
      )}
      {!compact && (
        <details
          className="runtime-option-details"
          open={compact ? undefined : true}
        >
          <summary>
            {tr("web.configurationDetails")}
            {loading ? tr("web.loadingCapabilitiesAlternative543") : ""}
          </summary>
          <small className="sub">
            {tr("web.runtimeSummary", {
              model: resolved.options.model || tr("web.cliNativeDefault"),
              effort:
                resolved.options.effort || tr("web.cliNativeDefaultDepth"),
              modelSource: resolved.sources.model,
              effortSource: resolved.sources.effort,
            })}
          </small>
          {!environmentId && (
            <small className="sub">
              {tr("web.chooseAnEnvironmentToLoadAvailableModelsAndReasoning")}
            </small>
          )}
          {environmentId && (
            <Row>
              <Button
                type="button"
                disabled={loading}
                onClick={() => setReload((v) => v + 1)}
              >
                {loading
                  ? tr("web.loadingCapabilities")
                  : tr("web.refreshModelCapabilities")}
              </Button>
              <small className="sub">
                {displayError(catalog?.warningDetails || error) ||
                  (!model && !loading
                    ? tr("web.chooseASpecificModelToViewKnownReasoningLevels")
                    : "")}
              </small>
            </Row>
          )}
        </details>
      )}
      {invalidEffort && (
        <p className="error">
          {tr("web.theCurrentModelDoesNotSupportTheSelectedDepth")}
        </p>
      )}
    </div>
  );
}
/** 系统智能体可选择环境探测，环境选择仅用于读取能力，不改变智能体归属。 */
export function AgentRuntimeOptions({ form, state, onChange }: any) {
  useLocale();
  const [probe, setProbe] = useState("");
  const environmentId = form.environmentId || probe;
  const enabled = enabledCliOptions(state.environments, environmentId);
  const available = enabled.filter(
    ({ value }) =>
      !form.supportedRuntimes || form.supportedRuntimes.includes(value),
  );
  return (
    <section className="config-block">
      <h3>{tr("web.cliRuntimeConfiguration")}</h3>
      {!form.environmentId && (
        <Field label={tr("web.environmentForCapabilityLookup")}>
          <Select
            label={tr("web.environmentForCapabilityLookup")}
            value={probe}
            onChange={setProbe}
            options={[
              { value: "", label: tr("web.chooseEnvironment") },
              ...state.environments.map((e: any) => ({
                value: e.id,
                label: e.name,
              })),
            ]}
          />
        </Field>
      )}
      {!available.length && (
        <CliAvailabilityNotice
          environmentId={environmentId}
          binding={enabled.length > 0}
        />
      )}
      {available.map(({ value: runtime, label }) => (
        <details key={JSON.stringify([environmentId, runtime])}>
          <summary>{label}</summary>
          <RuntimeOptionsEditor
            runtime={runtime}
            environmentId={environmentId || undefined}
            value={form.runtimeOptions?.[runtime]}
            thinking
            onChange={(v) => onChange({ ...form.runtimeOptions, [runtime]: v })}
          />
        </details>
      ))}
    </section>
  );
}
