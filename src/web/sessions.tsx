import { BoardConfirmations, SessionBoardCard, useBoardConfirmations, type BoardCard } from "./session-boards.js";
import { slashInput } from "../shared/slash-commands.js";
import { canPoll, pollDelay } from "./api.js";
import { SessionLightConfirmations, SessionPublication, useSessionLightConfirmations, useSessionPublications } from "./light-apps.js";
import { CliBrandIcon, WorkspaceLayout } from "./ui/index.js";
import {
  ConversationHeader,
  ActionMenu,
  Metadata,
  NavigationButton,
  ConversationPane,
  Composer,
  Row,
  Textarea,
} from "./ui/index.js";
import { SessionConfiguration } from "./session-configuration.js";
import { QuestionCard, mergeQuestions } from "./user-questions.js";
import { localizeProjection } from "../shared/session-display.js";
import { feedback, caughtFeedback, type UiFeedback } from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import {
  RuntimeOptionsEditor,
  enabledCliOptions,
  CliAvailabilityNotice,
} from "./runtime-options.js";
import type { RuntimeOptions } from "../shared/runtime-options.js";
import { agentAvailable } from "../shared/contracts.js";
import { Avatar, MessageIdentity, agentOption } from "./avatar.js";
import {
  AttachmentPicker,
  AttachmentButton,
  useSessionAttachments,
} from "./session-attachments.js";
import { attachmentMessage } from "../shared/uploads.js";
import { MentionComposer } from "./mention-composer.js";
import type { Mention } from "../shared/mentions.js";
import { WorkbenchActivityGroup } from "./workbench-content.js";
import { WorkbenchMarkdown } from "./workbench-content.js";
import { EnvironmentFile } from "./environment-file.js";
import { SessionCard, SessionBatch } from "./session-management.js";
import { createPortal } from "react-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  MoreHorizontal,
  LoaderCircle,
  MessageSquarePlus,
  Folder,
  ArrowUp,
  PanelLeft,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import {
  api,
  Button,
  SessionSidebar,
  Check,
  Select,
  PermissionSelect,
  permissionLabel,
  Input,
  Modal,
  ErrorBox,
  Empty,
  Status,
  Field,
  StopIcon,
} from "./ui/index.js";
import { options } from "./editors.js";
import {
  sessionTimeline,
  sessionPublicationEvents,
  historyEvents,
  mergeSessionEvents,
} from "./session-events.js";
import "./ui/sessions.css";
import "./ui/session-attachments.css";
const ClaudeTerminal = lazy(() => import("./claude-terminal.js"));

type SessionDirectory = {
  environmentId: string;
  rootId: string;
  relativePath: string;
};
type SessionProject = {
  id: string;
  name: string;
  directories: SessionDirectory[];
};
type SessionAgent = {
  id: string;
  name: string;
  avatar?: string;
  environmentId?: string | null;
  supportedRuntimes?: string[] | null;
};
type SessionEnvironment = {
  id: string;
  name: string;
  enabledRuntimes?: string[];
  tools?: { claude?: { mode?: "custom" | "environment" } };
  online?: boolean;
  capabilities?: string[];
  roots?: { id: string; path: string }[];
};
type SessionTarget = {
  directory: SessionDirectory;
  runtime: string;
  runtimeLabel: string;
  environment: SessionEnvironment;
  agent: SessionAgent | null;
  native?: boolean;
};
type AgentChoice = {
  name: string;
  avatar: string;
  targets: Map<string, SessionTarget>;
};

/** 首层按实际配置分组，二级保留每个 CLI 与目录的身份。 */
function sessionAgentChoices(
  project: SessionProject,
  environments: SessionEnvironment[],
  agents: SessionAgent[],
) {
  const choices = new Map<string, AgentChoice>();
  for (const directory of project.directories) {
    const environment = environments.find(
      (env) => env.id === directory.environmentId,
    );
    if (!environment?.online) continue;
    for (const { value: runtime, label: runtimeLabel } of enabledCliOptions([
      environment,
    ])) {
      const native = runtime === "claude" && environment.tools?.claude?.mode === "environment";
      const eligibleAgents = native ? [] : agents.filter((a) => agentAvailable(a, environment.id, runtime));
      for (const agent of native ? [null] : eligibleAgents) {
        const name = agent ? agent.name : tr("web.native.open");
        const avatar = agent ? agent.avatar || "" : "/assets/bugpaw-avatar.png";
        const key = agent?.id ?? "native";
        const choice = choices.get(key) ?? {
          name,
          avatar,
          targets: new Map<string, SessionTarget>(),
        };
        const targetKey = JSON.stringify([
          agent?.id ?? null,
          runtime,
          environment.id,
          directory.rootId,
          directory.relativePath,
        ]);
        choice.targets.set(targetKey, {
          directory,
          runtime,
          runtimeLabel,
          native,
          environment,
          agent,
        });
        choices.set(key, choice);
      }
    }
  }
  // 保留原生终端入口的位置，其余槽位按平台顺序填入有可用目标的智能体。
  const ordered = agents.filter(agent => choices.has(agent.id));
  let index = 0;
  const menu = new Map<string, AgentChoice>();
  for (const key of choices.keys()) {
    const id = key === "native" ? key : ordered[index++].id;
    menu.set(id, choices.get(id)!);
  }
  return menu;
}

/** 二级按 CLI 分组，仅在同一 CLI 有多个执行目录时继续补选。 */
function sessionTargetOptions({ targets }: AgentChoice) {
  const groups = new Map<string, [string, SessionTarget][]>();
  for (const entry of targets) {
    const runtime = entry[1].runtime;
    const group = groups.get(runtime);
    if (group) group.push(entry);
    else groups.set(runtime, [entry]);
  }
  return [...groups].map(([runtime, entries]) => {
    const [value, target] = entries[0];
    const cli = { label: target.runtimeLabel, icon: <CliBrandIcon runtime={runtime} /> };
    if (entries.length === 1) return { ...cli, value };
    const directories = entries.map(([value, { environment, directory }]) => {
      const root = environment.roots?.find(({ id }) => id === directory.rootId);
      const path = [root?.path || directory.rootId, directory.relativePath].join(" / ");
      return { value, label: environment.name + " · " + path, directory };
    });
    const children = directories.map(({ value, label, directory }) => ({
      value,
      label: directories.filter((d) => d.label === label).length === 1
        ? label
        : label + " · " + directory.environmentId + " / " + directory.rootId,
    }));
    return { ...cli, value: runtime, children };
  });
}

