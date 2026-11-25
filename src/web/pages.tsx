import { AgentDeletionBlocked } from "./api.js";
import type { AgentBoardReference } from "../shared/contracts.js";
import { Avatar } from "./avatar.js";
import { AgentOrderList } from "./agent-order.js";
import { Badge } from "./ui/index.js";
import {
  Page,
  PageHeading,
  Dialog,
  NavigationButton,
  SurfaceButton,
  SettingsLayout as SettingsFrame,
  SettingsPanel,
  Textarea,
} from "./ui/index.js";
import { feedback, caughtFeedback, type UiFeedback } from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import { ConnectorVersion } from "./connector-version.js";
import { useEffect, useState, type ReactNode } from "react";
import { Monitor, Plus, ArrowLeft, Folder, Pencil, Trash2 } from "lucide-react";
import {
  api,
  Button,
  Empty,
  ErrorBox,
  Field,
  Input,
  Select,
} from "./ui/index.js";
import { Editor } from "./editors.js";

/** 智能体沿用已确认的作用域列表和职责详情，编辑仍使用带版本校验的统一表单。 */
export function AgentsPage({ state, edit, confirm, onSaved, saveOrder }: any) {
  useLocale();
  const [scope, setScope] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  const [deletion, setDeletion] = useState<{
    id: string; name: string; blocked?: boolean; references?: AgentBoardReference[];
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<UiFeedback>("");
  async function removeSelected() {
    if (!deletion || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api("/agents/" + deletion.id, {}, "DELETE");
      setDeletion(null);
      setDirty(false);
      await onSaved();
    } catch (error) {
      if (error instanceof AgentDeletionBlocked)
        setDeletion({ ...deletion, blocked: true, references: error.references });
      else setDeleteError(caughtFeedback(error));
    } finally {
      setDeleting(false);
    }
  }
  const change = (apply: () => void) => {
    if (dirty)
      confirm(tr("web.discardUnsavedAgentChanges"), async () => {
        setDirty(false);
        apply();
      });
    else apply();
  };
  const agents = state.agents.filter(
    (a: any) =>
      (scope === "all" ||
        (scope === "system" ? !a.environmentId : !!a.environmentId)) &&
      a.name.includes(query),
  );
  const agent = agents.find((a: any) => a.id === selected) || agents[0];
  const [saving, setSaving] = useState(false);
  const [orderError, setOrderError] = useState<UiFeedback>("");
  useEffect(() => {
    if (agent && selected !== agent.id) setSelected(agent.id);
  }, [agent?.id, selected]);
  async function reorder(ids: string[]) {
    setSaving(true);
    setOrderError("");
    try {
      await saveOrder(ids);
    } catch (error) {
      setOrderError(caughtFeedback(error));
    } finally {
      setSaving(false);
    }
  }
  const sortable = scope === "all" && query === "";
  return (
    <Page>
      <PageHeading>
        <div>
          <h1>{tr("web.agent")}</h1>
          <p>
            {tr(
              "web.defineCollaborationThroughRoleInstructionsWhileKeepingProjectConventions",
            )}
          </p>
        </div>
        <Button variant="primary" onClick={() => edit("agents")}>
          <Plus />
          {tr("web.newAgent")}
        </Button>
      </PageHeading>
      <div className="agents-layout">
        <aside className="agents-list">
          <div
            className="agent-scopes"
            aria-label={tr("web.agentScopeAlternative437")}
          >
            {[
              ["all", tr("web.all")],
              ["system", tr("web.system")],
              ["environment", tr("web.environmentAlternative440")],
            ].map(([id, label]) => (
              <NavigationButton
                selected={scope === id}
                kind="tab"
                key={id}

                aria-pressed={scope === id}
                onClick={() => change(() => setScope(id))}
              >
                {label}
              </NavigationButton>
            ))}
          </div>
          <div className="agent-search">
            <Input
              aria-label={tr("web.searchAgents")}
              placeholder={tr("web.searchAgents")}
              value={query}
              onChange={(e) => {
                const value = e.target.value;
                change(() => setQuery(value));
              }}
            />
          </div>
          {!sortable && <p className="agent-order-note">{tr("web.agentOrder.filtered")}</p>}
          <div role="status">{saving && tr("web.saving")}</div>
          <ErrorBox error={orderError} />
          <AgentOrderList agents={agents} sortable={sortable} saving={saving} save={reorder} render={(a: any) => (
              <SurfaceButton
                selected={agent?.id === a.id}
                kind="agent"

                aria-pressed={agent?.id === a.id}
                key={a.id}
                onClick={() => {
                  if (agent?.id !== a.id) change(() => setSelected(a.id));
                }}
              >
                <Avatar card name={a.name} source={a.avatar} />
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {a.environmentId
                      ? state.environments.find(
                          (e: any) => e.id === a.environmentId,
                        )?.name
                      : tr("web.systemAcrossEnvironmentsAlternative442")}
                  </small>
                </span>
              </SurfaceButton>
          )} />
          <p className="agent-list-note">
            {tr(
              "web.systemAgentsCanBeReusedAcrossEnvironmentsEnvironmentAgents",
            )}
          </p>
        </aside>
        {agent ? (
          <section className="agent-editor">
            <header className="agent-editor-head">
              <div className="agent-identity">
                <h2>{agent.name}</h2>
              </div>
              <Badge>
                {{
                  inherit: tr("web.inheritInstructions"),
                  append: tr("web.appendRoleInstructions"),
                  replace: tr("web.replaceInstructions"),
                }[agent.injection as string] || agent.injection}
              </Badge>
            </header>
            <div className="agent-section agent-inline-form">
              <Editor
                key={agent.id}
                kind="agents"
                item={agent}
                state={state}
                onSaved={onSaved}
                onDirtyChange={setDirty}
              />
            </div>
            <footer className="agent-editor-footer">
              <small>
                {tr("web.theConfigurationVersionIsCheckedOnSaveToPrevent")}
              </small>
              <div>
                <Button
                  shape="icon"

                  aria-label={tr("web.delete")}
                  title={tr("web.deleteAgent")}
                  onClick={() => {
                    setDeleteError("");
                    setDeletion({ id: agent.id, name: agent.name });
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </footer>
          </section>
        ) : (
          <Empty
            title={
              query || scope !== "all"
                ? tr("web.noMatchingAgents")
                : tr("web.defineYourFirstAgent")
            }
          >
            {tr(
              "web.configureDedicatedResponsibilitiesForCodingReviewOrValidation",
            )}
          </Empty>
        )}
      </div>
      {deletion && (
        <Dialog key={deletion.blocked ? "blocked" : "confirm"}
          title={tr(deletion.blocked ? "web.agentDeletion.blocked" : "web.confirmOperation")}
          busy={deleting} onClose={() => setDeletion(null)}>
          {deletion.blocked ? (
            <>
              {deletion.references ? (
                <>
                  <p>{tr("web.agentDeletion.locations", {
                    name: deletion.name,
                    count: deletion.references.reduce((sum, board) => sum + board.stages.length, 0),
                  })}</p>
                  {deletion.references.map(board => (
                    <section key={board.boardId}>
                      <h3>{board.boardName || tr("web.agentDeletion.missing")}
                        {(!board.boardName || deletion.references?.some(other =>
                          other.boardId !== board.boardId && other.boardName === board.boardName
                        )) && ` · ${board.boardId}`}
                      </h3>
                      <p>{tr("web.project")} · {board.projectName || [tr("web.agentDeletion.missing"), board.projectId].filter(Boolean).join(" · ")}
                        {board.archived && <> · <Badge>{tr("web.archived")}</Badge></>}
                      </p>
                      <ul>{board.stages.map(stage => (
                        <li key={stage.id}>{stage.shortId || stage.id} · {stage.nameKey ? tr(stage.nameKey) : stage.name || tr("web.agentDeletion.missing")}</li>
                      ))}</ul>
                    </section>
                  ))}
                </>
              ) : <p>{tr("web.agentDeletion.unavailable", { name: deletion.name })}</p>}
            </>
          ) : (
            <>
              <p>{tr("web.agentDeletion.confirm", { name: deletion.name })}</p>
              <ErrorBox error={deleteError} />
              <footer>
                <Button data-initial-focus disabled={deleting} onClick={() => setDeletion(null)}>{tr("web.cancel")}</Button>
                <Button variant="danger" disabled={deleting} onClick={() => void removeSelected()}>{tr("web.confirm")}</Button>
              </footer>
            </>
          )}
        </Dialog>
      )}
    </Page>
  );
}

/** 环境列表和详情展示真实连接、工具与目录信息，不用示例数据代替运行状态。 */
export { EnvironmentsPage } from "./environments-page.js";

/** 设置以侧栏切换独立任务，避免模型表单与账号安全挤在同一页。 */
export function SettingsLayout({
  children,
  security,
  theme,
  setTheme,
}: {
  children: ReactNode;
  security: ReactNode;
  theme: string;
  setTheme: (v: string) => void;
}) {
  useLocale();
  const [tab, setTab] = useState("models");
  return (
    <SettingsFrame>
      <nav className="setting-nav" aria-label={tr("web.settingsCategories")}>
        {[
          ["models", tr("web.workbenchModels")],
          ["prompt", tr("web.workbenchInstructions")],
          ["security", tr("web.accountAndSecurity")],
          ["downloads", tr("web.downloadPackages")],
          ["appearance", tr("web.appearanceAndApp")],
        ].map(([id, label]) => (
          <NavigationButton
            selected={tab === id}
            kind="settings"
            key={id}

            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </NavigationButton>
        ))}
      </nav>
      <div className="module-panel" hidden={tab !== "prompt"}>
        <WorkbenchPromptSettings />
      </div>
      <div className="module-panel" key={tab} hidden={tab === "prompt"}>
        {tab === "models" ? (
          children
        ) : tab === "downloads" ? (
          <DownloadSettings />
        ) : tab === "prompt" ? null : tab === "security" ? (
          security
        ) : (
          <SettingsPanel>
            <h2>{tr("web.appearanceAndApp")}</h2>
            <a href="#ui">{tr("ui.title")}</a>
            <p>{tr("web.keepAFamiliarWorkingExperienceOnDesktopAndMobile")}</p>
            <div className="settingrow">
              <div>
                {tr("web.theme")}
                <small>{tr("web.bugpawLightDarkAndBugThemes")}</small>
              </div>
              <Select
                label={tr("web.appTheme")}
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "light", label: tr("web.light") },
                  { value: "dark", label: tr("web.dark") },
                  { value: "bug", label: "BUG" },
                ]}
              />
            </div>
            <div className="settingrow">
              <div>
                {tr("web.installOnDevice")}
                <small>{tr("web.chooseInstallAppOrAddToHomeScreenIn")}</small>
              </div>
              <Badge>PWA</Badge>
            </div>
            <p className="note">
              {tr("web.connectionStatusIsAvailableOfflineNewTasksMustBe")}
            </p>
          </SettingsPanel>
        )}
      </div>
    </SettingsFrame>
  );
}

