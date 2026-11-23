import { randomUUID } from "node:crypto";
import { nodeAuthVersion, nodeProofText } from "../src/shared/node-identity.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";
import { readConnectorVersion } from "../src/connector/version.js";
import {
  readConnectorRelease,
  connectorUpdate,
  renderInstaller,
} from "../src/server/connector-release.js";
import { createApp } from "../src/server/app.js";
import { ConnectorConfig } from "../src/connector/config.js";
import { execFileSync } from "node:child_process";
import { RpcPeer } from "../src/shared/rpc.js";

/** 临时发行清单与空归档只验证版本判定，不冒充可安装发行包。 */
function releaseFixture() {
  const dir = mkdtempSync(join(tmpdir(), "relay-version-"));
  const version = "0.1.0-abcdef012345";
  mkdirSync(join(dir, "downloads"));
  const releases = ["linux", "windows"].map((platform) => ({
    platform,
    arch: "x64",
    file: `bugpaw-relay-${version}-${platform}-x64.${platform === "windows" ? "zip" : "tar.gz"}`,
  }));
  const metadata = { version, releases };
  const path = join(dir, "downloads/release.json");
  writeFileSync(path, JSON.stringify(metadata), "utf8");
  for (const release of releases)
    writeFileSync(join(dir, "downloads", release.file), "fixture");
  return { dir, version, metadata, path };
}