/** 环境会话只在当前页面内保留已加载内容，离线不写入浏览器持久化缓存。 */
export function Sessions({
  state,
  selected,
  projects,
  onProjects,
  onPinSaved,
  onDeleted,
  onRefreshAfterDelete,
  onCreateAgent,
  action,
  onRefresh,
}: any) {
  useLocale();
  const session = state.sessions.find((s: any) => s.id === selected);
  const native = session?.claudeMode === "environment";
  const [autoTerminal, setAutoTerminal] = useState("");
  const publications = useSessionPublications(native ? undefined : session?.id);
  const boardConfirmations = useBoardConfirmations(native ? undefined : session?.id);
  const lightConfirmations = useSessionLightConfirmations(native ? undefined : session?.id);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<UiFeedback>("");
  const [syncIncomplete, setSyncIncomplete] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<UiFeedback>("");
  const [draft, setDraft] = useState("");
  const [commandDialog, setCommandDialog] = useState<"rename" | "chooseSession" | "chooseModel" | "">("");
  const [renameWord, setRenameWord] = useState("rename");
  const [commandTitle, setCommandTitle] = useState("");
  const [targets, setTargets] = useState<{ id: string; title: string }[]>([]);
  const [failedExecution, setFailedExecution] = useState("");
  const [commandError, setCommandError] = useState<UiFeedback>("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [configuring, setConfiguring] = useState(false);
  const [list, setList] = useState(!selected);
  const [busy, setBusy] = useState(false);
  const [fileHref, setFileHref] = useState("");
  const fileSession = useRef("");
  useEffect(() => setFileHref(""), [selected]);
  const [answerModal, setAnswer] = useState<any>(null);
  const [archiveFilter, setArchiveFilter] = useState("active");
  const [selection, setSelection] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const rangeAnchor = useRef("");
  const managementLock = useRef(false);
  const [managing, setManaging] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{
    failure?: UiFeedback;
    reason?: UiFeedback;
    unsynced: boolean;
  } | null>(null);
  const removedCandidate = useRef("");
  useEffect(() => {
    if (removedCandidate.current && removedCandidate.current === selected && !session) {
      removedCandidate.current = "";
      location.hash = "chat";
    }
  }, [state.sessions, selected, session, managing]);
  const [confirm, setConfirm] = useState<any>(null);
  const [pending, setPending] = useState<any>(null);
  const [streaming, setStreaming] = useState(false);
  const current = useRef(selected);
  current.current = selected;
  const currentSession = useRef(session);
  currentSession.current = session;
  const refreshState = useRef(onRefresh);
  refreshState.current = onRefresh;
  const checkIndexedState = useRef<(status: string, run: string) => void>(() => {});
  const refreshHistory = useRef<() => void>(() => {});
  const messages = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  // 新会话可能先于列表到达：依赖实际 session.id，避免空列表使订阅永久跳过。
  useEffect(() => {
    setCommandDialog("");
    setCommandError("");
    setCommandReceipt(null);
    setFailedExecution("");
    setDetailsOpen(false);
    setHistoryError("");
    setSyncIncomplete(false);
    setHistory(null);
    setHistoryLoading(!!session && !native);
    setHistoryLoaded(false);
    setError("");
    setDraft("");
    setMentions([]);
    setPending(null);
    setConfiguring(false);
    setBusy(false);
    setAnswer(null);
    setList(!selected);
    follow.current = true;
    if (!session || native) return;
    let cancelled = false;
    let loading = false;
    let reloadQueued = false;
    const revisions = { status: 0, title: 0, interactions: 0 };
    const sequence = new Map<string, number>();
    let runningRead: string | undefined;
    let terminalRun: string | undefined;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const terminal = (status: string) => ["completed", "failed", "cancelled"].includes(status);
    // 仅在恢复任务未收敛时退避；旧连接器没有可核对的标识时保留手动入口。
    const retry = () => {
      clearTimeout(timer);
      if (retries < 4) timer = setTimeout(() => void load(), Math.max(pollDelay(), 500 * 2 ** retries++));
      setSyncIncomplete(true);
    };
    // 首次读取独立于 SSE 元数据，后续对账不遮挡已有记录。
    let loaded = false;
    const load = async () => {
      if (cancelled || document.hidden) return;
      if (pollDelay()) {
        clearTimeout(timer);
        timer = setTimeout(() => void load(), pollDelay());
        return;
      }
      if (loading) {
        reloadQueued = true;
        return;
      }
      loading = true;
      if (!loaded) setHistoryLoading(true);
      const started = { ...revisions };
      const indexed = currentSession.current;
      try {
        const snapshot = await api("/sessions/" + session.id + "/history", undefined, undefined, 30000);
        if (!cancelled) {
          for (const event of snapshot.events || []) {
            sequence.set(event.executionId, Math.max(sequence.get(event.executionId) || 0, event.sequence || 0));
          }
          if (snapshot.status === "running" && (indexed?.status === "running" && indexed.executionId === snapshot.executionId ||
            snapshot.events?.some((event: any) => event.executionId === snapshot.executionId)))
            runningRead = snapshot.executionId;
          if (snapshot.executionId !== snapshot.historyExecutionId) reloadQueued = true;
          clearTimeout(timer);
          if (terminal(snapshot.status)) {
            terminalRun = snapshot.executionId;
            if (snapshot.terminalHistory !== "confirmed") retry();
            else setSyncIncomplete(false);
          } else setSyncIncomplete(false);
          loaded = true;
          setHistoryLoaded(true);
          setHistory((previous: any) => ({
            ...snapshot,
            status: revisions.status !== started.status ? previous?.status : snapshot.status,
            title: revisions.title !== started.title ? previous?.title : snapshot.title,
            interactions: revisions.interactions !== started.interactions || snapshot.executionId !== snapshot.historyExecutionId
              ? previous?.interactions : snapshot.interactions,
            nativeHistory: snapshot.historyError && !snapshot.nativeHistory ? previous?.nativeHistory : snapshot.nativeHistory,
            // 增量信号与历史补读可能交错，按稳定标识保留会话内已有回执。
            boardCards: [...new Map<string, BoardCard>(([...(previous?.boardCards || []), ...(snapshot.boardCards || [])] as BoardCard[])
              .filter(card => card.sessionId === session.id).map(card => [card.id, card])).values()],
            questionRecords: mergeQuestions(
              previous?.questionRecords,
              snapshot.questionRecords,
            ),
            events: mergeSessionEvents(snapshot.events, previous?.events),
          }));
          setHistoryError("");
        }
      } catch (e) {
        if (!cancelled) {
          setHistoryError(caughtFeedback(e as Error));
          retry();
        }
      } finally {
        loading = false;
        if (!cancelled) setHistoryLoading(false);
        // 终态事件可能在历史请求期间到达，随后补读一次，不能丢失对账。
        if (reloadQueued && !cancelled) {
          reloadQueued = false;
          void load();
        }
      }
    };
    const recover = () => {
      clearTimeout(timer);
      retries = 0;
      void load();
    };
    refreshHistory.current = recover;
    const reconcileEnd = (status: string, executionId: string) => {
      if (!terminal(status) || terminalRun === executionId) return;
      terminalRun = executionId;
      recover();
    };
    // 入队时的回读可能早于环境接收新执行；首次进入运行态时补齐环境回显。
    const reconcileState = (status: string, run: string) => {
      if (status === "running" && loaded && run !== runningRead && !sequence.has(run)) {
        runningRead = run;
        recover();
      } else reconcileEnd(status, run);
    };
    checkIndexedState.current = reconcileState;
    const stream = new EventSource("/api/sessions/" + session.id + "/events");
    stream.onmessage = (message) => {
      if (cancelled) return;
      const data = JSON.parse(message.data);

      if (data.type === "ready" || data.type === "environment-ready") {
        if (canPoll()) void boardConfirmations.refresh();
        setStreaming(true);
        if (canPoll()) void lightConfirmations.refresh();
        recover();
      } else if (data.type === "light-confirmation") {
        if (canPoll()) void lightConfirmations.refresh();
      } else if (data.type === "board-confirmation") {
        if (canPoll()) void boardConfirmations.refresh();
      } else if (data.type === "board-card") {
        void load();
      } else if (data.type === "deleted") {
        cancelled = true;
        clearTimeout(timer);
        stream.close();
        setSyncIncomplete(false);
        setHistoryLoading(false);
        setHistory(null);
        setError(
          feedback("web.thisSessionWasDeletedNativeEnvironmentRecordsAreKept"),
        );
      } else if (data.type === "execution-state") {
        // 发送回执可能晚于失败通知，先按执行编号记录，再由草稿持有人匹配。
        if (data.status === "failed") setFailedExecution(data.executionId);
        // 旧执行的迟到事件不能影响新一轮；原生终态由服务端确认后才清理交互。
        if (data.executionId !== currentSession.current?.executionId) return;
        revisions.status++;
        const ended = terminal(data.status);
        setHistory((h: any) => ({
          ...h,
          executionId: data.executionId,
          status: data.status,
          ...(ended ? { interactions: [] } : {}),
        }));
        if (ended) { revisions.interactions++; setAnswer(null); }
        reconcileState(data.status, data.executionId);
        if (canPoll()) void refreshState.current?.();
      } else if (data.type === "metadata") {
        if (data.title) revisions.title++;
        if (data.title) setHistory((h: any) => ({ ...h, title: data.title }));
      } else if (data.type === "update") {
        const event = data.event;
        // 迟到序号仅补时间线，旧交互不能取代已处理的新状态。
        const fresh = !event?.sequence || event.sequence > (sequence.get(event.executionId) || 0);
        if (fresh && data.title) revisions.title++;
        if (fresh && data.status) revisions.status++;
        if (fresh && data.interactions) revisions.interactions++;
        if (event?.sequence) {
          const last = sequence.get(event.executionId) || 0;
          sequence.set(event.executionId, Math.max(last, event.sequence));
          if (loaded && event.sequence > last + 1) recover();
        }
        setHistory((h: any) => ({
          ...h,
          ...(fresh && data.title ? { title: data.title } : {}),
          ...(fresh && data.status ? { executionId: data.executionId, status: data.status } : {}),
          ...(fresh && data.interactions ? { interactions: data.interactions } : {}),
          questionRecords: data.questionRecords
            ? mergeQuestions(h?.questionRecords, data.questionRecords)
            : h?.questionRecords,
          events: mergeSessionEvents(h?.events, data.event ? [data.event] : []),
        }));
        if (fresh) reconcileEnd(data.status, data.executionId);
      }
    };
    stream.onerror = () => {
      if (!cancelled) { setStreaming(false); if (!loaded && !loading) recover(); }
    };
    document.addEventListener("visibilitychange", recover);
    window.addEventListener("pageshow", recover);
    return () => {
      cancelled = true;
      stream.close();
      setStreaming(false);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", recover);
      window.removeEventListener("pageshow", recover);
      checkIndexedState.current = () => {};
      refreshHistory.current = () => {};
    };
  }, [selected, session?.id, native]);
  // 先于索引到达的状态通知由新索引补偿，每一轮只在必要转换时校准。
  useEffect(() => {
    if (historyLoaded && session?.executionId) checkIndexedState.current(session.status, session.executionId);
  }, [historyLoaded, session?.executionId, session?.status]);
  // 本地控制台可以在线切换模式，回到会话页时刷新可用入口。
  const modeEnvironments = state.environments
    .filter((env: SessionEnvironment) => env.online && env.capabilities?.includes("claude-terminal-v1"))
    .map((env: SessionEnvironment) => env.id)
    .join(",");
  useEffect(() => {
    if (!modeEnvironments) return;
    const refreshModes = () => {
      void Promise.allSettled(modeEnvironments.split(",").map((id: string) =>
        api("/environments/" + id + "/runtime-settings"),
      )).then(() => refreshState.current?.());
    };
    refreshModes();
    window.addEventListener("focus", refreshModes);
    return () => window.removeEventListener("focus", refreshModes);
  }, [modeEnvironments]);
  const visible = state.sessions.filter(
    (s: any) =>
      (!filter || s.projectId === filter) &&
      s.title.includes(search) &&
      !!s.archived === (archiveFilter === "archived"),
  );
  useEffect(() => {
    if (filter && !projects.some((project: { id: string }) => project.id === filter))
      setFilter("");
  }, [filter, projects]);
  useEffect(() => {
    rangeAnchor.current = "";
    setSelection([]);
  }, [filter, search, archiveFilter]);
  const exitSelection = () => {
    rangeAnchor.current = "";
    setSelection([]);
    setSelecting(false);
  };
  const manage = async () => {
    if (managementLock.current || !confirm) return;
    managementLock.current = true;
    setManaging(true);
    setError("");
    try {
      if (confirm.action !== "delete") {
        await api("/sessions/manage", confirm);
        setConfirm(null);
        exitSelection();
        await action(async () => {});
        return;
      }
      const ids: string[] = confirm.ids;
      const confirmed = new Set<string>();
      let failure: UiFeedback | undefined;
      let reason: UiFeedback | undefined;
      // 确认框持有独立快照，每批收到成功响应之后才提交下一批。
      for (let offset = 0; offset < ids.length; offset += 200) {
        const batch = ids.slice(offset, offset + 200);
        try {
          const response = await api("/sessions/manage", { action: "delete", ids: batch }, "POST", 30000);
          if (!response?.ok || !Array.isArray(response.ids) || response.ids.length !== batch.length
            || !batch.every(id => response.ids.includes(id))) {
            throw feedback("web.theServiceReturnedUnexpectedDataPleaseTryAgainLater");
          }
          for (const id of batch) confirmed.add(id);
        } catch (error) {
          const { status, code } = error as { status?: number; code?: string };
          const rejected = status && status >= 400 && status < 500 && code;
          failure = feedback(rejected ? "web.sessionDeleteRejected" : "web.sessionDeleteUnknown", {
            done: offset, total: ids.length, batch: offset / 200 + 1,
            remaining: ids.length - offset - batch.length,
          });
          reason = error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")
            ? feedback("web.sessionDeleteConnectionLost")
            : caughtFeedback(error);
          break;
        }
      }
      removedCandidate.current = ids.includes(current.current) ? current.current : "";
      // 即使对账暂时失败，已收到删除回执的会话也不能再次成为删除目标。
      if (confirmed.size) onDeleted(confirmed);
      const synced = await onRefreshAfterDelete();
      setConfirm(null);
      exitSelection();
      if (failure || !synced) setDeleteResult({ failure, reason, unsynced: !synced });
    } catch (error) {
      setError(caughtFeedback(error));
    } finally {
      managementLock.current = false;
      setManaging(false);
    }
  };
  const creating = useRef(false);
  const [creatingProject, setCreatingProject] = useState("");
  const [emptyProject, setEmptyProject] = useState("");
  const [showAgentNotice, setShowAgentNotice] = useState(false);
  const currentAgent = state.agents.find(
    (a: SessionAgent) => a.id === session?.agentId,
  );
  // 仅完整智能体索引可以区分已删除与当前环境不可用。
  const deletedAgent = !!session?.agentId && !currentAgent;
  const avatar = (
    <Avatar
      small
      name={currentAgent?.name ?? "BugPaw Relay"}
      source={currentAgent ? currentAgent.avatar : "/assets/bugpaw-avatar.png"}
    />
  );
  const compatibleAgents = session
    ? state.agents.filter((a: SessionAgent) =>
        agentAvailable(a, session.environmentId, session.runtime),
      )
    : [];
  /** 新会话只使用项目已登记的目录，禁止隐式回退到环境根目录。 */
  const createSession = async (projectId: string, target: SessionTarget) => {
    if (creating.current) return;
    creating.current = true;
    setCreatingProject(projectId);
    setError("");
    try {
      const result = await api("/sessions", {
        title: tr(target.native ? "web.native.title" : "web.newSession"),
        projectId,
        ...target.directory,
        runtime: target.runtime,
        agentId: target.agent?.id ?? null,
        // 未手动选权限时交由服务端读取智能体当前默认值。
      });
      if (result.claudeMode === "environment") setAutoTerminal(result.id);
      await action(async () => {});
      location.hash = "chat/" + result.id;
      setList(false);
    } catch (e) {
      setError(caughtFeedback(e as Error));
    } finally {
      creating.current = false;
      setCreatingProject("");
    }
  };
  const environment = state.environments.find(
    (e: any) => e.id === session?.environmentId,
  );
  // 目标 Claude 以 root 运行时完全权限不可选；切换环境后随 environment 重新判断。
  const rootRestricted =
    session?.runtime === "claude" &&
    environment?.tools?.claude?.runsAsRoot === true;
  const runtimeEnabled = enabledCliOptions(
    environment ? [environment] : [],
  ).some(({ value }) => value === session?.runtime);
  const status = history?.status || session?.status;
  const active = [
    "running",
    "waiting",
    "dispatching",
    "unknown",
    "stopping",
    "queued",
    "starting",
  ].includes(status);
  const uploadCapable = !!environment?.capabilities?.includes("file-push-v1");
  const uploads = useSessionAttachments(
    JSON.stringify([
      session?.id,
      session?.environmentId,
      session?.rootId,
      session?.relativePath,
    ]),
    session?.id || "",
    !!session &&
      !!environment?.online &&
      runtimeEnabled &&
      !session.archived &&
      !active &&
      !configuring &&
      uploadCapable,
  );
  const sendIdentity = useRef<{
    fingerprint: string;
    operationId: string;
    previousMatches: number;
  } | null>(null);
  const [commandReceipt, setCommandReceipt] = useState<{
    id: string;
    executionId: string;
    operationId: string;
    text: string;
    refs: Mention[];
    files: typeof uploads.items;
  } | null>(null);
  const failedCommand =
    commandReceipt &&
    commandReceipt.id === selected &&
    ((session?.executionId === commandReceipt.executionId &&
      session?.status === "failed") ||
      failedExecution === commandReceipt.executionId);
  function restoreCommand() {
    if (!commandReceipt) return;
    setDraft(commandReceipt.text);
    setMentions(commandReceipt.refs);
    uploads.restore(commandReceipt.files);
    setCommandReceipt(null);
    setCommandError(feedback("web.commands.failed"));
  }
  // 执行终态可能晚于发送回执。仅自动恢复空输入框，保留随后编辑的内容。
  useEffect(() => {
    if (failedCommand && !draft && !uploads.items.length) restoreCommand();
    if (commandReceipt && session?.executionId === commandReceipt.executionId && ["completed", "cancelled"].includes(session.status))
      setCommandReceipt(null);
  }, [failedCommand, draft, uploads.items.length, session?.status, commandReceipt]);
  const resumeWhileActive = slashInput(draft)?.name === "resume";
  const send = async (text = draft, literal = false) => {
    if (
      (!text.trim() && !uploads.attachments.length) ||
      uploads.blocked ||
      deletedAgent ||
      busy ||
      configuring ||
      (active && (literal || slashInput(text)?.name !== "resume")) ||
      session?.archived ||
      !runtimeEnabled ||
      !environment?.online
    )
      return;
    const id = session.id;
    const command = !literal && slashInput(text);
    // 响应丢失时相同草稿重用编号；文字、引用或目标变化才生成新操作。
    const fingerprint = JSON.stringify([
      id,
      text,
      literal,
      mentions,
      uploads.attachments,
    ]);
    if (sendIdentity.current?.fingerprint !== fingerprint)
      sendIdentity.current = {
        fingerprint,
        operationId: crypto.randomUUID(),
        previousMatches: events.filter(
          (e: any) =>
            e.type === "user" &&
            e.data.text === attachmentMessage(text, uploads.attachments),
        ).length,
      };
    const operationId = sendIdentity.current.operationId;
    const attachments = uploads.attachments;
    const displayText = attachmentMessage(text, attachments);
    const previousMatches = sendIdentity.current.previousMatches;
    setBusy(true);
    setError("");
    setCommandError("");
    follow.current = true;
    if (!command)
      setPending({
        text: displayText,
        previousMatches,
        operationId,
        status: tr("web.sending"),
      });
    try {
      const result = await api("/sessions/" + id + "/send", {
        message: text,
        literal,
        mentions,
        attachments,
        operationId,
      });
      if (current.current !== id) return;
      if (result.action) {
        setPending(null);
        sendIdentity.current = null;
        if (result.action === "rename") {
          setRenameWord(command ? command.name : "rename");
          setCommandTitle(history?.title || session.title);
          setCommandDialog("rename");
        } else if (result.action === "chooseSession") {
          setTargets(result.sessions);
          setCommandDialog("chooseSession");
        } else if (result.action === "navigate") {
          setDraft("");
          setMentions([]);
          location.hash = "chat/" + result.sessions[0].id;
        } else if (result.action === "chooseModel")
          setCommandDialog("chooseModel");
        else if (result.action === "newSession") {
          await createSession(result.scope.projectId, {
            directory: {
              environmentId: result.scope.environmentId,
              rootId: result.scope.rootId,
              relativePath: result.scope.relativePath,
            },
            environment,
            runtime: result.scope.runtime,
            runtimeLabel: session.runtime,
            agent: currentAgent || null,
          });
        } else if (result.action === "renamed") {
          setHistory((h: any) => ({ ...h, title: result.title }));
          setCommandDialog("");
          setDraft("");
          setMentions([]);
          void refreshState.current?.();
        }
        return;
      }
      if (command && result.status === "failed") {
        setCommandError(feedback("web.commands.failed"));
        setPending(null);
        sendIdentity.current = null;
        return;
      }
      if (command && result.executionId && result.status !== "completed")
        setCommandReceipt({
          id,
          executionId: result.executionId,
          operationId,
          text,
          refs: mentions,
          files: uploads.items,
        });
      setDraft("");
      setMentions([]);
      uploads.clear();
      sendIdentity.current = null;
      setHistory((h: any) => h?.executionId === result.executionId && h?.status
        ? h : { ...h, executionId: result.executionId, status: result.status || h?.status });
      setPending({
        text: displayText,
        previousMatches,
        operationId,
        status: tr("web.sent"),
        executionId: result.executionId,
      });
      refreshHistory.current();
    } catch (e) {
      if (current.current !== id) return;
      if (e instanceof Error && "code" in e && e.code === "SESSION_AGENT_DELETED") {
        setPending(null);
        sendIdentity.current = null;
        setError(caughtFeedback(e));
        void refreshState.current?.();
        return;
      }
      if (command || literal) {
        setCommandError(caughtFeedback(e));
        setPending(null);
        return;
      }
      setPending({
        text: displayText,
        previousMatches,
        operationId,
        status: tr(
          "web.sendResultUnconfirmedCheckExecutionStatusBeforeRetrying",
        ),
      });
      setError(caughtFeedback(e as Error));
    } finally {
      if (current.current === id) setBusy(false);
    }
  };
  /** 配置写入成功后再刷新索引，发送期间保持配置与实际执行一致。 */
  const configure = async (patch: {
    agentId?: string | null;
    permission?: string;
    runtimeOptions?: RuntimeOptions;
  }) => {
    const id = session.id;
    setConfiguring(true);
    try {
      setError("");
      await api("/sessions/" + session.id + "/config", {
        agentId: session.agentId || null,
        permission: session.permission,
        runtimeOptions: session.runtimeOptions,
        ...patch,
      });
      await action(async () => {});
      if (current.current !== id) return;
      if (commandDialog === "chooseModel") {
        setCommandDialog("");
        setDraft("");
        setMentions([]);
      }
    } catch (e) {
      if (current.current !== id) return;
      if (commandDialog) setCommandError(caughtFeedback(e));
      else setError(caughtFeedback(e as Error));
    } finally {
      if (current.current === id) setConfiguring(false);
    }
  };
  const agentPicker = (closeSignal?: string) => compatibleAgents.length ? (
      <Select
        label={tr("web.sessionAgent")}
        closeSignal={closeSignal}
        iconOnly
        trigger={avatar}
        value={session.agentId || ""}
        options={compatibleAgents.map((a: SessionAgent) =>
          agentOption(a, compatibleAgents)
        )}
        disabled={active || busy || configuring || !!session.archived}
        onChange={(agentId) => void configure({ agentId })}
      />
    ) : (
      <Button
        shape="icon"
        variant="ghost"
        aria-label={tr("web.sessionAgent")}
        disabled={active || busy || configuring || !!session.archived}
        onClick={() => setShowAgentNotice(true)}
      >
        {avatar}
      </Button>
    );
  const historicalAgents = new Map<string, { id: string; name: string }>(
    (history?.executionStarts || []).filter((run: any) => run.agent).map((run: any) => [run.id, run.agent]),
  );
  const knownAgents = new Map([...historicalAgents.values()].map(agent => [agent.id, agent]));
  function messageAgent(executionId?: string) {
    // 旧原生历史可能缺少执行编号，仅在历史身份唯一时沿用该身份。
    const original = executionId ? historicalAgents.get(executionId) :
      knownAgents.size === 1 ? knownAgents.values().next().value : undefined;
    if (original) return { name: original.name, avatar: state.agents.find((a: SessionAgent) => a.id === original.id)?.avatar };
    if (!knownAgents.size && currentAgent) return currentAgent;
    return { name: deletedAgent && !knownAgents.size ? session.agentId : session.runtime === "claude" ? "Claude" : "Codex" };
  }
  const events = historyEvents(
    history
      ? {
          ...history,
          nativeHistory: localizeProjection(
            history.nativeHistory,
            history.nativeDisplayNotices,
            currentLocale(),
          ),
          events: history.events?.map((event: any) => ({
            ...event,
            data: localizeProjection(
              event.data,
              event.displayNotices,
              currentLocale(),
            ),
          })),
        }
      : history,
    true,
  );
  const timeline = sessionPublicationEvents(
    events,
    [...(historyLoaded || historyError || events.length ? publications.rows || [] : []),
      ...(history?.boardCards || []).filter((card: BoardCard) => card.sessionId === selected)
        .map((card: BoardCard) => ({...card, boardCard: true}))],
    history,
  );
  const pendingVisible =
    pending &&
    events.filter((e: any) => e.type === "user" && e.data.text === pending.text)
      .length <= pending.previousMatches &&
    !history?.events?.some(
      (e: any) =>
        e.type === "user" &&
        (e.data.operationId === pending.operationId ||
          (pending.executionId && e.executionId === pending.executionId)),
    );
  useEffect(() => {
    if (follow.current && messages.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  }, [history, pending, timeline.length]);
  // 置顶顺序来自服务端索引；归档会话始终保留在项目组内。
  const pinned = visible.filter((s: any) => !s.archived && s.pinOrder != null)
    .sort((a: any, b: any) => b.pinOrder - a.pinOrder);
  const [pinning, setPinning] = useState("");
  const [pinError, setPinError] = useState<UiFeedback>("");
  const movedMenu = useRef("");
  useEffect(() => {
    if (!movedMenu.current) return;
    const row = document.getElementById("session-row-" + movedMenu.current);
    // 行跨组重建后恢复菜单焦点；用户已转移焦点时保留其当前位置。
    if (row && document.activeElement === document.body) {
      // 取消置顶后项目可能收起，将焦点交还给可见的项目标题。
      const target = row.closest("details:not([open])")?.querySelector("summary")
        ?? row.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
      target?.focus();
    }
    movedMenu.current = "";
  }, [state.sessions, list]);
  async function savePin(s: any) {
    setPinning(s.id);
    setPinError("");
    try {
      const { id, pinOrder } = await api("/sessions/" + s.id + "/pin", { pinned: s.pinOrder == null }, "PUT");
      if (document.activeElement?.closest(".session-entry")?.id === "session-row-" + id)
        movedMenu.current = id;
      onPinSaved(id, pinOrder);
    } catch (e) {
      setPinError(caughtFeedback(e as Error));
    } finally {
      setPinning("");
    }
  }
  const renderCard = (s: any) => (
    <SessionCard
      key={s.id}
      title={s.title}
      active={s.id === selected}
      selecting={selecting}
      checked={selection.includes(s.id)}
      archived={s.archived}
      pinned={s.pinOrder != null}
      rowId={"session-row-" + s.id}
      pinBusy={!!pinning}
      onPin={() => void savePin(s)}
      onCheck={(checked: boolean, shift: boolean) => {
        if (shift && rangeAnchor.current) {
          // details 的展开状态由浏览器管理，直接依据本列表实际渲染顺序取区间。
          const sidebar = document.getElementById("session-row-" + s.id)?.closest(".session-list");
          const order = Array.from(sidebar?.querySelectorAll<HTMLElement>(".session-entry") ?? [])
            .filter(row => !row.closest("details:not([open])"))
            .map(row => row.id.slice("session-row-".length));
          const start = order.indexOf(rangeAnchor.current);
          const end = order.indexOf(s.id);
          if (start >= 0 && end >= 0) {
            const range = order.slice(Math.min(start, end), Math.max(start, end) + 1);
            setSelection(ids => [...new Set([...ids, ...range])]);
            return;
          }
        }
        rangeAnchor.current = s.id;
        setSelection(ids => checked ? [...new Set([...ids, s.id])] : ids.filter(id => id !== s.id));
      }}
      onOpen={() => {
        location.hash = "chat/" + s.id;
        setList(false);
      }}
      onSelect={() => {
        rangeAnchor.current = s.id;
        setSelecting(true);
        setSelection([s.id]);
      }}
      onManage={(operation: string) =>
        setConfirm({ ids: [s.id], action: operation })
      }
      status={s.status}
    />
  );
  return (
    <WorkspaceLayout kind="conversations" open={list}>
      <SessionSidebar
        open={list}
        onClose={() => setList(false)}
        label={tr("web.environmentSessions")}
      >
        <div className="session-project-filter">
          <Select
            label={tr("web.filterProjects")}
            value={filter}
            options={options(projects, tr("web.allProjects"))}
            onChange={setFilter}
          />
          <Button
            shape="icon"

            aria-label={tr("web.projectManagement")}
            title={tr("web.projectManagement")}
            onClick={onProjects}
          >
            <Folder aria-hidden="true" />
          </Button>
        </div>
        <Input
          variant="search"
          value={search}
          placeholder={tr("web.searchSessions")}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="section-label">
          {archiveFilter === "archived"
            ? tr("web.archivedSessions")
            : tr("web.recentSessions")}
          <NavigationButton
            kind="archive"

            onClick={() =>
              setArchiveFilter(
                archiveFilter === "archived" ? "active" : "archived",
              )
            }
          >
            {archiveFilter === "archived"
              ? tr("web.backToRecentSessions")
              : tr("web.viewArchive")}
          </NavigationButton>
        </div>
        {(!session || list) && <ErrorBox error={error} />}
        <ErrorBox error={pinError} />
        {pinned.length > 0 && (
          <section aria-label={tr("web.pinnedSessions")}>
            <div className="section-label">{tr("web.pinnedSessions")}</div>
            {pinned.map(renderCard)}
          </section>
        )}
        {projects
          .filter((p: any) => !filter || p.id === filter)
          .map((p: SessionProject) => {
            const projectMatches = visible.filter((s: any) => s.projectId === p.id);
            const matches = projectMatches.filter((s: any) => s.archived || s.pinOrder == null);
            const choices = sessionAgentChoices(
              p,
              state.environments,
              state.agents,
            );
            const directoryEnvironments = [
              ...new Set(p.directories.map((d) => d.environmentId)),
            ];
            const online = state.environments.filter(
              (env: SessionEnvironment) =>
                env.online && directoryEnvironments.includes(env.id),
            );
            const hasCli = enabledCliOptions(online).length > 0;
            const needsAgent =
              choices.size === 1 &&
              choices.has("native") &&
              online.some((env: SessionEnvironment) =>
                enabledCliOptions([env]).some(
                  ({ value }) =>
                    value !== "claude" ||
                    env.tools?.claude?.mode !== "environment",
                ),
              );
            const targetByValue = new Map(
              [...choices.values()].flatMap((choice) => [...choice.targets]),
            );
            return (
              <details className="project-group" key={p.id}>
                <summary>
                  <Folder size={15} />
                  <strong>{p.name}</strong>
                  <small>{matches.length}</small>
                  {choices.size ? (
                    <Select
                      label={tr("web.newSessionAlternative571") + p.name}
                      value=""
                      iconOnly
                      trigger={<MessageSquarePlus aria-hidden="true" />}
                      closeSignal={list ? "open" : "closed"}
                      disabled={!!creatingProject}
                      options={[...choices].map(([id, choice]) => {
                        const targets = sessionTargetOptions(choice);
                        const option = agentOption(
                          { id, name: choice.name, avatar: choice.avatar },
                          [...choices.values()],
                        );
                        return choice.targets.size === 1
                          ? { ...option, value: targets[0].value }
                          : { ...option, children: targets };
                      })}
                      onChange={(value) => {
                        const target = targetByValue.get(value);
                        if (target) void createSession(p.id, target);
                      }}
                    />
                  ) : (
                    <Button
                      icon={<MessageSquarePlus />}
                      aria-label={tr("web.newSessionAlternative571") + p.name}
                      onClick={() => setEmptyProject(p.id)}
                    />
                  )}
                </summary>
                {/* 项目收起时仍需显示从标题按钮打开的提示。 */}
                {emptyProject === p.id && !choices.size && createPortal(
                  <Modal
                    title={tr("web.newSession")}
                    onClose={() => setEmptyProject("")}
                  >
                    {!p.directories.length ? (
                      <p>{tr("web.agentPicker.directory")}</p>
                    ) : !online.length ? (
                      <p>{tr("web.offline")}</p>
                    ) : !hasCli ? (
                      <CliAvailabilityNotice
                        environmentId={
                          directoryEnvironments.length === 1
                            ? directoryEnvironments[0]
                            : undefined
                        }
                      />
                    ) : (
                      <>
                        <p>{tr("web.agentPicker.empty")}</p>
                        <Button
                          onClick={() => {
                            setEmptyProject("");
                            onCreateAgent();
                          }}
                        >
                          {tr("web.newAgent")}
                        </Button>
                      </>
                    )}
                  </Modal>,
                  document.body,
                )}
                {needsAgent && (
                  <p>
                    {tr("web.agentPicker.empty")}{" "}
                    <Button onClick={onCreateAgent}>
                      {tr("web.newAgent")}
                    </Button>
                  </p>
                )}
                {matches.map(renderCard)}
                {!projectMatches.length && (
                  <p className="group-empty">
                    {search
                      ? tr("web.noMatchingSessions")
                      : archiveFilter === "archived"
                        ? tr("web.noArchivedSessionsInThisProject")
                        : tr("web.noSessionsInThisProjectYet")}
                  </p>
                )}
              </details>
            );
          })}
        {!projects.length && (
          <p className="group-empty">
            {tr("web.addAProjectInProjectManagementThenCreateA")}
          </p>
        )}
        {selecting && (
          <SessionBatch
            visible={visible}
            selection={selection}
            setSelection={setSelection}
            archived={archiveFilter === "archived"}
            onExit={exitSelection}
            onManage={(operation: string) =>
              setConfirm({ ids: [...new Set(selection)], action: operation })
            }
          />
        )}
      </SessionSidebar>
      {showAgentNotice && (
        <Modal
          title={tr("web.sessionAgent")}
          onClose={() => setShowAgentNotice(false)}
        >
          <p>{tr("web.agentPicker.empty")}</p>
          <Button
            onClick={() => {
              setShowAgentNotice(false);
              onCreateAgent();
            }}
          >
            {tr("web.newAgent")}
          </Button>
        </Modal>
      )}
      <ConversationPane>
        {!session ? (
          <>
            {/* 空态入口与会话标题共用顶部位置，避免混入居中说明而难以发现。 */}
            <div className="chat-heading empty-chat-heading">
              <div>
                <Button
                  placement="sidebar-toggle"
                  shape="icon"
                  aria-expanded={list} onClick={() => setList(!list)}

                  aria-label={tr("web.sessionList")}
                  title={tr("web.sessionList")}
                >
                  <PanelLeft aria-hidden="true" />
                </Button>
                <h2>{tr("web.sessions")}</h2>
              </div>
            </div>
            <Empty title={tr("web.selectASessionToCollaborate")}>
              {tr("web.sessionsRunInYourDevelopmentEnvironmentClosingThePage")}
            </Empty>
          </>
        ) : (
          <>
            <ConversationHeader
              title={history?.title || session.title}
              navigation={<Button placement="sidebar-toggle" shape="icon" aria-label={tr("web.sessionList")} aria-expanded={list} onClick={() => setList(!list)}><PanelLeft aria-hidden="true" /></Button>}
              actions={<ActionMenu label={tr("ui.more")} icon={<MoreHorizontal aria-hidden="true" />} items={[
                { label: tr("web.sessionDetails"), onSelect: () => setDetailsOpen(true) },
                { label: session.archived ? tr("web.unarchive") : tr("web.archive"), disabled: active, onSelect: () => setConfirm({ ids: [session.id], action: session.archived ? "restore" : "archive" }) },
                { label: tr("web.delete"), danger: true, disabled: active, onSelect: () => setConfirm({ ids: [session.id], action: "delete" }) },
              ]} />}
              summary={`${environment?.name || ""} / ${session.relativePath}`}
              status={<Status value={status} />}
            />
            {detailsOpen && <Modal title={tr("web.sessionDetails")} onClose={() => setDetailsOpen(false)}>
              <h3>{history?.title || session.title}</h3>
              <Metadata items={[
                { label: tr("web.environment"), value: environment?.name || "" },
                { label: tr("ui.fullPath"), value: session.relativePath },
                { label: tr("web.codingTools"), value: session.runtime },
                { label: tr("web.sessionPermission"), value: native
                  ? tr("web.native.permission")
                  : permissionLabel(session.permission) },
              ]} />
              <Status value={status} />
            </Modal>}
            {!list && <><ErrorBox error={error} /><ErrorBox error={historyError} /></>}
            {native && deletedAgent && (
              <div><p role="status">{tr("errors.SESSION_AGENT_DELETED.reselect")}</p>{agentPicker()}</div>
            )}
            {native ? (
              <Suspense fallback={<p role="status">{tr("web.native.status.opening")}</p>}>
                <ClaudeTerminal
                  key={session.id}
                  sessionId={session.id}
                  autoOpen={autoTerminal === session.id}
                  online={!!environment?.online}
                  disabled={!runtimeEnabled || !!session.archived || !!environment?.revoked || (deletedAgent && status !== "running")}
                  canClose={!session.archived && !environment?.revoked}
                  running={status === "running"}
                  onChanged={() => {
                    setAutoTerminal("");
                    void onRefresh?.();
                  }}
                />
              </Suspense>
            ) : (
            <>
            <BoardConfirmations key={"board:" + session.id} collection={boardConfirmations} sessionId={session.id} />
            <SessionLightConfirmations
              key={session.id}
              collection={lightConfirmations}
              onDecision={publications.refresh}
            />
            {syncIncomplete && <p role="status">{tr("web.sessionHistoryUnconfirmed")}{" "}
              <Button onClick={() => refreshHistory.current()}>{tr("web.retry")}</Button>
            </p>}
            {historyError && history && (
              <p className="note">
                {tr("web.theContentBelowWasLoadedEarlierOnThisPage")}
              </p>
            )}
            <div
              className="messages session-messages"
              aria-live="polite"
              aria-busy={historyLoading}
              ref={messages}
              onScroll={() => {
                const element = messages.current;
                if (element)
                  follow.current =
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight <
                    80;
              }}
            >
              <div className="workbench-message-content">
                {historyLoading && (
                  <div className="session-history-loading" role="status">
                    <LoaderCircle
                      className="spin"
                      size={20}
                      aria-hidden="true"
                    />
                    <span>
                      {tr("web.loadingSessionHistoryFromTheEnvironment")}
                    </span>
                  </div>
                )}
                {history?.historyError && (
                  <ErrorBox
                    error={
                      history.historyErrorDetails || feedback("common.failure")
                    }
                  />
                )}{" "}
                {history?.gap && !history?.nativeHistory && (
                  <p className="error-box">
                    {tr(
                      "web.liveEventsExceededTheBufferReferToNativeEnvironment",
                    )}
                  </p>
                )}
                {publications.status}
                {sessionTimeline(timeline).map((group: any) =>
                  group.event?.type === "board-card" ? (
                    <SessionBoardCard key={group.id} card={group.event.version} />
                  ) : group.event?.type === "light-publication" ? (
                    <SessionPublication
                      key={group.id}
                      version={group.event.version}
                      sources={state}
                      onOpen={publications.open}
                    />
                  ) : group.event?.type === "question" ? (
                    <QuestionCard
                      key={group.id}
                      record={group.event.record}
                      connected={!!environment?.online && streaming}
                      capable={!!environment?.capabilities?.includes("user-questions-v1")}
                    />
                  ) : group.blocks ? (
                    <WorkbenchActivityGroup
                      key={group.id + ":" + group.followedByText}
                      blocks={group.blocks}
                      followedByText={group.followedByText}
                      nativeNames
                    />
                  ) : (
                    <NativeEvent
                      key={group.id}
                      event={group.event}
                      sessionId={session.id}
                      online={!!environment?.online}
                      showIdentity={group.showIdentity}
                      agent={messageAgent(group.event.executionId)}
                      onFile={(href: string) => {
                        fileSession.current = session.id;
                        setFileHref(href);
                      }}
                    />
                  ),
                )}
                {pendingVisible && (
                  <article className="message user-message">
                    <MessageIdentity user status={pending.status} />
                    <WorkbenchMarkdown
                      text={pending.text}
                      sessionId={session.id}
                      online={!!environment?.online}
                      onFile={(href) => {
                        fileSession.current = session.id;
                        setFileHref(href);
                      }}
                    />
                  </article>
                )}
                {historyLoaded &&
                  !historyLoading &&
                  !error && !historyError && !syncIncomplete &&
                  !history?.historyError &&
                  !timeline.length &&
                  !pending && (
                    <p className="note">
                      {tr("web.sendYourFirstMessageToolOperationsRunInThe")}
                    </p>
                  )}
                {!environment?.capabilities?.includes("user-questions-v1") &&
                  history?.interactions?.some(
                    (i: any) =>
                      i.question ||
                      [
                        "item/tool/requestUserInput",
                        "AskUserQuestion",
                      ].includes(i.method),
                  ) && <p className="error-box">{tr("questions.upgrade")}</p>}
                {history?.interactions
                  ?.filter(
                    (i: any) =>
                      !i.question &&
                      ![
                        "item/tool/requestUserInput",
                        "AskUserQuestion",
                      ].includes(i.method),
                  )
                  .map((i: any) => (
                    <div className="approval" key={i.id}>
                      <h3>{tr("web.awaitingNativeInteraction")}</h3>
                      <p>{i.method}</p>
                      <pre>{JSON.stringify(i.params, null, 2)}</pre>
                      <Button variant="primary" onClick={() => setAnswer(i)}>
                        {tr("web.viewAndRespond")}
                      </Button>
                    </div>
                  ))}
              </div>
            </div>
            <Composer
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) e.preventDefault();
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                if (busy) return;
                if (
                  Array.from(e.dataTransfer.items).some(
                    (item) => item.webkitGetAsEntry?.()?.isDirectory,
                  )
                ) {
                  setError(feedback("attachments.noDirectories"));
                  return;
                }
                uploads.add(Array.from(e.dataTransfer.files));
              }}
              onPaste={(e) => {
                if (busy) return;
                const files = Array.from(e.clipboardData.files).filter((file) =>
                  file.type.startsWith("image/"),
                );
                if (!files.length) return;
                // 混合剪贴板仍由 textarea 原生插入文字，不吞掉用户说明。
                if (!e.clipboardData.getData("text/plain")) e.preventDefault();
                uploads.add(files);
              }}
            >
              {session.archived && (
                <p className="note">
                  {tr("web.thisSessionIsArchivedUnarchiveToSendMessages")}
                </p>
              )}
              {/* 正常连接不占用对话空间，仅在恢复期间提示同步状态。 */}
              {!streaming && (
                <small className="note">
                  {tr("web.restoringLiveConnectionSyncingPeriodically")}
                </small>
              )}
              {!runtimeEnabled && (
                <CliAvailabilityNotice
                  environmentId={session.environmentId}
                  binding
                />
              )}
              <AttachmentPicker
                uploads={uploads}
                sessionId={session.id}
                capable={uploadCapable}
                online={!!environment?.online}
                disabled={
                  busy ||
                  configuring ||
                  active ||
                  !!session.archived ||
                  !runtimeEnabled ||
                  !environment?.online
                }
                onOpen={(href) => {
                  fileSession.current = session.id;
                  setFileHref(href);
                }}
              />
              {!commandDialog && <ErrorBox error={commandError} />}
              {failedCommand && (
                <Button
                  onClick={restoreCommand}
                  disabled={!!draft || !!uploads.items.length}
                >
                  {tr("web.commands.recover")}
                </Button>
              )}
              <MentionComposer
                runtime={session.runtime}
                key={session.id}
                sessionId={session.id}
                online={!!environment?.online}
                disabled={!!session.archived || busy || !runtimeEnabled}
                value={draft}
                mentions={mentions}
                onChange={(text, refs) => {
                  setCommandError("");
                  setDraft(text);
                  setMentions(refs);
                }}
                onSend={() => void send()}
              />
              {slashInput(draft) && (
                <Button
                  variant="ghost"
                  disabled={
                    deletedAgent ||
                    busy ||
                    active ||
                    configuring ||
                    !runtimeEnabled ||
                    !environment?.online ||
                    session.archived ||
                    uploads.blocked
                  }
                  onClick={() => void send(draft, true)}
                >
                  {tr("web.commands.literal")}
                </Button>
              )}
              {session.agentId &&
                !state.agents.some(
                  (a: any) =>
                    a.id === session.agentId &&
                    agentAvailable(a, session.environmentId, session.runtime),
                ) && (
                  <p className="error">
                    {tr(deletedAgent ? "errors.SESSION_AGENT_DELETED.reselect" : "web.theCurrentAgentNoLongerAppliesToThisSession")}
                  </p>
                )}
              <div className="composer-bottom session-composer-toolbar">
                <Row>
                  {runtimeEnabled && (
                    <SessionConfiguration sessionId={session.id}>
                      {(closeSignal) => (
                        <>
                          {agentPicker(closeSignal)}
                          <RuntimeOptionsEditor
                            key={"runtime-" + session.id}
                            compact
                            closeSignal={closeSignal}
                            runtime={session.runtime}
                            environmentId={session.environmentId}
                            rootId={session.rootId}
                            relativePath={session.relativePath}
                            value={session.runtimeOptions}
                            agent={state.agents.find(
                              (a: any) => a.id === session.agentId,
                            )}
                            disabled={
                              active ||
                              busy ||
                              configuring ||
                              !!session.archived
                            }
                            onChange={(runtimeOptions) =>
                              void configure({ runtimeOptions })
                            }
                          />
                        </>
                      )}
                    </SessionConfiguration>
                  )}
                  <AttachmentButton
                    count={uploads.attachments.length}
                    capable={uploadCapable}
                    disabled={
                      busy ||
                      configuring ||
                      active ||
                      !!session.archived ||
                      !runtimeEnabled ||
                      !environment?.online
                    }
                    onAdd={uploads.add}
                  />
                  <PermissionSelect
                    label={tr("web.sessionPermission")}
                    restricted={rootRestricted}
                    value={session.permission}
                    disabled={
                      active || busy || configuring || !!session.archived
                    }
                    onChange={(v) => void configure({ permission: v })}
                  />
                </Row>
                <Row>
                  {session.executionId &&
                    [
                      "running",
                      "waiting",
                      "dispatching",
                      "unknown",
                      "stopping",
                      "queued",
                    ].includes(status) && (
                      <Button
                        shape="icon"

                        aria-label={tr("web.stop")}
                        title={tr("web.stop")}
                        onClick={() =>
                          action(() =>
                            api(
                              "/executions/" + session.executionId + "/stop",
                              {},
                            ),
                          )
                        }
                      >
                        <StopIcon />
                      </Button>
                    )}
                  <Button
                    shape="icon"
                    variant="primary"

                    aria-label={tr("web.send")}
                    title={tr("web.sendEnter")}
                    disabled={
                      deletedAgent ||
                      configuring ||
                      busy ||
                      session.archived ||
                      (!draft.trim() && !uploads.attachments.length) ||
                      uploads.blocked ||
                      (active && !resumeWhileActive) ||
                      !runtimeEnabled ||
                      !environment?.online
                    }
                    onClick={() => void send()}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                </Row>
              </div>
              {rootRestricted && session.permission === "full" && (
                <p className="permission-danger" role="note">
                  {tr("web.permission.fullUnavailableSaved")}
                </p>
              )}
              <small className="composer-hint">
                {tr("web.enterToSendShiftCtrlEnterForANew")}
              </small>
            </Composer>
            </>
            )}
          </>
        )}
        {commandDialog && session && (
          <Modal
            title={tr(
              {
                rename: "web.commands.rename",
                chooseSession: "web.commands.resume",
                chooseModel: "web.commands.model",
              }[commandDialog],
            )}
            busy={busy || configuring}
            onClose={() => setCommandDialog("")}
          >
            {commandDialog === "rename" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (commandTitle.trim())
                    void send("/" + renameWord + " " + commandTitle.trim());
                }}
              >
                <Field label={tr("web.commands.rename")}>
                  <Input
                    data-initial-focus
                    value={commandTitle}
                    maxLength={200}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        (e.nativeEvent.isComposing || e.keyCode === 229)
                      )
                        e.preventDefault();
                    }}
                    onChange={(e) => setCommandTitle(e.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || !commandTitle.trim()}
                >
                  {tr("web.save")}
                </Button>
              </form>
            )}
            {commandDialog === "chooseSession" &&
              targets.map((target) => (
                <Button
                  key={target.id}
                  onClick={() => {
                    setCommandDialog("");
                    setDraft("");
                    setMentions([]);
                    location.hash = "chat/" + target.id;
                  }}
                >
                  {target.title} · {target.id}
                </Button>
              ))}
            {commandDialog === "chooseModel" && (
              <RuntimeOptionsEditor
                runtime={session.runtime}
                environmentId={session.environmentId}
                rootId={session.rootId}
                relativePath={session.relativePath}
                agent={currentAgent}
                value={session.runtimeOptions}
                disabled={active || busy || configuring || !runtimeEnabled}
                onChange={(runtimeOptions) => void configure({ runtimeOptions })}
              />
            )}
            <ErrorBox error={commandError} />
          </Modal>
        )}
        {/* 移动端抽屉会停用对话区，管理弹窗需挂在可操作的顶层。 */}
        {deleteResult && createPortal(
          <Modal title={tr("web.deleteSessions")} onClose={() => setDeleteResult(null)}>
            <ErrorBox error={deleteResult.failure} />
            <ErrorBox error={deleteResult.reason} />
            {deleteResult.unsynced && <ErrorBox error={feedback("web.sessionDeleteUnsynced")} />}
            <footer><Button onClick={() => setDeleteResult(null)}>{tr("web.close")}</Button></footer>
          </Modal>,
          document.body,
        )}
        {confirm && createPortal(
          <Modal
            title={
              confirm.action === "delete"
                ? tr("web.deleteSessions")
                : confirm.action === "archive"
                  ? tr("web.archiveSessions")
                  : tr("web.unarchive")
            }
            busy={managing}
            onClose={() => setConfirm(null)}
          >
            <p>
              {tr("web.sessionActionCount", {
                action:
                  confirm.action === "delete"
                    ? tr("web.delete")
                    : confirm.action === "archive"
                      ? tr("web.archive")
                      : tr("web.unarchive"),
                count: confirm.ids.length,
              })}
            </p>
            {confirm.action === "delete" && (
              <p>
                {tr(
                  "web.serverSessionIndexesWillBePermanentlyDeletedNativeEnvironment",
                )}
              </p>
            )}
            <ErrorBox error={error} />
            <Row>
              <Button disabled={managing} onClick={() => setConfirm(null)}>
                {tr("web.cancel")}
              </Button>
              <Button variant="primary" disabled={managing} onClick={manage}>
                {tr(managing ? "web.sessionManagementPending" : "web.confirmOperation")}
              </Button>
            </Row>
          </Modal>,
          document.body,
        )}
        {fileHref && session && fileSession.current === session.id && (
          <EnvironmentFile
            key={session.id + fileHref}
            sessionId={session.id}
            environmentName={environment?.name || ""}
            href={fileHref}
            onClose={() => setFileHref("")}
          />
        )}
        {answerModal && (
          <Modal
            title={tr("web.nativeApprovalsAndUserInput")}
            onClose={() => setAnswer(null)}
          >
            <NativeAnswer
              interaction={answerModal}
              onSaved={() => {
                setAnswer(null);
                refreshHistory.current();
              }}
            />
          </Modal>
        )}
        {publications.viewer}
      </ConversationPane>
    </WorkspaceLayout>
  );
}
function NativeEvent({
  event,
  onFile,
  agent,
  showIdentity,
  sessionId,
  online,
}: any) {
  useLocale();
  const { type, data } = event;
  if (type === "user")
    return (
      <article className="message user-message">
        <MessageIdentity user />
        <WorkbenchMarkdown
          text={data.text || ""}
          sessionId={sessionId}
          online={online}
          onFile={onFile}
        />
      </article>
    );
  if (type === "item/completed") {
    const item = data.item;
    if (item?.type === "agentMessage")
      return (
        <article className="message">
          {showIdentity && <MessageIdentity agent={agent} />}
          <WorkbenchMarkdown text={item.text || ""} onFile={onFile} />
        </article>
      );
    if (item?.type === "userMessage") return null;
    return (
      <details className="toolline">
        <summary>
          {item?.type || tr("web.toolOperation")} ·{" "}
          {item?.status || tr("web.finished")}
        </summary>
        <pre>{JSON.stringify(item, null, 2)}</pre>
      </details>
    );
  }
  if (type === "relay/approval/auto")
    return (
      <p className="note native-retry" role="status">
        {tr("web.approval.auto")}
      </p>
    );
  if (type === "assistant")
    return (
      <article className="message">
        {showIdentity && <MessageIdentity agent={agent} />}
        {data.message?.content?.map((c: any, i: number) =>
          c.type === "text" ? (
            <WorkbenchMarkdown key={i} text={c.text || ""} onFile={onFile} />
          ) : (
            <details className="toolline" key={i}>
              <summary>{c.name || c.type}</summary>
              <pre>{JSON.stringify(c, null, 2)}</pre>
            </details>
          ),
        )}
      </article>
    );
  if (type === "result" && data.is_error)
    return (
      <ErrorBox
        error={tr(
          "web.theNativeRuntimeReportedAFailureCheckLocalConfiguration",
        )}
      />
    );
  if (type === "error") {
    // Codex 的消息位于 error.message；兼容连接器自身发出的平铺错误。
    const message =
      [data.error?.message, data.message].find(
        (value) => typeof value === "string" && value.trim(),
      ) || tr("web.nativeRuntimeError");
    if (data.willRetry === true)
      return (
        <p className="note native-retry" role="status">
          {event.retryState === "recovered"
            ? tr("web.modelConnectionRestoredTheTaskHasResumed")
            : event.retryState === "ended"
              ? tr("web.automaticReconnectionEndedCheckThisExecutionSResult")
              : tr("web.modelConnectionInterruptedReconnectingAutomatically", {
                  p0: message,
                })}
        </p>
      );
    return <ErrorBox error={message} />;
  }
  return null;
}
function NativeAnswer({ interaction: i, onSaved }: any) {
  useLocale();
  const [text, setText] = useState("{}");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<UiFeedback>("");
  const [busy, setBusy] = useState(false);
  const questions = i.params.questions || i.params.input?.questions;
  const command =
    i.method.includes("commandExecution") || i.method.includes("fileChange");
  const claude = !i.method.includes("/");
  async function send(answer: any) {
    setBusy(true);
    try {
      await api("/executions/" + i.executionId + "/answer", {
        interactionId: i.id,
        answer,
      });
      onSaved();
    } catch (e) {
      setError(caughtFeedback(e as Error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>{i.method}</p>
      <pre className="native-request">{JSON.stringify(i.params, null, 2)}</pre>
      {questions
        ? questions.map((q: any) => (
            <Field key={q.id || q.question} label={q.question || q.header}>
              {q.options?.length > 0 && (
                <div className="choices">
                  {q.options.map((o: any) => (
                    <Button
                      key={o.label}
                      onClick={() =>
                        setAnswers({
                          ...answers,
                          [q.id || q.question]: o.label,
                        })
                      }
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              )}
              <Input
                value={answers[q.id || q.question] || ""}
                onChange={(e) =>
                  setAnswers({
                    ...answers,
                    [q.id || q.question]: e.target.value,
                  })
                }
              />
            </Field>
          ))
        : !command &&
          !claude && (
            <Field
              label={tr("web.nativeResponseJsonFillAccordingToTheRequest")}
            >
              <Textarea
                variant="code"
                rows={6}

                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
          )}
      <ErrorBox error={error} />
      <footer>
        {command ? (
          <>
            <Button
              disabled={busy}
              onClick={() => send({ decision: "decline" })}
            >
              {tr("web.reject")}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => send({ decision: "accept" })}
            >
              {tr("web.approveThisTime")}
            </Button>
          </>
        ) : questions ? (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              send(
                claude
                  ? {
                      approve: true,
                      updatedInput: { ...i.params.input, answers },
                    }
                  : {
                      answers: Object.fromEntries(
                        Object.entries(answers).map(([k, v]) => [
                          k,
                          { answers: [v] },
                        ]),
                      ),
                    },
              )
            }
          >
            {tr("web.submitAnswer")}
          </Button>
        ) : claude ? (
          <>
            <Button disabled={busy} onClick={() => send({ approve: false })}>
              {tr("web.reject")}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => send({ approve: true })}
            >
              {tr("web.approveThisTime")}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              try {
                void send(JSON.parse(text));
              } catch {
                setError(feedback("web.invalidJsonFormat"));
              }
            }}
          >
            {tr("web.submitResponse")}
          </Button>
        )}
      </footer>
    </>
  );
}
