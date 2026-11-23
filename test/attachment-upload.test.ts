import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { uploadAttachment } from "../src/web/attachment-upload.js";
import { FILE_CHUNK_SIZE } from "../src/shared/files.js";

const receipt = {
  name: "附件.txt",
  size: 0,
  path: "attachments/relay-00000000-0000-0000-0000-000000000000/a.txt",
  version: "a".repeat(64),
  sha256: "b".repeat(64),
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });

/** 使用浏览器同款 File/fetch 协议，验证有界读取、确认进度及取消清理，不启动模型。 */
test("浏览器上传分块摘要及偏移确认，零字节文件直接完成", async () => {
  const original = globalThis.fetch;
  try {
    for (const size of [0, FILE_CHUNK_SIZE * 2 + 17]) {
      const bytes = Buffer.alloc(size, 127);
      let offset = 0,
        writes = 0,
        finished = false;
      const progress: number[] = [];
      globalThis.fetch = async (url, options) => {
        const data = options?.body ? JSON.parse(String(options.body)) : null;
        assert.equal(options?.cache, "no-store");
        if (String(url).endsWith("/uploads")) return json({ id: "batch" });
        if (String(url).endsWith("/write")) {
          const chunk = Buffer.from(data.data, "base64");
          assert(chunk.length <= FILE_CHUNK_SIZE);
          assert.equal(data.offset, offset);
          assert.equal(
            data.sha256,
            createHash("sha256").update(chunk).digest("hex"),
          );
          assert.deepEqual(
            chunk,
            bytes.subarray(offset, offset + chunk.length),
          );
          offset += chunk.length;
          writes++;
          return json({ offset });
        }
        assert(String(url).endsWith("/finish"));
        assert.equal(offset, size);
        finished = true;
        return json({ files: [{ ...receipt, size }] });
      };
      const result = await uploadAttachment(
        "session",
        new File([bytes], receipt.name),
        new AbortController().signal,
        (p) => progress.push(p.received),
      );
      assert.equal(result.size, size);
      assert.equal(writes, Math.ceil(size / FILE_CHUNK_SIZE));
      assert.equal(progress.at(-1), size);
      assert(finished);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("创建响应迟到时仍取消批次，DELETE 不带空 JSON 类型且不再发送分块", async () => {
  const original = globalThis.fetch;
  const abort = new AbortController();
  const calls: string[] = [];
  let release!: () => void;
  const created = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).endsWith("/uploads")) {
      await created;
      return json({ id: "late" });
    }
    assert.equal(options?.method, "DELETE");
    assert.equal(new Headers(options?.headers).has("Content-Type"), false);
    return json({ ok: true });
  };
  try {
    const upload = uploadAttachment(
      "session",
      new File(["x"], receipt.name),
      abort.signal,
      () => {},
    );
    abort.abort();
    release();
    await assert.rejects(upload, { name: "AbortError" });
    assert.deepEqual(calls, [
      "/api/sessions/session/uploads",
      "/api/file-uploads/late",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

/** 用户原文的 HTML 作为文字保留，不能因附件 Markdown 展示而丢失或执行。 */
test("附件历史保持用户 HTML 原文且不创建活动标签", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { WorkbenchMarkdown } = await import("../src/web/workbench-content.js");
  const html = renderToStaticMarkup(
    createElement(WorkbenchMarkdown, {
      text: '<script>alert("user text")</script>',
      sessionId: "fixture",
      onFile: () => {},
    }),
  );
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;script&gt;"));
});
