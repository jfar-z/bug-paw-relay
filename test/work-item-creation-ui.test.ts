import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationApproval, creationTexts } from "../src/web/new-item.js";

/** 双语参数与非空校验防止资源漂移，审批只呈现服务端阶段而不执行内容。 */
test("创建界面双语资源与审批摘要", () => {
  for (const [key, values] of Object.entries(creationTexts)) {
    assert.equal(values.length, 2, key);
    assert.ok(values.every(value => value.trim()), key);
    assert.deepEqual(values[0].match(/\{\w+\}/g), values[1].match(/\{\w+\}/g), key);
  }
  const markup = renderToStaticMarkup(React.createElement(CreationApproval, { arguments: JSON.stringify({ startStage: { id: "fixture", name: "<script>fixture</script>", type: "agent", permission: "full" } }) }));
  assert.match(markup, /完全权限/);
  assert.match(markup, /创建后将按此阶段配置自动执行/);
  assert.match(markup, /class="danger"/);
  assert.ok(!markup.includes("<script>"));
  assert.equal(renderToStaticMarkup(React.createElement(CreationApproval, { arguments: "invalid" })), "");
});
