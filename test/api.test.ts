import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/web/api.js";

/** 覆盖代理错误页、损坏响应及写请求不重放，不使用真实服务或凭据。 */
test("API 响应异常提供可读错误，保留业务错误且不重试写入", async (t) => {
  let calls = 0;
  let response = new Response();
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return response;
  });
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  )!;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  t.after(() =>
    Object.defineProperty(globalThis, "navigator", originalNavigator),
  );
  for (const status of [200, 401, 502, 503, 504]) {
    response = new Response("<html><h1>private proxy details</h1></html>", {
      status,
      headers: { "content-type": "text/html" },
    });
    await assert.rejects(api("/state"), (error: Error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.match(error.message, /\/api\/state/);
      assert.doesNotMatch(
        error.message,
        /Unexpected token|private proxy details|<html>/,
      );
      return true;
    });
  }
  response = new Response("<html>broken</html>", {
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(api("/state"), /The service returned unexpected data/);
  response = Response.json({ message: "无权操作" }, { status: 403 });
  // 旧服务端没有结构化键时，不解析或透传未知正文。
  await assert.rejects(api("/state"), (error: Error) => {
    assert.doesNotMatch(error.message, /无权操作/);
    assert.match(error.message, /Operation failed/);
    return true;
  });
  response = Response.json(null, { status: 500 });
  await assert.rejects(api("/state"), /The service is temporarily unavailable/);
  response = Response.json({ ok: true });
  assert.deepEqual(await api("/state"), { ok: true });
  response = new Response(null, { status: 204 });
  assert.equal(await api("/state"), undefined);
  response = new Response("<html>bad gateway</html>", { status: 502 });
  const before = calls;
  await assert.rejects(
    api("/sessions/test/send", { text: "测试" }),
    /HTTP 502/,
  );
  assert.equal(calls, before + 1);
});
