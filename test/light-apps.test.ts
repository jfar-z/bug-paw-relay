import test from "node:test";
import { runInNewContext } from "node:vm";
import { storageScript } from "../src/server/light-document.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/server/app.js";
import { createLightHost } from "../src/server/light-host.js";
import { EnvironmentFiles } from "../src/connector/files.js";
import { digest } from "../src/server/security.js";

test("发布、重试、独立服务、按版反馈和登录撤销共用真实文件和数据库", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "light-apps-"));
  const origin = "https://main.example.test",
    domain = "apps.example.test",
    key = randomUUID();
  const f = await createApp({
    dataDir: join(dir, "main"),
    publicUrl: origin,
    light: { domain, hostUrl: "", key },
  });
  t.after(() => f.app.close());
  const mainUrl = await f.app.listen({ port: 0 });
  const { app: host, internal } = await createLightHost({
    domain,
    key,
    mainOrigin: origin,
    mainUrl,
    database: join(dir, "host", "apps.db"),
  });
  t.after(() => host.close());
  t.after(() => internal.close());
  // 关闭数据库后释放临时目录，兼容 Windows 文件占用规则。
  t.after(() => rm(dir, { recursive: true, force: true }));
  f.light.config.hostUrl = await internal.listen({ port: 0 });
  const env = f.store.put("environments", {
    approved: true,
    capabilities: ["light-apps-v1"],
  });
  const root = join(dir, "root");
  await mkdir(root);
  await writeFile(join(root, "index.html"), "<script src='app.js'></script>");
  await writeFile(join(root, "app.js"), "document.title='ok'");
  const reader = new EnvironmentFiles(() => [{ id: "root", path: root }]);
  const peer: any = { call: reader.call.bind(reader), close() {} };
  f.service.peers.set(env.id, peer);
  const session = f.store.put("sessions", {
    environmentId: env.id,
    rootId: "root",
    relativePath: ".",
    projectId: randomUUID(),
  });
  const executionId = randomUUID();
  f.store.db
    .prepare("INSERT INTO executions VALUES(?,NULL,?,?,'running','{}',?)")
    .run(executionId, session.id, env.id, new Date().toISOString());
  const args = {
    operationId: randomUUID(),
    title: "应用",
    entry: "index.html",
    files: ["index.html", "app.js"],
  };
  const publish = (overrides = {}) =>
    f.light.agent("light.publish", env.id, peer, {
      executionId,
      args: { ...args, ...overrides },
    });
  const v = (await publish()) as {
    versionId: string;
    appId: string;
    number: number;
  };
  const agent = (method: string, args: unknown, execution = executionId) =>
    f.light.agent(method, env.id, peer, { executionId: execution, args });
  await assert.rejects(agent("light.versions", {}), { code: "LIGHT_UPGRADE" });
  f.store.put(
    "environments",
    { capabilities: ["light-apps-v1", "light-apps-v2"] },
    env.id,
  );
  assert.deepEqual(
    await agent("light.publish.status", { operationId: args.operationId }),
    v,
  );
  assert.deepEqual(await publish(), v);
  for (const [overrides, reason] of [
    [{ operationId: "invalid" }, /operationId/],
    [{ directory: "/dist" }, /directory/],
    [{ files: ["manifest.webmanifest"] }, /manifest\.webmanifest/],
    [{ files: ["missing.js"] }, /missing\.js/],
    [{ title: undefined }, /title/],
  ] as const)
    await assert.rejects(
      publish({ operationId: randomUUID(), ...overrides }),
      reason,
    );
  await assert.rejects(publish({ title: "different" }), {
    code: "LIGHT_CONFLICT",
  });
  await symlink(join(root, "index.html"), join(root, "alias.html"));
  await assert.rejects(
    publish({ operationId: randomUUID(), files: ["index.html", "alias.html"] }),
    { code: "LIGHT_FILE" },
  );
  assert.equal(f.store.list("lightVersions").length, 1);
  const cookie = randomUUID();
  f.store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const headers = { origin, cookie: "relay_session=" + cookie };
  const open = () =>
    f.app.inject({
      method: "POST",
      url: "/api/light-versions/" + v.versionId + "/open",
      headers,
    });
  const list = (listed: boolean) =>
    f.app.inject({
      method: "PUT",
      url: "/api/light-apps/" + v.appId + "/listing",
      headers,
      payload: { listed },
    });
  const ticket = (await open()).json();
  assert.equal(
    ticket.action,
    "https://" + domain + "/v/" + v.versionId + "/_open",
  );
  const hostHeaders = { host: new URL(ticket.action).hostname, origin };
  const redeem = () =>
    host.inject({
      method: "POST",
      url: new URL(ticket.action).pathname,
      headers: {
        ...hostHeaders,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({ ticket: ticket.ticket }).toString(),
    });
  const feedback = (originHeader = origin) =>
    f.app.inject({
      method: "POST",
      url: "/api/light-versions/" + v.versionId + "/feedback",
      headers: { ...headers, origin: originHeader },
      payload: { viewId: ticket.viewId, kind: "confirmed" },
    });
  assert.equal((await feedback()).statusCode, 401);
  const grant = await redeem();
  assert.equal(grant.statusCode, 303, grant.body);
  assert.equal((await redeem()).statusCode, 401);
  const asset = (assetCookie: string, hostName = hostHeaders.host) =>
    host.inject({
      url: "/v/" + v.versionId + "/app.js",
      headers: {
        host: hostName,
        cookie: assetCookie,
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
      },
    });
  const access = grant.cookies[0].name + "=" + grant.cookies[0].value;
  assert.equal((await asset("")).statusCode, 401);
  assert.equal((await asset(access)).body, "document.title='ok'");
  assert.equal(
    (await asset(access, randomUUID() + "." + domain)).statusCode,
    401,
  );
  assert.equal(
    (
      await host.inject({
        url: "/internal/versions/" + v.versionId,
        headers: hostHeaders,
      })
    ).statusCode,
    404,
  );
  const rootUrl = "/v/" + v.versionId + "/";
  assert.equal(grant.headers.location, rootUrl);
  assert.equal(grant.cookies[0].path, rootUrl);
  const rootResponse = await host.inject({
    url: rootUrl,
    headers: {
      host: domain,
      cookie: access,
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
    },
  });
  assert.match(
    String(rootResponse.headers["content-security-policy"]),
    /^sandbox allow-scripts;/,
  );
  assert.equal(rootResponse.headers["cache-control"], "no-store");
  const documentTicket = JSON.parse(
    rootResponse.body.match(
      /<script id="light-input" type="application\/json">([^<]+)<\/script>/,
    )![1],
  );
  const runtime = (action: string, body = {}, viewId = ticket.viewId, version = v.versionId) =>
    f.app.inject({
      method: "POST", url: "/api/light-versions/" + version + "/" + action, headers,
      payload: { viewId, ...body },
    });
  await assert.rejects(agent("light.docs", {}), { code: "LIGHT_UPGRADE" });
  f.store.put("environments", { capabilities: ["light-apps-v1", "light-apps-v2", "light-apps-v4"] }, env.id);
  const docs = await agent("light.docs", { topic: "debugging" }) as any;
  assert.equal(docs.csp.replaceAll("https://RESOURCE-HOST/v/VERSION/_files/SLOT/", documentTicket.prefix), rootResponse.headers["content-security-policy"]);
  assert.match(docs.storageScript, /function installLightStorage/);
  assert.equal((await runtime("storage", { changes: [["score", "1"]] }, randomUUID())).statusCode, 401);
  assert.equal((await runtime("storage", { changes: [["score", "1"], ["__proto__", "2"]] })).statusCode, 204);
  assert.equal((await runtime("storage", { changes: [["score", "3"]] })).statusCode, 204);
  assert.equal((await runtime("storage", { changes: [["score", "x".repeat(1048576)]] })).statusCode, 413);
  const snapshot = (await runtime("snapshot")).json();
  assert.deepEqual(snapshot, { quota: 1048576, entries: [["score", "3"], ["__proto__", "2"]] });
  const error = {kind: "storage", message: "QuotaExceededError", file: "", line: 0, column: 0};
  for (let i = 0; i < 2; i++)
    assert.equal((await runtime("diagnostics", {error})).statusCode, 204);
  const diagnostics = await agent("light.feedback", {versionId: v.versionId}) as any;
  assert.equal(diagnostics.feedback.length, 0);
  assert.equal(diagnostics.runtimeErrors.length, 1);
  assert.equal(diagnostics.runtimeErrors[0].count, 2);
  const slot = new URL(documentTicket.prefix).pathname;
  const seed = () =>
    host.inject({
      method: "POST",
      url: slot + "_session",
      headers: { host: domain, origin: "null" },
      payload: { ticket: documentTicket.ticket },
    });
  const resourceGrant = await seed();
  assert.equal(resourceGrant.statusCode, 204);
  assert.equal((await seed()).statusCode, 401);
  const resource = (url: string) =>
    host.inject({
      url,
      headers: {
        host: domain,
        origin: "null",
        cookie:
          resourceGrant.cookies[0].name + "=" + resourceGrant.cookies[0].value,
      },
    });
  assert.equal((await resource(slot + "app.js")).body, "document.title='ok'");
  assert.equal((await resource(slot + "absent.js")).statusCode, 404);
  assert.equal(
    (await resource(slot.replace(v.versionId, randomUUID()) + "app.js"))
      .statusCode,
    401,
  );
  assert.equal((await feedback("https://" + hostHeaders.host)).statusCode, 403);
  assert.equal((await feedback()).json().versionId, v.versionId);
  assert.equal((await list(false)).json().listed, false);
  assert.equal((await asset(access)).statusCode, 410);
  assert.equal((await resource(slot + "app.js")).statusCode, 410);
  const next = (await publish({
    appId: v.appId,
    title: undefined,
    entry: undefined,
    files: undefined,
    operationId: randomUUID(),
  })) as typeof v;
  assert.equal(next.number, 2);
  const twin = (await agent("light.publish", {
    title: args.title,
    operationId: randomUUID(),
  })) as typeof v;
  assert.notEqual(twin.appId, v.appId);
  const { apps } = (await agent("light.versions", { appId: v.appId })) as any;
  assert.deepEqual(apps[0].versions.map((v: any) => v.runtimeErrorCount), [2, 0]);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].listed, false);
  assert.equal(apps[0].title, args.title);
  assert.deepEqual(
    apps[0].versions.map((v: any) => [v.number, v.feedbackCount]),
    [
      [1, 1],
      [2, 0],
    ],
  );
  const other = f.store.put("sessions", {
    environmentId: env.id,
    projectId: session.projectId,
  });
  const otherExecution = randomUUID();
  f.store.db
    .prepare("INSERT INTO executions VALUES(?,NULL,?,?,'running','{}',?)")
    .run(otherExecution, other.id, env.id, new Date().toISOString());
  assert.deepEqual(await agent("light.versions", {}, otherExecution), {
    apps: [],
  });
  await assert.rejects(
    agent("light.feedback", { versionId: v.versionId }, otherExecution),
    { code: "LIGHT_SCOPE" },
  );
  await assert.rejects(
    agent(
      "light.publish",
      { appId: v.appId, operationId: randomUUID() },
      otherExecution,
    ),
    { code: "LIGHT_SCOPE" },
  );
  assert.equal((await open()).statusCode, 410);
  const restored = (await list(true)).json();
  assert.equal(restored.latestVersionId, next.versionId);
  assert.equal((await asset(access)).statusCode, 401);
  const fresh = (await open()).json();
  const newGrant = await host.inject({
    method: "POST",
    url: new URL(ticket.action).pathname,
    headers: hostHeaders,
    payload: { ticket: fresh.ticket },
  });
  assert.deepEqual((await runtime("snapshot", {}, fresh.viewId)).json(), snapshot);
  assert.equal((await runtime("snapshot", {}, fresh.viewId, next.versionId)).statusCode, 401);
  const active = newGrant.cookies[0].name + "=" + newGrant.cookies[0].value;
  const action = (method: string, appId = v.appId) => agent(method, { appId });
  const decision = (appId: string, confirmationId: string, approve: boolean) =>
    f.app.inject({
      method: "POST",
      url: "/api/light-apps/" + appId + "/decision",
      headers,
      payload: { confirmationId, approve },
    });
  const manager = (appId: string) =>
    f.app.inject({
      method: "POST",
      url: "/api/light-apps/" + appId + "/delete-request",
      headers,
    });
  await assert.rejects(action("light.unlist"), { code: "LIGHT_UPGRADE" });
  f.store.put(
    "environments",
    { capabilities: ["light-apps-v1", "light-apps-v2", "light-apps-v3"] },
    env.id,
  );
  await assert.rejects(
    agent("light.delete", { appId: v.appId }, otherExecution),
    { code: "LIGHT_SCOPE" },
  );
  const request = (await action("light.unlist")) as any;
  assert.equal(request.status, "pendingConfirmation");
  assert.equal(
    (await decision(v.appId, request.id, false)).json().status,
    "cancelled",
  );
  assert.equal((await asset(active)).statusCode, 200);
  f.store.put("sessions", { permission: "full" }, session.id);
  f.store.db
    .prepare("UPDATE executions SET snapshot=? WHERE id=?")
    .run(JSON.stringify({ permission: "full" }), executionId);
  assert.equal(
    ((await action("light.unlist", twin.appId)) as any).status,
    "unlisted",
  );
  assert.equal(
    ((await action("light.unlist", twin.appId)) as any).status,
    "alreadyUnlisted",
  );
  // 即便执行快照允许写，当前阶段收回权限后也不能确认已提交的申请。
  const stageId = randomUUID();
  const stage = {
    id: stageId,
    type: "agent",
    permission: "full",
    allowArtifacts: true,
  };
  const board = f.store.put("boards", {
    projectId: session.projectId,
    stages: [stage],
  });
  const item = f.store.put("items", {
    stageId,
    boardId: board.id,
    executionId,
  });
  f.store.db
    .prepare("UPDATE executions SET item_id=?,snapshot=? WHERE id=?")
    .run(item.id, JSON.stringify({ stage }), executionId);
  f.store.put("lightApps", { itemId: item.id }, twin.appId);
  const boardRequest = (await action("light.delete", twin.appId)) as any;
  f.store.put(
    "boards",
    { stages: [{ ...stage, allowArtifacts: false }] },
    board.id,
  );
  assert.equal(
    (await decision(twin.appId, boardRequest.id, true)).statusCode,
    403,
  );
  await assert.rejects(action("light.unlist", twin.appId), {
    code: "LIGHT_SCOPE",
  });
  assert.equal(
    ((await agent("light.versions", { appId: twin.appId })) as any).apps.length,
    1,
  );
  assert.equal(
    (await decision(twin.appId, boardRequest.id, false)).json().status,
    "cancelled",
  );
  f.store.db
    .prepare("UPDATE executions SET item_id=NULL,snapshot=? WHERE id=?")
    .run(JSON.stringify({ permission: "full" }), executionId);
  f.store.put("lightApps", { itemId: null }, twin.appId);
  const pending = (await action("light.delete", twin.appId)) as any;
  assert.equal(pending.status, "pendingConfirmation");
  assert.equal(
    (await decision(twin.appId, pending.id, false)).json().status,
    "cancelled",
  );
  const stale = (await action("light.delete", twin.appId)) as any;
  await publish({ appId: twin.appId, operationId: randomUUID() });
  assert.equal(
    (await decision(twin.appId, stale.id, true)).json().code,
    "LIGHT_SCOPE_CHANGED",
  );
  const confirmed = (await action("light.delete", twin.appId)) as any;
  assert.equal(confirmed.versionCount, 2);
  const hostUrl = f.light.config.hostUrl;
  f.light.config.hostUrl = "";
  assert.equal(
    (await decision(twin.appId, confirmed.id, true)).json().status,
    "cleanupIncomplete",
  );
  f.light.config.hostUrl = hostUrl;
  assert.equal(
    ((await action("light.delete", twin.appId)) as any).status,
    "deleted",
  );
  assert.equal(
    ((await action("light.delete", twin.appId)) as any).status,
    "alreadyDeleted",
  );
  const late = await internal.inject({
    method: "PUT",
    url: "/internal/versions/" + randomUUID(),
    headers: { authorization: "Bearer " + key },
    payload: { appId: twin.appId, assets: { "index.html": "YQ==" } },
  });
  assert.equal(late.statusCode, 410);
  assert.deepEqual(await agent("light.versions", { appId: twin.appId }), {
    apps: [],
  });
  await assert.rejects(agent("light.feedback", { versionId: twin.versionId }), {
    code: "LIGHT_DELETED",
  });
  await assert.rejects(
    publish({ appId: twin.appId, operationId: randomUUID() }),
    { code: "LIGHT_DELETED" },
  );
  f.service.peers.delete(env.id);
  await rm(root, { recursive: true });
  assert.equal((await asset(active)).statusCode, 200);
  assert.equal((await resource(slot + "app.js")).statusCode, 401);
  const another = (await open()).json();
  const close = () =>
    f.app.inject({
      method: "POST",
      url: "/api/light-versions/" + v.versionId + "/close",
      headers,
      payload: { viewId: another.viewId },
    });
  assert.equal((await close()).statusCode, 204);
  assert.equal((await close()).statusCode, 204);
  assert.equal(
    (
      await host.inject({
        method: "POST",
        url: new URL(another.action).pathname,
        headers: hostHeaders,
        payload: { ticket: another.ticket },
      })
    ).statusCode,
    401,
  );
  // 关闭已兑换的视图立即撤销反馈与内容权限，同版本的其他打开操作独立。
  const closing = (await open()).json();
  const opened = await host.inject({
    method: "POST",
    url: new URL(closing.action).pathname,
    headers: hostHeaders,
    payload: { ticket: closing.ticket },
  });
  const closingAccess = opened.cookies[0].name + "=" + opened.cookies[0].value;
  assert.equal((await asset(closingAccess)).statusCode, 200);
  await f.app.inject({
    method: "POST",
    url: "/api/light-versions/" + v.versionId + "/close",
    headers,
    payload: { viewId: closing.viewId },
  });
  assert.equal((await asset(closingAccess)).statusCode, 401);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/light-versions/" + v.versionId + "/feedback",
        headers,
        payload: { viewId: closing.viewId, kind: "selection", text: "A" },
      })
    ).statusCode,
    401,
  );
  assert.equal((await asset(active)).statusCode, 200);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.tick(3600001);
  assert.equal((await asset(active)).statusCode, 401);
  t.mock.timers.reset();
  const preparation = (await manager(v.appId)).json();
  const denied = await f.app.inject({
    method: "POST",
    url: "/api/light-apps/" + v.appId + "/decision",
    headers: { origin },
    payload: { confirmationId: preparation.id, approve: true },
  });
  assert.equal(denied.statusCode, 401);
  const deleted = decision(v.appId, preparation.id, true);
  assert.equal((await deleted).json().status, "deleted");
  assert.equal(f.store.findBy("lightStorage", "versionId", v.versionId).length, 0);
  assert.equal(f.store.findBy("lightDiagnostics", "versionId", v.versionId).length, 0);
  assert.equal(
    (await decision(v.appId, preparation.id, true)).json().status,
    "alreadyDeleted",
  );
  assert.equal((await list(true)).statusCode, 410);
  assert.equal((await open()).statusCode, 410);
  assert.equal(f.store.list("lightFeedback").length, 0);
  const history = await f.app.inject({
    url: "/api/light-versions?appId=" + v.appId,
    headers,
  });
  assert.deepEqual(
    history.json().map((v: any) => v.deletion),
    ["deleted", "deleted"],
  );
  for (const version of [v, next, twin]) {
    const response = await internal.inject({
      url: "/internal/versions/" + version.versionId,
      headers: { authorization: "Bearer " + key },
    });
    assert.equal(response.statusCode, 503);
  }
  await f.app.inject({ method: "POST", url: "/api/auth/logout", headers });
  assert.equal((await asset(active)).statusCode, 401);
});

test("注入脚本同步恢复存档并按键批量提交，超限保留原值", () => {
  const events: any[] = [];
  const window = new EventTarget() as EventTarget & { localStorage: Storage };
  const document = new EventTarget();
  runInNewContext(storageScript + '\ninstallLightStorage(snapshot, send, prefix);', {
    window, document, DOMException, location: { href: "https://example.test/" },
    snapshot: { entries: [["x", "1"]], quota: 5 }, prefix: "https://example.test/assets/",
    send: (data: unknown) => events.push(data), setTimeout, clearTimeout,
  });
  const storage = window.localStorage;
  assert.equal(storage.length, 1);
  assert.equal(storage.key(0), "x");
  assert.equal(storage.getItem("x"), "1");
  storage.setItem("a", "😀");
  assert.throws(() => storage.setItem("a", "private"), { name: "QuotaExceededError" });
  assert.equal(storage.getItem("a"), "😀");
  storage.removeItem("x");
  storage.clear();
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(storage.length, 0);
  assert.equal(events[0].error.message, "QuotaExceededError");
  assert.ok(!JSON.stringify(events).includes("private"));
  assert.deepEqual(JSON.parse(JSON.stringify(events[1].changes)), [["a", null], ["x", null]]);
});
