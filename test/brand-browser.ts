import { expect, type Page } from "@playwright/test";

/** 验证真实移动抽屉的可用宽度、背景保留、焦点循环及关闭恢复。 */
export async function checkSessionDrawer(page: Page, trigger: string) {
  const sidebar = page.locator(".session-list");
  const original = await page.locator("html").getAttribute("data-theme");
  for (const [theme, canvas, rail] of [
    ["light", "#f3f2ee", "#ecebe6"],
    ["dark", "#151517", "#18191b"],
    ["bug", "#e9dfd1", "#34281f"],
  ]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    expect(
      await page
        .locator("html")
        .evaluate((node) =>
          getComputedStyle(node).getPropertyValue("--canvas").trim(),
        ),
    ).toBe(canvas);
    expect(
      await page
        .locator("html")
        .evaluate((node) =>
          getComputedStyle(node).getPropertyValue("--rail").trim(),
        ),
    ).toBe(rail);
    await page.screenshot({
      path: `.vibe/brand-${trigger}-${theme}.png`,
      animations: "disabled",
    });
  }
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme || "light";
  }, original);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(sidebar).toBeVisible();
    // 检查整行而非仅标题按钮，避免菜单外边距把列表悄悄撑高。
    const rows = await sidebar.locator(".session-entry").evaluateAll((nodes) =>
      nodes.map((node) => {
        const row = node.getBoundingClientRect();
        const menu = node
          .querySelector(".ui-menu button")!
          .getBoundingClientRect();
        return {
          height: row.height,
          menuHeight: menu.height,
          offset: Math.abs(menu.top - row.top),
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.height).toBe(44);
      expect(row.menuHeight).toBe(44);
      expect(row.offset).toBeLessThanOrEqual(1);
    }
    await expect.poll(async () => (await sidebar.boundingBox())!.x).toBe(0);
    const box = (await sidebar.boundingBox())!;
    expect(box.width).toBeLessThan(width - 30);
    expect(box.width).toBeLessThanOrEqual(310);
    await expect(page.locator(".chat")).toBeVisible();
    expect(
      await page
        .locator(".chat")
        .evaluate((node) => (node as HTMLElement).inert),
    ).toBe(true);
    await page
      .getByRole("button", { name: "关闭会话列表", exact: true })
      .focus();
    await page.keyboard.press("Shift+Tab");
    expect(
      await sidebar.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "关闭会话列表", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: `.vibe/brand-${trigger}-${width}.png`,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(sidebar).toBeHidden();
    await expect(
      page.getByRole("button", { name: trigger, exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: trigger, exact: true }).click();
    await page
      .locator(".session-scrim")
      .click({ position: { x: width - 8, y: 300 } });
    await expect(sidebar).toBeHidden();
    await page.getByRole("button", { name: trigger, exact: true }).click();
  }
}

/** 用超长中英文覆盖实际标题布局，检查单行省略和视口边界后恢复原文。 */
export async function checkLongChatTitle(page: Page) {
  const heading = page.locator(".chat-heading h2");
  const original = await heading.textContent();
  const header = page.locator(".ui-conversation-header");
  await expect(header).toHaveCount(1);
  const summary = header.locator(".ui-conversation-copy small");
  const originalSummary = await summary.textContent();
  await expect(heading).toHaveAttribute("title", original!);
  for (const width of [320, 390, 844, 1440]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(72);
    await summary.evaluate((node) => {
      node.textContent =
        "App Server Home / " + "LongProjectDirectory".repeat(20);
    });
    await expect(summary).toHaveCSS("white-space", "nowrap");
    const copy = (await header.locator(".ui-conversation-copy").boundingBox())!;
    const actions = (await header
      .locator(".ui-conversation-actions")
      .boundingBox())!;
    expect(copy.x + copy.width).toBeLessThanOrEqual(actions.x);
    expect(actions.x + actions.width).toBeLessThanOrEqual(width);
    for (const title of [
      "这是一个需要保持单行的很长会话标题".repeat(12),
      "VeryLongSessionTitle".repeat(20),
    ]) {
      await heading.evaluate((node, text) => {
        node.textContent = text;
      }, title);
      await expect(heading).toHaveCSS("white-space", "nowrap");
      await expect(heading).toHaveCSS("text-overflow", "ellipsis");
      const size = await heading.evaluate((node) => ({
        width: node.clientWidth,
        scroll: node.scrollWidth,
        height: node.getBoundingClientRect().height,
        line: parseFloat(getComputedStyle(node).lineHeight),
      }));
      expect(size.width).toBeGreaterThan(20);
      expect(size.scroll).toBeGreaterThan(size.width);
      expect(size.height).toBeLessThanOrEqual(size.line + 1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  await heading.evaluate((node, text) => {
    node.textContent = text;
  }, original);
  await summary.evaluate((node, text) => {
    node.textContent = text;
  }, originalSummary);
  await page.setViewportSize({ width: 390, height: 844 });
  await header.screenshot({
    path: `.vibe/audit/unified-header-${(await page.locator(".workbench-layout").count()) ? "workbench" : "environment"}.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 900 });
}
