import { pollVisible } from "./api.js";
import {
  ConversationHeader,
  BoardHeader,
  BoardToolbar,
  SearchInput,
  IconSelect,
  ActionMenu,
} from "./ui/index.js";
import { Badge } from "./ui/index.js";
import { LinkButton } from "./ui/index.js";
import { AttachmentPicker } from "./ui/index.js";
import { useBoardAttachments } from "./board-attachments.js";
import { EditItem, type EditView } from "./edit-item.js";
import { AppShell, WorkspaceLayout } from "./ui/index.js";
import {
  NavigationButton,
  Page,
  Row,
  SettingsPanel,
  PageHeading,
  ResponsiveImage,
  SurfaceButton,
  Tabs,
  Toolbar,
  DragPreview,
  BoardLayout,
  Textarea,
  ConversationPane,
  Composer,
  FileInput,
} from "./ui/index.js";
import { stageName } from "../shared/board-stages.js";
import {
  feedback,
  caughtFeedback,
  localeState,
  type LanguageSettings,
  type UiFeedback,
} from "./locale.js";
import type { LocalePreference } from "../shared/i18n.js";
import { LanguageMenu } from "./language-menu.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import { advanceItem, canDrag, dragText, useBoardDrag } from "./board-drag.js";
import { NewItem, CreationApproval, creationText } from "./new-item.js";
import { StageLabel, stageLabel, stageText } from "./stage-label.js";
import { BoardTitleEditor } from "./board-title-editor.js";
import QRCode from "qrcode";
import { ReleaseDownload } from "./release-download.js";
import {
  Avatar,
  AvatarUpload,
  IdentityContext,
  MessageIdentity,
} from "./avatar.js";
import { EnvironmentFile } from "./environment-file.js";
import { formatBytes } from "./file-transfer.js";
import { ProjectManagement, orderedSessionProjects, SessionCard, SessionBatch } from "./session-management.js";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  MessagesSquare,
  PanelLeft,
  Columns3,
  PanelsTopLeft,
  Monitor,
  Settings,
  Menu,
  LogOut,
  Plus,
  MessageSquarePlus,
  ArrowUpRight,
  ArrowLeft,
  Sun,
  Moon,
  PawPrint,
  Search,
  Copy,
  Pencil,
  Trash2,
  ArrowUp,
  ImagePlus,
  Minimize2,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  X,
} from "lucide-react";
import {
  api,
  Button,
  SessionSidebar,
  Field,
  Input,
  Select,
  PermissionSelect,
  permissionLabel,
  composerKeyDown,
  Check,
  Modal,
  ErrorBox,
  Empty,
  Status,
  permissions,
  StopIcon,
} from "./ui/index.js";
import { Sessions } from "./sessions.js";
import { Editor, options } from "./editors.js";
import { AgentsPage, EnvironmentsPage, SettingsLayout } from "./pages.js";
import {
  WorkbenchReply,
  CopyMessage,
  WorkbenchMessages,
  useWorkbenchViewport,
} from "./workbench-content.js";
import "katex/dist/katex.min.css";
import "./ui/foundation.css";
import "./ui/collection-layouts.css";
import "./ui/application-layouts.css";
import "./ui/brand-layouts.css";
import "./ui/avatar.css";
import "./ui/ui.css";
import "./ui/monitoring.css";
import { LightAppsPage, LightPublications } from "./light-apps.js";
import { UiShowcase } from "./ui/showcase.js";
const nav = [
  {
    id: "workbench",
    get name() {
      return tr("web.workbench");
    },
    icon: Bot,
  },
  {
    id: "chat",
    get name() {
      return tr("web.sessions");
    },
    icon: MessagesSquare,
  },
  {
    id: "board",
    get name() {
      return tr("web.boards");
    },
    icon: Columns3,
  },
  {
    id: "light-apps",
    get name() {
      return tr("light.title");
    },
    icon: PanelsTopLeft,
  },
  {
    id: "environments",
    get name() {
      return tr("web.environment");
    },
    icon: Monitor,
  },
  {
    id: "agents",
    get name() {
      return tr("web.agent");
    },
    icon: PawPrint,
  },
  {
    id: "settings",
    get name() {
      return tr("web.settings");
    },
    icon: Settings,
  },
];
/** 主题按钮与紧凑导航共用固定顺序。 */
const themes = [
  {
    id: "light",
    icon: Sun,
    get name() {
      return tr("web.light");
    },
  },
  {
    id: "dark",
    icon: Moon,
    get name() {
      return tr("web.dark");
    },
  },
  { id: "bug", icon: PawPrint, name: "BUG" },
];
const emptyState = {
  projects: [],
  sessionProjectIds: [],
  agents: [],
  boards: [],
  items: [],
  handoffs: [],
  environments: [],
  sessions: [],
  models: [],
};
/** 本地外观偏好不可读时沿用默认布局，不阻断应用启动。 */
function readAppearance(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
/** 存储受限时保留本页选择，后续操作仍可重试保存。 */
function saveAppearance(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 外观记忆失败不影响当前页面交互。
  }
}
/** 应用壳沿用已确认导航、主题和会话分栏，所有数据通过认证 API 加载。 */
function App() {
  useLocale();
  const [auth, setAuth] = useState<any>(null);
  const [authError, setAuthError] = useState<UiFeedback>("");
  const [languageError, setLanguageError] = useState<UiFeedback>("");
  const [savingLanguage, setSavingLanguage] = useState(false);
  const authRequest = useRef(0);
  const languageWrite = useRef(0);
  const languagePending = useRef(false);
  const signedOutRequest = useRef(0);

  async function readAuth() {
    const request = ++authRequest.current;
    const write = languageWrite.current;
    const result = await api("/auth/status", undefined, undefined, 10000);
    if (request !== authRequest.current) return;
    // 较早发起的状态读取不能覆盖正在保存或已经保存的选择。
    if (!result.authenticated) signedOutRequest.current = request;
    if (
      result.language &&
      (!result.authenticated ||
        (write === languageWrite.current && !languagePending.current))
    ) {
      if (result.authenticated) localeState?.confirm(result.language);
      else localeState?.anonymous(result.language.serverLocale);
    }
    setAuth(result);
    setAuthError("");
  }

  async function saveLanguage(preference: LocalePreference) {
    if (languagePending.current) return;
    languagePending.current = true;
    languageWrite.current++;
    const request = authRequest.current;
    setSavingLanguage(true);
    setLanguageError("");
    try {
      const result: LanguageSettings = await api(
        "/settings/language",
        { preference },
        "POST",
        10000,
      );
      // 网络恢复可以重新读取登录状态，只有退出登录会使本次保存脱离原会话。
      if (request > signedOutRequest.current) localeState?.confirm(result);
    } catch (error) {
      if (request > signedOutRequest.current) setLanguageError(caughtFeedback(error));
    } finally {
      languagePending.current = false;
      setSavingLanguage(false);
    }
  }

  const [state, setState] = useState<any>(emptyState);
  const [route, setRoute] = useState(location.hash.slice(1) || "workbench");
  const [theme, updateTheme] = useState(
    () => document.documentElement.dataset.theme || "bug",
  );
  const [drawer, setDrawer] = useState(false);
  // 横屏收起是布局状态，与竖屏模态导航抽屉独立。
  const [railCollapsed, setRailCollapsed] = useState(
    () => readAppearance("relay-rail-collapsed") === "true",
  );
  // 用同步引用处理连续点击；持久化只发生在用户操作中，不在状态更新器内执行。
  const railCollapsedRef = useRef(railCollapsed);
  function toggleRail() {
    const collapsed = !railCollapsedRef.current;
    railCollapsedRef.current = collapsed;
    setRailCollapsed(collapsed);
    saveAppearance("relay-rail-collapsed", String(collapsed));
  }
  const currentTheme = themes.find((item) => item.id === theme) || themes[0];
  const nextTheme = themes[(themes.indexOf(currentTheme) + 1) % themes.length];
  const [error, setError] = useState<UiFeedback>("");
  const [refreshError, setRefreshError] = useState<UiFeedback>("");
  const queryEpoch = useRef(0);
  const revisions = useRef<Record<string, string>>({});
  const [readyPage, setReadyPage] = useState("");
  const [missingBoard, setMissingBoard] = useState("");
  const [archiveBoard, setArchiveBoard] = useState("");
  const [notice, setNotice] = useState<UiFeedback>("");
  const [modal, setModal] = useState<any>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const page = route.split("/")[0];
  const selected = route.split("/")[1];
  const currentRoute = useRef(route);
  const flowDirty = useRef(false);
  const [leaveFlow, setLeaveFlow] = useState<{ proceed: () => void } | null>(null);
  const setFlowDirty = (dirty: boolean) => { flowDirty.current = dirty; };
  const requestFlowLeave = (proceed: () => void) => {
    if (flowDirty.current) setLeaveFlow({ proceed });
    else proceed();
  };
  async function saveAgentOrder(agentIds: string[]) {
    try {
      const saved = await api("/agents/order", { agentIds }, "PUT", 15000);
      setState((current: any) => {
        const ranks = new Map<string, number>(saved.agentIds.map((id: string, index: number) => [id, index]));
        const rank = (a: { id: string }) => ranks.get(a.id) ?? ranks.size;
        return { ...current, agents: [...current.agents].sort((a, b) => rank(a) - rank(b)) };
      });
    } finally {
      // 写入冲突或响应丢失时也校准服务端清单。
      void refresh();
    }
  }
  const boardId = page === "board" ? selected : undefined;
  const includeArchived = !!boardId && archiveBoard === boardId;
  const pageGroups: Record<string, string[]> = {
    chat: ["sessions", "projects", "sessionProjectIds", "agents", "environments"],
    board: boardId ? ["projects", "agents", "sessions", "environments"] : ["projects"],
    agents: ["agents", "environments"],
    environments: ["environments", "projects"],
    settings: ["models"],
    workbench: ["models", "sessions"],
    "light-apps": ["projects", "sessions", "environments"],
  };
  const groups = ["boardSummaries", ...(pageGroups[page] || [])];
  if (boardId && missingBoard !== boardId) groups.push("boardPage");
  const pageKey = JSON.stringify([page, boardId]);
  const scope = JSON.stringify([auth?.authenticated, pageKey, groups, includeArchived]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const deletionRefreshScope = useRef("");
  async function refreshAfterDelete() {
    deletionRefreshScope.current = scope;
    try {
      return await refreshIndex();
    } finally {
      deletionRefreshScope.current = "";
    }
  }
  async function refresh() {
    // 删除后的对账覆盖当前页面的轮询，避免并发读取让本次成功响应被当作过期。
    if (deletionRefreshScope.current !== scope) await refreshIndex();
  }
  async function refreshIndex() {
    if (!auth?.authenticated || activeScope.current !== scope) return;
    const epoch = ++queryEpoch.current;
    const key = (group: string) => group === "boardPage" ? JSON.stringify([group, boardId, includeArchived]) : group;
    try {
      const known = Object.fromEntries(groups.map(group => [group, revisions.current[key(group)]]));
      const { changes } = await api("/state/query", { groups, known, boardId, includeArchived }, "POST", 15000);
      if (epoch !== queryEpoch.current || activeScope.current !== scope) return;
      for (const group of Object.keys(changes)) revisions.current[key(group)] = changes[group].revision;
      if (missingBoard && changes.boardSummaries?.value.some((b: any) => b.id === missingBoard))
        setMissingBoard("");
      if (Object.keys(changes).length) setState((current: any) => {
        const next = { ...current };
        for (const group of groups) if (changes[group]) next[group] = changes[group].value;
        next.items = boardId ? next.boardPage?.items || [] : [];
        next.boards = next.boardSummaries.map((summary: any) =>
          boardId === summary.id && next.boardPage?.board.id === boardId
            ? { ...next.boardPage.board, ...summary } : summary);
        return next;
      });
      setReadyPage(pageKey);
      setRefreshError("");
      return true;
    } catch (error: any) {
      if (epoch !== queryEpoch.current || activeScope.current !== scope) return;
      setRefreshError(caughtFeedback(error));
      if (error.status === 404 && boardId) {
        // 目录删除后保留已打开的编辑对话框，由用户关闭草稿。
        delete revisions.current.boardSummaries;
        setMissingBoard(boardId);
      }
      if (error.status === 401) void readAuth().catch(e => setAuthError(caughtFeedback(e)));
    }
  }
  useEffect(() => {
    const checkAuth = () =>
      void readAuth().catch((e) => setAuthError(caughtFeedback(e)));
    checkAuth();
    addEventListener("online", checkAuth);
    const applyRoute = (next: string) => {
      if (next.split("/").slice(0, 2).join("/") !== currentRoute.current.split("/").slice(0, 2).join("/"))
        setArchiveBoard("");
      currentRoute.current = next;
      setRoute(next);
      setDrawer(false);
    };
    const hash = () => {
      const next = location.hash.slice(1) || "workbench";
      if (next === currentRoute.current) return;
      if (!flowDirty.current) {
        applyRoute(next);
        return;
      }
      // 还原地址后再确认离开，避免浏览器历史切换时直接卸载草稿。
      history.replaceState(history.state, "", "#" + currentRoute.current);
      requestFlowLeave(() => {
        history.replaceState(history.state, "", "#" + next);
        applyRoute(next);
      });
    };
    const protectReload = (event: BeforeUnloadEvent) => {
      if (!flowDirty.current) return;
      event.preventDefault();
      event.returnValue = true;
    };
    const net = () => setOnline(navigator.onLine);
    addEventListener("hashchange", hash);
    addEventListener("beforeunload", protectReload);
    addEventListener("online", net);
    addEventListener("offline", net);
    return () => {
      removeEventListener("online", checkAuth);
      removeEventListener("hashchange", hash);
      removeEventListener("beforeunload", protectReload);
      removeEventListener("online", net);
      removeEventListener("offline", net);
    };
  }, []);
  useEffect(() => {
    if (!authError || !online) return;
    const retry = setInterval(() => {
      void readAuth().catch(() => {});
    }, 12000);
    return () => clearInterval(retry);
  }, [authError, online]);
  function setTheme(value: string) {
    document.documentElement.dataset.theme = value;
    updateTheme(value);
    saveAppearance("relay-theme", value);
  }
  useEffect(() => {
    if (!auth?.authenticated) {
      revisions.current = {};
      setReadyPage("");
      setState(emptyState);
      return;
    }
    // 页面仅保留当前看板卡片；重新进入或更改归档范围时重新取得对应投影。
    for (const key of Object.keys(revisions.current)) if (key.startsWith("[")) delete revisions.current[key];
    return pollVisible(refresh, 2000, ["focus", "pageshow", "online"]);
  }, [scope]);
  const sessionProjects = orderedSessionProjects(
    state.projects,
    state.sessionProjectIds,
  );
  const saveProjectOrder = async (ids: string[]) => {
    const { projectIds } = await api("/projects/order", { projectIds: ids }, "PUT");
    setState((current: any) => ({ ...current, sessionProjectIds: projectIds }));
    void refresh();
  };
  const action = async (fn: () => Promise<any>) => {
    try {
      setError("");
      await fn();
      setNotice(feedback("web.operationSucceeded"));
      await refresh();
    } catch (e) {
      setError(caughtFeedback(e as Error));
    }
  };
  const edit = (kind: string, item?: any) =>
    setModal({ type: "edit", kind, item });
  const confirm = (title: string, fn: () => Promise<any>) =>
    setModal({ type: "confirm", title, fn });
  const saved = (id?: string) => {
    if (id && modal?.kind === "boards") location.hash = "board/" + id;
    setNotice(feedback("web.saved"));
    setModal(null);
    void refresh();
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!drawer) return;
    const trigger = document.querySelector<HTMLButtonElement>(".mobile-menu");
    const rail = document.querySelector<HTMLElement>(".rail");
    const focusable = () =>
      Array.from(
        rail?.querySelectorAll<HTMLElement>("a,button:not(:disabled)") || [],
      ).filter((element) => element.getClientRects().length > 0);
    // 等抽屉解除 visibility 隐藏后再移入焦点，避免浏览器忽略对隐藏元素的 focus。
    const focusTimer = setTimeout(
      () => {
        if (!rail?.contains(document.activeElement)) focusable()[0]?.focus();
      },
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 230,
    );
    const dismiss = (event: KeyboardEvent) => {
      if (document.querySelector(".select-options")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawer(false);
      }
      if (event.key === "Tab") {
        const entries = focusable();
        const first = entries[0],
          last = entries.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    addEventListener("keydown", dismiss);
    return () => {
      clearTimeout(focusTimer);
      removeEventListener("keydown", dismiss);
      trigger?.focus();
    };
  }, [drawer]);
  // 屏幕旋转或跨越导航断点时关闭浮层，解除焦点约束。
  useEffect(() => {
    const portrait = matchMedia("(orientation: portrait)");
    const narrow = matchMedia("(max-width: 759px)");
    const close = () => setDrawer(false);
    portrait.addEventListener("change", close);
    narrow.addEventListener("change", close);
    return () => {
      portrait.removeEventListener("change", close);
      narrow.removeEventListener("change", close);
    };
  }, []);
  if (!auth)
    return (
      <main className="loading">
        <div className="auth-language">
          <LanguageMenu />
        </div>
        <img src="/assets/bugpaw-avatar.png" alt="BugPaw Relay" />
        <p>{tr("web.connectingToBugpawRelay")}</p>
        <ErrorBox error={authError} />
      </main>
    );
  if (!auth.authenticated)
    return (
      <Login
        auth={auth}
        onLogin={readAuth}
      />
    );
  return (
    <IdentityContext.Provider
      value={{ username: auth.username, avatar: auth.avatar || "" }}
    >
      <AppShell
        workbench={page === "workbench"}
        drawer={drawer}
        collapsed={railCollapsed}
      >
        <div className="drawer-shade" onClick={() => setDrawer(false)} />
        <aside
          className="rail"
          id="global-navigation"
          role={drawer ? "dialog" : undefined}
          aria-modal={drawer || undefined}
          aria-label={tr("web.mainNavigation")}
        >
          <a className="brand rail-home" href="#workbench">
            <img src="/assets/bugpaw-avatar.png" alt="BugPaw" />
            <span>
              <b>BugPaw Relay</b>
              <small>YOUR ENVIRONMENTS</small>
            </span>
          </a>
          <NavigationButton
            kind="brand"

            aria-label={
              railCollapsed
                ? tr("web.expandNavigation")
                : tr("web.collapseNavigation")
            }
            title={
              railCollapsed
                ? tr("web.expandNavigation")
                : tr("web.collapseNavigation")
            }
            aria-expanded={!railCollapsed}
            aria-controls="global-navigation"
            onClick={toggleRail}
          >
            <img src="/assets/bugpaw-avatar.png" alt="" />
            <span>
              <b>BugPaw Relay</b>
              <small>YOUR ENVIRONMENTS</small>
            </span>
          </NavigationButton>
          <nav className="nav">
            {nav.map((n) => (
              <NavigationButton
                selected={page === n.id}
                kind="main"
                key={n.id}
                aria-label={n.name}
                title={n.name}

                aria-current={page === n.id ? "page" : undefined}
                onClick={() => {
                  location.hash = n.id;
                  setDrawer(false);
                }}
              >
                <n.icon aria-hidden="true" />
                <span>{n.name}</span>
              </NavigationButton>
            ))}
          </nav>
          <div className="rail-bottom">
            <LanguageMenu
              onChange={saveLanguage}
              saving={savingLanguage}
              error={languageError}
            />
            <div className="themes">
              {themes.map((t) => (
                <NavigationButton
                  kind="theme"
                  key={t.id}
                  aria-label={t.name + tr("web.theme")}
                  aria-pressed={theme === t.id}
                  onClick={() => setTheme(t.id)}
                >
                  <t.icon />
                </NavigationButton>
              ))}
            </div>
            <Button
              placement="theme-cycle"
              shape="icon"
              variant="ghost"

              aria-label={tr("web.currentThemeSwitchTo", {
                p0: currentTheme.name,
                p1: nextTheme.name,
              })}
              title={tr("web.currentThemeSwitchTo", {
                p0: currentTheme.name,
                p1: nextTheme.name,
              })}
              onClick={() => setTheme(nextTheme.id)}
            >
              <currentTheme.icon aria-hidden="true" />
            </Button>
            <div className="profile">
              <NavigationButton
                kind="profile"

                aria-label={tr("web.editAvatar")}
                title={tr("web.editAvatar")}
                onClick={() => setModal({ type: "avatar" })}
              >
                <Avatar name={auth.username} source={auth.avatar} />
                <span>
                  {auth.username}
                  <small className="block">{tr("web.personalWorkspace")}</small>
                </span>
              </NavigationButton>
              <Button
                placement="logout"
                shape="icon"
                variant="ghost"

                aria-label={tr("web.signOut")}
                title={tr("web.signOut")}
                onClick={() =>
                  confirm(tr("web.signOutOfThisAccount"), async () => {
                    await api("/auth/logout", {});
                    signedOutRequest.current = ++authRequest.current;
                    setLanguageError("");
                    const serverLocale = localeState?.serverLocale || "en";
                    localeState?.anonymous(serverLocale);
                    setAuth({ ...auth, authenticated: false });
                  })
                }
              >
                <LogOut size={16} />
              </Button>
            </div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div className="crumb">
              <Button
                placement="mobile-menu"
                shape="icon"
                variant="ghost"

                aria-label={tr("web.openNavigation")}
                aria-expanded={drawer}
                aria-controls="global-navigation"
                onClick={() => setDrawer(true)}
              >
                <Menu />
              </Button>
              <span>BugPaw Relay</span>
              <span className="slash">/</span>
              <strong>
                {page === "ui"
                  ? tr("ui.title")
                  : nav.find((n) => n.id === page)?.name}
              </strong>
            </div>
            <div className="top-right">
              <Badge>0.1.0</Badge>
              <span className={online ? "online" : "offline"}>
                {online ? tr("web.connected") : tr("web.offline")}
              </span>
            </div>
          </header>
          <div className="global-error">
            <ErrorBox error={error} />
            <ErrorBox error={refreshError} />
            {error && (
              <Button variant="ghost" onClick={() => setError("")}>
                {tr("web.dismissMessage")}
              </Button>
            )}
          </div>
          <div className="content" data-page={page} key={page}>
            {readyPage !== pageKey ? (
              <div className="menu-loading" role="status">
                <img src="/assets/bugpaw-sleeping.webp" alt="" width={320} height={235} />
                <span>{tr("web.loading")}</span>
              </div>
            ) : <>
            {page === "ui" && <UiShowcase />}
            {page === "workbench" && (
              <WorkbenchPage
                state={state}
                models={state.models}
                selected={selected}
                onError={setError}
              />
            )}
            {page === "chat" && (
              <Sessions
                projects={sessionProjects}
                onCreateAgent={() => edit("agents")}
                onRefresh={refresh}
                onRefreshAfterDelete={refreshAfterDelete}
                state={state}
                selected={selected}
                onDeleted={(ids: Set<string>) => {
                  setState((current: any) => ({
                    ...current,
                    sessions: current.sessions.filter((row: any) => !ids.has(row.id)),
                  }));
                }}
                onPinSaved={(id: string, pinOrder: number | null) => {
                  setState((current: any) => ({
                    ...current,
                    sessions: current.sessions.map((row: any) => row.id === id ? { ...row, pinOrder } : row),
                  }));
                  void refresh();
                }}
                onProjects={() => setModal({ type: "projects" })}
                action={action}
              />
            )}
            {page === "board" && (
              <Boards
                key={selected}
                archived={includeArchived}
                setArchived={(value: boolean) => setArchiveBoard(value ? selected : "")}
                onFlowDirty={setFlowDirty}
                requestFlowLeave={requestFlowLeave}
                onTitleSaved={(updated: any) => {
                  setState((current: any) => ({
                    ...current,
                    boards: current.boards.map((entry: any) =>
                      entry.id === updated.id &&
                      entry.version <= updated.version
                        ? { ...entry, ...updated }
                        : entry,
                    ),
                  }));
                  void refresh();
                }}
                state={state}
                selected={selected}
                edit={edit}
                confirm={confirm}
                action={action}
                openItem={(item: any, targetId = "") =>
                  setModal({ type: "item", item, targetId })
                }
                newItem={(boardId: string) =>
                  setModal({ type: "newItem", boardId })
                }
              />
            )}
            {page === "light-apps" && <LightAppsPage sources={state} />}
            {page === "environments" && (
              <EnvironmentsPage
                state={state}
                selected={selected}
                action={action}
                confirm={confirm}
                onInvite={() => setModal({ type: "invite" })}
                onRefresh={refresh}
                openTools={route.split("/")[2] === "tools"}
              />
            )}
            {page === "agents" && (
              <AgentsPage
                saveOrder={saveAgentOrder}
                state={state}
                edit={edit}
                confirm={confirm}
                onSaved={refresh}
              />
            )}
            {page === "settings" && (
              <Page>
                <PageHead
                  title={tr("web.settings")}
                  description={tr(
                    "web.manageWorkbenchModelsAndAccountSecurityEnvironmentToolCredentials",
                  )}
                />
                <SettingsLayout
                  theme={theme}
                  setTheme={setTheme}
                  security={<Security />}
                >
                  <section>
                    <Row>
                      <h2>{tr("web.workbenchModels")}</h2>
                      <Button variant="primary" onClick={() => edit("models")}>
                        <Plus />
                        {tr("web.addModel")}
                      </Button>
                    </Row>
                    {state.models.map((m: any) => (
                      <SettingsPanel model key={m.id}>
                        <Row>
                          <div>
                            <h3>{m.name}</h3>
                            <small>
                              {m.model} · {m.protocol}
                            </small>
                          </div>
                          <Badge>
                            {m.hasKey
                              ? tr("web.keyConfigured")
                              : tr("web.keyNotConfigured")}
                          </Badge>
                        </Row>
                        <p className="mono wrap">{m.baseUrl}</p>
                        <Row>
                          <Button
                            onClick={() => edit("models", m)}
                            icon={<Pencil aria-hidden="true" />}
                          >
                            {tr("web.edit")}
                          </Button>
                          <Button
                            onClick={() =>
                              confirm(tr("web.deleteModelConfiguration"), () =>
                                api("/models/" + m.id, {}, "DELETE"),
                              )
                            }
                            icon={<Trash2 aria-hidden="true" />}
                          >
                            {tr("web.delete")}
                          </Button>
                        </Row>
                      </SettingsPanel>
                    ))}
                    {!state.models.length && (
                      <p className="note">
                        {tr(
                          "web.noModelsConfiguredAddACompatibleEndpointToStart",
                        )}
                      </p>
                    )}
                  </section>
                </SettingsLayout>
              </Page>
            )}
            </>}
          </div>
        </main>
        {notice && (
          <div className="toast" role="status">
            {displayError(notice)}
          </div>
        )}
        {modal?.type === "avatar" && (
          <Modal
            title={tr("web.editPersonalAvatar")}
            onClose={() => setModal(null)}
          >
            <Avatar name={auth.username} source={auth.avatar} />
            <AvatarUpload
              onSave={async (avatar) => {
                await api("/auth/avatar", { avatar });
                setAuth({ ...auth, avatar });
                setModal(null);
              }}
            />
          </Modal>
        )}
        {modal?.type === "edit" && (
          <Modal
            title={
              (modal.item ? tr("web.edit") : tr("web.new")) +
              (
                {
                  projects: tr("web.projectAlternative229"),
                  agents: tr("web.agent"),
                  boards: tr("web.boards"),
                  models: tr("web.model"),
                } as any
              )[modal.kind]
            }
            onClose={() => setModal(null)}
          >
            <Editor
              kind={modal.kind}
              item={modal.item}
              state={state}
              onSaved={saved}
            />
          </Modal>
        )}
        {modal?.type === "confirm" && (
          <Modal
            title={tr("web.confirmOperation")}
            onClose={() => setModal(null)}
          >
            <p>{modal.title}</p>
            <footer>
              <Button onClick={() => setModal(null)}>{tr("web.cancel")}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const fn = modal.fn;
                  setModal(null);
                  void action(fn);
                }}
              >
                {tr("web.confirm")}
              </Button>
            </footer>
          </Modal>
        )}
        {leaveFlow && (
          <Modal title={tr("web.flowDiscard")} onClose={() => setLeaveFlow(null)}>
            <footer>
              <Button data-initial-focus onClick={() => setLeaveFlow(null)}>
                {tr("web.cancelKeepEditing")}
              </Button>
              <Button variant="danger" onClick={() => {
                setFlowDirty(false);
                setLeaveFlow(null);
                leaveFlow.proceed();
              }}>{tr("web.flowDiscardAction")}</Button>
            </footer>
          </Modal>
        )}
        {modal?.type === "projects" && (
          <ProjectManagement
            projects={sessionProjects}
            onClose={() => setModal(null)}
            onCreate={() => edit("projects")}
            onEdit={(project) => edit("projects", project)}
            onDelete={(id) =>
              confirm(tr("web.deleteProject"), () => api("/projects/" + id, {}, "DELETE"))
            }
            onSaveOrder={saveProjectOrder}
          />
        )}
        {modal?.type === "invite" && (
          <Modal
            title={tr("web.connectDevelopmentEnvironment")}
            onClose={() => setModal(null)}
          >
            <Invite />
          </Modal>
        )}
        {modal?.type === "newItem" && (
          <NewItem
            state={state}
            key={modal.boardId}
            boardId={modal.boardId}
            liveBoard={state.boards.find((b: any) => b.id === modal.boardId)}
            onClose={() => setModal(null)}
            onSaved={(_item, stage) => {
              saved();
              setNotice(feedback("workItemCreation.ui.created", { stage }));
            }}
          />
        )}
        {page === "board" && route.split("/")[2] === "items" && route.split("/")[3] && (
          <LinkedItem key={route} boardId={selected} itemId={route.split("/")[3]} state={state}
            onRefresh={refresh} onClose={() => location.replace("#board/" + selected)} />
        )}
        {modal?.type === "item" && (
          <LinkedItem key={modal.item.id} boardId={modal.item.boardId} itemId={modal.item.id}
            initialItem={modal.item} initialTarget={modal.targetId} state={state}
            onRefresh={refresh} onClose={() => setModal(null)} />
        )}
      </AppShell>
    </IdentityContext.Provider>
  );
}
function PageHead({ title, description, children }: any) {
  useLocale();
  return (
    <PageHeading>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <Row>{children}</Row>
    </PageHeading>
  );
}
function Login({ auth, onLogin }: any) {
  useLocale();
  const [form, setForm] = useState({
    username: "",
    password: "",
    code: "",
    setupToken: "",
  });
  const [initialized, setInitialized] = useState(auth.initialized);
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiFeedback>("");
  return (
    <div className="login">
      <div className="auth-language">
        <LanguageMenu />
      </div>
      <section className="login-art">
        <img src="/assets/bugpaw-og-hero.png" alt={tr("web.bugpawMascot")} />
        <h1>{tr("web.yourFamiliarEnvironmentWhereverYouWork")}</h1>
        <p>
          {tr("web.connectDevelopmentEnvironmentsAndBringCodingAgentsAndTask")}
        </p>
      </section>
      <section className="login-form">
        <div className="login-inner">
          <div className="brand">
            <img src="/assets/bugpaw-avatar.png" alt="" />
            <b>BugPaw Relay</b>
          </div>
          <h2>
            {challenge
              ? tr("web.twoFactorAuthentication")
              : initialized
                ? tr("web.welcomeBack")
                : tr("web.initializeYourWorkspace")}
          </h2>
          <p className="sub">
            {challenge
              ? tr("web.accountAndPasswordVerifiedEnterThe6DigitCode")
              : initialized
                ? tr("web.signInToAccessYourDevelopmentEnvironments")
                : tr("web.useTheOneTimeSetupTokenInTheServer")}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const result = await api(
                  initialized ? "/auth/login" : "/auth/setup",
                  challenge ? { challenge, code: form.code } : form,
                );
                if (result.requiresTotp) {
                  setChallenge(result.challenge);
                  // 进入第二步后不再保留密码，验证码重试只使用短期挑战。
                  setForm({ ...form, password: "", code: "" });
                  return;
                }
                if (!initialized) {
                  setInitialized(true);
                  setForm({ ...form, setupToken: "" });
                } else await onLogin();
              } catch (e) {
                setError(caughtFeedback(e as Error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {!initialized && (
              <Field label={tr("web.setupToken")}>
                <Input
                  required
                  type="password"
                  value={form.setupToken}
                  onChange={(e) =>
                    setForm({ ...form, setupToken: e.target.value })
                  }
                />
              </Field>
            )}
            {!challenge && (
              <>
                <Field label={tr("web.account")}>
                  <Input
                    required
                    autoComplete="username"
                    value={form.username}
                    onChange={(e) =>
                      setForm({ ...form, username: e.target.value })
                    }
                  />
                </Field>
                <Field
                  label={
                    initialized
                      ? tr("web.password")
                      : tr("web.passwordAtLeast12Characters")
                  }
                >
                  <Input
                    required
                    type="password"
                    minLength={initialized ? 1 : 12}
                    autoComplete={
                      initialized ? "current-password" : "new-password"
                    }
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                  />
                </Field>
              </>
            )}
            {challenge && (
              <Field label={tr("web.twoFactorCode")}>
                <Input
                  inputMode="numeric"
                  autoFocus
                  required
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </Field>
            )}
            <ErrorBox error={error} />
            <Button type="submit" variant="primary" disabled={busy}>
              {busy
                ? tr("web.processingAlternative255")
                : challenge
                  ? tr("web.verifyAndSignIn")
                  : initialized
                    ? tr("web.signIn")
                    : tr("web.createAdministrator")}
            </Button>
            {challenge && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setChallenge("");
                  setForm({ ...form, password: "", code: "" });
                  setError("");
                }}
              >
                {tr("web.backToPasswordSignIn")}
              </Button>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
function Invite() {
  useLocale();
  const [release, setRelease] = useState<{
    releases: { platform: string; file: string }[];
  } | null>(null);
  const [loadingRelease, setLoadingRelease] = useState(true);
  // 每次打开向导读取当前清单，避免前端版本常量与实际发行包脱节。
  useEffect(() => {
    let active = true;
    void api("/connector-release")
      .then((data) => {
        if (active) setRelease(data.release);
      })
      .catch((e) => {
        if (active) setError(caughtFeedback(e));
      })
      .finally(() => {
        if (active) setLoadingRelease(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const downloadLink = (platform: string, label: string) => {
    const item = release?.releases.find((item) => item.platform === platform);
    return item ? (
      <ReleaseDownload file={item.file}>{label}</ReleaseDownload>
    ) : (
      <p className="sub">
        {loadingRelease
          ? tr("web.loadingDownloadInformation")
          : tr("web.noReleasePackageIsAvailableForThisPlatformTry")}
      </p>
    );
  };
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState<UiFeedback>("");
  return (
    <>
      <p>{tr("web.downloadTheCompletePackageForYourPlatformAndExtract")}</p>
      <div className="config-block">
        <h3>Windows 11 x64</h3>
        {downloadLink("windows", tr("web.downloadWindowsPackageZip"))}
        <p>{tr("web.extractAllFilesAndDoubleClickBugpawRelayExe")}</p>
        <h3>Linux x64</h3>
        {downloadLink("linux", tr("web.downloadLinuxPackageTarGz"))}
        <p>{tr("web.extractAndRunBugpawRelayWithoutADesktopUse")}</p>
        <a href="/downloads/release.json" target="_blank" rel="noreferrer">
          {tr("web.viewVersionFileSizeAndSha256")}
        </a>
      </div>
      <p className="sub">{tr("web.webModeIsTheDefaultCliRunsInThe")}</p>
      <Button
        variant="primary"
        onClick={() =>
          void api("/invitations", {})
            .then(setInvite)
            .catch((e) => setError(caughtFeedback(e)))
        }
      >
        {tr("web.generateOneTimeCodeValidFor10Minutes")}
      </Button>
      {invite && (
        <div className="config-block">
          <code className="wrap">{invite.code}</code>
          <p>
            {tr("web.server")}
            {invite.serverUrl}
          </p>
        </div>
      )}
      <ErrorBox error={error} />
    </>
  );
}
function Security() {
  useLocale();
  const [currentPassword, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState<any>(null);
  // 二要素操作的密码与修改密码表单完全隔离，关闭弹窗即清空。
  const [passwordAction, setPasswordAction] = useState<
    "setup" | "disable" | null
  >(null);
  const [securityPassword, setSecurityPassword] = useState("");
  const [securityError, setSecurityError] = useState<UiFeedback>("");
  const [securityBusy, setSecurityBusy] = useState(false);
  useEffect(() => {
    // 原生 dialog 打开时会重置焦点，待公共弹窗挂载后再聚焦密码字段。
    if (passwordAction)
      document
        .querySelector<HTMLInputElement>("dialog[open] input[type=password]")
        ?.focus();
  }, [passwordAction]);
  const closePassword = () => {
    setPasswordAction(null);
    setSecurityPassword("");
    setSecurityError("");
  };
  const openPassword = (action: "setup" | "disable") => {
    setSecurityPassword("");
    setSecurityError("");
    setPasswordAction(action);
  };
  const [message, setMessage] = useState<UiFeedback>("");
  const run = async (fn: () => Promise<any>) => {
    try {
      await fn();
      setMessage(feedback("web.settingsUpdated"));
    } catch (e) {
      setMessage(caughtFeedback(e as Error));
    }
  };
  return (
    <SettingsPanel>
      <h2>{tr("web.accountAndSecurity")}</h2>
      <Field label={tr("web.currentPassword")}>
        <Input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>
      <Field label={tr("web.newPasswordAtLeast12Characters")}>
        <Input
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button
        onClick={() =>
          run(async () => {
            await api("/auth/password", { currentPassword, password });
            location.reload();
          })
        }
      >
        {tr("web.changePasswordAndSignOutAllSessions")}
      </Button>
      <hr />
      <h3>{tr("web.twoFactorAuthentication")}</h3>
      <p className="note">
        {tr("web.useATotpAuthenticatorKeepTheSecretSafeBefore")}
      </p>
      <Button onClick={() => openPassword("setup")}>
        {tr("web.generateTwoFactorSecret")}
      </Button>
      {totp && (
        <div className="config-block">
          <p>
            {tr("web.addToAuthenticator")}
            <code className="wrap">{totp.secret}</code>
          </p>
          <p>{tr("web.scanTheQrCodeOrEnterTheSecretAbove")}</p>
          <ResponsiveImage
            src={totp.qr}
            alt={tr("web.authenticatorSetupQrCode")}
            width={240}
            height={240}
          />
        </div>
      )}
      <Field label={tr("web.verificationCode")}>
        <Input
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <Row>
        <Button
          disabled={!totp}
          onClick={() =>
            run(async () => {
              await api("/auth/totp/enable", { code });
              setTotp(null);
              setCode("");
            })
          }
        >
          {tr("web.confirmAndEnable")}
        </Button>
        <Button onClick={() => openPassword("disable")}>
          {tr("web.disableTwoFactorAuthentication")}
        </Button>
      </Row>
      {passwordAction && (
        <Modal
          title={
            passwordAction === "setup"
              ? tr("web.verifyPasswordAndGenerateSecret")
              : tr("web.verifyPasswordAndDisableTwoFactorAuthentication")
          }
          onClose={() => {
            if (!securityBusy) closePassword();
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSecurityBusy(true);
              setSecurityError("");
              try {
                if (passwordAction === "setup") {
                  const result = await api("/auth/totp/setup", {
                    password: securityPassword,
                  });
                  // 在浏览器本地生成二维码，密钥不发送至第三方服务。
                  const qr = await QRCode.toDataURL(result.uri, {
                    width: 240,
                    margin: 4,
                  });
                  setTotp({ ...result, qr });
                  setCode("");
                  setMessage(
                    feedback(
                      "web.secretGeneratedScanTheCodeThenEnterAVerification",
                    ),
                  );
                } else {
                  await api("/auth/totp/disable", {
                    password: securityPassword,
                    code,
                  });
                  setTotp(null);
                  setCode("");
                  setMessage(feedback("web.twoFactorAuthenticationDisabled"));
                }
                closePassword();
              } catch (e) {
                setSecurityError(caughtFeedback(e as Error));
              } finally {
                setSecurityBusy(false);
              }
            }}
          >
            <p>{tr("web.enterYourAccountPasswordToConfirmThisOperation")}</p>
            <Field label={tr("web.loginPassword")}>
              <Input
                autoFocus
                required
                type="password"
                autoComplete="current-password"
                value={securityPassword}
                disabled={securityBusy}
                onChange={(e) => setSecurityPassword(e.target.value)}
              />
            </Field>
            <ErrorBox error={securityError} />
            <Row>
              <Button type="submit" variant="primary" disabled={securityBusy}>
                {securityBusy
                  ? tr("web.processingAlternative255")
                  : passwordAction === "setup"
                    ? tr("web.verifyAndGenerateSecret")
                    : tr("web.confirmAndDisable")}
              </Button>
              <Button
                type="button"
                disabled={securityBusy}
                onClick={closePassword}
              >
                {tr("web.cancel")}
              </Button>
            </Row>
          </form>
        </Modal>
      )}
      <p role="status" className="note">
        {displayError(message)}
      </p>
    </SettingsPanel>
  );
}
/** 卡片和详情共用服务端提醒原因，不从执行标签猜测待处理状态。 */
function ItemAttention({ item }: { item: any }) {
  useLocale();
  const labels: Record<string, string> = {
    human_waiting: tr("web.awaitingManualAdvancement"),
    interaction_required: tr("web.awaitingReplyOrApproval"),
    execution_failed: tr("web.executionFailed"),
    cli_disabled: tr("web.cliQueuedBlocked"),
    ended_without_handoff: tr("web.executionEndedWithoutAdvancement"),
  };
  return (
    <>
      {item.waitingReason === "connector_upgrade_required" && (
        <p className="note" role="status">
          {stageText("upgrade")}
        </p>
      )}
      {item.needsAttention && (
        <p className="attention">
          {tr("web.pendingAlternative294")}
          {(item.attentionReasons || [])
            .map((reason: string) => labels[reason] || reason)
            .join("、")}
        </p>
      )}
      {item.syncStatus === "pending" && (
        <p className="note">{tr("web.syncPendingShowingLastKnownState")}</p>
      )}
    </>
  );
}
function Boards({
  archived,
  setArchived,
  onTitleSaved,
  onFlowDirty,
  requestFlowLeave,
  state,
  selected,
  edit,
  confirm,
  action,
  openItem,
  newItem,
}: any) {
  useLocale();
  const board =
    state.boards.find((b: any) => b.id === selected);
  const [search, setSearch] = useState("");

  const [view, setView] = useState("items");
  const [flowNotice, setFlowNotice] = useState<UiFeedback>("");
  // 每个看板保留结果未知的复制操作，成功后才允许下一次复制。
  const copyOperations = useRef(new Map<string, string>());
  const copying = useRef(false);
  const [titleEdit, setTitleEdit] = useState<any>(null);
  // 所有有效跨泳道拖放先填写交接；人工来源可在统一表单中留空提交。
  const { root, drag, start, suppress } = useBoardDrag((item, target) => {
    openItem(item, target);
  });
  // 按实际顶部占用计算泳道上限；短屏保留可操作区域，由页面承接剩余滚动。
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const update = () => {
      const viewport = window.visualViewport;
      const bottom = viewport
        ? viewport.offsetTop + viewport.height
        : innerHeight;
      element.style.setProperty(
        "--lane-max-height",
        `${Math.max(220, bottom - Math.max(0, element.getBoundingClientRect().top) - 28)}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
    };
  });
  if (!selected && state.boards.length)
    return (
      <Page>
        <PageHead
          title={tr("web.boards")}
          description={tr("web.eachBoardManagesItsOwnFlowAndWorkItems")}
        >
          <Button variant="primary" onClick={() => edit("boards")}>
            <Plus />
            {tr("web.newBoard")}
          </Button>
        </PageHead>
        <div className="board-catalog">
          {state.boards.map((b: any) => {
            // 服务端汇总包含人工等待，排除归档与完成项，并按工作项去重。
            const attention = b.pendingCount;
            return (
              <SurfaceButton
                kind="board"

                key={b.id}
                onClick={() => {
                  location.hash = "board/" + b.id;
                  setView("items");
                }}
              >
                <Columns3 />
                <h2>{b.name}</h2>
                <p>
                  {state.projects.find((p: any) => p.id === b.projectId)?.name}{" "}
                  · {b.stageCount} {tr("web.stagesAlternative298")}
                </p>
                <Row>
                  <small>
                    {b.itemCount} {tr("web.workItemsAlternative299")}
                  </small>
                  <Badge>
                    {attention > 0
                      ? attention + tr("web.pendingAlternative300")
                      : tr("web.nothingPending")}
                  </Badge>
                  {b.syncStatus === "pending" && (
                    <Badge>{tr("web.syncPending")}</Badge>
                  )}
                  <ArrowUpRight />
                </Row>
              </SurfaceButton>
            );
          })}
        </div>
      </Page>
    );
  return (
    <Page>
      {!board && (
        <PageHead
          title={tr("web.boards")}
          description={tr(
            "web.moveRequirementsToCompletionWithClearStagesAndHandoff",
          )}
        >
          <Button onClick={() => edit("boards")}>
            <Plus />
            {tr("web.newBoard")}
          </Button>
        </PageHead>
      )}
      {titleEdit && (
        <BoardTitleEditor
          board={titleEdit}
          onClose={() => setTitleEdit(null)}
          onSaved={(updated) => {
            onTitleSaved(updated);
            setTitleEdit(null);
            setFlowNotice(feedback("web.boardTitleUpdated"));
          }}
        />
      )}
      {!board ? (
        <Empty title={tr(selected ? "web.thisBoardNoLongerExistsOrIsInaccessible" : "web.createYourFirstBoard")}>
          {tr("web.registerAProjectOnTheSessionsPageThenConfigure")}
        </Empty>
      ) : (
        <>
          {/* 详情共用紧凑标题区，返回入口始终指向列表而非浏览器历史。 */}
          <BoardHeader>
            <div className="board-title-row">
              <Button
                shape="icon"

                aria-label={tr("web.backToAllBoards")}
                title={tr("web.backToAllBoards")}
                onClick={() => (location.hash = "board")}
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
              <h2 className="board-title" title={board.name}>
                {board.name}
              </h2>
              <Button
                shape="icon"

                aria-label={tr("web.editBoardTitle")}
                title={tr("web.editBoardTitle")}
                onClick={() => {
                  setFlowNotice("");
                  setTitleEdit(board);
                }}
              >
                <Pencil aria-hidden="true" />
              </Button>
            </div>

            <div className="board-header-actions">
              <IconSelect
                label={tr("web.boards")}
                value={board.id}
                options={options(state.boards)}
                onChange={(v) => (location.hash = "board/" + v)}
                icon={<Columns3 aria-hidden="true" />}
              />
              <Button
                variant="primary"
                icon={<Plus aria-hidden="true" />}
                onClick={() => newItem(board.id)}
              >
                {tr("web.newWorkItem")}
              </Button>
            </div>
          </BoardHeader>

          <Row aria-live="polite">
            {board.pendingCount > 0 && (
              <span className="attention">
                {board.pendingCount} {tr("web.pendingAlternative308")}
              </span>
            )}
            {board.syncStatus === "pending" && (
              <Badge>{tr("web.syncPending")}</Badge>
            )}
          </Row>
          <div className="board-detail-head">
            <Tabs>
              <NavigationButton
                selected={view === "items"}
                kind="tab"

                onClick={() => requestFlowLeave(() => setView("items"))}
              >
                {tr("web.workItemsAlternative309")}
              </NavigationButton>
              <NavigationButton
                selected={view === "flow"}
                kind="tab"

                onClick={() => setView("flow")}
              >
                {tr("web.flowConfiguration")}
              </NavigationButton>
            </Tabs>
            <span className="sub">
              {state.projects.find((p: any) => p.id === board.projectId)?.name}
            </span>
          </div>
          {flowNotice && (
            <p role="status" className="note">
              {displayError(flowNotice)}
            </p>
          )}
          {view === "flow" ? (
            <SettingsPanel>
              <h2>{tr("web.stagesAndTransitions")}</h2>
              <Editor
                key={board.id}
                kind="boards"
                onCreateAgent={() => edit("agents")}
                item={board}
                state={state}
                onDirtyChange={onFlowDirty}
                onFlowSaved={onTitleSaved}
                onSaved={() => {
                  setView("items");
                  setFlowNotice(feedback("web.flowUpdated"));
                  void action(async () => {});
                }}
              />
            </SettingsPanel>
          ) : (
            <>
              <BoardToolbar>
                <SearchInput
                  label={tr("web.searchWorkItemsAndTags")}
                  value={search}
                  onChange={setSearch}
                />
                <Check checked={archived} onChange={setArchived}>
                  {tr("web.showArchived")}
                </Check>
                <ActionMenu
                  label={tr("ui.more")}
                  icon={<MoreHorizontal aria-hidden="true" />}
                  items={[
                    {
                      label: tr("web.copyConfiguration"),
                      onSelect: () =>
                        action(async () => {
                          if (copying.current) return;
                          copying.current = true;
                          const id =
                            copyOperations.current.get(board.id) ||
                            crypto.randomUUID();
                          copyOperations.current.set(board.id, id);
                          try {
                            await api("/boards/" + board.id + "/copy", {
                              operationId: id,
                            });
                            copyOperations.current.delete(board.id);
                          } catch (e: any) {
                            if (e.status && e.status < 500)
                              copyOperations.current.delete(board.id);
                            throw e;
                          } finally {
                            copying.current = false;
                          }
                        }),
                    },
                    {
                      label: tr("web.deleteBoard"),
                      danger: true,
                      onSelect: () =>
                        confirm(
                          tr(
                            "web.deleteThisBoardOnlyUnfinishedUnarchivedWorkItemsPrevent",
                          ),
                          async () => {
                            await api("/boards/" + board.id, {}, "DELETE");
                            location.hash = "board";
                          },
                        ),
                    },
                  ]}
                />
              </BoardToolbar>
              <p className="sub board-drag-hint">{dragText("hint")}</p>
              {drag && (
                <DragPreview x={drag.x} y={drag.y}>
                  {dragText("moving")}: {drag.item.title}
                </DragPreview>
              )}
              <BoardLayout columns={board.stages.length} ref={root}>
                {[
                  ...board.stages,
                  ...(state.items.some(
                    (i: any) =>
                      i.boardId === board.id &&
                      !board.stages.some((s: any) => s.id === i.stageId) &&
                      (archived || !i.archived),
                  )
                    ? [
                        {
                          id: "deleted-stage",
                          name: tr("web.originalStageDeleted"),
                          type: "deleted",
                        },
                      ]
                    : []),
                ].map((stage: any) => {
                  const items = state.items.filter(
                    (i: any) =>
                      i.boardId === board.id &&
                      (stage.type === "deleted"
                        ? !board.stages.some((s: any) => s.id === i.stageId)
                        : i.stageId === stage.id) &&
                      (archived || !i.archived) &&
                      (i.title + " " + i.tags.join(" ")).includes(search),
                  );
                  return (
                    <section
                      className={
                        "column" +
                        (drag?.target === stage.id ? " drop-target" : "")
                      }
                      data-drop-stage={stage.id}
                      key={stage.id}
                    >
                      {drag?.target === stage.id && (
                        <p className="drop-hint" role="status">
                          {dragText("drop")}
                        </p>
                      )}
                      <div className="column-title">
                        <StageLabel stage={stage} />
                        <span>{items.length}</span>
                      </div>
                      <small>
                        {stage.type === "agent"
                          ? tr("web.concurrency", {
                              p0: stage.runtime,
                              p1:
                                permissionLabel(stage.permission),
                              p2: stage.concurrency,
                            })
                          : stage.type === "done"
                            ? tr("web.fixedEndpoint")
                            : stage.type === "deleted"
                              ? tr("web.historyOnlyCannotRestoreDirectly")
                              : tr("web.advanceManually")}
                      </small>
                      <div
                        className="column-items"
                        tabIndex={0}
                        role="region"
                        aria-label={stageName(stage, currentLocale())}
                      >
                        {!items.length && (
                          <p className="column-empty">
                            {search
                              ? tr("web.noMatchingWorkItems")
                              : tr("web.noWorkItemsYet")}
                          </p>
                        )}
                        {items.map((i: any) => (
                          <SurfaceButton
                            dragging={drag?.item.id === i.id}
                            kind="task"

                            key={i.id}
                            title={
                              canDrag(i, board, state)
                                ? dragText("hint")
                                : dragText("blocked")
                            }
                            onMouseDown={(e) => {
                              if (e.button === 0 && canDrag(i, board, state))
                                start(
                                  i,
                                  stage.targets,
                                  e.clientX,
                                  e.clientY,
                                  false,
                                );
                            }}
                            onTouchStart={(e) => {
                              if (
                                e.touches.length === 1 &&
                                canDrag(i, board, state)
                              )
                                start(
                                  i,
                                  stage.targets,
                                  e.touches[0].clientX,
                                  e.touches[0].clientY,
                                  true,
                                );
                            }}
                            onContextMenu={(e) => {
                              if (drag) e.preventDefault();
                            }}
                            onClick={() => {
                              if (Date.now() > suppress.current) openItem(i);
                            }}
                          >
                            <Row>
                              <Status value={i.status} />
                              {i.archived && <Badge>{tr("web.archive")}</Badge>}
                            </Row>
                            <h3>{i.title}</h3>
                            <div className="task-footer">
                              <span>
                                {i.priority === "high"
                                  ? tr("web.highPriority")
                                  : i.priority === "low"
                                    ? tr("web.lowPriority")
                                    : tr("web.normalPriority")}
                              </span>
                              <span>{i.tags.join(" · ")}</span>
                            </div>
                            <ItemAttention item={i} />
                          </SurfaceButton>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </BoardLayout>
            </>
          )}
        </>
      )}
    </Page>
  );
}
/** 深链独立读取归档及筛选外的工作项，切换路由时旧响应随组件失效。 */
function LinkedItem({ boardId, itemId, initialItem, initialTarget, state, onRefresh, onClose }: any) {
  const [detail, setDetail] = useState<any>();
  const [error, setError] = useState<UiFeedback>("");
  const [revision, setRevision] = useState(0);
  const card = state.items.find((row: any) => row.id === itemId);
  useEffect(() => {
    let active = true;
    setError("");
    api("/boards/" + encodeURIComponent(boardId) + "/items/" + encodeURIComponent(itemId))
      .then(value => { if (active) setDetail(value); })
      .catch(err => { if (active) setError(caughtFeedback(err)); });
    return () => { active = false; };
  }, [boardId, itemId, revision, card?.version]);
  const board = state.boards.find((row: any) => row.id === boardId);
  return <Modal title={tr(initialTarget ? "web.handoffAndAdvance" : "web.workItemDetails")} onClose={onClose}>
    {error ? <><ErrorBox error={error} /><Button onClick={() => setRevision(v => v + 1)}>{tr("web.retry")}</Button></>
      : !detail ? <p role="status">{tr("web.loading")}</p>
      : !board?.stages ? <p role="alert">{tr("web.boardCard.unavailable")}</p>
      : <ItemDetail key={detail.item.id + ":" + revision} initialTarget={initialTarget}
          state={{...state, handoffs: detail.handoffs}} initialItem={revision ? detail.item : initialItem || detail.item}
          item={card?.version === detail.item.version ? { ...detail.item, ...card } : detail.item}
          onEdited={(updated: any) => { setDetail({ ...detail, item: updated }); setRevision(v => v + 1); void onRefresh(); }}
          onSaved={() => { onClose(); void onRefresh(); }} />}
  </Modal>;
}
/** 按概览、执行操作、交接表单和倒序历史组织工作项详情。 */
function ItemDetail({ item, initialItem, initialTarget, state, onSaved, onEdited }: any) {
  useLocale();
  const [editor, setEditor] = useState<EditView | null>(null);
  const [readingEdit, setReadingEdit] = useState(false);
  const [artifactId, setArtifactId] = useState("");
  const [targetId, setTarget] = useState(initialTarget || "");
  // 表单打开时冻结来源，轮询不能把草稿自动应用到另一阶段。
  const [intent] = useState(() => ({ ...(initialItem || item) }));
  const [advancing, setAdvancing] = useState(false);
  const advanceLock = useRef(false);
  const [record, setRecord] = useState("");
  const [error, setError] = useState<UiFeedback>("");
  const board = state.boards.find((b: any) => b.id === item.boardId);
  const stage = board.stages.find((s: any) => s.id === item.stageId);
  const attachments = useBoardAttachments(state, board, board.stages.find((s: any) => s.id === targetId), item.id);
  const stageDeleted = item.stageDeleted || !stage;
  const session = state.sessions.find(
    (s: any) => s.executionId === item.executionId,
  );
  const run = async (fn: () => Promise<any>) => {
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(caughtFeedback(e as Error));
    }
  };
  const handoff = !item.archived && !stageDeleted && stage?.targets.length > 0 && (
    <section
      className="item-section item-handoff"
      aria-label={tr("web.handoffAndAdvance")}
    >
      {!initialTarget && <>
        <h3>{tr("web.handoffAndAdvance")}</h3>
        <p className="sub">{dragText("instruction")}</p>
      </>}
      <Field label={tr("web.targetStage")}>
        <Select
          label={tr("web.targetStage")}
          disabled={advancing}
          value={targetId}
          options={options(
            board.stages
              .filter((s: any) => stage.targets.includes(s.id))
              .map((s: any) => ({ ...s, name: stageLabel(s) })),
          )}
          onChange={setTarget}
        />
      </Field>
      <Field
        label={dragText(stage?.type === "human" ? "optional" : "required")}
      >
        <Textarea
          rows={5}
          value={record}
          readOnly={advancing}
          onChange={(e) => setRecord(e.target.value)}
        />
      </Field>
      {attachments.fields(advancing)}
      <Button
        variant="primary"
        disabled={
          advancing || !!attachments.issue ||
          !canDrag(item, board, state) ||
          !targetId ||
          (stage?.type !== "human" && !record.trim())
        }
        onClick={async () => {
          if (advanceLock.current) return;
          advanceLock.current = true;
          setAdvancing(true);
          setError("");
          try {
            await advanceItem(intent, targetId, record, attachments.prepare, attachments.draftId);
            onSaved();
          } catch (e) {
            setError(caughtFeedback(e));
          } finally {
            advanceLock.current = false;
            setAdvancing(false);
          }
        }}
      >
        {dragText(advancing ? "pending" : "submit")}
      </Button>
    </section>
  );
  // 拖放只呈现交接表单；轮询导致工作项不可推进时保留原因提示。
  if (initialTarget) return (
    <article className="item-detail">
      {!canDrag(item, board, state) && <p role="status">{dragText("blocked")}</p>}
      {handoff}
      <ErrorBox error={error} />
    </article>
  );
  return (
    <article className="item-detail">
      {artifactId && (
        <EnvironmentFile
          key={artifactId}
          artifactId={artifactId}
          sessionId=""
          href=""
          environmentName={tr("web.serverHandoffArtifacts")}
          onClose={() => setArtifactId("")}
        />
      )}
      {editor && <EditItem view={editor} state={state} board={board}
        onClose={() => setEditor(null)} onSaved={onEdited} />}
      <header className="item-overview">
        <p className="item-eyebrow">
          {board.name} {tr("web.workItemDetailsAlternative339")}
        </p>
        <h2>{item.title}</h2>
        {!item.archived && !stageDeleted && stage.type === "human" && (
          <Button disabled={readingEdit || advancing} onClick={async () => {
            setReadingEdit(true);
            setError("");
            try {
              const view = await api("/items/" + item.id + "/edit");
              if (view.item.archived || view.item.stageDeleted || view.item.stageId !== item.stageId)
                setError(feedback("board.edit.conflict"));
              else setEditor(view);
            } catch (e) { setError(caughtFeedback(e)); }
            finally { setReadingEdit(false); }
          }}>{tr(readingEdit ? "web.loading" : "web.edit")}</Button>
        )}
        <Row>
          <Status value={item.status} />
          <Badge>
            <StageLabel stage={stage} />
          </Badge>
          <Badge>
            {item.priority === "high"
              ? tr("web.highPriority")
              : item.priority === "low"
                ? tr("web.lowPriority")
                : tr("web.normalPriority")}
          </Badge>
          {item.archived && <Badge>{tr("web.archived")}</Badge>}
        </Row>
        <ItemAttention item={item} />
        {!canDrag(item, board, state) && (
          <p className="note">{dragText("blocked")}</p>
        )}
        {item.tags?.length > 0 && (
          <div className="item-tags">
            {item.tags.map((tag: string) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        )}
      </header>
      <section className="item-section" aria-label={tr("web.requirements")}>
        <h3>{tr("web.requirements")}</h3>
        <pre className="prose">
          {item.content || tr("web.noAdditionalDescription")}
        </pre>
      </section>
      <section
        className="item-section"
        aria-label={tr("web.currentStageActions")}
      >
        <h3>{tr("web.currentStage")}</h3>
        {stageDeleted && (
          <p role="status" className="note">
            {tr("web.theOriginalStageWasDeletedContentIsKeptFor")}
          </p>
        )}
        {item.executionId && !session && (
          <p className="note">
            {tr("web.theLinkedSessionWasDeletedExecutionAndHandoffRecords")}
          </p>
        )}
        <div className="item-actions">
          {session && (
            <LinkButton href={"#chat/" + session.id} onClick={onSaved}>
              {tr("web.viewCurrentExecutionSession")}
              <ArrowUpRight />
            </LinkButton>
          )}
          {item.executionId && (
            <Button
              onClick={() =>
                run(() => api("/executions/" + item.executionId + "/stop", {}))
              }
            >
              {tr("web.stopCancelPendingDispatch")}
            </Button>
          )}
          {["failed", "cancelled", "completed"].includes(item.status) &&
            stage?.type === "agent" &&
            !stageDeleted &&
            !item.archived && (
              <Button
                onClick={() =>
                  run(() => api("/items/" + item.id + "/retry", {}))
                }
              >
                {tr("web.retryCurrentStage")}
              </Button>
            )}
          <Button
            disabled={item.archived && stageDeleted}
            onClick={() =>
              run(() =>
                api("/items/" + item.id + "/archive", {
                  archived: !item.archived,
                }),
              )
            }
          >
            {item.archived ? tr("web.restore") : tr("web.archive")}
          </Button>
        </div>
      </section>
      {!item.archived &&
        !stageDeleted &&
        stage?.type !== "done" &&
        stage?.targets.length === 0 && (
          <p role="status" className="note">
            {tr("handoff.emptyTargets")}
          </p>
        )}
      {handoff}
      <LightPublications key={item.id} scope="itemId" id={item.id} sources={state} />
      <section className="item-section" aria-label={tr("web.handoffHistory")}>
        <div className="item-section-heading">
          <h3>{tr("web.handoffHistory")}</h3>
          <span className="sub">{tr("web.newestFirst")}</span>
        </div>
        {item.historyIncomplete && (
          <p role="status" className="note">
            {tr("web.someHandoffRecordsWereLostWhenFlowStagesWere")}
          </p>
        )}
        {!state.handoffs.some((h: any) => h.itemId === item.id) && (
          <p className="note">{tr("web.noHandoffRecordsYet")}</p>
        )}
        <div className="handoff-history">
          {state.handoffs
            .filter((h: any) => h.itemId === item.id)
            .sort(
              (a: any, b: any) =>
                Date.parse(b.createdAt) - Date.parse(a.createdAt),
            )
            .map((h: any) => (
              <div className="handoff-entry" key={h.id}>
                <div className="handoff-meta">
                  <strong>
                    {h.kind === "edited" ? tr("board.edit.title") : h.kind === "created" ? tr("web.createWorkItem") : stageLabel(
                      h.fromStage ||
                        board.stages.find((s: any) => s.id === h.from),
                    )}{" "}
                    {["created", "edited"].includes(h.kind) ? " · " : " → "}
                    {stageLabel(
                      h.toStage || board.stages.find((s: any) => s.id === h.to),
                    )}
                  </strong>
                  <time dateTime={h.createdAt}>
                    {new Date(h.createdAt).toLocaleString(currentLocale())}
                  </time>
                </div>
                <pre className="prose">{h.record || dragText("empty")}</pre>
                {h.attachments?.length > 0 && <ul className="handoff-artifacts" aria-label={tr("ui.attachments")}>
                  {h.attachments.map((a: any) => <li key={a.path}>
                    <div><strong>{a.name}</strong><small>{a.environmentName} · {a.cwd}</small><code>{a.path}</code></div>
                    <Button onClick={async () => {
                      try { await navigator.clipboard.writeText(a.path); }
                      catch { setError(feedback("board.upload.copyFailed")); }
                    }}>{tr("board.upload.copy")}</Button>
                  </li>)}
                </ul>}
                {h.artifacts?.length > 0 && (
                  <ul
                    className="handoff-artifacts"
                    aria-label={tr("web.handoffArtifact")}
                  >
                    {h.artifacts.map((a: any) => (
                      <li key={a.id}>
                        <div>
                          <strong>{a.name}</strong>
                          <small>
                            {formatBytes(a.size)} · {a.mime}
                          </small>
                        </div>
                        <Button
                          onClick={() => setArtifactId(a.id)}
                          aria-label={tr("web.viewArtifact", { p0: a.name })}
                        >
                          {tr("web.previewDownload")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {h.executionId &&
                  state.sessions.find(
                    (s: any) => s.executionId === h.executionId,
                  ) && (
                    <a
                      href={
                        "#chat/" +
                        state.sessions.find(
                          (s: any) => s.executionId === h.executionId,
                        ).id
                      }
                      onClick={onSaved}
                    >
                      {tr("web.viewStageSession")}
                    </a>
                  )}
                {h.executionId &&
                  !state.sessions.some(
                    (s: any) => s.executionId === h.executionId,
                  ) && <small>{tr("web.stageSessionDeleted")}</small>}
              </div>
            ))}
        </div>
      </section>
      <ErrorBox error={error} />
    </article>
  );
}
function WorkbenchPage({ state, models, selected, onError }: any) {
  useLocale();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [sessionAction, setSessionAction] = useState<any>(null);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  useEffect(() => {
    setSelection([]);
  }, [search, archived]);
  const [actionError, setActionError] = useState<UiFeedback>("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [snapshot, setCurrent] = useState<any>(null);
  const current = snapshot?.id === selected ? snapshot : null;
  const sending = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [revision, setRevision] = useState(0);
  useWorkbenchViewport();
  const [draft, setDraft] = useState("");
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current !== null) {
      composerInput.current?.setSelectionRange(
        pendingCaret.current,
        pendingCaret.current,
      );
      pendingCaret.current = null;
    }
  }, [draft]);
  const [modelId, setModel] = useState("");
  const [permission, setPermission] = useState("ask");
  const [list, setList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await api(
          "/workbench" + (archived ? "?archived=true" : ""),
        );
        if (!cancelled) setSessions(rows);
      } catch (e) {
        if (!cancelled) onError(caughtFeedback(e as Error));
      }
    };
    const stop = pollVisible(load, 4000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [selected, revision, archived]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    let delay = 1200;
    // 串行读取当前会话，避免慢网络请求重叠及旧快照覆盖新状态。
    const load = async () => {
      delay = 1200;
      try {
        const value = await api("/workbench/" + selected);
        if (!cancelled) {
          setCurrent((old: any) =>
            old?.id === value.id && old.version > value.version ? old : value,
          );
          if (["running", "resuming"].includes(value.status)) delay = 750;
        }
      } catch (e) {
        if (!cancelled) onError(caughtFeedback(e as Error));
      }
    };
    const stop = pollVisible(load, () => delay);
    return () => {
      cancelled = true;
      stop();
    };
  }, [selected, revision]);
  useEffect(() => {
    setDraft("");
    setImages([]);
  }, [selected]);
  const running =
    !!current && ["running", "approval", "resuming"].includes(current.status);
  const canSend =
    !busy &&
    !running &&
    !current?.archivedAt &&
    !!models.length &&
    !!draft.trim() &&
    (!selected || !!current);
  const send = async () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      let id = selected;
      if (!id) {
        const created = await api("/workbench", {
          title: draft.slice(0, 40),
          modelId: modelId || models[0]?.id,
          permission,
        });
        id = created.id;
        location.hash = "workbench/" + id;
      }
      await api("/workbench/" + id + "/send", {
        message: draft,
        operationId: crypto.randomUUID(),
        images,
      });
      if (selectedRef.current === id || (!selected && !selectedRef.current)) {
        setDraft("");
        setImages([]);
        // 立即标记运行中，防止发送成功到下一次快照之间重复提交。
        setCurrent((old: any) =>
          old?.id === id ? { ...old, status: "running" } : old,
        );
      }
      setRevision((value) => value + 1);
    } catch (e) {
      onError(caughtFeedback(e as Error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const act = async (path: string, data: any = {}) => {
    try {
      await api("/workbench/" + selected + path, data);
      const w = await api("/workbench/" + selected);
      if (selectedRef.current === selected) {
        setCurrent(w);
        setRevision((value) => value + 1);
      }
    } catch (e) {
      onError(caughtFeedback(e as Error));
    }
  };
  /** 管理动作完成后同步列表和路由，避免轮询继续读取已删除的会话。 */
  const manageSession = async (action: string) => {
    const targets = sessionAction.sessions;
    setActionError("");
    try {
      await api("/workbench/manage", {
        action,
        sessions: targets.map((w: any) => ({ id: w.id, version: w.version })),
      });
      if (targets.some((w: any) => w.id === selectedRef.current)) {
        location.hash = "workbench";
        setCurrent(null);
      }
      setSessions((rows) =>
        rows.filter((row) => !targets.some((w: any) => w.id === row.id)),
      );
      setSelection([]);
      setSelecting(false);
      setSessionAction(null);
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError(caughtFeedback(error as Error));
    }
  };
  return (
    <WorkspaceLayout kind="workbench" open={list}>
      {sessionAction && (
        <Modal
          title={
            sessionAction.action === "delete"
              ? tr("web.deleteWorkbenchSessions")
              : tr("web.sessionActions")
          }
          onClose={() => setSessionAction(null)}
        >
          <p>
            {tr("web.sessionActionCount", {
              action:
                sessionAction.action === "delete"
                  ? tr("web.delete")
                  : sessionAction.action === "archive"
                    ? tr("web.archive")
                    : tr("web.unarchive"),
              count: sessionAction.sessions.length,
            })}
          </p>
          {sessionAction.action === "delete" && (
            <p>
              {tr("web.sessionMessagesToolActivityAndCompactionHistoryWillBe")}
            </p>
          )}
          <ErrorBox error={actionError} />
          <Row>
            <Button onClick={() => setSessionAction(null)}>
              {tr("web.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => manageSession(sessionAction.action)}
            >
              {tr("web.confirmOperation")}
            </Button>
          </Row>
        </Modal>
      )}
      <SessionSidebar
        open={list}
        onClose={() => setList(false)}
        label={tr("web.workbenchSessions")}
      >
        <div className="workbench-search-row">
          <Input
            variant="search"
            aria-label={tr("web.searchWorkbenchSessions")}
            placeholder={tr("web.searchSessionNames")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            icon={<MessageSquarePlus aria-hidden="true" />}
            onClick={() => {
              location.hash = "workbench";
              setList(false);
            }}
          >
            {tr("web.newWorkbenchConversation")}
          </Button>
        </div>
        <div className="section-label">
          {archived ? tr("web.archivedSessions") : tr("web.recentSessions")}
          <NavigationButton
            kind="archive"

            onClick={() => setArchived(!archived)}
          >
            {archived ? tr("web.backToRecentSessions") : tr("web.viewArchive")}
          </NavigationButton>
        </div>
        {sessions
          .filter((w) => w.title.includes(search))
          .map((w) => (
            <SessionCard
              key={w.id}
              title={w.title}
              active={selected === w.id}
              selecting={selecting}
              checked={selection.includes(w.id)}
              archived={!!w.archivedAt}
              onCheck={(checked: boolean) =>
                setSelection((ids) =>
                  checked
                    ? [...new Set([...ids, w.id])]
                    : ids.filter((id) => id !== w.id),
                )
              }
              onOpen={() => {
                location.hash = "workbench/" + w.id;
                setList(false);
              }}
              onSelect={() => {
                setSelecting(true);
                setSelection([w.id]);
              }}
              onManage={(operation: string) => {
                setActionError("");
                setSessionAction({ sessions: [w], action: operation });
              }}
              status={w.status}
            />
          ))}
        {!sessions.filter((w) => w.title.includes(search)).length && (
          <p className="note">
            {archived
              ? tr("web.noArchivedSessions")
              : tr("web.noMatchingSessions")}
          </p>
        )}
        {selecting && (
          <SessionBatch
            visible={sessions.filter((w) => w.title.includes(search))}
            selection={selection}
            setSelection={setSelection}
            archived={archived}
            onExit={() => {
              setSelecting(false);
              setSelection([]);
            }}
            onManage={(operation: string) => {
              setActionError("");
              setSessionAction({
                sessions: sessions.filter((w) => selection.includes(w.id)),
                action: operation,
              });
            }}
          />
        )}
      </SessionSidebar>
      <ConversationPane>
        {!current && (
          <div className="chat-heading welcome-heading">
            <div>
              <h2>{tr("web.newSession")}</h2>
              <small>{tr("web.platformAssistant")}</small>
            </div>
            <Row>
              <Button
                shape="icon"

                aria-label={tr("web.environmentSessions")}
                title={tr("web.environmentSessions")}
                onClick={() => (location.hash = "chat")}
              >
                <MessagesSquare aria-hidden="true" />
              </Button>
              <Button
                shape="icon"

                aria-label={tr("web.modelSettings")}
                title={tr("web.modelSettings")}
                onClick={() => (location.hash = "settings")}
              >
                <Settings aria-hidden="true" />
              </Button>
            </Row>
          </div>
        )}
        {!current && (<Button
          placement="sidebar-toggle"
          shape="icon"

          aria-label={tr("web.workbenchSessionList")}
          title={tr("web.workbenchSessionList")}
          onClick={() => setList(true)}
        >
          <PanelLeft aria-hidden="true" />
        </Button>)}
        {current ? (
          <>
            <ConversationHeader
              title={current.title}
              summary={`${models.find((m: any) => m.id === current.modelId)?.name || ""} · ${current.permission === "full" ? tr("web.fullAccess") : tr("web.ask")}`}
              navigation={<Button
          placement="sidebar-toggle"
          shape="icon"

          aria-label={tr("web.workbenchSessionList")}
          title={tr("web.workbenchSessionList")}
          onClick={() => setList(true)}
        >
          <PanelLeft aria-hidden="true" />
        </Button>}
              status={current.archivedAt ? <Badge>{tr("web.archived")}</Badge> : <Status value={current.status} />}
              actions={<>
<ActionMenu
                  label={tr("web.currentSessionActions")}

                  icon={<MoreHorizontal aria-hidden="true" />}
                  items={[
                    {
                      value: current.archivedAt ? "restore" : "archive",
                      label: current.archivedAt
                        ? tr("web.unarchive")
                        : tr("web.archive"),
                    },
                    { value: "delete", label: tr("web.delete") },
                    { value: "select", label: tr("web.selectMultiple") },
                  ].map((option) => ({
                    label: option.label,
                    danger: option.value === "delete",
                    onSelect: () =>
                      ((operation) => {
                        if (operation === "select") {
                          setSelecting(true);
                          setSelection([current.id]);
                          setList(true);
                        } else {
                          setActionError("");
                          setSessionAction({
                            sessions: [current],
                            action: operation,
                          });
                        }
                      })(option.value),
                  }))}
                />
                <Button
                  shape="icon"
                  disabled={
                    !!current.archivedAt ||
                    ["running", "approval", "resuming"].includes(current.status)
                  }

                  aria-label={tr("web.compactContext")}
                  title={tr("web.compactContext")}
                  onClick={() => act("/compress")}
                >
                  <Minimize2 aria-hidden="true" />
                </Button>
              </>}
            />
            <WorkbenchMessages key={current.id}>
              {[
                ...current.transcript,
                ...(current.partial ||
                (["running", "resuming"].includes(current.status) &&
                  !(
                    current.runId &&
                    current.transcript.some(
                      (m: any) => m.runId === current.runId,
                    )
                  ))
                  ? [
                      {
                        role: "assistant",
                        text: current.partial || "",
                        streaming: true,
                      },
                    ]
                  : []),
              ].map((m: any, i: number) => (
                <article
                  key={i}
                  className={
                    "message " + (m.role === "user" ? "user-message" : "")
                  }
                >
                  <MessageIdentity
                    user={m.role === "user"}
                    status={m.streaming ? tr("web.replying") : undefined}
                  />
                  {m.role === "user" ? (
                    <pre className="prose">{m.text}</pre>
                  ) : (
                    <WorkbenchReply message={m} />
                  )}
                  <CopyMessage text={m.text || m.blocks?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n\n") || ""} />
                </article>
              ))}
              <ErrorBox
                error={
                  current.errorDetails ||
                  (current.error ? feedback("common.failure") : "")
                }
              />
              {current.status === "interrupted" && (
                <div>
                  <p className="sub">
                    {tr("web.resumeUsesThePermissionFromTheStartOfThis")}
                  </p>
                  <Button onClick={() => act("/resume")}>
                    {tr("web.resumeFromCheckpoint")}
                  </Button>
                </div>
              )}
              {current.status === "approval" && (
                <div className="approval">
                  <h3>{tr("web.platformOperationsAwaitingApproval")}</h3>
                  <p>
                    {tr(
                      "web.reviewEachOperationAndItsParametersExecutionContinuesAfter",
                    )}
                  </p>
                  {current.approvals.map((a: any) => (
                    <div key={a.index}>
                      <strong>{a.name}</strong>
                      <>
                        {a.name === "create_work_item" && (
                          <CreationApproval arguments={a.arguments} />
                        )}
                        <pre>{a.arguments}</pre>
                      </>
                      {a.decision === undefined ? (
                        <Row>
                          <Button
                            onClick={() =>
                              act("/approve", {
                                version: current.version,
                                approve: false,
                                callIds: [a.callId],
                              })
                            }
                          >
                            {tr("web.rejectThisOperation")}
                          </Button>
                          <Button
                            onClick={() =>
                              act("/approve", {
                                version: current.version,
                                approve: true,
                                callIds: [a.callId],
                              })
                            }
                          >
                            {tr("web.approveThisOperation")}
                          </Button>
                        </Row>
                      ) : (
                        <p className="sub">
                          {a.decision ? tr("web.approved") : tr("web.rejected")}
                        </p>
                      )}
                    </div>
                  ))}
                  <Row>
                    <Button
                      onClick={() =>
                        act("/approve", {
                          version: current.version,
                          approve: false,
                        })
                      }
                    >
                      {tr("web.rejectCount", {
                        count: current.approvals.filter(
                          (a: any) => a.decision === undefined,
                        ).length,
                      })}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() =>
                        act("/approve", {
                          version: current.version,
                          approve: true,
                        })
                      }
                    >
                      {tr("web.approveCount", {
                        count: current.approvals.filter(
                          (a: any) => a.decision === undefined,
                        ).length,
                      })}
                    </Button>
                  </Row>
                </div>
              )}
            </WorkbenchMessages>
          </>
        ) : (
          <div className="home-center workbench-welcome">
            <div className="hello">
              <img src="/assets/bugpaw-mascot.png" alt="" />
              <div>
                <p className="eyebrow">YOUR DEVELOPMENT, CONNECTED</p>
                <h1>{tr("web.whatShallWeMoveForwardToday")}</h1>
                <p>
                  {tr("web.exploreEnvironmentsPlanTasksOrLetAnAgentContinue")}
                </p>
              </div>
            </div>
            <div className="suggestions">
              {[
                tr("web.showDevelopmentEnvironmentStatus"),
                tr("web.explainHowToCreateABoardWorkflow"),
                tr("web.showAvailableProjectsAndSessions"),
              ].map((t, index) => (
                <SurfaceButton
                  kind="suggestion"
                  key={t}
                  onClick={() => setDraft(t)}
                >
                  {index === 0 ? (
                    <Monitor />
                  ) : index === 1 ? (
                    <Columns3 />
                  ) : (
                    <MessagesSquare />
                  )}
                  <strong>{t}</strong>
                  <small>
                    {tr("web.getRealInformationThroughPlatformTools")}
                  </small>
                </SurfaceButton>
              ))}
            </div>
            {(state.sessions.length > 0 || state.boards.length > 0) && (
              <div className="recent">
                <div className="section-label">{tr("web.recentWork")}</div>
                {state.sessions.slice(0, 2).map((session: any) => (
                  <SurfaceButton
                    kind="recent"
                    key={session.id}

                    onClick={() => (location.hash = "chat/" + session.id)}
                  >
                    <span>
                      <MessagesSquare />
                      <span className="recent-title" title={session.title}>
                        {session.title}
                      </span>
                    </span>
                    <small>{tr("web.projectSession")}</small>
                  </SurfaceButton>
                ))}
                {state.boards.slice(0, 1).map((board: any) => (
                  <SurfaceButton
                    kind="recent"
                    key={board.id}

                    onClick={() => (location.hash = "board/" + board.id)}
                  >
                    <span>
                      <Columns3 />
                      {board.name}
                    </span>
                    <small>{tr("web.board")}</small>
                  </SurfaceButton>
                ))}
              </div>
            )}
            <p className="note">
              {models.length
                ? tr(
                    "web.writeOperationsFollowTheSelectedPermissionModeMissingKey",
                  )
                : tr("web.addAWorkbenchModelAndApiKeyInSettings")}
            </p>
          </div>
        )}
        <Composer>
          <Textarea
            variant="composer"
            ref={composerInput}
            aria-label={tr("web.workbenchMessage")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={tr("web.describeYourGoalToTheWorkbench")}
            onKeyDown={(e) =>
              composerKeyDown(
                e,
                () => void send(),
                setDraft,
                (position) => {
                  pendingCaret.current = position;
                },
              )
            }
          />
          {images.length > 0 && (
            <p className="note">
              {tr("web.attachedImages", { count: images.length })}{" "}
              <Button
                shape="icon"

                aria-label={tr("web.removeImages")}
                title={tr("web.removeImages")}
                onClick={() => setImages([])}
              >
                <X aria-hidden="true" />
              </Button>
            </p>
          )}
          <div className="composer-bottom">
            <Row>
              {
                <>
                  <Select
                    variant="ghost"
                    label={tr("web.workbenchModels")}
                    disabled={
                      !!current?.archivedAt ||
                      (current &&
                        ["running", "approval", "resuming"].includes(
                          current.status,
                        ))
                    }
                    value={current?.modelId || modelId || models[0]?.id || ""}
                    options={options(models, tr("web.chooseModel"))}
                    onChange={(v) =>
                      current
                        ? void act("/config", {
                            modelId: v,
                            permission: current.permission,
                          })
                        : setModel(v)
                    }
                  />
                  <PermissionSelect
                    label={tr("web.workbenchPermission")}
                    auto={false}
                    disabled={
                      !!current?.archivedAt ||
                      (current &&
                        ["running", "approval", "resuming"].includes(
                          current.status,
                        ))
                    }
                    value={current?.permission || permission}
                    onChange={(v) =>
                      current
                        ? void act("/config", {
                            modelId: current.modelId,
                            permission: v,
                          })
                        : setPermission(v)
                    }
                  />
                </>
              }
              <AttachmentPicker
                count={images.length}

                title={tr("web.addImage")}
              >
                <ImagePlus aria-hidden="true" />
                <FileInput
                  aria-label={tr("web.addImage")}

                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2000000) {
                      onError(feedback("web.imagesMustBeSmallerThan2Mb"));
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () =>
                      setImages((old) =>
                        [...old, String(reader.result)].slice(-3),
                      );
                    reader.readAsDataURL(file);
                  }}
                />
              </AttachmentPicker>
            </Row>
            <Row>
              {current &&
                ["running", "approval", "resuming"].includes(
                  current.status,
                ) && (
                  <Button
                    shape="icon"

                    aria-label={tr("web.stopReply")}
                    title={tr("web.stopReply")}
                    onClick={() => act("/cancel")}
                  >
                    <StopIcon />
                  </Button>
                )}
              <Button
                shape="icon"
                variant="primary"

                aria-label={tr("web.send")}
                title={tr("web.sendEnter")}
                disabled={!canSend}
                onClick={() => void send()}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            </Row>
          </div>
        </Composer>
        <p className="footnote">{tr("web.enterToSendShiftCtrlEnterForANew")}</p>
      </ConversationPane>
    </WorkspaceLayout>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if ("serviceWorker" in navigator)
  void navigator.serviceWorker.register("/sw.js");
