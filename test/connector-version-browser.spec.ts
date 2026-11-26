import { updateEn, updateZh } from "../src/web/connector-update-messages.js";
import { AppError } from "../src/shared/contracts.js";
import { test, expect, type BrowserContext } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { currentUpdateCompatibility } from "../src/shared/connector-update.js";
import { digest } from "../src/server/security.js";

test.use({ hasTouch: true });

/** 真实页面读取服务端判定，验证红字、平台下载、刷新消失及窄屏布局。 */
test("环境列表升级提醒覆盖未知、差异、一致与离线版本", async ({
  page,
  context,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-version-browser-"));
  const webDir = join(dir, "web");
  cpSync(resolve("dist/web"), webDir, { recursive: true });
  mkdirSync(join(webDir, "downloads"), { recursive: true });
  const version = "0.1.0-abcdef012345";
  const releases = ["windows", "linux"].map((platform) => ({
    platform,
    arch: "x64",
    file: `bugpaw-relay-${version}-${platform}-x64.${platform === "windows" ? "zip" : "tar.gz"}`,
  }));
  for (const release of releases)
    writeFileSync(join(webDir, "downloads", release.file), "fixture archive");
  writeFileSync(
    join(webDir, "downloads/release.json"),
    JSON.stringify({ version, releases }),
  );
  const appOptions = {
    dataDir: join(dir, "data"),
    publicUrl: "http://127.0.0.1",
    webDir,
    secureCookie: false,
  };
  const { app, store, service } = await createApp(appOptions);
  const cookie = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const make = (
    name: string,
    connectorVersion: string | null,
    platform = "win32/x64",
    online = true,
  ) => {
    const environment = store.put("environments", {
      name,
      connectorVersion,
      platform,
      approved: true,
    });
    if (online) service.peers.set(environment.id, { close: () => {} } as any);
    return environment;
  };
  const unknown = make("旧连接器", null);
  make("版本不同", "0.1.0-ffffffffffff", "linux/x64");
  make("已是最新版", version);
  const longVersion = `0.2.0-${"b".repeat(120)}`;
  make("离线环境", longVersion, "linux/x64", false);
  make("其他架构", "0.2.0", "linux/arm64");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  await context.addCookies([
    { name: "relay_session", value: cookie, url: base },
  ]);
  try {
    await page.goto(base + "/#environments");
    // 从用户实际报告的接入向导点击两平台下载，不只检查升级卡片。
    await page.getByRole("button", { name: "接入环境" }).click();
    for (const [index, name] of [
      "下载 Windows 发布包（ZIP）",
      "下载 Linux 发布包（tar.gz）",
    ].entries()) {
      const link = page.getByRole("button", { name, exact: true });
      const downloading = page.waitForEvent("download");
      await link.click();
      expect((await downloading).suggestedFilename()).toBe(
        releases[index].file,
      );
    }
    await page.keyboard.press("Escape");
    const card = (name: string) => page.getByRole("row").filter({has:page.getByRole("button",{name,exact:true})});
    const versionPanel = (name:string) => card(name).locator("xpath=following-sibling::tr[1]");
    // 列表仅以更新按钮底色提示版本差异，详情仍保留完整说明。
    const versionCell = (name: string) => card(name).getByRole("cell").nth(3);
    const updateButton = (name: string) => versionCell(name).getByRole("button");
    await expect(versionCell("版本不同")).not.toContainText("版本不同");
    await expect(versionCell("已是最新版")).not.toContainText("最新");
    await expect(updateButton("版本不同")).toHaveAccessibleDescription("版本不同");
    const currentBackground = await updateButton("已是最新版").evaluate(el => getComputedStyle(el).backgroundColor);
    await expect(updateButton("版本不同")).not.toHaveCSS("background-color", currentBackground);
    for (const button of await page.getByRole("button",{name:"版本与更新"}).all()) await button.click();
    await expect(
      versionPanel("旧连接器").getByText("连接器版本未知，建议升级", { exact: true }),
    ).toBeVisible();
    await expect(
      versionPanel("版本不同").getByText("连接器非最新版本，建议升级", { exact: true }),
    ).toBeVisible();
    await expect(
      versionPanel("版本不同").getByText("0.1.0-ffffffffffff", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(updateZh.viewHistory, { exact: true })).toHaveCount(0);
    await expect(
      versionPanel("其他架构").getByText("目标: 未知", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      versionPanel("已是最新版").locator(".connector-version-warning"),
    ).toHaveCount(0);
    await expect(
      versionPanel("离线环境").locator(".connector-version-warning"),
    ).toHaveCount(0);
    await expect(
      versionPanel("其他架构").getByText("当前平台暂无对应下载包"),
    ).toBeVisible();
    await expect(
      versionPanel("其他架构").getByRole("button", { name: "下载新版连接器" }),
    ).toHaveCount(0);
    await expect(
      versionPanel("版本不同").getByRole("button", { name: "下载新版连接器" }),
    ).toBeVisible();
    const downloading = page.waitForEvent("download");
    await versionPanel("旧连接器")
      .getByRole("button", { name: "下载新版连接器" })
      .click();
    expect((await downloading).suggestedFilename()).toBe(releases[0].file);
    for (const [theme, color] of [
      ["light", "rgb(152, 67, 68)"],
      ["dark", "rgb(238, 170, 165)"],
      ["bug", "rgb(154, 66, 72)"],
    ]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await expect(
        versionPanel("旧连接器").locator(".connector-version-warning > p"),
      ).toHaveCSS("color", color);
    }
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "light"),
    );
    await page.locator(".content").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: ".vibe/connector-version-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => (document.documentElement.lang = "en"));
    const longValue = versionPanel("离线环境").getByText(longVersion, { exact: true });
    await expect(longValue).toBeVisible();
    await expect(versionPanel("离线环境").getByText("Connector version", { exact: true })).toBeVisible();
    expect(await versionPanel("离线环境").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => (document.documentElement.lang = "zh-CN"));
    // 竖屏保留收起的图标导航，环境详情仍须可访问。
    await expect(page.locator(".rail")).toBeHidden();
    await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
    await card("旧连接器").getByRole("button", { name: "旧连接器" }).click();
    await expect(
      page.getByRole("heading", { name: "旧连接器", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("连接器版本未知，建议升级", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: ".vibe/connector-version-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // 模拟新版重新认证后的持久化结果，页面应自动刷新，无需手动重载。
    store.put("environments", { connectorVersion: version }, unknown.id);
    await expect(page.locator(".connector-version-warning")).toHaveCount(0, {
      timeout: 10000,
    });
    await expect(page.getByText(version, { exact: true })).toBeVisible();
    // 清单缺失或读取失败时不保留猜测出来的下载地址。
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + "/#environments");
    rmSync(join(webDir, "downloads/release.json"));
    await page.getByRole("button", { name: "接入环境" }).click();
    await expect(
      page.getByText("当前平台暂无可用发布包，请稍后重试"),
    ).toHaveCount(2);
    await expect(
      page.getByRole("link", {
        name: "下载 Windows 发布包（ZIP）",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.route("**/api/connector-release", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "发行信息暂不可用" }),
      }),
    );
    await page.getByRole("button", { name: "接入环境" }).click();
    // 旧接口原始异常不直接回显，保留本地化兜底和安全 HTTP 上下文。
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "操作失败，请检查配置或重试 (HTTP 503, /api/connector-release)",
    );
    await expect(
      page.getByRole("link", {
        name: "下载 Linux 发布包（tar.gz）",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 在独立目录启动真实服务端并准备可升级的连接器记录。 */
async function updateFixture(context: BrowserContext) {
  const { createHash } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "relay-update-browser-"));
  const webDir = join(dir, "web");
  cpSync(resolve("dist/web"), webDir, { recursive: true });
  mkdirSync(join(webDir, "downloads"), { recursive: true });
  const target = {
    version: "0.1.0-aaaaaaaaaaaa",
    buildId: "a".repeat(40),
    platform: "linux",
    arch: "x64",
    file: "bugpaw-relay-0.1.0-aaaaaaaaaaaa-linux-x64.tar.gz",
    size: 7,
    sha256: createHash("sha256").update("package").digest("hex"),
    updateProtocol: 3,
    dataFormat: 2,
    compatibility: currentUpdateCompatibility,
  };
  const release = () =>
    writeFileSync(
      join(webDir, "downloads/release.json"),
      JSON.stringify({
        version: target.version,
        revision: target.buildId,
        updateProtocol: target.updateProtocol,
        dataFormat: target.dataFormat,
        compatibility: target.compatibility,
        claudeOnDemand: true,
        releases: [target],
      }),
    );
  writeFileSync(join(webDir, "downloads", target.file), "package");
  release();
  const options = {
    dataDir: join(dir, "data"),
    publicUrl: "http://127.0.0.1",
    webDir,
    secureCookie: false,
  };
  const { app, store, service } = await createApp(options);
  const cookie = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const env = store.put("environments", {
    name: "更新验收环境",
    approved: true,
    connectorVersion: "0.1.0-bbbbbbbbbbbb",
    platform: "linux/x64",
    connectorBuildId: "b".repeat(40),
    capabilities: ["connector-update-v3"],
    updateInstallation: {
      managed: true,
      current: {
        updateProtocol: 3,
        dataFormat: 2,
        compatibility: currentUpdateCompatibility,
      },
    },
  });
  service.peers.set(env.id, {
    close() {},
    async call() {
      throw new Error("controlled disconnected peer");
    },
  } as any);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  options.publicUrl = base;
  await context.addCookies([
    { name: "relay_session", value: cookie, url: base },
  ]);
  return { app, base, dir, store, service, target, release, env };
}

/** 真实 HTTP/SQLite 页面链路；节点与状态推进为受控替身，不替代实机升级验收。 */
test("下发更新确认、防重恢复、目标变化、离线及双语三主题", async ({
  page,
  context,
}) => {
  const { app, base, dir, store, target, release, env } = await updateFixture(context);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/connector-updates"))
      posts++;
  });
  try {
    await page.goto(base + "/#environments");
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    const send = page.getByRole("button", { name: "下发最新版", exact: true });
    const comparisons = page.locator(".connector-version-comparison > div");
    await expect(comparisons).toHaveText([
      /连接器版本.*当前: 0.1.0-bbbbbbbbbbbb.*目标: 0.1.0-aaaaaaaaaaaa/s,
      /数据格式.*当前: 2.*目标: 2/s,
      /更新协议.*当前: 3.*目标: 3/s,
    ]);
    for (const row of await comparisons.all()) {
      expect(
        await row.locator("dt, dd").evaluateAll((cells) => {
          const tops = cells.map((cell) => cell.getBoundingClientRect().top);
          return Math.max(...tops) - Math.min(...tops);
        }),
      ).toBeLessThan(2);
    }
    // 包存在但声明不可用时保留发行身份；拒绝原因由真实服务端计算。
    for (const [patch, reason] of [
      [
        {
          dataFormat: 3,
          compatibility: {
            ...currentUpdateCompatibility,
            ledger: { format: 3, contract: "future" },
          },
        },
        "当前与目标数据格式不同",
      ],
      [
        {
          compatibility: {
            ...currentUpdateCompatibility,
            preservesData: false,
          },
        },
        "当前与目标数据格式不同",
      ],
      [{ updateProtocol: 2 }, "目标更新协议不受支持"],
      [{ updateProtocol: 99 }, "目标更新协议不受支持"],
      [{ compatibility: null }, "兼容声明缺失"],
      [{ dataFormat: 3 }, "发行数据格式与兼容声明冲突"],
      [
        { dataFormat: { private: "must-not-render" } },
        "发行数据格式与兼容声明冲突",
      ],
    ] as const) {
      const original = { ...target };
      Object.assign(target, patch);
      release();
      await page.reload();
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
      await expect(page.getByText(reason, { exact: false })).toBeVisible();
      await expect(
        page.getByText("有目标发行包，但不能远程更新", { exact: true }),
      ).toBeVisible();
      await expect(send).toBeDisabled();
      await expect(
        page.getByText("must-not-render", { exact: false }),
      ).toHaveCount(0);
      const reasonKey = Object.keys(updateZh).find((key) =>
        updateZh[key as keyof typeof updateZh].includes(reason),
      ) as keyof typeof updateZh;
      await page.evaluate(() => (document.documentElement.lang = "en"));
      await expect(
        page.getByText(updateEn[reasonKey], { exact: true }),
      ).toBeVisible();
      await expect(send).toHaveCount(0);
      await page.evaluate(() => (document.documentElement.lang = "zh-CN"));
      Object.assign(target, original);
    }
    release();
    const installation = store.get("environments", env.id).updateInstallation;
    store.put(
      "environments",
      {
        updateInstallation: { managed: false },
        capabilities: ["connector-update-v1"],
      },
      env.id,
    );
    await page.reload();
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    await expect(
      comparisons.filter({ hasText: "数据格式" }).getByText("当前: 未知", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("请手动更新一次完整连接器以启用远程更新", {
        exact: false,
      }),
    ).toBeVisible();
    store.put(
      "environments",
      {
        updateInstallation: installation,
        capabilities: ["connector-update-v3"],
      },
      env.id,
    );
    await page.reload();
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    await send.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(updateZh.claudeOnDemand)).toBeVisible();
    await expect(
      dialog.getByText(target.version, { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "取消", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(send).toBeFocused();
    expect(posts).toBe(0);
    await send.click();
    store.put(
      "environments",
      { connectorVersion: "0.1.0-cccccccccccc" },
      env.id,
    );
    await expect(
      dialog.getByText("发行目标或当前版本已变化，请关闭后重新确认。"),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      dialog.getByRole("button", { name: "确认下发" }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // 让服务端真的受理后丢失响应；查询暂不可达时页面必须保留原编号。
    await page.route("**/connector-updates", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      await route.abort("failed");
    });
    await page.route("**/connector-updates/*", (route) =>
      route.abort("failed"),
    );
    await send.click();
    await dialog.getByRole("button", { name: "确认下发" }).click();
    await expect(
      page.getByText("请求结果尚未确认，正在查询原操作。请勿重复创建更新。"),
    ).toBeVisible();
    await expect(page.getByText(updateZh.queryError, { exact: true })).toBeVisible();
    const operation = store.list("connectorUpdates")[0];
    expect(operation).toBeTruthy();
    expect(posts).toBe(1);
    await page.reload();
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    await expect(
      page.getByRole("button", { name: "重发原请求" }),
    ).toBeVisible();
    expect(posts).toBe(1);
    await page.getByRole("button", { name: "重发原请求" }).click();
    await expect.poll(() => posts).toBe(2);
    expect(store.list("connectorUpdates")).toHaveLength(1);
    await page.unroute("**/connector-updates/*");
    await page.getByRole("button", { name: "查询原操作" }).click();
    await expect(page.getByRole("button", { name: "重发原请求" })).toHaveCount(
      0,
    );
    store.put(
      "connectorUpdates",
      {
        state: "downloading",
        lastConfirmedState: "downloading",
        downloadedBytes: 3,
      },
      operation.id,
    );
    await expect(page.getByRole("progressbar")).toHaveAttribute("value", "3");
    await expect(send).toBeDisabled();
    store.put(
      "connectorUpdates",
      {
        state: "recovery_required",
        lastConfirmedState: "restarting",
        errorCode: "RECOVERY_REQUIRED",
      },
      operation.id,
    );
    await expect(
      page.getByText("待恢复，请检查本机状态", { exact: true }),
    ).toBeVisible();
    await expect(send).toBeDisabled();
    // 开发期回滚事实仅用于历史展示，不调用旧监督流程。
    store.put(
      "connectorUpdates",
      {
        state: "rollback_reconciling",
        lastConfirmedState: "rollback_reconciling",
        actualVersion: "0.1.0-cccccccccccc",
      },
      operation.id,
    );
    await page.reload();
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    await expect(
      page.getByText("旧版本已恢复健康，等待认证重连对账", { exact: true }),
    ).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(page.getByText(operation.id, { exact: false })).toBeVisible();
    store.put(
      "connectorUpdates",
      {
        state: "rolled_back",
        lastConfirmedState: "rolled_back",
        errorCode: null,
        retryable: true,
        completedAt: new Date().toISOString(),
      },
      operation.id,
    );
    await expect(
      page.getByRole("button", { name: "重新确认并重试" }),
    ).toBeEnabled();
    await context.setOffline(true);
    await expect(
      page.getByRole("button", { name: "重新确认并重试" }),
    ).toBeDisabled();
    await context.setOffline(false);
    await page.getByRole("button", { name: "重新确认并重试" }).click();
    await context.setOffline(true);
    await expect(
      dialog.getByRole("button", { name: "确认下发" }),
    ).toBeDisabled();
    await context.setOffline(false);
    await expect(
      dialog.getByRole("button", { name: "确认下发" }),
    ).toBeEnabled();
    for (const language of ["zh-CN", "en"]) {
      await page.evaluate(
        (language) => (document.documentElement.lang = language),
        language,
      );
      await expect(
        dialog.getByRole("button", {
          name: language === "en" ? "Confirm update" : "确认下发",
          exact: true,
        }),
      ).toBeVisible();
      await expect(dialog.getByText(language === "en" ? updateEn.claudeOnDemand : updateZh.claudeOnDemand)).toBeVisible();
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        for (const width of [320, 390, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          expect(
            await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
          ).toBe(true);
          await page.screenshot({
            path: `.vibe/connector-update-${language}-${theme}-${width}.png`,
          });
        }
      }
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    await expect(page.getByText("已回滚", { exact: true })).toBeVisible();
    expect(posts).toBe(2);
    store.put(
      "connectorUpdates",
      {
        state: "succeeded",
        lastConfirmedState: "succeeded",
        actualVersion: target.version,
        retryable: false,
      },
      operation.id,
    );
    store.put("environments", { connectorVersion: target.version }, env.id);
    const history = page.locator("summary").filter({ hasText: updateZh.viewHistory });
    const record = page.getByRole("region", { name: updateZh.operation });
    await expect(history).toBeVisible();
    await expect(record).toBeHidden();
    await history.focus();
    await page.keyboard.press("Enter");
    await expect(record).toBeVisible();
    for (const detail of [
      updateZh.succeeded,
      `${updateZh.target}: ${target.version}`,
      `${updateZh.operation}: ${operation.id}`,
      `${updateZh.last}: ${updateZh.succeeded}`,
      `${updateZh.actual}: ${target.version}`,
    ]) {
      await expect(record.getByText(detail, { exact: true })).toBeVisible();
    }
    await expect(record.getByText(new RegExp(`^${updateZh.updated}:`))).toBeVisible();
    await page.keyboard.press("Space");
    await expect(record).toBeHidden();
    await expect(history).toBeFocused();
    await page.reload();
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    await expect(history).toBeVisible();
    await expect(record).toBeHidden();
    await page.setViewportSize({ width: 320, height: 844 });
    await history.tap();
    await expect(record).toBeVisible();
    await history.tap();
    await expect(record).toBeHidden();
    await page.screenshot({ path: ".vibe/connector-update-history-mobile.png" });
    await expect(
      page.getByRole("button", { name: "下发最新版", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await context.setOffline(false);
    await page.goto("about:blank");
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 真实页面、HTTP 和数据库；节点拒绝、断线和终态由受控 RPC 返回。 */
test("更新受阻时查看会话、定向终止并手动重试", async ({ page, context }) => {
  const { app, base, dir, store, service, env } = await updateFixture(context);
  const live = new Map<string, string>();
  let transfer = true;
  let disconnect = false;
  const stopped: string[] = [];
  store.put("environments", { capabilities: ["connector-update-v3", "connector-update-blockers-v1"] }, env.id);
  function seed(name: string, server: string, existing?: string) {
    const project = store.put("projects", { name, directories: [] });
    const sessionId = existing || store.put("sessions", { title: "同名会话", environmentId: env.id, projectId: project.id }).id;
    const executionId = randomUUID();
    store.db.prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(executionId, null, sessionId, env.id, server, "{}", new Date().toISOString());
    live.set(executionId, sessionId);
    return { executionId, sessionId };
  }
  const first = seed("第一项目", "completed");
  const second = seed("第二项目", "waiting");
  service.peers.set(env.id, {
    close() {},
    async call(method: string, params: any) {
      if (method === "connector.update.blockers") return {
        reasons: transfer ? ["transfer"] : [],
        executions: [...live].map(([executionId, sessionId]) => ({
          executionId, sessionId, status: "waiting", waitingFor: "answer", canStop: true,
        })),
      };
      if (method === "connector.update.stopBlocker") {
        if (disconnect) throw new AppError("OFFLINE", "offline", 409);
        if (!live.has(params.executionId)) return { outcome: "alreadyEnded", status: "completed" };
        stopped.push(params.executionId);
        live.delete(params.executionId);
        return { outcome: "requested" };
      }
      if (method === "execution.status") return { status: "cancelled" };
      if (method === "connector.update.prepare") throw new AppError("ENVIRONMENT_BUSY", "busy", 409);
      return {};
    },
  } as any);
  try {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(base + "/#environments");
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    const send = page.getByRole("button", { name: "下发最新版", exact: true });
    const dialog = page.getByRole("dialog").first();
    const button = (name: string) => dialog.getByRole("button", { name, exact: true });
    const row = (id: string) => dialog.locator("section").filter({ hasText: id });
    await send.click();
    await expect(dialog.getByText("第一项目")).toBeVisible();
    await expect(dialog.getByText("第二项目")).toBeVisible();
    await expect(dialog.getByText(/连接器仍在等待/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(send).toBeFocused();
    await send.click();
    for (const entry of [first, second]) {
      await row(entry.executionId).getByText("打开会话").click();
      await expect(page).toHaveURL(base + "/#chat/" + entry.sessionId);
      await page.goBack();
      await expect(row(entry.executionId)).toBeVisible();
    }
    async function confirmRow(id: string, confirm = true) {
      await row(id).getByText("强制终止").click();
      const confirmation = page.getByRole("dialog", { name: "确认终止本次执行" });
      await expect(confirmation.getByText(id, { exact: false })).toBeVisible();
      await confirmation.getByRole("button", { name: confirm ? "确认终止本次执行" : "取消", exact: true }).click();
    }
    await confirmRow(first.executionId, false);
    expect(stopped).toEqual([]);
    await confirmRow(first.executionId);
    await expect(row(first.executionId)).toHaveCount(0);
    await expect(row(second.executionId)).toBeVisible();
    expect(stopped).toEqual([first.executionId]);
    live.delete(second.executionId);
    store.db.prepare("UPDATE executions SET state='completed' WHERE id=?").run(second.executionId);
    const next = seed("下一轮", "completed", second.sessionId);
    await confirmRow(second.executionId);
    await expect(dialog.getByText(/该执行已结束.*已完成/)).toBeVisible();
    await expect(row(next.executionId)).toBeVisible();
    disconnect = true;
    await confirmRow(next.executionId);
    await expect(dialog.getByRole("alert")).toContainText("终止结果待核实");
    disconnect = false;
    await button("刷新").click();
    await confirmRow(next.executionId);
    await expect(button("打开会话")).toHaveCount(0);
    await expect(dialog.getByText("文件传输中")).toBeVisible();
    await button("重试更新").click();
    await expect(dialog.getByText("文件传输中")).toBeVisible();
    transfer = false;
    await button("重试更新").click();
    await expect(button("确认下发")).toBeEnabled();
    expect(store.list("connectorUpdates")).toHaveLength(0);
    // 确认到达服务端时出现新的执行，409 应直接打开详情。
    await page.route("**/connector-updates", async route => {
      seed("确认时的占用", "waiting");
      await route.continue();
    }, { times: 1 });
    await button("确认下发").click();
    await expect(dialog.getByText("确认时的占用")).toBeVisible();
    expect(store.list("connectorUpdates")).toHaveLength(0);
    live.clear();
    store.db.prepare("UPDATE executions SET state='completed' WHERE environment_id=?").run(env.id);
    await button("重试更新").click();
    await expect(button("确认下发")).toBeEnabled();
    // 服务端准入后，节点在切换前拒绝，本次下发应自动转入当前占用详情。
    seed("迟到的占用", "completed");
    await button("确认下发").click();
    await expect(dialog.getByText("迟到的占用")).toBeVisible({ timeout: 10000 });
    await page.reload();
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    await page.getByRole("button", { name: "更新占用详情" }).click();
    await expect(dialog.getByText("迟到的占用")).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    service.saveLanguage({ preference: "en" });
    await page.reload();
    await page.getByRole("button",{name:/版本与更新|Version and update/,expanded:false}).click();
    await page.getByRole("button", { name: "Update blockers" }).click();
    await expect(dialog.getByRole("heading", { name: "Sessions are blocking this update" })).toBeVisible();
    await expect(button("Force stop")).toBeVisible();
    await expect(dialog.getByText("Waiting for an answer")).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
