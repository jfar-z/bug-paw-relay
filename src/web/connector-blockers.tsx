import { useEffect, useRef, useState } from "react";
import { Button, Modal, api } from "./ui/index.js";
import { displayError, t, useLocale } from "./locale.js";

type Row = {
  executionId: string;
  sessionId: string;
  sessionTitle: string;
  projectName?: string;
  itemTitle?: string;
  stageName?: string;
  nodeStatus?: string;
  serverStatus: string;
  waitingFor?: string;
  canStop: boolean;
};
type Details = { executions: Row[]; reasons: string[]; nodeDetails: string };
const label = (key: string) => t("connector.blockers." + key);

/** 弹窗只按用户选定的环境和执行编号操作；关闭后丢弃晚到的查询结果。 */
export function ConnectorBlockers({
  environment,
  path,
  onClose,
  onReady,
  reasonText,
}: {
  environment: { id: string; name: string };
  path: string;
  onClose: () => void;
  onReady: (update: any) => void;
  reasonText: (key: string) => string;
}) {
  useLocale();
  const [details, setDetails] = useState<Details>();
  const [selected, select] = useState<Row>();
  const [stopping, setStopping] = useState("");
  const [loading, setLoading] = useState(false);
  const [endedStatus, setEndedStatus] = useState("");
  const [error, setError] = useState<{
    kind: "read" | "stop" | "gate";
    cause: unknown;
  }>();
  const generation = useRef(0);
  const refresh = async (retry = false) => {
    const token = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const result: Details = await api(path, undefined, undefined, 30000);
      if (generation.current !== token) return;
      setDetails(result);
      if (!retry) return;
      const state = await api("/state", undefined, undefined, 15000);
      if (generation.current !== token) return;
      const update = state.environments.find(
        (entry: { id: string }) => entry.id === environment.id,
      )?.connectorUpdate;
      if (
        update?.eligible &&
        update.target &&
        !result.executions.length &&
        !result.reasons.length &&
        ["available", "unsupported"].includes(result.nodeDetails)
      )
        onReady(update);
      else if (update?.blockedReason)
        setError({ kind: "gate", cause: update.blockedReason });
    } catch (cause) {
      if (generation.current === token) setError({ kind: "read", cause });
    } finally {
      if (generation.current === token) setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [path]);
  const stop = async (row: Row) => {
    select(undefined);
    setStopping(row.executionId);
    setError(undefined);
    setEndedStatus("");
    const token = generation.current;
    try {
      const result = await api(path + "/stop", {
        executionId: row.executionId,
        sessionId: row.sessionId,
      });
      if (token !== generation.current) return;
      setEndedStatus(result.status);
      await refresh();
    } catch (cause) {
      if (token === generation.current) setError({ kind: "stop", cause });
    } finally {
      setStopping("");
    }
  };
  return (
    <Modal
      title={label(details?.executions.length ? "title" : "details")}
      onClose={onClose}
    >
      <div className="connector-update-status">
        <strong>{environment.name}</strong>
        {loading && <p role="status">{label("loading")}</p>}
        {details?.executions.map((row) => {
          const status = row.nodeStatus || row.serverStatus;
          return (
            <section key={row.executionId} className="connector-update-status">
              <strong>{row.sessionTitle || row.sessionId}</strong>
              <span>
                {[row.projectName, row.itemTitle, row.stageName]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span>
                {label("execution")} · {row.executionId}
              </span>
              <span role="status">
                {label(
                  stopping === row.executionId
                    ? "stopping"
                    : status === "waiting"
                      ? row.waitingFor || "interaction"
                      : status,
                )}
              </span>
              {row.nodeStatus === "waiting" &&
                row.serverStatus === "completed" && <p>{label("mismatch")}</p>}
              <div className="connector-update-actions">
                <Button
                  onClick={() => {
                    history.replaceState(
                      { ...history.state, blockerEnvironment: environment.id },
                      "",
                    );
                    location.hash = "chat/" + row.sessionId;
                  }}
                >
                  {label("open")}
                </Button>
                <Button
                  variant="danger"
                  disabled={!row.canStop || !!stopping || loading}
                  onClick={() => select(row)}
                >
                  {label("stop")}
                </Button>
              </div>
            </section>
          );
        })}
        {details?.reasons.map((reason) => (
          <p key={reason}>{label(reason)}</p>
        ))}
        {details && details.nodeDetails !== "available" && (
          <p>
            {label(
              details.nodeDetails === "unavailable"
                ? "unidentified"
                : details.nodeDetails,
            )}
          </p>
        )}
        {details?.nodeDetails === "available" &&
          !details.executions.length &&
          !details.reasons.length && <p>{label("empty")}</p>}
        {endedStatus && (
          <p role="status">
            {label("ended")} · {label(endedStatus)}
          </p>
        )}
        {error && (
          <p role="alert">
            {error.kind === "gate" ? (
              reasonText(String(error.cause))
            ) : (
              <>
                {label(error.kind === "stop" ? "unverified" : "unidentified")}{" "}
                {displayError(error.cause)}
              </>
            )}
          </p>
        )}
        <div className="connector-update-actions">
          <Button disabled={loading || !!stopping} onClick={() => refresh()}>
            {label("refresh")}
          </Button>
          <Button
            variant="primary"
            disabled={loading || !!stopping}
            onClick={() => refresh(true)}
          >
            {label("retry")}
          </Button>
        </div>
      </div>
      {selected && (
        <Modal title={label("confirm")} onClose={() => select(undefined)}>
          <div className="connector-update-confirm">
            <strong>{selected.sessionTitle || selected.sessionId}</strong>
            <span>
              {label("execution")} · {selected.executionId}
            </span>
            <p>{label("warning")}</p>
            <div className="connector-update-actions">
              <Button data-initial-focus onClick={() => select(undefined)}>
                {reasonText("cancel")}
              </Button>
              <Button variant="danger" onClick={() => stop(selected)}>
                {label("confirm")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
