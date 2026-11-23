import { ConnectorBlockers } from "./connector-blockers.js";
import { t as tr } from "./locale.js";
import { pollVisible } from "./api.js";
import { useEffect, useRef, useState } from "react";
import type { UpdateTarget } from "../shared/connector-update.js";
import { updateTerminal } from "../shared/connector-update.js";
import { api, Button, Disclosure, Modal } from "./ui/index.js";
import { ReleaseDownload } from "./release-download.js";
import { updateEn, updateZh } from "./connector-update-messages.js";
import "./ui/connector-version.css";

type Request = {
  operationId: string;
  expectedCurrentVersion: string;
  targetVersion: string;
  targetSha256: string;
};

/** 只保存非秘密的原请求，刷新后仍用同一编号查询；存储不可用时依赖服务端账本。 */
function readPending(key: string): Request | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value &&
      typeof value.operationId === "string" &&
      typeof value.expectedCurrentVersion === "string" &&
      typeof value.targetVersion === "string" &&
      /^[a-f0-9]{64}$/.test(value.targetSha256)
      ? value
      : null;
  } catch {
    return null;
  }
}

/** 环境卡片与详情共享真实更新账本；关闭弹窗不会取消或重新创建操作。 */
export function ConnectorVersion({
  environment,
  compact = false,
}: {
  environment: any;
  compact?: boolean;
}) {
  const update = environment.connectorUpdate;
  const key = `relay.connector-update.${environment.id}`;
  const [pending, setPending] = useState<Request | null>(() =>
    readPending(key),
  );
  const [operation, setOperation] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<{
    current: string;
    target: UpdateTarget;
  } | null>(null);
  const [blockers, setBlockers] = useState(history.state?.blockerEnvironment === environment.id);
  const initiated = useRef<string | null>(null);
  const closeBlockers = () => {
    if (history.state?.blockerEnvironment === environment.id)
      history.replaceState({ ...history.state, blockerEnvironment: null }, "");
    setBlockers(false);
  };
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [queryError, setQueryError] = useState(false);
  const [locale, setLocale] = useState(
    document.documentElement.lang || navigator.language,
  );
  const t = (name: string) =>
    (locale.startsWith("en") ? updateEn : updateZh)[
      name as keyof typeof updateZh
    ] ||
    (locale.startsWith("en") ? updateEn.failedRequest : updateZh.failedRequest);
  // 兼容声明可能包含未知协议或损坏字段，只展示可核实的正整数，绝不输出原始元数据。
  const safeNumber = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? new Intl.NumberFormat(locale, { useGrouping: false }).format(value)
      : t("formatUnknown");
  const currentVersion =
    update?.currentVersion || environment.connectorVersion || t("unreported");
  const showCompatibilityNotes =
    update?.eligible || update?.blockedReason === "BOOTSTRAP_REQUIRED";
  const compatibilityNotes = (
    <>
      {update?.eligible && <small>{t("compatible")}</small>}
      {update?.blockedReason === "BOOTSTRAP_REQUIRED" && (
        <small>{t("bootstrapHelp")}</small>
      )}
    </>
  );
  const compatibilityDetails = (target: UpdateTarget | undefined) => (
    <div className="connector-update-status connector-compatibility">
      <small>
        {t("currentFormat")}:{" "}
        {safeNumber(update?.compatibility?.current?.dataFormat)}
      </small>
      <small>
        {t("targetFormat")}: {safeNumber(target?.dataFormat)}
      </small>
      <small>
        {t("currentProtocol")}:{" "}
        {safeNumber(update?.compatibility?.current?.updateProtocol)}
      </small>
      <small>
        {t("targetProtocol")}: {safeNumber(target?.updateProtocol)}
      </small>
      {compatibilityNotes}
    </div>
  );
  const bytes = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: value < 1_000_000 ? "byte" : "megabyte",
      maximumFractionDigits: 2,
    }).format(value < 1_000_000 ? value : value / 1_000_000);
  const remember = (value: Request | null) => {
    setPending(value);
    try {
      value
        ? sessionStorage.setItem(key, JSON.stringify(value))
        : sessionStorage.removeItem(key);
    } catch {
      /* 隐私模式不影响服务端持久化账本。 */
    }
  };
  useEffect(() => {
    const net = () => setOnline(navigator.onLine);
    const language = new MutationObserver(() =>
      setLocale(document.documentElement.lang || navigator.language),
    );
    language.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });
    addEventListener("online", net);
    addEventListener("offline", net);
    return () => {
      language.disconnect();
      removeEventListener("online", net);
      removeEventListener("offline", net);
    };
  }, []);
  const serverOperation = update?.activeOperation || update?.latestOperation;
  // 轮询返回值优先于旧列表快照，但新的服务端操作必须取代本地旧结果。
  const current = !operation
    ? serverOperation
    : !serverOperation
      ? operation
      : operation.id === serverOperation.id
        ? serverOperation.updatedAt > operation.updatedAt
          ? serverOperation
          : operation
        : serverOperation.createdAt > operation.createdAt
          ? serverOperation
          : operation;
  const operationId =
    pending?.operationId ||
    (current && !updateTerminal(current.state) ? current.id : null);
  const path = `/environments/${environment.id}/connector-updates`;
  const check = async () => {
    if (!operationId || !navigator.onLine) return;
    try {
      const found = await api(
        `${path}/${operationId}`,
        undefined,
        undefined,
        15000,
      );
      setOperation(found);
      setQueryError(false);
      if (pending?.operationId === found.id) remember(null);
    } catch {
      setQueryError(true);
    }
  };
  useEffect(() => {
    if (!operationId || !online) return;
    let stopped = false;
    // 串行轮询防止慢网络积累请求；响应只属于挂载时的环境。
    const poll = async () => {
      try {
        const found = await api(
          `${path}/${operationId}`,
          undefined,
          undefined,
          15000,
        );
        if (stopped) return;
        setOperation(found);
        setQueryError(false);
        if (pending?.operationId === found.id) remember(null);
      } catch {
        if (!stopped) setQueryError(true);
      }
    };
    const stop = pollVisible(poll, 2500);
    return () => {
      stopped = true;
      stop();
    };
  }, [operationId, online, path]);
  const changed =
    !!snapshot &&
    (snapshot.current !== update?.currentVersion ||
      snapshot.target.version !== update?.target?.version ||
      snapshot.target.sha256 !== update?.target?.sha256);
  const active = current && !updateTerminal(current.state);
  const allowed = online && update?.eligible && !active && !pending;
  useEffect(() => {
    if (current?.id !== initiated.current || current?.state !== "failed" || current.errorCode !== "ENVIRONMENT_BUSY") return;
    initiated.current = null;
    setBlockers(true);
  }, [current?.id, current?.state, current?.errorCode]);
  const occupied = online && !active && !pending && update?.blockedReason === "ENVIRONMENT_BUSY";
  const open = () => {
    if (occupied) return setBlockers(true);
    if (!allowed || !update.target) return;
    setError("");
    setSnapshot({
      current: update.currentVersion,
      target: { ...update.target },
    });
  };
  const submit = async (original?: Request) => {
    if (
      submitting.current ||
      !navigator.onLine ||
      (!original && (!snapshot || changed || !allowed))
    )
      return;
    const request = original || {
      operationId: crypto.randomUUID(),
      expectedCurrentVersion: snapshot!.current,
      targetVersion: snapshot!.target.version,
      targetSha256: snapshot!.target.sha256,
    };
    submitting.current = true;
    setBusy(true);
    setError("");
    initiated.current = request.operationId;
    remember(request);
    try {
      const result = await api(path, request, "POST", 20000);
      setOperation(result);
      remember(null);
      setSnapshot(null);
      setQueryError(false);
    } catch (cause: any) {
      // 只有明确的业务拒绝能解除未确认请求；网络、代理及服务错误继续查询原编号。
      if (cause.status >= 400 && cause.status < 500 && cause.code) {
        remember(null);
        if (cause.code === "ENVIRONMENT_BUSY") setBlockers(true);
        else setError(cause.code);
        setSnapshot(null);
      } else {
        setSnapshot(null);
        setQueryError(true);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const warn =
    environment.online &&
    !environment.revoked &&
    ["different", "unknown"].includes(update?.status);
  const target = update?.target;
  const reported = update?.compatibility?.current;
  const comparisons = [
    [t("version"), currentVersion, target?.version || t("formatUnknown")],
    [
      t("dataFormat"),
      safeNumber(reported?.dataFormat),
      safeNumber(target?.dataFormat),
    ],
    [
      t("updateProtocol"),
      safeNumber(reported?.updateProtocol),
      safeNumber(target?.updateProtocol),
    ],
  ];
  // 成功时才创建折叠入口，进行中的记录切换到成功后自然收起。
  const record = current && (
    <section className="connector-update-status" aria-label={t("operation")}>
      <strong role="status">{t(current.state)}</strong>
      <small>
        {t("target")}: {current.target.version}
      </small>
      {current.state === "downloading" && (
        <>
          <progress
            aria-label={t("downloading")}
            value={current.downloadedBytes}
            max={current.target.size}
          />
          <small>
            {bytes(current.downloadedBytes)} / {bytes(current.target.size)}
            {" · "}
            {new Intl.NumberFormat(locale, {
              style: "percent",
              maximumFractionDigits: 1,
            }).format(current.downloadedBytes / current.target.size)}
          </small>
        </>
      )}
      <small>
        {t("operation")}: {current.id}
      </small>
      <small>
        {t("last")}: {t(current.lastConfirmedState)}
      </small>
      {current.actualVersion && (
        <small>
          {t("actual")}: {current.actualVersion}
        </small>
      )}
      <small>
        {t("updated")}:{" "}
        {new Intl.DateTimeFormat(locale, {
          dateStyle: "short",
          timeStyle: "medium",
        }).format(new Date(current.updatedAt))}
      </small>
      {current.errorCode && (
        <small role="alert">{t(current.errorCode)}</small>
      )}
      {current.state === "failed" && current.errorCode === "ENVIRONMENT_BUSY" && (
        <Button onClick={() => setBlockers(true)}>{tr("connector.blockers.details")}</Button>
      )}
      {active && <small>{t("continuing")}</small>}
    </section>
  );
  return (
    <div className="connector-version">
      {compact ? (
        <dl className="connector-version-comparison">
          {comparisons.map(([label, actualValue, targetValue]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {t("currentValue")}: <span>{actualValue}</span>
              </dd>
              <dd>
                {t("targetValue")}: <span>{targetValue}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="kv">
          <span>{t("version")}</span>
          <small>{currentVersion}</small>
        </div>
      )}
      {warn && (
        <div className="connector-version-warning" role="status">
          <p>{t(update.status === "unknown" ? "unknown" : "different")}</p>
          {(!compact || update.latestVersion !== target?.version) && (
            <small>
              {t("latest")}: {update.latestVersion}
            </small>
          )}
          {update.downloadUrl ? (
            <ReleaseDownload file={update.downloadUrl.split("/").pop()}>
              {t("download")}
            </ReleaseDownload>
          ) : (
            <small>{t("noPackage")}</small>
          )}
          <small>{t("manual")}</small>
        </div>
      )}
      {!compact && target && !warn && (
        <small>
          {t("target")}: {target.version}
        </small>
      )}
      {target && update?.compatibility?.reason && !active && (
        <small>{t("incompatible")}</small>
      )}
      {compact && showCompatibilityNotes && (
        <div className="connector-update-status">{compatibilityNotes}</div>
      )}
      {!compact && update && compatibilityDetails(target)}
      <div className="connector-update-actions">
        <Button onClick={open} disabled={(!allowed && !occupied) || busy}>
          {t(
            current?.retryable && updateTerminal(current.state)
              ? "retry"
              : "send",
          )}
        </Button>
        {!online ? (
          <small role="status">{t("offline")}</small>
        ) : (
          update?.blockedReason &&
          !active && <small>{t(update.blockedReason)}</small>
        )}
        {!update && <small>{t("PACKAGE_UNAVAILABLE")}</small>}
        {error && <small role="alert">{t(error)}</small>}
      </div>
      {pending && (
        <div className="connector-update-status" role="status">
          <p>{t("unknownResult")}</p>
          <small>
            {t("operation")}: {pending.operationId}
          </small>
          <div className="connector-update-actions">
            <Button disabled={!online || busy} onClick={check}>
              {t("recheck")}
            </Button>
            <Button disabled={!online || busy} onClick={() => submit(pending)}>
              {t("resend")}
            </Button>
          </div>
        </div>
      )}
      {compact && current?.state === "succeeded" ? (
        <Disclosure key={current.id} label={t("viewHistory")}>
          {record}
        </Disclosure>
      ) : (
        record
      )}
      {queryError && <small role="status">{t("queryError")}</small>}
      {blockers && <ConnectorBlockers environment={environment} path={path + "/blockers"}
        reasonText={t} onClose={closeBlockers} onReady={fresh => {
          closeBlockers();
          setError("");
          setSnapshot({ current: fresh.currentVersion, target: fresh.target });
        }} />}
      {snapshot && (
        <Modal
          title={t("send")}
          onClose={() => setSnapshot(null)}
          busy={busy}
          trapFocus
          closeLabel={t("close")}
        >
          <div className="connector-update-confirm">
            <dl>
              <dt>{t("environment")}</dt>
              <dd>{environment.name}</dd>
              <dt>{t("current")}</dt>
              <dd>{snapshot.current}</dd>
              <dt>{t("target")}</dt>
              <dd>{snapshot.target.version}</dd>
              <dt>{t("size")}</dt>
              <dd>{bytes(snapshot.target.size)}</dd>
            </dl>
            {compatibilityDetails(snapshot.target)}
            <p>{t("notice")}</p>
            {update?.claudeOnDemand && <p>{t("claudeOnDemand")}</p>}
            <p>{t("continuing")}</p>
            {changed && <p role="alert">{t("changed")}</p>}
            {!online && <p role="alert">{t("offline")}</p>}
            {!update?.eligible && update?.blockedReason && (
              <p role="alert">{t(update.blockedReason)}</p>
            )}
            <div className="connector-update-actions">
              <Button
                data-initial-focus
                disabled={busy}
                onClick={() => setSnapshot(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={!allowed || changed || busy}
                onClick={() => submit()}
              >
                {t("confirm")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