/** 提示词草稿独立于模型配置；切换设置分类保留草稿，恢复默认也需显式保存。 */
function WorkbenchPromptSettings() {
  useLocale();
  const [settings, setSettings] = useState<{
    systemPrompt: string;
    defaultSystemPrompt: string;
    version: number;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<UiFeedback>("");
  const [message, setMessage] = useState<UiFeedback>("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await api("/settings/workbench-prompt");
      setSettings(value);
      setDraft(value.systemPrompt);
      setMessage("");
    } catch (e: any) {
      setError(caughtFeedback(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await api("/settings/workbench-prompt", {
        systemPrompt: draft,
        version: settings.version,
      });
      setSettings(value);
      setDraft(value.systemPrompt);
      setMessage(feedback("web.savedChangesApplyToTheNextWorkbenchTurn"));
    } catch (e: any) {
      setError(caughtFeedback(e));
    } finally {
      setBusy(false);
    }
  };
  const dirty = !!settings && draft !== settings.systemPrompt;
  return (
    <SettingsPanel>
      <h2>{tr("web.workbenchAgentSystemInstructions")}</h2>
      <p>
        {tr("web.configureGeneralBehaviorForAllWorkbenchSessionsLeaveBlank")}
      </p>
      <p className="note">
        {tr("web.productInformationAndToolSchemasAreMaintainedByThe")}
      </p>
      <ErrorBox error={error} />
      {!settings ? (
        <Button disabled={busy} onClick={load}>
          {busy ? tr("web.loadingAlternative506") : tr("web.reload")}
        </Button>
      ) : (
        <>
          <Field label={tr("web.systemInstructionsBehavior")}>
            <Textarea
              rows={12}
              maxLength={40000}
              value={draft}
              disabled={busy}
              onChange={(e) => {
                setDraft(e.target.value);
                setMessage("");
              }}
            />
          </Field>
          <p className="note">
            {draft.length} {tr("web.40000Characters")}{" "}
            {dirty
              ? tr("web.unsavedChanges")
              : tr("web.inSyncWithSavedContent")}
            {tr("web.changesApplyToTheNextTurnRunningTurnsAnd")}
          </p>
          <div className="editor-actions">
            <Button variant="primary" disabled={busy || !dirty} onClick={save}>
              {tr("web.saveInstructions")}
            </Button>
            <Button
              disabled={busy || draft === settings.defaultSystemPrompt}
              onClick={() => {
                setDraft(settings.defaultSystemPrompt);
                setMessage(
                  feedback("web.defaultInstructionsLoadedSaveToApply"),
                );
              }}
            >
              {tr("web.restoreDefaults")}
            </Button>
            <Button disabled={busy} onClick={load}>
              {tr("web.reloadSavedContent")}
            </Button>
          </div>
          <p role="status">{displayError(message)}</p>
        </>
      )}
    </SettingsPanel>
  );
}

/** 配置中心控制新签发下载链接的有效期，沿用统一表单与错误提示。 */
function DownloadSettings() {
  useLocale();
  const [settings, setSettings] = useState<{
    expiresMinutes: number;
    version: number;
  } | null>(null);
  const [error, setError] = useState<UiFeedback>("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api("/settings/downloads")
      .then(setSettings)
      .catch((e) => setError(caughtFeedback(e)));
  }, []);
  return (
    <SettingsPanel>
      <h2>{tr("web.downloadPackages")}</h2>
      <p>{tr("web.signInToObtainTemporaryAuthorizedLinksValidityChanges")}</p>
      <ErrorBox error={error} />
      {settings && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setSaved(false);
            try {
              setSettings(await api("/settings/downloads", settings));
              setSaved(true);
            } catch (e) {
              setError(caughtFeedback(e as Error));
            }
          }}
        >
          <Field label={tr("web.downloadLinkValidityMinutes")}>
            <Input
              type="number"
              required
              min={1}
              max={10080}
              step={1}
              value={settings.expiresMinutes}
              onChange={(e) => {
                setSettings({
                  ...settings,
                  expiresMinutes: Number(e.target.value),
                });
                setSaved(false);
              }}
            />
          </Field>
          <Button variant="primary" type="submit">
            {tr("web.saveDownloadSettings")}
          </Button>
          {saved && (
            <p role="status" className="sub">
              {tr("web.saved")}
            </p>
          )}
        </form>
      )}
    </SettingsPanel>
  );
}
