import { RpcPeer } from "../src/shared/rpc.js";
import { AppError } from "../src/shared/contracts.js";
import { ConnectorStore } from "../src/connector/store.js";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { createApp } from "../src/server/app.js";
import { digest, token } from "../src/server/security.js";
import { ConnectorConfig } from "../src/connector/config.js";
import {
  nodeAuthVersion,
  nodeProofText,
  registrationDigest,
} from "../src/shared/node-identity.js";

/** 每例使用独立数据库和真实套接字，不读取部署环境身份。 */
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "relay-node-security-"));
  const options = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    secureCookie: false,
  };
  const instance = await createApp(options);
  await instance.app.listen({ host: "127.0.0.1", port: 0 });
  options.publicUrl +=
    ":" + (instance.app.server.address() as { port: number }).port;
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const sockets: WebSocket[] = [];
  function invite() {
    const code = token();
    instance.store.db
      .prepare("INSERT INTO invitations VALUES(?,?,0)")
      .run(digest(code), Date.now() + 600000);
    return code;
  }
  async function connect() {
    const ws = new WebSocket(
      options.publicUrl.replace("http", "ws") + "/api/node/connect",
    );
    sockets.push(ws);
    const [raw] = await once(ws, "message");
    const challenge = JSON.parse(raw.toString()).params;
    return { ws, challenge };
  }
  async function request(
    ws: WebSocket,
    params: any,
    method = "identity.authenticate",
  ) {
    const response = once(ws, "message");
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: token(), method, params }));
    return JSON.parse((await response)[0].toString());
  }
  function proof(id: string, nonce: string, origin = options.publicUrl) {
    return {
      authVersion: nodeAuthVersion,
      environmentId: id,
      signature: sign(
        null,
        Buffer.from(nodeProofText(origin, "connect", id, publicKey, "", nonce)),
        keys.privateKey,
      ).toString("base64"),
      protocol: 1,
      roots: [],
      tools: {},
      platform: "test",
    };
  }
  return {
    ...instance,
    dir,
    options,
    keys,
    publicKey,
    invite,
    connect,
    request,
    proof,
    async close() {
      for (const ws of sockets) ws.terminate();
      await instance.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 注册证明覆盖所有申请字段，失败挑战和成功挑战都不能再次消费。 */
test("注册拒绝无签名、篡改、错误用途和重放，接入码仅消费一次", async () => {
  const f = await fixture();
  try {
    const input = {
      code: f.invite(),
      name: "测试环境",
      publicKey: f.publicKey,
    };
    const post = (url: string, payload: any) =>
      f.app.inject({ method: "POST", url, payload });
    const issue = async () => (await post("/api/node/challenge", input)).json();
    const signed = (c: any, purpose: "register" | "connect" = "register") => ({
      ...input,
      authVersion: nodeAuthVersion,
      challenge: c.challenge,
      signature: sign(
        null,
        Buffer.from(
          nodeProofText(
            f.options.publicUrl,
            purpose,
            "",
            input.publicKey,
            registrationDigest(input),
            c.challenge,
          ),
        ),
        f.keys.privateKey,
      ).toString("base64"),
    });
    assert.equal((await post("/api/node/register", input)).statusCode, 400);
    let c = await issue();
    assert.equal(
      (await post("/api/node/register", { ...signed(c), name: "被替换" }))
        .statusCode,
      403,
    );
    assert.equal((await post("/api/node/register", signed(c))).statusCode, 403);
    c = await issue();
    assert.equal(
      (await post("/api/node/register", signed(c, "connect"))).statusCode,
      403,
    );
    c = await issue();
    const second = await issue();
    const response = await post("/api/node/register", signed(c));
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().approved, false);
    assert.equal((await post("/api/node/register", signed(c))).statusCode, 403);
    assert.equal(
      (await post("/api/node/register", signed(second))).statusCode,
      403,
    );
    assert.equal((await post("/api/node/challenge", input)).statusCode, 403);
  } finally {
    await f.close();
  }
});

test("新版连接器完成真实注册，私钥加密且不会在服务端保存", async () => {
  const f = await fixture();
  try {
    const config = new ConnectorConfig(join(f.dir, "client"));
    config.save({
      ...config.read(),
      serverUrl: f.options.publicUrl,
      roots: [{ id: "work", path: f.dir }],
    });
    await config.register(f.invite());
    const local = config.read();
    assert.ok(local.environmentId);
    assert.ok(!local.privateKey.includes("PRIVATE KEY"));
    assert.equal(
      f.store.get("environments", local.environmentId).privateKey,
      undefined,
    );
  } finally {
    await f.close();
  }
});

test("节点入口拒绝浏览器 Origin，连接使用独立限流且不信任伪造转发头", async () => {
  const f = await fixture();
  try {
    for (const origin of [
      "https://evil.invalid",
      f.options.publicUrl,
      "null",
      "",
    ]) {
      assert.equal(
        (await f.app.inject({ url: "/api/node/connect", headers: { origin } }))
          .statusCode,
        403,
      );
    }
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/node/challenge",
          headers: { origin: f.options.publicUrl },
          payload: {},
        })
      ).statusCode,
      403,
    );
    let response;
    for (let i = 0; i < 65; i++)
      response = await f.app.inject({
        url: "/api/node/connect",
        headers: { "x-forwarded-for": `192.0.2.${i}` },
      });
    assert.equal(response!.statusCode, 429);
    assert.equal((await f.app.inject({ url: "/api/health" })).statusCode, 200);
  } finally {
    await f.close();
  }
});

