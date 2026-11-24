import { attachmentExamples, checkAttachmentExamples, flow, invalid } from "./attachment-markdown-fixture.js";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { EnvironmentFiles } from "../src/connector/files.js";
import { digest } from "../src/server/security.js";

test.use({ hasTouch: true });

/** 真正上传后断开环境，验证交接产物和配置在桌面、手机的完整交互。 */
test("阶段产物开关持久化、离线交接预览下载、HTML 隔离与手机布局", async ({
  page,
  context,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "relay-artifacts-browser-"));
  const root = join(dir, "root");
  await mkdir(root);
  const codeBody = "  " + JSON.stringify({ url: "https://example.com/" + "abc".repeat(160) }) + "\n\n";
  const report = "# 交付报告\n\n**已完成**\n\n" +
    "```json\n" + codeBody + "```\n\n" + attachmentExamples;
  await writeFile(join(root, "report.md"), report);
  await writeFile(join(root, "report.txt"), codeBody);
  await writeFile(
    join(root, "report.html"),
    '<h1>静态测试报告</h1><script>parent.document.body.dataset.unsafe="yes"</script><img src="https://example.com/leak"><a href="https://example.com">外部导航</a>',
  );
  await writeFile(join(root, "archive.zip"), "下载文件内容");
  // 生成有效的单页 PDF，浏览器使用内置阅读器，正文不含脚本。
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  const stream = "BT /F1 18 Tf 40 700 Td (Artifact report) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await writeFile(join(root, "document.pdf"), pdf);

  const appOptions = {
    dataDir: join(dir, "data"),
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service, artifacts } = await createApp(appOptions);
  try {
    store.put("users", { username: "fixture" }, "owner");
    service.saveLanguage({ preference: "zh-CN" });
    const cookie = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(cookie), "owner", Date.now() + 600000);
    const env = store.put("environments", {
      name: "产物环境",
      approved: true,
      capabilities: ["files-v1"],
    });
    const project = service.save("projects", {
      name: "交付项目",
      directories: [
        { environmentId: env.id, rootId: "root", relativePath: "." },
      ],
    });
    const agent = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "交付流程",
      projectId: project.id,
      stages: [
        {
          id: randomUUID(),
          fixedRole: "start",
          name: "未开始",
          type: "human",
          targets: [agent],
        },
        {
          id: agent,
          name: "执行",
          type: "agent",
          agentId: service.save("agents", { name: "Fixture agent" }).id,
          targets: [done],
          environmentId: env.id,
          rootId: "root",
          allowArtifacts: true,
        },
        { id: done, name: "已完成", type: "done", targets: [] },
      ],
    });
    const reader = new EnvironmentFiles(() => [{ id: "root", path: root }]);
    const peer: any = {
      call: (m: string, p: any) => reader.call(m, p),
      close: () => {},
    };
    service.peers.set(env.id, peer);
    const item = service.createItem({
      boardId: board.id,
      startStageId: agent,
      title: "交付测试产物",
    });
    const executionId = store.get("items", item.id).executionId;
    service.setState(executionId, "running");
    artifacts.submit(
      {
        itemId: item.id,
        executionId,
        operationId: randomUUID(),
        targetId: "S3",
        record: "包含报告和压缩包",
        artifacts: [
          "report.md",
          "report.txt",
          "report.html",
          "archive.zip",
          "document.pdf",
        ].map((path) => ({ path })),
      },
      peer,
    );
    await artifacts.close();
    expect(store.list("handoffs")[0].artifacts).toHaveLength(5);
    service.peers.clear();
    await rm(root, { recursive: true });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    appOptions.publicUrl = base;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: base },
    ]);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto(base + "/#board/" + board.id);
      await page.getByRole("button", { name: "流程配置", exact: true }).click();
      const stageCard = page.locator(`[data-flow-stage="${board.stages[1].id}"]`);
      await stageCard.click();
      const toggle = page.getByRole("checkbox", { name: "允许提交产物" });
      await expect(toggle).toBeChecked();
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).not.toBeChecked();
      await page.getByRole("button", { name: "保存流程", exact: true }).click();
      await expect
        .poll(() => store.get("boards", board.id).stages[1].allowArtifacts)
        .toBe(false);
      await page.getByRole("button", { name: "流程配置", exact: true }).click();
      await stageCard.click();
      await toggle.check();
      await page.getByRole("button", { name: "保存流程", exact: true }).click();
      await expect
        .poll(() => store.get("boards", board.id).stages[1].allowArtifacts)
        .toBe(true);
      await page.getByRole("button", { name: "工作项", exact: true }).click();
      await page
        .getByRole("heading", { name: item.title, exact: true })
        .click();
      const detail = page.locator(".item-detail");
      await expect(detail.getByLabel("交接产物")).toBeVisible();
      await page
        .getByRole("button", { name: "查看产物 report.md", exact: true })
        .click();
      let file = page.locator(".environment-file");
      await expect(file).toContainText("服务端交接产物");
      await file.getByRole("button", { name: "预览", exact: true }).click();
      await expect(
        file.getByRole("heading", { name: "交付报告" }),
      ).toBeVisible();
      await checkAttachmentExamples(file.locator(".artifact-markdown"));
      await file.locator(".attachment-diagram").first().screenshot({
        path: `.vibe/artifacts/flow-${width}.png`,
      });
      const blocks = file.locator(".markdown-code-block");
      const diagramBlocks = blocks.filter({ has: page.getByText("mermaid", { exact: true }) });
      for (const [index, source] of [[0, flow], [2, invalid]] as const) {
        await diagramBlocks.nth(index).getByRole("button").tap();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source + "\n");
      }
      const code = blocks.first();
      await expect(code.getByText("json", { exact: true })).toBeVisible();
      expect(await code.locator("pre").textContent()).toBe(codeBody);
      expect(await code.locator("pre").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await code.getByRole("button", { name: "复制代码" }).tap();
      await expect(code.getByRole("status")).toHaveText("已复制代码");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(codeBody);
      const savedReport = page.waitForEvent("download");
      await file.getByRole("button", { name: "下载", exact: true }).click();
      expect(await readFile((await (await savedReport).path())!, "utf8")).toBe(report);
      await file.getByRole("button", { name: "关闭", exact: true }).click();

      await page.getByRole("button", { name: "查看产物 report.txt", exact: true }).click();
      await file.getByRole("button", { name: "预览", exact: true }).click();
      const plain = file.getByLabel("文本预览");
      await expect(plain).toBeVisible();
      expect(await plain.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await file.getByRole("button", { name: "关闭", exact: true }).click();
      await page
        .getByRole("button", { name: "查看产物 report.html", exact: true })
        .click();
      await file.getByRole("button", { name: "预览", exact: true }).click();
      await expect(
        page
          .frameLocator('iframe[title="HTML 产物预览"]')
          .getByRole("heading", { name: "静态测试报告" }),
      ).toBeVisible();
      expect(await page.locator("body").getAttribute("data-unsafe")).toBeNull();
      await expect(
        page
          .frameLocator('iframe[title="HTML 产物预览"]')
          .locator("script,[href],img[src]"),
      ).toHaveCount(0);
      await page.screenshot({
        path: `.vibe/artifacts/html-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(page.locator(".environment-file")).toHaveCount(0);
      await expect(detail).toBeVisible();
      await page
        .getByRole("button", { name: "查看产物 archive.zip", exact: true })
        .click();
      await expect(
        file.getByRole("button", { name: "预览", exact: true }),
      ).toBeDisabled();
      const downloading = page.waitForEvent("download");
      await file.getByRole("button", { name: "下载", exact: true }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe("archive.zip");
      expect((await readFile((await download.path())!)).toString()).toBe(
        "下载文件内容",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await file.getByRole("button", { name: "关闭", exact: true }).click();
      await page
        .getByRole("button", { name: "查看产物 document.pdf", exact: true })
        .click();
      await expect(
        file.getByRole("button", { name: "预览", exact: true }),
      ).toBeEnabled();
      await file.getByRole("button", { name: "预览", exact: true }).click();
      await expect(file.locator('iframe[title="PDF 产物预览"]')).toBeVisible();
      // 等待浏览器内置 PDF 阅读器完成首屏绘制后留存截图。
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: `.vibe/artifacts/pdf-${width}.png`,
        fullPage: true,
      });
      await file.getByRole("button", { name: "关闭", exact: true }).click();
      await page.screenshot({
        path: `.vibe/artifacts/handoff-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
    }
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
