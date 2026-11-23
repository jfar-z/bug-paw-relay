import test from "node:test";
import assert from "node:assert/strict";
import { insecureModelEndpoint } from "../src/shared/model-endpoint.js";
import { consoleHtml } from "../src/connector/console-ui.js";

test("SEC-08 HTTP 仅对非回环端点提示，不限制输入", () => {
  for (const url of [
    "http://192.168.100.2/v1",
    "HTTP://example.com",
    "http://[::ffff:192.168.1.2]",
  ])
    assert.equal(insecureModelEndpoint(url), true);
  for (const url of [
    "",
    "invalid",
    "https://example.com",
    "http://localhost.",
    "http://127.2.3.4",
    "http://[::1]",
  ])
    assert.equal(insecureModelEndpoint(url), false);
  assert.match(consoleHtml, /id="codexHttpHint"/);
  assert.match(consoleHtml, /id="claudeHttpHint"/);
});
