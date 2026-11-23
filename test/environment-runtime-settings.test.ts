import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

test("离线工具策略按环境持久化，管理读写和目录查询受服务端校验", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-cli-settings-"));
  const origin = "http://localhost:3180";
  const options = { dataDir: dir, publicUrl: origin };
  let server = await createApp(options);
  try {
    const { app, store, service } = server;
    const token = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(token), "owner", Date.now() + 60000);
    const headers = { origin, cookie: "relay_session=" + token };
    const tools = { codex: { ready: true }, claude: { ready: false } };
    const env = store.put("environments", { approved: true, tools });
    const other = store.put("environments", { approved: true, tools });
    const url = "/api/environments/" + env.id + "/runtime-settings";
    const get = () => server.app.inject({ url, headers });
    const payload = { runtime: "codex", enabled: false };
    assert.deepEqual((await get()).json().enabledRuntimes, ["codex", "claude"]);
    assert.equal(
      (await app.inject({ method: "PATCH", url, headers: { origin }, payload }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url,
          headers,
          payload: { ...payload, enabled: 1 },
        })
      ).statusCode,
      400,
    );
    assert.deepEqual((await get()).json().enabledRuntimes, ["codex", "claude"]);
    assert.deepEqual(
      (await app.inject({ method: "PATCH", url, headers, payload })).json(),
      {
        enabledRuntimes: ["claude"],
        tools,
      },
    );
    const directory = {
      environmentId: env.id,
      rootId: "root",
      relativePath: ".",
    };
    const project = service.save("projects", {
      name: "测试",
      directories: [directory],
    });
    assert.throws(
      () =>
        service.createSession({
          ...directory,
          projectId: project.id,
          runtime: "codex",
          title: "会话",
        }),
      { code: "CLI_DISABLED" },
    );
    const catalog = await app.inject({
      method: "POST",
      url: url.replace("settings", "catalog"),
      headers,
      payload: { runtime: "codex" },
    });
    assert.equal(catalog.statusCode, 409);
    assert.equal(catalog.json().code, "CLI_DISABLED");
    // 重连会上报新的探测结果，服务端策略仍独立生效。
    store.put(
      "environments",
      { tools: { ...tools, codex: { ready: false } } },
      env.id,
    );
    const environments = service.list("environments");
    assert.deepEqual(environments.find((e) => e.id === env.id)?.tools, {
      claude: tools.claude,
    });
    assert.deepEqual(environments.find((e) => e.id === other.id)?.tools, tools);
    await app.close();
    server = await createApp(options);
    assert.deepEqual((await get()).json().enabledRuntimes, ["claude"]);
    const patch = (runtime: string, enabled: boolean) =>
      server.app.inject({
        method: "PATCH",
        url,
        headers,
        payload: { runtime, enabled },
      });
    assert.deepEqual((await patch("claude", false)).json().enabledRuntimes, []);
    assert.deepEqual(server.service.list("environments")[0].tools, {});
    assert.deepEqual((await patch("codex", true)).json().tools.codex, {
      ready: false,
    });
  } finally {
    await server.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("原生 Claude 会话固定入口，目录、禁用策略与 SDK 分流由服务端校验", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-native-claude-"));
  const origin = "http://localhost:3180";
  const { app, store, service } = await createApp({ dataDir: dir, publicUrl: origin });
  try {
    const token = randomUUID();
    store.db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)").run(digest(token), "owner", Date.now() + 60000);
    const headers = { origin, cookie: "relay_session=" + token };
    let mode = "environment";
    const env = store.put("environments", { approved: true, capabilities: ["claude-terminal-v1"] });
    const directory = { environmentId: env.id, rootId: "work", relativePath: "." };
    const project = service.save("projects", { name: "terminal", directories: [directory] });
    const data = { ...directory, projectId: project.id, runtime: "claude", title: "Claude" };
    const calls: string[] = [];
    service.peers.set(env.id, { close() {}, call: async (method: string) => {
      calls.push(method);
      return method === "claude.settings" ? { mode, available: true, version: "1" } : { ok: true };
    }} as any);
    const create = (agentId?: string) => app.inject({ method: "POST", url: "/api/sessions", headers, payload: { ...data, agentId } });
    const native = (await create()).json();
    assert.equal(native.claudeMode, "environment");
    mode = "custom";
    assert.equal((await create()).json().code, "AGENT_REQUIRED");
    const custom = (await create(service.save("agents", { name: "Claude" }).id)).json();
    assert.equal(custom.claudeMode, undefined);
    const open = (id: string) => app.inject({ method: "POST", url: "/api/sessions/" + id + "/terminal",
      headers, payload: { action: "open", rows: 30, cols: 80 } });
    assert.equal((await open(native.id)).statusCode, 200);
    assert.equal((await open(custom.id)).statusCode, 403);
    await assert.rejects(service.send(native.id, randomUUID(), "task"), { code: "NATIVE_TERMINAL" });
    service.setRuntimeEnabled(env.id, "claude", false);
    assert.equal((await open(native.id)).statusCode, 409);
    service.setRuntimeEnabled(env.id, "claude", true);
    store.put("projects", { directories: [] }, project.id);
    assert.equal((await open(native.id)).statusCode, 403);
    assert.equal(calls.filter((v) => v === "claude.terminal").length, 1);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SDK 安装按环境鉴权、校验能力且断线后查询不重放", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-sdk-api-"));
  const origin = "http://localhost:3180";
  const { app, store, service } = await createApp({ dataDir: dir, publicUrl: origin });
  try {
    const token = randomUUID();
    store.db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)").run(digest(token), "owner", Date.now() + 60000);
    const headers = { origin, cookie: "relay_session=" + token };
    const env = store.put("environments", { approved: false });
    const url = "/api/environments/" + env.id + "/claude-sdk";
    const post = () => app.inject({ method: "POST", url, headers, payload: {} });
    assert.equal((await app.inject({ method: "POST", url, headers: { origin }, payload: {} })).statusCode, 401);
    assert.equal((await post()).json().code, "FORBIDDEN");
    store.put("environments", { approved: true, revoked: true }, env.id);
    assert.equal((await post()).json().code, "REVOKED");
    store.put("environments", { revoked: false }, env.id);
    assert.equal((await post()).json().code, "OFFLINE");
    const calls: string[] = [];
    const snapshot = { state: "missing", mode: "custom", installing: false, version: "0.3.322" };
    service.peers.set(env.id, { close() {}, async call(method: string) {
      calls.push(method);
      if (method === "claude.sdk.install") throw Error("transport closed");
      return snapshot;
    }} as any);
    assert.equal((await post()).json().code, "CONNECTOR_UPGRADE");
    store.put("environments", { capabilities: ["claude-sdk-install-v1"] }, env.id);
    service.setRuntimeEnabled(env.id, "claude", false);
    assert.equal((await post()).json().code, "CLI_DISABLED");
    service.setRuntimeEnabled(env.id, "claude", true);
    assert.equal((await app.inject({ method: "POST", url, headers, payload: { version: "latest" } })).statusCode, 400);
    assert.deepEqual(calls, []);
    assert.equal((await post()).json().code, "STATUS_UNKNOWN");
    assert.deepEqual((await app.inject({ url, headers })).json(), snapshot);
    assert.deepEqual(calls, ["claude.sdk.install", "claude.sdk.status"]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
