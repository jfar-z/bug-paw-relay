import { CommandsDialog, type CommandProject } from "./slash-commands.js";
import { useEffect, useState } from "react";
import { Plus, ArrowLeft, Filter } from "lucide-react";
import {
  claudeSdkStatus,
  claudeSdkCapability,
} from "../shared/claude-sdk-install.js";
import { EnvironmentTraffic } from "./environment-traffic.js";
import {
  metricsCapability,
  type ResourceSummary,
} from "../shared/environment-metrics.js";
import {
  modelResults,
  modelConfigCapability,
} from "../shared/environment-model-config.js";
import { EnvironmentModelDialog } from "./environment-model-dialog.js";
import { api } from "./api.js";
import {
  t as tr,
  useLocale,
  currentLocale,
  caughtFeedback,
  displayError,
  type UiFeedback,
} from "./locale.js";
import { ConnectorVersion } from "./connector-version.js";
import {
  Button,
  CollectionLayout,
  Page,
  PageHeader,
  CardGrid,
  ResponsiveList,
  Utilization,
  byteAmount,
  Badge,
  InfoBadge,
  Metadata,
  Actions,
  Panel,
  Sections,
  SearchInput,
  IconSelect,
  EmptyState,
  Alert,
  Disclosure,
  runtimes,
} from "./ui/index.js";

// 新连接器提供可本地化的诊断，旧连接器只上报就绪状态。
function toolStatus(tool: any) {
  if (!tool) return tr("web.waitingForConnectorToolStatus");
  return tool.available
    ? tr("web.available")
    : tr(tool.messageKey || "web.notConfigured", tool.messageParams);
}

/** 页面重开、连接恢复及手动检测都只查询状态，安装由用户主动触发。 */
function ClaudeSdkInstall({
  environmentId,
  name,
  unavailable,
  onChecked,
}: {
  environmentId: string;
  name: string;
  unavailable?: string;
  onChecked: () => void;
}) {
  const path = `/environments/${environmentId}/claude-sdk`;
  const [status, setStatus] = useState<typeof claudeSdkStatus._output>();
  const [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<UiFeedback>("");
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine);
    window.addEventListener("offline", update);
    window.addEventListener("online", update);
    return () => {
      window.removeEventListener("offline", update);
      window.removeEventListener("online", update);
    };
  }, []);
  const blocked =
    unavailable || (!browserOnline ? "web.sdk.offline" : undefined);
  useEffect(() => {
    let current = true;
    setStatus(undefined);
    setChecking(!blocked);
    if (!blocked) {
      api(path)
        .then((value) => {
          if (current) {
            setStatus(claudeSdkStatus.parse(value));
            setError("");
          }
        })
        .catch((failure) => {
          if (current) setError(caughtFeedback(failure));
        })
        .finally(() => {
          if (current) setChecking(false);
        });
    }
    return () => {
      current = false;
    };
  }, [path, blocked, revision]);

  function check() {
    setError("");
    setChecking(true);
    setRevision((value) => value + 1);
    onChecked();
  }
  const eligible =
    status?.mode === "custom" &&
    status.state === "missing" &&
    !status.installing;
  async function install() {
    if (!eligible || blocked || posting || checking) return;
    setPosting(true);
    setError("");
    try {
      await api(path, {});
      check();
    } catch (failure) {
      const code = (failure as { code?: string })?.code;
      setStatus(undefined);
      setError(
        !code || code === "STATUS_UNKNOWN"
          ? { messageKey: "connector.support.unconfirmed" }
          : caughtFeedback(failure),
      );
    } finally {
      setPosting(false);
    }
  }

  const message =
    blocked ||
    (posting || status?.installing
      ? "web.sdk.installing"
      : checking
        ? "connector.support.check"
        : status?.mode === "environment"
          ? "connector.support.notRequired"
          : status?.state === "installed"
            ? "web.sdk.installed"
            : eligible
              ? "web.claudeSdkMissing"
              : "connector.support.unknown");
  return (
    <>
      <p role="status">{tr(message)}</p>
      {error && <Alert error title={displayError(error)} />}
      {posting && blocked && (
        <p role="status">{tr("connector.support.unconfirmed")}</p>
      )}
      {!blocked && eligible && (
        <p>{tr("web.sdk.target", { name, version: status.version })}</p>
      )}
      <Actions>
        {!blocked && eligible && (
          <Button
            variant="primary"
            disabled={posting || checking}
            onClick={install}
          >
            {tr("web.sdk.install")}
          </Button>
        )}
        {!blocked && (
          <Button disabled={posting || checking} onClick={check}>
            {tr("web.sdk.check")}
          </Button>
        )}
      </Actions>
      {status?.mode !== "environment" && status?.state !== "installed" && (
        <p>{tr("web.claudeSdkInstallHelp")}</p>
      )}
    </>
  );
}

