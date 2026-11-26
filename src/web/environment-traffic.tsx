import { useEffect, useState } from "react";
import {
  type TrafficHistory,
  type TrafficWindow,
  samplePeriodMs,
} from "../shared/environment-metrics.js";
import { api, pollVisible } from "./api.js";
import {
  t,
  currentLocale,
  caughtFeedback,
  displayError,
  type UiFeedback,
} from "./locale.js";
import {
  Panel,
  Sections,
  Disclosure,
  TrafficChart,
  byteAmount,
  Metadata,
  Alert,
  Button,
} from "./ui/index.js";

/** 环境与窗口切换均重建查询，卸载后的迟到结果不进入新窗口。 */
function History({
  id,
  windowSize,
}: {
  id: string;
  windowSize: TrafficWindow;
}) {
  const [data, setData] = useState<TrafficHistory>();
  const [error, setError] = useState<UiFeedback>("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    const stop = pollVisible(
      async () => {
        try {
          const history: TrafficHistory = await api(
            `/environments/${id}/traffic?window=${windowSize}`,
          );
          if (
            active &&
            history.environmentId === id &&
            history.window === windowSize
          ) {
            setData(history);
            setError("");
          }
        } catch (failure) {
          if (active) setError(caughtFeedback(failure));
        }
      },
      samplePeriodMs,
      ["online"],
    );
    return () => {
      active = false;
      stop();
    };
  }, [id, windowSize, attempt]);
  if (error)
    return (
      <Alert error title={displayError(error)}>
        <Button onClick={() => setAttempt((n) => n + 1)}>
          {t("web.retry")}
        </Button>
      </Alert>
    );
  if (!data) return <p role="status">{t("monitor.loading")}</p>;
  return (
    <>
      <Metadata
        items={[
          {
            label: t("monitor.received"),
            value:
              data.receivedBytes === null
                ? "—"
                : byteAmount(data.receivedBytes),
          },
          {
            label: t("monitor.sent"),
            value: data.sentBytes === null ? "—" : byteAmount(data.sentBytes),
          },
        ]}
      />
      <TrafficChart {...data} />
      {data.coveredMs > 0 && data.coveredMs < data.end - data.start && (
        <p>
          {t("monitor.partial", {
            minutes: new Intl.NumberFormat(currentLocale(), {
              maximumFractionDigits: 1,
            }).format(data.coveredMs / 60000),
          })}
        </p>
      )}
    </>
  );
}

export function EnvironmentTraffic({
  id,
  supported,
}: {
  id: string;
  supported: boolean;
}) {
  const [period, setPeriod] = useState<TrafficWindow>("24h");
  return (
    <Panel title={t("monitor.traffic")}>
      <Sections
        label={t("monitor.window")}
        items={(["24h", "1h", "5m"] as const).map((value) => ({
          value,
          label: t("monitor." + value),
        }))}
        value={period}
        onChange={(value) => setPeriod(value as TrafficWindow)}
      />
      {!supported && <p>{t("monitor.legacy")}</p>}
      <History key={period} id={id} windowSize={period} />
      <Disclosure label={t("monitor.scope")}>
        <p>{t("monitor.scopeDetail")}</p>
      </Disclosure>
    </Panel>
  );
}
