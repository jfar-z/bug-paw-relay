import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHash, X509Certificate, randomUUID } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:https";
import { createServer as createHttpServer, request } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.js";
import { createLightHost } from "../src/server/light-host.js";
import { EnvironmentFiles } from "../src/connector/files.js";
import { digest } from "../src/server/security.js";

import { once } from "node:events";
import { promisify } from "node:util";
import { ConnectorConfig } from "../src/connector/config.js";

const origin = "https://localhost";
const domain = "apps.example.test";
test.use({
  ignoreHTTPSErrors: true,
  hasTouch: true,
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: [
      "--ignore-certificate-errors",
      "--host-resolver-rules=MAP *.example.test 127.0.0.1",
    ],
  },
});

/** 在隔离回环 HTTPS 入口上验证两个真实服务及跨源分区 Cookie。 */
async function withHosting(page: Page, context: BrowserContext, run: (
  setup: Awaited<ReturnType<typeof createApp>>, dir: string, cert: string,
  controls: { hostingAvailable: boolean; dropSaveReceipt: boolean },
) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "relay-light-browser-"));
  const key = randomUUID();
  const setup = await createApp({
    dataDir: join(dir, "main"),
    publicUrl: origin,
    webDir: resolve("dist/web"),
    light: { domain, hostUrl: "", key, storageQuota: 128 },
  });
  const { app, store, service, light } = setup;
  service.saveLanguage({ preference: "zh-CN" });
  const mainUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  const { app: host, internal } = await createLightHost({
    database: join(dir, "apps.db"),
    domain,
    key,
    mainOrigin: origin,
    mainUrl,
  });
  const hostUrl = await host.listen({ port: 0, host: "127.0.0.1" });
  light.config.hostUrl = await internal.listen({ port: 0 });
  const cert = join(dir, "cert.pem"),
    privateKey = join(dir, "key.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-new",
      "-x509",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=fixture.example.test",
      "-addext",
      "subjectAltName=DNS:localhost",
      "-keyout",
      privateKey,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  const controls = { hostingAvailable: true, dropSaveReceipt: false };
  const proxy = createServer(
    { cert: await readFile(cert), key: await readFile(privateKey) },
    (req, reply) => {
      const target =
        req.headers.host === new URL(origin).hostname ? mainUrl : hostUrl;
      if (target === hostUrl && !controls.hostingAvailable) {
        reply.writeHead(502).end();
        return;
      }
      const clientAddress = req.headers["user-agent"]?.includes("InstalledFixture")
        ? "127.0.0.2" : req.headers["accept-language"] === "en-US" ? "127.0.0.3" : "127.0.0.1";
      const incoming = request(
        new URL(req.url!, target),
        {
          method: req.method, headers: req.headers,
          // 让独立设备拥有各自的回环源地址，保留服务端按客户端限流。
          localAddress: clientAddress,
        },
        (response) => {
          if (controls.dropSaveReceipt && req.method === "POST" && req.url?.endsWith("/feedback")) {
            controls.dropSaveReceipt = false;
            response.resume();
            reply.writeHead(502).end();
            return;
          }
          reply.writeHead(response.statusCode!, response.headers);
          response.pipe(reply);
        },
      );
      incoming.on("error", () => reply.writeHead(502).end());
      reply.on("close", () => incoming.destroy());
      req.pipe(incoming);
    },
  );
  // 测试代理把连接器的 WSS 握手交给同一个真实主站。
  proxy.on("upgrade", (req, socket, head) => app.server.emit("upgrade", req, socket, head));
  try {
    await new Promise<void>((done, fail) =>
      proxy.once("error", fail).listen(443, "127.0.0.1", done),
    );
    store.put("users", { username: "fixture" }, "owner");
    const login = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(login), "owner", Date.now() + 600000);
    await context.addCookies([
      {
        name: "relay_session",
        value: login,
        url: origin,
        secure: true,
        httpOnly: true,
      },
    ]);
    await run(setup, dir, cert, controls);
  } finally {
    await page.close({ reason: "fixture complete" });
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
    await host.close();
    await internal.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("来源会话标题按卡片宽度省略并支持触屏与键盘查看", async ({ page, context }) => {
  await withHosting(page, context, async ({ store, service }) => {
    const env = store.put("environments", { name: "测试环境", approved: true });
    const project = service.save("projects", {
      name: "发布项目",
      directories: [{ environmentId: env.id, rootId: "root", relativePath: "." }],
    });
    const titles = ["周报", "这是一段需要完整阅读的会话标题 Long session title ".repeat(12).trim()];
    const sessions = titles.map((title, index) => {
      const session = store.put("sessions", {
        title, projectId: project.id, environmentId: env.id, runtime: "codex",
        rootId: "root", relativePath: ".",
      });
      store.put("lightApps", {
        title: "应用 " + index, listed: true, number: 1, latestVersionId: randomUUID(),
        projectId: project.id, environmentId: env.id, sessionId: session.id,
        publishedAt: new Date().toISOString(),
      });
      return session;
    });

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + "/#light-apps");
      const buttons = titles.map((name) => page.getByRole("button", { name, exact: true }));
      const heights = [];
      for (const [i, button] of buttons.entries()) {
        await expect(button).toBeVisible();
        const title = button.locator("span");
        await expect(title).toHaveCSS("text-overflow", "ellipsis");
        await expect(title).toHaveCSS("white-space", "nowrap");
        expect(await title.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(i === 1);
        const source = button.locator("xpath=ancestor::dl");
        heights.push((await source.boundingBox())!.height);
        const link = source.getByRole("link", { name: "查看来源会话" });
        await expect(link).toHaveAttribute("href", "#chat/" + sessions[i].id);
        const box = (await link.boundingBox())!;
        const card = (await button.locator("xpath=ancestor::section[1]").boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(Math.min(width, card.x + card.width));
        expect(await link.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      expect(heights[0]).toBe(heights[1]);
      if (width === 1440) await buttons[1].press("Enter");
      else await buttons[1].tap();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(titles[1], { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(buttons[1]).toBeFocused();
      await buttons[1].locator("xpath=ancestor::dl").getByRole("link").click();
      await expect(page).toHaveURL(origin + "/#chat/" + sessions[1].id);
      await expect(page.getByRole("heading", { name: titles[1], exact: true }).first()).toBeVisible();
    }
  });
});

test("会话与工作项发布、历史反馈、下架恢复及手机查看", async ({
  page,
  context,
}, info) => {
  await withHosting(page, context, async ({ app, store, service, light }, dir, cert, controls) => {
    const env = store.put("environments", {
      name: "测试环境",
      approved: true,
      capabilities: ["light-apps-v1", "light-apps-v2", "light-apps-v3", "light-apps-v4"],
    });
    const project = service.save("projects", {
      name: "发布项目",
      directories: [
        { environmentId: env.id, rootId: "root", relativePath: "." },
      ],
    });
    const root = join(dir, "root");
    await mkdir(root);
    const reader = new EnvironmentFiles(() => [{ id: "root", path: root }]);
    const histories = new Map<string, { turns: any[]; events: any[] }>();
    const deliveries: { sessionId: string; message: string }[] = [];
    const peer: any = {
      call(method: string, params: any) {
        if (method === "execution.status") return { status: "not_found" };
        if (method === "execution.start") {
          deliveries.push({ sessionId: params.session.id, message: params.message });
          return { status: "running", stateVersion: 1 };
        }
        if (method === "session.history") {
          const history = histories.get(params.sessionId);
          return {
            events: history?.events || [],
            nativeHistory: { thread: { turns: history?.turns || [] } },
          };
        }
        return reader.call(method, params);
      },
      close() {},
    };
    service.peers.set(env.id, peer);
    const session = store.put("sessions", {
      title: "发布会话",
      runtime: "codex",
      environmentId: env.id,
      rootId: "root",
      relativePath: ".",
      projectId: project.id,
    });
    const execution = randomUUID();
    store.db
      .prepare("INSERT INTO executions VALUES(?,NULL,?,?,'running','{}',?)")
      .run(execution, session.id, env.id, new Date().toISOString());
    const stage = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "发布看板",
      projectId: project.id,
      stages: [
        {
          id: randomUUID(),
          fixedRole: "start",
          name: "未开始",
          type: "human",
          targets: [stage],
        },
        {
          id: stage,
          name: "执行",
          type: "agent",
          agentId: service.save("agents", { name: "Fixture agent" }).id,
          environmentId: env.id,
          rootId: "root",
          targets: [done],
          allowArtifacts: true,
        },
        { id: done, name: "已完成", type: "done", targets: [] },
      ],
    });
    const item = service.createItem({
      boardId: board.id,
      startStageId: stage,
      title: "验收应用工作项",
    });
    const boardExecution = store.get("items", item.id).executionId;
    service.setState(boardExecution, "running");
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><meta charset="utf-8"><h1>应用版本</h1><output></output><img src="image.svg" alt="应用图片"><button>选择 A</button><script src="app.js"></script>',
    );
    await writeFile(
      join(root, "image.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>',
    );
    const publish = async (
      title: string,
      label: string,
      options: { appId?: string; executionId?: string } = {},
    ) => {
      await writeFile(
        join(root, "app.js"),
        'document.querySelector("h1").textContent=' +
          JSON.stringify(label) +
          ';document.querySelector("output")?.append(localStorage.getItem("score") ?? "空存档")' +
          ';document.querySelector("button").onclick=()=>parent.postMessage({type:"relay.light.selection",text:"A"},' +
          JSON.stringify(origin) +
          ');document.addEventListener("fixture-errors", () => {' +
          'for (let i = 0; i < 2; i++) setTimeout(() => { throw new Error("browser fixture error"); });' +
          'setTimeout(() => { void Promise.reject(new Error("browser fixture rejection")); });' +
          'const missing = document.createElement("img"); document.body.append(missing); missing.src = "missing.png";' +
          '});',
      );
      return (await light.agent("light.publish", env.id, peer, {
        executionId: options.executionId ?? execution,
        args: {
          operationId: randomUUID(),
          title,
          entry: "index.html",
          files: ["index.html", "app.js", "image.svg"],
          ...(options.appId ? { appId: options.appId } : {}),
        },
      })) as { appId: string; versionId: string; number: number };
    };
    const initialTime = Math.floor(Date.now() / 1000) - 120;
    const turn = (id: string, offset: number, question: string, answer?: string) => ({
      id,
      startedAt: initialTime + offset,
      status: answer ? "completed" : "inProgress",
      items: [
        { id: id + "-user", type: "userMessage", content: [{ type: "text", text: question }] },
        ...(answer ? [{ id: id + "-answer", type: "agentMessage", text: answer }] : []),
      ],
    });
    const mainHistory = {
      turns: [turn("round-1", 0, "第一轮请求")],
      events: [{ type: "turn/started", executionId: execution, sequence: 2, data: { turn: { id: "round-1" } } }],
    };
    histories.set(session.id, mainHistory);
    const first = await publish("交互报告", "第一版");
    const fixtureTime = (id: string, offset: number) => {
      store.db.prepare("UPDATE entities SET body=json_set(body,'$.createdAt',?) WHERE id=?")
        .run(new Date((initialTime + offset) * 1000).toISOString(), id);
    };
    fixtureTime(first.versionId, 10);
    await page.goto(origin + "/#chat/" + session.id, {
      waitUntil: "domcontentloaded",
      timeout: 8000,
    });
    page.setDefaultTimeout(8000);
    const firstButton = page.getByRole("button", {
      name: "打开 交互报告 · 版本 1",
      exact: true,
    });
    await expect(firstButton).toBeVisible();
    await expect(page.getByText("第一轮请求", { exact: true })).toBeVisible();
    await expect(page.getByText("第一轮回复", { exact: true })).toHaveCount(0);

    mainHistory.turns = [
      turn("round-1", 0, "第一轮请求", "第一轮回复"),
      turn("round-2", 20, "第二轮请求", "第二轮回复"),
      turn("round-3", 40, "第三轮请求", "第三轮回复"),
      turn("round-4", 60, "第四轮请求", "第四轮回复"),
    ];
    const legacy = await publish("计算器", "计算器应用");
    fixtureTime(legacy.versionId, 30);
    store.db.prepare("UPDATE entities SET body=json_remove(body,'$.executionId') WHERE id=?")
      .run(legacy.versionId);
    const boardTitle = "看板原型" + " · 跨团队交互设计审阅".repeat(5);
    const boardApp = await publish(boardTitle, "看板应用", { executionId: boardExecution });
    const secondExecution = randomUUID();
    store.db.prepare("INSERT INTO executions VALUES(?,NULL,?,?,'running','{}',?)")
      .run(secondExecution, session.id, env.id, new Date((initialTime + 40) * 1000).toISOString());
    mainHistory.events.push({
      type: "turn/started", executionId: secondExecution, sequence: 2, data: { turn: { id: "round-3" } },
    });
    const second = await publish("交互报告", "第二版", { appId: first.appId, executionId: secondExecution });
    fixtureTime(second.versionId, 50);
    // 历史夹具已更新，发送真实连接器重连时使用的对账事件。
    service.sessionEvents.emit(session.id, { type: "environment-ready" });
    const timeline = page.locator(".session-messages");
    const labels = ["第一轮回复", "版本 1", "第二轮回复", "计算器", "第三轮回复", "版本 2", "第四轮回复"];
    const assertTimeline = async () => {
      await expect(firstButton).toHaveCount(1);
      await expect(page.getByRole("button", { name: "打开 交互报告 · 版本 2", exact: true })).toHaveCount(1);
      await expect(timeline).toContainText(new RegExp(labels.join("[\\s\\S]*")));
    };
    await assertTimeline();
    await page.reload();
    await assertTimeline();
    const secondButton = page.getByRole("button", { name: "打开 交互报告 · 版本 2", exact: true });
    await secondButton.click();
    await expect(page.frameLocator("iframe").getByRole("heading", { name: "第二版" })).toBeVisible();
    await expect(page.frameLocator("iframe").locator("output")).toHaveText("空存档");
    await page.keyboard.press("Escape");
    await expect(secondButton).toBeFocused();

    await page.setViewportSize({ width: 360, height: 780 });
    const firstPublication = page.getByRole("article", { name: "交互报告", exact: true }).first();
    await firstPublication.scrollIntoViewIfNeeded();
    await expect(firstButton).toHaveCSS("min-height", "44px");
    expect(await firstPublication.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
      await firstPublication.evaluate((element) => element.clientWidth),
    );
    const details = firstPublication.getByRole("button", { name: "发布详情" });
    await details.focus();
    await page.keyboard.press("Enter");
    const publicationDetails = page.getByRole("dialog", { name: "发布详情" });
    await expect(publicationDetails.getByText("发布时间")).toBeVisible();
    await expect(publicationDetails.getByText("发布项目 · 测试环境 · 发布会话")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details).toBeFocused();
    await page.screenshot({ path: info.outputPath("mobile-timeline.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await firstButton.click();
    const frame = page.frameLocator("iframe");
    await expect(frame.getByRole("heading", { name: "第一版" })).toBeVisible();
    const versionFrame = page
      .frames()
      .find(
        (child) =>
          child.url() === "https://" + domain + "/v/" + first.versionId + "/",
      );
    expect(versionFrame).toBeDefined();
    expect(await versionFrame!.evaluate(() => self.origin)).toBe("null");
    await expect(frame.locator("output")).toHaveText("空存档");
    // 同源宿主页面的存储和同名键仅留在各自的授权范围内。
    await page.evaluate(() => localStorage.setItem("score", "主站"));
    const secondPage = await context.newPage();
    await secondPage.goto(origin + "/#chat/" + session.id);
    await secondPage.getByRole("button", { name: "打开 交互报告 · 版本 2", exact: true }).click();
    const secondFrame = secondPage.frameLocator("iframe");
    await expect(secondFrame.locator("output")).toHaveText("空存档");
    await secondFrame.locator("output").evaluate(() => localStorage.setItem("score", "第二版成绩"));
    await expect.poll(() => store.findBy("lightStorage", "versionId", second.versionId)[0]?.entries)
      .toEqual([["score", "第二版成绩"]]);
    await secondPage.close();
    expect(await versionFrame!.evaluate(() => localStorage.getItem("score"))).toBeNull();
    await versionFrame!.evaluate(() => {
      localStorage.setItem("score", "第一版成绩");
      try { localStorage.setItem("oversized", "x".repeat(129)); }
      catch (error) {
        if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error;
      }
      setTimeout(() => document.dispatchEvent(new Event("fixture-errors")));
    });
    await expect.poll(() => store.findBy("lightDiagnostics", "versionId", first.versionId)
      .map((row) => [row.kind, row.count]).sort())
      .toEqual([["promise", 1], ["resource", 1], ["script", 2], ["storage", 1]]);
    expect(store.findBy("lightDiagnostics", "versionId", first.versionId)
      .find((row) => row.kind === "resource")?.file).toBe("missing.png");
    expect(await page.evaluate(() => localStorage.getItem("score"))).toBe("主站");
    await expect
      .poll(() =>
        frame
          .getByRole("img", { name: "应用图片" })
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await frame.getByRole("button", { name: "选择 A" }).click();
    await expect(page.getByText("选择已记录")).toBeVisible();
    await page.getByRole("button", { name: "仅确认" }).click();
    await expect(page.getByText("反馈已提交")).toBeVisible();
    await page.screenshot({ path: info.outputPath("desktop-viewer.png") });
    await page.getByRole("button", { name: "全屏", exact: true }).click();
    await expect(page.getByText("反馈已提交")).toBeHidden();
    await page.getByRole("button", { name: "退出全屏" }).click();
    await expect(page.getByText("反馈已提交")).toBeVisible();
    await page.getByRole("button", { name: "全屏", exact: true }).click();
    await versionFrame!.evaluate(() => localStorage.setItem("checkpoint", "closing"));
    await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
    await expect(firstButton).toBeFocused();
    await expect.poll(() => store.findBy("lightStorage", "versionId", first.versionId)[0]?.entries)
      .toEqual([["score", "第一版成绩"], ["checkpoint", "closing"]]);
    await page.reload();
    await firstButton.click();
    await expect(frame.locator("output")).toHaveText("第一版成绩");
    await page.keyboard.press("Escape");
    await expect(firstButton).toBeFocused();
    await expect.poll(() => store.list("lightFeedback").length).toBe(2);
    expect(store.list("lightFeedback").map((entry) => entry.versionId)).toEqual(
      [first.versionId, first.versionId],
    );

    await page.goto(origin + "/#board/" + board.id);
    await page.getByRole("heading", { name: item.title, exact: true }).click();
    await page.getByRole("button", { name: `打开 ${boardTitle} · 版本 1` }).click();
    await expect(
      frame.getByRole("heading", { name: "看板应用" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 700 });
    const boardHeader = page.getByRole("dialog").last().locator("header");
    await expect(boardHeader.getByRole("heading")).toContainText(boardTitle);
    await expect(boardHeader.getByRole("button", { name: "关闭" })).toBeInViewport();
    await expect(frame.locator("output")).toHaveText("空存档");
    await page.getByRole("button", { name: "提出修改" }).click();
    await page.getByRole("textbox", { name: "修改意见" }).fill("请调整标题");
    await page.getByRole("button", { name: "仅提交反馈" }).click();
    await expect(page.getByText("反馈已提交")).toBeVisible();
    await page
      .getByRole("button", { name: "关闭", exact: true })
      .last()
      .click();
    await page.getByText("版本反馈", { exact: true }).click();
    await expect(page.getByText("请调整标题")).toBeVisible();
    expect(store.get("items", item.id).stageId).toBe(stage);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();

    await page.goto(origin + "/#light-apps");
    const report = page
      .getByRole("heading", { name: "交互报告", exact: true })
      .locator("..");
    await expect(report.getByText("版本 2")).toBeVisible();
    await report.getByRole("button", { name: "下架", exact: true }).click();
    await expect(report).toHaveCount(0);
    await page.goto(origin + "/#chat/" + session.id);
    await expect(firstButton).toBeDisabled();
    await expect(secondButton).toBeDisabled();
    for (const publication of await page.getByRole("article", { name: "交互报告", exact: true }).all())
      await expect(publication.getByText("已下架")).toBeVisible();
    await page.goto(origin + "/#light-apps");
    await publish("交互报告", "第三版", { appId: first.appId });
    await page.getByRole("button", { name: "已下架", exact: true }).click();
    await expect(report.getByText("版本 3")).toBeVisible();
    await report.getByRole("button", { name: "恢复上架", exact: true }).click();
    await expect(page.getByText("暂无已下架的轻应用")).toBeVisible();
    await page.getByRole("button", { name: "已上架", exact: true }).click();

    service.peers.clear();
    await rm(root, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await report.getByRole("button", { name: "打开", exact: true }).click();
    await expect(frame.getByRole("heading", { name: "第三版" })).toBeVisible();
    const viewer = page.getByRole("dialog");
    await expect(viewer).toHaveCSS("width", "390px");
    await page.screenshot({ path: info.outputPath("mobile-viewer.png") });
    await viewer.getByRole("button", { name: "关闭", exact: true }).click();
    await report.getByRole("button", { name: "历史版本", exact: true }).click();
    await page
      .getByRole("button", { name: "打开 交互报告 · 版本 1", exact: true })
      .click();
    await expect(frame.getByRole("heading", { name: "第一版" })).toBeVisible();
    await expect(frame.locator("output")).toHaveText("第一版成绩");
    await expect(
      viewer.getByRole("button", { name: "确认此版本" }),
    ).toBeVisible();

    expect(deliveries).toHaveLength(0);
    // 对历史版本模拟保存回执丢失，再在离线通知失败后单独补发。
    await viewer.getByRole("button", { name: "提出修改" }).click();
    const draft = viewer.getByRole("textbox", { name: "修改意见" });
    await draft.fill("请放大图例");
    controls.dropSaveReceipt = true;
    const notifyChanges = viewer.getByRole("button", { name: "提交并请 Agent 处理" });
    await notifyChanges.click();
    await expect(viewer.getByRole("alert")).toBeVisible();
    await expect(draft).toHaveValue("请放大图例");
    const countSaved = () => store.findBy("lightFeedback", "versionId", first.versionId).length;
    const saved = countSaved();
    await notifyChanges.click();
    await expect(viewer.getByText("反馈已保存，通知发送失败")).toBeVisible();
    expect(countSaved()).toBe(saved);
    service.setState(execution, "completed");
    service.setState(secondExecution, "completed");
    service.peers.set(env.id, peer);
    await viewer.getByRole("button", { name: "重试通知" }).click();
    const sessionLink = viewer.getByRole("link", { name: "查看会话" });
    await expect(sessionLink).toHaveAttribute("href", "#chat/" + session.id);
    expect(countSaved()).toBe(saved);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].sessionId).toBe(session.id);
    expect(deliveries[0].message).toMatch(/交互报告.*1.*修改意见[\s\S]*请放大图例/);
    service.setState(store.get("sessions", session.id).executionId, "completed");
    await viewer.getByRole("button", { name: "确认并通知 Agent" }).click();
    await expect(sessionLink).toBeVisible();
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1].message).toMatch(/交互报告.*1.*已确认/);
    // 范围变化由来源会话当前轮次追加版本触发。
    const latestExecution = store.get("sessions", session.id).executionId;

    async function checkLandscape(active: Page, standalone: boolean) {
      const dialog = active.getByRole("dialog").last();
      const header = dialog.locator("header");
      const enter = header.getByRole("button", { name: "全屏", exact: true });
      const leave = header.getByRole("button", { name: "退出全屏" });
      const close = header.getByRole("button", { name: "关闭" });
      // 检查实际绘制的提示，避免图标保留焦点时旁边出现第二个文字控件。
      async function expectIconOnly() {
        const toolbar = header.locator(".light-viewer-toolbar");
        await expect(toolbar).toHaveText("");
        const tips = await toolbar.locator("*").evaluateAll(elements =>
          elements.flatMap(element => ["::before", "::after"].map(pseudo =>
            getComputedStyle(element, pseudo)
          )).filter(style => !["none", "normal", '""'].includes(style.content) &&
            style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0)
            .map(style => style.content)
        );
        expect(tips).toEqual([]);
      }
      const draft = dialog.getByRole("textbox", { name: "修改意见" });
      const output = active.frameLocator("iframe").locator("output");
      const change = dialog.getByRole("button", { name: "提出修改" });
      await output.evaluate(el => { el.textContent = "游戏进行中"; });
      expect(await active.evaluate(() => matchMedia("(display-mode: standalone)").matches)).toBe(standalone);
      // 同一查看器覆盖桌面和手机视口，切换时保持沙箱和草稿。
      const device = await active.context().newCDPSession(active);
      for (const width of [1440, 844]) {
        await device.send("Emulation.setTouchEmulationEnabled", { enabled: width === 844 });
        const height = width === 1440 ? 900 : 390;
        await active.setViewportSize({ width, height });
        await change.click();
        await dialog.getByRole("button", { name: "确认此版本" }).click();
        const footer = dialog.locator(".ui-embedded-view-controls");
        const footerHeight = (await footer.boundingBox())!.height;
        expect(footerHeight).toBeLessThanOrEqual(64);
        expect((await change.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        console.log({ standalone, width, height, footerHeight });
        await change.click();
        await draft.fill("未提交意见");
        for (const mode of ["system", "window", "denied"]) {
          await active.evaluate(mode => {
            const root = document.documentElement;
            if (mode === "system") Reflect.deleteProperty(root, "requestFullscreen");
            else Object.defineProperty(root, "requestFullscreen", { configurable: true,
              value: mode === "window" ? undefined : () => Promise.reject(new Error("denied")) });
          }, mode);
          await enter.click();
          await expect(leave.locator("svg")).toBeVisible();
          await expect(leave).toBeFocused();
          await expectIconOnly();
          await expect(header.getByRole("heading")).toContainText("交互报告");
          await expect(close).toBeVisible();
          expect((await leave.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          expect(await active.evaluate(() => !!document.fullscreenElement)).toBe(mode === "system");
          await expect(footer).toBeHidden();
          const box = (await active.locator("iframe").boundingBox())!;
          expect(box.width).toBe(width);
          expect(box.y).toBeCloseTo((await header.boundingBox())!.height, 0);
          expect(box.y + box.height).toBeCloseTo(height, 0);
          if (mode === "system") {
            await active.screenshot({ path: info.outputPath(`fullscreen-${standalone}-${width}.png`) });
            await active.evaluate(() => document.exitFullscreen());
          } else if (mode === "window") await leave.click();
          else {
            await active.setViewportSize({ width: 320, height: 700 });
            await active.keyboard.press("Escape");
            await expect(close).toBeFocused();
            await expect(enter).toBeHidden();
          }
          if (mode !== "denied") {
            await expect(enter).toBeFocused();
            await expectIconOnly();
          }
          await expect(draft).toHaveValue("未提交意见");
          await expect(output).toHaveText("游戏进行中");
        }
      }
      await device.detach();
      await dialog.getByRole("button", { name: "确认此版本" }).click();
    }
    await checkLandscape(page, false);
    await page.setViewportSize({ width: 390, height: 844 });

    // 使用临时 Chromium 用户目录安装应用，直接检查独立窗口的真实显示模式。
    const publicKey = new X509Certificate(await readFile(cert)).publicKey.export({ type: "spki", format: "der" });
    const fingerprint = createHash("sha256").update(publicKey).digest("base64");
    const installed = await chromium.launchPersistentContext(join(dir, "profile"), {
      ...info.project.use.launchOptions,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ["--allow-insecure-localhost", "--ignore-certificate-errors-spki-list=" + fingerprint,
        "--host-resolver-rules=MAP *.example.test 127.0.0.1"],
      ignoreHTTPSErrors: true, hasTouch: true, locale: "zh-CN",
      userAgent: (await page.evaluate(() => navigator.userAgent)) + " InstalledFixture",
    });
    try {
      await installed.addCookies(await context.cookies(origin));
      const tab = installed.pages()[0];
      await tab.goto(origin);
      const browser = await installed.newCDPSession(tab);
      const manifest = await browser.send("Page.getAppManifest");
      expect(manifest.errors).toEqual([]);
      expect(manifest.url).toBe(origin + "/manifest.webmanifest");
      expect(await browser.send("Page.getInstallabilityErrors")).toEqual({ installabilityErrors: [] });
      await browser.send("PWA.install", { manifestId: origin + "/" });
      await browser.send("PWA.changeAppUserSettings", { manifestId: origin + "/", displayMode: "standalone" });
      const [window] = await Promise.all([
        installed.waitForEvent("page", { timeout: 10000 }),
        browser.send("PWA.launch", { manifestId: origin + "/", url: origin + "/#light-apps" }),
      ]);
      window.setDefaultTimeout(8000);
      await window.goto(origin + "/#light-apps");
      await window.getByRole("heading", { name: "交互报告" }).locator("..")
        .getByRole("button", { name: "打开", exact: true }).click();
      await checkLandscape(window, true);
    } finally {
      await installed.close();
    }

    // 在查看器打开时下架，恢复后由重试签发新的视图授权。
    const setListing = async (listed: boolean) => {
      const status = await page.evaluate(
        async ({ appId, listed }) => {
          const response = await fetch(
            "/api/light-apps/" + appId + "/listing",
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ listed }),
            },
          );
          return response.status;
        },
        { appId: first.appId, listed },
      );
      expect(status).toBe(200);
    };
    await setListing(false);
    await expect(viewer.getByText("轻应用已下架。")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      viewer.getByRole("button", { name: "确认此版本" }),
    ).toHaveCount(0);
    await setListing(true);
    await viewer.getByRole("button", { name: "重试", exact: true }).click();
    await expect(
      viewer.getByRole("button", { name: "确认此版本" }),
    ).toBeVisible();

    // 专用托管监听不可用时，主站仍可查看原会话。
    controls.hostingAvailable = false;
    await expect(
      viewer.getByText("轻应用托管服务不可用，请检查托管连接与配置后重试。"),
    ).toBeVisible({ timeout: 10000 });
    await page.goto(origin + "/#chat/" + session.id);
    await expect(firstButton).toBeVisible();

    // 英文客户端使用独立回环地址，避免多组验收累计占用同一个客户端配额。
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US" });
    service.saveLanguage({ preference: "en" });
    await page.reload();
    await page
      .getByRole("button", { name: "Open 交互报告 · Version 1", exact: true })
      .click();
    await expect(
      page.getByText(
        "Light app hosting is unavailable. Check the hosting connection and configuration, then retry.",
      ),
    ).toBeVisible({ timeout: 20000 });
    controls.hostingAvailable = true;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Approve this version" }),
    ).toBeVisible();

    await page.setViewportSize({ width: 320, height: 700 });
    const actions = viewer.locator(".ui-embedded-view-controls .ui-actions button");
    for (const theme of ["light", "dark", "bug"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const [section, save, send] of [
        ["Approve this version", "Approve only", "Approve and notify Agent"],
        ["Request changes", "Submit feedback only", "Submit and ask Agent to act"],
      ]) {
        await viewer.getByRole("button", { name: section }).click();
        await expect(actions).toHaveText([save, send]);
        await expect(actions.first()).toHaveClass(/ui-button-primary/);
        await expect(actions.last()).toHaveClass(/ui-button-secondary/);
        for (const action of await actions.all()) {
          const box = (await action.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(320);
        }
      }
    }

    // 会话事件实时送达，拒绝保持上架，新增版本需要重新审阅。
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    service.peers.set(env.id, peer);

    await mkdir(root);
    await writeFile(join(root, "index.html"), "<h1>Updated</h1>");
    await writeFile(join(root, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    // 在另一项目会话中审阅恢复和删除请求，原会话仍可追加版本。
    store.put("environments", { capabilities: [...env.capabilities, "light-apps-environment-v1"] }, env.id);
    const managingProject = service.save("projects", {
      name: "管理项目", directories: [{ environmentId: env.id, rootId: "root", relativePath: "." }],
    });
    const initiator = store.put("sessions", {
      title: "管理会话", runtime: "claude", projectId: managingProject.id, environmentId: env.id, rootId: "root",
    });
    const initiatingExecution = randomUUID();
    store.db.prepare("INSERT INTO executions VALUES(?,NULL,?,?,'running','{}',?)")
      .run(initiatingExecution, initiator.id, env.id, new Date().toISOString());
    await page.goto(origin + "/#chat/" + initiator.id);
    await setListing(false);
    await light.agent("light.relist", env.id, peer, { executionId: initiatingExecution, args: { appId: first.appId } });
    await page.getByRole("button", { name: "Review listing restoration" }).click();
    const restoring = page.getByRole("dialog", { name: "Restore listing" });
    await expect(restoring).toContainText("Hosted access to all 3 versions will be restored.");
    await restoring.getByRole("button", { name: "Restore listing" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Listed" })).toBeVisible();
    const requestDelete = () => light.agent("light.delete", env.id, peer, {
      executionId: initiatingExecution,
      args: { appId: first.appId },
    });
    const review = page.getByRole("button", { name: "Review permanent deletion" });
    const deletion = page.getByRole("dialog", { name: "Delete permanently" });
    const confirmDeletion = deletion.getByRole("button", { name: "Delete permanently", exact: true });
    expect(await requestDelete()).toMatchObject({ status: "pendingConfirmation" });
    await expect(review).toBeVisible();
    await review.focus();
    await expect(review).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(deletion.getByText(/all 3 versions/)).toBeVisible();
    const cancel = deletion.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(review).toBeFocused();
    await page.keyboard.press("Enter");
    await cancel.click();
    await expect(review).toHaveCount(0);
    expect(store.get("lightApps", first.appId).listed).toBe(true);
    expect(await requestDelete()).toMatchObject({ status: "pendingConfirmation" });
    await review.click();
    await publish("交互报告", "Fourth", { appId: first.appId, executionId: latestExecution });
    await confirmDeletion.click();
    await expect(deletion.getByText(/all 4 versions/)).toBeVisible();
    await expect(deletion.getByText(/The versions changed/)).toBeVisible();
    expect(store.get("lightApps", first.appId).listed).toBe(true);
    await page.screenshot({ path: info.outputPath("mobile-scope-changed-en.png"), animations: "disabled" });
    await confirmDeletion.click();
    await expect(deletion).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Deleted" })).toBeVisible();
    await page.goto(origin + "/#chat/" + session.id);
    await expect(page.getByRole("article", { name: "交互报告", exact: true }).getByText("Deleted", { exact: true })).toHaveCount(4);
    await expect(page.getByRole("button", { name: /Open 交互报告/ })).toHaveCount(0);
    expect(store.list("lightFeedback").filter((entry) => entry.versionId === first.versionId)).toHaveLength(0);
    for (const { versionId } of [first, second]) {
      expect(store.findBy("lightStorage", "versionId", versionId)).toHaveLength(0);
      expect(store.findBy("lightDiagnostics", "versionId", versionId)).toHaveLength(0);
    }

    // 管理页独立于来源环境，可从两个列表删除并在托管故障后继续清理。
    service.peers.clear();
    service.saveLanguage({ preference: "zh-CN" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + "/#light-apps");
    await page.reload();
    const card = (title: string) => page.getByRole("heading", { name: title, exact: true }).locator("..");
    const deleteButton = (title: string) => card(title).getByRole("button", { name: "永久删除", exact: true });
    const dialog = page.getByRole("dialog", { name: "永久删除" });
    const confirm = dialog.getByRole("button", { name: "永久删除", exact: true });
    await expect(report).toHaveCount(0);
    await deleteButton(boardTitle).click();
    await expect(dialog.getByText(/全部 1 个版本/)).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(deleteButton(boardTitle)).toBeVisible();
    await deleteButton(boardTitle).click();
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: info.outputPath("desktop-delete-zh.png"), animations: "disabled" });
    await confirm.click();
    await expect(card(boardTitle)).toHaveCount(0);
    expect(store.get("lightApps", boardApp.appId).deletion).toBe("deleted");
    await card("计算器").getByRole("button", { name: "下架", exact: true }).click();
    await page.getByRole("button", { name: "已下架", exact: true }).click();
    await deleteButton("计算器").click();
    const internalUrl = light.config.hostUrl;
    light.config.hostUrl = "";
    await confirm.click();
    await expect(dialog.getByText(/清理尚未完成/)).toBeVisible();
    expect(store.get("lightApps", legacy.appId).deletion).toBe("cleaning");
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    await expect(card("计算器").getByRole("button", { name: "恢复上架" })).toHaveCount(0);
    light.config.hostUrl = internalUrl;
    await card("计算器").getByRole("button", { name: "重试清理", exact: true }).click();
    await confirm.click();
    await expect(card("计算器")).toHaveCount(0);
    expect(store.get("lightApps", legacy.appId).deletion).toBe("deleted");
  });
});

/** 两个回环业务服务各自持久化，读写走已发布页面和真实连接器。 */
test("绑定版本通过真实连接器读写，重开及恢复后保留数据", async ({ page, context }) => {
  await withHosting(page, context, async ({ store, service, light }, dir, cert) => {
    page.setDefaultTimeout(10000);
    const root = join(dir, "site");
    await mkdir(root);
    const config = new ConnectorConfig(join(dir, "connector"));
    config.save({ ...config.read(), serverUrl: origin, roots: [{ id: "work", path: root }] });
    const invite = randomUUID();
    store.db.prepare("INSERT INTO invitations VALUES(?,?,0)").run(digest(invite), Date.now() + 60000);
    const env = { ...process.env, BUGPAW_HOME: config.dir, NODE_EXTRA_CA_CERTS: cert };
    await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      'import {ConnectorConfig} from "./src/connector/config.ts"; await new ConnectorConfig(process.env.BUGPAW_HOME).register(process.env.TEST_INVITE);'],
      { env: { ...env, TEST_INVITE: invite } });
    const environmentId = config.read().environmentId!;
    store.put("environments", { approved: true }, environmentId);
    const startWorker = () => spawn(process.execPath, ["--import", "tsx", "src/connector/main.ts", "run"], { env, stdio: "ignore" });
    let worker = startWorker();
    const connected = async () => expect.poll(() => service.peers.has(environmentId), { timeout: 15000 }).toBe(true);
    const stopWorker = async () => {
      if (worker.exitCode !== null || worker.signalCode !== null) return;
      const ended = once(worker, "exit");
      worker.kill();
      await ended;
    };
    const session = store.put("sessions", { title: "记录会话", runtime: "codex", environmentId, rootId: "work", relativePath: "." });
    const registration = join(config.dir, "light-services", session.id);
    await mkdir(registration, { recursive: true });
    const executionId = randomUUID();
    const makeService = async (ownerDirectory = registration, initialRecords = "[]") => {
      const id = randomUUID();
      const database = join(dir, id + ".json");
      await writeFile(database, initialRecords);
      const server = createHttpServer(async (req, res) => {
        if (req.method === "HEAD" && req.url === "/.well-known/bugpaw-light-service")
          return void res.writeHead(204, { "x-bugpaw-light-service": id }).end();
        if (req.url !== "/records") return void res.writeHead(404).end("null");
        const rows = JSON.parse(await readFile(database, "utf8"));
        if (req.method === "POST") {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          rows.push(JSON.parse(Buffer.concat(chunks).toString()));
          await writeFile(database, JSON.stringify(rows));
          if (rows.at(-1) === "回执中断") return res.destroy();
          res.statusCode = 201;
        }
        res.end(JSON.stringify(rows));
      });
      const start = async (port: number) => {
        server.listen(port, "127.0.0.1");
        await once(server, "listening");
      };
      await start(0);
      const port = (server.address() as { port: number }).port;
      await mkdir(ownerDirectory, { recursive: true });
      await writeFile(join(ownerDirectory, id + ".port"), String(port));
      return { id, database, restart: () => start(port),
        stop: () => new Promise<void>(done => server.close(() => done())) };
    };
    const one = await makeService();
    const two = await makeService();
    try {
      await connected();
      // 用旧能力生成存量绑定，随后恢复连接器协商的完整能力。
      const capabilities = store.get("environments", environmentId).capabilities;
      store.put("environments", { capabilities: capabilities.filter((c: string) => c !== "light-apps-environment-v1") }, environmentId);
      store.db.prepare("INSERT INTO executions VALUES(?,NULL,?,?,'running','{}',?)")
        .run(executionId, session.id, environmentId, new Date().toISOString());
      await writeFile(join(root, "index.html"), `<!doctype html><meta charset="utf-8"><input aria-label="记录"><button>保存</button><button>读取</button><output></output><script>
        const output = document.querySelector('output');
        async function records(method) {
          try {
            const call = { method, path: '/records' };
            if (method === 'POST') call.body = JSON.stringify(document.querySelector('input').value);
            const result = await window.relayBackend(call);
            output.value = result.status + ' ' + result.body;
          } catch (error) { output.value = error.message; }
        }
        const [save, read] = document.querySelectorAll('button');
        save.onclick = () => records('POST');
        read.onclick = () => records('GET');
        if (window.relayBackend) records('GET'); else output.value = '静态版';
      </script>`);
      const publish = (backendServiceId?: string, appId?: string) => light.agent(
        "light.publish", environmentId, service.peers.get(environmentId)!, {
          executionId, args: { title: "记录簿", entry: "index.html", operationId: randomUUID(), appId, backendServiceId },
        }) as Promise<{ appId: string; versionId: string }>;
      const first = await publish(one.id);
      await publish(two.id, first.appId);
      await expect(publish(randomUUID(), first.appId)).rejects.toMatchObject({ code: "LIGHT_SERVICE" });
      await publish(undefined, first.appId);
      store.put("environments", { capabilities }, environmentId);
      service.setState(executionId, "completed");
      const frame = page.frameLocator("iframe");
      const output = frame.locator("output");
      const close = () => page.getByRole("dialog", { name: /^打开 记录簿/ }).getByRole("button", { name: "关闭", exact: true }).click();
      await page.goto(origin + "/#chat/" + session.id);
      const open = (n: number) => page.getByRole("button", { name: "打开 记录簿 · 版本 " + n, exact: true }).click();
      await open(1);
      await expect(output).toHaveText("200 []");
      const save = async (value: string) => {
        await frame.getByLabel("记录").fill(value);
        await frame.getByText("保存").click();
      };
      await save("第一条");
      await expect(output).toHaveText('201 ["第一条"]');
      expect(await readFile(one.database, "utf8")).toBe('["第一条"]');
      await frame.locator("output").evaluate(element => {
        setTimeout(() => { throw new Error(element.textContent!); });
      });
      await expect.poll(() => store.findBy("lightDiagnostics", "versionId", first.versionId).map(row => row.message))
        .toContain("Script error");
      expect(JSON.stringify(store.findBy("lightDiagnostics", "versionId", first.versionId))).not.toContain("第一条");
      await close();
      await page.setViewportSize({ width: 390, height: 844 });
      await open(2);
      await expect(output).toHaveText("200 []");
      await save("第二版");
      await expect(output).toHaveText('201 ["第二版"]');
      expect(await readFile(two.database, "utf8")).toBe('["第二版"]');
      await close();
      await open(1);
      await expect(output).toHaveText('200 ["第一条"]');
      await one.stop();
      const read = () => frame.getByText("读取").click();
      await read();
      await expect(output).toContainText("指定服务不可用");
      await one.restart();
      await read();
      await expect(output).toHaveText('200 ["第一条"]');
      await stopWorker();
      await expect.poll(() => service.peers.has(environmentId)).toBe(false);
      await read();
      await expect(output).toContainText("环境离线");
      worker = startWorker();
      await connected();
      await save("回执中断");
      await expect(output).toContainText("写入结果未确认");
      await read();
      await expect(output).toHaveText('200 ["第一条","回执中断"]');
      await close();
      await page.goto(origin + "/#light-apps");
      await page.getByRole("button", { name: "打开", exact: true }).click();
      await expect(output).toHaveText("静态版");
      await close();
      await page.getByRole("button", { name: "历史版本", exact: true }).click();
      await open(1);
      await expect(output).toHaveText('200 ["第一条","回执中断"]');
      // 使用同账号的管理页撤销访问，验证旧视图失效及环境业务文件保留。
      const admin = await context.newPage();
      try {
        await admin.goto(origin + "/#light-apps");
        await admin.getByRole("button", { name: "下架", exact: true }).click();
        await admin.getByRole("button", { name: "已下架", exact: true }).click();
        await read();
        await expect(output).toContainText("下架");
        await admin.getByRole("button", { name: "恢复上架", exact: true }).click();
        await close();
        await page.goto(origin + "/#chat/" + session.id);
        await open(1);
        await expect(output).toHaveText('200 ["第一条","回执中断"]');
        await page.bringToFront();
        // 将旧版多绑定应用统一到应用级实例，在原视图与另一会话的新版验证切换。
        const other = store.put("sessions", { title: "接续发布", runtime: "codex", environmentId, rootId: "work", relativePath: "other" });
        const otherExecution = randomUUID();
        store.db.prepare("INSERT INTO executions VALUES(?,NULL,?,?,'running','{}',?)")
          .run(otherExecution, other.id, environmentId, new Date().toISOString());
        await mkdir(join(root, "other"));
        await writeFile(join(root, "other/index.html"), await readFile(join(root, "index.html")));
        const args = { appId: first.appId };
        const dispatch = (method: string, input: object) => light.agent(method, environmentId, service.peers.get(environmentId)!, {
          executionId: otherExecution, args: input,
        });
        const current = await makeService(join(config.dir, "light-services", first.appId), '["当前实例"]');
        try {
          await expect(dispatch("light.switchBackend", { ...args, backendServiceId: randomUUID() })).rejects.toMatchObject({ code: "LIGHT_SERVICE" });
          await close();
          await open(1);
          await expect(output).toHaveText('200 ["第一条","回执中断"]');
          expect(await dispatch("light.switchBackend", { ...args, backendServiceId: current.id })).toMatchObject({
            currentBackend: { serviceId: current.id }, replacedBackends: expect.arrayContaining([{ sessionId: session.id, serviceId: one.id, port: expect.any(Number) }]),
          });
          await close();
          await open(1);
          await expect(output).toHaveText('200 ["当前实例"]');
          await close();
          await one.stop();
          await two.stop();
          await dispatch("light.publish", { ...args, reuseBackend: true, operationId: randomUUID() });
          await page.goto(origin + "/#chat/" + other.id);
          await open(4);
          await expect(output).toHaveText('200 ["当前实例"]');
          await close();
        } finally {
          await current.stop();
        }
        await admin.getByRole("button", { name: "已上架", exact: true }).click();
        await admin.getByRole("button", { name: "永久删除", exact: true }).click();
        const dialog = admin.getByRole("dialog", { name: "永久删除" });
        await expect(dialog).toContainText("业务数据库和凭据将保留");
        await dialog.getByRole("button", { name: "永久删除", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(store.get("lightApps", first.appId).deletion).toBe("deleted");
        expect(await readFile(one.database, "utf8")).toBe('["第一条","回执中断"]');
        expect(await readFile(two.database, "utf8")).toBe('["第二版"]');
      } finally {
        await admin.close();
      }
    } finally {
      await stopWorker();
      await one.stop();
      await two.stop();
    }
  });
});
