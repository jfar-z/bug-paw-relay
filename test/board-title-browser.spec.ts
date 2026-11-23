import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** 使用隔离数据库和真实 HTTP 验证标题编辑，不接触部署账号或运行数据。 */
test("标题编辑、冲突保护、响应丢失及移动端键盘行为", async ({
  page,
  context,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "relay-title-ui-"));
  const config = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(config);
  try {
    store.put("users", { username: "fixture" }, "owner");
    const cookie = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(cookie), "owner", Date.now() + 600000);
    const project = service.save("projects", {
      name: "标题测试",
      directories: [],
    });
    const first = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "初始标题",
      projectId: project.id,
      stages: [
        {
          id: first,
          fixedRole: "start",
          name: "起点",
          type: "human",
          targets: [done],
        },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    config.publicUrl = base;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: base },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/#board/" + board.id);
    const trigger = page.getByRole("button", {
      name: "编辑看板标题",
      exact: true,
    });
    const input = page.getByLabel("看板标题", { exact: true });
    const save = page.getByRole("button", { name: "保存", exact: true });
    const dialog = page.getByRole("dialog", { name: "编辑看板标题" });
    await trigger.click();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("初始标题");
    await expect(save).toBeDisabled();
    for (const invalid of ["   ", "a".repeat(101), "😀".repeat(50) + "a"]) {
      await input.fill(invalid);
      await expect(save).toBeDisabled();
    }
    await input.fill("草稿");
    await page.mouse.click(1, 1);
    await expect(dialog).toBeVisible();
    await input.focus();
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(dialog).toBeVisible();
    await input.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(store.get("boards", board.id).name).toBe("初始标题");
    await trigger.click();
    await input.fill("  新  标题  ");
    await input.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".board-title")).toHaveText("新  标题");
    await page.reload();
    await expect(page.locator(".board-title")).toHaveText("新  标题");
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await trigger.click();
    await input.fill("我的草稿");
    service.renameBoard(board.id, {
      name: "其他标签页",
      version: store.get("boards", board.id).version,
    });
    await save.click();
    await expect(dialog).toContainText("看板已更新");
    await expect(input).toHaveValue("我的草稿");
    await expect(save).toBeDisabled();
    await page.getByRole("button", { name: "读取最新标题" }).click();
    await expect(dialog).toContainText("最新标题：其他标签页");
    await save.click();
    await expect(dialog).toHaveCount(0);
    expect(store.get("boards", board.id).name).toBe("我的草稿");

    // 延迟响应期间拒绝重复提交和关闭，完成后恢复焦点。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pendingWrites = 0;
    await page.route("**/api/boards/*/title", async (route) => {
      pendingWrites++;
      await gate;
      await route.continue();
    });
    await trigger.click();
    await input.fill("等待保存");
    await save.click();
    await expect(
      page.getByRole("button", { name: "取消", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "关闭", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    expect(pendingWrites).toBe(1);
    release();
    await expect(dialog).toHaveCount(0);
    await page.unroute("**/api/boards/*/title");

    // 服务已成功写入，但丢失响应；用户回读确认，不能自动重复提交。
    let writes = 0;
    await page.route("**/api/boards/*/title", async (route) => {
      writes++;
      await route.fetch();
      await route.abort("failed");
    });
    await trigger.click();
    await input.fill("响应丢失");
    await save.click();
    await expect(dialog).toContainText("保存结果暂未确认");
    await page.getByRole("button", { name: "读取最新标题" }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toBe(1);
    await page.unroute("**/api/boards/*/title");
    await trigger.click();
    await input.fill("离线草稿");
    await context.setOffline(true);
    await save.click();
    await expect(dialog).toContainText("当前网络不可用");
    await expect(input).toHaveValue("离线草稿");
    await context.setOffline(false);
    await page.getByRole("button", { name: "取消", exact: true }).click();

    await trigger.click();
    await input.fill("长".repeat(100));
    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".board-title")).toHaveText("长".repeat(100));

    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await trigger.click();
        await input.fill("😀".repeat(50));
        await expect(save).toBeEnabled();
        for (let n = 0; n < 5; n++) {
          await page.keyboard.press("Tab");
          expect(
            await dialog.evaluate((el) => el.contains(document.activeElement)),
          ).toBe(true);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `.vibe/title-${theme}-${width}.png`,
          animations: "disabled",
        });
        await page.getByRole("button", { name: "关闭", exact: true }).click();
        await expect(dialog).toHaveCount(0);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const times: number[] = [];
    for (let n = 0; n < 20; n++) {
      await trigger.click();
      await input.fill("性能验证" + n);
      const start = Date.now();
      await save.click();
      await expect(dialog).toHaveCount(0);
      times.push(Date.now() - start);
    }
    console.log("20 次真实 HTTP 保存耗时(ms):", JSON.stringify(times));
    expect(Math.max(...times)).toBeLessThan(2000);
    await trigger.click();
    service.remove("boards", board.id);
    await input.fill("不能重建");
    await save.click();
    await expect(dialog).toContainText("看板不存在或已不可访问");
    await expect(save).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
