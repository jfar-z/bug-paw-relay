import test from "node:test";
import assert from "node:assert/strict";
import { sessionDisplay } from "../src/shared/session-display.js";

/** 覆盖 Claude Read、MCP/Codex 图片和未知 JSON 输出；投影不能修改原始数据。 */
test("会话展示剔除图片编码且保留工具标识、文本及元数据", () => {
  const base64 = "aGVsbG8=".repeat(200000).replaceAll("=", "");
  const value = {
    id: "call",
    name: "Read",
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: base64 },
      },
      { type: "image", mimeType: "image/png", data: base64 },
      { type: "input_image", image_url: "data:image/png;base64," + base64 },
      { type: "text", text: "普通结果" },
      {
        type: "unknown",
        payload: JSON.stringify({ nested: { data: base64 } }),
      },
    ],
  };
  const projected = sessionDisplay(value);
  assert.ok(JSON.stringify(projected).length < 2000);
  assert.equal(projected.id, "call");
  assert.equal(projected.content[3].text, "普通结果");
  assert.equal(projected.content[0].source?.media_type, "image/png");
  assert.equal(value.content[0].source?.data, base64);
  assert.match(JSON.stringify(projected), /省略/);
  assert.equal(
    sessionDisplay(projected).content[0].source?.data,
    projected.content[0].source?.data,
  );
});

/** 不可解析的工具文本仍可查看，但超大输出不直接交给 DOM。 */
test("未知输出限制展示长度并保留失败状态和布尔参数", () => {
  const output = sessionDisplay({
    status: "failed",
    input: false,
    output: "普通输出\n".repeat(10000),
  });
  assert.equal(output.status, "failed");
  assert.equal(output.input, false);
  assert.ok(output.output.length < 33000);
  assert.match(output.output, /展示内容已截断/);
});

/** 显式位置标记防止把用户碰巧输入的相同中文提示当作产品文案翻译。 */
test("展示提示按元数据切换语言且用户正文不变", async () => {
  const { sessionProjection, localizeProjection } =
    await import("../src/shared/session-display.js");
  const value = {
    user: "[内嵌二进制已省略]",
    output: "data:image/png;base64," + "a".repeat(2048),
  };
  const projection = sessionProjection(value);
  const english = localizeProjection(
    projection.value,
    projection.notices,
    "en",
  );
  assert.equal(english.user, value.user);
  assert.equal(english.output, "[Embedded binary omitted]");
  assert.equal(
    localizeProjection(projection.value, projection.notices, "zh-CN").output,
    "[内嵌二进制已省略]",
  );
  assert.equal(value.output.length, 2070);
});

/** 短文本快速路径须保留内嵌数据、显式二进制字段和长编码的边界语义。 */
test("短文本保留原文，短内嵌数据和达到阈值的编码仍省略", () => {
  const short = "a".repeat(1023);
  assert.equal(sessionDisplay(short), short);
  for (const length of [1024, 1025])
    assert.equal(sessionDisplay("a".repeat(length)), "[长编码数据已省略]");
  assert.deepEqual(
    sessionDisplay({ text: "前 data:image/png;base64,YQ== 后", bytes: "YQ==" }),
    { text: "前 [内嵌二进制已省略] 后", bytes: "[二进制内容已省略，4 字符]" },
  );
});