test("连接证明拒绝跨服务端、跨连接重放和旧版降级，未审批或已撤销身份不可连接", async () => {
  const f = await fixture();
  f.service.reconcile = async () => {};
  try {
    const env = f.store.put("environments", {
      name: "test",
      publicKey: f.publicKey,
      approved: true,
      revoked: false,
    });
    const first = await f.connect();
    assert.equal(
      (
        await f.request(
          first.ws,
          f.proof(env.id, first.challenge.challenge, "https://other.invalid"),
        )
      ).error.data.code,
      "SIGNATURE_INVALID",
    );
    assert.equal(
      (await f.request(first.ws, f.proof(env.id, first.challenge.challenge)))
        .error.data.code,
      "UNAUTHENTICATED",
    );
    const second = await f.connect();
    assert.equal(
      (await f.request(second.ws, f.proof(env.id, first.challenge.challenge)))
        .error.data.code,
      "SIGNATURE_INVALID",
    );
    const legacy = await f.connect();
    const old: any = f.proof(env.id, legacy.challenge.challenge);
    delete old.authVersion;
    assert.ok((await f.request(legacy.ws, old)).error);
    for (const state of [
      { approved: false, revoked: false },
      { approved: true, revoked: true },
    ]) {
      f.store.put("environments", state, env.id);
      const c = await f.connect();
      assert.equal(
        (await f.request(c.ws, f.proof(env.id, c.challenge.challenge))).error
          .data.code,
        state.revoked ? "REVOKED" : "PENDING",
      );
    }
  } finally {
    await f.close();
  }
});

test("对账中立即占用身份名额，旧连接退出不会释放新连接名额", async () => {
  const f = await fixture();
  const resolvers: (() => void)[] = [];
  f.service.reconcile = async () =>
    new Promise<void>((resolve) => resolvers.push(resolve));
  try {
    const env = f.store.put("environments", {
      name: "test",
      publicKey: f.publicKey,
      approved: true,
      revoked: false,
    });
    const first = await f.connect();
    assert.ok(
      (await f.request(first.ws, f.proof(env.id, first.challenge.challenge)))
        .result.ok,
    );
    const second = await f.connect();
    assert.equal(
      (await f.request(second.ws, f.proof(env.id, second.challenge.challenge)))
        .error.data.code,
      "DUPLICATE_CONNECTION",
    );
    assert.equal(f.service.peers.has(env.id), false);
    first.ws.close();
    await once(first.ws, "close");
    const third = await f.connect();
    assert.ok(
      (await f.request(third.ws, f.proof(env.id, third.challenge.challenge)))
        .result.ok,
    );
    for (const resolve of resolvers) resolve();
    const fourth = await f.connect();
    assert.equal(
      (await f.request(fourth.ws, f.proof(env.id, fourth.challenge.challenge)))
        .error.data.code,
      "DUPLICATE_CONNECTION",
    );
  } finally {
    for (const resolve of resolvers) resolve();
    await f.close();
  }
});

