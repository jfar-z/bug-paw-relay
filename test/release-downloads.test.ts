import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { Vault, digest } from "../src/server/security.js";

/** 只使用几个字节的假发行包，不通过真实带宽攻击验证保护。 */
test("SEC-20 登录签发、过期/文件绑定/注销、配置持久化与静态旁路", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-download-"));
  const webDir = join(dir, "web");
  mkdirSync(join(webDir, "downloads"), { recursive: true });
  const file = "bugpaw-relay-0.2.1-linux-x64.tar.gz";
  writeFileSync(join(webDir, "downloads", file), "fixture");
  writeFileSync(join(webDir, "downloads", file + ".sha256"), "checksum");
  writeFileSync(
    join(webDir, "downloads/release.json"),
    JSON.stringify({
      version: "0.2.1",
      releases: [{ file, platform: "linux", arch: "x64" }],
    }),
  );
  writeFileSync(join(webDir, "index.html"), "<html>app</html>");
  const dataDir = join(dir, "data");
  const { app, store } = await createApp({
    dataDir,
    webDir,
    publicUrl: "http://localhost",
  });
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const raw = randomUUID();
  const owner = digest(raw);
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(owner, "owner", Date.now() + 86400000);
  const headers = {
    origin: "http://localhost",
    cookie: "relay_session=" + raw,
  };
  const issue = () =>
    app.inject({
      method: "POST",
      url: "/api/connector-downloads",
      headers,
      payload: { file },
    });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/connector-downloads",
        headers: { origin: headers.origin },
        payload: { file },
      })
    ).statusCode,
    401,
  );
  const before = Date.now();
  const ticket = (await issue()).json();
  assert.ok(
    ticket.expiresAt >= before + 600000 &&
      ticket.expiresAt <= Date.now() + 600000,
  );
  assert.ok(!ticket.url.includes(raw));
  assert.equal((await app.inject(ticket.url)).body, "fixture");
  assert.equal(
    (await app.inject(ticket.url.replace(file, file + ".sha256"))).body,
    "checksum",
  );
  assert.equal(
    (await app.inject(ticket.url.replace(file, "other.zip"))).statusCode,
    403,
  );
  for (const path of [
    `/downloads/${file}`,
    `/%64ownloads/${file}`,
    `/downloads%2f${file}`,
    `/downloads//${file}`,
    `/downloads/../downloads/${file}`,
    `/downloads/${file}?grant=fake`,
  ]) {
    const r = await app.inject(path);
    assert.notEqual(r.body, "fixture", path);
    assert.notEqual(r.statusCode, 200, path);
  }
  const expired = Buffer.from(
    new Vault(dataDir).seal(
      JSON.stringify({
        purpose: "release-download",
        owner,
        file,
        expiresAt: Date.now() - 1,
      }),
    ),
    "base64",
  ).toString("base64url");
  assert.equal(
    (await app.inject(`/downloads/${file}?grant=${expired}`)).statusCode,
    403,
  );
  const saved = await app.inject({
    method: "POST",
    url: "/api/settings/downloads",
    headers,
    payload: { expiresMinutes: 20, version: 0 },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(
    (await app.inject({ url: "/api/settings/downloads", headers })).json()
      .expiresMinutes,
    20,
  );
  const second = (await issue()).json();
  assert.ok(second.expiresAt > Date.now() + 1199000);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/settings/downloads",
        headers,
        payload: { expiresMinutes: 0, version: saved.json().version },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/settings/downloads",
        headers,
        payload: { expiresMinutes: 5, version: 0 },
      })
    ).statusCode,
    409,
  );
  store.db.prepare("DELETE FROM auth_sessions WHERE hash=?").run(owner);
  assert.equal((await app.inject(ticket.url)).statusCode, 401);
});
