import { nodeAuthVersion, nodeProofText } from "../src/shared/node-identity.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";
import { createApp } from "../src/server/app.js";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { Vault, passwordHash, totp } from "../src/server/security.js";
import { RpcPeer } from "../src/shared/rpc.js";
import { Engine, resolveDirectory } from "../src/connector/engine.js";
const origin = "http://localhost:3180";
/** 临时目录测试不使用用户真实数据、密钥或原生模型额度。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "relay-test-"));
  const store = new Store(join(dir, "test.db"));
  const service = new Service(store, new Vault(dir));
  const environment = store.put("environments", {
    name: "test",
    roots: [{ id: "root", path: dir }],
    approved: true,
    capabilities: ["stage-handoff-short-id-v1"],
  });
  const project = service.save("projects", {
    name: "项目",
    directories: [
      { environmentId: environment.id, rootId: "root", relativePath: "." },
    ],
  });
  return {
    dir,
    store,
    service,
    environment,
    project,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function boardInput(f: ReturnType<typeof fixture>, concurrency = 1) {
  const human = randomUUID(),
    agent = randomUUID(),
    done = randomUUID();
  return {
    name: "测试流程",
    projectId: f.project.id,
    stages: [
      {
        fixedRole: "start",
        id: human,
        name: "需求",
        type: "human",
        targets: [agent],
      },
      {
        id: agent,
        name: "开发",
        type: "agent",
        agentId: f.service.save("agents", { name: "执行智能体" }).id,
        targets: [done],
        environmentId: f.environment.id,
        rootId: "root",
        relativePath: ".",
        concurrency,
      },
      { id: done, name: "已完成", type: "done", targets: [] },
    ],
  };
}
test("首次迁移、乐观版本、备份恢复与禁止降级", async () => {
  const f = fixture();
  try {
    const changed = f.service.save(
      "projects",
      { name: "新版", directories: [] },
      f.project.id,
      f.project.version,
    );
    assert.equal(changed.version, 2);
    assert.throws(
      () =>
        f.service.save(
          "projects",
          { name: "旧提交", directories: [] },
          f.project.id,
          1,
        ),
      /数据版本/,
    );
    const path = join(f.dir, "backup.db");
    await f.store.backup(path);
    const restored = new Store(path);
    assert.equal(restored.get("projects", f.project.id).name, "新版");
    restored.close();
    f.store.db.exec("PRAGMA user_version=999");
    assert.throws(() => new Store(join(f.dir, "test.db")), /禁止降级/);
  } finally {
    f.close();
  }
});
test("模型凭据加密且不返回，保留密钥与拒绝覆盖工具参数", () => {
  const f = fixture();
  try {
    const secret = "test-only-secret-not-a-real-key";
    const model = f.service.save("models", {
      name: "测试",
      protocol: "responses",
      baseUrl: "https://example.invalid/v1",
      model: "test",
      apiKey: secret,
    });
    assert.equal(model.hasKey, true);
    assert.ok(!JSON.stringify(model).includes(secret));
    assert.ok(
      !JSON.stringify(f.store.get("models", model.id)).includes(secret),
    );
    const updated = f.service.save(
      "models",
      { ...model, apiKey: "" },
      model.id,
      model.version,
    );
    assert.equal(updated.hasKey, true);
    assert.throws(
      () => f.service.save("models", { ...model, extra: { tools: [] } }),
      /不能覆盖/,
    );
  } finally {
    f.close();
  }
});
test("环境离线不能创建普通会话，目录和智能体作用域校验", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.service.createSession({
          title: "x",
          projectId: f.project.id,
          environmentId: f.environment.id,
          rootId: "root",
          runtime: "codex",
        }),
      /离线/,
    );
    f.service.peers.set(f.environment.id, {} as any);
    assert.throws(
      () =>
        f.service.createSession({
          title: "x",
          projectId: f.project.id,
          environmentId: f.environment.id,
          rootId: "elsewhere",
          runtime: "codex",
        }),
      /目录/,
    );
  } finally {
    f.close();
  }
});
test("看板合法阶段与固定完成阶段，副本不复制工作项", () => {
  const f = fixture();
  try {
    const input = boardInput(f);
    assert.throws(() =>
      f.service.save("boards", { ...input, stages: input.stages.slice(0, -1) }),
    );
    const b = f.service.save("boards", input);
    f.service.createItem({ boardId: b.id, title: "第一项" });
    const copy = f.service.copyBoard(b.id);
    assert.notEqual(copy.id, b.id);
    assert.notEqual(copy.stages[0].id, b.stages[0].id);
    assert.equal(
      f.store.list("items").filter((i) => i.boardId === copy.id).length,
      0,
    );
    assert.throws(
      () =>
        f.service.save(
          "boards",
          {
            ...b,
            stages: [{ ...input.stages[0], targets: [] }, ...input.stages.slice(1)],
          },
          b.id,
          b.version,
        ),
      /须保留出口/,
    );
    assert.throws(() => f.service.remove("boards", b.id), /未完成且未归档/);
  } finally {
    f.close();
  }
});
test("离线排队不占名额，串行派发、交接防重和重试快照", async () => {
  const f = fixture();
  try {
    const b = f.service.save("boards", boardInput(f));
    const items = [
      f.service.createItem({ boardId: b.id, title: "A" }),
      f.service.createItem({ boardId: b.id, title: "B" }),
    ];
    for (const i of items)
      f.service.advance(i.id, b.stages[1].id, "准备开始", randomUUID());
    await f.service.tick();
    assert.equal(
      (
        f.store.db
          .prepare("SELECT count(*) AS n FROM executions WHERE state='queued'")
          .get() as any
      ).n,
      2,
    );
    let calls = 0;
    f.service.peers.set(f.environment.id, {
      call: async () => {
        calls++;
        return { status: "running" };
      },
    } as any);
    await f.service.tick();
    assert.equal(calls, 1);
    await f.service.tick();
    assert.equal(calls, 1);
    const item = f.store.get("items", items[0].id);
    const op = randomUUID();
    const done = f.service.advance(
      item.id,
      b.stages[2].id,
      "完成",
      op,
      item.executionId,
    );
    assert.equal(done.status, "done");
    assert.deepEqual(
      f.service.advance(item.id, b.stages[2].id, "完成", op, item.executionId),
      done,
    );
    assert.throws(
      () =>
        f.service.advance(
          item.id,
          b.stages[2].id,
          "不同参数",
          op,
          item.executionId,
        ),
      /参数不一致/,
    );
    await f.service.tick();
    assert.equal(calls, 2);
    assert.equal(
      f.store.list("handoffs").filter((h) => h.itemId === item.id).length,
      2,
    );
  } finally {
    f.close();
  }
});
test("普通发送持久化防重、冲突保护且服务端不落正文", async () => {
  const f = fixture();
  try {
    let calls = 0;
    f.service.peers.set(f.environment.id, {
      call: async () => {
        calls++;
        return { status: "running" };
      },
    } as any);
    const s = f.service.createSession({
      agentId: f.service.save("agents", { name: "会话智能体" }).id,
      title: "无正文标题",
      projectId: f.project.id,
      environmentId: f.environment.id,
      rootId: "root",
      runtime: "codex",
    });
    const op = randomUUID(),
      message = "PRIVATE_ENVIRONMENT_MESSAGE_928514";
    const first = await f.service.send(s.id, op, message);
    const duplicate = await f.service.send(s.id, op, message);
    assert.equal(first.executionId, duplicate.executionId);
    assert.equal(calls, 1);
    await assert.rejects(() => f.service.send(s.id, op, "changed"), /不同请求/);
    assert.ok(
      !JSON.stringify(
        f.store.db.prepare("SELECT * FROM entities").all(),
      ).includes(message),
    );
    assert.ok(
      !JSON.stringify(
        f.store.db.prepare("SELECT * FROM operations").all(),
      ).includes(message),
    );
    assert.ok(
      !JSON.stringify(
        f.store.db.prepare("SELECT * FROM executions").all(),
      ).includes(message),
    );
  } finally {
    f.close();
  }
});
test("服务端重启对账不重复派发不明执行，待派发可取消", async () => {
  const f = fixture();
  try {
    const b = f.service.save("boards", boardInput(f));
    const item = f.service.createItem({ boardId: b.id, title: "A" });
    f.service.advance(item.id, b.stages[1].id, "start", randomUUID());
    const queued = f.store.get("items", item.id);
    await f.service.stop(queued.executionId);
    assert.equal(f.store.get("items", item.id).status, "cancelled");
    f.service.retry(item.id);
    const next = f.store.get("items", item.id);
    assert.notEqual(next.executionId, queued.executionId);
    f.service.setState(next.executionId, "unknown");
    const restarted = new Service(f.store, f.service.vault);
    let methods: string[] = [];
    await restarted.reconcile(f.environment.id, {
      call: async (m: string) => {
        methods.push(m);
        return { status: "running" };
      },
    } as any);
    assert.deepEqual(methods, ["execution.status"]);
    assert.equal(restarted.execution(next.executionId).state, "running");
  } finally {
    f.close();
  }
});
test("真实路径边界阻止父目录与符号链接逃逸", async () => {
  const f = fixture();
  try {
    const root = join(f.dir, "root");
    mkdirSync(root);
    const outside = join(f.dir, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(root, "escape"), "dir");
    const roots = [{ id: "r", path: root }];
    assert.equal(await resolveDirectory(roots, "r", "."), root);
    await assert.rejects(() => resolveDirectory(roots, "r", ".."), /超出/);
    await assert.rejects(() => resolveDirectory(roots, "r", "escape"), /超出/);
    await assert.rejects(
      () => resolveDirectory(roots, "r", outside),
      /相对路径/,
    );
  } finally {
    f.close();
  }
});
test("双向 RPC 响应关联与断线清理", async () => {
  let a: RpcPeer, b: RpcPeer;
  a = new RpcPeer(
    (data) => {
      void b.receive(data);
    },
    async (m, p) => p,
  );
  b = new RpcPeer(
    (data) => {
      void a.receive(data);
    },
    async (m, p) => ({ value: p.value + 1 }),
  );
  assert.deepEqual(await a.call("increment", { value: 2 }), { value: 3 });
  assert.deepEqual(await b.call("echo", { x: 1 }), { x: 1 });
  const c = new RpcPeer(
    () => {},
    async () => null,
  );
  const pending = c.call("never");
  c.close();
  await assert.rejects(pending, /断开/);
  a.close();
  b.close();
});
test("认证、同源保护、初始化一次性令牌与注销", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-http-"));
  const { app } = await createApp({
    dataDir: dir,
    publicUrl: origin,
    secureCookie: false,
  });
  try {
    assert.equal((await app.inject("/api/state")).statusCode, 401);
    const setupToken = readFileSync(join(dir, "setup-token"), "utf8");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/setup",
          payload: {
            setupToken,
            username: "test",
            password: "not-a-real-password",
          },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/setup",
          headers: { origin },
          payload: {
            setupToken,
            username: "test",
            password: "not-a-real-password",
          },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/setup",
          headers: { origin },
          payload: {},
        })
      ).statusCode,
      409,
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: { username: "test", password: "not-a-real-password" },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies[0].name + "=" + login.cookies[0].value;
    assert.equal(
      (await app.inject({ url: "/api/state", headers: { cookie } })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { cookie, origin: "https://evil.invalid" },
          payload: { name: "CSRF" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { cookie, origin },
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/api/state", headers: { cookie } })).statusCode,
      401,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("环境一次性接入、Ed25519 challenge 认证、审批与撤销", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-wss-"));
  const { app, store, service } = await createApp({
    dataDir: dir,
    publicUrl: origin,
    secureCookie: false,
  });
  let ws: WebSocket | undefined;
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as any;
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const env = store.put("environments", {
      name: "test",
      approved: true,
      capabilities: ["stage-handoff-short-id-v1"],
      revoked: false,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/node/connect`);
    const peer = new RpcPeer(
      (data) => ws!.send(data),
      async (method, p) => {
        if (method === "identity.challenge")
          return peer.call("identity.authenticate", {
            authVersion: nodeAuthVersion,
            environmentId: env.id,
            signature: sign(
              null,
              Buffer.from(
                nodeProofText(
                  p.audience,
                  "connect",
                  env.id,
                  env.publicKey,
                  "",
                  p.challenge,
                ),
              ),
              privateKey,
            ).toString("base64"),
            protocol: 1,
            roots: [],
            tools: {},
            platform: "test",
          });
        return { status: "not_found" };
      },
    );
    ws.on("message", (data) => void peer.receive(data.toString()));
    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const t = setInterval(() => {
        if (service.peers.has(env.id)) {
          clearInterval(t);
          resolve();
        } else if (Date.now() - started > 5000) {
          clearInterval(t);
          reject(new Error("认证未完成"));
        }
      }, 20);
    });
    assert.ok(service.peers.has(env.id));
    ws.close();
    await new Promise((r) => ws!.once("close", r));
    peer.close();
  } finally {
    ws?.terminate();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 容忍时钟偏差时也必须按实际时间步防重，而不是按服务器当前时间步记录。 */