/** 超时校验独立于事件循环定时器，避免繁忙进程接受过期证明。 */
test("注册挑战与连接挑战过期后均拒绝认证", async () => {
  const f = await fixture();
  const now = Date.now;
  try {
    const input = {
      code: f.invite(),
      name: "过期验证",
      publicKey: f.publicKey,
    };
    const c = (
      await f.app.inject({
        method: "POST",
        url: "/api/node/challenge",
        payload: input,
      })
    ).json();
    const env = f.store.put("environments", {
      name: "test",
      publicKey: f.publicKey,
      approved: true,
    });
    const connection = await f.connect();
    Date.now = () => now() + 61000;
    const signature = sign(
      null,
      Buffer.from(
        nodeProofText(
          f.options.publicUrl,
          "register",
          "",
          input.publicKey,
          registrationDigest(input),
          c.challenge,
        ),
      ),
      f.keys.privateKey,
    ).toString("base64");
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/node/register",
          payload: {
            ...input,
            challenge: c.challenge,
            signature,
            authVersion: nodeAuthVersion,
          },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.request(
          connection.ws,
          f.proof(env.id, connection.challenge.challenge),
        )
      ).error.data.code,
      "CHALLENGE_EXPIRED",
    );
  } finally {
    Date.now = now;
    await f.close();
  }
});