function RuntimeSettings({
  projects,
  environmentId,
  environmentName,
  sdkUnavailable,
  modelConfigUnavailable,
  tools,
  onSaved,
}: {
  environmentId: string;
  environmentName: string;
  projects: CommandProject[];
  sdkUnavailable?: string;
  modelConfigUnavailable?: string;
  tools?: Record<
    string,
    { version?: string; available: boolean; mode?: string }
  >;
  onSaved: () => Promise<void>;
}) {
  useLocale();
  const [settings, setSettings] = useState<{
    enabledRuntimes: string[];
    tools: Record<
      string,
      { version?: string; available: boolean; mode?: string }
    >;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<UiFeedback>("");
  const [saving, setSaving] = useState(false);
  const [commandRuntime, setCommandRuntime] = useState("");
  const [modelProvider, setModelProvider] = useState<"codex" | "claude">();
  const path = `/environments/${environmentId}/runtime-settings`;
  useEffect(() => {
    let current = true;
    api(path)
      .then((value) => {
        if (current) setSettings(value);
      })
      .catch((failure) => {
        if (current) setError(caughtFeedback(failure));
      });
    return () => {
      current = false;
    };
  }, [path, attempt, sdkUnavailable]);

  // 只采用服务端确认的设置，保存失败时保留上次确认值。
  async function update(runtime: string, enabled: boolean) {
    setSaving(true);
    setError("");
    try {
      setSettings(await api(path, { runtime, enabled }, "PATCH"));
      await onSaved();
    } catch (failure) {
      setError(caughtFeedback(failure as Error));
    } finally {
      setSaving(false);
    }
  }

  const [summaryRevision, setSummaryRevision] = useState(0);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    setSummaries({});
    if (settings && !modelConfigUnavailable) {
      for (const provider of ["codex", "claude"]) {
        api(`/environments/${environmentId}/model-config/read`, { provider })
          .then((value) => {
            const config = modelResults.read.parse(value);
            let label = "monitor.pending";
            if (
              provider === "claude" &&
              settings?.tools.claude?.mode === "environment"
            )
              label = "monitor.environment";
            else if (provider === "codex" && !config.customEndpoint)
              label = "monitor.local";
            else if (config.customEndpoint && config.hasKey && config.model)
              label = "monitor.configured";
            else if (provider === "claude" && !settings?.tools.claude?.mode)
              label = "monitor.unknown";
            if (active)
              setSummaries((previous) => ({ ...previous, [provider]: label }));
          })
          .catch(() => {
            // 某一工具读取失败时保留未知，另一项仍可独立显示。
            if (active)
              setSummaries((previous) => ({
                ...previous,
                [provider]: "monitor.unknown",
              }));
          });
      }
    }
    return () => {
      active = false;
    };
  }, [environmentId, modelConfigUnavailable, summaryRevision, settings]);

  return (
    <Panel title={tr("web.codingTools")}>
      <p>{tr("web.cliPolicyHelp")}</p>
      {modelConfigUnavailable && <Alert title={tr(modelConfigUnavailable)} />}
      {error && (
        <Alert
          error
          title={tr(
            settings
              ? "web.cliSettingsSaveFailed"
              : "web.cliSettingsLoadFailed",
          )}
        >
          {displayError(error)}
        </Alert>
      )}
      {!settings &&
        (error ? (
          <Button
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            {tr("web.retry")}
          </Button>
        ) : (
          <p role="status">{tr("web.cliSettingsLoading")}</p>
        ))}
      {settings && (
        <ResponsiveList
          label={tr("web.codingTools")}
          columns={[
            tr("monitor.tool"),
            tr("monitor.version"),
            tr("monitor.enabled"),
            tr("monitor.availability"),
            tr("monitor.config"),
            tr("monitor.actions"),
          ]}
          rows={runtimes.map(({ value, label }) => {
            const enabled = settings.enabledRuntimes.includes(value);
            const tool = tools?.[value] ?? settings.tools[value];
            const provider =
              value === "codex" || value === "claude" ? value : undefined;
            return {
              id: value,
              cells: [
                <Button
                  variant="ghost"
                  onClick={() => setModelProvider(provider)}
                >
                  {label}
                </Button>,
                tool?.version || tr("web.versionNotReported"),
                <Badge tone={enabled ? "good" : "neutral"}>
                  {tr(enabled ? "web.cliEnabled" : "web.cliDisabled")}
                </Badge>,
                tool ? (
                  tool.available ? (
                    tr("web.available")
                  ) : (
                    <>
                      {tr("monitor.unavailable")} · {toolStatus(tool)}
                    </>
                  )
                ) : (
                  tr("monitor.unknown")
                ),
                tr(
                  (!modelConfigUnavailable && summaries[value]) ||
                    "monitor.unknown",
                ),
                <>
                  <Actions>
                    <Button
                      aria-disabled={saving}
                      onClick={() => {
                        if (!saving) void update(value, !enabled);
                      }}
                    >
                      {tr(
                        enabled ? "web.cliDisableTool" : "web.cliEnableTool",
                        {
                          tool: label,
                        },
                      )}
                    </Button>
                    <Button onClick={() => setCommandRuntime(value)}>
                      {tr("web.commands.title")}
                    </Button>
                    {provider && (
                      <Button onClick={() => setModelProvider(provider)}>
                        {tr("environment.modelConfig.open", { tool: label })}
                      </Button>
                    )}
                  </Actions>
                  {value === "claude" && enabled && (
                    <ClaudeSdkInstall
                      environmentId={environmentId}
                      name={environmentName}
                      unavailable={sdkUnavailable}
                      onChecked={() => {
                        setAttempt((value) => value + 1);
                        void onSaved().catch((failure) =>
                          setError(caughtFeedback(failure)),
                        );
                      }}
                    />
                  )}
                </>,
              ],
            };
          })}
        />
      )}
      {saving && <p role="status">{tr("web.cliSettingsSaving")}</p>}
      {commandRuntime && (
        <CommandsDialog
          environmentId={environmentId}
          environmentName={environmentName}
          runtime={commandRuntime}
          projects={projects}
          onClose={() => setCommandRuntime("")}
        />
      )}
      {modelProvider && (
        <EnvironmentModelDialog
          key={modelProvider}
          environmentId={environmentId}
          environmentName={environmentName}
          provider={modelProvider}
          unavailable={modelConfigUnavailable}
          onClose={() => setModelProvider(undefined)}
          onSaved={async () => {
            setSummaryRevision((n) => n + 1);
            await onSaved();
          }}
        />
      )}
    </Panel>
  );
}

