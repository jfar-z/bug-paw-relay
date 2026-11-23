import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** 个人头像只能由登录用户同源修改，不泄露身份或允许越界账号更新。 */
test("个人头像鉴权、字段白名单及持久化", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-avatar-api-"));
  const { app, store } = await createApp({
    dataDir: dir,
    publicUrl: "http://localhost",
    secureCookie: false,
  });
  try {
    store.put(
      "users",
      { username: "avatar-test", password: "unchanged" },
      "owner",
    );
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest("avatar-fixture"), "owner", Date.now() + 60000);
    const headers = {
      origin: "http://localhost",
      cookie: "relay_session=avatar-fixture",
    };
    const avatar = "data:image/webp;base64,UklGRg==";
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/avatar",
          headers: { origin: "http://localhost" },
          payload: { avatar },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/avatar",
          headers: { ...headers, origin: "https://example.invalid" },
          payload: { avatar },
        })
      ).statusCode,
      403,
    );
    for (const payload of [
      { avatar: "data:image/svg+xml;base64,AAAA" },
      { avatar, username: "changed" },
      { avatar: avatar + "A".repeat(350000) },
    ]) {
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/avatar",
            headers,
            payload,
          })
        ).statusCode,
        400,
      );
    }
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/avatar",
          headers,
          payload: { avatar },
        })
      ).statusCode,
      200,
    );
    assert.equal(store.get("users", "owner").avatar, avatar);
    assert.equal(store.get("users", "owner").password, "unchanged");
    const authenticated = (
      await app.inject({ url: "/api/auth/status", headers })
    ).json();
    assert.equal(authenticated.avatar, avatar);
    assert.equal(authenticated.password, undefined);
    const anonymous = (await app.inject({ url: "/api/auth/status" })).json();
    assert.equal(anonymous.avatar, undefined);
    assert.equal(anonymous.username, undefined);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
