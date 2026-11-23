import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { RunState } from "@openai/agents";
import { Store } from "../src/server/store.js";
import { Vault } from "../src/server/security.js";
import { Service } from "../src/server/service.js";
import { Workbench } from "../src/server/workbench.js";

/** 独立临时存储与假模型，避免连接真实供应商。 */
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "relay-followup-"));
  const store = new Store(join(dir, "test.db"));
  const service = new Service(store, new Vault(dir));
  const bench = new Workbench(service);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, service, bench };
}

test("SEC-10 逐项决定持久化，拒绝重复/未知/过期审批，全部完成才恢复", async (t) => {
  const { store, bench } = fixture(t);
  const w = store.put("workbench", {
    status: "approval",
    state: "fixture",
    transcript: [],
    approvals: ["a", "b"].map((callId) => ({ callId })),
    modelSnapshot: {},
  });
  let runs = 0;
  const decisions: any[] = [];
  t.mock.method(bench, "agent", () => ({}));
  t.mock.method(bench, "run", async () => {
    runs++;
  });
  t.mock.method(RunState, "fromString", async () => ({
    getInterruptions: () =>
      ["b", "a"].map((callId) => ({ rawItem: { callId } })),
    approve: (i: any) => decisions.push([i.rawItem.callId, true]),
    reject: (i: any) => decisions.push([i.rawItem.callId, false]),
    toString: (): string => "updated",
  }));
  for (const callIds of [["a", "a"], ["missing"]])
    await assert.rejects(
      bench.approve(w.id, { version: w.version, approve: true, callIds }),
      /审批项/,
    );
  await bench.approve(w.id, {
    version: w.version,
    approve: false,
    callIds: ["a"],
  });
  assert.equal(runs, 0);
  let current = store.get("workbench", w.id);
  assert.equal(current.approvals[0].decision, false);
  await assert.rejects(
    bench.approve(w.id, { version: w.version, approve: true }),
    /审批已/,
  );
  await assert.rejects(
    bench.approve(w.id, {
      version: current.version,
      approve: true,
      callIds: ["a"],
    }),
    /审批项/,
  );
  await bench.approve(w.id, { version: current.version, approve: true });
  assert.equal(runs, 1);
  assert.deepEqual(decisions, [
    ["b", true],
    ["a", false],
  ]);
});

test("SEC-11 中断后修改权限不改变恢复快照，下一 prompt 使用新权限", async (t) => {
  const { store, bench } = fixture(t);
  const model = store.put("models", { contextLimit: 10000 });
  const w = store.put("workbench", {
    status: "interrupted",
    state: "fixture",
    modelId: model.id,
    modelSnapshot: model,
    permission: "ask",
    permissionSnapshot: "ask",
    transcript: [],
    history: [],
  });
  const seen: string[] = [];
  t.mock.method(bench, "agent", (w: any) => {
    seen.push(w.permission);
    return {};
  });
  t.mock.method(bench, "model", () => ({}));
  t.mock.method(bench, "run", async () => {});
  t.mock.method(RunState, "fromString", async () => ({}));
  bench.configure(w.id, { modelId: model.id, permission: "full" });
  await bench.resume(w.id);
  assert.deepEqual(seen, ["ask"]);
  assert.equal(store.get("workbench", w.id).permission, "full");
  store.put("workbench", { status: "idle" }, w.id);
  await bench.start(w.id, { message: "next", operationId: randomUUID() });
  assert.equal(store.get("workbench", w.id).permissionSnapshot, "full");
});

test("SEC-12 幂等绑定消息和图片，旧操作跨轮重试不重复执行", async (t) => {
  const { store, bench } = fixture(t);
  const model = store.put("models", { contextLimit: 10000 });
  const w = store.put("workbench", {
    status: "idle",
    modelId: model.id,
    permission: "ask",
    transcript: [],
    history: [],
  });
  let runs = 0;
  t.mock.method(bench, "model", () => ({}));
  t.mock.method(bench, "run", async () => {
    runs++;
  });
  const input = {
    message: "A",
    operationId: randomUUID(),
    images: ["data:image/png;base64,YQ=="],
  };
  await bench.start(w.id, input);
  await bench.start(w.id, input);
  assert.equal(runs, 1);
  await assert.rejects(
    bench.start(w.id, { ...input, message: "B" }),
    /相同操作/,
  );
  await assert.rejects(
    bench.start(w.id, { ...input, images: ["data:image/png;base64,Yg=="] }),
    /相同操作/,
  );
  store.put("workbench", { status: "idle" }, w.id);
  await bench.start(w.id, { message: "next", operationId: randomUUID() });
  await bench.start(w.id, input);
  assert.equal(runs, 2);
});

test("SEC-13 通知发送异常仍持久化撤销并清除 peer", async (t) => {
  const { createApp } = await import("../src/server/app.js");
  const { digest } = await import("../src/server/security.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-revoke-"));
  const { app, store, service } = await createApp({
    dataDir: dir,
    publicUrl: "http://localhost",
  });
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const cookie = randomUUID();
  store.db
    .prepare("INSERT INTO auth_sessions(hash,owner,expires) VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 60000);
  const env = store.put("environments", { approved: true });
  let closed = false;
  service.peers.set(env.id, {
    notify() {
      throw Error("fake send failure");
    },
    close() {
      closed = true;
    },
  } as any);
  const result = await app.inject({
    method: "POST",
    url: `/api/environments/${env.id}/revoke`,
    headers: { origin: "http://localhost", cookie: "relay_session=" + cookie },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(store.get("environments", env.id).revoked, true);
  assert.equal(closed, true);
  assert.equal(service.peers.has(env.id), false);
});

test("SEC-14 UUID、空操作 body、目录长度与未知字段统一拒绝", async (t) => {
  const { createApp } = await import("../src/server/app.js");
  const { digest } = await import("../src/server/security.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-validation-"));
  const { app, store } = await createApp({
    dataDir: dir,
    publicUrl: "http://localhost",
  });
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const cookie = randomUUID();
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 60000);
  const headers = {
    origin: "http://localhost",
    cookie: "relay_session=" + cookie,
  };
  for (const url of [
    "/api/workbench/invalid",
    "/api/workbench/invalid/send",
    "/api/environments/invalid/revoke",
  ]) {
    const r = await app.inject({
      method: url.endsWith("invalid") ? "GET" : "POST",
      url,
      headers,
      payload: url.endsWith("invalid") ? undefined : {},
    });
    assert.equal(r.statusCode, 400, r.body);
  }
  const id = randomUUID();
  for (const payload of [
    { environmentId: "bad", rootId: "root" },
    { environmentId: id, rootId: "r".repeat(257) },
    { environmentId: id, rootId: "r", relativePath: "x".repeat(4097) },
    { environmentId: id, rootId: "r", extra: true },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/directory/list",
          headers,
          payload,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/workbench/${id}/resume`,
        headers,
        payload: { extra: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: `/api/workbench/${id}`, headers })).statusCode,
    404,
  );
});

test("SEC-17 主应用响应限制脚本、嵌入、表单及对象来源", async (t) => {
  const { createApp } = await import("../src/server/app.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-csp-"));
  const { app } = await createApp({
    dataDir: dir,
    publicUrl: "http://localhost",
  });
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const response = await app.inject("/api/health");
  const csp = response.headers["content-security-policy"] as string;
  for (const directive of [
    "script-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ])
    assert.ok(csp.includes(directive));
  assert.ok(!csp.includes("unsafe-eval"));
});
