import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.js";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

/** 真页面、HTTP 和临时 SQLite 验证；不连接生产或真实模型。 */
test("I18N 双语导航、草稿、持久化、离线和响应式", async ({ browser }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-i18n-web-"));
  const options = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, service } = await createApp(options);
  await app.listen({ host: "127.0.0.1", port: 0 });
  options.publicUrl = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const language = async (name: string) => {
    await page.locator(".language-control .select-trigger").click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const previousLocale = process.env.LC_ALL;
  try {
    process.env.LC_ALL = "fr_FR.UTF-8";
    await page.addInitScript(() => localStorage.setItem("relay-locale-preference", "zh-CN"));
    await page.goto(options.publicUrl);
    await expect(
      page.getByRole("heading", { name: "Initialize your workspace" }),
    ).toBeVisible();
    await page.getByLabel("Account", { exact: true }).fill("i18n-user");
    await language("简体中文");
    await expect(page.getByLabel("账号", { exact: true })).toHaveValue(
      "i18n-user",
    );
    await page
      .getByLabel("初始化令牌")
      .fill(readFileSync(join(dir, "setup-token"), "utf8"));
    await page
      .getByLabel("密码（至少 12 位）", { exact: true })
      .fill("i18n-test-password");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "What shall we move forward today?" }),
    ).toBeVisible();
    expect(service.languageSettings()).toEqual({ preference: "auto", serverLocale: "en", locale: "en" });
    await language("简体中文");
    await page
      .getByLabel("工作台消息", { exact: true })
      .fill("用户草稿保持原文");
    await language("English");
    await expect(
      page.getByLabel("Workbench message", { exact: true }),
    ).toHaveValue("用户草稿保持原文");
    const rail = await page.locator(".rail").boundingBox();
    expect(rail!.x).toBe(0);
    await page
      .getByRole("button", { name: "Collapse navigation", exact: true })
      .click();
    await language("简体中文");
    await expect(
      page.getByRole("button", { name: "展开导航", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "展开导航", exact: true }).click();
    await language("English");
    for (const route of [
      "chat",
      "board",
      "environments",
      "agents",
      "settings",
      "workbench",
    ]) {
      await page.evaluate((route) => {
        location.hash = route;
      }, route);
      await page.waitForTimeout(100);
      const text = await page.locator(".main").innerText();
      expect(text.replace("用户草稿保持原文", "")).not.toMatch(
        /[\p{Script=Han}]/u,
      );
    }
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const other = await context.newPage();
    await other.goto(options.publicUrl);
    await language("简体中文");
    await other.reload();
    await expect(other.getByRole("heading", { name: "今天，一起推进什么？" })).toBeVisible();
    await other.close();
    await page.route("**/api/settings/language", (route) => route.fulfill({
      status: 503,
      json: { messageKey: "web.theServiceIsTemporarilyUnavailablePleaseTryAgainLater" },
    }));
    await language("English");
    await expect(page.locator(".language-warning")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator(".language-label")).toHaveText("简体中文");
    expect(service.languageSettings().preference).toBe("zh-CN");
    expect(await page.evaluate(() => localStorage.getItem("relay-confirmed-locale"))).toBe("zh-CN");
    await page.unroute("**/api/settings/language");
    await context.setOffline(true);
    await language("English");
    await expect(page.locator(".language-warning")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    service.saveLanguage({ preference: "en" });
    await context.setOffline(false);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await language("简体中文");
    await language("跟随服务端（English）");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(service.languageSettings().preference).toBe("auto");
    expect(await page.evaluate(() => localStorage.getItem("relay-confirmed-locale"))).toBe("en");
    for (const [width, height] of [
      [320, 740],
      [390, 844],
      [844, 390],
      [768, 1024],
      [1440, 1000],
    ]) {
      await page.setViewportSize({ width, height });
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        if (width < 760 && height > width)
          await page
            .getByRole("button", { name: "Open navigation", exact: true })
            .click();
        // 真实坐标保护左侧导航，并确保语言弹层不会越过视口。
        await expect.poll(async () => (await page.locator(".rail").boundingBox())!.x).toBe(0);
        await page.locator(".language-control .select-trigger").click();
        const menuBox = (await page.getByRole("listbox").boundingBox())!;
        expect(menuBox.x).toBeGreaterThanOrEqual(0);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);

        await page
          .getByRole("option", { name: "English", exact: true })
          .press("Escape");
        await expect(
          page.locator(".language-control .select-trigger"),
        ).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `.vibe/i18n-web-${width}-${theme}.png`,
          animations: "disabled",
        });
        if (width < 760 && height > width) await page.keyboard.press("Escape");
      }
    }
    // 页面放大后统一菜单仍能打开、关闭并恢复键盘焦点。
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    await page.locator(".language-control .select-trigger").click();
    await expect(page.getByRole("option", { name: "English", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".language-control .select-trigger")).toBeFocused();
    await page.screenshot({ path: ".vibe/i18n-web-200-percent.png" });
    await page.evaluate(() => { document.documentElement.style.zoom = ""; });
    await page.evaluate(() => {
      Object.defineProperty(Storage.prototype, "setItem", {
        value() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await language("简体中文");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.reload();
    await expect(page.getByRole("heading", { name: "今天，一起推进什么？" })).toBeVisible();
    expect(service.languageSettings().preference).toBe("zh-CN");
    await page.evaluate(() => localStorage.removeItem("relay-confirmed-locale"));
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Cannot connect to your workspace" })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("heading", { name: "今天，一起推进什么？" })).toBeVisible();

    const fresh = await browser.newContext({ locale: "zh-TW" });
    try {
      const freshPage = await fresh.newPage();
      await freshPage.goto(options.publicUrl);
      await expect(freshPage.getByRole("heading", { name: "Welcome back" })).toBeVisible();
      await freshPage.getByLabel("Account", { exact: true }).fill("i18n-user");
      await freshPage.getByLabel("Password", { exact: true }).fill("i18n-test-password");
      await freshPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(freshPage.getByRole("heading", { name: "今天，一起推进什么？" })).toBeVisible();
      await freshPage.getByRole("button", { name: "退出登录", exact: true }).click();
      await freshPage.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
      await expect(freshPage.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
      await freshPage.reload();
      await expect(freshPage.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
      // 另一会话保存英文后，本机匿名页继续用中文，重新登录时同步。
      await language("English");
      await freshPage.getByLabel("账号", { exact: true }).fill("i18n-user");
      await freshPage.getByLabel("密码", { exact: true }).fill("i18n-test-password");
      await freshPage.getByRole("button", { name: "登录", exact: true }).click();
      await expect(freshPage.getByRole("heading", { name: "What shall we move forward today?" })).toBeVisible();
      expect(await freshPage.evaluate(() => localStorage.getItem("relay-confirmed-locale"))).toBe("en");
    } finally {
      await fresh.close();
    }
    expect(errors).toEqual([]);
  } finally {
    // Playwright 在独立 worker 中运行，避免默认语言影响其他用例。
    if (previousLocale === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = previousLocale;
    await context.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 独立控制台保留表单节点和诊断状态，不依赖服务器 UI。 */
test("I18N 连接器控制台语言与未保存草稿", async ({ browser }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-i18n-console-"));
  let child: ChildProcess | undefined;
  const context = await browser.newContext({
    locale: "en-GB",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    child = spawn(
      process.execPath,
      ["dist/connector/main.js", "web", "--no-open"],
      {
        env: { ...process.env, BUGPAW_HOME: dir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(Error("console start timeout")),
        15000,
      );
      child!.stdout!.on("data", (data) => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#\S+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      child!.on("exit", () => {
        clearTimeout(timer);
        reject(Error("console exited"));
      });
    });
    await page.goto(url);
    await expect(
      page.getByRole("heading", {
        name: "Manage this development environment",
      }),
    ).toBeVisible();
    await page.locator("#name").fill("中文环境草稿");
    await page.locator("#language-toggle").click();
    await page.getByRole("option", { name: "简体中文", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "管理这台开发环境" }),
    ).toBeVisible();
    await expect(page.locator("#name")).toHaveValue("中文环境草稿");
    await page.locator("#language-toggle").click();
    await expect(page.getByRole("option", { name: "跟随系统（English）", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "CLI 工具" }).click();
    await page.locator("#codexModel").fill("draft-model");
    await page.locator("#language-toggle").click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(page.locator("#codexModel")).toHaveValue("draft-model");
    await expect(page.getByRole("tab", { name: "CLI tools" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.vibe/i18n-console-${width}.png`,
        animations: "disabled",
      });
    }
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    if (child && child.exitCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      await exit;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 服务端默认语言独立于浏览器，登录前选择仅影响当前页面。 */
test("I18N 中文服务端默认值与登录前临时选择", async ({ browser }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-system-locale-"));
  const previousLocale = process.env.LC_ALL;
  process.env.LC_ALL = "zh_CN.UTF-8";
  const options = { dataDir: dir, publicUrl: "http://127.0.0.1", webDir: resolve("dist/web"), secureCookie: false };
  const { app, service } = await createApp(options);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as any).port}`;
  options.publicUrl = url;
  const context = await browser.newContext({ locale: "en-US" });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "初始化你的工作空间" })).toBeVisible();
    await page.locator(".language-control .select-trigger").click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Initialize your workspace" })).toBeVisible();
    expect(service.languageSettings().preference).toBe("auto");
    expect(await page.evaluate(() => localStorage.getItem("relay-confirmed-locale"))).toBeNull();
    await page.reload();
    await expect(page.getByRole("heading", { name: "初始化你的工作空间" })).toBeVisible();
    await page.evaluate(() => localStorage.setItem("relay-confirmed-locale", "invalid"));
    await page.reload();
    await expect(page.getByRole("heading", { name: "初始化你的工作空间" })).toBeVisible();
    await expect(page.locator(".language-label")).toHaveText("跟随服务端（简体中文）");
    await page.evaluate(() => window.dispatchEvent(new Event("languagechange")));
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.getByLabel("初始化令牌").fill(readFileSync(join(dir, "setup-token"), "utf8"));
    await page.getByLabel("账号", { exact: true }).fill("cache-test");
    await page.getByLabel("密码（至少 12 位）", { exact: true }).fill("i18n-test-password");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.locator(".rail .language-control .select-trigger").click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("relay-confirmed-locale"))).toBe("en");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Cannot connect to your workspace" })).toBeVisible();
  } finally {
    if (previousLocale === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = previousLocale;
    await context.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
