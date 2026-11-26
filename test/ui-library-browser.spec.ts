import { test, expect } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.js";

/** 在隔离数据目录运行真实 React 和接口；截图只包含合成数据。 */
test("正式组件、环境页与内容契约", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-ui-"));
  const options = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1:3180",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(options);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  options.publicUrl = base;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "ExampleEnvironmentABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(
    3,
  );
  const environment = store.put("environments", {
    name,
    approved: true,
    roots: [
      {
        id: "workspace",
        path: "/workspace/example/" + "LongDirectory".repeat(12),
      },
    ],
    tools: { codex: { available: true, version: "Codex" } },
    platform: "linux/x64",
  });
  try {
    await page.goto(base);
    await page
      .getByLabel("初始化令牌")
      .fill(readFileSync(join(dir, "setup-token"), "utf8"));
    await page.getByLabel("账号", { exact: true }).fill("ui-test");
    await page
      .getByLabel("密码（至少 12 位）", { exact: true })
      .fill("ui-test-password");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.locator(".shell")).toBeVisible();
    await page.goto(base + "/#environments");
    await expect(page.locator(".ui-monitor-list tbody tr")).toHaveCount(1);
    await page.getByRole("textbox", { name: "搜索环境" }).fill("missing");
    await expect(page.getByRole("button", { name: "清除筛选" })).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".ui-page-header h1")).toHaveText(name);
    // 通过真实历史接口展示离线旧节点的历史，空窗和零读数分别验证。
    await expect(page.getByText("此时段没有有效流量样本。")).toBeVisible();
    const end = Date.now() - 2000;
    const insert = store.db.prepare("INSERT INTO environment_traffic VALUES (?,?,?,?,?,?)");
    for (const minutes of [4, 3, 1]) {
      const start = end - minutes * 60000;
      insert.run(environment.id, start, start + 60000, 600000, 120000, 60000);
    }
    for (const period of ["1 小时", "5 分钟", "24 小时"]) {
      await page.getByRole("button",{name:period,exact:true}).click();
      await expect(page.getByText("1.8 MB",{exact:true})).toBeVisible();
      await expect(page.getByText("360 kB",{exact:true})).toBeVisible();
      const chart = page.getByRole("img",{name:"接收峰值 10 kB/s，发送峰值 2 kB/s"});
      await expect(chart).toBeVisible();
      expect((await chart.locator("path").first().getAttribute("d"))?.match(/M/g)).toHaveLength(2);
    }
    await page.getByRole("button", { name: "工作目录", exact: true }).click();
    await page.locator(".ui-disclosure summary").click();
    await expect(page.locator(".ui-disclosure code")).toContainText(
      "LongDirectory",
    );
    const second = store.put("environments", {name:"Second",approved:true,tools:{
      codex:{available:false,messageKey:"web.workspaceRootsAndToolStatusSyncWhenTheConnector"}
    }});
    insert.run(second.id, end-60000, end, 0, 0, 60000);
    await page.goto(base + "/#environments/" + second.id);
    await page.reload();
    await expect(page.getByText("0 B",{exact:true})).toHaveCount(2);
    await page.route("**/traffic?window=5m", route => route.fulfill({status:503,json:{}}),{times:1});
    await page.getByRole("button",{name:"5 分钟",exact:true}).click();
    await expect(page.getByRole("alert")).toContainText("503");
    await page.getByRole("button",{name:"重试",exact:true}).click();
    await expect(page.getByText("0 B",{exact:true})).toHaveCount(2);
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button",{name:"codex · 不可用",exact:true}).click();
    await expect(page.getByRole("note")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await page.locator(".content").evaluate(el=>el.scrollWidth-el.clientWidth)).toBe(0);
    expect(await page.locator(".ui-traffic-plot").evaluate(el=>el.scrollWidth-el.clientWidth)).toBe(0);
    await page.setViewportSize({width:1440,height:1000});
    store.remove("environments",second.id);
    await page.goto(base + "/#ui");
    await page
      .getByRole("button", { name: "保存配置", exact: true })
      .last()
      .click();
    await expect(page.locator(".ui-field-error")).toBeVisible();
    await page
      .getByRole("textbox", { name: "名称", exact: true })
      .fill("Example");
    await page
      .getByRole("button", { name: "保存配置", exact: true })
      .last()
      .click();
    await expect(
      page.getByText("示例操作已完成", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "模型", exact: true }),
    ).toHaveCSS("border-top-width", "0px");
    await expect(page.locator(".language-control .select-trigger")).toHaveCSS(
      "border-top-width",
      "0px",
    );
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await page.getByRole("textbox", { name: "搜索选项" }).fill("reasoning");
    await page.setViewportSize({ width: 390, height: 420 });
    await expect(page.getByRole("textbox", { name: "搜索选项" })).toBeFocused();
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.getByRole("option").click();
    await expect(
      page.getByRole("button", { name: "模型", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await expect(page.getByRole("menuitem")).toHaveCount(2);
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem").last()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    for (const locale of ["zh-CN", "en"]) {
      for (const theme of ["light", "dark", "bug"]) {
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          service.saveLanguage({ preference: locale });
          await page.evaluate((theme) => localStorage.setItem("relay-theme", theme), theme);
          await page.reload();
          await page.goto(base + "/#environments");
          await page.reload();
          await expect(page.locator(".ui-monitor-list tbody tr")).toHaveCount(1);
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
          ).toBe(false);
          // 应用正文独立滚动，根节点宽度无法检出筛选提示造成的横向溢出。
          const content = page.locator(".content");
          const horizontalOverflow = () =>
            content.evaluate((element) => element.scrollWidth - element.clientWidth);
          expect(await horizontalOverflow()).toBe(0);
          const filter = page.getByRole("button", {
            name: locale === "en" ? /^Connection status:/ : /^连接状态:/,
          });
          await filter.focus();
          expect(await horizontalOverflow()).toBe(0);
          await filter.blur();
          await expect(page.locator(".ui-page")).toHaveScreenshot(
            `environments-${locale}-${theme}-${width}.png`,
          );
          await page.goto(base + "/#ui");
          const chart = page.getByRole("img",{name:/10 kB\/s.*2 kB\/s/});
          await expect(chart).toBeVisible();
          expect(await chart.evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
          // 勾和底板必须形成可见对比，同时验证取消与重新选中。
          const checkbox = page.getByRole("checkbox", {
            name: locale === "en" ? "Show archived" : "显示归档",
            exact: true,
          });
          await expect(checkbox).toBeChecked();
          const mark = checkbox.locator("+ .check-mark");
          await expect(mark.locator("svg")).toHaveCSS("opacity", "1");
          const contrast = await mark.evaluate((node) => {
            const style = getComputedStyle(node);
            const luminance = (color: string) => {
              const values = color
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number)
                .map((v) => {
                  const s = v / 255;
                  return s <= 0.04045
                    ? s / 12.92
                    : ((s + 0.055) / 1.055) ** 2.4;
                });
              return (
                values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
              );
            };
            const a = luminance(style.color),
              b = luminance(style.backgroundColor);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          });
          expect(contrast).toBeGreaterThanOrEqual(4.5);
          await checkbox.uncheck();
          await expect(mark.locator("svg")).toHaveCSS("opacity", "0");
          await checkbox.check();
          // 分区截图避免嵌套滚动容器将视口外内容截成空白。
          for (const [index, section] of [
            "actions",
            "forms",
            "agent",
          ].entries()) {
            await expect(
              page.locator(".ui-example > .ui-panel").nth(index),
            ).toHaveScreenshot(`${section}-${locale}-${theme}-${width}.png`);
          }
          await page
            .getByText(locale === "en" ? "Long content" : "超长内容", {
              exact: true,
            })
            .click();
          await page
            .getByText(locale === "en" ? "320px container" : "320px 窄容器", {
              exact: true,
            })
            .click();
          await page
            .getByRole("button", {
              name: locale === "en" ? "Content contracts" : "内容契约",
              exact: true,
            })
            .click();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
          ).toBe(false);
          await expect(page.locator(".ui-example-narrow")).toHaveScreenshot(
            `content-${locale}-${theme}-${width}.png`,
          );

          const copyName = locale === "en" ? "Copy code" : "复制代码";
          if (width === 390) await page.setViewportSize({ width: 320, height: 1000 });
          await page.getByRole("button", { name: copyName, exact: true }).click();
          const blocks = page.locator(".markdown-code-block");
          await expect(blocks).toHaveCount(2);
          await expect(blocks.first().getByText("typescript", { exact: true })).toBeVisible();
          await expect(blocks.last().getByText(locale === "en" ? "Plain text" : "纯文本", { exact: true })).toBeVisible();
          for (const block of await blocks.all()) {
            const copy = block.getByRole("button", { name: copyName });
            const pre = block.locator("pre");
            await expect(copy.locator("svg")).toBeVisible();
            expect(await pre.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
            expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(width === 390 ? 44 : 40);
            await copy.focus();
            await page.keyboard.press("Shift+Tab");
            await page.keyboard.press("Tab");
            await expect(copy).toBeFocused();
            expect(await copy.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
            await page.keyboard.press("Enter");
            await expect(block.getByRole("status")).toHaveText(locale === "en" ? "Code copied" : "已复制代码");
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await pre.textContent());
          }
        }
      }
    }
    // 模拟系统拒绝剪贴板写入，仍可选取同一块代码。
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        value: async () => { throw new DOMException("Denied", "NotAllowedError"); },
      });
    });
    const first = page.locator(".markdown-code-block").first();
    await first.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect(first.getByRole("status")).toHaveText(
      "Could not copy. Select the code to copy it manually.",
    );
    await expect(first.locator("pre")).not.toHaveCSS("user-select", "none");
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
