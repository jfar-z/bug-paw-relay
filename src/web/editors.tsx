import { X } from "lucide-react";
import { CliBrandIcon, FieldGroup } from "./ui/index.js";
import { Textarea, FormGrid, NavigationButton, Row } from "./ui/index.js";
import { defaultBoardStages, stageName } from "../shared/board-stages.js";
import { feedback, caughtFeedback, type UiFeedback } from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import { StageLabel, stageLabel, stageText } from "./stage-label.js";
import {
  AgentRuntimeOptions,
  RuntimeOptionsEditor,
  enabledCliOptions,
  CliAvailabilityNotice,
} from "./runtime-options.js";
import { insecureModelEndpoint } from "../shared/model-endpoint.js";
import {
  agentAvailable,
  boardSchema,
  type Board,
  type Stage,
} from "../shared/contracts.js";
import { BoardFlow } from "./board-flow.js";
import { Avatar, AvatarUpload, PresetPicker, agentOption } from "./avatar.js";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import {
  api,
  Button,
  FlowLayout,
  FormField,
  Field,
  Input,
  Select,
  Check,
  ErrorBox,
  Alert,
  Modal,
  permissionOptions,
} from "./ui/index.js";
export const options = (items: any[], empty = tr("web.chooseAnOption")) => [
  { value: "", label: empty },
  ...items.map((v) => ({ value: v.id, label: v.name || v.title })),
];
/** 配置表单共用版本号提交，冲突时保留输入并提示用户刷新。 */
export function Editor({
  kind,
  item,
  state,
  onSaved,
  onDirtyChange,
  onFlowSaved,
  onCreateAgent,
}: {
  kind: string;
  item?: any;
  state: any;
  onSaved: (id?: string) => void;
  onCreateAgent?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onFlowSaved?: (board: Board) => void;
}) {
  useLocale();
  const initial: any = {
    projects: { name: "", directories: [] },
    agents: {
      name: "",
      environmentId: null,
      avatar: "",
      instructions: "",
      injection: "append",
      supportedRuntimes: null,
      defaultPermission: "ask",
    },
    models: {
      name: "",
      protocol: "responses",
      baseUrl: "",
      model: "",
      apiKey: "",
      reasoning: "none",
      maxTokens: 4096,
      temperature: null,
      extra: {},
      contextLimit: 100000,
      compressionModelId: null,
    },
    boards: { name: "", projectId: "", stages: [] },
  }[kind];
  const [form, setForm] = useState<any>(() => {
    // 固定节点身份只在打开新草稿时分配，切换语言和重试沿用原 UUID。
    if (kind === "boards" && !item)
      initial.stages = defaultBoardStages(
        crypto.randomUUID(),
        crypto.randomUUID(),
      );
    return structuredClone(item || initial);
  });
  const [extra, setExtra] = useState(
    JSON.stringify(item?.extra || {}, null, 2),
  );
  const [error, setError] = useState<UiFeedback>("");
  const [busy, setBusy] = useState(false);
  // 未确认结果的同一创建请求复用操作编号；草稿变化才开启新操作。
  const creation = useRef<{ key: string; id: string } | null>(null);
  const flow = kind === "boards" && !!item;
  const originalBoard = useRef<Board | undefined>(flow ? item : undefined);
  const [admission, setAdmission] = useState<any>(null);
  const [admissionError, setAdmissionError] = useState<UiFeedback>("");
  const [confirmation, setConfirmation] = useState<any>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<{
    field: string;
    message: UiFeedback;
  } | null>(null);
  const [manualPermissions, setManualPermissions] = useState<string[]>([]);
  const returnPosition = useRef<number | null>(null);
  const pageScroller = () => formRef.current?.closest<HTMLElement>(".content");
  const restoreStage = useRef<string | null>(null);
  const focusStage = useRef(false);
  const selectedStage: Stage | undefined = flow
    ? form.stages.find((stage: Stage) => stage.id === selectedStageId)
    : undefined;
  // 保护依据使用保存时的阶段，草稿里新增的出口仍可撤销。
  const occupiedStages = (originalBoard.current?.stages ?? []).filter(
    (stage) => admission?.occupiedStageIds.includes(stage.id),
  );
  const protectedStage = occupiedStages.find((stage) => stage.id === selectedStageId);
  const incomingProtection = occupiedStages.find((stage) => selectedStageId && stage.targets.includes(selectedStageId));
  const selectStage = (id: string) => {
    if (!selectedStageId) returnPosition.current = pageScroller()?.scrollTop ?? window.scrollY;
    focusStage.current = id !== selectedStageId;
    setInvalidField(null);
    setSelectedStageId(id);
  };
  const closeStage = (id: string) => {
    restoreStage.current = id;
    setInvalidField(null);
    setSelectedStageId(null);
  };
  useLayoutEffect(() => {
    const editor = formRef.current;
    if (!editor) return;
    if (invalidField) {
      const scope = selectedStageId
        ? editor.querySelector("[data-flow-detail]")
        : editor;
      const field = scope?.querySelector<HTMLElement>(
        `[data-flow-field="${CSS.escape(invalidField.field)}"]`,
      );
      if (field) {
        focusStage.current = false;
        const control = field.querySelector<HTMLElement>(
          "input:enabled, button:enabled, textarea:enabled",
        );
        (field.matches("input") ? field : (control ?? field)).focus();
        return;
      }
    }
    if (selectedStageId && (focusStage.current || invalidField)) {
      focusStage.current = false;
      editor
        .querySelector<HTMLElement>("[data-flow-heading]")
        ?.focus({ preventScroll: true });
    } else if (restoreStage.current) {
      if (
        returnPosition.current !== null &&
        matchMedia("(max-width: 760px)").matches
      )
        (pageScroller() ?? window).scrollTo(0, returnPosition.current);
      const trigger = editor.querySelector<HTMLElement>(
        `[data-flow-stage="${CSS.escape(restoreStage.current)}"]`,
      );
      (trigger ?? editor.querySelector<HTMLElement>("[data-flow-add]"))?.focus({
        preventScroll: true,
      });
      restoreStage.current = null;
    }
  }, [selectedStageId, invalidField]);
  /** 评估时禁用按钮会丢失原焦点，取消确认后显式返回保存入口。 */
  const cancelConfirmation = () => {
    setConfirmation(null);
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.focus(),
    );
  };
  const [pendingRequest, setPendingRequest] = useState<any>(null);
  const [uncertain, setUncertain] = useState(false);
  const flowChanged =
    flow && JSON.stringify(form.stages) !== JSON.stringify(originalBoard.current?.stages);
  const unchanged = flow && !flowChanged && form.name === originalBoard.current?.name;
  useEffect(() => {
    if (flow) onDirtyChange?.(!unchanged || uncertain);
  }, [flow, unchanged, uncertain, onDirtyChange]);
  /** 准入独立于列表筛选；刷新准入不覆盖尚未保存的草稿及原版本。 */
  const refreshAdmission = async () => {
    try {
      setAdmission(
        await api(
          `/boards/${item.id}/editability`,
          undefined,
          undefined,
          30000,
        ),
      );
      setAdmissionError("");
    } catch (e) {
      setAdmission(null);
      setAdmissionError(caughtFeedback(e as Error));
    }
  };
  useEffect(() => {
    if (flow) void refreshAdmission();
  }, [item?.id, state.items, item?.version]);
  /** 原请求不变地重试，避免响应丢失后重复删除历史。 */
  const saveFlow = async (payload: any) => {
    setBusy(true);
    setError("");
    setConfirmation(null);
    setPendingRequest(payload);
    try {
      if (uncertain)
        await api(
          `/boards/${item.id}/editability`,
          undefined,
          undefined,
          30000,
        );
      const saved = await api(`/boards/${item.id}`, payload, "PUT", 30000);
      setPendingRequest(null);
      setUncertain(false);
      onDirtyChange?.(false);
      onFlowSaved?.(saved);
      onSaved(saved.id);
    } catch (e: any) {
      const unknown = !e.status || e.status >= 500;
      setUncertain(unknown);
      if (!unknown) setPendingRequest(null);
      setError(
        unknown
          ? feedback("web.saveResultIsUnconfirmedYourDraftIsKeptReconnect")
          : e.code === "CONFLICT"
            ? feedback("web.theBoardVersionHasChangedYourDraftIsKept")
            : e.code === "FLOW_CONFIRMATION_REQUIRED"
              ? feedback(
                  "web.theDeletionImpactOrConfirmationValidityHasChangedYour",
                )
              : caughtFeedback(e),
      );
      void refreshAdmission();
    } finally {
      setBusy(false);
    }
  };
  const set = (key: string, value: any) => {
    if (!flow) onDirtyChange?.(true);
    if (invalidField) setInvalidField(null);
    setForm({ ...form, [key]: value });
  };
  const agentClis =
    kind === "agents"
      ? enabledCliOptions(state.environments, form.environmentId)
      : [];
  // 环境级智能体仅支持 Claude 且该环境以 root 运行时，完全权限不可选。
  const agentRootRestricted =
    kind === "agents" &&
    !!form.supportedRuntimes?.length &&
    form.supportedRuntimes.every((r: string) => r === "claude") &&
    state.environments.find((e: any) => e.id === form.environmentId)?.tools
      ?.claude?.runsAsRoot === true;
  const invalidAgentBinding =
    kind === "agents" &&
    form.supportedRuntimes?.some(
      (runtime: string) =>
        !agentClis.some(({ value }) => value === runtime) &&
        (item?.environmentId !== form.environmentId ||
          !item?.supportedRuntimes?.includes(runtime)),
    );
  // 仅校验新设或改动执行配置的阶段，允许用户继续维护存量流程。
  const changedBindings: Stage[] = flow
    ? form.stages.filter((stage: Stage) => {
        if (stage.type !== "agent") return false;
        const saved = originalBoard.current?.stages.find(
          (entry) => entry.id === stage.id,
        );
        const keys = [
          "environmentId",
          "rootId",
          "relativePath",
          "runtime",
          "agentId",
        ] as const;
        return (
          saved?.type !== "agent" ||
          keys.some((key) => saved[key] !== stage[key])
        );
      })
    : [];
  /** 校验所有阶段，定位未挂载的字段后继续保留整份草稿。 */
  const showFlowIssue = (
    stage: Stage | undefined,
    field: string,
    message: UiFeedback,
  ) => {
    if (stage) selectStage(stage.id);
    else setSelectedStageId(null);
    setInvalidField({ field, message });
    setError(stage ? "" : message);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      busy ||
      invalidAgentBinding ||
      confirmation ||
      uncertain ||
      unchanged ||
      (flow && (!admission || (flowChanged && !admission.editable)))
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (flow) {
        const board = {
          name: form.name,
          projectId: form.projectId,
          stages: form.stages.map((stage: any) => ({
            ...stage,
            runtime:
              stage.runtime || (stage.type === "human" ? "codex" : undefined),
            permission: stage.permission ?? "ask",
          })),
        };
        const validation = boardSchema.safeParse(board);
        if (!validation.success) {
          const issue = validation.error.issues[0];
          const [section, index, property] = issue.path;
          const stage =
            section === "stages" && typeof index === "number"
              ? board.stages[index]
              : undefined;
          const field = String(property ?? section ?? "");
          const keys: Record<string, string> = {
            name: stage ? "web.flowStageNameError" : "web.flowBoardNameError",
            concurrency: "web.flowConcurrencyError",
            instructions: "web.flowInstructionsError",
            environmentId: "validation.stageEnvironment",
            rootId: "validation.stageEnvironment",
            targets: "validation.stageTarget",
          };
          showFlowIssue(
            stage,
            field === "rootId" ? "environmentId" : field,
            feedback(keys[field] ?? "web.flowFieldError"),
          );
          return;
        }
        const invalidStageBinding = changedBindings.find(
          (stage) =>
            !enabledCliOptions(state.environments, stage.environmentId).some(
              ({ value }) => value === stage.runtime,
            ),
        );
        if (invalidStageBinding) {
          showFlowIssue(
            invalidStageBinding,
            "runtime",
            feedback("web.flowRuntimeError"),
          );
          return;
        }
        const missingAgent = changedBindings.find(
          ({ environmentId, agentId, runtime }) =>
            !environmentId ||
            !state.agents.some(
              (agent: any) =>
                agent.id === agentId &&
                agentAvailable(agent, environmentId, runtime),
            ),
        );
        if (missingAgent) {
          showFlowIssue(
            missingAgent,
            "agentId",
            feedback("errors.AGENT_REQUIRED.select"),
          );
          return;
        }
        const payload = {
          ...board,
          version: form.version,
          operationId: crypto.randomUUID(),
        };
        // 标题独立保存不受流程准入限制，也不申请损失确认。
        if (!flowChanged) {
          await saveFlow(payload);
          return;
        }
        const preview = await api(
          `/boards/${item.id}/flow-preview`,
          { version: form.version, board },
          "POST",
          30000,
        );
        if (preview.deletedStages.length || preview.typeChanges.length)
          setConfirmation({ ...preview, payload });
        else await saveFlow(payload);
        return;
      }
      if (kind === "boards") {
        const key = JSON.stringify(form);
        if (creation.current?.key !== key)
          creation.current = { key, id: crypto.randomUUID() };
      }
      const saved = await api(
        "/" + kind + (item ? "/" + item.id : ""),
        {
          ...form,
          ...(kind === "models" ? { extra: JSON.parse(extra) } : {}),
          // 历史阶段缺失权限按询问模式保存，不重新继承智能体配置。
          ...(kind === "boards"
            ? {
                operationId: creation.current!.id,
                stages: form.stages.map((stage: any) => ({
                  ...stage,
                  permission: stage.permission ?? "ask",
                })),
              }
            : {}),
        },
        item ? "PUT" : "POST",
      );
      setForm(kind === "boards" ? saved : { ...form, version: saved.version });
      onDirtyChange?.(false);
      onSaved(saved.id);
    } catch (e) {
      setError(caughtFeedback(e as Error));
      if (flow) void refreshAdmission();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      ref={formRef}
      className="config-editor"
      onSubmit={submit}
      noValidate={flow}
    >
      <fieldset
        className="editor-fieldset"
        disabled={busy || uncertain || !!confirmation}
      >
        <Field label={tr("web.name")}>
          <Input
            data-flow-field={flow ? "name" : undefined}
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        {kind === "projects" && (
          <>
            <p className="sub">
              {tr(
                item
                  ? "web.projectsCanReferenceMultipleEnvironmentDirectoriesAndAreShared"
                  : "web.createProjectDirectoryHint",
              )}
            </p>
            {form.directories.map((d: any, i: number) => (
              <div className="config-block" key={i}>
                <Directory
                  value={d}
                  environments={state.environments}
                  onChange={(value: any) =>
                    set(
                      "directories",
                      form.directories.map((v: any, n: number) =>
                        n === i ? value : v,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  onClick={() =>
                    set(
                      "directories",
                      form.directories.filter((_: any, n: number) => i !== n),
                    )
                  }
                >
                  {tr("web.removeDirectory")}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              onClick={() =>
                set("directories", [
                  ...form.directories,
                  { environmentId: "", rootId: "", relativePath: "." },
                ])
              }
            >
              {tr("web.addEnvironmentDirectory")}
            </Button>
          </>
        )}
        {kind === "agents" && (
          <>
            <Field label={tr("web.scope")}>
              <Select
                label={tr("web.agentScope")}
                value={form.environmentId || ""}
                options={options(
                  state.environments,
                  tr("web.systemAcrossEnvironments"),
                )}
                onChange={(v) => {
                  const environmentId = v || null;
                  const available = enabledCliOptions(
                    state.environments,
                    environmentId,
                  );
                  const original =
                    environmentId === item?.environmentId ? item : undefined;
                  const supportedRuntimes =
                    form.supportedRuntimes?.filter(
                      (runtime: string) =>
                        available.some(({ value }) => value === runtime) ||
                        original?.supportedRuntimes?.includes(runtime),
                    ) ?? null;
                  const runtimeOptions = Object.fromEntries(
                    Object.entries(form.runtimeOptions || {}).filter(
                      ([runtime]) =>
                        available.some(({ value }) => value === runtime),
                    ),
                  );
                  onDirtyChange?.(true);
                  setForm({
                    ...form,
                    environmentId,
                    supportedRuntimes,
                    runtimeOptions: {
                      ...original?.runtimeOptions,
                      ...runtimeOptions,
                    },
                  });
                }}
              />
            </Field>
            <Field label={tr("web.supportedCli")}>
              <Select
                label={tr("web.supportedCli")}
                value={form.supportedRuntimes == null ? "all" : "selected"}
                options={[
                  { value: "all", label: tr("web.allClis") },
                  { value: "selected", label: tr("web.specificClis") },
                ]}
                onChange={(v) =>
                  set(
                    "supportedRuntimes",
                    v === "all" ? null : agentClis.map((r) => r.value),
                  )
                }
              />
            </Field>
            {form.supportedRuntimes != null && (
              <FieldGroup
                role="group"
                aria-label={tr("web.chooseClisAtLeastOne")}
              >
                <span>{tr("web.chooseClisAtLeastOne")}</span>
                <div className="checks">
                  {agentClis.map((runtime) => (
                    <Check
                      key={runtime.value}
                      checked={form.supportedRuntimes.includes(runtime.value)}
                      onChange={(checked) =>
                        set(
                          "supportedRuntimes",
                          checked
                            ? [...form.supportedRuntimes, runtime.value]
                            : form.supportedRuntimes.filter(
                                (v: string) => v !== runtime.value,
                              ),
                        )
                      }
                    >
                      {runtime.label}
                    </Check>
                  ))}
                </div>
                {!form.supportedRuntimes.length && (
                  <p className="error">{tr("web.chooseAtLeastOneCli")}</p>
                )}
              </FieldGroup>
            )}
            {form.supportedRuntimes?.some(
              (runtime: string) =>
                !agentClis.some(({ value }) => value === runtime),
            ) && (
              <Alert title={tr("web.cliBindingUnavailable")}>
                <Button
                  type="button"
                  onClick={() =>
                    set(
                      "supportedRuntimes",
                      form.supportedRuntimes.filter((runtime: string) =>
                        agentClis.some(({ value }) => value === runtime),
                      ),
                    )
                  }
                >
                  {tr("web.cliRemoveUnavailableChoices")}
                </Button>
              </Alert>
            )}
            <p className="sub">
              {tr("web.agentsAreOnlyAvailableInSupportedClisEnvironmentScope")}
            </p>
            <Field label={tr("web.defaultPermission")}>
              <Select
                label={tr("web.defaultPermission")}
                value={form.defaultPermission ?? "ask"}
                options={permissionOptions(agentRootRestricted)}
                onChange={(v) => set("defaultPermission", v)}
              />
            </Field>
            {agentRootRestricted && form.defaultPermission === "full" && (
              <p className="permission-danger" role="note">
                {tr("web.permission.fullUnavailableSaved")}
              </p>
            )}
            <p
              className={
                form.defaultPermission === "full" ? "permission-danger" : "sub"
              }
            >
              {form.defaultPermission === "full"
                ? tr("web.fullAccessAllowsTheAgentToExecuteOperationsDirectly")
                : form.defaultPermission === "auto"
                  ? tr("web.autoApprove.desc")
                  : tr("web.askModeKeepsNativeOperationApprovals")}
              {tr("web.defaultsApplyOnlyToNewSessionsAndStagesExisting")}
            </p>
            <AgentRuntimeOptions
              form={form}
              state={state}
              onChange={(v: any) => set("runtimeOptions", v)}
            />
            <Field label={tr("web.roleInstructions")}>
              <Textarea
                rows={9}
                value={form.instructions}
                onChange={(e) => set("instructions", e.target.value)}
                placeholder={tr(
                  "web.describeResponsibilitiesConstraintsAndDeliverables",
                )}
              />
            </Field>
            <Field label={tr("web.instructionInjection")}>
              <Select
                label={tr("web.instructionInjection")}
                value={form.injection}
                onChange={(v) => set("injection", v)}
                options={[
                  {
                    value: "inherit",
                    label: tr("web.inheritNativeInstructions"),
                  },
                  { value: "append", label: tr("web.appendRoleInstructions") },
                  {
                    value: "replace",
                    label: tr(
                      "web.replaceUserInstructionsExactlyUnderValidation",
                    ),
                  },
                ]}
              />
            </Field>
            <p className="sub">
              {tr(
                "web.existingProjectInstructionFilesArePreservedExactReplacementIs",
              )}
            </p>
            <Row>
              <Avatar card name={form.name} source={form.avatar} />
              <PresetPicker value={form.avatar} onChoose={(avatar) => set("avatar", avatar)} />
            </Row>
            <AvatarUpload onSave={(avatar) => set("avatar", avatar)} />
            <Field label={tr("web.avatarInitials")}>
              <Input
                maxLength={3}
                value={form.avatar?.startsWith("data:") || form.avatar?.startsWith("/assets/") ? "" : form.avatar}
                onChange={(e) => set("avatar", e.target.value)}
              />
            </Field>
          </>
        )}
        {kind === "models" && (
          <>
            <FormGrid>
              <Field label={tr("web.protocol")}>
                <Select
                  label={tr("web.modelProtocol")}
                  value={form.protocol}
                  onChange={(v) => set("protocol", v)}
                  options={[
                    { value: "responses", label: "OpenAI Responses" },
                    { value: "chat", label: "Chat Completions" },
                    { value: "anthropic", label: "Anthropic Messages" },
                  ]}
                />
              </Field>
              <Field label={tr("web.modelIdentifier")}>
                <Input
                  required
                  value={form.model}
                  onChange={(e) => set("model", e.target.value)}
                />
              </Field>
            </FormGrid>
            <Field label={tr("web.apiBaseUrl")}>
              <Input
                required
                type="url"
                value={form.baseUrl}
                onChange={(e) => set("baseUrl", e.target.value)}
                placeholder="https://…/v1"
              />
              {insecureModelEndpoint(form.baseUrl) && (
                <small className="sub">
                  {tr("web.httpTransmitsInPlainTextMakeSureTheNetwork")}
                </small>
              )}
            </Field>
            <Field
              label={
                item?.hasKey ? tr("web.apiKeyLeaveBlankToKeep") : "API Key"
              }
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.apiKey || ""}
                onChange={(e) => set("apiKey", e.target.value)}
              />
            </Field>
            <FormGrid>
              <Field label={tr("web.reasoningEffort")}>
                <Select
                  label={tr("web.reasoningEffort")}
                  value={form.reasoning}
                  onChange={(v) => set("reasoning", v)}
                  options={["none", "low", "medium", "high"].map((v) => ({
                    value: v,
                    label: v,
                  }))}
                />
              </Field>
              <Field label={tr("web.maximumOutputTokens")}>
                <Input
                  type="number"
                  min={256}
                  max={100000}
                  value={form.maxTokens}
                  onChange={(e) => set("maxTokens", Number(e.target.value))}
                />
              </Field>
              <Field label={tr("web.temperatureOptional")}>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  value={form.temperature ?? ""}
                  onChange={(e) =>
                    set(
                      "temperature",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </Field>
              <Field label={tr("web.contextTokenCapacity")}>
                <Input
                  type="number"
                  min={4096}
                  value={form.contextLimit}
                  onChange={(e) => set("contextLimit", Number(e.target.value))}
                />
              </Field>
            </FormGrid>
            <Field label={tr("web.compactionModel")}>
              <Select
                variant="ghost"
                label={tr("web.compactionModel")}
                value={form.compressionModelId || ""}
                options={options(state.models, tr("web.useCurrentModel"))}
                onChange={(v) => set("compressionModelId", v || null)}
              />
            </Field>
            <Field label={tr("web.customParametersJson")}>
              <Textarea
                variant="code"

                rows={5}
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            </Field>
            <p className="sub">
              {tr("web.parameterSupportDependsOnTheEndpointMessagesToolsAnd")}
            </p>
          </>
        )}
        {kind === "boards" && !flow && (
          <Field label={tr("web.project")}>
            <Select
              label={tr("web.project")}
              value={form.projectId}
              options={options(state.projects)}
              onChange={(value) => set("projectId", value)}
            />
          </Field>
        )}
        {!flow && (
          <>
            <ErrorBox error={error} />
            <footer className="editor-actions">
              <Button
                variant="primary"
                type="submit"
                disabled={
                  busy ||
                  invalidAgentBinding ||
                  (kind === "boards" && !form.projectId) ||
                  (kind === "agents" && form.supportedRuntimes?.length === 0)
                }
              >
                {tr(
                  busy
                    ? "web.saving"
                    : kind === "boards"
                      ? "web.createBoard"
                      : "web.saveConfiguration",
                )}
              </Button>
            </footer>
          </>
        )}
      </fieldset>
      {flow && (
        <FlowLayout
          toolbar={
            <>
              <p role="status" className="note">
                {admission
                  ? !admission.editable
                    ? tr("board.flowArchived")
                    : occupiedStages.length
                      ? tr("web.flowProtectedStages", { count: admission.blockingItemCount, stages: occupiedStages.map(stage => stageLabel(stage)).join(", ") })
                      : tr("web.flowEditingIsAvailableNoUnfinishedUnarchivedWorkItems")
                  : tr(
                      admissionError
                        ? "web.flowAdmissionFailed"
                        : "web.flowChecking",
                    )}
              </p>
              <ErrorBox error={admissionError} />
              {(!admission?.editable || occupiedStages.length > 0 || admissionError) && (
                <Button onClick={refreshAdmission}>
                  {tr("web.checkEditingConditionsAgain")}
                </Button>
              )}
            </>
          }
          overview={
            <BoardFlow
              stages={form.stages}
              selected={selectedStageId}
              environments={state.environments}
              agents={state.agents}
              onSelect={selectStage}
            />
          }
          title={
            selectedStage && (
              <StageLabel
                stage={selectedStage}
                draft={!selectedStage.shortId}
              />
            )
          }
          close={
            selectedStage && (
              <Button
                shape="icon"
                variant="ghost"
                aria-label={tr("web.flowCloseStage")}
                title={tr("web.flowCloseStage")}
                onClick={() => closeStage(selectedStage.id)}
              >
                <X aria-hidden="true" />
              </Button>
            )
          }
          detail={
            selectedStage && (
              <fieldset
                className="editor-fieldset"
                disabled={
                  !admission?.editable || busy || uncertain || !!confirmation
                }
              >
                <StageEditor
                  key={selectedStage.id}
                  stage={selectedStage}
                  onCreateAgent={onCreateAgent}
                  protectedStage={protectedStage}
                  incomingProtection={incomingProtection}
                  explicitPermission={
                    item.stages.some(
                      (stage: Stage) => stage.id === selectedStage.id,
                    ) || manualPermissions.includes(selectedStage.id)
                  }
                  onPermissionChosen={() =>
                    setManualPermissions([
                      ...manualPermissions,
                      selectedStage.id,
                    ])
                  }
                  all={form.stages}
                  state={state}
                  projectId={form.projectId}
                  invalidField={invalidField}
                  onChange={(value: Stage) =>
                    set(
                      "stages",
                      form.stages.map((stage: Stage) =>
                        stage.id === selectedStage.id ? value : stage,
                      ),
                    )
                  }
                  onMove={(offset: number) => {
                    const stages: Stage[] = [...form.stages];
                    const index = stages.findIndex(
                      (stage) => stage.id === selectedStage.id,
                    );
                    [stages[index], stages[index + offset]] = [
                      stages[index + offset],
                      stages[index],
                    ];
                    set("stages", stages);
                  }}
                  onRemove={() => {
                    const stages: Stage[] = form.stages;
                    const index = stages.findIndex(
                      (stage) => stage.id === selectedStage.id,
                    );
                    closeStage((stages[index + 1] ?? stages[index - 1]).id);
                    set(
                      "stages",
                      stages
                        .filter((stage) => stage.id !== selectedStage.id)
                        .map((stage) => ({
                          ...stage,
                          targets: stage.targets.filter(
                            (id) => id !== selectedStage.id,
                          ),
                        })),
                    );
                  }}
                />
              </fieldset>
            )
          }
          footer={
            <>
              <ErrorBox error={error} />
              {!unchanged && (
                <span role="status">{tr("web.unsavedChanges")}</span>
              )}
              {uncertain && (
                <Button
                  disabled={busy}
                  onClick={() => saveFlow(pendingRequest)}
                >
                  {tr("web.verifyAndRetryOriginalSave")}
                </Button>
              )}
              <Button
                data-flow-add
                disabled={
                  !admission?.editable ||
                  busy ||
                  uncertain ||
                  !!confirmation ||
                  form.stages.length >= 31
                }
                onClick={() => {
                  const id = crypto.randomUUID();
                  set("stages", [
                    ...form.stages.slice(0, -1),
                    {
                      id,
                      name: tr("web.newStage"),
                      type: "human",
                      targets: [form.stages.at(-1).id],
                      concurrency: 1,
                      environmentId: null,
                      rootId: "",
                      relativePath: ".",
                      agentId: null,
                      runtime: "",
                      permission: "ask",
                      instructions: tr("web.whatYouNeedToDoNNWhatYou"),
                    },
                    form.stages.at(-1),
                  ]);
                  selectStage(id);
                }}
              >
                {tr("web.addStage")}
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={
                  busy ||
                  uncertain ||
                  !!confirmation ||
                  unchanged ||
                  !admission ||
                  (flowChanged && !admission.editable)
                }
              >
                {tr(busy ? "web.saving" : "web.flowSave")}
              </Button>
            </>
          }
        />
      )}
      {confirmation && (
        <Modal
          title={tr(confirmation.deletedStages.length ? "web.confirmStageDeletionAndHistoryLoss" : "web.flowTypeReview")}
          onClose={cancelConfirmation}
        >
          {confirmation.typeChanges.map((stage: Stage) => (
            <p key={stage.id}>{tr(stage.type === "human" ? "web.flowEnterHuman" : "web.flowEnterAgent", { stage: stageLabel(stage) })}</p>
          ))}
          {confirmation.deletedStages.length > 0 && <>
          <p>
            {tr("web.stageDeletionCount", {
              count: confirmation.deletedStages.length,
            })}
          </p>
          <ul className="flow-deleted-stages">
            {confirmation.deletedStages.map((stage: any) => (
              <li key={stage.id}>
                {stageLabel(
                  item.stages.find((s: any) => s.id === stage.id) || stage,
                )}
              </li>
            ))}
          </ul>
          <p>
            {tr("web.deletionImpactCounts", {
              items: confirmation.affectedItemCount,
              handoffs: confirmation.handoffCount,
              artifacts: confirmation.artifactCount,
            })}
          </p>
          {confirmation.handoffCount === 0 && (
            <p>{tr("web.noHandoffRecordsAreAffected")}</p>
          )}
          <p className="note">
            {tr("web.relatedHandoffRecordsWillBeLostAndTheirArtifact")}
          </p>
          </>}
          <div className="editor-actions">
            <Button type="button" onClick={cancelConfirmation}>
              {tr("web.cancelKeepEditing")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() =>
                saveFlow({
                  ...confirmation.payload,
                  confirmationToken: confirmation.confirmationToken,
                })
              }
            >
              {tr(confirmation.deletedStages.length ? "web.acceptLossAndSave" : "web.flowSave")}
            </Button>
          </div>
        </Modal>
      )}
    </form>
  );
}
export function Directory({
  value,
  onChange,
  environments,
}: {
  value: any;
  onChange: (v: any) => void;
  environments: any[];
}) {
  useLocale();
  const [status, setStatus] = useState<UiFeedback>("");
  const environment = environments.find((e) => e.id === value.environmentId);
  const [directories, setDirectories] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setStatus("");
    setDirectories(null);
  }, [value.environmentId, value.rootId, value.relativePath]);
  const browse = async () => {
    setLoading(true);
    setStatus("");
    try {
      const data = await api("/directory/list", value);
      setDirectories(data.directories);
    } catch (error) {
      setStatus(caughtFeedback(error));
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <Field label={tr("web.developmentEnvironment")}>
        <Select
          label={tr("web.developmentEnvironment")}
          value={value.environmentId}
          options={options(environments)}
          onChange={(v) =>
            onChange({
              ...value,
              environmentId: v,
              rootId: "",
              relativePath: ".",
            })
          }
        />
      </Field>
      <Field label={tr("web.workspaceRoots")}>
        <Select
          label={tr("web.workspaceRoots")}
          value={value.rootId}
          options={[
            { value: "", label: tr("web.chooseAnOption") },
            ...(environment?.roots || []).map((r: any) => ({
              value: r.id,
              label: r.path,
            })),
          ]}
          onChange={(v) => onChange({ ...value, rootId: v, relativePath: "." })}
        />
      </Field>
      <p className="note">
        {environment
          ? tr("web.syncedRoots", { p0: environment.roots?.length || 0 })
          : tr("web.chooseADevelopmentEnvironmentFirst")}{" "}
        {tr("web.afterAddingDirectoriesInTheClientSaveAndStart")}
      </p>
      <Field label={tr("web.relativePath")}>
        <Input
          required
          value={value.relativePath}
          onChange={(e) => onChange({ ...value, relativePath: e.target.value })}
        />
      </Field>
      <Button
        type="button"
        disabled={!environment?.online || !value.rootId}
        onClick={() => {
          void api("/directory/validate", value)
            .then((r) =>
              setStatus(feedback("directory.valid", { path: r.path })),
            )
            .catch((e) => setStatus(caughtFeedback(e)));
        }}
      >
        {tr("web.validateDirectory")}
      </Button>
      <Button
        type="button"
        disabled={!environment?.online || !value.rootId || loading}
        onClick={browse}
      >
        {loading ? tr("web.loading") : tr("web.browseSubdirectories")}
      </Button>
      {value.relativePath !== "." && (
        <Button
          type="button"
          onClick={() => onChange({ ...value, relativePath: "." })}
        >
          {tr("web.backToRoot")}
        </Button>
      )}
      {directories && (
        <div className="directory-browser" aria-label={tr("web.subdirectory")}>
          {directories.length ? (
            directories.map((name) => (
              <NavigationButton
                kind="tab"
                type="button"
                key={name}
                onClick={() =>
                  onChange({
                    ...value,
                    relativePath:
                      (value.relativePath === "."
                        ? ""
                        : value.relativePath.replace(/[\\/]$/, "") + "/") +
                      name,
                  })
                }
              >
                {name}
              </NavigationButton>
            ))
          ) : (
            <p className="note">
              {tr("web.noSubfoldersYouCanSelectTheCurrentDirectory")}
            </p>
          )}
        </div>
      )}
      <p className="sub" role="status">
        {displayError(status)}
      </p>
    </>
  );
}
function StageEditor({
  stage,
  protectedStage,
  incomingProtection,
  onCreateAgent,
  explicitPermission,
  onPermissionChosen,
  invalidField,
  all,
  state,
  projectId,
  onChange,
  onRemove,
  onMove,
}: any) {
  useLocale();
  const [targetNotice, setTargetNotice] = useState<UiFeedback>("");
  const fieldError = (field: string) =>
    invalidField?.field === field
      ? displayError(invalidField.message)
      : undefined;
  const project = state.projects.find((p: any) => p.id === projectId);
  const environmentIds = new Set(
    project?.directories.map((directory: any) => directory.environmentId),
  );
  const eligibleEnvironments = state.environments.filter((environment: any) =>
    environmentIds.has(environment.id),
  );
  const stageRootRestricted =
    stage.runtime === "claude" &&
    state.environments.find((e: any) => e.id === stage.environmentId)?.tools
      ?.claude?.runsAsRoot === true;
  const stageClis = enabledCliOptions(
    eligibleEnvironments,
    stage.environmentId,
  );
  const stageCliEnabled = stageClis.some(
    ({ value }) => value === stage.runtime,
  );
  const candidates =
    stage.environmentId && stage.rootId
      ? state.agents.flatMap((agent: any) => {
          const clis = stageClis.filter(
            ({ value }) =>
              (!stage.runtime || value === stage.runtime) &&
              agentAvailable(agent, stage.environmentId, value),
          );
          return clis.length ? [{ agent, clis }] : [];
        })
      : [];
  const stageOptions = candidates.map(({ agent, clis }: any) => {
    const option = agentOption(
      agent,
      candidates.map((entry: any) => entry.agent),
    );
    const children = clis.map((cli: { value: string; label: string }) => ({
      value: JSON.stringify([agent.id, cli.value]),
      label: cli.label,
      icon: <CliBrandIcon runtime={cli.value} />,
    }));
    return children.length === 1
      ? { ...option, value: children[0].value }
      : { ...option, children };
  });
  /** 切换目录或 CLI 时清除失效选择，避免提交隐藏的旧智能体。 */
  const changeTarget = (patch: any) => {
    const next = {
      ...stage,
      ...patch,
      ...((patch.runtime && patch.runtime !== stage.runtime) ||
      (patch.environmentId && patch.environmentId !== stage.environmentId) ||
      (patch.rootId !== undefined && patch.rootId !== stage.rootId) ||
      (patch.relativePath !== undefined &&
        patch.relativePath !== stage.relativePath)
        ? { runtimeOptions: {} }
        : {}),
    };
    const agent = state.agents.find((a: any) => a.id === next.agentId);
    if (
      patch.environmentId &&
      patch.environmentId !== stage.environmentId &&
      next.runtime
    ) {
      const available = enabledCliOptions(
        eligibleEnvironments,
        next.environmentId,
      );
      if (!available.some(({ value }) => value === next.runtime)) {
        // 新目录仅有一个兼容 CLI 时保留智能体，避免清空仍可执行的选择。
        const compatible = available.filter(
          ({ value }) =>
            agent && agentAvailable(agent, next.environmentId, value),
        );
        next.runtime = compatible.length === 1 ? compatible[0].value : "";
      }
    }
    const invalid =
      next.agentId &&
      (!agent ||
        !agentAvailable(agent, next.environmentId, next.runtime) ||
        !enabledCliOptions(eligibleEnvironments, next.environmentId).some(
          ({ value }) => value === next.runtime,
        ));
    if (invalid) next.agentId = null;
    setTargetNotice(
      invalid
        ? feedback("web.theIncompatibleAgentWasClearedChooseAnotherAgent")
        : "",
    );
    if (!explicitPermission)
      next.permission = invalid ? "ask" : (agent?.defaultPermission ?? "ask");
    onChange(next);
  };
  return (
    <section className="config-block">
      {stage.type !== "done" && stage.fixedRole !== "start" && (
        <Row>
          <Button
            type="button"
            disabled={all.findIndex((s: any) => s.id === stage.id) <= 1}
            onClick={() => onMove(-1)}
          >
            {tr("web.moveUp")}
          </Button>
          <Button
            type="button"
            disabled={
              all.findIndex((s: any) => s.id === stage.id) >= all.length - 2
            }
            onClick={() => onMove(1)}
          >
            {tr("web.moveDown")}
          </Button>
          <Button type="button" onClick={onRemove} disabled={!!protectedStage || !!incomingProtection}>
            {tr("web.remove")}
          </Button>
        </Row>
      )}
      {protectedStage && <p className="note">{tr("web.flowProtectedDetail", { stage: stageLabel(protectedStage) })}</p>}
      {incomingProtection && <p className="note">{tr("board.flowExit", { stage: stageLabel(incomingProtection), target: stageLabel(stage) })}</p>}
      {(stage.fixedRole === "start" || stage.type === "done") && (
        <p className="note">
          {tr(
            stage.fixedRole === "start"
              ? "board.stage.fixedStart"
              : "board.stage.fixedDone",
          )}
        </p>
      )}
      <div data-flow-field="name" tabIndex={-1}>
        <FormField label={tr("web.stageName")} error={fieldError("name")}>
          <Input
            required
            maxLength={80}
            value={stageName(stage, currentLocale())}
            onChange={(e) => {
              // 用户编辑后移除默认名标记，保留固定身份与其他配置。
              const { nameKey, ...custom } = stage;
              onChange({ ...custom, name: e.target.value });
            }}
          />
        </FormField>
      </div>
      {stage.type !== "done" && (
        <>
          <Field label={tr("web.stageType")}>
            <Select
              label={tr("web.stageType")}
              disabled={stage.fixedRole === "start" || protectedStage?.type === stage.type}
              value={stage.type}
              options={[
                { value: "human", label: tr("web.humanStage") },
                { value: "agent", label: tr("web.agentStage") },
              ]}
              onChange={(v) => onChange({ ...stage, type: v })}
            />
          </Field>
          <div data-flow-field="targets" tabIndex={-1}>
            <Field label={tr("web.reachableStages")}>
              <div className="checks">
                {all
                  .filter((s: any) => s.id !== stage.id)
                  .map((s: any) => (
                    <Check
                      key={s.id}
                      checked={stage.targets.includes(s.id)}
                      disabled={stage.targets.includes(s.id) && protectedStage?.targets.includes(s.id)}
                      onChange={(checked) =>
                        onChange({
                          ...stage,
                          targets: checked
                            ? [...stage.targets, s.id]
                            : stage.targets.filter((t: string) => t !== s.id),
                        })
                      }
                    >
                      {stageLabel(s, !s.shortId)}
                    </Check>
                  ))}
              </div>
            </Field>
            <ErrorBox error={fieldError("targets")} />
          </div>
        </>
      )}
      {stage.type === "agent" && (
        <>
          <p className="note">{stageText("instructions")}</p>
          <div data-flow-field="environmentId" tabIndex={-1}>
            <FormField
              label={tr("web.projectExecutionDirectory")}
              error={fieldError("environmentId")}
            >
              <Select
                label={tr("web.projectExecutionDirectory")}
                value={JSON.stringify({
                  environmentId: stage.environmentId,
                  rootId: stage.rootId,
                  relativePath: stage.relativePath,
                })}
                options={[
                  { value: "", label: tr("web.chooseAnOption") },
                  ...(project?.directories || []).map((d: any) => ({
                    value: JSON.stringify(d),
                    label:
                      (state.environments.find(
                        (e: any) => e.id === d.environmentId,
                      )?.name || tr("web.environment")) +
                      " / " +
                      d.relativePath,
                  })),
                ]}
                onChange={(v) => v && changeTarget(JSON.parse(v))}
              />
            </FormField>
          </div>
          <FormGrid>
            <div data-flow-field="runtime" tabIndex={-1}>
              <FormField
                label={tr("web.nativeRuntime")}
                error={fieldError("runtime")}
              >
                <Select
                  label={tr("web.nativeRuntime")}
                  value={stageCliEnabled ? stage.runtime : ""}
                  options={stageClis}
                  disabled={
                    !stage.environmentId || !stage.rootId || !stageClis.length
                  }
                  onChange={(v) => changeTarget({ runtime: v })}
                />
              </FormField>
            </div>
            <Field label={tr("web.stagePermission")}>
              <Select
                label={tr("web.stagePermission")}
                value={stage.permission ?? "ask"}
                options={permissionOptions(stageRootRestricted)}
                onChange={(v) => {
                  onPermissionChosen();
                  onChange({ ...stage, permission: v });
                }}
              />
            </Field>
            <div data-flow-field="agentId" tabIndex={-1}>
              <Field label={tr("web.agent")}>
                {stage.agentId &&
                  !state.agents.some(
                    (a: any) =>
                      a.id === stage.agentId &&
                      agentAvailable(a, stage.environmentId, stage.runtime),
                  ) && (
                    <p className="error">
                      {tr("web.thisAgentIsNotApplicableChooseAnotherAgent")}
                    </p>
                  )}
                <Select
                  label={tr("web.stageAgent")}
                  value={JSON.stringify([stage.agentId, stage.runtime])}
                  disabled={!stageOptions.length}
                  options={stageOptions}
                  onChange={(value) => {
                    const [agentId, runtime] = JSON.parse(value);
                    changeTarget({ agentId, runtime });
                  }}
                />
                {stage.environmentId &&
                  stage.rootId &&
                  stageClis.length > 0 &&
                  !stageOptions.length && (
                    <>
                      <p>{tr("web.agentPicker.empty")}</p>
                      <Button onClick={onCreateAgent}>
                        {tr("web.newAgent")}
                      </Button>
                    </>
                  )}
              </Field>
              <ErrorBox error={fieldError("agentId")} />
            </div>
            <div data-flow-field="concurrency" tabIndex={-1}>
              <FormField
                label={tr("web.stageConcurrencyLimit1ForSequential")}
                error={fieldError("concurrency")}
              >
                <Input
                  type="number"
                  min={1}
                  max={16}
                  value={stage.concurrency}
                  onChange={(e) =>
                    onChange({ ...stage, concurrency: Number(e.target.value) })
                  }
                />
              </FormField>
            </div>
          </FormGrid>
          <p className="sub" role="status">
            {explicitPermission
              ? tr("web.customStagePermissionApplied")
              : tr("web.defaultsToTheSelectedAgentSPermissionCanBe")}
            {displayError(targetNotice)}
          </p>
          {stageRootRestricted && stage.permission === "full" && (
            <p className="permission-danger" role="note">
              {tr("web.permission.fullUnavailableSaved")}
            </p>
          )}
          {stage.permission === "auto" && (
            <p className="sub">{tr("web.autoApprove.desc")}</p>
          )}
          {stage.permission === "full" && (
            <p className="permission-danger">
              {tr("web.fullAccessAllowsTheAgentToExecuteOperationsDirectly")}
            </p>
          )}
          {!stageCliEnabled && (!stageClis.length || stage.runtime) && (
            <CliAvailabilityNotice
              environmentId={stage.environmentId}
              binding={!!stageClis.length}
            />
          )}
          {stageCliEnabled && (
            <RuntimeOptionsEditor
              key={JSON.stringify([
                stage.environmentId,
                stage.rootId,
                stage.relativePath,
                stage.runtime,
              ])}
              runtime={stage.runtime}
              environmentId={stage.environmentId || undefined}
              rootId={stage.rootId || undefined}
              relativePath={stage.relativePath}
              value={stage.runtimeOptions}
              agent={state.agents.find((a: any) => a.id === stage.agentId)}
              onChange={(runtimeOptions) =>
                onChange({ ...stage, runtimeOptions })
              }
            />
          )}
          <Check
            checked={!!stage.allowArtifacts}
            onChange={(checked) =>
              onChange({ ...stage, allowArtifacts: checked })
            }
          >
            {tr("web.allowArtifactSubmission")}
          </Check>
          <p className="sub">
            {tr("web.whenEnabledNewExecutionsCanUploadFilesWithHandoffs")}
          </p>
          <div data-flow-field="instructions" tabIndex={-1}>
            <FormField
              label={tr("web.stageMarkdownInstructions")}
              error={fieldError("instructions")}
            >
              <Textarea
                rows={7}
                value={stage.instructions}
                onChange={(e) =>
                  onChange({ ...stage, instructions: e.target.value })
                }
              />
            </FormField>
          </div>
        </>
      )}
    </section>
  );
}
