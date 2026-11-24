import { chromium, expect, test, type Page } from "@playwright/test";
import { createHash, X509Certificate, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { request } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.js";
import { createLightHost } from "../src/server/light-host.js";
import { EnvironmentFiles } from "../src/connector/files.js";
import { digest } from "../src/server/security.js";

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
test("会话与工作项发布、历史反馈、下架恢复及手机查看", async ({
  page,
  context,
}, info) => {
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
      "-keyout",
      privateKey,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  let hostingAvailable = true;
  let dropSaveReceipt = false;
  const proxy = createServer(
    { cert: await readFile(cert), key: await readFile(privateKey) },
    (req, reply) => {
      const target =
        req.headers.host === new URL(origin).hostname ? mainUrl : hostUrl;
      if (target === hostUrl && !hostingAvailable) {
        reply.writeHead(502).end();
        return;
      }
      const incoming = request(
        new URL(req.url!, target),
        {
          method: req.method, headers: req.headers,
          // 让独立设备拥有各自的回环源地址，保留服务端按客户端限流。
          localAddress: req.headers["user-agent"]?.includes("InstalledFixture") ? "127.0.0.2" : "127.0.0.1",
        },
        (response) => {
          if (dropSaveReceipt && req.method === "POST" && req.url?.endsWith("/feedback")) {
            dropSaveReceipt = false;
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
    const boardApp = await publish("看板原型", "看板应用", { executionId: boardExecution });
    const secondExecution = randomUUID();
    store.db.prepare("INSERT INTO executions VALUES(?,NULL,?,?,'running','{}',?)")
      .run(secondExecution, session.id, env.id, new Date((initialTime + 40) * 1000).toISOString());
    mainHistory.events.push({
      type: "turn/started", executionId: secondExecution, sequence: 2, data: { turn: { id: "round-3" } },
    });
    const second = await publish("交互报告", "第二版", { appId: first.appId, executionId: secondExecution });
    fixtureTime(second.versionId, 50);
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
    await versionFrame!.evaluate(() => localStorage.setItem("checkpoint", "closing"));
    await page.keyboard.press("Escape");
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
    await page.getByRole("button", { name: "打开 看板原型 · 版本 1" }).click();
    await expect(
      frame.getByRole("heading", { name: "看板应用" }),
    ).toBeVisible();
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
    dropSaveReceipt = true;
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
    // 后续下架和删除场景沿用原发布执行。
    store.db.prepare("UPDATE executions SET state='running' WHERE id=?").run(execution);

    await page.setViewportSize({ width: 844, height: 390 });
    async function checkLandscape(active: Page, standalone: boolean) {
      await active.setViewportSize({ width: 844, height: 390 });
      const dialog = active.getByRole("dialog").last();
      const enter = dialog.getByRole("button", { name: "全屏", exact: true });
      const leave = dialog.getByRole("button", { name: "退出全屏" });
      const output = active.frameLocator("iframe").locator("output");
      await output.evaluate(el => { el.textContent = "游戏进行中"; });
      expect(await active.evaluate(() => matchMedia("(display-mode: standalone)").matches)).toBe(standalone);
      for (const system of [true, false]) {
        if (!system) await active.evaluate(() => {
          Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: undefined });
        });
        await enter.tap();
        await expect(leave).toBeVisible();
        expect((await leave.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await active.evaluate(() => !!document.fullscreenElement)).toBe(system);
        await expect(dialog.getByRole("button", { name: "仅确认" })).toBeHidden();
        expect(await active.locator("iframe").boundingBox()).toMatchObject({ width: 844, height: 390 });
        await active.screenshot({ path: info.outputPath(`landscape-${standalone ? "pwa" : "browser"}-${system ? "system" : "window"}.png`) });
        if (system) await active.evaluate(() => document.exitFullscreen());
        else await leave.tap();
        await expect(enter).toBeFocused();
        await expect(dialog.getByRole("button", { name: "仅确认" })).toBeVisible();
        await expect(output).toHaveText("游戏进行中");
      }
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
    hostingAvailable = false;
    await expect(
      viewer.getByText("轻应用托管服务不可用，请检查托管连接与配置后重试。"),
    ).toBeVisible({ timeout: 10000 });
    await page.goto(origin + "/#chat/" + session.id);
    await expect(firstButton).toBeVisible();

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
    hostingAvailable = true;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Approve this version" }),
    ).toBeVisible();

    await expect(viewer.getByRole("button", { name: "Approve only" })).toHaveClass(/ui-button-primary/);
    await expect(viewer.getByRole("button", { name: "Approve and notify Agent" })).toHaveClass(/ui-button-secondary/);
    await viewer.getByRole("button", { name: "Request changes" }).click();
    await expect(viewer.getByRole("button", { name: "Submit and ask Agent to act" })).toHaveClass(/ui-button-primary/);
    await expect(viewer.getByRole("button", { name: "Submit feedback only" })).toHaveClass(/ui-button-secondary/);

    // 会话事件实时送达，拒绝保持上架，新增版本需要重新审阅。
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    service.peers.set(env.id, peer);
    store.put("sessions", { permission: "full" }, session.id);
    store.db.prepare("UPDATE executions SET snapshot=? WHERE id=?")
      .run(JSON.stringify({ permission: "full" }), execution);
    await mkdir(root);
    await writeFile(join(root, "index.html"), "<h1>Updated</h1>");
    await writeFile(join(root, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const requestDelete = () => light.agent("light.delete", env.id, peer, {
      executionId: execution,
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
    await publish("交互报告", "Fourth", { appId: first.appId });
    await confirmDeletion.click();
    await expect(deletion.getByText(/all 4 versions/)).toBeVisible();
    await expect(deletion.getByText(/The versions changed/)).toBeVisible();
    expect(store.get("lightApps", first.appId).listed).toBe(true);
    await page.screenshot({ path: info.outputPath("mobile-scope-changed-en.png"), animations: "disabled" });
    await confirmDeletion.click();
    await expect(deletion).toHaveCount(0);
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
    await deleteButton("看板原型").click();
    await expect(dialog.getByText(/全部 1 个版本/)).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(deleteButton("看板原型")).toBeVisible();
    await deleteButton("看板原型").click();
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: info.outputPath("desktop-delete-zh.png"), animations: "disabled" });
    await confirm.click();
    await expect(card("看板原型")).toHaveCount(0);
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
  } finally {
    await page.close({ reason: "fixture complete" });
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
    await host.close();
    await internal.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
