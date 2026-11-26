import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  EnvironmentMetrics,
  type Reading,
} from "../src/server/environment-metrics.js";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import { metricsCapability } from "../src/shared/environment-metrics.js";

const minute = 60_000;
const now = Date.now();
function reading(
  n: number,
  received = n * 600_000,
  sent = n * 120_000,
  id = "physical",
): Reading {
  return {
    at: now + n * minute,
    sample: {
      measuredMs: n * minute,
      resources: { cpuPercent: null, memoryPercent: 20, disk: null },
      interfaces: [{ id, received, sent }],
    },
  };
}

test("三种窗口同源汇总，窗口边缘、空环境及过期数据不参与", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const metrics = new EnvironmentMetrics(db);
    let previous;
    for (let n = 0; n <= 1441; ++n) {
      const current = reading(n);
      metrics.record("one", previous, current);
      previous = current;
    }
    const end = previous!.at;
    for (const [window, count] of [
      ["5m", 5],
      ["1h", 60],
      ["24h", 1440],
    ] as const) {
      const result = metrics.history("one", window, end);
      assert.equal(result.coveredMs, count * minute);
      assert.equal(result.receivedBytes, count * 600_000);
      assert.equal(result.sentBytes, count * 120_000);
      assert.equal(result.intervals.length, count);
      assert.ok(
        result.intervals.every(
          (i) =>
            i.receivedBytesPerSecond === 10_000 &&
            i.sentBytesPerSecond === 2000,
        ),
      );
    }
    assert.equal(
      metrics.history("one", "5m", end + 1).receivedBytes,
      2_400_000,
    );
    assert.equal(metrics.history("other", "5m", end).receivedBytes, null);
    metrics.prune(end);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM environment_traffic").get()?.n,
      1440,
    );
  } finally {
    db.close();
  }
});

test("中断、漏采、接口重置或替换均形成缺口，真实零和采集耗时独立保留", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const metrics = new EnvironmentMetrics(db);
    const sequence = [
      reading(0),
      reading(1, 0, 0),
      reading(2, 0, 2),
      reading(3, 1, 1),
      reading(4, 1, 2, "other"),
      reading(6, 5, 4, "other"),
      reading(7),
      reading(8),
      reading(9),
    ];
    sequence[2].sample.measuredMs += 1000;
    sequence[7].sample.interfaces = null;
    for (const [index, current] of sequence.entries()) {
      metrics.record(
        "one",
        index === 6 ? undefined : sequence[index - 1],
        current,
      );
    }
    const history = metrics.history("one", "1h", sequence.at(-1)!.at);
    assert.equal(history.coveredMs, 2 * minute);
    assert.equal(history.intervals[0].receivedBytesPerSecond, 0);
    assert.equal(history.intervals[1].sentBytesPerSecond, 2 / 61);
    assert.equal(history.receivedBytes, 0);
    assert.equal(history.sentBytes, 2);
  } finally {
    db.close();
  }
});

test("登录后按环境读取离线历史，旧能力没有资源摘要，历史不进入全局状态", async () => {
  const dir = mkdtempSync(join(tmpdir(), "environment-metrics-"));
  const { app, service, store } = await createApp({
    dataDir: dir,
    publicUrl: "http://localhost",
  });
  try {
    const env = store.put("environments", {
      approved: true,
      capabilities: [metricsCapability],
    });
    const token = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(token), "owner", Date.now() + minute);
    const url = "/api/environments/" + env.id + "/traffic";
    const get = (path: string) =>
      app.inject({ url: path, cookies: { relay_session: token } });
    const a = reading(0),
      b = reading(1);
    a.at -= 2 * minute;
    b.at -= 2 * minute;
    service.metrics.record(env.id, a, b);
    assert.equal((await app.inject({ url })).statusCode, 401);
    assert.equal((await get(url + "?window=1d")).statusCode, 400);
    const history = (await get(url)).json();
    assert.equal(history.window, "24h");
    assert.equal(history.sentBytes, 120_000);
    const summary = (await get("/api/state")).json().environments[0];
    assert.equal(summary.online, false);
    assert.equal(summary.resources.sampledAt, b.at);
    assert.equal(summary.resources.cpuPercent, null);
    assert.ok(!("intervals" in summary));
    store.put("environments", { capabilities: [] }, env.id);
    assert.equal(
      (await get("/api/state")).json().environments[0].resources,
      null,
    );
    assert.equal((await get(url)).json().receivedBytes, 600_000);
    store.put("environments", { revoked: true }, env.id);
    assert.equal((await get(url)).statusCode, 403);
    assert.equal(
      (await get("/api/environments/" + randomUUID() + "/traffic")).statusCode,
      404,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
