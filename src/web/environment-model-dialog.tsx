import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import {
  type modelDraft,
  modelResults,
} from "../shared/environment-model-config.js";
import { insecureModelEndpoint } from "../shared/model-endpoint.js";
import { api } from "./api.js";
import {
  caughtFeedback,
  displayError,
  feedback,
  t as tr,
  type UiFeedback,
} from "./locale.js";
import {
  Actions,
  Alert,
  Button,
  Dialog,
  FormField,
  FormGrid,
  Input,
  Metadata,
  Select,
} from "./ui/index.js";

type Summary = z.infer<typeof modelResults.read>;
type Draft = z.infer<typeof modelDraft>;
type Provider = Draft["provider"];
type Operation = "read" | "models" | "test" | "save";

const modelProviderNames: Record<Provider, string> = {
  codex: "Codex",
  claude: "Claude Code",
};

// 与连接器的端点归一规则保持一致，避免仅修改末尾斜线时提示重填。
function normalizedEndpoint(value: string) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return "";
    return url.href.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** 模型诊断仅提交本次草稿。卸载、切换工具或修改草稿都会使旧诊断回执失效。 */
export function EnvironmentModelDialog({
  environmentId,
  environmentName,
  provider,
  unavailable,
  onClose,
  onSaved,
}: {
  environmentId: string;
  environmentName: string;
  provider: Provider;
  unavailable?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState<Summary>();
  const [draft, setDraft] = useState<Draft>({
    provider,
    baseUrl: "",
    model: "",
    authType: "key",
    apiKey: "",
  });
  const [pending, setPending] = useState<Operation>();
  const [error, setError] = useState<UiFeedback>();
  const [notice, setNotice] = useState<UiFeedback>();
  const [models, setModels] = useState<string[]>([]);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const requestVersion = useRef(0);
  const path = `/environments/${encodeURIComponent(environmentId)}/model-config/`;
  const canReuseKey =
    !!saved?.hasKey &&
    draft.authType === saved.authType &&
    normalizedEndpoint(draft.baseUrl) === saved.baseUrl;
  const locked = pending === "save" || pending === "read";
  const credentialLabel = draft.authType === "key" ? "API Key" : "Bearer Token";

  async function run(operation: Operation) {
    const version = ++requestVersion.current;
    setError(undefined);
    setNotice(undefined);
    if (!navigator.onLine) {
      setError(feedback("environment.modelConfig.offline"));
      return;
    }
    setPending(operation);
    try {
      const result = await api(
        path + operation,
        operation === "read"
          ? { provider }
          : { ...draft, apiKey: draft.apiKey.trim() },
        "POST",
        40000,
      );
      if (requestVersion.current !== version) return;
      if (operation === "read" || operation === "save") {
        const summary = modelResults[operation].parse(result);
        setSaved(summary);
        if (!unconfirmed)
          setDraft({
            provider,
            baseUrl: summary.baseUrl,
            model: summary.model,
            authType: summary.authType,
            apiKey: "",
          });
        setUnconfirmed(false);
        setRecovered(unconfirmed);
        if (operation === "save") {
          setModels([]);
          setNotice(feedback("environment.modelConfig.saved"));
          onSaved();
        }
      } else if (operation === "models") {
        const list = modelResults.models.parse(result).models;
        setModels([...new Set(list)]);
        if (!list.length)
          setNotice(feedback("environment.modelConfig.emptyModels"));
      } else {
        const { protocol, elapsedMs } = modelResults.test.parse(result);
        setNotice(
          feedback("environment.modelConfig.testPassed", {
            protocol,
            elapsedMs,
          }),
        );
      }
    } catch (failure) {
      if (requestVersion.current !== version) return;
      // 未收到结构化服务端回执时，不能判断目标环境是否已写入。
      const code = (failure as { code?: string })?.code;
      if (operation === "save" && (!code || code === "STATUS_UNKNOWN")) {
        setUnconfirmed(true);
      } else {
        setError(caughtFeedback(failure));
      }
    } finally {
      if (requestVersion.current === version) setPending(undefined);
    }
  }

  useEffect(() => {
    if (!unavailable) void run("read");
    return () => {
      requestVersion.current++;
    };
  }, []);

  function update(change: Partial<Draft>) {
    requestVersion.current++;
    setPending(undefined);
    setError(undefined);
    setNotice(undefined);
    if ("baseUrl" in change || "authType" in change || "apiKey" in change)
      setModels([]);
    setDraft((current) => ({ ...current, ...change }));
  }

  const invalidUrl =
    !!draft.baseUrl.trim() && !normalizedEndpoint(draft.baseUrl);
  const canDiagnose =
    !unavailable &&
    !pending &&
    !!draft.baseUrl.trim() &&
    !invalidUrl &&
    (canReuseKey || !!draft.apiKey.trim());
  const canSubmit = canDiagnose && !!draft.model.trim();

  return (
    <Dialog
      title={tr("environment.modelConfig.title")}
      onClose={onClose}
      busy={pending === "save"}
    >
      <Metadata
        items={[
          { label: tr("web.developmentEnvironment"), value: environmentName },
          {
            label: tr("web.codingTools"),
            value: modelProviderNames[provider],
          },
        ]}
      />
      {unavailable && <Alert title={tr(unavailable)} />}
      {unconfirmed && (
        <Alert error title={tr("environment.modelConfig.unconfirmed")} />
      )}
      {recovered && saved && (
        <>
          <Alert title={tr("environment.modelConfig.recovered")} />
          <Metadata
            items={[
              { label: tr("web.apiBaseUrl"), value: saved.baseUrl || "—" },
              { label: tr("web.modelIdentifier"), value: saved.model || "—" },
              {
                label: tr("console.authenticationType"),
                value: saved.authType === "key" ? "API Key" : "Bearer Token",
              },
            ]}
          />
        </>
      )}
      {!saved || unconfirmed ? (
        <Actions>
          <Button
            disabled={!!pending || !!unavailable}
            onClick={() => void run("read")}
          >
            {tr(
              unconfirmed ? "environment.modelConfig.readAgain" : "web.retry",
            )}
          </Button>
        </Actions>
      ) : null}
      {saved && (
        <>
          {provider === "codex" && !saved.customEndpoint && (
            <Alert title={tr("environment.modelConfig.codexSwitch")} />
          )}
          <FormGrid>
            <FormField
              label={tr("web.apiBaseUrl")}
              required
              error={
                invalidUrl
                  ? tr("environment.modelConfig.invalidUrl")
                  : undefined
              }
              hint={
                insecureModelEndpoint(draft.baseUrl)
                  ? tr("web.httpTransmitsInPlainTextMakeSureTheNetwork")
                  : undefined
              }
            >
              <Input
                type="url"
                value={draft.baseUrl}
                disabled={locked}
                autoComplete="off"
                onChange={(event) => update({ baseUrl: event.target.value })}
              />
            </FormField>
            {provider === "claude" && (
              <FormField label={tr("console.authenticationType")}>
                <Select
                  label={tr("console.authenticationType")}
                  value={draft.authType}
                  disabled={locked}
                  options={[
                    { value: "key", label: "API Key" },
                    { value: "bearer", label: "Bearer Token" },
                  ]}
                  onChange={(value) =>
                    update({
                      authType: value === "bearer" ? "bearer" : "key",
                      apiKey: "",
                    })
                  }
                />
              </FormField>
            )}
            <FormField
              label={credentialLabel}
              required={!canReuseKey}
              hint={tr(
                canReuseKey
                  ? "environment.modelConfig.reuseCredential"
                  : saved.hasKey
                    ? "environment.modelConfig.replaceCredential"
                    : "environment.modelConfig.noCredential",
              )}
            >
              <Input
                type="password"
                autoComplete="new-password"
                maxLength={16384}
                value={draft.apiKey}
                disabled={locked}
                onChange={(event) => update({ apiKey: event.target.value })}
              />
            </FormField>
            <FormField label={tr("web.modelIdentifier")} required>
              <Input
                value={draft.model}
                autoComplete="off"
                maxLength={512}
                disabled={locked}
                onChange={(event) => update({ model: event.target.value })}
              />
            </FormField>
            {!!models.length && (
              <Select
                label={tr("environment.modelConfig.chooseModel")}
                value={draft.model}
                disabled={locked}
                searchable
                options={models.map((model) => ({
                  value: model,
                  label: model,
                }))}
                onChange={(model) => update({ model })}
              />
            )}
          </FormGrid>
          <p>{tr("environment.modelConfig.diagnostics")}</p>
        </>
      )}
      {pending && (
        <Alert title={tr(`environment.modelConfig.pending.${pending}`)} />
      )}
      {error && <Alert error title={displayError(error)} />}
      {notice && <Alert title={displayError(notice)} />}
      {saved && (
        <Actions>
          <Button disabled={!canDiagnose} onClick={() => void run("models")}>
            {tr("console.fetchModels")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void run("test")}>
            {tr("console.testConnection")}
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit || unconfirmed}
            onClick={() => void run("save")}
          >
            {tr("environment.modelConfig.apply")}
          </Button>
        </Actions>
      )}
    </Dialog>
  );
}
