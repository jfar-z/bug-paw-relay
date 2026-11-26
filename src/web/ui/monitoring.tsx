import { Fragment, type ReactNode } from "react";
import type {
  TrafficHistory,
  TrafficInterval,
} from "../../shared/environment-metrics.js";
import { currentLocale, t } from "../locale.js";

/** 桌面共享列标题，窄屏逐行显示相同的字段标签。 */
export function ResponsiveList({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: string[];
  rows: { id: string; detail?: ReactNode; onOpen?: () => void; cells: ReactNode[] }[];
}) {
  return (
    <table className="ui-monitor-list" aria-label={label}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th scope="col" key={column}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Fragment key={row.id}>
            <tr
              className={row.onOpen ? "ui-monitor-openable" : undefined}
              onClick={row.onOpen && ((event) => {
                // 行内按钮和链接保留自己的操作，键盘用户可从名称按钮进入。
                if (event.target instanceof Element && !event.target.closest("button, a, input, select, textarea, label, summary, [role=button]")) {
                  row.onOpen?.();
                }
              })}
            >
              {row.cells.map((cell, index) => (
                <td key={columns[index]}>
                  <span className="ui-mobile-field" aria-hidden="true">
                    {columns[index]}
                  </span>
                  <div>{cell}</div>
                </td>
              ))}
            </tr>
            {row.detail && (
              <tr>
                <td colSpan={columns.length}>{row.detail}</td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** 缺失读数保留未知；原生仪表语义和文本同时提供百分比。 */
export function Utilization({
  value,
  label,
}: {
  value?: number | null;
  label: string;
}) {
  if (value == null) return <>{t("monitor.unknown")}</>;
  const percent = new Intl.NumberFormat(currentLocale(), {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / 100);
  return (
    <div className="ui-utilization">
      {percent}
      <meter
        min={0}
        max={100}
        value={value}
        aria-label={label}
        aria-valuetext={percent}
      />
    </div>
  );
}

const units = ["B", "kB", "MB", "GB", "TB", "PB"];
function scale(bytes: number) {
  return Math.min(
    units.length - 1,
    Math.max(0, Math.floor(Math.log10(bytes || 1) / 3)),
  );
}
function number(value: number) {
  return new Intl.NumberFormat(currentLocale(), {
    maximumSignificantDigits: 3,
  }).format(value);
}
export function byteAmount(bytes: number) {
  const index = scale(bytes);
  return number(bytes / 1000 ** index) + " " + units[index];
}

/** 水平线段代表各区间平均值；只在相邻区间之间绘制垂直连接。 */
export function TrafficChart({
  start,
  end,
  intervals,
}: Pick<TrafficHistory, "start" | "end" | "intervals">) {
  if (!intervals.length) return <p role="status">{t("monitor.empty")}</p>;
  const peak = Math.max(
    1,
    ...intervals.flatMap((i) => [
      i.receivedBytesPerSecond,
      i.sentBytesPerSecond,
    ]),
  );
  const index = scale(peak);
  const unit = units[index] + "/s";
  const x = (ms: number) => ((ms - start) / (end - start)) * 1000;
  function path(field: "receivedBytesPerSecond" | "sentBytesPerSecond") {
    return intervals
      .map((i: TrafficInterval, n) => {
        const y = 98 - (96 * i[field]) / peak;
        return (
          (intervals[n - 1]?.end === i.start ? "L" : "M") +
          x(i.start) +
          "," +
          y +
          "H" +
          x(i.end)
        );
      })
      .join(" ");
  }
  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString(currentLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <figure className="ui-traffic">
      <figcaption>
        {t("monitor.rate")} · {unit}
      </figcaption>
      <div className="ui-traffic-legend">
        <span>{t("monitor.rx")}</span>
        <span>{t("monitor.tx")}</span>
      </div>
      <div className="ui-traffic-plot">
        <div className="ui-traffic-scale">
          {[peak, peak / 2, 0].map((v) => (
            <span key={v}>{number(v / 1000 ** index)}</span>
          ))}
        </div>
        <svg
          role="img"
          aria-label={t("monitor.chart", {
            rx: byteAmount(
              Math.max(...intervals.map((i) => i.receivedBytesPerSecond)),
            ),
            tx: byteAmount(
              Math.max(...intervals.map((i) => i.sentBytesPerSecond)),
            ),
          })}
          viewBox="0 0 1000 100"
          preserveAspectRatio="none"
        >
          {[2, 50, 98].map((y) => (
            <line key={y} x1="0" x2="1000" y1={y} y2={y} />
          ))}
          <path d={path("receivedBytesPerSecond")} />
          <path d={path("sentBytesPerSecond")} />
        </svg>
      </div>
      <div className="ui-traffic-times">
        <time>{clock(start)}</time>
        <time>{clock((start + end) / 2)}</time>
        <time>{clock(end)}</time>
      </div>
    </figure>
  );
}
