import { attachmentExamples, checkAttachmentExamples } from "./attachment-markdown-fixture.js";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import {
  EnvironmentFiles,
  normalizeEnvironmentFilePath,
} from "../src/connector/files.js";
test.use({ hasTouch: true });

/** 真实页面、HTTP 和磁盘读取；人工延迟确保进度和取消可观察。 */
test("环境文件弹窗、分块进度、文本图片视频预览、下载与手机红字提示", async ({
  page,
  context,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "relay-file-browser-"));
  const root = join(dir, "files");
  await mkdir(root);
  const longLine = "  环境文件内容 /workspace/" + "LongPath".repeat(55);
  const sample = [
    "# 文件标题", "", "| 列 |", "| --- |", "| 值 |", "",
    "```js", "const value = 1;", "```", "", "- 列表与 `code`",
    "[文字](https://example.invalid/link)", "![图片](https://example.invalid/image)",
    "<script>window.previewExecuted = true</script>",
  ];
  const content = sample.join("\n") + "\n".repeat(30 - sample.length) +
    longLine + "\n\n" + attachmentExamples + "\n\n" + "正文内容 ".repeat(30000) + "\n".repeat(10000) + "截断之后";
  await writeFile(join(root, "报告 文件.md"), content);
  await writeFile(join(root, "README.MD"), sample.join("\n") + "\n\n" + attachmentExamples);
  await writeFile(join(root, "notes.txt"), "# 普通文本");
  await writeFile(join(root, "empty.md"), "");
  await writeFile(join(root, "bad.md"), Buffer.from([0xff]));
  await writeFile(join(root, "large.md"), Buffer.alloc(2 * 1024 ** 2 + 1));
  await writeFile(join(root, "archive.zip"), "unsupported");
  await writeFile(join(root, "empty.txt"), "");
  await writeFile(
    join(root, "image.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const reader = new EnvironmentFiles(() => [{ id: "root", path: root }]);
  const appOptions = {
    dataDir: join(dir, "data"),
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(appOptions);
  service.saveLanguage({ preference: "zh-CN" });
  const cookie = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const env = store.put("environments", {
    name: "文件测试环境",
    approved: true,
    revoked: false,
    capabilities: ["files-v1"],
  });
  const project = service.save("projects", {
    name: "文件测试",
    directories: [{ environmentId: env.id, rootId: "root", relativePath: "." }],
  });
  let reads = 0,
    slow = false;
  const reply = `\n\`\`\`js\n${longLine}\n\`\`\`\n\n[Windows 原路径](F:%5Ccodex-hir-test-20261111.txt) · [Windows URL 路径](/F:/codex-hir-test-20261111.txt%3A12)\n\n[文本产物](<./报告 文件.md#L30>)\n\n[阶段文档](README.MD) · [纯文本](notes.txt) · [空文档](empty.md) · [编码错误](bad.md) · [超限文档](large.md) · [图片产物](image.png) · [视频产物](movie.webm) · [压缩包](archive.zip) · [空文件](empty.txt) · [不存在](missing.txt) · [普通网页](https://example.com/document.pdf)\n\n[危险链接](javascript:alert(1))`;
  const peer = {
    call: async (m: string, p: any) => {
      if (m === "session.history")
        return {
          events: [
            {
              type: "item/completed",
              data: { item: { type: "agentMessage", text: reply } },
            },
          ],
          interactions: [],
          status: "idle",
        };
      if (m === "files.read") {
        reads++;
        await new Promise((r) => setTimeout(r, slow ? 700 : 140));
      }
      // Linux 浏览器测试仅模拟 Windows 盘符映射；路径规范化使用真实产品函数。
      if (m.startsWith("files.") && /^(?:F:|\/F:)/.test(p.source.path)) {
        const normalized = normalizeEnvironmentFilePath(p.source.path, "win32");
        expect(normalized.replaceAll("\\", "/")).toBe(
          "F:/codex-hir-test-20261111.txt",
        );
        p = { ...p, source: { ...p.source, path: join(root, "报告 文件.md") } };
      }
      if (m.startsWith("execution.")) return { status: "running", stateVersion: 1 };
      return reader.call(m, p);
    },
    close: () => {},
  };
  service.peers.set(env.id, peer as any);
  const session = service.createSession({
    agentId: service.save("agents", { name: "Fixture agent" }).id,
    title: "文件测试会话",
    projectId: project.id,
    environmentId: env.id,
    rootId: "root",
    runtime: "codex",
  });
  const otherSession = service.createSession({
    agentId: service.save("agents", { name: "Fixture agent" }).id,
    title: "另一会话",
    projectId: project.id,
    environmentId: env.id,
    rootId: "root",
    runtime: "claude",
  });
  service.saveLanguage({ preference: "zh-CN" });
  const metadataRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/sessions\/[^/]+\/files$/.test(request.url()))
      metadataRequests.push(request.url());
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  await context.addCookies([
    { name: "relay_session", value: cookie, url: base },
  ]);
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.invalid/")) external.push(request.url());
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/#chat/" + session.id);
    await expect(
      page.getByRole("button", { name: "文本产物", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "普通网页" })).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(page.getByRole("link", { name: "普通网页" })).toHaveAttribute(
      "href",
      "https://example.com/document.pdf",
    );
    await expect(page.locator('[href^="javascript:"]')).toHaveCount(0);
    // 浏览器产生真实可解码视频，避免将伪造字节当作视频播放验证。
    const movie = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#5f7088";
      ctx.fillRect(0, 0, 64, 64);
      const stream = canvas.captureStream(5),
        recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      const complete = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks));
      });
      recorder.start();
      await new Promise((r) => setTimeout(r, 350));
      recorder.stop();
      const blob = await complete;
      stream.getTracks().forEach((t) => t.stop());
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await writeFile(join(root, "movie.webm"), Buffer.from(movie));
    await page.getByRole("button", { name: "文本产物", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("报告 文件.md", { exact: true }),
    ).toBeVisible();
    expect(reads).toBe(0);
    // 路由切换必须先丢弃旧文件上下文，不能向新会话请求旧路径。
    await page.evaluate((id) => {
      location.hash = "#chat/" + id;
    }, otherSession.id);
    await expect(dialog).not.toBeVisible();
    await page.waitForTimeout(200);
    expect(metadataRequests).toHaveLength(1);
    await page.evaluate((id) => {
      location.hash = "#chat/" + id;
    }, session.id);
    await page.setViewportSize({ width: 320, height: 740 });
    const code = page.locator(".markdown-code-block");
    await expect(code.getByText("js", { exact: true })).toBeVisible();
    await expect(code.getByRole("button", { name: "复制代码" })).toBeVisible();
    expect(await code.locator("pre").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "文本产物", exact: true }).click();
    await expect(
      dialog.getByText("报告 文件.md", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(dialog.getByLabel("文件传输进度")).toBeVisible();
    await expect(dialog.locator(".file-progress")).toContainText("/s");
    const formatted = dialog.locator(".artifact-markdown");
    await expect(formatted.getByRole("heading", { name: "文件标题" })).toBeVisible({ timeout: 30000 });
    await checkAttachmentExamples(formatted);
    await expect(formatted.locator("pre code").first()).toHaveText("const value = 1;\n");
    await expect(formatted.locator("a,img:not(.attachment-diagram img),script")).toHaveCount(0);
    await expect(formatted).not.toContainText("截断之后");
    await expect(dialog.locator(".file-warning").first()).toContainText("10000");
    const renderedReads = reads;
    const raw = dialog.getByRole("button", { name: "原始文本" });
    const markdown = dialog.getByRole("button", { name: "Markdown" });
    await expect(markdown).toHaveAttribute("aria-pressed", "true");
    await raw.focus();
    await page.keyboard.press("Enter");
    await expect(raw).toBeFocused();
    await expect(raw).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator(".file-line")).toHaveCount(10000);
    await expect(dialog.locator(".file-line code").first()).toHaveText("# 文件标题");
    await expect(dialog.locator(".file-warning").first()).toContainText("10000");
    await expect(dialog.getByLabel("文本预览")).toBeVisible();
    const selected = dialog.locator(".file-line.selected");
    await expect(selected.locator("span")).toHaveText("30");
    expect(await selected.locator("code").textContent()).toBe(longLine);
    await expect(dialog.locator(".file-line").nth(30).locator("span")).toHaveText("31");
    const geometry = await selected.evaluate((el) => {
      const viewport = el.parentElement!;
      const bounds = el.getBoundingClientRect();
      const visible = viewport.getBoundingClientRect();
      return {
        height: bounds.height,
        top: bounds.top - visible.top,
        viewportHeight: visible.height,
        horizontalOverflow: viewport.scrollWidth - viewport.clientWidth,
      };
    });
    expect(geometry.height).toBeGreaterThan(40);
    expect(geometry.top).toBeGreaterThanOrEqual(-1);
    expect(geometry.top).toBeLessThan(geometry.viewportHeight);
    expect(geometry.horizontalOverflow).toBe(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(reads).toBeGreaterThan(1);
    await page.screenshot({ path: ".vibe/files-desktop.png" });
    await markdown.tap();
    await expect(formatted).toBeVisible();
    expect(reads).toBe(renderedReads);
    expect(external).toEqual([]);
    expect(await page.evaluate(() => "previewExecuted" in window)).toBe(false);
    const saved = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "下载", exact: true }).click();
    const download = await saved;
    expect(download.suggestedFilename()).toBe("报告 文件.md");
    expect(await readFile((await download.path())!, "utf8")).toBe(content);
    await dialog
      .getByRole("button", { name: "关闭", exact: true })
      .last()
      .click();
    await expect(dialog).not.toBeVisible();
    for (const [label, selector] of [
      ["图片产物", "img.file-media"],
      ["视频产物", "video.file-media"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await dialog.getByRole("button", { name: "预览", exact: true }).click();
      await expect(dialog.locator(selector)).toBeVisible();
      await expect
        .poll(() =>
          dialog
            .locator(selector)
            .evaluate((e) =>
              e instanceof HTMLImageElement
                ? e.naturalWidth
                : (e as HTMLVideoElement).videoWidth,
            ),
        )
        .toBeGreaterThan(0);
      await dialog
        .getByRole("button", { name: "关闭", exact: true })
        .last()
        .click();
    }
    for (const label of ["Windows 原路径", "Windows URL 路径"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(
        dialog.getByText("报告 文件.md", { exact: true }),
      ).toBeVisible();
      const saved = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "下载", exact: true }).click();
      const result = await saved;
      expect(await readFile((await result.path())!, "utf8")).toBe(content);
      await dialog
        .getByRole("button", { name: "关闭", exact: true })
        .last()
        .click();
    }
    slow = true;
    await page.getByRole("button", { name: "文本产物", exact: true }).click();
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(dialog.getByLabel("文件传输进度")).toBeVisible();
    await dialog.getByRole("button", { name: "取消传输" }).click();
    await expect(dialog.getByText("传输已取消，可以重新尝试")).toBeVisible();
    await expect(dialog.getByLabel("文本预览")).toHaveCount(0);
    const stoppedAt = reads;
    await page.waitForTimeout(900);
    expect(reads).toBe(stoppedAt);
    await dialog
      .getByRole("button", { name: "关闭", exact: true })
      .last()
      .click();
    slow = false;
    await page.getByRole("button", { name: "不存在", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("文件不存在");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "压缩包", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "预览", exact: true }),
    ).toBeDisabled();
    await expect(dialog.locator(".file-warning").first()).toHaveText(
      "格式不支持，请下载后查看",
    );
    for (const theme of ["light", "dark", "bug"]) {
      await page.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme,
      );
      await expect(dialog.locator(".file-warning").first()).toBeVisible();
      const fits = await dialog.evaluate(
        (e) =>
          e.getBoundingClientRect().width <= innerWidth &&
          e.scrollWidth <= e.clientWidth,
      );
      expect(fits).toBe(true);
    }
    await page.screenshot({ path: ".vibe/files-mobile.png" });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "空文件", exact: true }).click();
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await expect(dialog.getByLabel("文本预览")).toBeVisible();
    await expect(dialog.getByRole("group", { name: "预览模式" })).toHaveCount(0);
    for (const [label, message] of [
      ["纯文本", "# 普通文本"], ["编码错误", "编码"], ["超限文档", "预览上限"],
    ]) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: label, exact: true }).click();
      const preview = dialog.getByRole("button", { name: "预览", exact: true });
      if (label === "超限文档") await expect(preview).toBeDisabled();
      else await preview.click();
      await expect(dialog).toContainText(message);
      await expect(raw).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "下载", exact: true })).toBeEnabled();
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "空文档" }).click();
    await dialog.getByRole("button", { name: "预览", exact: true }).click();
    await raw.tap();
    await expect(dialog.locator(".file-line")).toHaveCount(1);
    await page.keyboard.press("Escape");
    // 从看板创建真实阶段会话，通过同一文件传输入口检查大写后缀和英文模式。
    const stage = randomUUID(), done = randomUUID();
    const board = service.save("boards", {
      name: "文件预览", projectId: project.id, stages: [
        { id: randomUUID(), fixedRole: "start", name: "开始", type: "human", targets: [stage] },
        { id: stage, name: "执行", type: "agent", environmentId: env.id, rootId: "root",
          agentId: session.agentId, targets: [done] },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    const item = service.createItem({ boardId: board.id, startStageId: stage, title: "文档" });
    const execution = service.execution(store.get("items", item.id).executionId);
    service.saveLanguage({ preference: "en" });
    await page.goto(base + "/#chat/" + execution.session_id);
    await page.reload();
    for (const theme of ["light", "dark", "bug"]) {
      await page.evaluate((t) => document.documentElement.dataset.theme = t, theme);
      await page.getByRole("button", { name: "阶段文档" }).click();
      await dialog.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(formatted.getByRole("heading")).toHaveText("文件标题");
      await checkAttachmentExamples(formatted);
      await expect(formatted.locator(".file-warning").first()).toContainText("Cannot display");
      await expect(markdown).toHaveAttribute("aria-pressed", "true");
      await dialog.getByRole("button", { name: "Raw text" }).tap();
      await expect(dialog.getByLabel("Text preview")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
