import { useRows } from "./use-rows.js";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, PanelsTopLeft } from "lucide-react";
import { api } from "./api.js";
import {
  caughtFeedback,
  currentLocale,
  displayError,
  feedback,
  localeDate,
  t,
  useLocale,
  type UiFeedback,
} from "./locale.js";
import {
  Actions,
  Badge,
  Button,
  CardGrid,
  CollectionLayout,
  Dialog,
  Disclosure,
  EmptyState,
  EntityCard,
  ErrorBox,
  FormField,
  LinkButton,
  Metadata,
  Panel,
  Row,
  Sections,
  Textarea,
} from "./ui/index.js";

type Source = {
  projectId: string;
  environmentId: string;
  sessionId: string;
  itemId: string | null;
};
type Sources = {
  projects: { id: string; name: string }[];
  environments: { id: string; name: string }[];
  sessions: { id: string; title: string }[];
};
type Deletion = "cleaning" | "deleted";
type Published = Pick<Source, "sessionId" | "itemId"> &
  Partial<Pick<Source, "projectId" | "environmentId">> & {
  id: string;
  title: string;
  number: number;
  listed: boolean;
  deletion?: Deletion;
};
type App = Published & { latestVersionId: string; publishedAt: string };
type Version = Published & {
  createdAt: string;
  executionId?: string | null;
  feedback: VersionFeedback[];
};
type FeedbackKind = "confirmed" | "change" | "selection";
type VersionFeedback = {
  id: string;
  kind: FeedbackKind;
  text: string;
  createdAt: string;
};
type OpenVersion = { id: string; title: string; number: number };
const feedbackLabels = {
  confirmed: "light.confirmed",
  change: "light.changeRecorded",
  selection: "light.selection",
};

function ReadError({ error, retry }: { error: UiFeedback; retry: () => void }) {
  return (
    <>
      <ErrorBox error={error} />
      <Button onClick={retry}>{t("web.retry")}</Button>
    </>
  );
}

function ListingBadge({ listed, deletion }: Pick<Published, "listed" | "deletion">) {
  const label = deletion === "deleted" ? "light.deleted"
    : deletion === "cleaning" ? "light.cleanupPending"
    : listed ? "light.listed" : "light.unlisted";
  return (
    <Badge tone={listed ? "good" : "neutral"}>
      {t(label)}
    </Badge>
  );
}

function SourceDetails({
  value,
  sources,
}: {
  value: Partial<Source>;
  sources: Sources;
}) {
  const project = sources.projects.find(({ id }) => id === value.projectId);
  const environment = sources.environments.find(
    ({ id }) => id === value.environmentId,
  );
  const session = sources.sessions.find(({ id }) => id === value.sessionId);
  return (
    <Metadata
      items={[
        {
          label: t("light.source"),
          value: (
            <>
              {[project?.name, environment?.name, session?.title]
                .filter(Boolean)
                .join(" · ") || t("light.sourceMissing")}
              {session && (
                <>
                  {" "}
                  <LinkButton href={"#chat/" + session.id}>
                    {t("light.sourceSession")}
                  </LinkButton>
                </>
              )}
            </>
          ),
        },
      ]}
    />
  );
}

function VersionFeedbackDetails({ entries }: { entries: VersionFeedback[] }) {
  if (!entries.length) return null;
  return (
    <Disclosure label={t("light.feedback")}>
      <Metadata items={entries.map((entry) => ({
        label: t(feedbackLabels[entry.kind]),
        value: (
          <>
            {entry.text && <pre className="prose">{entry.text}</pre>}
            <time dateTime={entry.createdAt}>{localeDate(entry.createdAt)}</time>
          </>
        ),
      }))} />
    </Disclosure>
  );
}

function VersionCards({
  rows,
  sources,
  onOpen,
}: {
  rows: Version[];
  sources: Sources;
  onOpen: (version: OpenVersion) => void;
}) {
  return (
    <CardGrid>
      {[...rows]
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.number - a.number,
        )
        .map((row) => (
          <EntityCard
            key={row.id}
            title={row.title}
            subtitle={t("light.version", { number: row.number })}
            icon={<PanelsTopLeft aria-hidden="true" />}
            status={<ListingBadge {...row} />}
            actions={
              !row.deletion && <Button
                disabled={!row.listed}
                aria-label={t("light.openVersion", {
                  title: row.title,
                  number: row.number,
                })}
                onClick={() => onOpen(row)}
              >
                {t("light.open")}
              </Button>
            }
          >
            <Disclosure label={t("light.source")}>
              <p className="wrap">{row.title}</p>
              <SourceDetails value={row} sources={sources} />
            </Disclosure>
            <time dateTime={row.createdAt}>{localeDate(row.createdAt)}</time>
            <VersionFeedbackDetails entries={row.feedback} />
          </EntityCard>
        ))}
    </CardGrid>
  );
}

