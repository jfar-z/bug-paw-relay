import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorConfig } from "../src/connector/config.js";
import {
  environmentModelConfig,
  modelTools,
} from "../src/connector/model-tools.js";

/** 本机协议桩覆盖真实请求和凭据边界，不使用真实供应商额度。 */
test("连接器模型查询与测试：协议、分页、密钥隔离和错误脱敏", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-model-tools-"));
  const settings = new ConnectorConfig(dir);
  const app = Fastify();
  const calls: any[] = [];
  app.all("/*", async (req, reply) => {
    calls.push({ url: req.url, headers: req.headers, body: req.body });
    if (req.url.startsWith("/denied"))
      return reply.code(401).send({ message: "fixture-secret" });
    if (req.url.startsWith("/redirect")) return reply.redirect("/proxy/models");
    if (req.url.startsWith("/html"))
      return reply.type("text/html").send("<html>login</html>");
    if (req.url.startsWith("/invalid")) return {};
    if (req.url.startsWith("/large"))
      return { data: "x".repeat(3 * 1024 * 1024) };
    if (req.url.includes("/models"))
      return {
        data: [
          { id: req.url.includes("after_id") ? "model-b" : "model-a" },
          { id: "model-a" },
          {},
        ],
        has_more: req.url.includes("/v1/") && !req.url.includes("after_id"),
        last_id: "model-a",
      };
    if (req.url.endsWith("/messages"))
      return { type: "message", content: [{ type: "text", text: "OK" }] };
    return { object: "response", status: "completed", output: [] };
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  try {
    settings.update({
      serverUrl: base,
      codex: {
        baseUrl: base + "/proxy/",
        apiKey: "fixture-secret",
        model: "saved",
      },
    });
    const saved = readFileSync(settings.file, "utf8");
    const draft = {
      provider: "codex",
      baseUrl: base + "/proxy",
      model: "draft-model",
    };
    assert.deepEqual(await modelTools(settings, draft, "models"), {
      models: ["model-a"],
    });
    assert.equal(calls.at(-1).headers.authorization, "Bearer fixture-secret");
    assert.equal(calls.at(-1).url, "/proxy/models");
    assert.equal(
      (await modelTools(settings, draft, "test"))?.protocol,
      "Responses",
    );
    assert.equal(calls.at(-1).body.model, "draft-model");
    assert.equal(calls.at(-1).body.store, false);
    assert.equal(calls.at(-1).url, "/proxy/responses");
    const count = calls.length;
    await assert.rejects(
      modelTools(settings, { ...draft, baseUrl: base + "/new" }, "models"),
      /重新填写/,
    );
    assert.equal(calls.length, count);
    const claude = {
      provider: "claude",
      baseUrl: base + "/anthropic",
      apiKey: "fixture-new",
      model: "claude-fixture",
    };
    assert.deepEqual(await modelTools(settings, claude, "models"), {
      models: ["model-a", "model-b"],
    });
    assert.equal(calls.at(-1).headers["x-api-key"], "fixture-new");
    assert.equal(calls.at(-1).headers["anthropic-version"], "2023-06-01");
    assert.equal(
      (await modelTools(settings, { ...claude, authType: "bearer" }, "test"))
        ?.protocol,
      "Messages",
    );
    assert.equal(calls.at(-1).headers.authorization, "Bearer fixture-new");
    assert.equal(calls.at(-1).headers["x-api-key"], undefined);
    assert.equal(calls.at(-1).url, "/anthropic/v1/messages");
    for (const [path, error] of [
      ["denied", /HTTP 401/],
      ["redirect", /重定向/],
      ["html", /JSON/],
      ["invalid", /有效模型列表/],
      ["large", /响应过大/],
    ] as const) {
      await assert.rejects(
        modelTools(
          settings,
          { ...draft, baseUrl: base + "/" + path, apiKey: "fixture-secret" },
          "models",
        ),
        (e: Error) =>
          error.test(e.message) && !e.message.includes("fixture-secret"),
      );
    }
    await assert.rejects(
      modelTools(settings, { ...draft, model: "" }, "test"),
      /选择模型/,
    );
    await assert.rejects(
      modelTools(
        settings,
        { ...draft, baseUrl: "https://user:password@example.com" },
        "models",
      ),
      /不能包含账号/,
    );
    await assert.rejects(
      modelTools(
        settings,
        { ...draft, baseUrl: "file:///etc/passwd" },
        "models",
      ),
      /HTTP/,
    );
    assert.equal(readFileSync(settings.file, "utf8"), saved);
    assert.equal(settings.public().codex.apiKey, "");
    const codexBefore = settings.read().codex;
    for (const authType of ["key", "bearer"] as const) {
      const input = { ...claude, authType };
      const summary = await environmentModelConfig(settings, "save", input);
      assert.deepEqual(summary, {
        provider: "claude",
        baseUrl: input.baseUrl,
        model: input.model,
        authType,
        hasKey: true,
        customEndpoint: true,
      });
      assert.deepEqual(
        await environmentModelConfig(settings, "read", input),
        summary,
      );
      assert.equal(settings.runtime().claude.apiKey, input.apiKey);
      assert.ok(!readFileSync(settings.file, "utf8").includes(input.apiKey));
      const before = readFileSync(settings.file, "utf8");
      const reuse = { ...input, apiKey: "" };
      await environmentModelConfig(settings, "test", reuse);
      assert.equal(
        calls.at(-1).headers[
          authType === "key" ? "x-api-key" : "authorization"
        ],
        authType === "key" ? input.apiKey : "Bearer " + input.apiKey,
      );
      assert.throws(
        () =>
          environmentModelConfig(settings, "save", {
            ...reuse,
            authType: authType === "key" ? "bearer" : "key",
          }),
        /重新填写/,
      );
      assert.throws(
        () =>
          environmentModelConfig(settings, "save", { ...reuse, baseUrl: base }),
        /重新填写/,
      );
      assert.equal(readFileSync(settings.file, "utf8"), before);
      assert.deepEqual(settings.read().codex, codexBefore);
    }
    await environmentModelConfig(settings, "save", draft);
    assert.equal(settings.runtime().codex.model, draft.model);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** HTTP 派发前检查身份与能力，发送后无回执则由用户重新查询实际配置。 */
test("远程模型配置权限、能力与回执边界", async () => {
  const { createApp } = await import("../src/server/app.js");
  const { digest } = await import("../src/server/security.js");
  const { randomUUID } = await import("node:crypto");
  const { AppError } = await import("../src/shared/contracts.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-model-route-"));
  const origin = "https://relay.example";
  const { app, store, service } = await createApp({
    dataDir: dir,
    publicUrl: origin,
  });
  try {
    const token = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(token), "owner", Date.now() + 60000);
    const env = store.put("environments", {
      approved: true,
      capabilities: [],
      tools: {
        claude: {
          available: false,
          version: "test",
          messageKey: "connector.runtime.claudeConfig",
        },
      },
    });
    const draft = {
      provider: "claude",
      baseUrl: "https://provider.example",
      model: "demo",
      apiKey: randomUUID(),
    };
    const call = (operation: string, payload: any, cookie: string = token) =>
      app.inject({
        method: "POST",
        url: `/api/environments/${env.id}/model-config/${operation}`,
        headers: { origin, cookie: "relay_session=" + cookie },
        payload,
      });
    assert.equal((await call("save", draft, "anonymous")).statusCode, 401);
    assert.equal((await call("save", draft)).json().code, "OFFLINE");
    const settings = new ConnectorConfig(join(dir, "node"));
    settings.update({ serverUrl: origin });
    let calls = 0;
    let drop = false;
    service.peers.set(env.id, {
      call: async (method: string, { operation, input }: any) => {
        assert.equal(method, "environment.modelConfig");
        calls++;
        const result = await environmentModelConfig(settings, operation, input);
        if (drop) throw new AppError("OFFLINE", "offline");
        return result;
      },
    } as any);
    assert.equal((await call("save", draft)).json().code, "CONNECTOR_UPGRADE");
    store.put(
      "environments",
      { capabilities: ["environment-model-config-v1"], approved: false },
      env.id,
    );
    assert.equal((await call("save", draft)).statusCode, 403);
    assert.equal(calls, 0);
    store.put("environments", { approved: true }, env.id);
    drop = true;
    assert.equal((await call("save", draft)).json().code, "STATUS_UNKNOWN");
    drop = false;
    const actual = await call("read", { provider: "claude" });
    assert.equal(actual.json().hasKey, true);
    assert.equal(
      store.get("environments", env.id).tools.claude.available,
      true,
    );
    assert.ok(!actual.body.includes(draft.apiKey));
    assert.equal(calls, 2);
    store.put("environments", { revoked: true }, env.id);
    assert.equal(
      (await call("read", { provider: "claude" })).json().code,
      "REVOKED",
    );
    assert.equal(calls, 2);
    service.peers.delete(env.id);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
