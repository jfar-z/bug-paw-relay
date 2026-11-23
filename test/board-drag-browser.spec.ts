import { changeServerLanguage } from "./browser-language.js";
import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** 真实 HTTP 与隔离 SQLite 验证拖动，触屏通过 Chromium 原生触摸输入。 */
test("拖动推进、取消、冲突、触屏跨屏与空交接", async ({ page, context }) => {
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
    let sequence = 0;
    const create = () =>
      service.createItem({
        boardId: board.id,
        title: "卡片" + ++sequence,
        content: "详细需求正文。".repeat(200),
      });
    const item = create();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    config.publicUrl = base;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: base },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/#board/" + board.id);
    const lane = (id: string) => page.locator(`[data-drop-stage="${id}"]`);
    const card = (i: any) =>
      page.getByRole("button").filter({
        has: page.getByRole("heading", { name: i.title, exact: true }),
      });
    const mouseStart = async (i: any, target: string) => {
      await card(i).scrollIntoViewIfNeeded();
      const from = (await card(i).boundingBox())!,
        to = (await lane(target).boundingBox())!;
      await page.mouse.move(from.x + 40, from.y + 35);
      await page.mouse.down();
      await page.mouse.move(to.x + 80, to.y + 120, { steps: 8 });
    };
    // 原列、Escape、看板外取消都不能留下历史或误打开详情。
    await mouseStart(item, first);
    await page.mouse.up();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await mouseStart(item, second);
    await expect(lane(second)).toHaveClass(/drop-target/);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".drop-target")).toHaveCount(0);
    await mouseStart(item, second);
    await page.mouse.move(2, 2);
    await page.mouse.up();
    expect(store.list("handoffs")).toHaveLength(0);
    for (const theme of ["light", "dark", "bug"]) {
      await page.evaluate(
        (t) => (document.documentElement.dataset.theme = t),
        theme,
      );
      await mouseStart(item, second);
      await expect(lane(second)).toHaveClass(/drop-target/);
      await page.screenshot({ path: `.vibe/drag-${theme}.png` });
      await page.keyboard.press("Escape");
      await page.mouse.up();
    }
    const submitHandoff = () =>
      page.getByRole("button", { name: "提交交接并推进" });
    const bottomGap = () => submitHandoff().evaluate((button) =>
      button.closest("section")!.getBoundingClientRect().bottom -
      button.getBoundingClientRect().bottom
    );
    let advanceRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/advance")) advanceRequests++;
    });
    // 人工来源也先打开预选表单，取消不产生请求或历史。
    await mouseStart(item, second);
    await page.mouse.up();
    await expect(page.getByRole("dialog")).toContainText("交接记录（选填）");
    await expect(page.getByRole("dialog")).not.toContainText("详细需求正文");
    await expect(submitHandoff()).toBeInViewport({ ratio: 1 });
    expect(await bottomGap()).toBeGreaterThanOrEqual(20);
    await expect(page.getByLabel("目标阶段", { exact: true })).toContainText(
      "复核",
    );
    expect(store.get("items", item.id).stageId).toBe(first);
    expect(advanceRequests).toBe(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(store.list("handoffs")).toHaveLength(0);
    await mouseStart(item, second);
    await page.mouse.up();
    await submitHandoff().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      lane(second).getByRole("heading", { name: item.title }),
    ).toBeVisible();
    expect(store.list("handoffs")).toHaveLength(1);
    expect(store.list("handoffs")[0].record).toBe("");
    await mouseStart(item, agent);
    await expect(page.locator(".drop-target")).toHaveCount(0);
    await page.mouse.up();
    expect(store.list("handoffs")).toHaveLength(1);
    await page.waitForTimeout(750);
    await card(item).click();
    await expect(page.getByRole("dialog")).toContainText("未填写交接记录");
    await expect(page.getByRole("dialog")).toContainText("详细需求正文");
    await expect(page.getByRole("dialog")).toContainText("交接记录（选填）");
    await page.keyboard.press("Escape");
    // 人工到 Agent 的正文保留原文，刷新后历史仍可查看。
    const withRecord = create();
    await page.reload();
    await mouseStart(withRecord, agent);
    await page.mouse.up();
    await expect(page.getByRole("dialog")).toContainText("交接记录（选填）");
    await page
      .locator(".item-handoff textarea")
      .fill("  人工交接内容\n第二行  ");
    await submitHandoff().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await card(withRecord).click();
    await expect(page.locator(".handoff-history")).toContainText(
      "人工交接内容",
    );
    expect(
      store.list("handoffs").find((h) => h.itemId === withRecord.id)?.record,
    ).toBe("  人工交接内容\n第二行  ");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Agent 松手仅打开预选表单，空正文禁止提交，取消不流转。
    const agentItem = create();
    service.advance(
      agentItem.id,
      agent,
      "",
      randomUUID(),
      undefined,
      [],
      undefined,
      false,
      { stageId: agentItem.stageId, version: agentItem.version },
    );
    await page.reload();
    await mouseStart(agentItem, done);
    await page.mouse.up();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("交接记录（必填）");
    await expect(
      page.getByRole("button", { name: "提交交接并推进" }),
    ).toBeDisabled();
    await page.locator(".item-handoff textarea").fill("   ");
    await expect(submitHandoff()).toBeDisabled();
    await page.keyboard.press("Escape");
    expect(store.get("items", agentItem.id).stageId).toBe(agent);
    await page.waitForTimeout(750);
    await card(agentItem).click();
    await page.getByLabel("目标阶段", { exact: true }).click();
    await page.getByRole("option").last().click();
    await page.locator(".item-handoff textarea").fill("交接内容");
    await page.getByRole("button", { name: "提交交接并推进" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(store.get("items", agentItem.id).stageId).toBe(done);
    // 拖动时并发修改版本，旧意图不能应用到新来源。
    const stale = create();
    await page.reload();
    await mouseStart(stale, done);
    store.put(
      "items",
      { ...store.get("items", stale.id), title: stale.title + "更新" },
      stale.id,
    );
    await page.mouse.up();
    await submitHandoff().click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(store.get("items", stale.id).stageId).toBe(first);
    // 丢失成功响应仍只产生一次历史，实际位置由轮询确认。
    const lost = create();
    await page.reload();
    await page.route("**/api/items/*/advance", async (route) => {
      await route.fetch();
      await route.abort("failed");
    });
    await mouseStart(lost, second);
    await page.mouse.up();
    await submitHandoff().click();
    await expect(
      lane(second).getByRole("heading", { name: lost.title }),
    ).toBeVisible();
    expect(
      store.list("handoffs").filter((h) => h.itemId === lost.id),
    ).toHaveLength(1);
    await page.unroute("**/api/items/*/advance");
    // 手机触摸长按与边缘自动滚动到屏外目标。
    const mobile = create();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const cdp = await context.newCDPSession(page);
    const touch = async (
      type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
      x = 0,
      y = 0,
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" || type === "touchCancel"
            ? []
            : [{ x, y, id: 1 }],
      });
    await card(mobile).scrollIntoViewIfNeeded();
    let rect = (await card(mobile).boundingBox())!;
    await touch("touchStart", rect.x + 45, rect.y + 30);
    await touch("touchMove", rect.x + 45, rect.y + 5);
    await touch("touchEnd");
    expect(store.get("items", mobile.id).stageId).toBe(first);
    await card(mobile).scrollIntoViewIfNeeded();
    rect = (await card(mobile).boundingBox())!;
    await touch("touchStart", rect.x + 45, rect.y + 30);
    await page.waitForTimeout(450);
    await expect(page.locator(".drag-ghost")).toBeVisible();
    await touch("touchCancel");
    await expect(page.locator(".drag-ghost")).toHaveCount(0);
    await touch("touchStart", rect.x + 45, rect.y + 30);
    await page.waitForTimeout(450);
    await touch("touchMove", 380, rect.y + 30);
    await expect
      .poll(async () => page.locator(".board").evaluate((e) => e.scrollLeft))
      .toBeGreaterThan(400);
    await page.waitForTimeout(500);
    const target = (await lane(done).boundingBox())!;
    await touch(
      "touchMove",
      Math.min(350, target.x + 70),
      Math.max(180, target.y + 120),
    );
    await expect(lane(done)).toHaveClass(/drop-target/);
    await page.screenshot({ path: ".vibe/drag-mobile.png" });
    await touch("touchEnd");
    await expect(page.getByRole("dialog")).toContainText("交接记录（选填）");
    // 保持弹窗打开，验证语言和主题切换后四项操作仍完整落在首屏。
    expect(await bottomGap()).toBeGreaterThanOrEqual(16);
    const form = page.locator(".item-handoff");
    for (const locale of ["en", "zh-CN"] as const) {
      await changeServerLanguage(page, locale);
      await expect(form).toContainText(locale === "en" ? "Handoff record" : "交接记录");
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        for (const control of ["button[aria-haspopup]", "textarea", ".ui-attachment-picker", "button.primary"]) {
          await expect(form.locator(control)).toBeInViewport({ ratio: 1 });
        }
      }
    }
    expect(store.get("items", mobile.id).stageId).toBe(first);
    await page.locator(".item-handoff textarea").fill("   ");
    await submitHandoff().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => store.get("items", mobile.id).stageId).toBe(done);
    // 明确失败保留卡片；延迟请求期间重复手势只产生一次写入。
    await page.setViewportSize({ width: 1440, height: 1000 });
    const failure = create();
    await page.reload();
    await page.route("**/api/items/*/advance", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          message: "状态变化",
          code: "ITEM_ADVANCE_CONFLICT",
          messageKey: "handoff.ITEM_ADVANCE_CONFLICT",
        }),
      }),
    );
    await mouseStart(failure, second);
    await page.mouse.up();
    await submitHandoff().click();
    await expect(page.getByRole("alert")).toContainText("工作项状态已变化");
    expect(store.get("items", failure.id).stageId).toBe(first);
    await page.unroute("**/api/items/*/advance");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    await page.route("**/api/items/*/advance", async (route) => {
      writes++;
      await gate;
      await route.continue();
    });
    await submitHandoff().click();
    await expect(page.locator(".item-handoff button.primary")).toBeDisabled();
    await expect.poll(() => writes).toBe(1);
    // 在途按钮禁用，程序重复点击也不能重复发送。
    await page.locator(".item-handoff button.primary").evaluate((el) => {
      (el as HTMLButtonElement).click();
    });
    expect(writes).toBe(1);
    release();
    await expect(
      lane(second).getByRole("heading", { name: failure.title }),
    ).toBeVisible();
    await page.unroute("**/api/items/*/advance");
    // 三主题手机英文详情，键盘选择目标，纯空白人工记录仍可推进。
    const keyboard = create();
    await page.reload();
    await changeServerLanguage(page, "en");
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate(
          (t) => (document.documentElement.dataset.theme = t),
          theme,
        );
        await card(keyboard).click();
        await expect(page.getByRole("dialog")).toContainText(
          "Handoff record (optional)",
        );
        await page.screenshot({
          path: `.vibe/drag-detail-en-${theme}-${width}.png`,
          animations: "disabled",
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.keyboard.press("Escape");
      }
    }
    await card(keyboard).click();
    const choose = page.getByLabel("Target stage", { exact: true });
    await choose.focus();
    await choose.press("Enter");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.locator(".item-handoff textarea").fill("   ");
    const submit = page.getByRole("button", {
      name: "Submit handoff and advance",
    });
    await submit.focus();
    await submit.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      store.list("handoffs").find((h) => h.itemId === keyboard.id)?.record,
    ).toBe("");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