test("对账失败释放名额，认证中撤销会断开连接且不能被迟到对账恢复", async () => {
  const f = await fixture();
  try {
    const env = f.store.put("environments", {
      name: "test",
      publicKey: f.publicKey,
      approved: true,
      revoked: false,
    });
    f.service.reconcile = async () => {
      throw new Error("fixture reconciliation failure");
    };
    const first = await f.connect();
    const closed = once(first.ws, "close");
    assert.ok(
      (await f.request(first.ws, f.proof(env.id, first.challenge.challenge)))
        .result.ok,
    );
    await closed;
    let finish!: () => void;
    f.service.reconcile = async () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const second = await f.connect();
    assert.ok(
      (await f.request(second.ws, f.proof(env.id, second.challenge.challenge)))
        .result.ok,
    );
    const cookie = token();
    f.store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(cookie), "owner", Date.now() + 60000);
    const revoked = once(second.ws, "close");
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/environments/${env.id}/revoke`,
          headers: {
            origin: f.options.publicUrl,
            cookie: `relay_session=${cookie}`,
          },
        })
      ).statusCode,
      200,
    );
    await revoked;
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.service.peers.has(env.id), false);
  } finally {
    await f.close();
  }
});

/** 启动真正的连接器子进程，验证新版服务端与客户端握手契约一致。 */
test(
  "真实连接器注册、批准后通过上下文签名建立连接",
  { timeout: 20000 },
  async (t) => {
    const f = await fixture();
    let child: ReturnType<typeof spawn> | undefined;
    const requests: string[] = [];
    const provider = createServer((req, res) => {
      requests.push(req.url || "");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url === "/models"
            ? { data: [{ id: "local-model" }] }
            : { object: "response", status: "completed", output: [] },
        ),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const baseUrl =
      "http://127.0.0.1:" + (provider.address() as { port: number }).port;
    f.service.reconcile = async () => {};
    try {
      const config = new ConnectorConfig(join(f.dir, "worker-client"));
      config.save({
        ...config.read(),
        serverUrl: f.options.publicUrl,
        codex: {
          command: "fixture-no-codex",
          baseUrl,
          model: "",
          apiKey: config.vault.seal(token()),
        },
        roots: [{ id: "work", path: f.dir }],
      });
      await config.register(f.invite());
      const id = config.read().environmentId;
      f.store.put("environments", { approved: true }, id);
      child = spawn(
        process.execPath,
        ["--import", "tsx", "src/connector/main.ts", "run"],
        { env: { ...process.env, BUGPAW_HOME: config.dir }, stdio: "ignore" },
      );
      const deadline = Date.now() + 10000;
      while (
        !f.service.peers.has(id) &&
        Date.now() < deadline &&
        child.exitCode === null
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.ok(f.service.peers.has(id), "真实连接器应通过身份认证");
      // 服务端进程禁止发起 fetch，只有子进程能访问测试供应商。
      t.mock.method(globalThis, "fetch", () => {
        throw new Error("unexpected server fetch");
      });
      const session = token();
      f.store.db
        .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
        .run(digest(session), "owner", Date.now() + 60000);
      const input = { provider: "codex", baseUrl, model: "local-model" };
      const call = (operation: string) =>
        f.app.inject({
          method: "POST",
          url: `/api/environments/${id}/model-config/${operation}`,
          headers: {
            origin: f.options.publicUrl,
            cookie: "relay_session=" + session,
          },
          payload: input,
        });
      assert.deepEqual((await call("models")).json(), {
        models: ["local-model"],
      });
      assert.equal((await call("test")).json().protocol, "Responses");
      assert.deepEqual(requests, ["/models", "/responses"]);
      assert.equal(config.read().codex.model, "");
      assert.equal((await call("save")).json().model, "local-model");
      assert.equal(config.runtime().codex.model, "local-model");
    } finally {
      provider.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
      await f.close();
    }
  },
);

/** 匿名连接可发送任意文本，畸形消息之后服务和鉴权必须继续有效。 */
test("匿名 WebSocket 发送 null 和其他畸形消息不会终止服务", async () => {
  const f = await fixture();
  try {
    const { ws } = await f.connect();
    for (const raw of ["null", "[]", "1", "true", '"text"', "{bad"])
      ws.send(raw);
    const response = await f.request(ws, {}, "directory.list");
    assert.equal(response.error.data.code, "UNAUTHENTICATED");
    assert.equal((await f.app.inject("/api/health")).statusCode, 200);
  } finally {
    await f.close();
  }
});

/** 同一调用栈按线序投递帧，确保认证响应和相邻请求之间没有事件循环空隙。 */
test("RPC 连续帧按认证响应前后的顺序派发业务", async () => {
  function connection() {
    let authenticated = false;
    let executions = 0;
    const outbound = new Map<string, any>();
    const peer = new RpcPeer(
      (raw) => {
        const frame = JSON.parse(raw);
        outbound.set(frame.id, frame);
      },
      async () => {
        if (!authenticated) throw new AppError("UNAUTHENTICATED", "未认证", 401);
        return ++executions;
      },
    );
    async function authenticate(timeout?: number) {
      await peer.call("identity.authenticate", {}, timeout);
      authenticated = true;
    }
    const deliver = (frame: object) =>
      peer.receive(JSON.stringify({ jsonrpc: "2.0", ...frame }));
    const request = (id: string) => deliver({ method: "business", id });
    const authId = () =>
      [...outbound.values()].find((frame) => frame.method === "identity.authenticate").id;
    const denied = (id: string) => {
      assert.equal(outbound.get(id)?.error?.data.status, 401);
      assert.equal(outbound.get(id)?.error?.data.code, "UNAUTHENTICATED");
    };
    return {
      peer, authenticate, deliver, request, authId, denied, outbound,
      executions: () => executions,
    };
  }

  for (const phase of ["首次连接", "重连"]) {
    const c = connection();
    const auth = c.authenticate();
    const before = c.request("before");
    const reply = c.deliver({ id: c.authId(), result: { ok: true } });
    const after = c.request("after");
    await Promise.all([before, reply, after, auth]);
    c.denied("before");
    assert.deepEqual(c.outbound.get("after"), { jsonrpc: "2.0", id: "after", result: 1 }, phase);
    assert.equal(c.executions(), 1);
    c.peer.close();
  }

  for (const reason of ["拒绝", "超时", "替换"] as const) {
    const old = connection();
    const rejected = assert.rejects(
      old.authenticate(reason === "超时" ? 0 : undefined),
      { code: { "拒绝": "RPC_ERROR", "超时": "STATUS_UNKNOWN", "替换": "OFFLINE" }[reason] },
    );
    const id = old.authId();
    if (reason === "拒绝")
      await old.deliver({ id, error: { code: -32000, message: "拒绝" } });
    if (reason === "替换") old.peer.close();
    await rejected;
    const current = connection();
    const pending = current.authenticate();
    await current.deliver({ id: current.authId() });
    await old.deliver({ id, result: { ok: true } });
    await current.deliver({ id, result: { ok: true } });
    await Promise.all([old.request("old"), current.request("current")]);
    old.denied("old");
    current.denied("current");
    assert.equal(old.executions() + current.executions(), 0);
    current.peer.close();
    await assert.rejects(pending);
  }
});

/** 假服务端不完成握手便派发目录写入；真实连接器必须拒绝且不产生文件。 */
test("连接器在身份握手完成前拒绝执行环境指令", { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-preauth-"));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const config = new ConnectorConfig(join(dir, "config"));
    const keys = generateKeyPairSync("ed25519");
    config.save({
      ...config.read(),
      serverUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      environmentId: "00000000-0000-4000-8000-000000000001",
      publicKey: keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      privateKey: config.vault.seal(
        keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      ),
      roots: [{ id: "work", path: dir }],
    });
    const response = new Promise<any>((resolve) =>
      server.once("connection", (ws) => {
        ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "preauth",
            method: "directory.create",
            params: { rootId: "work", parent: ".", name: "unauthorized" },
          }),
        );
      }),
    );
    child = spawn(
      process.execPath,
      ["--import", "tsx", "src/connector/main.ts", "run"],
      {
        env: { ...process.env, BUGPAW_HOME: config.dir },
        stdio: "ignore",
      },
    );
    assert.equal((await response).error.data.code, "UNAUTHENTICATED");
    assert.equal(existsSync(join(dir, "unauthorized")), false);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 协议替身只生成合成流；连接器、认证、WSS、控制 HTTP 与磁盘账本均真实运行。 */
test(
  "流式输出期间断网重连不重启任务，真实控制接口响应且停止保存尾批",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    let child: ReturnType<typeof spawn> | undefined;
    f.service.reconcile = async () => {};
    const waitFor = async (check: () => boolean, ms = 10000) => {
      const end = Date.now() + ms;
      while (!check() && Date.now() < end)
        await new Promise((r) => setTimeout(r, 25));
      assert.ok(check(), "等待条件超时");
    };
    try {
      const command = join(f.dir, "stream-runtime.cjs");
      const starts = join(f.dir, "starts");
      writeFileSync(
        command,
        `#!${process.execPath}
const fs=require('node:fs');
if(process.argv.includes('--version')) { process.stdout.write('fixture'); process.exit(0); }
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.id)return;
 if(m.method==='initialize')send({id:m.id,result:{}});
 else if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'fixture-thread'}}});
 else if(m.method==='thread/read')send({id:m.id,result:{thread:{id:'fixture-thread',turns:[]}}});
 else if(m.method==='turn/start'){
  fs.appendFileSync(${JSON.stringify(starts)},'start\\n');
  send({id:m.id,result:{turn:{id:'fixture-turn'}}});
  let n=0;const timer=setInterval(()=>{
   for(let i=0;i<10;i++)send({method:'item/agentMessage/delta',params:{delta:'DO_NOT_LOG_STREAM_CONTENT '+('word '.repeat(205))}});
   if(++n===300){clearInterval(timer);send({method:'item/completed',params:{item:{type:'agentMessage',text:'final-reply'}}});send({method:'turn/completed',params:{turn:{status:'completed'}}});}
  },10);
 } else send({id:m.id,result:{}});
});
`,
        { mode: 0o700 },
      );
      const config = new ConnectorConfig(join(f.dir, "stream-worker"));
      config.save({
        ...config.read(),
        serverUrl: f.options.publicUrl,
        codex: { command, baseUrl: "", model: "", apiKey: "" },
        roots: [{ id: "work", path: f.dir }],
      });
      await config.register(f.invite());
      const id = config.read().environmentId;
      f.store.put("environments", { approved: true }, id);
      child = spawn(
        process.execPath,
        ["--import", "tsx", "src/connector/main.ts", "run"],
        { env: { ...process.env, BUGPAW_HOME: config.dir }, stdio: "ignore" },
      );
      await waitFor(() => f.service.peers.has(id));
      const old = f.service.peers.get(id)!;
      await old.call("execution.start", {
        operationId: "stream-operation",
        executionId: "stream-execution",
        message: "synthetic",
        session: {
          id: "stream-session",
          runtime: "codex",
          permission: "ask",
          rootId: "work",
          relativePath: ".",
        },
      });
      const control = JSON.parse(
        readFileSync(join(config.dir, "worker.json"), "utf8"),
      );
      const samples: number[] = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        const response = await fetch(
          `http://127.0.0.1:${control.port}/status`,
          {
            headers: { authorization: `Bearer ${control.token}` },
            signal: AbortSignal.timeout(2000),
          },
        );
        assert.equal(response.status, 200);
        samples.push(performance.now() - start);
        await new Promise((r) => setTimeout(r, 25));
      }
      for (const ws of f.app.websocketServer.clients) ws.terminate();
      await waitFor(
        () => f.service.peers.has(id) && f.service.peers.get(id) !== old,
      );
      let result: any;
      for (let i = 0; i < 100; i++) {
        result = await f.service.peers
          .get(id)!
          .call("execution.result", { executionId: "stream-execution" });
        if (result.status === "completed") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(result.status, "completed");
      assert.equal(result.reply, "final-reply");
      assert.equal(readFileSync(starts, "utf8"), "start\n");
      assert.ok(Math.max(...samples) < 2000);
      const history = await f.service.peers
        .get(id)!
        .call("session.history", { sessionId: "stream-session" });
      assert.equal(history.gap, true);
      assert.equal(history.events.length, 1000);
      assert.ok(
        history.events.every(
          (e: any, i: number, a: any[]) =>
            !i || e.sequence === a[i - 1].sequence + 1,
        ),
      );
      const exited = once(child, "exit");
      // 使用连接器的正常停止入口，等待工作线程提交完成。
      const { stopWorker } = await import("../src/connector/process.js");
      await stopWorker(config);
      await exited;
      const log = readFileSync(
        join(config.dir, "connection-diagnostics.log"),
        "utf8",
      );
      assert.ok(log.includes("connection.reconnect_scheduled"));
      assert.equal(log.includes("DO_NOT_LOG_STREAM_CONTENT"), false);
      assert.equal(log.includes(control.token), false);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
      await f.close();
    }
  },
);