test("连接器使用包内完整版本，缺失或损坏时保持未知", () => {
  const f = releaseFixture();
  try {
    assert.equal(readConnectorVersion(f.path), f.version);
    assert.equal(readConnectorVersion(join(f.dir, "missing")), null);
    for (const data of [
      "{",
      JSON.stringify({ version: "../../bad" }),
      JSON.stringify({ version: "" }),
    ]) {
      writeFileSync(f.path, data, "utf8");
      assert.equal(readConnectorVersion(f.path), null);
    }
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("比较当前下载版本、提交后缀与平台，不按服务端版本或字符串排序", () => {
  const f = releaseFixture();
  try {
    const release = readConnectorRelease(f.dir)!;
    assert.equal(
      connectorUpdate(f.version, "win32/x64", release).status,
      "current",
    );
    const changed = connectorUpdate("0.1.0-ffffffffffff", "linux/x64", release);
    assert.equal(changed.status, "different");
    assert.equal(
      changed.downloadUrl,
      "/downloads/" + f.metadata.releases[0].file,
    );
    assert.equal(
      connectorUpdate("9.0.0", "win32/x64", release).status,
      "different",
    );
    assert.equal(
      connectorUpdate(undefined, "win32/x64", release).status,
      "unknown",
    );
    assert.equal(
      connectorUpdate(null, "linux/arm64", release).downloadUrl,
      null,
    );
    assert.equal(
      connectorUpdate(f.version, "win32/x64", null).status,
      "unavailable",
    );
    assert.equal(readConnectorRelease(), null);
    rmSync(join(f.dir, "downloads", f.metadata.releases[0].file));
    assert.equal(readConnectorRelease(f.dir), null);
    writeFileSync(
      f.path,
      JSON.stringify({
        ...f.metadata,
        releases: [{ platform: "linux", arch: "x64", file: "../../secret" }],
      }),
    );
    assert.equal(readConnectorRelease(f.dir), null);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

/** 使用真实签名和 WSS 路由验证可选版本上报兼容，以及重连清除过期版本。 */
test("版本上报随认证持久化，未上报版本的客户端可连接且不会继承历史版本", async () => {
  const f = releaseFixture();
  const { app, store, service } = await createApp({
    dataDir: join(f.dir, "data"),
    publicUrl: "http://127.0.0.1",
    webDir: f.dir,
    secureCookie: false,
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const environment = store.put("environments", {
    name: "fixture",
    approved: true,
    connectorVersion: "9.0.0",
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `ws://127.0.0.1:${(app.server.address() as any).port}`;
  let socket: WebSocket | undefined;
  try {
    for (const version of [undefined, "0.2.0", f.version, undefined]) {
      socket = new WebSocket(base + "/api/node/connect");
      const ws = socket;
      const peer = new RpcPeer(
        (data) => ws.send(data),
        async (method, params) => {
          if (method === "identity.challenge")
            return peer.call("identity.authenticate", {
              authVersion: nodeAuthVersion,
              environmentId: environment.id,
              signature: sign(
                null,
                Buffer.from(
                  nodeProofText(
                    params.audience,
                    "connect",
                    environment.id,
                    environment.publicKey,
                    "",
                    params.challenge,
                  ),
                ),
                privateKey,
              ).toString("base64"),
              protocol: 1,
              roots: [],
              tools: {},
              platform: "win32/x64",
              ...(version ? { connectorVersion: version } : {}),
            });
          return { status: "not_found" };
        },
      );
      ws.on("message", (data) => void peer.receive(data.toString()));
      const deadline = Date.now() + 4000;
      while (!service.peers.has(environment.id) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 10));
      assert.ok(service.peers.has(environment.id));
      assert.equal(
        store.get("environments", environment.id).connectorVersion,
        version || null,
      );
      const row = service.list("environments")[0];
      assert.equal(
        row.connectorUpdate.status,
        !version ? "unknown" : version === f.version ? "current" : "different",
      );
      ws.close();
      await new Promise((resolve) => ws.once("close", resolve));
      peer.close();
      while (service.peers.has(environment.id) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    socket?.terminate();
    await app.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

/** 下载器使用临时凭证；验证授权、断点续传与失效文件的 HTTP 语义。 */
test("下载文件临时授权 GET HEAD Range，失效链接不回退网页", async () => {
  const f = releaseFixture();
  writeFileSync(
    join(f.dir, "index.html"),
    "<!doctype html><title>fixture</title>",
  );
  const { app, store } = await createApp({
    dataDir: join(f.dir, "data"),
    publicUrl: "http://localhost",
    webDir: f.dir,
  });
  const { digest } = await import("../src/server/security.js");
  const cookie = randomUUID();
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 60000);
  try {
    for (const item of f.metadata.releases) {
      assert.equal(
        (await app.inject({ url: "/downloads/" + item.file })).statusCode,
        401,
      );
      const issued = await app.inject({
        method: "POST",
        url: "/api/connector-downloads",
        headers: {
          origin: "http://localhost",
          cookie: "relay_session=" + cookie,
        },
        payload: { file: item.file },
      });
      assert.equal(issued.statusCode, 200, issued.body);
      const url = issued.json().url;
      const get = await app.inject({ url });
      assert.equal(get.statusCode, 200);
      assert.equal(get.body, "fixture");
      assert.ok(!get.headers["content-type"]?.includes("text/html"));
      const head = await app.inject({ method: "HEAD", url });
      assert.equal(head.statusCode, 200);
      assert.equal(Number(head.headers["content-length"]), 7);
      const range = await app.inject({ url, headers: { range: "bytes=0-2" } });
      assert.equal(range.statusCode, 206);
      assert.equal(range.body, "fix");
    }
    for (const method of ["GET", "HEAD"] as const) {
      const missing = await app.inject({
        method,
        url: "/downloads/bugpaw-relay-0.1.0-windows-x64.zip?download=1",
      });
      assert.equal(missing.statusCode, 401);
      assert.ok(missing.headers["content-type"]?.includes("application/json"));
    }
    assert.equal((await app.inject({ url: "/workbench" })).statusCode, 200);
  } finally {
    await app.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

/** 部署地址与实际下载版本必须保持一致，伪造代理头不能改变生成结果。 */
test("安装脚本使用部署配置和当前发行清单，支持 HEAD 并拒绝缺失发行包", async () => {
  const f = releaseFixture();
  for (const name of ["install.sh", "install.ps1"])
    writeFileSync(join(f.dir, name), readFileSync("public/" + name));
  const { app } = await createApp({
    dataDir: join(f.dir, "data"),
    publicUrl: "https://deployment.example.invalid:8443",
    webDir: f.dir,
  });
  try {
    for (const [name, platform] of [
      ["install.sh", "linux"],
      ["install.ps1", "windows"],
    ]) {
      const response = await app.inject({
        url: "/" + name,
        headers: {
          host: "attacker.invalid",
          "x-forwarded-host": "attacker.invalid",
        },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.match(response.body, /https:\/\/deployment.example.invalid:8443/);
      assert.ok(
        response.body.includes(
          f.metadata.releases.find((r) => r.platform === platform)!.file,
        ),
      );
      assert.ok(!response.body.includes("__BUGPAW_SERVER_URL__"));
      assert.ok(!response.body.includes("__BUGPAW_PACKAGE__"));
      assert.ok(!response.body.includes("attacker.invalid"));
      if (platform === "linux")
        execFileSync("bash", ["-n"], { input: response.body });
      else {
        assert.ok(response.body.includes("$packageDirectory = $Package -replace"));
        assert.ok(response.body.includes("($packageDirectory + '\\*')"));
      }
      const head = await app.inject({ method: "HEAD", url: "/" + name });
      assert.equal(head.statusCode, 200);
      assert.equal(head.body, "");
    }
    rmSync(join(f.dir, "downloads", f.metadata.releases[0].file));
    const missing = await app.inject({ url: "/install.sh" });
    assert.equal(missing.statusCode, 503);
    assert.equal(missing.headers["cache-control"], "no-store");
  } finally {
    await app.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

/** 未配置时可打开控制台，但不能保存空地址或使用空地址注册。 */
test("连接器首次默认值不绑定部署，环境变量不覆盖已有配置", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-config-default-"));
  const previous = process.env.BUGPAW_SERVER_URL;
  try {
    delete process.env.BUGPAW_SERVER_URL;
    const config = new ConnectorConfig(dir);
    assert.equal(config.public().serverUrl, "");
    assert.throws(() => config.update(config.public()));
    await assert.rejects(config.register("fixture-code"));
    process.env.BUGPAW_SERVER_URL = "https://deployment.example.invalid";
    assert.equal(config.public().serverUrl, process.env.BUGPAW_SERVER_URL);
    config.update({ ...config.public(), roots: [{ id: "root", path: dir }] });
    process.env.BUGPAW_SERVER_URL = "https://other.example.invalid";
    assert.equal(
      config.public().serverUrl,
      "https://deployment.example.invalid",
    );
  } finally {
    if (previous === undefined) delete process.env.BUGPAW_SERVER_URL;
    else process.env.BUGPAW_SERVER_URL = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 动态脚本只嵌入安全字面值，不允许 URL 凭据进入公开下载脚本。 */
test("安装模板拒绝凭据 URL 并保持 shell 字面值边界", () => {
  const f = releaseFixture();
  try {
    const release = readConnectorRelease(f.dir)!;
    for (const platform of ["linux", "windows"] as const) {
      assert.throws(() =>
        renderInstaller(
          "",
          platform,
          "https://user:fixture@example.invalid",
          release,
        ),
      );
      assert.throws(() =>
        renderInstaller("", platform, "file:///tmp/fixture", release),
      );
    }
    const rendered = renderInstaller(
      "printf '%s' '__BUGPAW_SERVER_URL__'",
      "linux",
      "https://a'b.example.invalid",
      release,
    );
    assert.equal(
      execFileSync("bash", ["-c", rendered], { encoding: "utf8" }),
      "https://a'b.example.invalid",
    );
    assert.equal(
      renderInstaller(
        "'__BUGPAW_SERVER_URL__'",
        "windows",
        "https://a'b.example.invalid",
        release,
      ),
      "'https://a''b.example.invalid'",
    );
    // 未渲染的源码脚本必须在下载前失败，不能把占位符当作远端地址。
    assert.throws(() =>
      execFileSync("bash", ["public/install.sh"], {
        env: { ...process.env, BUGPAW_SERVER_URL: "", BUGPAW_PACKAGE: "" },
        stdio: "pipe",
      }),
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
