import { spawn } from "node:child_process";
import { once } from "node:events";
import { validateServerUrl } from "../src/connector/config.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { token, totp } from "../src/server/security.js";
import { RpcPeer } from "../src/shared/rpc.js";

/** 临时账号只用于回归，全部请求经过真实路由和鉴权钩子。 */
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "relay-audit-"));
  const origin = "https://audit.invalid";
  const { app } = await createApp({ dataDir: dir, publicUrl: origin });
  const password = token();
  const post = (url: string, payload: any, cookie = "") =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: { origin, cookie },
    });
  await post("/api/auth/setup", {
    setupToken: readFileSync(join(dir, "setup-token"), "utf8"),
    username: "audit",
    password,
  });
  const login = (code?: string) =>
    post("/api/auth/login", { username: "audit", password, code });
  return {
    app,
    password,
    post,
    login,
    async close() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 编码路径必须与普通路径拥有相同权限，不能仅保护原始 URL 前缀。 */
test("匿名编码 API 无法读取状态、发接入码或绕过节点 Origin 检查", async () => {
  const f = await fixture();
  try {
    for (const path of [
      "/api/state",
      "/%61pi/state",
      "/a%70i/state",
      "/%61%70%69/state",
    ]) {
      assert.equal((await f.app.inject(path)).statusCode, 401, path);
    }
    assert.equal((await f.post("/%61pi/invitations", {})).statusCode, 401);
    assert.equal((await f.post("/%61pi/node/challenge", {})).statusCode, 403);
    const login = await f.login();
    const cookie = `relay_session=${login.cookies[0].value}`;
    assert.equal(
      (await f.app.inject({ url: "/%61pi/state", headers: { cookie } }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/%61pi/invitations",
          payload: {},
          headers: {
            cookie,
            origin: "http://attacker.invalid",
            host: "attacker.invalid",
          },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

/** 启用验证码在同一事务中消费，先前仅凭密码建立的会话全部作废。 */
test("启用二要素轮换当前会话、撤销其他会话并阻止验证码跨操作重放", async () => {
  const f = await fixture();
  try {
    const first = await f.login(),
      second = await f.login();
    const cookies = [first, second].map(
      (r) => `relay_session=${r.cookies[0].value}`,
    );
    const setup = await f.post(
      "/api/auth/totp/setup",
      { password: f.password },
      cookies[0],
    );
    const code = totp(setup.json().secret).generate();
    const enabled = await f.post("/api/auth/totp/enable", { code }, cookies[0]);
    assert.equal(enabled.statusCode, 200);
    const current = `relay_session=${enabled.cookies[0].value}`;
    for (const cookie of cookies) {
      assert.equal(
        (await f.app.inject({ url: "/api/state", headers: { cookie } }))
          .statusCode,
        401,
      );
      assert.equal(
        (await f.post("/api/invitations", {}, cookie)).statusCode,
        401,
      );
    }
    assert.equal(
      (await f.app.inject({ url: "/api/state", headers: { cookie: current } }))
        .statusCode,
      200,
    );
    const challenge = await f.login();
    assert.equal(challenge.json().requiresTotp, true);
    assert.equal(challenge.cookies.length, 0);
    assert.equal((await f.login("invalid")).statusCode, 401);
    assert.equal((await f.login(code)).statusCode, 401);
    assert.equal(
      (
        await f.post(
          "/api/auth/totp/disable",
          { password: f.password, code },
          current,
        )
      ).statusCode,
      403,
    );
    const future = totp(setup.json().secret).generate({
      timestamp: Date.now() + 30000,
    });
    const loggedIn = await f.login(future);
    assert.equal(loggedIn.statusCode, 200);
    assert.equal((await f.login(future)).statusCode, 401);
    assert.equal(
      (
        await f.post(
          "/api/auth/totp/disable",
          { password: f.password, code: future },
          current,
        )
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

/** 无效消息与断线竞态不能冒泡成未处理异常，正常 RPC 仍可继续。 */
test("RPC 拒绝非对象 JSON 和非法字段，响应时断线不会使进程退出", async () => {
  const handled: string[] = [],
    sent: string[] = [];
  const peer = new RpcPeer(
    (data) => sent.push(data),
    async (method) => {
      handled.push(method);
      return { ok: true };
    },
  );
  for (const value of [
    null,
    [],
    1,
    true,
    "text",
    { jsonrpc: "2.0", method: {} },
    { jsonrpc: "2.0", method: "test", id: {} },
  ]) {
    await peer.receive(JSON.stringify(value));
  }
  assert.equal(handled.length, 0);
  await peer.receive(
    JSON.stringify({ jsonrpc: "2.0", id: "valid", method: "test" }),
  );
  assert.deepEqual(JSON.parse(sent[0]).result, { ok: true });
  const disconnected = new RpcPeer(
    () => {
      throw new Error("closed");
    },
    async () => true,
  );
  await disconnected.receive(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "test" }),
  );
  peer.close();
  disconnected.close();
});

/** 不接受远程明文链路；回环 HTTP 仅保留本机开发用途。 */
test("连接器拒绝远程 HTTP 和非 HTTPS 协议", () => {
  for (const url of [
    "http://example.com",
    "http://192.168.100.5",
    "ws://example.com",
    "ftp://example.com",
  ])
    assert.throws(() => validateServerUrl(url), /HTTPS/);
  assert.equal(validateServerUrl("https://example.com").protocol, "https:");
  assert.equal(validateServerUrl("http://127.0.0.1:3180").protocol, "http:");
});

/** 通过真实回环控制台检查编码路径，不将临时访问令牌输出到日志。 */
test(
  "本机控制台的编码路径仍要求随机令牌和正确 Origin",
  { timeout: 15000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-console-audit-"));
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/connector/main.ts", "web", "--no-open"],
      {
        env: { ...process.env, BUGPAW_HOME: dir },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    try {
      const url = await new Promise<URL>((resolve, reject) => {
        let output = "";
        child.stdout.on("data", (data) => {
          output += data.toString();
          const match = output.match(
            /http:\/\/127\.0\.0\.1:\d+\/#[A-Za-z0-9_-]+/,
          );
          if (match) resolve(new URL(match[0]));
        });
        child.once("error", reject);
        child.once("exit", () => reject(new Error("控制台提前退出")));
      });
      for (const path of ["/api/config", "/%61pi/config"])
        assert.equal((await fetch(url.origin + path)).status, 400);
      const headers = { authorization: `Bearer ${url.hash.slice(1)}` };
      assert.equal(
        (await fetch(url.origin + "/%61pi/config", { headers })).status,
        200,
      );
      assert.equal(
        (
          await fetch(url.origin + "/%61pi/start", {
            method: "POST",
            headers: { ...headers, origin: "https://evil.invalid" },
          })
        ).status,
        400,
      );
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

/** 密码阶段不授予权限，挑战只能完成一次且不能绕过验证码防重放。 */
test("分步登录在验证密码后要求二要素并消费一次性挑战", async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().requiresTotp, undefined);
    const setup = await f.post(
      "/api/auth/totp/setup",
      { password: f.password },
      `relay_session=${login.cookies[0].value}`,
    );
    const secret = setup.json().secret;
    const used = totp(secret).generate();
    await f.post(
      "/api/auth/totp/enable",
      { code: used },
      `relay_session=${login.cookies[0].value}`,
    );
    const wrong = await f.post("/api/auth/login", {
      username: "audit",
      password: "wrong",
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.json().challenge, undefined);
    const first = await f.login();
    assert.equal(first.json().requiresTotp, true);
    assert.equal(first.cookies.length, 0);
    assert.equal((await f.app.inject("/api/state")).statusCode, 401);
    const challenge = first.json().challenge;
    const replay = await f.post("/api/auth/login", { challenge, code: used });
    assert.equal(replay.statusCode, 401);
    const next = totp(secret).generate({ timestamp: Date.now() + 30000 });
    const success = await f.post("/api/auth/login", { challenge, code: next });
    assert.equal(success.statusCode, 200);
    assert.equal(success.cookies.length, 1);
    assert.equal(
      (await f.post("/api/auth/login", { challenge, code: next })).json().code,
      "LOGIN_EXPIRED",
    );
  } finally {
    await f.close();
  }
});

/** 挑战连续失败后必须重新验证密码。 */
test("二要素挑战五次失败后失效", async () => {
  const f = await fixture();
  try {
    const login = await f.login();
    const cookie = `relay_session=${login.cookies[0].value}`;
    const setup = await f.post(
      "/api/auth/totp/setup",
      { password: f.password },
      cookie,
    );
    const used = totp(setup.json().secret).generate();
    await f.post("/api/auth/totp/enable", { code: used }, cookie);
    const challenge = (await f.login()).json().challenge;
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await f.post("/api/auth/login", { challenge, code: used })).json()
          .code,
        "TOTP_INVALID",
      );
    assert.equal(
      (await f.post("/api/auth/login", { challenge, code: used })).json().code,
      "LOGIN_EXPIRED",
    );
  } finally {
    await f.close();
  }
});

/** 过期或凭据发生变化的挑战不能继续建立登录会话。 */
test("二要素挑战超时失效", async (t) => {
  const f = await fixture();
  try {
    const login = await f.login();
    const cookie = `relay_session=${login.cookies[0].value}`;
    const setup = await f.post(
      "/api/auth/totp/setup",
      { password: f.password },
      cookie,
    );
    const code = totp(setup.json().secret).generate();
    await f.post("/api/auth/totp/enable", { code }, cookie);
    const challenge = (await f.login()).json().challenge;
    const later = Date.now() + 300001;
    t.mock.method(Date, "now", () => later);
    const response = await f.post("/api/auth/login", { challenge, code });
    assert.equal(response.json().code, "LOGIN_EXPIRED");
    assert.equal(response.cookies.length, 0);
  } finally {
    t.mock.restoreAll();
    await f.close();
  }
});