/** 保持原有 20 秒检查/一次缺失即断开，并实测服务端超时分类。 */
test(
  "真实心跳缺失记录同一连接超时与关闭，阈值保持不变",
  { timeout: 50000 },
  async () => {
    const f = await fixture();
    const records: any[] = [];
    const write = process.stdout.write;
    let ws: WebSocket | undefined;
    process.stdout.write = function (chunk: any, ...args: any[]) {
      try {
        const value = JSON.parse(String(chunk));
        if (value.event) records.push(value);
      } catch {}
      return (write as any).call(process.stdout, chunk, ...args);
    } as typeof process.stdout.write;
    try {
      const env = f.store.put("environments", {
        name: "heartbeat-fixture",
        publicKey: f.publicKey,
        approved: true,
        revoked: false,
      });
      ws = new WebSocket(
        f.options.publicUrl.replace("http", "ws") + "/api/node/connect",
        { autoPong: false },
      );
      const challenge = JSON.parse(
        (await once(ws, "message"))[0].toString(),
      ).params;
      assert.ok(
        (await f.request(ws, f.proof(env.id, challenge.challenge))).result.ok,
      );
      await once(ws, "close");
      await new Promise((r) => setTimeout(r, 25));
      const timeout = records.find(
        (r) => r.event === "heartbeat.timeout" && r.environmentId === env.id,
      );
      assert.ok(timeout);
      assert.ok(timeout.unansweredMs >= 19000);
      assert.equal(timeout.rttMs, null);
      assert.equal(timeout.initiator, "server");
      assert.equal(timeout.reason, "heartbeat_timeout");
      assert.ok(
        records.some(
          (r) =>
            r.event === "connection.close" &&
            r.connectionId === timeout.connectionId &&
            r.reason === "heartbeat_timeout",
        ),
      );
    } finally {
      process.stdout.write = write;
      ws?.terminate();
      await f.close();
    }
  },
);