/** 会话时间线复用版本索引轮询与独立查看器，打开动作始终使用该条记录的版本。 */
export function useSessionPublications(id?: string) {
  const history = useRows<Version>(
    id ? "/light-versions?" + new URLSearchParams({ sessionId: id }) : "",
  );
  const [selection, setSelection] = useState<{ sessionId: string; version: Version }>();
  const selected = selection?.sessionId === id
    ? history.rows?.find((row) => row.id === selection?.version.id && !row.deletion)
    : undefined;
  return {
    ...history,
    open: (version: Version) => {
      if (id) setSelection({ sessionId: id, version });
    },
    status: history.error ? (
      <div role="group" aria-label={t("light.publications")}>
        <p>{t("light.listError")}</p>
        <ReadError error={history.error} retry={history.refresh} />
      </div>
    ) : id && !history.rows ? (
      <p className="note" role="status">{t("light.loadingPublications")}</p>
    ) : null,
    viewer: selected && (
      <LightViewer
        key={selected.id}
        version={selected}
        onClose={() => setSelection(undefined)}
        onFeedback={history.refresh}
      />
    ),
  };
}

/** 紧凑附件条使用统一控件，详情保留完整时间、来源及该版反馈。 */
export function SessionPublication({
  version,
  sources,
  onOpen,
}: {
  version: Version;
  sources: Sources;
  onOpen: (version: Version) => void;
}) {
  const [details, setDetails] = useState(false);
  const date = new Date(version.createdAt);
  const shortTime = date.toLocaleString(currentLocale(), {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return (
    <article className="session-publication" aria-label={version.title}>
      <Row>
        <strong>{version.title}</strong>
        {!version.deletion && <Button
          size="small"
          disabled={!version.listed}
          aria-label={t("light.openVersion", { title: version.title, number: version.number })}
          onClick={() => onOpen(version)}
        >
          {t("light.open")}
        </Button>}
        <span className="session-publication-version">
          {t("light.version", { number: version.number })}
        </span>
        <time dateTime={version.createdAt}>{shortTime}</time>
        <ListingBadge {...version} />
        <Button size="small" variant="ghost" onClick={() => setDetails(true)}>
          {t("light.publicationDetails")}
        </Button>
      </Row>
      {details && (
        <Dialog title={t("light.publicationDetails")} onClose={() => setDetails(false)}>
          <p className="wrap">
            {version.title} · {t("light.version", { number: version.number })}
          </p>
          <SourceDetails value={version} sources={sources} />
          <Metadata items={[{
            label: t("light.published"),
            value: <time dateTime={version.createdAt}>{localeDate(version.createdAt)}</time>,
          }]} />
          <VersionFeedbackDetails entries={version.feedback} />
        </Dialog>
      )}
    </article>
  );
}

export function LightPublications({
  id,
  scope,
  sources,
}: {
  id: string;
  scope: "itemId";
  sources: Sources;
}) {
  useLocale();
  const history = useRows<Version>(
    "/light-versions?" + new URLSearchParams({ [scope]: id }),
  );
  const [selected, setSelected] = useState<OpenVersion>();
  if (!history.rows?.length && !history.error) return null;
  return (
    <Panel title={t("light.publications")}>
      {history.error && (
        <ReadError error={history.error} retry={history.refresh} />
      )}
      {history.rows && (
        <VersionCards
          rows={history.rows}
          sources={sources}
          onOpen={setSelected}
        />
      )}
      {selected && !history.rows?.find((row) => row.id === selected.id)?.deletion && (
        <LightViewer
          key={selected.id}
          version={selected}
          onClose={() => setSelected(undefined)}
          onFeedback={history.refresh}
        />
      )}
    </Panel>
  );
}

function VersionHistory({
  app,
  sources,
  onOpen,
  onClose,
}: {
  app: App;
  sources: Sources;
  onOpen: (version: OpenVersion) => void;
  onClose: () => void;
}) {
  const history = useRows<Version>(
    "/light-versions?" + new URLSearchParams({ appId: app.id }),
  );
  return (
    <Dialog title={t("light.versions")} onClose={onClose}>
      <p className="wrap">{app.title}</p>
      {history.error && (
        <ReadError error={history.error} retry={history.refresh} />
      )}
      {history.rows ? (
        <VersionCards rows={history.rows} sources={sources} onOpen={onOpen} />
      ) : (
        !history.error && <p role="status">{t("web.loading")}</p>
      )}
    </Dialog>
  );
}

type Confirmation = {
  id: string;
  status: "pendingConfirmation";
  action: "unlist" | "delete";
  appId: string;
  title: string;
  versionCount: number;
  latestVersionId: string;
};
type DecisionStatus = "deleted" | "alreadyDeleted" | "cleanupIncomplete" |
  "cancelled" | "unlisted" | "alreadyUnlisted";
type Notice = { title: string; status: DecisionStatus };
const decisionLabels = {
  deleted: "light.deleted",
  alreadyDeleted: "light.deleted",
  cleanupIncomplete: "light.cleanupHelp",
  cancelled: "light.cancelled",
  unlisted: "light.unlisted",
  alreadyUnlisted: "light.unlisted",
} as const;

function requestDelete(appId: string): Promise<Confirmation | { status: "alreadyDeleted" }> {
  return api("/light-apps/" + appId + "/delete-request", {}, "POST", 10000);
}

function DecisionNotice({ notice }: { notice: Notice }) {
  return (
    <p className="wrap" role="status">
      <strong>{notice.title}</strong>{" · "}{t(decisionLabels[notice.status])}
    </p>
  );
}

/** 每次提交只使用当前展示的确认记录，版本变化后重新取得授权范围。 */
function LightDecision({
  initial,
  onClose,
  onResult,
  reload,
}: {
  initial: Confirmation;
  onClose: () => void;
  onResult: (notice: Notice) => void;
  reload: (confirmation: Confirmation) => Promise<Confirmation | { status: "alreadyDeleted" } | undefined>;
}) {
  const [confirmation, setConfirmation] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [error, setError] = useState<UiFeedback>();
  const deleting = confirmation.action === "delete";
  const label = t(deleting ? "light.delete" : "light.unlist");

  async function updateScope() {
    const next = await reload(confirmation);
    if (next?.status === "alreadyDeleted") {
      onResult({ title: confirmation.title, status: next.status });
    } else if (next && next.id !== confirmation.id) {
      setConfirmation(next);
      setOutdated(false);
    }
  }

  async function submit(approve: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      if (outdated) {
        await updateScope();
        return;
      }
      const { status }: { status: DecisionStatus } = await api(
        "/light-apps/" + confirmation.appId + "/decision",
        { confirmationId: confirmation.id, approve },
        "POST",
        30000,
      );
      if (status === "cleanupIncomplete" && approve) {
        setIncomplete(true);
      }
      onResult({ title: confirmation.title, status });
    } catch (cause) {
      setError(caughtFeedback(cause));
      if ((cause as { code?: string }).code === "LIGHT_SCOPE_CHANGED") {
        setError(feedback("errors.LIGHT_SCOPE_CHANGED.light"));
        setOutdated(true);
        try {
          await updateScope();
        } catch (reloadError) {
          setError(caughtFeedback(reloadError));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={label} onClose={onClose} busy={busy}>
      <p className="wrap"><strong>{confirmation.title}</strong></p>
      <p>{t(deleting ? "light.deleteScope" : "light.unlistScope", { count: confirmation.versionCount })}</p>
      {error && <ErrorBox error={error} />}
      {incomplete && <p role="status">{t("light.cleanupHelp")}</p>}
      {busy && <p role="status">{t("light.submitting")}</p>}
      <Actions>
        <Button data-initial-focus disabled={busy} onClick={() => {
          if (outdated || incomplete) onClose();
          else void submit(false);
        }}>{t(outdated || incomplete ? "web.close" : "web.cancel")}</Button>
        <Button
          variant={deleting && !outdated ? "danger" : "primary"}
          disabled={busy}
          onClick={() => void submit(true)}
        >
          {outdated ? t("light.reloadScope") : incomplete ? t("light.retryCleanup") : label}
        </Button>
      </Actions>
    </Dialog>
  );
}

export function useSessionLightConfirmations(id?: string) {
  // 新请求由 SSE 提醒，较低频率的轮询用于跨窗口对账。
  return useRows<Confirmation>(
    id ? "/light-confirmations?" + new URLSearchParams({ sessionId: id }) : "",
    15000,
  );
}

export function SessionLightConfirmations({
  collection,
  onDecision,
}: {
  collection: ReturnType<typeof useSessionLightConfirmations>;
  onDecision: () => void;
}) {
  const [selected, setSelected] = useState<Confirmation>();
  const [notice, setNotice] = useState<Notice>();
  if (!collection.rows?.length && !collection.error && !selected && !notice) return null;
  return (
    <Panel title={t("light.confirmations")}>
      {collection.error && <ReadError error={collection.error} retry={collection.refresh} />}
      {notice && <DecisionNotice notice={notice} />}
      {collection.rows?.map((confirmation) => (
        <Row key={confirmation.id}>
          <strong className="wrap">{confirmation.title}</strong>
          <Button onClick={() => setSelected(confirmation)}>
            {t(confirmation.action === "delete" ? "light.reviewDelete" : "light.reviewUnlist")}
          </Button>
        </Row>
      ))}
      {selected && (
        <LightDecision
          initial={selected}
          onClose={() => setSelected(undefined)}
          onResult={(result) => {
            if (result.status !== "cleanupIncomplete") setSelected(undefined);
            setNotice(result);
            void collection.refresh();
            onDecision();
          }}
          reload={async (current) => (await collection.refresh())?.find((row) =>
            row.appId === current.appId && row.action === current.action &&
            row.id !== current.id && row.latestVersionId !== current.latestVersionId,
          )}
        />
      )}
    </Panel>
  );
}

export function LightAppsPage({ sources }: { sources: Sources }) {
  useLocale();
  const [listed, setListed] = useState(true);
  const collection = useRows<App>("/light-apps?listed=" + listed);
  const [history, setHistory] = useState<App>();
  const [selected, setSelected] = useState<OpenVersion>();
  const [busy, setBusy] = useState<string>();
  const [preparing, setPreparing] = useState<string>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [notice, setNotice] = useState<Notice>();
  const [deleteError, setDeleteError] = useState<UiFeedback>();
  const [listingError, setListingError] = useState<{
    app: App;
    error: UiFeedback;
  }>();
  const listHeading = useRef<HTMLDivElement>(null);
  const filter = useRef(listed);
  filter.current = listed;

  async function beginDelete(app: App) {
    const originalFilter = listed;
    setPreparing(app.id);
    setDeleteError(undefined);
    setNotice(undefined);
    try {
      const result = await requestDelete(app.id);
      if (result.status === "pendingConfirmation") setConfirmation(result);
      else setNotice({ title: app.title, status: result.status });
    } catch (cause) {
      setDeleteError(caughtFeedback(cause));
    } finally {
      if (originalFilter === filter.current) void collection.refresh();
      setPreparing(undefined);
    }
  }

  async function changeListing(app: App) {
    const originalFilter = listed;
    setBusy(app.id);
    setListingError(undefined);
    try {
      await api(
        "/light-apps/" + app.id + "/listing",
        { listed: !app.listed },
        "PUT",
        10000,
      );
      if (
        filter.current === originalFilter &&
        document.activeElement === document.body
      )
        listHeading.current
          ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
          ?.focus();
    } catch (error) {
      setListingError({ app, error: caughtFeedback(error) });
    } finally {
      if (filter.current === originalFilter) await collection.refresh();
      setBusy(undefined);
    }
  }

  return (
    <CollectionLayout
      title={t("light.title")}
      toolbar={
        <div ref={listHeading}>
          <Sections
            label={t("light.title")}
            value={String(listed)}
            onChange={(value) => setListed(value === "true")}
            items={[
              { value: "true", label: t("light.listed") },
              { value: "false", label: t("light.unlisted") },
            ]}
          />
        </div>
      }
    >
      {collection.error && (
        <ReadError error={collection.error} retry={collection.refresh} />
      )}
      {deleteError && <ErrorBox error={deleteError} />}
      {notice && <DecisionNotice notice={notice} />}
      {listingError && (
        <Panel>
          <p>{t("light.listingError")}</p>
          <ErrorBox error={listingError.error} />
          {collection.rows?.some(
            (app) =>
              app.id === listingError.app.id &&
              app.listed === listingError.app.listed,
          ) && (
            <Button
              disabled={!!busy || !!preparing}
              onClick={() => void changeListing(listingError.app)}
            >
              {t("web.retry")}
            </Button>
          )}
        </Panel>
      )}
      {!collection.rows && !collection.error && (
        <p role="status">{t("web.loading")}</p>
      )}
      {collection.rows?.length === 0 && (
        <EmptyState
          title={t(listed ? "light.emptyListed" : "light.emptyUnlisted")}
        />
      )}
      {collection.rows && (
        <CardGrid>
          {collection.rows.map((app) => (
            <EntityCard
              key={app.id}
              title={app.title}
              subtitle={t("light.version", { number: app.number })}
              icon={<PanelsTopLeft aria-hidden="true" />}
              status={<ListingBadge {...app} />}
              actions={
                <>
                  {app.listed && (
                    <Button
                      variant="primary"
                      onClick={() =>
                        setSelected({ ...app, id: app.latestVersionId })
                      }
                    >
                      {t("light.open")}
                    </Button>
                  )}
                  <Button onClick={() => setHistory(app)}>
                    {t("light.versions")}
                  </Button>
                  {!app.deletion && <Button
                    disabled={!!busy || !!preparing}
                    onClick={() => void changeListing(app)}
                  >
                    {t(
                      busy === app.id
                        ? "web.loading"
                        : app.listed
                          ? "light.unlist"
                          : "light.restore",
                    )}
                  </Button>}
                  <Button variant="danger" disabled={!!busy || !!preparing} onClick={() => void beginDelete(app)}>
                    {t(preparing === app.id ? "web.loading" : app.deletion === "cleaning" ? "light.retryCleanup" : "light.delete")}
                  </Button>
                </>
              }
            >
              <SourceDetails value={app} sources={sources} />
              <time dateTime={app.publishedAt}>
                {localeDate(app.publishedAt)}
              </time>
            </EntityCard>
          ))}
        </CardGrid>
      )}
      {confirmation && (
        <LightDecision
          initial={confirmation}
          onClose={() => setConfirmation(undefined)}
          onResult={(result) => {
            setNotice(result);
            if (result.status !== "cleanupIncomplete") setConfirmation(undefined);
            void collection.refresh();
          }}
          reload={(current) => requestDelete(current.appId)}
        />
      )}
      {history && (
        <VersionHistory
          app={history}
          sources={sources}
          onClose={() => setHistory(undefined)}
          onOpen={setSelected}
        />
      )}
      {selected && (
        <LightViewer
          key={selected.id}
          version={selected}
          onClose={() => setSelected(undefined)}
          onFeedback={collection.refresh}
        />
      )}
    </CollectionLayout>
  );
}

type LightOpen = {
  viewId: string;
  channelId: string;
  action: string;
  ticket: string;
};
type ViewerSession = {
  viewId: string;
  port?: MessagePort;
  ready: boolean;
  hasBackend?: boolean;
  dispose: () => void;
  flushAndClose: (close: () => void) => void;
};

type StorageChange = [string, string | null];
type RuntimeDiagnostic = {
  kind: "script" | "promise" | "resource" | "storage";
  message: string;
  file: string;
  line: number;
  column: number;
};

function viewingError(status: number) {
  if (status === 401) return "errors.LIGHT_ACCESS.light";
  if (status === 410) return "errors.LIGHT_OFFLINE.light";
  if (status === 404) return "light.versionMissing";
  return "errors.LIGHT_HOST.light";
}

/** 用发布文档的独立端口确认 iframe 仍显示首次授权的文档。 */
function confirmDocument(port: MessagePort, flush = false) {
  return new Promise<boolean>((resolve) => {
    const challenge = crypto.randomUUID();
    const finish = (valid: boolean) => {
      clearTimeout(timer);
      port.removeEventListener("message", receive);
      resolve(valid);
    };
    const receive = (event: MessageEvent) => {
      if (event.data === challenge) finish(true);
    };
    const timer = setTimeout(() => finish(false), 1500);
    port.addEventListener("message", receive);
    port.postMessage(flush ? { type: "relay.light.flush", challenge } : challenge);
  });
}

function LightViewer({
  version,
  onClose,
  onFeedback,
}: {
  version: OpenVersion;
  onClose: () => void;
  onFeedback: () => void;
}) {

  const view = useRef<ViewerSession | null>(null);
  const toolbar = useRef<HTMLSpanElement>(null);
  const title = t("light.openVersion", {
    title: version.title,
    number: version.number,
  });
  return (
    <Dialog layout="viewer" title={title} headerActions={<span ref={toolbar} className="light-viewer-toolbar" />} onClose={() => {
      if (view.current) view.current.flushAndClose(onClose);
      else onClose();
    }}>
      <LightViewerContent
        title={title}
        versionId={version.id}
        view={view}
        toolbar={toolbar}
        onFeedback={onFeedback}
        onNavigate={onClose}
      />
    </Dialog>
  );
}

/** 重新签发授权时保留反馈草稿和待通知记录。 */
function LightViewerContent({
  title,
  versionId,
  view,
  onFeedback,
  onNavigate,
  toolbar,
}: {
  title: string;
  versionId: string;
  view: { current: ViewerSession | null };
  onFeedback: () => void;
  onNavigate: () => void;
  toolbar: { current: HTMLSpanElement | null };
}) {
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const target = "relay-light-" + useId();
  const [ready, setReady] = useState(false);
  const [openError, setOpenError] = useState<UiFeedback>();
  const [kind, setKind] = useState<"change" | "confirmed">("confirmed");
  const operation = useRef<string | undefined>(undefined);
  const [pendingId, setPendingId] = useState<string>();
  const [sessionId, setSessionId] = useState<string>();
  const [notificationError, setNotificationError] = useState<UiFeedback>();
  const [selectionResult, setSelectionResult] = useState<UiFeedback>();
  const surface = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    message: UiFeedback;
    error?: boolean;
  }>();
  const feedbackPending = useRef({ user: false, selection: false });
  const [storageError, setStorageError] = useState<UiFeedback>();
  const path = "/light-versions/" + encodeURIComponent(versionId);
  const onFeedbackRef = useRef(onFeedback);
  useEffect(() => {
    onFeedbackRef.current = onFeedback;
  }, [onFeedback]);

  useEffect(() => {
    setOpenError(undefined);
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const element = frame.current!;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    let opened: LightOpen | undefined;
    let statusUrl: URL;
    let checking = false;
    let closing = false;
    let writes = Promise.resolve();

    const revoke = (viewId: string) => {
      void fetch("/api" + path + "/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewId }),
        keepalive: true,
      }).catch(() => {});
    };
    const dispose = () => {
      if (signal.aborted) return;
      lifetime.abort();
      clearTimeout(deadline);
      clearInterval(polling);
      view.current?.port?.close();
      view.current = null;
      // 已接收的写入顺序完成后再撤销授权，卸载后停止接收新消息。
      if (opened) void writes.then(() => revoke(opened!.viewId));
    };
    const fail = (error: UiFeedback) => {
      dispose();
      setReady(false);
      setOpenError(error);
    };

    const diagnose = async (session: ViewerSession, error: RuntimeDiagnostic) => {
      await api(path + "/diagnostics", { viewId: session.viewId, error }, "POST", 6000);
    };

    const receiveRuntime = (session: ViewerSession, { data }: MessageEvent) => {
      if (view.current !== session || !session.ready) return;
      if (data?.type === "relay.light.backend" && session.hasBackend && !closing) {
        // 路由和授权来自查看器，只从沙箱接收业务调用及响应关联标识。
        const { id, call } = data;
        if (typeof id !== "string" || id.length !== 36) return;
        const reply = (payload: { result?: unknown; error?: string }) => {
          if (view.current === session)
            session.port?.postMessage({ type: "relay.light.backend.result", id, ...payload });
        };
        void api(path + "/backend", { viewId: session.viewId, call }, "POST", 15000)
          .then(result => reply({ result }))
          .catch(error => {
            const details = caughtFeedback(error);
            reply({ error: error?.code && typeof details !== "string" ? t(details.messageKey, details.messageParams) : t("light.backend.unknown") });
          });
      } else if (data?.type === "relay.light.storage") {
        const changes: StorageChange[] = data.changes;
        if (!Array.isArray(changes) || !changes.length || !changes.every(
          (entry) => Array.isArray(entry) && entry.length === 2 &&
            typeof entry[0] === "string" &&
            (typeof entry[1] === "string" || entry[1] === null),
        )) return;
        writes = writes.then(async () => {
          try {
            await api(path + "/storage", { viewId: session.viewId, changes }, "POST", 6000);
          } catch (error) {
            if (view.current !== session) return;
            const { status, code } = error as { status?: number; code?: string };
            if (status === 401 || status === 410 || status === 404) {
              return fail(feedback(viewingError(status)));
            }
            const quota = code === "LIGHT_QUOTA";
            setStorageError(feedback(quota ? "errors.LIGHT_QUOTA.storage" : "light.storageCommitFailed"));
            await diagnose(session, {
              kind: "storage",
              message: quota ? "QuotaExceededError" : "Storage commit failed",
              file: "",
              line: 0,
              column: 0,
            }).catch(() => {});
          }
        });
      } else if (data?.type === "relay.light.diagnostic" && data.error) {
        const { kind, message, file, line, column }: RuntimeDiagnostic = data.error;
        if (!["script", "promise", "resource", "storage"].includes(kind) ||
          typeof message !== "string" || typeof file !== "string" ||
          !Number.isSafeInteger(line) || line < 0 ||
          !Number.isSafeInteger(column) || column < 0) return;
        void diagnose(session, {
          kind, message: message.slice(0, 512), file: file.slice(0, 512), line, column,
        }).catch(() => {});
      }
    };

    const verify = async () => {
      const session = view.current;
      if (!session || checking) return;
      checking = true;
      try {
        const response = await fetch(statusUrl, {
          method: "POST",
          body: new URLSearchParams({ viewId: session.viewId }),
          credentials: "include",
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
        });
        if (signal.aborted) return;
        if (response.status !== 204)
          return fail(feedback(viewingError(response.status)));
        if (session.port && (await confirmDocument(session.port))) {
          if (signal.aborted) return;
          if (!session.ready) {
            const snapshot = await api(
              path + "/snapshot", { viewId: session.viewId }, "POST", 6000,
            );
            if (view.current !== session) return;
            if (!Array.isArray(snapshot?.entries) || !Number.isSafeInteger(snapshot.quota))
              return fail(feedback("light.storageLoadFailed"));
            session.hasBackend = snapshot.hasBackend === true;
            session.port.postMessage({
              ...(session.hasBackend && { hasBackend: true, unknownResult: t("light.backend.unknown"), invalidCall: t("light.backend.invalid") }),
              type: "relay.light.init", entries: snapshot.entries, quota: snapshot.quota,
            });
          }
          clearTimeout(deadline);
          session.ready = true;
          setReady(true);
        } else if (!signal.aborted) {
          fail(feedback("errors.LIGHT_ACCESS.light"));
        }
      } catch (error) {
        if (signal.aborted) return;
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 410 || status === 404)
          fail(feedback(viewingError(status)));
        else
          fail(feedback(!session.ready && session.port
            ? "light.storageLoadFailed" : "errors.LIGHT_HOST.light"));
      } finally {
        checking = false;
      }
    };

    window.addEventListener(
      "message",
      (event) => {
        const session = view.current;
        const data = event.data;
        if (
          !opened ||
          !session ||
          session.port ||
          event.source !== element.contentWindow ||
          event.origin !== "null" ||
          data?.channelId !== opened.channelId
        )
          return;
        if (data.type === "relay.light.error") void verify();
        if (data.type !== "relay.light.ready" || event.ports.length !== 1)
          return;
        session.port = event.ports[0];
        session.port.addEventListener("message", (message) => receiveRuntime(session, message));
        session.port.start();
        void verify();
      },
      { signal },
    );

    void (async () => {
      try {
        opened = (await api(path + "/open", {}, "POST", 10000)) as LightOpen;
        if (signal.aborted) return revoke(opened.viewId);
        const action = new URL(opened.action);
        if (
          action.protocol !== "https:" ||
          action.origin === location.origin ||
          action.pathname !==
            "/v/" + encodeURIComponent(versionId) + "/_open" ||
          action.search ||
          action.hash ||
          action.username ||
          action.password ||
          !opened.viewId ||
          !opened.channelId ||
          !opened.ticket
        ) {
          return fail(feedback("errors.LIGHT_HOST.light"));
        }
        statusUrl = new URL("_status", action);
        view.current = {
          viewId: opened.viewId, ready: false, dispose,
          flushAndClose: (close) => {
            if (closing) return;
            const session = view.current;
            if (!session?.ready || !session.port) return close();
            closing = true;
            // 普通关闭给沙箱一次机会提交尚在计时器中的变更。
            void confirmDocument(session.port, true).finally(() => {
              if (!signal.aborted) close();
            });
          },
        };
        const form = document.createElement("form");
        form.method = "POST";
        form.action = action.href;
        form.target = target;
        form.hidden = true;
        const ticket = document.createElement("input");
        ticket.type = "hidden";
        ticket.name = "ticket";
        ticket.value = opened.ticket;
        form.append(ticket);
        document.body.append(form);
        try {
          deadline = setTimeout(() => void verify(), 12000);
          polling = setInterval(() => {
            if (!document.hidden && view.current?.ready) void verify();
          }, 5000);
          window.addEventListener(
            "focus",
            () => {
              if (view.current?.ready) void verify();
            },
            { signal },
          );
          window.addEventListener(
            "pagehide",
            (event) => {
              if (event.persisted) fail(feedback("errors.LIGHT_ACCESS.light"));
              else dispose();
            },
            { signal, once: true },
          );
          form.submit();
        } finally {
          form.remove();
        }
      } catch (error) {
        if (!signal.aborted) {
          const status = (error as { status?: number })?.status;
          fail(
            status === 404
              ? feedback(viewingError(status))
              : caughtFeedback(error),
          );
        }
      }
    })();
    return dispose;
  }, [attempt, path, target, versionId, view]);

  // 系统全屏与窗口铺满共用同一节点，进出时保留沙箱运行状态。
  function leaveFullscreen() {
    if (document.fullscreenElement === document.documentElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      setExpanded(false);
    }
  }

  useEffect(() => {
    if (!expanded) return;
    const dialog = surface.current?.closest("dialog");
    const sync = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    const cancel = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      leaveFullscreen();
    };
    toggle.current?.querySelector("button")?.focus();
    document.addEventListener("fullscreenchange", sync);
    dialog?.addEventListener("cancel", cancel, true);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement === document.documentElement) {
        void document.exitFullscreen().catch(() => {});
      }
      dialog?.removeEventListener("cancel", cancel, true);
      const entry = toggle.current?.querySelector("button");
      const fallback = dialog?.querySelector<HTMLButtonElement>("header > button");
      (entry?.getClientRects().length ? entry : fallback)?.focus();
    };
  }, [expanded]);

  async function notify(id: string, viewId: string) {
    setNotificationError(undefined);
    try {
      const receipt = await api(path + "/feedback/" + encodeURIComponent(id) + "/notify",
        { viewId }, "POST", 30000);
      setSessionId(receipt.sessionId);
      setPendingId(undefined);
    } catch (cause) {
      setNotificationError(caughtFeedback(cause));
    }
  }

  const submit = useCallback(async (type: FeedbackKind, value: string, send = false) => {
    const session = view.current;
    const channel = type === "selection" ? "selection" : "user";
    if (!session?.ready || !session.port || feedbackPending.current[channel]) return;
    feedbackPending.current[channel] = true;
    if (channel === "user") {
      setSending(true);
      setResult(undefined);
      setSessionId(undefined);
      setSelectionResult(undefined);
    }
    try {
      if (!await confirmDocument(session.port)) {
        if (view.current === session) {
          session.dispose();
          setReady(false);
          setOpenError(feedback("errors.LIGHT_ACCESS.light"));
        }
        return;
      }
      if (view.current !== session) return;
      // 响应丢失时沿用原提交标识，编辑正文或切换反馈类型后再换号。
      const operationId = type === "selection" ? crypto.randomUUID() : operation.current ??= crypto.randomUUID();
      const saved = await api(path + "/feedback",
        { viewId: session.viewId, operationId, kind: type, text: value }, "POST", 10000);
      onFeedbackRef.current();
      if (type === "selection") {
        setSelectionResult(feedback("light.selectionSaved"));
        return;
      }
      operation.current = undefined;
      setText("");
      setKind("confirmed");
      if (send) {
        setPendingId(saved.id);
        await notify(saved.id, session.viewId);
      } else {
        setResult({ message: feedback("light.saved") });
      }
    } catch (cause) {
      if (type === "selection") setSelectionResult(caughtFeedback(cause));
      else setResult({ message: caughtFeedback(cause), error: true });
    } finally {
      feedbackPending.current[channel] = false;
      if (channel === "user") setSending(false);
    }
  }, [path, view]);

  async function retryNotification() {
    if (!pendingId || !view.current?.ready || feedbackPending.current.user) return;
    feedbackPending.current.user = true;
    setSending(true);
    try {
      await notify(pendingId, view.current.viewId);
    } finally {
      feedbackPending.current.user = false;
      setSending(false);
    }
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      const data = event.data;
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        data?.type !== "relay.light.selection" ||
        typeof data.text !== "string" ||
        !data.text.trim() ||
        data.text.length > 4000
      )
        return;
      void submit("selection", data.text.trim());
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [submit]);

  const fullscreenLabel = t(expanded ? "light.exitFullscreen" : "light.fullscreen");
  const feedbackText = kind === "change" ? text.trim() : "";
  const submitDisabled = sending || (kind === "change" && !feedbackText);
  return (
    <>
      {toolbar.current && createPortal(
        <span ref={toggle} className="light-fullscreen-entry" data-expanded={expanded} hidden={!ready && !expanded}>
          <Button
            variant="ghost"
            shape="icon"
            aria-label={fullscreenLabel}
            title={fullscreenLabel}
            onClick={() => {
              if (expanded) return leaveFullscreen();
              setExpanded(true);
              // 模态 dialog 自身无法请求系统全屏，使用文档根保留顶层弹窗。
              void document.documentElement.requestFullscreen?.().catch(() => {});
            }}
          >
            {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </Button>
        </span>, toolbar.current)}
      <div ref={surface} className="ui-embedded-view" data-expanded={expanded}>
        <iframe
          ref={frame}
          name={target}
          title={title}
          hidden={!!openError}
          aria-hidden={!ready}
          tabIndex={ready ? 0 : -1}
          sandbox="allow-scripts"
        />
        {!ready && (
          <div className="ui-embedded-view-state">
            {openError ? (
              <ReadError error={openError} retry={() => setAttempt(n => n + 1)} />
            ) : (
              <p role="status">{t("web.loading")}</p>
            )}
          </div>
        )}
      </div>
      {ready && (
        <div className="ui-embedded-view-controls">
          {storageError && <ErrorBox error={storageError} />}
          {!pendingId && <>
            <Sections label={t("light.feedback")} value={kind} onChange={(value) => {
              if (sending || value === kind) return;
              setKind(value as "change" | "confirmed");
              operation.current = undefined;
              setResult(undefined);
              setSessionId(undefined);
            }} items={[
              { value: "confirmed", label: t("light.confirm") },
              { value: "change", label: t("light.change") },
            ]} />
            {kind === "change" && <FormField label={t("light.changeNote")}>
              <Textarea rows={2} value={text} maxLength={4000} readOnly={sending}
                onChange={event => {
                  operation.current = undefined;
                  setText(event.target.value);
                }} />
            </FormField>}
            <Actions>
              <Button variant="primary" disabled={submitDisabled}
                onClick={() => void submit(kind, feedbackText)}>
                {t(kind === "change" ? "light.submitOnly" : "light.confirmOnly")}
              </Button>
              <Button disabled={submitDisabled}
                onClick={() => void submit(kind, feedbackText, true)}>
                {t(kind === "change" ? "light.submitNotify" : "light.confirmNotify")}
              </Button>
            </Actions>
          </>}
          {notificationError && <>
            <p role="alert">{t("light.notifyFailed")}</p>
            <ErrorBox error={notificationError} />
            <Button disabled={sending} onClick={() => void retryNotification()}>{t("light.retryNotify")}</Button>
          </>}
          {sessionId && <Row>
            <span role="status">{t("light.notified")}</span>
            <LinkButton href={"#chat/" + sessionId} onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              const navigate = () => { onNavigate(); location.hash = "chat/" + sessionId; };
              if (view.current) view.current.flushAndClose(navigate);
              else navigate();
            }}>{t("light.viewSession")}</LinkButton>
          </Row>}
          {selectionResult && <p role="status">{displayError(selectionResult)}</p>}
          {sending && <p role="status">{t("web.loading")}</p>}
          {result &&
            (result.error ? (
              <ErrorBox error={result.message} />
            ) : (
              <p role="status">{displayError(result.message)}</p>
            ))}
        </div>
      )}
    </>
  );
}
