import { randomUUID } from "node:crypto";
import { digest } from "../src/server/security.js";
import { checkSessionDrawer, checkLongChatTitle } from "./brand-browser.js";
import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.js";
/** 在应用挂载前检查主题，防止刷新时短暂显示错误皮肤。 */
test("主站首屏恢复主题并兼容不可用的站点存储", async ({ browser }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-theme-"));
  const { app } = await createApp({
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  });
  try {
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    const manifest = (await app.inject("/manifest.webmanifest")).json();
    for (const saved of [null, "light", "dark", "bug", "unknown", "blocked"]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.addInitScript((value) => {
          if (value === "blocked") {
            Object.defineProperty(window, "localStorage", {
              get() { throw new DOMException("Storage blocked", "SecurityError"); },
            });
          }
        }, saved);
        // 在同源静态页写入一次，以便后续刷新能检出缓存被覆盖的问题。
        await page.goto(base + "/manifest.webmanifest");
        if (saved && saved !== "blocked") {
          await page.evaluate((value) => localStorage.setItem("relay-theme", value), saved);
        }
        const expected = saved === "dark" || saved === "light" ? saved : "bug";
        await page.route("**/assets/*.js", (route) => route.abort());
        await page.goto(new URL(manifest.start_url, base).href);
        await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
        await page.unroute("**/assets/*.js");
        await page.reload();
        await expect(page.getByLabel("初始化令牌")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
        if (saved !== "blocked") {
          expect(await page.evaluate(() => localStorage.getItem("relay-theme"))).toBe(saved);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 在隔离数据目录运行真实前端；不向公共预览服务发布认证页面或测试数据。 */
test("桌面与移动端真实业务操作、统一控件和 PWA", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-browser-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1:3180",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(appOptions);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as any;
  const base = `http://127.0.0.1:${address.port}`;
  appOptions.publicUrl = base;
  try {
    await page.goto(base);
    await page.screenshot({
      path: ".vibe/audit/login-1440.png",
      animations: "disabled",
      fullPage: true,
    });
    await page
      .getByLabel("初始化令牌")
      .fill(readFileSync(join(dir, "setup-token"), "utf8"));
    await page.getByLabel("账号", { exact: true }).fill("browser-test");
    await page
      .getByLabel("密码（至少 12 位）", { exact: true })
      .fill("browser-test-password");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "今天，一起推进什么？" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "bug");
    await page.getByRole("button", { name: "会话", exact: true }).click();
    await page.getByRole("button", { name: "项目管理", exact: true }).click();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("浏览器测试项目");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.getByRole("button", { name: "看板", exact: true }).click();
    await page.getByRole("button", { name: "新建看板", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("验收流程");
    await page.getByRole("button", { name: "所属项目", exact: true }).click();
    await page
      .getByRole("option", { name: "浏览器测试项目", exact: true })
      .click();
    await expect(page.getByLabel("阶段名称")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "添加阶段" })).toHaveCount(0);
    await page.getByRole("button", { name: "创建看板", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByText("S1 · 未开始", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await page.getByRole("button", { name: "添加阶段", exact: true }).click();
    await expect(page.getByLabel("阶段名称", { exact: true })).toHaveCount(1);
    await page.getByLabel("阶段名称", { exact: true }).fill("复核");
    await page.getByRole("button", { name: "保存流程", exact: true }).click();
    await expect(
      page.locator(".column-title").filter({ hasText: "复核" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "新建工作项", exact: true }).click();
    await page.getByLabel("标题", { exact: true }).fill("验收工作项");
    await page.getByLabel("需求内容").fill("验证人工阶段交接和持久化");
    await page.getByRole("button", { name: "创建工作项", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "验收工作项", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("heading", { name: "验收工作项", exact: true })
      .click();
    await page.getByRole("button", { name: "目标阶段", exact: true }).click();
    await page
      .getByRole("option", { name: "S2 · 已完成", exact: true })
      .click();
    await page
      .getByLabel("交接记录（选填）", { exact: true })
      .fill("浏览器验证完成");
    await page.getByRole("button", { name: "提交交接并推进" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.reload();
    await expect(
      page
        .locator(".column")
        .filter({ has: page.locator(".column-title", { hasText: "已完成" }) })
        .getByRole("heading", { name: "验收工作项" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "智能体", exact: true }).click();
    await page.getByRole("button", { name: "新建智能体", exact: true }).click();
    // 长表单中首次展开和再次展开都应保持滚动位置，选项必须紧邻触发按钮。
    const dialog = page.getByRole("dialog");
    const selectors = dialog.locator('button[aria-haspopup="listbox"]:enabled');
    const originalViewport = page.viewportSize()!;
    for (const viewport of [{ width: 1262, height: 979 }, { width: 390, height: 720 }]) {
      await page.setViewportSize(viewport);
      expect(await selectors.count()).toBeGreaterThan(1);
      for (const trigger of await selectors.all()) {
        await trigger.evaluate((button) => button.scrollIntoView({ block: "center" }));
        const top = await dialog.evaluate((element) => element.scrollTop);
        for (let attempt = 0; attempt < 2; attempt++) {
          await trigger.click();
          const menu = dialog.getByRole("listbox");
          await expect(menu).toBeVisible();
          await menu.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
          expect(await dialog.evaluate((element) => element.scrollTop)).toBe(top);
          const buttonBox = (await trigger.boundingBox())!;
          const menuBox = (await menu.boundingBox())!;
          const gap = Math.min(
            Math.abs(menuBox.y - buttonBox.y - buttonBox.height),
            Math.abs(buttonBox.y - menuBox.y - menuBox.height),
          );
          expect(gap).toBeLessThan(12);
          await page.keyboard.press("Escape");
          await expect(trigger).toBeFocused();
        }
      }
    }
    await page.setViewportSize(originalViewport);
    await page.getByLabel("名称", { exact: true }).fill("审阅助手");
    await page.getByLabel("职责指令").fill("审阅变更并给出明确证据。");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "审阅助手" })).toBeVisible();
    await expect(page.getByLabel("职责指令")).toHaveValue(
      "审阅变更并给出明确证据。",
    );
    // 详情内连续保存必须使用最新版本，筛选切换前保护未保存草稿。
    for (const text of ["审阅变更并检查测试。", "审阅变更并给出明确证据。"]) {
      await page.getByLabel("职责指令").fill(text);
      await page.getByRole("button", { name: "保存配置", exact: true }).click();
      await expect.poll(() => store.list("agents")[0].instructions).toBe(text);
    }
    await page.getByLabel("职责指令").fill("未保存草稿");
    await page.getByRole("button", { name: "环境级", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByLabel("职责指令")).toHaveValue("未保存草稿");
    await page.getByLabel("职责指令").fill("审阅变更并给出明确证据。");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("待配置测试模型");
    await page.getByLabel("模型标识").fill("test-model");
    await page.getByLabel("API 基础地址").fill("http://192.168.100.2/v1");
    await expect(
      page.getByText("HTTP 为明文传输，请确认网络可信"),
    ).toBeVisible();
    await page.getByLabel("API 基础地址").fill("http://127.0.0.1/v1");
    await expect(page.getByText("HTTP 为明文传输，请确认网络可信")).toHaveCount(
      0,
    );
    await page.getByLabel("API 基础地址").fill("https://example.invalid/v1");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(page.getByText("待配置密钥", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "安装包下载", exact: true }).click();
    await expect(page.getByLabel("下载链接有效期（分钟）")).toHaveValue("10");
    await page.getByLabel("下载链接有效期（分钟）").fill("20");
    await page.getByRole("button", { name: "保存下载配置" }).click();
    await expect(
      page
        .locator(".settings-panel [role=status]")
        .filter({ hasText: "已保存" }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "安装包下载", exact: true }).click();
    await expect(page.getByLabel("下载链接有效期（分钟）")).toHaveValue("20");

    for (const theme of ["深色", "BUG", "浅色"]) {
      await page
        .getByRole("button", { name: theme + "主题", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme === "深色" ? "dark" : theme === "BUG" ? "bug" : "light",
      );
    }
    const reopened = await page.context().newPage();
    await reopened.goto(base);
    await expect(reopened.locator("html")).toHaveAttribute("data-theme", "light");
    await reopened.close();
    const environment = store.put("environments", {
      name: "审计开发环境",
      approved: true,
      roots: [
        { id: "workspace", path: "/projects/团队项目" },
        { id: "second", path: "/data/另一工作目录" },
      ],
      tools: {
        codex: { available: true, version: "Codex" },
        claude: { available: false },
      },
      platform: "linux/x64",
    });
    const board = store.list("boards")[0];
    const session = store.put("sessions", {
      title: "核对多目录配置与会话状态",
      projectId: store.list("projects")[0].id,
      environmentId: environment.id,
      rootId: "workspace",
      relativePath: ".",
      runtime: "codex",
      permission: "ask",
      status: "idle",
    });
    // 本例只注入隔离历史响应以覆盖会话视觉；真实原生进程由协议测试独立验证。
    service.peers.set(environment.id, {
      call: async () => ({
        events: [
          { type: "user", data: { text: "请检查当前项目的目录配置。" } },
          {
            type: "item/completed",
            data: {
              item: {
                type: "agentMessage",
                text: "已检查配置。两个工作根目录均已同步，可选择目标项目继续协作。",
              },
            },
          },
        ],
        interactions: [],
      }),
      close: () => {},
    } as any);
    const conversation = store.put("workbench", {
      title: "检查开发环境",
      modelId: store.list("models")[0].id,
      permission: "ask",
      history: [],
      transcript: [
        { role: "user", text: "查看当前开发环境状态" },
        {
          role: "assistant",
          text: "环境状态已读取。请在客户端保存配置后启动连接器，同步工作根目录。",
        },
      ],
      status: "idle",
    });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        "workbench",
        "workbench/" + conversation.id,
        "chat",
        "chat/" + session.id,
        "board",
        "board/" + board.id,
        "agents",
        "environments",
        "environments/" + environment.id,
        "settings",
      ]) {
        await page.goto(base + "/#" + route);
        await expect(page.locator(".content")).toBeVisible();
        await page.waitForTimeout(260);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (route === "settings" && width < 760) {
          // 分类可以横向滚动，但文字不得溢出各自按钮并覆盖相邻标签。
          expect(
            await page
              .locator(".setting-nav button")
              .evaluateAll((buttons) =>
                buttons.every(
                  (button) => button.scrollWidth <= button.clientWidth,
                ),
              ),
          ).toBe(true);
        }
        await page.screenshot({
          path:
            ".vibe/audit/" +
            route.split("/")[0] +
            (route.includes("/") ? "-detail" : "") +
            "-" +
            width +
            ".png",
          animations: "disabled",
          fullPage: true,
        });
      }
      await page.goto(base + "/#board/" + board.id);
      await page.getByRole("button", { name: "流程配置", exact: true }).click();
      await page.screenshot({
        path: ".vibe/audit/board-flow-" + width + ".png",
        animations: "disabled",
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.goto(base + "/#environments/" + environment.id);
      for (const tab of ["工作目录", "编码工具"]) {
        await page.getByRole("button", { name: tab, exact: true }).click();
        await page.screenshot({
          path:
            ".vibe/audit/environment-" +
            (tab === "工作目录" ? "roots" : "tools") +
            "-" +
            width +
            ".png",
          animations: "disabled",
          fullPage: true,
        });
      }
      await page.goto(base + "/#settings");
      for (const category of ["账号与安全", "外观与应用"]) {
        await page.getByRole("button", { name: category, exact: true }).click();
        await expect(
          page.getByRole("heading", { name: category, exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path:
            ".vibe/audit/settings-" +
            (category === "账号与安全" ? "security" : "appearance") +
            "-" +
            width +
            ".png",
          animations: "disabled",
          fullPage: true,
        });
      }
    }
    await page.goto(base + "/#workbench");
    expect(
      await page
        .locator(".suggest strong")
        .first()
        .evaluate((e) => e.getBoundingClientRect().width),
    ).toBeGreaterThan(200);
    // 输入区底部的选择器必须向上展开，键盘选择后回到触发按钮。
    await page.goto(base + "/#workbench");
    const permission = page.getByRole("button", {
      name: "工作台权限",
      exact: true,
    });
    {
      await permission.click();
      const box = await page
        .getByRole("listbox", { name: "工作台权限" })
        .boundingBox();
      expect(
        box,
        JSON.stringify({ box, viewport: page.viewportSize() }),
      ).toBeTruthy();
      expect(box!.y, JSON.stringify(box)).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, JSON.stringify(box)).toBeLessThanOrEqual(
        900,
      );
      await page.keyboard.press("Escape");
      await expect(permission).toBeFocused();
    }
    for (const theme of ["dark", "bug"]) {
      await page.evaluate((value) => {
        localStorage.setItem("relay-theme", value);
      }, theme);
      // 每个主题只刷新一次验证持久化，路由截图不反复下载整套资源触发限流。
      await page.reload();
      for (const route of [
        "workbench",
        "chat/" + session.id,
        "board/" + board.id,
        "agents",
        "environments/" + environment.id,
        "settings",
      ]) {
        await page.goto(base + "/#" + route);
        await expect(page.locator(".content")).toBeVisible();
        await page.screenshot({
          path:
            ".vibe/audit/theme-" + theme + "-" + route.split("/")[0] + ".png",
          animations: "disabled",
          fullPage: true,
        });
      }
    }
    await page.goto(base + "/#environments");
    const menu = page.locator(".mobile-menu");
    await menu.click();
    await expect(page.locator(".rail-home")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".rail .profile-logout")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "接入环境", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "接入环境", exact: true }),
    ).toBeFocused();
    expect(await page.locator("select").count()).toBe(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".ui-page")
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("none");
    const manifest = await (
      await page.request.get(base + "/manifest.webmanifest")
    ).json();
    expect(manifest.display).toBe("standalone");
    await page.evaluate(() => navigator.serviceWorker.ready);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 发布包本机配置页覆盖实际交互及窄屏，避免仅检查 HTML 字符串。 */
test("连接器 Web 配置页保存和移动端布局", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { spawn } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "relay-local-web-"));
  const child = spawn(
    process.execPath,
    [resolve("dist/connector/main.js"), "web", "--no-open"],
    {
      env: { ...process.env, BUGPAW_HOME: dir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let text = "";
      const timeout = setTimeout(() => reject(Error("startup timeout")), 10000);
      child.stdout!.on("data", (data) => {
        text += data;
        const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/#\S+/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      });
      child.on("error", reject);
    });
    await page.goto(url);
    await expect(
      page.getByText("已停止 · 未注册", { exact: true }),
    ).toBeVisible();
    // 隔离配置必须显式提供服务端地址，不依赖历史默认部署地址。
    await page
      .getByLabel("服务端地址", { exact: true })
      .fill("http://127.0.0.1:3180");
    await page.getByLabel("环境名称", { exact: true }).fill("便携环境");
    await page.getByRole("tab", { name: "工作目录", exact: true }).click();
    await page.getByLabel("工作根目录（每行一个绝对路径）").fill(dir);
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect(page.getByText("操作成功", { exact: true })).toBeVisible();
    expect(
      JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).name,
    ).toBe("便携环境");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of ["概览", "工作目录", "CLI 工具", "启动设置"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path:
            ".vibe/audit/client-" +
            ["概览", "工作目录", "CLI 工具", "启动设置"].indexOf(tab) +
            "-" +
            width +
            ".png",
          animations: "disabled",
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "启动连接器", exact: true }).click();
    await expect(
      page.getByText("请先填写接入码并注册环境", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 真实本机表单 → 注册/连接 → 服务端项目选择，覆盖未点保存和重排根目录。 */
test("客户端新增根目录自动保存并同步到服务端项目选择器", async ({
  page,
  context,
}) => {
  const { spawn } = await import("node:child_process");
  const { mkdirSync, writeFileSync, statSync } = await import("node:fs");
  const { digest } = await import("../src/server/security.js");
  const { ConnectorConfig } = await import("../src/connector/config.js");
  const { stopWorker } = await import("../src/connector/process.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-roots-browser-"));
  const home = join(dir, "client");
  const rootA = join(dir, "项目一");
  const rootB = join(dir, "项目二");
  mkdirSync(rootA);
  mkdirSync(rootB);
  mkdirSync(join(rootB, "子目录"));
  const appOptions = {
    dataDir: join(dir, "server"),
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(appOptions);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  const settings = new ConnectorConfig(home);
  const child = spawn(
    process.execPath,
    [resolve("dist/connector/main.js"), "web", "--no-open"],
    {
      env: { ...process.env, BUGPAW_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const local = await new Promise<string>((done, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(Error("本机控制台启动超时")),
        10000,
      );
      child.stdout!.on("data", (data) => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#\S+/);
        if (match) {
          clearTimeout(timer);
          done(match[0]);
        }
      });
      child.on("error", reject);
    });
    const invitation = "isolated-browser-invitation";
    store.db
      .prepare("INSERT INTO invitations VALUES(?,?,0)")
      .run(digest(invitation), Date.now() + 600000);
    await page.goto(local);
    await expect(
      page.getByText("已停止 · 未注册", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("服务端地址", { exact: true }).fill(base);
    await page.getByLabel("环境名称", { exact: true }).fill("多目录环境");
    await page.getByRole("tab", { name: "工作目录", exact: true }).click();
    await page
      .getByLabel("工作根目录（每行一个绝对路径）")
      .fill(rootA + "\n" + rootB);
    await page.getByRole("tab", { name: "概览", exact: true }).click();
    await page.getByLabel("一次性接入码").fill(invitation);
    await page.getByRole("button", { name: "注册并连接", exact: true }).click();
    await expect.poll(() => store.list("environments").length).toBe(1);
    const id = store.list("environments")[0].id;
    store.put("environments", { approved: true }, id);
    await expect
      .poll(() => service.peers.has(id), { timeout: 20000 })
      .toBe(true);
    await expect.poll(() => store.get("environments", id).roots.length).toBe(2);
    expect(store.get("environments", id).roots.map((r: any) => r.path)).toEqual(
      [rootA, rootB],
    );
    const roots = settings.read().roots;
    // 停止后重排目录再启动，已有根标识必须保持稳定，新增项不能按行号冲突。
    await page.getByRole("button", { name: "停止连接器", exact: true }).click();
    await page.getByRole("button", { name: "确认停止", exact: true }).click();
    await expect(
      page.getByText("已停止 · 已注册", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "工作目录", exact: true }).click();
    await page
      .getByLabel("工作根目录（每行一个绝对路径）")
      .fill(rootB + "\n" + rootA);
    await page.getByRole("button", { name: "启动连接器", exact: true }).click();
    await expect
      .poll(() => store.get("environments", id).roots[0].path, {
        timeout: 20000,
      })
      .toBe(rootB);
    expect(settings.read().roots.map((r: any) => r.id)).toEqual([
      roots[1].id,
      roots[0].id,
    ]);
    await expect.poll(() => service.peers.has(id)).toBe(true);
    const server = await context.newPage();
    await server.goto(base);
    await server
      .getByLabel("初始化令牌")
      .fill(readFileSync(join(dir, "server/setup-token"), "utf8"));
    await server.getByLabel("账号", { exact: true }).fill("root-browser");
    await server
      .getByLabel("密码（至少 12 位）", { exact: true })
      .fill("isolated-browser-password");
    await server
      .getByRole("button", { name: "创建管理员", exact: true })
      .click();
    await server.getByRole("button", { name: "登录", exact: true }).click();
    await server.getByRole("button", { name: "会话", exact: true }).click();
    await server.getByRole("button", { name: "项目管理", exact: true }).click();
    await server.getByRole("button", { name: "新建项目", exact: true }).click();
    await server.getByLabel("名称", { exact: true }).fill("第二根目录项目");
    await server
      .getByRole("button", { name: "添加环境目录", exact: true })
      .click();
    await server.getByRole("button", { name: "开发环境", exact: true }).click();
    await server
      .getByRole("option", { name: "多目录环境", exact: true })
      .click();
    await server
      .getByRole("button", { name: "工作根目录", exact: true })
      .click();
    await expect(
      server.getByRole("option", { name: rootA, exact: true }),
    ).toBeVisible();
    await server.getByRole("option", { name: rootB, exact: true }).click();
    await server
      .getByRole("button", { name: "浏览子目录", exact: true })
      .click();
    await server.getByRole("button", { name: "子目录", exact: true }).click();
    await server.getByRole("button", { name: "验证目录", exact: true }).click();
    await expect(
      server.getByText("目录有效：" + join(rootB, "子目录"), { exact: true }),
    ).toBeVisible();
    // 直接保存未验证的路径，失败后保留草稿并允许修改重试。
    const pathInput = server.getByLabel("相对路径", { exact: true });
    const save = server.getByRole("button", { name: "保存配置", exact: true });
    writeFileSync(join(rootB, "占用"), "保留");
    await pathInput.fill("占用/demo");
    await save.click();
    await expect(server.getByText("环境 多目录环境，路径“占用/demo”：路径中已有同名文件或无效链接。")).toBeVisible();
    await expect(pathInput).toHaveValue("占用/demo");
    expect(store.list("projects")).toHaveLength(0);
    await pathInput.fill("新团队/demo");
    await save.click();
    await expect(server.getByRole("dialog")).toHaveCount(0);
    expect(statSync(join(rootB, "新团队/demo")).isDirectory()).toBe(true);
    expect(store.list("projects")[0].directories[0].relativePath).toBe("新团队/demo");
    expect(store.list("projects")[0].directories[0].rootId).toBe(roots[1].id);
    await server.close();
  } finally {
    await stopWorker(settings);
    child.kill("SIGTERM");
    await new Promise((done) => child.once("exit", done));
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 使用隔离数据库驱动真实轮询，验证消息增长而非固定截图。 */
test("工作台竖屏、快捷键、Markdown、平滑输出与条件跟随", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-workbench-ui-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1:3180",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store } = await createApp(appOptions);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const model = store.put("models", {
      name: "界面测试模型",
      model: "test",
      protocol: "responses",
      baseUrl: "https://example.invalid/v1",
    });
    const markdown =
      "## 渲染检查\n\n**重点** 与 [安全链接](https://example.com)\n\n- 第一项\n- 第二项\n\n> 引用内容\n\n```ts\nconst value = 1;\n```\n\n| 名称 | 状态 |\n| --- | --- |\n| 测试 | 完成 |\n\n<script>window.badMarkdown=true</script>\n[危险链接](javascript:alert(1))";
    const transcript = Array.from({ length: 24 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      text: `历史消息 ${i}\n\n` + "用于验证较长历史的滚动位置。".repeat(12),
    }));
    transcript.push({ role: "assistant", text: markdown });
    const session = store.put("workbench", {
      title: "工作台交互验收",
      modelId: model.id,
      permission: "ask",
      status: "idle",
      transcript,
      history: [],
    });
    await page.goto(base);
    await page
      .getByLabel("初始化令牌")
      .fill(readFileSync(join(dir, "setup-token"), "utf8"));
    await page.getByLabel("账号", { exact: true }).fill("workbench-test");
    await page.getByLabel("密码（至少 12 位）").fill("workbench-test-password");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    const input = page.getByLabel("工作台消息", { exact: true });
    await expect(input).toBeVisible();
    for (const size of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 390, height: 420 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(async () =>
          input.evaluate(
            (node) =>
              node.getBoundingClientRect().bottom <= innerHeight &&
              document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await expect
        .poll(async () =>
          page
            .getByRole("button", { name: "发送", exact: true })
            .evaluate(
              (node) => node.getBoundingClientRect().bottom <= innerHeight,
            ),
        )
        .toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".vibe/audit/workbench-welcome-mobile.png" });
    await page.evaluate((id) => {
      location.hash = "workbench/" + id;
    }, session.id);
    const messages = page.getByLabel("工作台消息记录");
    const distance = () =>
      messages.evaluate(
        (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
      );
    await expect(messages).toBeVisible();
    await expect.poll(distance).toBeLessThanOrEqual(2);
    await expect(messages.locator("h2")).toHaveText("渲染检查");
    await expect(messages.locator("table td")).toHaveCount(2);
    await expect(messages.locator("pre code")).toHaveText("const value = 1;\n");
    await expect(messages.locator("script")).toHaveCount(0);
    expect(
      await messages
        .getByText("危险链接", { exact: true })
        .getAttribute("href"),
    ).not.toMatch(/^javascript:/);
    await page.screenshot({
      path: ".vibe/audit/workbench-markdown-mobile.png",
    });
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      const boxes = await page
        .locator(
          ".unified-composer .select-trigger, .unified-composer .attachment, .unified-composer button[aria-label='发送']",
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            top: node.getBoundingClientRect().top,
            right: node.getBoundingClientRect().right,
          })),
        );
      expect(
        Math.max(...boxes.map((box) => box.top)) -
          Math.min(...boxes.map((box) => box.top)),
      ).toBeLessThanOrEqual(2);
      expect(Math.max(...boxes.map((box) => box.right))).toBeLessThanOrEqual(
        viewport.width,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const key of ["Shift+Enter", "Control+Enter", "Meta+Enter"]) {
      await input.fill("前后");
      await input.press("ArrowLeft");
      await input.press(key);
      await expect(input).toHaveValue("前\n后");
    }
    let sends = 0;
    await page.route("**/api/workbench/*/send", async (route) => {
      sends++;
      await route.fulfill({ json: { ok: true } });
    });
    await input.fill("输入法确认");
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
    await expect(input).toHaveValue("输入法确认");
    expect(sends).toBe(0);
    await input.press("Enter");
    await expect.poll(() => sends).toBe(1);
    await expect(input).toHaveValue("");
    await input.press("Enter");
    expect(sends).toBe(1);
    store.put("workbench", { status: "running", partial: "" }, session.id);
    await expect(
      page.getByText("BugPaw Relay · 正在回答", { exact: true }),
    ).toBeVisible();
    await input.fill("运行中不重复发送");
    await input.press("Enter");
    expect(sends).toBe(1);
    await messages.evaluate((node) => {
      (window as any).revealLengths = [];
      const observer = new MutationObserver(() => {
        (window as any).revealLengths.push(
          node.querySelector(".message:last-child .workbench-markdown")
            ?.textContent?.length || 0,
        );
      });
      observer.observe(node, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      (window as any).revealObserver = observer;
    });
    const partial = "平滑输出验证。".repeat(80);
    store.put("workbench", { partial }, session.id);
    await expect(messages.locator(".message").last()).toContainText(partial);
    const lengths = await page.evaluate(
      () => (window as any).revealLengths as number[],
    );
    expect(
      new Set(lengths.filter((n) => n > 0 && n < partial.length)).size,
    ).toBeGreaterThan(2);
    await expect.poll(distance).toBeLessThanOrEqual(2);
    await messages.evaluate((node) => {
      node.scrollTop = 100;
    });
    await expect(
      page.getByRole("button", { name: "回到最新消息" }),
    ).toBeVisible();
    store.put(
      "workbench",
      { partial: partial + "新增内容".repeat(150) },
      session.id,
    );
    await expect(messages.locator(".message").last()).toContainText("新增内容");
    await expect
      .poll(() => messages.evaluate((node) => node.scrollTop))
      .toBe(100);
    await page.getByRole("button", { name: "回到最新消息" }).click();
    await expect.poll(distance).toBeLessThanOrEqual(2);
    const completed = partial + "新增内容".repeat(150) + "回答结束。";
    store.put(
      "workbench",
      {
        status: "idle",
        partial: "",
        transcript: [...transcript, { role: "assistant", text: completed }],
      },
      session.id,
    );
    await expect(messages.locator(".message").last()).toContainText(completed);
    await expect.poll(distance).toBeLessThanOrEqual(2);
    await expect(messages.locator(".message")).toHaveCount(
      transcript.length + 1,
    );
    await page.evaluate(() => {
      (window as any).revealObserver.disconnect();
      location.hash = "workbench";
    });
    await expect(messages).toHaveCount(0);
    await page.evaluate((id) => {
      location.hash = "workbench/" + id;
    }, session.id);
    await expect(messages).toBeVisible();
    await expect.poll(distance).toBeLessThanOrEqual(2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    store.put(
      "workbench",
      { status: "running", partial: "减少动态效果完整显示" },
      session.id,
    );
    await expect(messages.locator(".message").last()).toContainText(
      "减少动态效果完整显示",
    );
    for (const theme of ["dark", "bug", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({
        path: `.vibe/audit/workbench-mobile-${theme}.png`,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: ".vibe/audit/workbench-desktop.png" });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 覆盖四个执行操作、倒序历史、长内容及三主题窄屏布局，数据完全隔离。 */
test("看板详情与流程操作布局、历史排序和删除规则", async ({ page }) => {
  const { randomUUID } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "relay-board-browser-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1:3180",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(appOptions);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  try {
    const environment = store.put("environments", {
      name: "测试环境",
      roots: [{ id: "root", path: dir }],
      approved: true,
    });
    const project = service.save("projects", {
      name: "看板优化验证",
      directories: [
        { environmentId: environment.id, rootId: "root", relativePath: "." },
      ],
    });
    const human = randomUUID(),
      agent = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "产品迭代",
      projectId: project.id,
      stages: [
        {
          id: human,
          fixedRole: "start",
          name: "待处理",
          type: "human",
          targets: [agent],
        },
        {
          id: agent,
          name: "开发",
          type: "agent",
          agentId: service.save("agents", { name: "Fixture agent" }).id,
          targets: [done],
          environmentId: environment.id,
          rootId: "root",
          relativePath: ".",
          concurrency: 1,
        },
        { id: done, name: "已完成", type: "done", targets: [] },
      ],
    });
    const item = service.createItem({
      boardId: board.id,
      title: "优化看板详情与阶段操作",
      content:
        "完善信息层次，检查窄屏下的按钮排列。\n" + "long-content/".repeat(30),
      priority: "high",
      tags: ["界面", "移动端"],
    });
    service.advance(item.id, agent, "第一条交接记录", randomUUID());
    const executing = store.get("items", item.id);
    service.setState(executing.executionId, "failed");
    // 插入顺序故意与时间相反，避免仅反转数组的实现蒙混通过。
    store.put("handoffs", {
      itemId: item.id,
      from: human,
      to: agent,
      record: "最新交接记录",
      createdAt: "2030-01-03T00:00:00.000Z",
    });
    store.put("handoffs", {
      itemId: item.id,
      from: human,
      to: agent,
      record: "中间交接记录",
      createdAt: "2030-01-02T00:00:00.000Z",
    });
    for (const handoff of store.list("handoffs")) {
      const date =
        handoff.record === "最新交接记录"
          ? "2030-01-03T00:00:00.000Z"
          : handoff.record === "中间交接记录"
            ? "2030-01-02T00:00:00.000Z"
            : "2030-01-01T00:00:00.000Z";
      store.db
        .prepare(
          "UPDATE entities SET body=json_set(body, '$.createdAt', ?) WHERE id=?",
        )
        .run(date, handoff.id);
    }
    await page.goto(base);
    await page
      .getByLabel("初始化令牌")
      .fill(readFileSync(join(dir, "setup-token"), "utf8"));
    await page.getByLabel("账号", { exact: true }).fill("board-test");
    await page
      .getByLabel("密码（至少 12 位）", { exact: true })
      .fill("board-test-password");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.locator(".content")).toBeVisible();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + "/#board/" + board.id);
      await page.getByRole("button", { name: "流程配置", exact: true }).click();
      const actions = page.locator(".ui-flow-footer");
      await expect(
        actions.getByRole("button", { name: "添加阶段" }),
      ).toBeVisible();
      const boxes = await actions.locator("button").evaluateAll((nodes) =>
        nodes.map((node) => ({
          y: node.getBoundingClientRect().y,
          height: node.getBoundingClientRect().height,
        })),
      );
      expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(2);
      expect(boxes.every((box) => box.height < 55)).toBe(true);
      await page.screenshot({
        path: `.vibe/board-polish/flow-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "工作项", exact: true }).click();
      await page
        .getByRole("heading", { name: item.title, exact: true })
        .click();
      const detail = page.locator(".item-detail");
      await expect(detail.locator(".item-actions .btn")).toHaveCount(4);
      await expect(detail.locator(".handoff-entry").first()).toContainText(
        "最新交接记录",
      );
      await expect(detail.locator(".handoff-entry").nth(1)).toContainText(
        "中间交接记录",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await detail.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      const buttons = await detail
        .locator(".item-actions .btn")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            width: node.clientWidth,
            scroll: node.scrollWidth,
            height: node.getBoundingClientRect().height,
          })),
        );
      expect(
        buttons.every(
          (button) => button.scroll <= button.width && button.height < 55,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.vibe/board-polish/detail-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await detail
        .locator(".handoff-entry")
        .last()
        .evaluate((node) => {
          const dialog = node.closest("dialog")!;
          dialog.scrollTop = dialog.scrollHeight;
        });
      await page.screenshot({
        path: `.vibe/board-polish/history-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }
    for (const theme of ["dark", "bug"]) {
      await page.evaluate(
        (value) => localStorage.setItem("relay-theme", value),
        theme,
      );
      await page.reload();
      await page
        .getByRole("heading", { name: item.title, exact: true })
        .click();
      await page.screenshot({
        path: `.vibe/board-polish/detail-${theme}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }
    await page
      .locator(".ui-board-toolbar")
      .getByRole("button", { name: "更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除看板", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("未完成且未归档");
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "存在未完成且未归档的工作项，不能删除看板",
    );
    store.put("items", { archived: true }, item.id);
    await page.reload();
    await page
      .locator(".ui-board-toolbar")
      .getByRole("button", { name: "更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除看板", exact: true }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(
      page.getByText("创建第一个看板", { exact: true }),
    ).toBeVisible();
    expect(store.list("boards")).toHaveLength(0);
    expect(store.list("items")).toHaveLength(0);
    expect(store.list("sessions")).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 工作台活动与生命周期使用真实页面和 API；流内容来自隔离数据库。 */
test("工作台活动收起、压缩居中、归档删除与全宽滚动", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-workbench-activities-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1:3180",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, workbench } = await createApp(appOptions);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const model = store.put("models", {
      name: "活动测试模型",
      model: "fixture",
      protocol: "responses",
      baseUrl: "https://example.invalid/v1",
    });
    const session = workbench.create({
      title: "活动与归档验证",
      modelId: model.id,
      permission: "ask",
    });
    const blocks: any[] = [
      { type: "text", id: "text-1", text: "先查询环境。", streaming: false },
      {
        type: "tool",
        id: "tool-1",
        name: "platform_read",
        status: "failed",
        arguments: '{"kind":"environments"}',
        output: "工具执行失败，请核对参数和目标状态后重试。",
      },
    ];
    const history = Array.from({ length: 15 }, (_, index) => ({
      role: "user",
      text: `较长历史 ${index}。` + "用于验证对话滚动。".repeat(20),
    }));
    const update = (status: string) =>
      store.put(
        "workbench",
        {
          status,
          runId: "fixture-run",
          transcript: [
            ...history,
            { role: "assistant", runId: "fixture-run", text: "", blocks },
          ],
        },
        session.id,
      );
    update("running");
    await page.goto(base);
    await page
      .getByLabel("初始化令牌")
      .fill(readFileSync(join(dir, "setup-token"), "utf8"));
    await page.getByLabel("账号", { exact: true }).fill("activity-browser");
    await page
      .getByLabel("密码（至少 12 位）")
      .fill("isolated-browser-password");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByLabel("工作台消息", { exact: true })).toBeVisible();
    await page.evaluate((id) => {
      location.hash = "workbench/" + id;
    }, session.id);
    // 路由切换后等待目标会话标题，避免读取空态标题。
    await expect(page.locator(".chat-heading h2")).toHaveText("活动与归档验证");
    await checkLongChatTitle(page);
    const summary = page.locator(".workbench-activity-summary");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(summary).toContainText("1 项失败");
    // 用户此前展开过失败活动，下一段文本仍必须自动收起；之后允许重新展开。
    await summary.click();
    await summary.click();
    blocks.push({
      type: "text",
      id: "text-2",
      text: "查询失败，下面说明处理建议。",
      streaming: true,
    });
    update("running");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByText("查询失败，下面说明处理建议。", { exact: true }),
    ).toBeVisible();
    await summary.click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await page.locator(".workbench-activity summary").click();
    await expect(page.locator(".workbench-activity-detail")).toContainText(
      '"kind": "environments"',
    );
    blocks[2].streaming = false;
    update("idle");
    await page.reload();
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await summary.click();
    await expect(page.locator(".workbench-activity summary")).toContainText(
      "失败",
    );
    const messages = page.getByLabel("工作台消息记录");
    for (const size of [
      { width: 1440, height: 1000 },
      { width: 768, height: 1000 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(() =>
          messages.evaluate((node) =>
            Math.abs(
              node.getBoundingClientRect().right -
                document
                  .querySelector(".workbench-layout .chat")!
                  .getBoundingClientRect().right,
            ),
          ),
        )
        .toBeLessThanOrEqual(1);
      expect(
        await messages.evaluate(
          (node) => getComputedStyle(node).scrollbarWidth,
        ),
      ).toBe("thin");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator(".workbench-message-content")
          .evaluate((node) => node.getBoundingClientRect().width),
      ).toBeLessThanOrEqual(780);
      await page.screenshot({
        animations: "disabled",
        path: `.vibe/audit/workbench-activities-${size.width}.png`,
      });
    }
    let releaseCompression: () => void = () => {};
    const compression = new Promise<void>((resolve) => {
      releaseCompression = resolve;
    });
    await page.route("**/api/workbench/*/compress", async (route) => {
      await compression;
      await route.fulfill({ json: { ok: true } });
    });
    const compress = page.getByRole("button", {
      name: "压缩上下文",
      exact: true,
    });
    await compress.click();
    await expect(compress).toHaveAttribute("aria-busy", "true");
    await expect(compress.locator("svg")).toHaveCount(1);
    expect(
      await compress.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const icon = node.querySelector("svg")!.getBoundingClientRect();
        return Math.abs((box.left + box.right - icon.left - icon.right) / 2);
      }),
    ).toBeLessThan(1);
    releaseCompression();
    await expect(compress).not.toHaveAttribute("aria-busy", "true");
    await expect(compress.locator("svg")).toHaveCount(1);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "当前会话操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "归档", exact: true }).click();
    await page.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(store.get("workbench", session.id).archivedAt).toBeTruthy();
    await expect(page.locator(".session-list .session")).toHaveCount(0);
    await page.getByRole("button", { name: "查看归档", exact: true }).click();
    await page.locator(".session-list .session").click();
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "当前会话操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "取消归档", exact: true }).click();
    await page.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(store.get("workbench", session.id).archivedAt).toBeNull();
    await page
      .getByRole("button", { name: "返回最近会话", exact: true })
      .click();
    await page
      .getByRole("button", { name: "会话操作：活动与归档验证", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(store.get("workbench", session.id)).toBeTruthy();
    await page
      .getByRole("button", { name: "会话操作：活动与归档验证", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await page.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(store.list("workbench")).toHaveLength(0);
    await page.reload();
    await expect(page.locator(".session-list .session")).toHaveCount(0);
    for (const title of ["批量一", "批量二"])
      workbench.create({ title, modelId: model.id, permission: "ask" });
    await page.reload();
    await expect(page.locator(".session-entry")).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "工作台会话列表", exact: true })
      .click();
    await checkSessionDrawer(page, "工作台会话列表");
    // 手机抽屉中搜索与新建保持同排，图标保留可访问名称。
    const searchBox = await page
      .getByRole("textbox", { name: "搜索工作台会话" })
      .boundingBox();
    const createButton = page.getByRole("button", {
      name: "新建工作台对话",
      exact: true,
    });
    const createBox = await createButton.boundingBox();
    await expect(createButton.locator("svg")).toHaveCount(1);
    expect(createBox!.x).toBeGreaterThanOrEqual(
      searchBox!.x + searchBox!.width,
    );
    expect(
      Math.abs(
        createBox!.y +
          createBox!.height / 2 -
          searchBox!.y -
          searchBox!.height / 2,
      ),
    ).toBeLessThanOrEqual(1);

    const card = page.locator(".session-entry > .session").first();
    // 单行列表隐藏附加信息，状态保留可访问名称，移动端行高不超过触控目标。
    await expect(card.locator(".session-status svg")).toHaveCount(1);
    await expect(card.locator("small")).toHaveCount(0);
    await expect(card.locator("strong")).toHaveCSS("white-space", "nowrap");
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(44);
    const menuTrigger = page.locator(".session-entry .ui-menu button").first();
    await page.mouse.move(0, 0);
    await expect(menuTrigger).toHaveCSS("border-top-width", "0px");
    await expect(menuTrigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    await card.dispatchEvent("pointerdown", {
      button: 0,
      clientX: 30,
      clientY: 120,
      pointerType: "touch",
    });
    await card.dispatchEvent("pointermove", { clientX: 30, clientY: 180 });
    await page.waitForTimeout(650);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await card.dispatchEvent("pointerup");
    await card.dispatchEvent("pointerdown", {
      button: 0,
      clientX: 30,
      clientY: 120,
      pointerType: "touch",
    });
    await expect(
      page.getByRole("menuitem", { name: "多选", exact: true }),
    ).toBeVisible();
    await card.dispatchEvent("pointerup");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page
      .getByRole("checkbox", { name: "全选当前列表", exact: true })
      .check();
    await expect(
      page.getByText("已选 2 项，以下操作仅作用于所选会话"),
    ).toBeVisible();
    await page.screenshot({
      path: ".vibe/workbench-batch-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "全部归档", exact: true }).click();
    await page.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect
      .poll(() => store.list("workbench").every((w) => !!w.archivedAt))
      .toBe(true);
    await page.getByRole("button", { name: "查看归档", exact: true }).click();
    await expect(page.locator(".session-entry")).toHaveCount(2);
    await page
      .getByRole("button", { name: /^会话操作：/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "多选", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "全选当前列表", exact: true })
      .check();
    await page.getByRole("button", { name: "全部删除", exact: true }).click();
    await page.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect.poll(() => store.list("workbench").length).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 横屏收起释放正文空间，竖屏恢复原导航，旋转不残留遮罩或焦点约束。 */
test("横屏一级导航收起与竖屏恢复", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-portrait-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1:3180",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store } = await createApp(appOptions);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  try {
    await page.goto(base);
    await page
      .getByLabel("初始化令牌")
      .fill(readFileSync(join(dir, "setup-token"), "utf8"));
    await page.getByLabel("账号", { exact: true }).fill("portrait-test");
    await page
      .getByLabel("密码（至少 12 位）", { exact: true })
      .fill("portrait-test-password");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.locator(".rail")).toBeVisible();
    const toggle = page.locator(".rail-toggle");
    await expect(toggle.locator("img")).toHaveCount(1);
    await expect(toggle.locator("svg")).toHaveCount(0);
    // 采集实际动画帧，确认布局经历中间宽度而非瞬间跳变。
    const widths = await page.evaluate(async () => {
      const rail = document.querySelector<HTMLElement>(".rail")!;
      const avatar =
        document.querySelector<HTMLImageElement>(".rail-toggle img")!;
      const samples: number[] = [];
      avatar.click();
      await new Promise<void>((resolve) => {
        const start = performance.now();
        const sample = () => {
          samples.push(rail.getBoundingClientRect().width);
          if (performance.now() - start < 350) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      return samples;
    });
    expect(widths.some((width) => width > 65 && width < 199)).toBe(true);
    await toggle.locator("img").click();
    await expect(page.locator(".rail")).toHaveCSS("width", "204px");
    for (const width of [740, 844, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 390 });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".rail")).toHaveCSS("width", "204px");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".rail")).toHaveCSS("width", "60px");
      expect((await page.locator(".main").boundingBox())!.x).toBe(60);
      expect((await page.locator(".rail").boundingBox())!.x).toBe(0);
      await expect(page.locator(".rail .nav button span").first()).toHaveCSS(
        "opacity",
        "0",
      );
      await expect(page.locator(".drawer-shade")).toBeHidden();
      await expect(page.locator(".rail")).not.toHaveAttribute("role", "dialog");
      for (const theme of ["light", "dark", "bug"]) {
        await page.locator(".theme-cycle").click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      }
      // 按一级入口名称导航，覆盖轻应用且不依赖菜单排列位置。
      for (const [route, label] of [
        ["workbench", "工作台"],
        ["chat", "会话"],
        ["board", "看板"],
        ["light-apps", "轻应用"],
        ["environments", "环境"],
        ["agents", "智能体"],
        ["settings", "设置"],
      ]) {
        await page.locator(".rail .nav").getByRole("button", { name: label, exact: true }).click();
        await expect(page.locator(".content")).toHaveAttribute(
          "data-page",
          route,
        );
        // 窄屏空态会自动打开会话抽屉，先正常关闭再继续切换一级菜单。
        if (await page.locator(".session-list[role=dialog]").isVisible()) {
          await page.keyboard.press("Escape");
        }
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await expect(page.getByText("退出当前账号？")).toBeVisible();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      const toggleBox = (await toggle.boundingBox())!;
      expect(toggleBox.y).toBeGreaterThanOrEqual(0);
      expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(
        width === 1440 ? 900 : 390,
      );
      await page.screenshot({
        path: `.vibe/landscape-collapsed-${width}.png`,
        animations: "disabled",
      });
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".rail")).toHaveCSS("width", "204px");
      expect((await page.locator(".main").boundingBox())!.x).toBe(204);
      expect((await page.locator(".rail").boundingBox())!.x).toBe(0);
      await page.screenshot({ path: `.vibe/landscape-expanded-${width}.png` });
    }
    await toggle.click();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(toggle).toBeHidden();
      await expect(page.locator(".rail")).toBeHidden();
      expect((await page.locator(".main").boundingBox())!.x).toBe(0);
      const menu = page.locator(".mobile-menu");
      await menu.click();
      await expect(page.locator(".rail-home")).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(page.locator(".rail .profile-logout")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(page.locator(".rail")).toBeHidden();
      await menu.click();
      await page.locator(".rail .nav button").first().click();
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".rail")).toBeHidden();
      await page.screenshot({
        path: `.vibe/portrait-restored-${width}.png`,
        animations: "disabled",
      });
    }
    await page.locator(".mobile-menu").click();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".shell")).not.toHaveClass(/drawer/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".drawer-shade")).toBeHidden();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".shell")).toHaveCSS("transition-duration", "0s");
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(toggle).toBeHidden();
    await expect(page.locator(".rail .nav button span").first()).toBeVisible();
    await expect(page.locator(".theme-cycle")).toBeHidden();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 在隔离服务验证提示词编辑、持久化、冲突和移动端表单。 */
test("工作台系统提示词设置保存、恢复与冲突", async ({ page }) => {
  const { digest } = await import("../src/server/security.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-prompt-browser-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service, workbench } = await createApp(appOptions);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  store.put("users", { username: "fixture" }, "owner");
  // 中文断言与宿主机的系统语言无关。
  service.saveLanguage({ preference: "zh-CN" });
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest("prompt-browser-fixture"), "owner", Date.now() + 600000);
  await page
    .context()
    .addCookies([
      { name: "relay_session", value: "prompt-browser-fixture", url: base },
    ]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/#settings");
    await page
      .getByRole("button", { name: "工作台提示词", exact: true })
      .click();
    const input = page.getByLabel("系统提示词（行为规范）");
    const save = page.getByRole("button", { name: "保存提示词", exact: true });
    const restore = page.getByRole("button", { name: "恢复默认", exact: true });
    await expect(input).toHaveValue("");
    await expect(save).toBeDisabled();
    await expect(restore).toBeDisabled();
    await expect(
      page.getByText(
        "产品功能介绍和 tool schema 由系统维护，不可编辑。权限与工具审批仍由系统执行。",
      ),
    ).toBeVisible();
    await input.fill("请用简洁中文回答。\n先给出结论。");
    await page.getByRole("button", { name: "工作台模型", exact: true }).click();
    await page
      .getByRole("button", { name: "工作台提示词", exact: true })
      .click();
    await expect(input).toHaveValue("请用简洁中文回答。\n先给出结论。");
    await save.click();
    await expect(page.getByRole("status")).toContainText("已保存");
    await page.reload();
    await page
      .getByRole("button", { name: "工作台提示词", exact: true })
      .click();
    await expect(input).toHaveValue("请用简洁中文回答。\n先给出结论。");
    workbench.savePromptSettings({
      version: 1,
      systemPrompt: "另一窗口保存的规范",
    });
    await input.fill("当前窗口的草稿");
    await save.click();
    await expect(page.getByRole("alert")).toContainText("提示词已变更");
    await expect(input).toHaveValue("当前窗口的草稿");
    await page.getByRole("button", { name: "重新加载已保存内容" }).click();
    await expect(input).toHaveValue("另一窗口保存的规范");
    await restore.click();
    await expect(input).toHaveValue("");
    expect(workbench.promptSettings().systemPrompt).toBe("另一窗口保存的规范");
    await save.click();
    await expect(page.getByRole("status")).toContainText("已保存");
    expect(workbench.promptSettings().systemPrompt).toBe("");
    await expect(save).toBeDisabled();
    await expect(restore).toBeDisabled();
    // 保存非空规范后再手动清空，覆盖与恢复默认为空不同的操作入口。
    await input.fill("请用简洁中文回答。");
    await save.click();
    await expect(page.getByRole("status")).toContainText("已保存");
    await input.fill("");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole("status")).toContainText("已保存");
    expect(workbench.promptSettings().systemPrompt).toBe("");
    await page.reload();
    await page
      .getByRole("button", { name: "工作台提示词", exact: true })
      .click();
    await expect(input).toHaveValue("");
    await input.fill("   ");
    await save.click();
    await expect(input).toHaveValue("");
    await expect(save).toBeDisabled();
    await expect(restore).toBeDisabled();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(input).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.vibe/audit/workbench-prompt-${width}.png`,
        fullPage: true,
      });
    }
    await input.focus();
    await expect(input).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 大原图只在本地裁切，验证身份布局、个人持久化和智能体共用流程。 */
test("消息头像裁切、保存、取消与退出点击边界", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-avatar-ui-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1:3180",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store } = await createApp(appOptions);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base);
    await page
      .getByLabel("初始化令牌")
      .fill(readFileSync(join(dir, "setup-token"), "utf8"));
    await page.getByLabel("账号", { exact: true }).fill("头像测试用户");
    await page.getByLabel("密码（至少 12 位）").fill("avatar-test-password");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("button", { name: "修改头像", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "修改个人头像", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("退出当前账号？", { exact: true })).toHaveCount(
      0,
    );
    // 生成超过旧 2 MB 门槛的真实 PNG，验证大原图进入裁切流程。
    const source = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1800;
      canvas.height = 1000;
      const ctx = canvas.getContext("2d")!;
      const data = ctx.createImageData(1800, 1000);
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i] = Math.random() * 256;
        data.data[i + 1] = Math.random() * 256;
        data.data[i + 2] = Math.random() * 256;
        data.data[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      return canvas.toDataURL("image/png");
    });
    const buffer = Buffer.from(source.split(",")[1], "base64");
    expect(buffer.length).toBeGreaterThan(2000000);
    await page
      .locator('.avatar-upload input[type="file"]')
      .setInputFiles({ name: "large.png", mimeType: "image/png", buffer });
    const crop = page.getByRole("dialog", { name: "调整头像", exact: true });
    await expect(
      crop.getByRole("button", { name: "裁切并保存" }),
    ).toBeEnabled();
    await crop.getByLabel("头像缩放").fill("2");
    await crop.getByRole("button", { name: "裁切并保存" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const avatar = store.get("users", "owner").avatar;
    expect(avatar).toMatch(/^data:image\/webp;base64,/);
    expect(
      Buffer.from(avatar.split(",")[1], "base64").length,
    ).toBeLessThanOrEqual(100 * 1024);
    const dimensions = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, avatar);
    expect(dimensions[0]).toBe(dimensions[1]);
    expect(dimensions[0]).toBeLessThanOrEqual(512);
    await page.reload();
    await expect(page.locator(".profile-edit img")).toHaveAttribute(
      "src",
      avatar,
    );
    await page.getByRole("button", { name: "修改头像", exact: true }).click();
    await page
      .locator('.avatar-upload input[type="file"]')
      .setInputFiles({ name: "again.png", mimeType: "image/png", buffer });
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(
      crop.getByRole("button", { name: "取消", exact: true }),
    ).toBeInViewport();
    await expect(
      crop.getByRole("button", { name: "裁切并保存", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: ".vibe/audit/avatar-crop-mobile.png",
      animations: "disabled",
    });
    await crop.getByRole("button", { name: "取消", exact: true }).click();
    expect(store.get("users", "owner").avatar).toBe(avatar);
    await page
      .getByRole("dialog", { name: "修改个人头像", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    const session = store.put("workbench", {
      title: "头像对话",
      status: "idle",
      permission: "ask",
      history: [],
      transcript: [
        { role: "user", text: "用户消息" },
        { role: "assistant", text: "助手回答" },
      ],
    });
    await page.goto(base + "/#workbench/" + session.id);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const user = page.locator(".user-message").first();
      await expect(user.locator(".message-identity")).toContainText(
        "头像测试用户",
      );
      await expect(user.locator("img")).toHaveAttribute("src", avatar);
      await expect(
        page.locator(".message:not(.user-message) .identity-avatar img"),
      ).toHaveAttribute("src", "/assets/bugpaw-avatar.png");
      const identity = (await user.locator(".message-identity").boundingBox())!;
      const bubble = (await user.locator(".prose").boundingBox())!;
      expect(identity.y + identity.height).toBeLessThanOrEqual(bubble.y);
      const name = (await user
        .locator(".message-identity > span:last-child")
        .boundingBox())!;
      const photo = (await user.locator(".identity-avatar").boundingBox())!;
      expect(name.x + name.width).toBeLessThan(photo.x);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.vibe/audit/avatars-${width}.png`,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "智能体", exact: true }).click();
    await page.getByRole("button", { name: "新建智能体", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("裁切智能体");
    await page.getByLabel("职责指令").fill("验证头像");
    await page
      .locator('.avatar-upload input[type="file"]')
      .setInputFiles({ name: "agent.png", mimeType: "image/png", buffer });
    await expect(
      crop.getByRole("button", { name: "裁切并保存" }),
    ).toBeEnabled();
    await crop.getByRole("button", { name: "裁切并保存" }).click();
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect
      .poll(() => store.list("agents")[0]?.avatar)
      .toMatch(/^data:image\/webp;base64,/);
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(
      page.getByText("退出当前账号？", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 在隔离真实应用中验证本地导航偏好、首帧与存储异常降级。 */
test("主导航本地记忆与存储异常", async ({ page, context }) => {
  const { digest } = await import("../src/server/security.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-navigation-memory-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store } = await createApp(appOptions);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest("navigation-fixture"), "owner", Date.now() + 600000);
  await context.addCookies([
    { name: "relay_session", value: "navigation-fixture", url: base },
  ]);
  const errors: string[] = [];
  context.on("page", (opened) =>
    opened.on("pageerror", (e) => errors.push(e.message)),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  const key = "relay-rail-collapsed";
  const toggle = page.locator(".rail-toggle");
  const saved = () => page.evaluate((key) => localStorage.getItem(key), key);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await saved()).toBeNull();
    // 首次可见导航的每个渲染帧都应直接采用缓存宽度。
    await context.addInitScript(() => {
      const frames: number[] = [];
      (window as any).__railFrames = frames;
      const sample = () => {
        const rail = document.querySelector(".rail");
        if (rail && frames.length < 20)
          frames.push(rail.getBoundingClientRect().width);
        if (frames.length < 20) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    for (const collapsed of [true, false]) {
      await toggle.click();
      expect(await saved()).toBe(String(collapsed));
      await page.reload();
      await expect(toggle).toHaveAttribute("aria-expanded", String(!collapsed));
      await expect
        .poll(() => page.evaluate(() => (window as any).__railFrames.length))
        .toBe(20);
      const frames = await page.evaluate(
        () => (window as any).__railFrames as number[],
      );
      expect(
        frames.every((width) => Math.abs(width - (collapsed ? 60 : 204)) < 1),
      ).toBe(true);
      await test.info().attach(`first-frames-${collapsed}`, {
        body: JSON.stringify(frames),
        contentType: "application/json",
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await page.reload();
      await expect(toggle).toHaveAttribute("aria-expanded", String(!collapsed));
      await cdp.detach();
      const reopened = await context.newPage();
      await reopened.goto(base);
      await expect(reopened.locator(".rail-toggle")).toHaveAttribute(
        "aria-expanded",
        String(!collapsed),
      );
      await reopened.close();
    }
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-label", "展开导航");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-label", "收起导航");
    // 同一任务内快速点击也不能因 React 批处理而丢失切换。
    await toggle.evaluate((button: HTMLButtonElement) => {
      for (let i = 0; i < 9; i++) button.click();
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await saved()).toBe("true");
    for (const size of [
      { width: 844, height: 390 },
      { width: 640, height: 360 },
    ]) {
      await page.setViewportSize(size);
      await expect(page.locator(".rail")).toHaveCSS("width", "60px");
      await expect(toggle).toBeInViewport();
    }
    for (const size of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(size);
      await page.reload();
      await page.getByRole("button", { name: "打开导航", exact: true }).click();
      await expect(page.locator(".rail")).toBeVisible();
      await expect(page.locator(".rail .nav button span").first()).toHaveCSS(
        "opacity",
        "1",
      );
      await page.keyboard.press("Escape");
      await expect(page.locator(".rail")).toBeHidden();
      expect(await saved()).toBe("true");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".rail")).toHaveCSS("width", "60px");
    for (const name of ["会话", "看板", "工作台"]) {
      await page.getByRole("button", { name, exact: true }).click();
      expect(await saved()).toBe("true");
    }
    for (const theme of ["light", "dark", "bug"]) {
      await page.locator(".theme-cycle").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await saved()).toBe("true");
    }
    // 未操作的页面重渲染不能覆盖另一标签页刚保存的偏好。
    const other = await context.newPage();
    await other.goto(base);
    await other.locator(".rail-toggle").click();
    await page.getByRole("button", { name: "看板", exact: true }).click();
    expect(await saved()).toBe("false");
    await other.close();
    for (const value of ["", "garbage", "false", "TRUE"]) {
      await page.evaluate(
        ({ key, value }) => localStorage.setItem(key, value),
        { key, value },
      );
      await page.reload();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(await saved()).toBe(value);
    }
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await saved()).toBeNull();
    // 读方法、写方法和 localStorage 属性本身均可能被浏览器拒绝。
    for (const mode of ["read", "write", "access"]) {
      const isolated = await context.browser()!.newContext();
      await isolated.addCookies(await context.cookies());
      await isolated.addInitScript((mode) => {
        if (mode === "access")
          Object.defineProperty(window, "localStorage", {
            get() {
              throw new DOMException("blocked", "SecurityError");
            },
          });
        else
          Storage.prototype[mode === "read" ? "getItem" : "setItem"] = () => {
            throw new DOMException("blocked", "SecurityError");
          };
      }, mode);
      const blocked = await isolated.newPage();
      blocked.on("pageerror", (e) => errors.push(e.message));
      await blocked.goto(base);
      const button = blocked.locator(".rail-toggle");
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await blocked.reload();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await isolated.close();
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 真实智能体选择列表在手机保留卡片宽度，滚动只发生在列表内。 */
test("智能体手机卡片与工作台发送按钮尺寸", async ({ page, context }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-mobile-cards-"));
  const { app, store } = await createApp({
    dataDir: dir,
    publicUrl: "http://127.0.0.1:3180",
    webDir: resolve("dist/web"),
    secureCookie: false,
  });
  const cookie = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const environment = store.put("environments", {
    name: "App Server Home",
    approved: true,
    roots: [],
  });
  const names = [
    "产品经理",
    "后端开发",
    "前端开发",
    "运维",
    "LongAgentName".repeat(12),
  ];
  for (const name of names)
    store.put("agents", {
      name,
      environmentId: environment.id,
      instructions: "Fixture instructions",
      injection: "append",
      avatar: "",
    });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  await context.addCookies([
    { name: "relay_session", value: cookie, url: base },
  ]);
  try {
    for (const width of [320, 374, 390, 800, 1440]) {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      await page.goto(base + "/#agents");
      const cards = page.locator("#agent-results .agent-list-item");
      await expect(cards).toHaveCount(names.length);
      const geometry = await cards.evaluateAll((nodes) =>
        nodes.map((node) => ({
          width: node.getBoundingClientRect().width,
          textWidth: node.lastElementChild!.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        })),
      );
      for (const box of geometry) {
        expect(box.width).toBeGreaterThanOrEqual(200);
        expect(box.textWidth).toBeGreaterThanOrEqual(100);
        expect(box.height).toBeLessThan(130);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      // 点击最后一张卡片可滚入可视区，并在详情看到完整长名称。
      await cards.last().click();
      await expect(page.locator(".agent-editor input").first()).toHaveValue(
        names.at(-1)!,
      );
      await cards.first().click();
      await page.mouse.move(0, 0);
      await page.locator(".ui-page-header").scrollIntoViewIfNeeded();
      for (const theme of ["light", "dark", "bug"]) {
        await page
          .locator("html")
          .evaluate(
            (node, value) => node.setAttribute("data-theme", value),
            theme,
          );
        await page.waitForTimeout(150);
        await page.screenshot({
          path: `.vibe/audit/agents-${width}-${theme}.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
      await page.goto(base + "/#workbench");
      const send = page.getByRole("button", { name: "发送", exact: true });
      await expect(send).toBeVisible();
      const box = (await send.boundingBox())!;
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
      expect(box.width).toBeGreaterThanOrEqual(width < 760 ? 44 : 40);
    }
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 两个独立浏览器上下文通过真实接口验证预设引用、草稿与读取失败。 */
test("智能体预设头像的保存、取消、冲突与跨客户端显示", async ({ page, browser, context }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-preset-avatars-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(appOptions);
  const mobile = await browser.newContext({
    viewport: { width: 360, height: 640 }, hasTouch: true, serviceWorkers: "block",
  });
  try {
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    appOptions.publicUrl = base;
    const cookie = randomUUID();
    store.put("users", { username: "fixture" }, "owner");
    store.db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)").run(digest(cookie), "owner", Date.now() + 600000);
    for (const client of [context, mobile]) {
      await client.addCookies([{ name: "relay_session", value: cookie, url: base }]);
    }
    const env = store.put("environments", { name: "头像环境", approved: true, roots: [] });
    const title = "选择预设头像";
    const source = "/assets/agent-avatars/backend.png";
    await page.goto(base + "/#agents");
    for (const environment of [false, true]) {
      const name = environment ? "环境头像" : "系统头像";
      await page.getByRole("button", { name: "新建智能体", exact: true }).click();
      const form = page.locator("dialog[open] form");
      await form.getByLabel("名称", { exact: true }).fill(name);
      if (environment) {
        await form.getByRole("button", { name: "智能体范围" }).click();
        await page.getByRole("option", { name: env.name }).click();
      }
      const open = form.getByRole("button", { name: title });
      const dialog = page.getByRole("dialog", { name: title });
      await open.press("Enter");
      const options = dialog.locator("button[aria-pressed]");
      await expect(options).toHaveCount(21);
      await expect(options.first()).toHaveText("BUG");
      await expect(options.nth(1)).toHaveText("铁盆 DS");
      await expect(options.last()).toHaveText("技术负责人");
      await page.keyboard.press("Escape");
      await expect(open).toBeFocused();
      await open.press("Enter");
      await dialog.getByRole("button", { name: "后端开发" }).press("Enter");
      await expect(open).toBeFocused();
      await expect(form.locator(".agent-avatar img")).toHaveAttribute("src", source);
      await form.getByRole("button", { name: "保存配置" }).click();
      await expect(form).toHaveCount(0);
      const saved = store.list("agents").find((agent) => agent.name === name);
      expect(saved).toMatchObject({ avatar: source, environmentId: environment ? env.id : null });
    }
    await page.reload();
    await page.locator(".agent-list-item").filter({ hasText: "系统头像" }).click();
    const form = page.locator(".agent-editor form");
    const preview = form.locator(".agent-avatar img");
    const open = form.getByRole("button", { name: title });
    await open.click();
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog.getByRole("button", { name: /后端开发/ })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "BUG", exact: true }).click();
    const file = form.locator('input[type="file"]');
    await file.setInputFiles("public/assets/icon-192.png");
    await page.getByRole("dialog", { name: "调整头像" }).getByRole("button", { name: "取消" }).click();
    await expect(preview).toHaveAttribute("src", "/assets/icon-192.png");
    await file.setInputFiles("public/assets/icon-192.png");
    await page.getByRole("button", { name: "裁切并保存" }).click();
    await expect(preview).toHaveAttribute("src", /^data:image\/webp/);
    await form.getByLabel("头像简称").fill("代");
    await expect(form.locator(".agent-avatar")).toHaveText("代");

    // 另一个编辑者推进版本，旧表单的写入应失败并保留简称草稿。
    const system = store.list("agents").find((agent) => agent.name === "系统头像")!;
    service.save("agents", { ...system, instructions: "更新职责" }, system.id, system.version);
    await form.getByRole("button", { name: "保存配置" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(form.getByLabel("头像简称")).toHaveValue("代");
    expect(store.get("agents", system.id).avatar).toBe(source);
    await page.locator(".agent-list-item").filter({ hasText: "环境头像" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
    await page.locator(".agent-list-item").filter({ hasText: "系统头像" }).click();
    await expect(preview).toHaveAttribute("src", source);

    service.saveLanguage({ preference: "en" });
    const phone = await mobile.newPage();
    await phone.route("**/assets/agent-avatars/backend.png", (route) => route.abort());
    await phone.goto(base + "/#agents");
    const card = phone.locator(".agent-list-item").filter({ hasText: "系统头像" });
    await expect(card.locator(".agent-avatar")).toHaveText("系");
    await card.tap();
    const trigger = phone.getByRole("button", { name: "Choose a preset avatar" });
    await trigger.tap();
    const picker = phone.getByRole("dialog", { name: "Choose a preset avatar" });
    const unavailable = picker.getByRole("button", { name: /Backend Developer.*Unavailable/ });
    await expect(unavailable).toBeDisabled();
    for (const theme of ["light", "dark", "bug"]) {
      await phone.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await picker.getByRole("button", { name: "DeepSeek Basin Chibi" }).scrollIntoViewIfNeeded();
      await phone.screenshot({ path: `.vibe/audit/preset-${theme}.png` });
      expect(await picker.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    await picker.getByRole("button", { name: "Technical Lead" }).tap();
    await expect(trigger).toBeFocused();
    await expect(phone.locator(".agent-editor .agent-avatar img")).toHaveAttribute("src", "/assets/agent-avatars/tech-lead.png");
  } finally {
    await mobile.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