/** 磁盘忙锁触发真实工作线程写失败，网络重连不能把存储故障覆盖为正常。 */
test(
  "存储失败经重连仍可查询，停止入口返回明确刷新失败",
  { timeout: 30000 },
  async () => {
    const { Store } = await import("../src/server/store.js");
    const { workerStatus, stopWorker } =
      await import("../src/connector/process.js");
    const f = await fixture();
    f.service.reconcile = async () => {};
    let child: ReturnType<typeof spawn> | undefined;
    let local: InstanceType<typeof Store> | undefined;
    const until = async (predicate: () => boolean) => {
      const deadline = Date.now() + 10000;
      while (!predicate() && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 25));
      assert.ok(predicate());
    };
    try {
      const config = new ConnectorConfig(join(f.dir, "fault-worker"));
      config.save({
        ...config.read(),
        serverUrl: f.options.publicUrl,
        codex: {
          command: "fixture-no-codex",
          baseUrl: "",
          model: "",
          apiKey: "",
        },
        roots: [{ id: "work", path: f.dir }],
      });
      await config.register(f.invite());
      const id = config.read().environmentId;
      f.store.put("environments", { approved: true }, id);
      child = spawn(
        process.execPath,
        ["--import", "tsx", "src/connector/main.ts", "run"],
        { env: { ...process.env, BUGPAW_HOME: config.dir }, stdio: "ignore" },
      );
      await until(() => f.service.peers.has(id));
      const peer = f.service.peers.get(id)!;
      await peer.call("execution.status", { executionId: "missing" });
      local = new ConnectorStore(join(config.dir, "environment.db"));
      local.db.exec("BEGIN IMMEDIATE");
      try {
        await assert.rejects(
          peer.call("execution.prepare", {
            executionId: "prepared-fault",
            operationId: "prepare-fault",
            workflow: { itemId: "item" },
            message: "fixture",
            session: { id: "fault-session", rootId: "work", relativePath: "." },
          }),
          (e: any) => e.code === "STORAGE_UNAVAILABLE",
        );
      } finally {
        local.db.exec("ROLLBACK");
        local.close();
        local = undefined;
      }
      assert.equal((await workerStatus(config)).status, "storage_error");
      for (const ws of f.app.websocketServer.clients) ws.terminate();
      await until(
        () => f.service.peers.has(id) && f.service.peers.get(id) !== peer,
      );
      const state = await workerStatus(config);
      assert.equal(state.status, "storage_error");
      assert.equal(state.errorCode, "STORAGE_UNAVAILABLE");
      await assert.rejects(
        stopWorker(config),
        (e: any) => e.code === "SHUTDOWN_FAILED",
      );
    } finally {
      local?.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      await f.close();
    }
  },
);