/** 环境业务沿用现有接口与权限，页面仅组合正式组件，不自建控件样式。 */
export function EnvironmentsPage({
  state,
  selected,
  action,
  confirm,
  onInvite,
  onRefresh,
  openTools,
}: any) {
  useLocale();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    history.state?.blockerEnvironment
      ? { [history.state.blockerEnvironment]: true }
      : {},
  );
  const [otherTab, setTab] = useState("overview");
  const tab = openTools ? "tools" : otherTab;
  const selectTab = (value: string) => {
    setTab(value === "tools" ? "overview" : value);
    location.hash =
      "environments/" + selected + (value === "tools" ? "/tools" : "");
  };
  const environment = state.environments.find((e: any) => e.id === selected);
  const status = (e: any) =>
    e.revoked
      ? tr("web.identityRevoked")
      : !e.approved
        ? tr("web.awaitingApproval")
        : e.online
          ? tr("web.online")
          : tr("web.offline");
  const statusBadge = (e: any) => (
    <Badge
      tone={
        e.revoked
          ? "danger"
          : !e.approved
            ? "warning"
            : e.online
              ? "good"
              : "neutral"
      }
    >
      {status(e)}
    </Badge>
  );
  const seen = (e: any) =>
    e.lastSeen
      ? new Date(e.lastSeen).toLocaleString(currentLocale())
      : tr("web.notConnectedYet");
  const tools = (e: any) => (
    <Actions>
      {Object.entries(e.tools || {}).map(([name, tool]: any) =>
        name === "claude" &&
        tool?.available === false &&
        tool.messageKey === "connector.support.required" ? (
          <InfoBadge key={name} label={tr("web.claudeSdkMissing")}>
            {tr("web.claudeSdkInstallHelp")}
            <Button
              onClick={() => {
                location.hash = "environments/" + e.id + "/tools";
              }}
            >
              {tr("web.cliManageTools")}
            </Button>
          </InfoBadge>
        ) : tool?.available === false ? (
          <InfoBadge key={name} label={name + " · " + tr("monitor.unavailable")}>
            {toolStatus(tool)}
          </InfoBadge>
        ) : (
          <Badge key={name}>
            {name} · {toolStatus(tool)}
          </Badge>
        ),
      )}
    </Actions>
  );
  const approve = (e: any) =>
    !e.approved && !e.revoked ? (
      <Button
        variant="primary"
        onClick={() => action(() => api(`/environments/${e.id}/approve`, {}))}
      >
        {tr("web.approveAccess")}
      </Button>
    ) : null;
  if (environment) {
    const e = environment;
    const modelConfigUnavailable = e.revoked
      ? "errors.REVOKED.the.environment.identity.has.been.revoked"
      : !e.approved
        ? "errors.FORBIDDEN.the.environment.is.not.accessible"
        : !e.online
          ? "environment.modelConfig.offline"
          : !e.capabilities?.includes(modelConfigCapability)
            ? "environment.modelConfig.upgrade"
            : undefined;
    const projects = state.projects.filter((p: any) =>
      p.directories.some((d: any) => d.environmentId === e.id),
    );
    return (
      <Page>
        <Button
          variant="ghost"
          onClick={() => {
            location.hash = "environments";
            setTab("overview");
          }}
        >
          <ArrowLeft aria-hidden="true" />
          {tr("web.backToEnvironments")}
        </Button>
        <PageHeader
          title={e.name}
          description={
            e.platform || tr("web.waitingForConnectorPlatformInformation")
          }
          actions={
            <>
              {approve(e)}
              {!e.revoked && (
                <Button
                  variant="danger"
                  onClick={() =>
                    confirm(
                      tr(
                        "web.revokeThisEnvironmentIdentityTasksAlreadyRunningLocallyWill",
                      ),
                      () => api(`/environments/${e.id}/revoke`, {}),
                    )
                  }
                >
                  {tr("web.revokeIdentity")}
                </Button>
              )}
            </>
          }
        />
        {statusBadge(e)}
        {!e.online && (
          <Alert title={status(e)}>
            {tr("web.workspaceRootsAndToolStatusSyncWhenTheConnector")}
          </Alert>
        )}
        <Sections
          label={tr("web.developmentEnvironment")}
          value={tab}
          onChange={selectTab}
          items={[
            { value: "overview", label: tr("web.overview") },
            {
              value: "directories",
              label: tr("web.directoriesAlternative464"),
            },
            { value: "tools", label: tr("web.codingTools") },
          ]}
        />
        {tab === "overview" && (
          <CardGrid>
            <Panel title={tr("web.connectionInformation")}>
              <Metadata
                items={[
                  { label: tr("web.connectionStatus"), value: status(e) },
                  { label: tr("web.lastConnected"), value: seen(e) },
                  {
                    label: tr("web.workspaceRoots"),
                    value: e.roots?.length || 0,
                  },
                ]}
              />
              {tools(e)}
              <ConnectorVersion key={e.id} environment={e} />
            </Panel>
            <Panel title={tr("web.linkedProjects")}>
              {projects.map((p: any) => (
                <Panel key={p.id} title={p.name}>
                  <Metadata
                    items={[
                      {
                        label: tr("web.directoryReferences"),
                        value: p.directories.filter(
                          (d: any) => d.environmentId === e.id,
                        ).length,
                      },
                    ]}
                  />
                  <Button
                    onClick={() => {
                      location.hash = "chat";
                    }}
                  >
                    {tr("web.viewSessions")}
                  </Button>
                </Panel>
              ))}
              {!projects.length && (
                <p>{tr("web.noLinkedProjectsAddOneInProjectManagementOn")}</p>
              )}
            </Panel>
          </CardGrid>
        )}
        {tab === "overview" && e.approved && !e.revoked && (
          <EnvironmentTraffic
            key={e.id}
            id={e.id}
            supported={!!e.capabilities?.includes(metricsCapability)}
          />
        )}
        {tab === "directories" && (
          <Panel title={tr("web.workspaceRoots")}>
            <p>{tr("web.savedAndReportedByTheClientTheServerDoes")}</p>
            {e.roots?.map((r: any) => (
              <Disclosure
                key={r.id}
                label={r.path.split(/[\\/]/).filter(Boolean).at(-1) || r.path}
              >
                <Metadata
                  items={[
                    { label: tr("ui.fullPath"), value: <code>{r.path}</code> },
                    { label: "ID", value: r.id },
                  ]}
                />
              </Disclosure>
            ))}
            {!e.roots?.length && (
              <p>{tr("web.waitingForTheClientToConnectAndSyncWorkspace")}</p>
            )}
          </Panel>
        )}
        {tab === "tools" && (
          <RuntimeSettings
            projects={projects}
            key={e.id}
            environmentId={e.id}
            environmentName={e.name}
            sdkUnavailable={
              e.revoked || !e.approved
                ? modelConfigUnavailable
                : !e.online
                  ? "web.sdk.offline"
                  : !e.capabilities?.includes(claudeSdkCapability)
                    ? "connector.support.upgrade"
                    : undefined
            }
            modelConfigUnavailable={modelConfigUnavailable}
            tools={e.tools}
            onSaved={onRefresh}
          />
        )}
      </Page>
    );
  }
  const visible = state.environments.filter(
    (e: any) =>
      e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (!filter || (filter === "online" ? e.online : !e.online)),
  );
  const filtered = !!query || !!filter;
  return (
    <CollectionLayout
      title={tr("web.developmentEnvironment")}
      description={tr(
        "web.connectYourDevelopmentMachinesAndRunTasksInFamiliar",
      )}
      actions={
        <Button variant="primary" onClick={onInvite}>
          <Plus aria-hidden="true" />
          {tr("web.connectEnvironment")}
        </Button>
      }
      summary={
        <>
          {tr("ui.environmentSummary", {
            total: state.environments.length,
            online: state.environments.filter((e: any) => e.online).length,
            pending: state.environments.filter(
              (e: any) => !e.approved && !e.revoked,
            ).length,
          })}
        </>
      }
      toolbar={
        <>
          <SearchInput
            label={tr("web.searchEnvironments")}
            value={query}
            onChange={setQuery}
          />
          <IconSelect
            label={tr("web.connectionStatus")}
            value={filter}
            onChange={setFilter}
            icon={<Filter aria-hidden="true" />}
            mark={filter ? "1" : undefined}
            options={[
              { value: "", label: tr("web.allStatuses") },
              { value: "online", label: tr("web.online") },
              { value: "offline", label: tr("web.offline") },
            ]}
          />
        </>
      }
    >
      {!!visible.length && (
        <ResponsiveList
          label={tr("web.developmentEnvironment")}
          columns={[
            tr("web.developmentEnvironment"),
            tr("monitor.system"),
            tr("web.connectionStatus"),
            tr("monitor.connector"),
            "CPU",
            tr("monitor.memory"),
            tr("monitor.disk"),
          ]}
          rows={visible.map((e: any) => {
            const supported = e.capabilities?.includes(metricsCapability);
            const resources: ResourceSummary | undefined = supported
              ? e.resources
              : undefined;
            const unknown = tr("monitor.unknown");
            const versionStatus = e.connectorUpdate?.status;
            return {
              id: e.id,
              detail: expanded[e.id] && (
                <ConnectorVersion environment={e} compact />
              ),
              cells: [
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      location.hash = "environments/" + e.id;
                      setTab("overview");
                    }}
                  >
                    <span>{e.name}</span>
                  </Button>
                  {tools(e)}
                </>,
                e.platform || unknown,
                <>
                  {statusBadge(e)}
                  {approve(e)}
                </>,
                <>
                  {e.connectorVersion || unknown}
                  <br />
                  {e.connectorVersion && (
                    <div>
                      {tr(
                        versionStatus === "current"
                          ? "monitor.current"
                          : versionStatus === "different"
                            ? "monitor.different"
                            : "monitor.unknown",
                      )}
                    </div>
                  )}
                  <Button
                    size="small"
                    aria-expanded={!!expanded[e.id]}
                    onClick={() =>
                      setExpanded((previous) => ({
                        ...previous,
                        [e.id]: !previous[e.id],
                      }))
                    }
                  >
                    {tr("monitor.versionDetails")}
                  </Button>
                </>,
                <Utilization label="CPU" value={resources?.cpuPercent} />,
                <Utilization
                  label={tr("monitor.memory")}
                  value={resources?.memoryPercent}
                />,
                <>
                  {resources?.disk
                    ? byteAmount(resources.disk.availableBytes)
                    : unknown}
                  {resources && (
                    <div>
                      <small>
                        {tr("monitor.sample")} ·{" "}
                        {new Date(resources.sampledAt).toLocaleString(
                          currentLocale(),
                        )}
                      </small>
                      {resources.disk && (
                        <div>
                          <small>
                            {tr("monitor.volume")} · {resources.disk.volume}
                          </small>
                        </div>
                      )}
                    </div>
                  )}
                  {!supported && (
                    <div>
                      <small>{tr("monitor.legacy")}</small>
                    </div>
                  )}
                </>,
              ],
            };
          })}
        />
      )}
      {!visible.length && (
        <EmptyState
          title={
            filtered
              ? tr("web.noMatchingEnvironments")
              : tr("web.noDevelopmentEnvironmentsYet")
          }
          description={
            filtered
              ? tr("ui.clearFilterHint")
              : tr("web.createAOneTimeAccessCodeThenInstallAnd")
          }
          action={
            filtered ? (
              <Button
                onClick={() => {
                  setQuery("");
                  setFilter("");
                }}
              >
                {tr("ui.clearFilters")}
              </Button>
            ) : undefined
          }
        />
      )}
    </CollectionLayout>
  );
}
