import { monitorEventLoopDelay } from "node:perf_hooks";
/** 关闭文本仅使用白名单，未知远端内容不得进入日志。 */
export function closeCategory(code: number, reason: string) {
  if (code === 4003) return "revoked";
  if (code === 4001) return "authentication_timeout";
  if (code === 1000) return "normal_close";
  if (reason === "identity revoked") return "revoked";
  return code === 1006 ? "abnormal_close" : "network_close";
}
/** 单调时钟计时；摘要按分钟聚合，未关联的 pong 不伪造 RTT。 */
export class ConnectionDiagnostics {
  private histogram = monitorEventLoopDelay({ resolution: 20 });
  private started = performance.now();
  private lastPing: number | null = null;
  private lastPong: number | null = null;
  private pingAt: string | null = null;
  private pongAt: string | null = null;
  private peerPingAt: string | null = null;
  private payload = "";
  private rtt: number | null = null;
  private timer: NodeJS.Timeout;
  private warningTimer: NodeJS.Timeout;
  private warnings = new Map<string, number>();
  constructor(private write: (event: string, fields: any) => void) {
    this.histogram.enable();
    this.warningTimer = setInterval(() => {
      if (this.histogram.max / 1e6 >= 1000)
        this.warn("event_loop.delay", {
          ...this.snapshot(),
          thresholdMs: 1000,
        });
    }, 1000);
    this.warningTimer.unref();
    this.timer = setInterval(() => {
      this.write("connection.summary", this.snapshot());
      this.histogram.reset();
    }, 60000);
    this.timer.unref();
  }
  receivedPing() {
    this.peerPingAt = new Date().toISOString();
  }
  ping() {
    this.lastPing = performance.now();
    this.pingAt = new Date().toISOString();
    this.payload = String(this.lastPing);
    return this.payload;
  }
  pong(payload: string) {
    this.lastPong = performance.now();
    this.pongAt = new Date().toISOString();
    this.rtt =
      this.lastPing !== null && payload === this.payload
        ? this.lastPong - this.lastPing
        : null;
    if ((this.rtt ?? 0) >= 2000) this.warn("heartbeat.delay", this.snapshot());
  }
  warn(event: string, fields: any) {
    const now = performance.now();
    if (now - (this.warnings.get(event) ?? -Infinity) < 60000) return;
    this.warnings.set(event, now);
    this.write(event, fields);
  }
  snapshot() {
    const now = performance.now();
    return {
      durationMs: now - this.started,
      lastPingAt: this.pingAt,
      lastPeerPingAt: this.peerPingAt,
      lastPongAt: this.pongAt,
      sincePongMs: this.lastPong === null ? null : now - this.lastPong,
      unansweredMs:
        this.lastPing !== null &&
        (this.lastPong === null || this.lastPing > this.lastPong)
          ? now - this.lastPing
          : 0,
      rttMs: this.rtt,
      loopP95Ms: this.histogram.percentile(95) / 1e6,
      loopMaxMs: this.histogram.max / 1e6,
      sampleWindowMs: 60000,
      heartbeatIntervalMs: 20000,
    };
  }
  close() {
    clearInterval(this.warningTimer);
    clearInterval(this.timer);
    this.histogram.disable();
  }
}