/** 同一未认证连接的失败风暴只记录首条，关闭时保留完整计数。 */
test("认证失败诊断按连接限频并在关闭时汇总", async () => {
  const records: any[] = [];
  const write = process.stdout.write;
  process.stdout.write = function (chunk: any, ...args: any[]) {
    try {
      records.push(JSON.parse(String(chunk)));
    } catch {}
    return (write as any).call(process.stdout, chunk, ...args);
  } as typeof process.stdout.write;
  const f = await fixture();
  try {
    const connection = await f.connect();
    for (let n = 0; n < 12; n++) await f.request(connection.ws, {});
    const closed = once(connection.ws, "close");
    connection.ws.close();
    await closed;
    for (
      let n = 0;
      n < 200 && !records.some((r) => r.event === "connection.close");
      n++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      records.filter((r) => r.event === "connection.authentication_failed")
        .length,
      1,
    );
    assert.equal(
      records.find((r) => r.event === "connection.close")
        .authenticationFailures,
      12,
    );
  } finally {
    await f.close();
    process.stdout.write = write;
  }
});

/** 当前控制身份不匹配时保持未知，不允许退化为 PID 停止。 */
test("当前 worker 身份无法确认时拒绝停止", async () => {
  const { createServer } = await import("node:http");
  const { workerStatus, stopWorker } =
    await import("../src/connector/process.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-worker-identity-"));
  const config = new ConnectorConfig(dir);
  let stops = 0;
  const server = createServer((req, res) => {
    if (req.url === "/stop") stops++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ instanceId: "other-instance", status: "online" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    writeFileSync(
      join(dir, "worker.json"),
      JSON.stringify({
        pid: process.pid,
        port: (server.address() as any).port,
        token: "synthetic-test-token",
        instanceId: "expected-instance",
      }),
    );
    assert.equal((await workerStatus(config)).status, "unknown");
    await assert.rejects(
      stopWorker(config),
      (error: any) => error.code === "WORKER_UNREACHABLE",
    );
    assert.equal(stops, 0);
  } finally {
    server.close();
    await once(server, "close");
    rmSync(dir, { recursive: true, force: true });
  }
});
