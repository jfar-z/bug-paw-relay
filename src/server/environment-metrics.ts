import type { RpcPeer } from "../shared/rpc.js";
import type { DatabaseSync } from "node:sqlite";
import {
  hostSample,
  samplePeriodMs,
  maxSampleGapMs,
  windowDurationMs,
  type HostSample,
  type ResourceSummary,
  type TrafficWindow,
  type TrafficHistory,
} from "../shared/environment-metrics.js";

export interface Reading {
  at: number;
  sample: HostSample;
}

/** 任一接口回退、替换或读数丢失都会使整个区间失效。 */
function difference(previous: Reading, current: Reading) {
  const elapsed = current.sample.measuredMs - previous.sample.measuredMs;
  const wallElapsed = current.at - previous.at;
  if (
    elapsed <= 0 ||
    elapsed > maxSampleGapMs ||
    wallElapsed <= 0 ||
    wallElapsed > maxSampleGapMs
  )
    return null;
  const before = previous.sample.interfaces,
    after = current.sample.interfaces;
  if (!before || !after || !after.length || before.length !== after.length)
    return null;
  const byId = new Map(before.map((item) => [item.id, item]));
  let received = 0,
    sent = 0;
  for (const item of after) {
    const old = byId.get(item.id);
    if (!old || item.received < old.received || item.sent < old.sent)
      return null;
    byId.delete(item.id);
    received += item.received - old.received;
    sent += item.sent - old.sent;
  }
  return { received, sent, elapsed };
}

/** 服务端只保存各环境最近资源摘要和有效增量，不保存网卡身份及原始计数器。 */
export class EnvironmentMetrics {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS environment_resources(environment TEXT PRIMARY KEY, summary TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS environment_traffic(
        environment TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
        received INTEGER NOT NULL, sent INTEGER NOT NULL, elapsed INTEGER NOT NULL,
        PRIMARY KEY(environment, end)
      );
      CREATE INDEX IF NOT EXISTS environment_traffic_expiry ON environment_traffic(end);
    `);
    this.prune();
  }

  /** 调用期限短于采样周期。连接关闭时，调用方清理定时器，丢弃本连接的基线。 */
  monitor(
    id: string,
    peer: RpcPeer,
    connected: () => boolean,
    report: (reason: string) => void,
  ) {
    let previous: Reading | undefined;
    const collect = async () => {
      let stage = "rpc";
      try {
        const raw = await peer.call("environment.metrics");
        if (!connected()) return;
        stage = "validation";
        const current = { at: Date.now(), sample: hostSample.parse(raw) };
        stage = "storage";
        this.record(id, previous, current);
        previous = current;
      } catch {
        // 失败后的第一帧重新建立基线，禁止跨漏采区间计算流量。
        previous = undefined;
        if (connected()) report(stage);
      }
    };
    void collect();
    return setInterval(() => void collect(), samplePeriodMs);
  }

  prune(now = Date.now()) {
    this.db
      .prepare("DELETE FROM environment_traffic WHERE end <= ?")
      .run(now - windowDurationMs["24h"]);
  }

  summaries(): Map<string, ResourceSummary> {
    const rows = this.db
      .prepare("SELECT environment, summary FROM environment_resources")
      .all();
    return new Map(
      rows.map((row) => [
        String(row.environment),
        JSON.parse(String(row.summary)),
      ]),
    );
  }

  record(id: string, previous: Reading | undefined, current: Reading) {
    const summary: ResourceSummary = {
      ...current.sample.resources,
      sampledAt: current.at,
    };
    this.db
      .prepare("INSERT OR REPLACE INTO environment_resources VALUES (?, ?)")
      .run(id, JSON.stringify(summary));
    if (!previous) return;
    const delta = difference(previous, current);
    if (delta)
      this.db
        .prepare("INSERT INTO environment_traffic VALUES (?, ?, ?, ?, ?, ?)")
        .run(
          id,
          previous.at,
          current.at,
          delta.received,
          delta.sent,
          delta.elapsed,
        );
  }

  history(
    environmentId: string,
    window: TrafficWindow,
    end = Date.now(),
  ): TrafficHistory {
    const start = end - windowDurationMs[window];
    // 只计算完整落入窗口的区间，不假设边缘区间内字节均匀分布。
    const rows = this.db
      .prepare(
        `
      SELECT start, end, received, sent, elapsed FROM environment_traffic
      WHERE environment = ? AND end > ? AND end <= ? AND start >= ? ORDER BY end
    `,
      )
      .all(environmentId, start, end, start);
    let coveredMs = 0,
      received = 0,
      sent = 0;
    const intervals = rows.map((row) => {
      const start = Number(row.start),
        end = Number(row.end),
        seconds = Number(row.elapsed) / 1000;
      const receivedBytes = Number(row.received),
        sentBytes = Number(row.sent);
      received += receivedBytes;
      sent += sentBytes;
      coveredMs += end - start;
      return {
        start,
        end,
        receivedBytes,
        sentBytes,
        receivedBytesPerSecond: receivedBytes / seconds,
        sentBytesPerSecond: sentBytes / seconds,
      };
    });
    return {
      environmentId,
      window,
      start,
      end,
      intervals,
      coveredMs,
      receivedBytes: intervals.length ? received : null,
      sentBytes: intervals.length ? sent : null,
    };
  }
}
