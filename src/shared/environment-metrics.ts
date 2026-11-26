import { z } from "zod";

export const metricsCapability = "environment-metrics-v1";
export const samplePeriodMs = 60_000;
export const maxSampleGapMs = 90_000;
export const trafficWindow = z.enum(["5m", "1h", "24h"]);
export type TrafficWindow = z.infer<typeof trafficWindow>;
export const windowDurationMs = {
  "5m": 300_000,
  "1h": 3_600_000,
  "24h": 86_400_000,
};

/** 仅传输计数器和资源摘要。null 表示无法取得该项读数。 */
const counter = z.number().int().nonnegative();
const percent = z.number().min(0).max(100).nullable();
export const resourcesSchema = z.object({
  cpuPercent: percent,
  memoryPercent: percent,
  disk: z
    .object({ volume: z.string().min(1).max(4096), availableBytes: counter })
    .nullable()
    .catch(null),
});
export const hostSample = z.object({
  resources: resourcesSchema,
  measuredMs: counter,
  interfaces: z
    .array(
      z.object({
        id: z.string().min(1).max(256),
        received: counter,
        sent: counter,
      }),
    )
    .min(1)
    .max(256)
    .nullable()
    .catch(null),
});
export type HostSample = z.infer<typeof hostSample>;
export type ResourceSummary = z.infer<typeof resourcesSchema> & {
  sampledAt: number;
};
export interface TrafficInterval {
  start: number;
  end: number;
  receivedBytes: number;
  sentBytes: number;
  receivedBytesPerSecond: number;
  sentBytesPerSecond: number;
}
export interface TrafficHistory {
  environmentId: string;
  window: TrafficWindow;
  start: number;
  end: number;
  coveredMs: number;
  receivedBytes: number | null;
  sentBytes: number | null;
  intervals: TrafficInterval[];
}