test("TOTP 提前窗口验证码仅可使用一次", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-totp-"));
  const { app, store } = await createApp({
    dataDir: dir,
    publicUrl: origin,
    secureCookie: false,
  });
  try {
    const vault = new Vault(dir);
    const secret = "JBSWY3DPEHPK3PXP";
    store.put(
      "users",
      {
        username: "totp-test",
        password: passwordHash("totp-test-password"),
        totp: vault.seal(secret),
        lastTotp: 0,
      },
      "owner",
    );
    const counter = Math.floor(Date.now() / 30000);
    const code = totp(secret).generate({ timestamp: (counter + 1) * 30000 });
    const request = {
      method: "POST" as const,
      url: "/api/auth/login",
      headers: { origin },
      payload: { username: "totp-test", password: "totp-test-password", code },
    };
    assert.equal((await app.inject(request)).statusCode, 200);
    assert.equal(store.get("users", "owner").lastTotp, counter + 1);
    assert.equal((await app.inject(request)).statusCode, 401);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 根目录保存和浏览不依赖进程启动目录，非法配置不能覆盖已有可用配置。 */
test("多根目录持久化、路径验证与目录浏览边界", async () => {
  const { ConnectorConfig } = await import("../src/connector/config.js");
  const { Engine } = await import("../src/connector/engine.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-config-roots-"));
  const root = join(dir, "another workspace");
  mkdirSync(root);
  mkdirSync(join(root, "项目"));
  const config = new ConnectorConfig(join(dir, "settings"));
  const store = new Store(join(dir, "local.db"));
  const engine = new Engine(
    store,
    () => config.runtime(),
    () => {},
    async () => ({}),
  );
  try {
    config.save({
      ...config.read(),
      serverUrl: "https://deployment.example.invalid",
      roots: [
        { id: "first", path: dir },
        { id: "second", path: root },
      ],
    });
    assert.equal(new ConnectorConfig(config.dir).read().roots[1].path, root);
    const listed = await engine.call("directory.list", {
      rootId: "second",
      relativePath: ".",
    });
    assert.deepEqual(listed.directories, ["项目"]);
    assert.equal(
      (
        await engine.call("directory.validate", {
          rootId: "second",
          relativePath: "项目",
        })
      ).path,
      join(root, "项目"),
    );
    await assert.rejects(
      engine.call("directory.list", { rootId: "second", relativePath: ".." }),
      /超出/,
    );
    assert.throws(
      () =>
        config.save({
          ...config.read(),
          roots: [{ id: "relative", path: "relative" }],
        }),
      /绝对路径/,
    );
    assert.throws(
      () =>
        config.save({
          ...config.read(),
          roots: [{ id: "missing", path: join(dir, "missing") }],
        }),
      /不存在/,
    );
    assert.throws(
      () =>
        config.save({
          ...config.read(),
          roots: [
            { id: "first", path: root },
            { id: "second", path: root },
          ],
        }),
      /不能重复/,
    );
    assert.equal(config.read().roots.length, 2);
  } finally {
    engine.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 删除门槛取决于业务阶段与归档状态，不把一次执行结束当作工作项完成。 */
test("删除看板允许已完成或已归档工作项，并保留独立会话", async () => {
  const f = fixture();
  try {
    const b = f.service.save("boards", boardInput(f));
    const item = f.service.createItem({ boardId: b.id, title: "待完成" });
    f.service.advance(item.id, b.stages[1].id, "开发", randomUUID());
    const executing = f.store.get("items", item.id);
    f.service.setState(executing.executionId, "completed");
    assert.throws(() => f.service.remove("boards", b.id), /未完成且未归档/);
    assert.equal(f.store.list("handoffs").length, 1);
    f.service.advance(item.id, b.stages[2].id, "验收完成", randomUUID());
    const archived = f.service.createItem({ boardId: b.id, title: "归档需求" });
    f.store.put("items", { archived: true }, archived.id);
    const other = f.service.save("boards", boardInput(f));
    f.service.createItem({ boardId: other.id, title: "其他看板" });
    assert.deepEqual(f.service.remove("boards", b.id), { ok: true });
    assert.throws(() => f.store.get("boards", b.id), /不存在/);
    assert.equal(f.store.list("items").length, 1);
    assert.equal(f.store.list("items")[0].boardId, other.id);
    assert.equal(f.store.list("handoffs").length, 0);
    const execution = f.service.execution(executing.executionId);
    assert.equal(execution.item_id, null);
    assert.ok(f.store.get("sessions", execution.session_id));
    f.service.setState(execution.id, "completed");
    await f.service.tick();
    assert.equal(
      f.store.db
        .prepare("SELECT count(*) AS n FROM operations WHERE scope=?")
        .get(item.id)?.n,
      0,
    );
    f.service.remove("boards", f.service.save("boards", boardInput(f)).id);
  } finally {
    f.close();
  }
});

test("归档的 Agent 工作项不能重试，删除不残留调度任务", async () => {
  const f = fixture();
  try {
    const b = f.service.save("boards", boardInput(f));
    const item = f.service.createItem({ boardId: b.id, title: "归档执行" });
    f.service.advance(item.id, b.stages[1].id, "开发", randomUUID());
    const executing = f.store.get("items", item.id);
    await f.service.stop(executing.executionId);
    f.store.put("items", { archived: true }, item.id);
    assert.throws(() => f.service.retry(item.id), /先恢复/);
    // 模拟旧版本允许归档后重试遗留的排队任务。
    f.service.queue(f.store.get("items", item.id), b as any);
    const legacy = f.store.get("items", item.id);
    f.service.remove("boards", b.id);
    assert.equal(f.service.execution(legacy.executionId).state, "cancelled");
    await f.service.tick();
    assert.equal(f.service.execution(executing.executionId).item_id, null);
  } finally {
    f.close();
  }
});

/** 构造当前阶段已结束的会话，模拟连接器受理与真实启动的分界。 */
async function resumeFixture() {
  const f = fixture();
  f.store.put(
    "environments",
    { capabilities: ["board-resume-v1", "stage-handoff-short-id-v1"] },
    f.environment.id,
  );
  const calls: { method: string; params: any }[] = [];
  f.service.peers.set(f.environment.id, {
    call: async (method: string, params: any) => {
      calls.push({ method, params });
      return method === "execution.prepare"
        ? { status: "queued", stateVersion: 0 }
        : { status: "running", stateVersion: 1 };
    },
  } as any);
  const board = f.service.save("boards", boardInput(f));
  const item = f.service.createItem({ boardId: board.id, title: "续发测试" });
  f.service.advance(item.id, board.stages[1].id, "开始", randomUUID());
  await f.service.tick();
  const original = f.service.execution(
    f.store.get("items", item.id).executionId,
  );
  f.service.setState(original.id, "completed", 2);
  return { ...f, board, item, original, calls };
}

test("看板续发接管、容量排队、重复操作及合法交接", async () => {
  const f = await resumeFixture();
  try {
    const other = f.service.createItem({
      boardId: f.board.id,
      title: "占用名额",
    });
    f.service.advance(other.id, f.board.stages[1].id, "开始", randomUUID());
    await f.service.tick();
    assert.equal(
      f.service.list("items").find((i) => i.id === f.item.id)!.needsAttention,
      true,
    );
    const op = randomUUID();
    const resumed = await f.service.send(f.original.session_id, op, "请继续");
    assert.equal(resumed.status, "queued");
    assert.equal(f.service.execution(resumed.executionId).item_id, f.item.id);
    assert.equal(
      f.service.list("items").find((i) => i.id === f.item.id)!.needsAttention,
      false,
    );
    await f.service.tick();
    assert.equal(f.service.execution(resumed.executionId).state, "queued");
    assert.equal(
      (await f.service.send(f.original.session_id, op, "请继续")).executionId,
      resumed.executionId,
    );
    assert.equal(
      f.calls.filter((c) => c.method === "execution.prepare").length,
      1,
    );
    assert.equal(
      f.calls.find((c) => c.method === "execution.prepare")!.params.workflow
        .itemId,
      f.item.id,
    );
    f.service.setState(
      f.store.get("items", other.id).executionId,
      "completed",
      2,
    );
    await f.service.tick();
    assert.equal(f.store.get("items", f.item.id).status, "running");
    f.service.setState(f.original.id, "completed", 99);
    assert.equal(f.store.get("items", f.item.id).status, "running");
    f.service.advance(
      f.item.id,
      f.board.stages[2].id,
      "完成",
      randomUUID(),
      resumed.executionId,
    );
    f.service.setState(resumed.executionId, "failed", 100);
    assert.equal(f.store.get("items", f.item.id).status, "done");
    assert.equal(
      f.service.list("items").find((i) => i.id === f.item.id)!.needsAttention,
      false,
    );
  } finally {
    f.close();
  }
});

test("待受理不清提醒、发送失败保留旧原因、离线和旧能力明确拒绝", async () => {
  const f = await resumeFixture();
  try {
    let reject!: (error: Error) => void;
    f.service.peers.set(f.environment.id, {
      call: () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    } as any);
    const sending = f.service.send(
      f.original.session_id,
      randomUUID(),
      "回答正文不入服务端",
    );
    assert.equal(f.store.get("items", f.item.id).status, "completed");
    reject(new Error("发送失败"));
    await assert.rejects(sending, /发送失败/);
    assert.equal(f.store.get("items", f.item.id).executionId, f.original.id);
    assert.deepEqual(
      f.service.list("items").find((i) => i.id === f.item.id)!.attentionReasons,
      ["ended_without_handoff"],
    );
    assert.ok(
      !JSON.stringify(f.store.list("board_state_changes")).includes("回答正文"),
    );
    f.store.put("environments", { capabilities: [] }, f.environment.id);
    await assert.rejects(
      f.service.send(f.original.session_id, randomUUID(), "继续"),
      /升级/,
    );
    f.service.peers.delete(f.environment.id);
    await assert.rejects(
      f.service.send(f.original.session_id, randomUUID(), "继续"),
      /离线/,
    );
    assert.equal(
      f.service.list("items").find((i) => i.id === f.item.id)!.syncStatus,
      "pending",
    );
  } finally {
    f.close();
  }
});

test("重复乱序状态不覆盖新等待，恢复及再次结束重算提醒", async () => {
  const f = await resumeFixture();
  try {
    const resumed = await f.service.send(
      f.original.session_id,
      randomUUID(),
      "继续",
    );
    await f.service.tick();
    f.service.setState(resumed.executionId, "waiting", 3);
    f.service.setState(resumed.executionId, "running", 2);
    assert.equal(f.store.get("items", f.item.id).status, "waiting");
    f.service.setState(resumed.executionId, "running", 4);
    assert.equal(
      f.service.list("items").find((i) => i.id === f.item.id)!.needsAttention,
      false,
    );
    f.service.setState(resumed.executionId, "completed", 5);
    assert.deepEqual(
      f.service.list("items").find((i) => i.id === f.item.id)!.attentionReasons,
      ["ended_without_handoff"],
    );
    const diagnostics = f.store.list("board_state_changes");
    assert.ok(diagnostics.some((d) => d.outcome === "stale_version"));
    assert.ok(
      diagnostics.some(
        (d) => d.before === "running" && d.after === "completed",
      ),
    );
  } finally {
    f.close();
  }
});

test("重入同一阶段后旧会话续发不接管当前工作项", async () => {
  const f = await resumeFixture();
  try {
    f.service.retry(f.item.id);
    const current = f.store.get("items", f.item.id).executionId;
    const ordinary = await f.service.send(
      f.original.session_id,
      randomUUID(),
      "历史会话",
    );
    assert.equal(f.service.execution(ordinary.executionId).item_id, null);
    assert.equal(f.store.get("items", f.item.id).executionId, current);
    f.service.setState(ordinary.executionId, "failed", 2);
    assert.equal(f.store.get("items", f.item.id).status, "queued");
  } finally {
    f.close();
  }
});

test("连接器持久化暂存防重、取消不启动与多原生交互保留", async () => {
  const f = fixture();
  const events: any[] = [];
  const engine = new Engine(
    f.store,
    () => ({ roots: [{ id: "root", path: f.dir }] }),
    (_method, params) => events.push(params),
    async () => ({}),
  );
  try {
    const request = {
      operationId: randomUUID(),
      executionId: randomUUID(),
      session: {
        id: randomUUID(),
        rootId: "root",
        relativePath: ".",
        runtime: "codex",
      },
      workflow: { itemId: randomUUID() },
      message: "排队正文",
      mentions: [],
    };
    assert.equal(
      (await engine.call("execution.prepare", request)).status,
      "queued",
    );
    assert.equal(
      (await engine.call("execution.prepare", request)).status,
      "queued",
    );
    await assert.rejects(
      engine.call("execution.prepare", { ...request, message: "改变" }),
      /内容发生变化/,
    );
    assert.equal(f.store.list("localExecutions").length, 0);
    assert.equal(
      (
        await engine.call("execution.status", {
          executionId: request.executionId,
        })
      ).status,
      "queued",
    );
    await engine.call("execution.cancel", { executionId: request.executionId });
    // 终态重派返回持久化事实，不能把已取消任务重新排队。
    assert.equal(
      (
        await engine.call("execution.startPrepared", {
          executionId: request.executionId,
        })
      ).status,
      "cancelled",
    );
    const id = randomUUID(),
      first = randomUUID(),
      second = randomUUID();
    f.store.put(
      "localExecutions",
      {
        status: "waiting",
        stateVersion: 2,
        interactions: [first, second].map((id) => ({
          id,
          method: "Write",
        })),
      },
      id,
    );
    (engine as any).answers.set(first, () => {});
    (engine as any).answers.set(second, () => {});
    await engine.call("interaction.answer", {
      executionId: id,
      interactionId: first,
      answer: { approve: true },
    });
    assert.equal(f.store.get("localExecutions", id).status, "waiting");
    assert.equal(events.at(-1).interactions.length, 1);
    await assert.rejects(
      engine.call("interaction.answer", {
        executionId: id,
        interactionId: first,
        answer: { approve: true },
      }),
      /失效/,
    );
    await engine.call("interaction.answer", {
      executionId: id,
      interactionId: second,
      answer: { approve: true },
    });
    assert.equal(f.store.get("localExecutions", id).status, "running");
    assert.equal(events.at(-1).stateVersion, 4);
    assert.equal(events.at(-1).interactions.length, 0);
  } finally {
    engine.close();
    f.close();
  }
});

test("取消暂存续发等待确认期间不再派发", async () => {
  const f = await resumeFixture();
  try {
    const resumed = await f.service.send(
      f.original.session_id,
      randomUUID(),
      "继续",
    );
    let confirm!: (result: any) => void;
    let starts = 0;
    f.service.peers.set(f.environment.id, {
      call: (method: string) => {
        if (method === "execution.cancel")
          return new Promise((resolve) => {
            confirm = resolve;
          });
        starts++;
        return Promise.resolve({ status: "running" });
      },
    } as any);
    const stopping = f.service.stop(resumed.executionId);
    await f.service.tick();
    assert.equal(starts, 0);
    assert.equal(f.service.execution(resumed.executionId).state, "stopping");
    confirm({ status: "cancelled" });
    assert.equal((await stopping).status, "cancelled");
    assert.equal(f.store.get("items", f.item.id).status, "cancelled");
  } finally {
    f.close();
  }
});

test("归档工作项不影响同步和看板汇总，恢复后沿用原有判断", async () => {
  const f = await resumeFixture();
  try {
    f.service.peers.delete(f.environment.id);
    const itemView = () =>
      f.service.list("items").find((item) => item.id === f.item.id)!;
    const boardView = () =>
      f.service.list("boards").find((board) => board.id === f.board.id)!;
    assert.equal(itemView().syncStatus, "pending");
    assert.equal(boardView().syncStatus, "pending");
    assert.equal(boardView().pendingCount, 1);

    f.service.archiveItem(f.item.id, true);
    assert.equal(itemView().syncStatus, "synced");
    assert.equal(itemView().needsAttention, false);
    assert.deepEqual(itemView().attentionReasons, []);
    assert.equal(boardView().syncStatus, "synced");
    assert.equal(boardView().pendingCount, 0);
    assert.equal(f.store.get("items", f.item.id).status, "completed");
    assert.equal(f.service.execution(f.original.id).state, "completed");

    const active = f.service.createItem({
      boardId: f.board.id,
      title: "未归档工作项",
    });
    assert.equal(boardView().syncStatus, "synced");
    assert.equal(boardView().pendingCount, 1);
    f.service.advance(active.id, f.board.stages[1].id, "开始", randomUUID());
    assert.equal(boardView().syncStatus, "pending");
    assert.equal(itemView().syncStatus, "synced");
    assert.equal(
      f.service.list("items").find((item) => item.id === active.id)!.syncStatus,
      "pending",
    );

    f.service.archiveItem(f.item.id, false);
    assert.equal(itemView().syncStatus, "pending");
    assert.deepEqual(itemView().attentionReasons, ["ended_without_handoff"]);
    assert.equal(boardView().pendingCount, 1);
  } finally {
    f.close();
  }
});

test("归档项的缺失执行、会话、执行不匹配与未知状态不产生同步提醒", async () => {
  const f = await resumeFixture();
  try {
    const itemView = () =>
      f.service.list("items").find((item) => item.id === f.item.id)!;
    const boardView = () =>
      f.service.list("boards").find((board) => board.id === f.board.id)!;
    const scenarios = [
      () => f.store.put("items", { executionId: null }, f.item.id),
      () => {
        f.store.put("items", { executionId: f.original.id }, f.item.id);
        f.store.put(
          "sessions",
          { executionId: randomUUID() },
          f.original.session_id,
        );
      },
      () => {
        f.store.put(
          "sessions",
          { executionId: f.original.id },
          f.original.session_id,
        );
        f.store.put(
          "items",
          { status: "unknown", lastKnownStatus: "completed" },
          f.item.id,
        );
      },
      () => {
        f.store.put("items", { status: "completed" }, f.item.id);
        f.store.remove("sessions", f.original.session_id);
      },
    ];
    for (const setup of scenarios) {
      setup();
      f.store.put("items", { archived: false }, f.item.id);
      assert.equal(itemView().syncStatus, "pending");
      assert.equal(boardView().syncStatus, "pending");
      // 模拟历史归档记录，不改变归档接口既有的忙碌校验。
      f.store.put("items", { archived: true }, f.item.id);
      assert.equal(itemView().syncStatus, "synced");
      assert.equal(boardView().syncStatus, "synced");
      assert.equal(boardView().pendingCount, 0);
    }
  } finally {
    f.close();
  }
});

test("新增项目在各环境确认目录后登记，失败可修正并重试", async () => {
  const f = fixture();
  const root = join(f.dir, "workspace");
  const outside = join(f.dir, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  const engine = new Engine(f.store, () => ({ roots: [{ id: "root", path: root }] }), () => {}, async () => ({}));
  const serverPeer: RpcPeer = new RpcPeer((raw) => void connectorPeer.receive(raw), async () => null);
  const connectorPeer = new RpcPeer((raw) => void serverPeer.receive(raw), (method, params) => engine.call(method, params));
  f.service.peers.set(f.environment.id, serverPeer);
  const directory = (relativePath: string) => ({ environmentId: f.environment.id, rootId: "root", relativePath });
  const create = (...paths: string[]) => f.service.createProject({ name: "新增项目", directories: paths.map(directory) });
  try {
    const { writeFile, stat, readdir, chmod } = await import("node:fs/promises");
    const { errorBody } = await import("../src/shared/i18n-errors.js");
    symlinkSync(outside, join(root, "linked"), "junction");
    await writeFile(join(root, "occupied"), "original");
    for (const [path, code] of [
      ["linked/child", "PATH_ESCAPE"], ["../outside/child", "PATH_ESCAPE"],
      [outside, "PATH_INVALID"], ["C:\\absolute", "PATH_INVALID"],
      ["occupied", "NOT_DIRECTORY"], ["occupied/child", "NOT_DIRECTORY"],
    ]) {
      await assert.rejects(create("nested/project", path), (error) => {
        const body = errorBody(error, "en");
        assert.equal(body.code, code);
        assert.ok("field" in body);
        assert.equal(body.field, "directories.1.relativePath");
        assert.ok(body.message.includes(path));
        assert.ok(body.message.includes(f.environment.name));
        assert.equal(f.store.list("projects").length, 1);
        return true;
      });
    }
    assert.deepEqual(await readdir(outside), []);
    assert.equal(readFileSync(join(root, "occupied"), "utf8"), "original");
    assert.ok((await stat(join(root, "nested", "project"))).isDirectory());
    if (process.platform !== "win32" && process.getuid?.() !== 0) {
      await chmod(root, 0o555);
      try {
        await assert.rejects(create("denied"), { code: "DIRECTORY_PERMISSION" });
      } finally {
        await chmod(root, 0o755);
      }
    }
    const second = f.store.put("environments", { name: "second" });
    const secondDirectory = { ...directory("second/project"), environmentId: second.id };
    const project = { name: "重试", directories: [directory("."), directory("nested/project"), secondDirectory] };
    await assert.rejects(f.service.createProject(project), { code: "OFFLINE", field: "directories.2.relativePath" });
    const secondEngine = new Engine(f.store, () => ({ roots: [{ id: "root", path: outside }] }), () => {}, async () => ({}));
    const secondPeer: RpcPeer = new RpcPeer((raw) => void remote.receive(raw), async () => null);
    const remote = new RpcPeer((raw) => void secondPeer.receive(raw), (method, params) => secondEngine.call(method, params));
    f.service.peers.set(second.id, secondPeer);
    assert.deepEqual((await f.service.createProject(project)).directories, project.directories);
    assert.ok((await stat(join(outside, "second", "project"))).isDirectory());
    assert.deepEqual((await create()).directories, []);
    // 仅收到空响应或在等候期间断连时不能登记项目。
    const unknownPeer: RpcPeer = new RpcPeer((raw) => void incomplete.receive(raw), async () => null);
    const incomplete = new RpcPeer((raw) => void unknownPeer.receive(raw), async () => ({}));
    f.service.peers.set(second.id, unknownPeer);
    await assert.rejects(f.service.createProject(project), { code: "STATUS_UNKNOWN" });
    f.service.peers.set(second.id, new RpcPeer(() => queueMicrotask(() => f.service.peer(second.id).close()), async () => null));
    await assert.rejects(f.service.createProject(project), { code: "OFFLINE" });
    assert.equal(f.store.list("projects").length, 3);
  } finally {
    f.close();
  }
});

test("在途 Agent 仅首跳受快照约束，预览和保存复核同一份草稿", () => {
  const f = fixture();
  try {
    const input = boardInput(f);
    const [start, agent, done] = input.stages;
    const review = { id: randomUUID(), type: "human", name: "验收", targets: [done.id] };
    agent.targets = [review.id];
    const board = f.service.save("boards", { ...input, stages: [start, agent, review, done] });
    const task = f.service.createItem({ boardId: board.id, title: "在途" });
    f.service.advance(task.id, agent.id, "开始", randomUUID());
    const item = f.store.get("items", task.id);
    const draft = { ...board, stages: [start, { ...agent, targets: [review.id, done.id] }, { ...review, targets: [] }, done] };
    assert.throws(() => f.service.previewBoardFlow(board.id, draft, board.version), /S2 · 开发.*完成路径/);
    assert.throws(() => f.service.save("boards", draft, board.id, board.version), /S2 · 开发.*完成路径/);

    // 允许沿原首跳进入新类型的阶段，再从该阶段按最新配置完成。
    const nextReview = { ...agent, id: review.id, name: review.name, targets: [done.id], instructions: "新验收" };
    draft.stages[2] = nextReview;
    const preview = f.service.previewBoardFlow(board.id, draft, board.version);
    assert.deepEqual(preview.typeChanges.map((s) => [s.shortId, s.type]), [["S3", "agent"]]);
    const changed = f.service.save("boards", draft, board.id, board.version);
    f.service.setState(item.executionId, "running");
    assert.throws(() => f.service.advance(item.id, done.id, "越过验收", randomUUID(), item.executionId));
    const queued = f.service.advance(item.id, review.id, "交验", randomUUID(), item.executionId);
    const snapshot = JSON.parse(f.service.execution(f.store.get("items", queued.id).executionId).snapshot);
    assert.equal(snapshot.stage.instructions, "新验收");
    const revert = { ...changed, stages: [start, agent, review, done] };
    assert.throws(() => f.service.save("boards", revert, board.id, changed.version), /S3 · 验收.*类型/);
  } finally {
    f.close();
  }
});

test("已排队任务使用最新并发上限，派发指令仍取入队快照", async () => {
  const f = fixture();
  try {
    const board = f.service.save("boards", boardInput(f));
    const [start, agent, done] = board.stages;
    const items = Array.from({ length: 4 }, () => {
      const item = f.service.createItem({ boardId: board.id, title: "排队" });
      f.service.advance(item.id, agent.id, "开始", randomUUID());
      return f.store.get("items", item.id);
    });
    const draft = { ...board, stages: [start, { ...agent, concurrency: 3, instructions: "新指令" }, done] };
    const raised = f.service.save("boards", draft, board.id, board.version);
    const dispatched: string[] = [];
    f.service.peers.set(f.environment.id, { call: async (_: string, p: any) => {
      dispatched.push(p.workflow.instructions);
      return { status: "running" };
    } } as any);
    await f.service.tick();
    assert.deepEqual(dispatched, ["", "", ""]);
    draft.stages[1].concurrency = 1;
    f.service.save("boards", draft, board.id, raised.version);
    for (const item of items.slice(0, 2)) f.service.setState(item.executionId, "completed");
    await f.service.tick();
    assert.equal(dispatched.length, 3);
    f.service.setState(items[2].executionId, "completed");
    await f.service.tick();
    assert.equal(dispatched.length, 4);
    const retry = f.service.retry(items[0].id);
    assert.equal(JSON.parse(f.service.execution(retry.executionId).snapshot).stage.instructions, "新指令");
  } finally {
    f.close();
  }
});
