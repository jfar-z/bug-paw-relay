import { changeServerLanguage } from "./browser-language.js";
import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** 真实 HTTP 与隔离 SQLite 验证拖动，触屏通过 Chromium 原生触摸输入。 */
test("泳道独立滚动、视口适配与滚动后拖动", async ({ page, context }) => {
  const dir = await mkdtemp(join(tmpdir(), "relay-drag-"));
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
    const environment = store.put("environments", {
      name: "fixture",
      approved: true,
      roots: [{ id: "root", path: dir }],
    });
    const project = service.save("projects", {
      name: "拖动测试",
      directories: [
        { environmentId: environment.id, rootId: "root", relativePath: "." },
      ],
    });
    const first = randomUUID(),
      second = randomUUID(),
      agent = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "拖动测试",
      projectId: project.id,
      stages: [
        {
          id: first,
          fixedRole: "start",
          name: "起点",
          type: "human",
          targets: [second, agent, done],
        },
        { id: second, name: "复核", type: "human", targets: [done] },
        {
          id: agent,
          name: "开发",
          type: "agent",
          agentId: service.save("agents", { name: "Fixture agent" }).id,
          targets: [done],
          environmentId: environment.id,
          rootId: "root",
          relativePath: ".",
        },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    const cards = Array.from({ length: 24 }, (_, i) =>
      service.createItem({
        boardId: board.id,
        title: `滚动卡片${i}`,
        content: "内容",
      }),
    );
    for (const stageId of [agent, done, "missing-stage"]) {
      for (let i = 0; i < 12; i++) {
        const item = service.createItem({
          boardId: board.id,
          title: `${stageId}-${i}`,
          content: "内容",
        });
        store.put("items", { ...item, stageId }, item.id);
      }
    }
    const archived = service.createItem({
      boardId: board.id,
      title: "归档专用",
      content: "内容",
    });
    store.put("items", { ...archived, archived: true }, archived.id);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    config.publicUrl = base;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: base },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/#board/" + board.id);
    await expect(
      page.getByRole("button", { name: "新建看板", exact: true }),
    ).toHaveCount(0);
    const lane = (id: string) => page.locator(`[data-drop-stage="${id}"]`);
    const list = (id: string) => lane(id).locator(".column-items");
    await expect(list(first).locator(".task")).toHaveCount(24);
    // 比较所有阶段与删除阶段占位列，空列也必须共享当前最长列高度。
    const expectEqualHeights = async () => {
      await expect
        .poll(async () => {
          const heights = await page
            .locator(".board > .column")
            .evaluateAll((columns) =>
              columns.map((column) => column.getBoundingClientRect().height),
            );
          return Math.max(...heights) - Math.min(...heights);
        })
        .toBeLessThanOrEqual(1);
    };
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 600 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      for (const locale of ["zh-CN", "en"] as const) {
        await changeServerLanguage(page, locale);
        for (const theme of ["light", "dark", "bug"]) {
          await page.evaluate(
            (t) => (document.documentElement.dataset.theme = t),
            theme,
          );
          await page.locator(".content").evaluate((e) => (e.scrollTop = 0));
          if (viewport.width < 760 && viewport.height > viewport.width) {
            // 顶部限高必须覆盖双语三主题，避免普通控件把泳道挤回屏幕下方。
            const header = (await page
              .locator(".ui-board-header")
              .boundingBox())!;
            const boardBox = (await page.locator(".board").boundingBox())!;
            expect(header.height).toBeLessThanOrEqual(48);
            const status = (await page
              .locator(".ui-board-header + .ui-row")
              .boundingBox())!;
            // 待处理与同步提醒必须完整保留，不计入正常控件区的高度预算。
            expect(boardBox.y - header.y - status.height).toBeLessThanOrEqual(
              180,
            );
            expect(
              (await page.locator(".ui-board-toolbar").boundingBox())!.height,
            ).toBeLessThanOrEqual(48);
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
          }
          await expectEqualHeights();
          for (const id of [first, agent, done, "deleted-stage"]) {
            await list(id).evaluate((e) => (e.scrollTop = 0));
            const header = await lane(id)
              .locator(".column-title")
              .boundingBox();
            await list(id).evaluate((e) => (e.scrollTop = e.scrollHeight));
            const metrics = await list(id).evaluate((e) => ({
              top: e.scrollTop,
              end: e.scrollTop + e.clientHeight,
              total: e.scrollHeight,
              last: e.lastElementChild!.getBoundingClientRect().bottom,
              bottom: e.getBoundingClientRect().bottom,
            }));
            expect(metrics.top).toBeGreaterThan(0);
            expect(metrics.end).toBeGreaterThanOrEqual(metrics.total - 1);
            expect(metrics.last).toBeLessThanOrEqual(metrics.bottom + 1);
            expect(
              (await lane(id).locator(".column-title").boundingBox())!.y,
            ).toBeCloseTo(header!.y, 0);
            expect((await lane(id).boundingBox())!.height).toBeLessThanOrEqual(
              viewport.height,
            );
          }
          expect(
            await list(second).evaluate(
              (e) => e.scrollHeight <= e.clientHeight,
            ),
          ).toBe(true);
          await page
            .locator(".content")
            .evaluate((e) => (e.scrollTop = e.scrollHeight));
          await page.screenshot({
            path: `.vibe/lane-${viewport.width}-${viewport.height}-${locale}-${theme}.png`,
          });
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".board").evaluate((e) => (e.scrollLeft = 0));
    await list(first).evaluate((e) => (e.scrollTop = 0));
    await list(first).focus();
    await page.keyboard.press("End");
    await expect
      .poll(() => list(first).evaluate((e) => e.scrollTop))
      .toBeGreaterThan(0);
    await page.keyboard.press("Tab");
    expect(
      await list(first).evaluate((e) => e.contains(document.activeElement)),
    ).toBe(true);
    await list(first).evaluate((e) => (e.scrollTop = 0));
    const bounds = (await list(first).boundingBox())!;
    await page.mouse.move(bounds.x + 80, bounds.y + 50);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() => list(first).evaluate((e) => e.scrollTop))
      .toBeGreaterThan(100);
    expect(await list(second).evaluate((e) => e.scrollTop)).toBe(0);
    // 从底部卡片开启详情，再拖入空列；真实服务端记录必须落在目标阶段。
    const last = list(first).locator(".task").last();
    await last.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await last.scrollIntoViewIfNeeded();
    let from = (await last.boundingBox())!;
    let to = (await lane(second).boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + 25);
    await page.mouse.down();
    await page.mouse.move(to.x + 70, to.y + 100, { steps: 8 });
    await expect(lane(second)).toHaveClass(/drop-target/);
    await page.mouse.up();
    await expect(page.getByRole("dialog")).toContainText(
      "Handoff record (optional)",
    );
    expect(store.list("handoffs")).toHaveLength(0);
    await page
      .getByRole("button", { name: "Submit handoff and advance" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(list(second).locator(".task")).toHaveCount(1);
    // 指针停在泳道卡片区底部时持续滚动，Escape 不产生推进。
    await list(first).evaluate((e) => (e.scrollTop = 0));
    from = (await list(first).locator(".task").first().boundingBox())!;
    const area = (await list(first).boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + 25);
    await page.mouse.down();
    await page.mouse.move(area.x + 80, area.y + area.height - 5, { steps: 5 });
    await expect
      .poll(() => list(first).evaluate((e) => e.scrollTop))
      .toBeGreaterThan(200);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(store.list("handoffs")).toHaveLength(1);
    // 原生触屏纵向滑动不会触发长按推进或详情。
    await page.setViewportSize({ width: 390, height: 844 });
    await list(first).evaluate((e) => (e.scrollTop = 0));
    const touchArea = (await list(first).boundingBox())!;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: touchArea.x + 90, y: touchArea.y + 150, id: 1 }],
    });
    for (let offset = 20; offset <= 120; offset += 20)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: touchArea.x + 90, y: touchArea.y + 150 - offset, id: 1 },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => list(first).evaluate((e) => e.scrollTop))
      .toBeGreaterThan(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(store.list("handoffs")).toHaveLength(1);
    await changeServerLanguage(page, "zh-CN");
    const search = page.getByPlaceholder("搜索工作项、标签");
    const expandedHeight = (await lane(first).boundingBox())!.height;
    await search.fill("归档专用");
    await expect(list(first).locator(".task")).toHaveCount(0);
    await expectEqualHeights();
    expect((await lane(first).boundingBox())!.height).toBeLessThan(
      expandedHeight,
    );
    await page.getByRole("checkbox", { name: "显示归档" }).check();
    await expect(list(first).locator(".task")).toHaveCount(1);
    expect(
      await list(first).evaluate((e) => e.scrollHeight <= e.clientHeight),
    ).toBe(true);
    await search.fill("");
    await expect(list(first).locator(".task")).toHaveCount(24);
    await expectEqualHeights();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
