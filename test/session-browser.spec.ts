import { workflowPrompt } from "../src/shared/stage-handoff.js";
import { createServer } from "node:net";
import { checkSessionDrawer, checkLongChatTitle } from "./brand-browser.js";
import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** 真实 HTTP/SSE 与 React 页面，环境使用可控事件源以断言完成前确实显示增量。 */
test("环境会话即时回显、流式工具、刷新恢复、批量归档删除与移动端", async ({
  page,
  context,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-session-browser-"));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const { app, store, service } = await createApp({
    dataDir: dir,
    publicUrl: `http://127.0.0.1:${port}`,
    webDir: resolve("dist/web"),
    secureCookie: false,
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cookie = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const env = store.put("environments", {
    name: "隔离环境",
    tools: { claude: { runsAsRoot: true } },
    roots: [],
    approved: true,
  });
  const project = service.save("projects", {
    name: "测试项目",
    directories: [{ environmentId: env.id, rootId: "root", relativePath: "." }],
  });
  let executionId = "";
  let snapshotEvents: any[] = [];
  let nativeHistory: any = { thread: { turns: [] } };
  let sequence = 0;
  let snapshotStatus = "idle";
  let historyReads = 0;
  let snapshotGap = false;
  const allEvents: any[] = [];
  const peer = {
    call: async (method: string, p: any) => {
      if (method === "session.history") {
        historyReads++;
        return {
          title: "环境端标题",
          events: snapshotEvents,
          nativeHistory,
          gap: snapshotGap,
          status: snapshotStatus,
          interactions: [],
        };
      }
      if (method === "execution.start") {
        executionId = p.executionId;
        sequence = 0;
        return { status: "running" };
      }
      return { status: "completed" };
    },
    close: () => {},
  };
  service.peers.set(env.id, peer as any);
  const initialAgent = service.save("agents", { name: "初始职责" });
  const create = (runtime: string) =>
    service.createSession({
      agentId: initialAgent.id,
      title: "临时标题",
      projectId: project.id,
      environmentId: env.id,
      rootId: "root",
      runtime,
    });
  const session = create("codex");
  const second = create("claude");
  // 还原升级前未绑定职责的会话。
  store.put("sessions", { agentId: null }, session.id);
  const emit = (type: string, data: any) => {
    const event = { type, data, executionId, sequence: ++sequence };
    allEvents.push(event);
    service.sessionEvent(env.id, { executionId, event });
  };
  await app.listen({ host: "127.0.0.1", port });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  await context.addCookies([
    { name: "relay_session", value: cookie, url: base },
  ]);
  try {
    // 空态入口必须位于顶部左侧，并能打开和关闭会话抽屉。
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/#chat");
    await page
      .getByRole("button", { name: "关闭会话列表", exact: true })
      .click();
    const entry = page.getByRole("button", { name: "会话列表", exact: true });
    await expect(entry).toBeVisible();
    const entryBox = (await entry.boundingBox())!;
    const chatBox = (await page.locator(".chat").boundingBox())!;
    expect(entryBox.y - chatBox.y).toBeLessThan(40);
    expect(entryBox.x - chatBox.x).toBeLessThan(40);
    await entry.click();
    const drawer = page.locator(".session-list");
    await expect(drawer).toBeVisible();
    // 缩短视口让真实会话行溢出，斜向滚动后列表只能上下移动。
    await page.setViewportSize({ width: 320, height: 220 });
    await expect(drawer).toHaveCSS("touch-action", "pan-y pinch-zoom");
    await expect(drawer).toHaveCSS("overflow-x", "hidden");
    await page.mouse.move(120, 150);
    await page.mouse.wheel(120, 160);
    await expect.poll(() => drawer.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await drawer.evaluate((el) => el.scrollLeft)).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press("Escape");
    await expect(entry).toBeFocused();
    await page.screenshot({ path: ".vibe/empty-session-entry.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // 延迟环境历史：SSE 已连通也必须保持加载提示，不能提前展示空态。
    let releaseHistory!: () => void;
    const historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    await page.route(`**/api/sessions/${session.id}/history`, async (route) => {
      await historyGate;
      await route.continue();
    });
    await page.goto(base + "/#chat/" + session.id);
    await expect(
      page.getByRole("status").filter({ hasText: "正在从环境端加载会话记录" }),
    ).toBeVisible();
    await expect(page.locator(".session-messages")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(
      page.getByText("发送第一条消息。", { exact: false }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".session-list")).toBeHidden();
    await page.screenshot({ path: ".vibe/session-history-loading.png" });
    releaseHistory();
    await expect(page.locator(".session-history-loading")).toHaveCount(0);
    await expect(page.locator(".session-messages")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page.unroute(`**/api/sessions/${session.id}/history`);
    // 切换到另一会话失败时结束加载，不把失败误显示成空历史。
    await page.route(`**/api/sessions/${second.id}/history`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "环境暂时离线" }),
      }),
    );
    await page.goto(base + "/#chat/" + second.id);
    await expect(page.getByRole("alert")).toContainText(
      "操作失败，请检查配置或重试 (HTTP 503",
    );
    await expect(page.locator(".session-history-loading")).toHaveCount(0);
    await expect(
      page.getByText("发送第一条消息。", { exact: false }),
    ).toHaveCount(0);
    await page.unroute(`**/api/sessions/${second.id}/history`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    // 从深链接进入时，选中 ID 先于 /state 返回，订阅仍必须自动建立。
    await page.goto(base + "/#chat/" + session.id);
    await expect(
      page.getByRole("heading", { name: "环境端标题", exact: true }),
    ).toBeVisible();
    await checkLongChatTitle(page);
    await expect(
      page.getByText("实时连接恢复中，正在定期同步", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("实时连接已建立", { exact: true })).toHaveCount(
      0,
    );
    // 工具栏能力读取可刷新，图标菜单保存深度后仍支持键盘退出。
    let catalogReads = 0;
    await page.route("**/api/environments/*/runtime-catalog", (route) => {
      catalogReads++;
      return route.fulfill({
        json: {
          models: [
            {
              id: "toolbar-model",
              name: "测试长模型名称",
              efforts: ["low", "high"],
            },
          ],
          defaults: { model: "toolbar-model" },
        },
      });
    });
    const refresh = page.getByRole("button", {
      name: "刷新模型能力",
      exact: true,
    });
    await refresh.click();
    await expect.poll(() => catalogReads).toBe(1);
    await expect(refresh).toBeEnabled();
    await expect(refresh.locator("svg")).toHaveCount(1);
    await expect(page.getByText("配置详情", { exact: true })).toHaveCount(0);
    const effort = page.getByRole("button", {
      name: "CLI 思考深度",
      exact: true,
    });
    await expect(effort.locator("svg")).toHaveCount(1);
    await expect(effort).toHaveText("");
    await effort.click();
    await page.getByRole("option", { name: "high", exact: true }).click();
    await expect
      .poll(() => store.get("sessions", session.id).runtimeOptions?.effort)
      .toBe("high");
    await expect(effort).toHaveAttribute("title", "high");
    await effort.click();
    await page.keyboard.press("Escape");
    await expect(effort).toBeFocused();
    const input = page.getByLabel("发送给环境 Agent");
    for (const key of [
      "Shift+Enter",
      "Control+Enter",
      "Meta+Enter",
      "Alt+Enter",
    ]) {
      await input.fill("前后");
      await input.press("ArrowLeft");
      await input.press(key);
      await expect(input).toHaveValue("前\n后");
    }
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    expect(executionId).toBe("");
    const configAgent = store.put("agents", {
      name: "会话测试 Agent",
      avatar: "审",
      environmentId: env.id,
    });
    await page.reload();
    const avatarButton = page.getByRole("button", {
      name: "会话 Agent",
      exact: true,
    });
    await expect(avatarButton.locator("img")).toHaveAttribute(
      "src",
      "/assets/bugpaw-avatar.png",
    );
    const configUrl = "**/api/sessions/" + session.id + "/config";
    await page.route(configUrl, (route) =>
      route.fulfill({ status: 409, json: { message: "Fixture conflict" } }),
    );
    await avatarButton.click();
    await page
      .getByRole("option", { name: configAgent.name, exact: true })
      .click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(avatarButton.locator("img")).toHaveAttribute(
      "src",
      "/assets/bugpaw-avatar.png",
    );
    await page.unroute(configUrl);
    await page.getByRole("button", { name: "会话 Agent", exact: true }).click();
    await page
      .getByRole("option", {
        name: "会话测试 Agent",
        exact: true,
      })
      .click();
    await expect
      .poll(() => store.get("sessions", session.id).agentId)
      .toBe(configAgent.id);
    await expect(avatarButton.locator(".identity-avatar")).toHaveText("审");
    await page.getByRole("button", { name: "会话权限", exact: true }).click();
    await page.getByRole("option", { name: "自动审批", exact: true }).click();
    await expect.poll(() => store.get("sessions", session.id).permission).toBe("auto");
    await page.getByRole("button", { name: "会话权限", exact: true }).click();
    const full = page.getByRole("option", { name: "完全权限", exact: true });
    await expect(full.locator("svg")).toHaveCount(1);
    await expect(full).toHaveCSS("color", "rgb(154, 66, 72)");
    await full.click();
    await expect
      .poll(() => store.get("sessions", session.id).permission)
      .toBe("full");
    await expect(
      page.getByRole("button", { name: "会话权限", exact: true }),
    ).toHaveCSS("color", "rgb(154, 66, 72)");
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 374, height: 812 },
      { width: 390, height: 844 },
      { width: 800, height: 1100 },
      { width: 844, height: 390 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      // 长路径不再与标题争抢空间，完整信息可触屏打开。
      const header = page.locator(".ui-conversation-header");
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(72);
      const headingWidth = (await header.locator("h2").boundingBox())!.width;
      if (viewport.width < 760)
        expect(headingWidth).toBeGreaterThan(70);
      await header.getByRole("button", { name: "更多操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "会话详情", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("隔离环境");
      await expect(page.getByRole("dialog")).toContainText("完全权限");
      // 完整信息弹窗不能被无空格的超长标题撑宽。
      await page.getByRole("dialog").locator("h3").evaluate(node => { node.textContent = "LongSessionTitle".repeat(30); });
      expect(await page.getByRole("dialog").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.mouse.move(0, 0);
      await header.screenshot({
        path: `.vibe/audit/session-header-${viewport.width}.png`,
        animations: "disabled",
      });
      // 图标必须为正方形，手机触控边长不能被极窄布局压缩。
      const sendBox = (await page
        .getByRole("button", { name: "发送", exact: true })
        .boundingBox())!;
      expect(Math.abs(sendBox.width - sendBox.height)).toBeLessThanOrEqual(1);
      expect(sendBox.width).toBeGreaterThanOrEqual(
        viewport.width < 760 ? 44 : 40,
      );
      // 正文保留限宽，但滚动区域必须覆盖整个对话面板。
      const edges = await page
        .locator(".session-messages")
        .evaluate((element) => {
          const panel = element.closest(".chat")!.getBoundingClientRect();
          const scroll = element.getBoundingClientRect();
          return { panelRight: panel.right, scrollRight: scroll.right };
        });
      expect(
        Math.abs(edges.panelRight - edges.scrollRight),
      ).toBeLessThanOrEqual(1);

      const boxes = await page
        .locator(
          ".unified-composer .composer-bottom .select-trigger, .unified-composer .composer-bottom .icon-button",
        )
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.getClientRects().length > 0)
            .map((node) => ({
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
      const permission = page.getByRole("button", { name: "会话权限", exact: true });
      const attachment = page.getByRole("button", { name: "添加附件", exact: true });
      await expect(permission).toBeEnabled();
      const modelButton = page.getByRole("button", {
        name: "CLI 模型",
        exact: true,
      });
      const configuration = page.getByRole("button", {
        name: "会话配置",
        exact: true,
      });
      const collapsed = await configuration.isVisible();
      const assertToolbarSpacing = async () => {
        const toolbar = page.locator(".session-composer-toolbar");
        const leftControls = collapsed
          ? [configuration, attachment, permission]
          : [attachment, toolbar.locator(".session-configuration-panel"), permission];
        const bounds = await Promise.all(
          leftControls.map(async (control) => (await control.boundingBox())!),
        );
        const [first, middle, last] = bounds;
        const previous = collapsed ? middle : (await refresh.boundingBox())!;
        const frame = (await toolbar.boundingBox())!;
        const send = (await page.getByRole("button", { name: "发送", exact: true }).boundingBox())!;
        // 每个控件保持固定相邻间距，剩余宽度留给左右两组之间。
        const firstGap = middle.x - first.x - first.width;
        const secondGap = last.x - previous.x - previous.width;
        expect(Math.abs(first.x - frame.x)).toBeLessThanOrEqual(1);
        expect(firstGap, `${viewport.width}px 左侧第一处间距`).toBeCloseTo(4, 0);
        expect(secondGap, `${viewport.width}px 权限按钮间距`).toBeCloseTo(4, 0);
        expect(Math.abs(last.y - send.y)).toBeLessThanOrEqual(2);
        expect(send.x - last.x - last.width).toBeGreaterThan(secondGap);
        expect(Math.abs(send.x + send.width - frame.x - frame.width)).toBeLessThanOrEqual(1);
        expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      };
      await assertToolbarSpacing();
      if (collapsed) {
        await expect(modelButton).toHaveCount(0);
        await configuration.click();
        await expect(modelButton).toBeVisible();
        expect((await modelButton.boundingBox())!.width).toBeGreaterThan(55);
        await assertToolbarSpacing();
        await page.locator(".session-composer-toolbar").screenshot({
          path: `.vibe/audit/session-toolbar-expanded-${viewport.width}.png`,
        });
        await configuration.click();
        await assertToolbarSpacing();
      } else
        expect((await modelButton.boundingBox())!.width).toBeGreaterThan(55);
      await expect(page.locator(".toast")).toHaveCount(0);
      await page.screenshot({ path: `.vibe/toolbar-${viewport.width}.png` });
    }
    // 桌面用键盘修改权限，手机触控在配置收起时可直接保存。
    const permission = page.getByRole("button", { name: "会话权限", exact: true });
    await permission.press("Home");
    const ask = page.getByRole("option", { name: "询问模式", exact: true });
    await expect(ask).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(permission).toBeFocused();
    await permission.press("Home");
    await expect(ask).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => store.get("sessions", session.id).permission).toBe("ask");
    await expect(permission).toHaveAttribute("title", "询问模式");
    const touchContext = await context.browser()!.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      locale: "zh-CN",
    });
    try {
      await touchContext.addCookies(await context.cookies(base));
      const touchPage = await touchContext.newPage();
      await touchPage.goto(base + "/#chat/" + session.id);
      await expect(
        touchPage.getByRole("button", { name: "会话配置", exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
      const touchConfig = touchPage.getByRole("button", {
        name: "会话配置",
        exact: true,
      });
      await touchConfig.tap();
      await expect(
        touchPage
          .getByRole("button", { name: "会话 Agent" })
          .locator(".identity-avatar"),
      ).toHaveText("审");
      await touchConfig.tap();
      await touchPage.getByRole("button", { name: "会话权限", exact: true }).tap();
      await touchPage.getByRole("option", { name: "完全权限", exact: true }).tap();
      await expect.poll(() => store.get("sessions", session.id).permission).toBe("full");

      // 模拟已保存完全权限的 Claude 会话连接到受限目标，提示应独占工具栏下方。
      store.put("sessions", { permission: "full" }, second.id);
      await touchPage.goto(base + "/#chat/" + second.id);
      const notice = touchPage.getByRole("note").filter({ hasText: "已保存的完全权限" });
      await expect(notice).toBeVisible();
      const restrictedPermission = touchPage.getByRole("button", { name: "会话权限", exact: true });
      const send = touchPage.getByRole("button", { name: "发送", exact: true });
      for (const width of [320, 390]) {
        await touchPage.setViewportSize({ width, height: 844 });
        const permissionBox = (await restrictedPermission.boundingBox())!;
        const sendBox = (await send.boundingBox())!;
        expect(permissionBox.x + permissionBox.width).toBeLessThan(sendBox.x);
        expect((await notice.boundingBox())!.y).toBeGreaterThanOrEqual(sendBox.y + sendBox.height);
      }
      await touchPage.locator(".composer").screenshot({ path: ".vibe/audit/session-restricted-toolbar.png" });
      await restrictedPermission.tap();
      await touchPage.getByRole("option", { name: "询问模式", exact: true }).tap();
      await expect.poll(() => store.get("sessions", second.id).permission).toBe("ask");
      await expect(touchPage.locator(".composer").getByRole("note")).toHaveCount(0);
    } finally {
      await touchContext.close();
    }
    // 事件源桩未提供运行参数能力，完成控件验证后恢复默认，继续原有流式回归。
    await effort.click();
    await page.getByRole("option", { name: "跟随配置", exact: true }).click();
    await expect
      .poll(() => store.get("sessions", session.id).runtimeOptions?.effort)
      .toBeNull();
    // 模拟代理间歇返回 HTML，保留会话与草稿，下一次正常轮询必须清除提示。
    for (const endpoint of [
      "/api/state",
      `/api/sessions/${session.id}/history`,
    ]) {
      await page.getByLabel("发送给环境 Agent").fill("网络恢复后继续编辑");
      await page.route(`**${endpoint}`, (route) =>
        route.fulfill({
          status: 502,
          contentType: "text/html",
          body: "<html><h1>Bad Gateway</h1></html>",
        }),
      );
      await expect(
        page.getByText(`服务暂时不可用，请稍后重试 (HTTP 502, ${endpoint})`),
      ).toBeVisible({ timeout: 12000 });
      await expect(page.getByLabel("发送给环境 Agent")).toHaveValue(
        "网络恢复后继续编辑",
      );
      await expect(
        page.getByRole("heading", { name: "环境端标题", exact: true }),
      ).toBeVisible();
      await page.unroute(`**${endpoint}`);
      await expect(
        page.getByText(`服务暂时不可用，请稍后重试 (HTTP 502, ${endpoint})`),
      ).toHaveCount(0, { timeout: 12000 });
    }
    await page.getByLabel("发送给环境 Agent").fill("请检查流式消息");
    await input.press("Enter");
    await expect(
      page.locator(".messages").getByText("请检查流式消息", { exact: true }),
    ).toBeVisible();
    // 乐观回显早于环境端收到执行请求，等待调度完成再注入事件。
    await expect.poll(() => executionId && service.execution(executionId).state).toBe("running");
    emit("user", { text: "请检查流式消息" });
    emit("item/started", { item: { id: "a", type: "agentMessage", text: "" } });
    // 可恢复错误必须展示重连提示，普通通知不算恢复，后续模型输出才标记恢复。
    emit("error", {
      error: { message: "Reconnecting... 1/5" },
      willRetry: true,
    });
    await expect(page.locator(".native-retry")).toContainText("正在自动重连");
    await expect(page.locator(".messages .error-box")).toHaveCount(0);
    emit("deprecationNotice", { message: "普通通知" });
    await expect(page.locator(".native-retry")).toContainText("正在自动重连");
    emit("item/agentMessage/delta", { itemId: "a", delta: "正在检查" });
    await expect(page.locator(".native-retry")).toContainText("模型连接已恢复");
    await expect(
      page.locator(".messages").getByText("正在检查", { exact: true }),
    ).toBeVisible();
    emit("item/agentMessage/delta", { itemId: "a", delta: "项目" });
    await expect(
      page.locator(".messages").getByText("正在检查项目", { exact: true }),
    ).toBeVisible();
    emit("item/started", {
      item: { id: "tool", type: "commandExecution", command: "pwd" },
    });
    emit("item/commandExecution/outputDelta", {
      itemId: "tool",
      delta: "/workspace",
    });
    await page.locator(".workbench-activity summary").click();
    await expect(page.locator(".workbench-activity-detail")).toContainText(
      "/workspace",
    );
    expect(service.execution(executionId).state).toBe("running");
    // 历史接口持续返回空快照，跨过一次轮询仍不能擦除增量或自己的消息。
    const readsBefore = historyReads;
    await expect
      .poll(() => historyReads, { timeout: 10000 })
      .toBeGreaterThan(readsBefore);
    await expect(
      page.locator(".messages").getByText("正在检查项目", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".messages .user-message")).toHaveCount(1);
    await expect(
      page.locator(".messages .user-message .message-identity").first(),
    ).not.toHaveText("你");

    // Markdown 用户消息与工作台共享气泡底板，三主题都不能退化为透明正文。
    for (const theme of ["light", "dark", "bug"]) {
      await page
        .locator("html")
        .evaluate(
          (node, value) => node.setAttribute("data-theme", value),
          theme,
        );
      const bubble = await page
        .locator(".user-message > .workbench-markdown")
        .first()
        .evaluate((node) => {
          const css = getComputedStyle(node);
          return {
            background: css.backgroundColor,
            radius: css.borderTopLeftRadius,
            padding: css.paddingLeft,
            width: node.getBoundingClientRect().width,
            parent: node.parentElement!.getBoundingClientRect().width,
          };
        });
      expect(bubble.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(bubble.radius).toBe("10px");
      expect(bubble.padding).toBe("18px");
      expect(bubble.width).toBeLessThanOrEqual(bubble.parent + 1);
      await page
        .locator(".user-message")
        .first()
        .screenshot({
          path: `.vibe/audit/session-bubble-${theme}.png`,
          animations: "disabled",
        });
    }
    await page
      .locator("html")
      .evaluate((node) => node.setAttribute("data-theme", "light"));

    // 执行中不能通过折叠菜单归档或删除，键盘跳过禁用项。
    await page
      .locator(".ui-conversation-header")
      .getByRole("button", { name: "更多操作", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "归档", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("menuitem", { name: "删除", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("End");
    await expect(
      page.getByRole("menuitem", { name: "会话详情", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    snapshotEvents = [...allEvents];
    snapshotStatus = "running";
    await page.reload();
    await expect(
      page.locator(".messages").getByText("正在检查项目", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".messages .user-message")).toHaveCount(1);
    await expect(page.locator(".native-retry")).toContainText("模型连接已恢复");
    // 环境断连保留草稿与已收到正文；恢复只对账，不自动重放发送。
    const originalExecution = executionId;
    await input.fill("断连后保留的草稿");
    service.peers.delete(env.id);
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
    await expect(input).toHaveValue("断连后保留的草稿");
    await expect(
      page.locator(".messages").getByText("正在检查项目", { exact: true }),
    ).toBeVisible();
    service.peers.set(env.id, peer as any);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect.poll(() => historyReads).toBeGreaterThan(readsBefore);
    await expect(input).toHaveValue("断连后保留的草稿");
    expect(executionId).toBe(originalExecution);
    // 无原生历史时必须明确显示窗口缺口，不能假装完整或空历史。
    snapshotGap = true;
    nativeHistory = null;
    await expect(
      page.getByText("实时事件超出缓冲窗口，完整记录以环境原生历史为准。", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 12000 });
    snapshotGap = false;
    await expect(
      page.getByText("实时事件超出缓冲窗口，完整记录以环境原生历史为准。", {
        exact: true,
      }),
    ).toHaveCount(0, { timeout: 12000 });
    // 新增存储错误沿用真实 HTTP 错误展示，不误显示空态或自动重试写操作。
    await page.route(`**/api/sessions/${session.id}/history`, (route) =>
      route.fulfill({
        status: 503,
        json: {
          code: "STORAGE_UNAVAILABLE",
          message: "环境存储不可用，执行已停止；请检查连接器诊断日志。",
          messageKey: "connector.storage.STORAGE_UNAVAILABLE",
          messageParams: {},
        },
      }),
    );
    await expect(
      page.getByText("环境存储不可用，执行已停止；请检查连接器诊断日志。", {
        exact: false,
      }),
    ).toBeVisible({ timeout: 12000 });
    await expect(
      page.getByText("发送第一条消息。", { exact: false }),
    ).toHaveCount(0);
    await expect(input).toHaveValue("断连后保留的草稿");
    await page.unroute(`**/api/sessions/${session.id}/history`);
    await expect(
      page.getByText("环境存储不可用，执行已停止；请检查连接器诊断日志。", {
        exact: false,
      }),
    ).toHaveCount(0, { timeout: 12000 });
    await input.fill("");
    // 不可重试的嵌套错误保留真实消息，不能因后续正常输出而隐藏。
    emit("error", { error: { message: "测试最终失败原因" }, willRetry: false });
    await expect(page.locator(".messages .error-box")).toHaveText(
      "测试最终失败原因",
    );
    emit("item/completed", {
      item: {
        id: "tool",
        type: "commandExecution",
        status: "completed",
        command: "pwd",
        aggregatedOutput: "/workspace",
        exitCode: 0,
      },
    });
    emit("item/completed", {
      item: { id: "a", type: "agentMessage", text: "检查完成，无需切换会话" },
    });
    snapshotEvents = [...allEvents];
    snapshotStatus = "completed";
    service.sessionEvent(env.id, {
      executionId,
      status: "completed",
      interactions: [],
      title: "原生自动标题",
    });
    await expect(
      page
        .locator(".messages")
        .getByText("检查完成，无需切换会话", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".messages .message:not(.user-message)"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
    // 旧连接器的需求回显与阶段原生包装必须合并，重新打开也不能追加虚假用户消息。
    nativeHistory = {
      thread: {
        turns: [
          {
            status: "completed",
            items: [
              {
                id: "stage-user",
                type: "userMessage",
                content: [
                  {
                    type: "text",
                    text: '阶段指令\n工作项：检查项目\n请检查流式消息\n允许目标:["done"]\n交接历史：[]\n完成后调用 relay_handoff 工具提交记录并选择合法目标。'.replace(
                      "允许目标:",
                      "允许目标：",
                    ),
                  },
                ],
              },
              { id: "a", type: "agentMessage", text: "检查完成，无需切换会话" },
            ],
          },
        ],
      },
    };
    await page.reload();
    await expect(page.locator(".messages .user-message")).toHaveCount(1);
    await expect(page.locator(".messages .user-message")).toContainText(
      "阶段指令",
    );
    await expect(page.locator(".messages .user-message").last()).not.toHaveText(
      "请检查流式消息",
    );
    await expect(
      page
        .locator(".messages .message:not(.user-message) .message-identity")
        .first(),
    ).toContainText("会话测试 Agent");
    await expect(
      page
        .locator(".messages .message:not(.user-message) .identity-avatar")
        .first(),
    ).toHaveText("审");
    // 更改已绑定配置的头像后，重新读取历史的身份行也应使用预设资源。
    const presetAvatar = "/assets/agent-avatars/qa.png";
    store.put("agents", { avatar: presetAvatar }, configAgent.id);
    await page.reload();
    await expect(
      page.locator(".messages .message:not(.user-message) .identity-avatar img").first(),
    ).toHaveAttribute("src", presetAvatar);
    // 新 Markdown 包装在刷新和重新进入时仍只合并同一次需求回显。
    nativeHistory.thread.turns[0].items[0].content[0].text = workflowPrompt(
      {
        instructions: "阶段指令",
        title: "检查项目",
        targets: [],
        handoffContractVersion: 2,
        currentStage: { shortId: "S1", name: "执行", type: "agent" },
        allowedTargets: [{ shortId: "S2", name: "完成", type: "done" }],
        handoffs: [],
      },
      "请检查流式消息",
      "codex",
    );
    await page.reload();
    await expect(page.locator(".messages .user-message")).toHaveCount(1);
    await expect(page.locator(".messages .user-message")).toContainText(
      "Current stage",
    );
    await page.goto(base + "/#chat/" + second.id);
    await page.goto(base + "/#chat/" + session.id);
    await expect(page.locator(".messages .user-message")).toHaveCount(1);
    // Claude 的文本块和工具结果同样通过真实 SSE 通路展示。
    snapshotEvents = [];
    nativeHistory = [];
    snapshotStatus = "idle";
    await page.goto(base + "/#chat/" + second.id);
    await page.getByLabel("发送给环境 Agent").fill("验证 Claude 工具");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.locator(".messages").getByText("验证 Claude 工具", { exact: true }),
    ).toBeVisible();
    const stream = (event: any) => emit("stream_event", { event });
    emit("user", { text: "验证 Claude 工具" });
    stream({ type: "message_start", message: { id: "m" } });
    stream({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    stream({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "正在读取" },
    });
    await expect(
      page.locator(".messages").getByText("正在读取", { exact: true }),
    ).toBeVisible();
    emit("assistant", {
      type: "assistant",
      message: {
        id: "m",
        content: [
          { type: "text", text: "正在读取" },
          {
            type: "tool_use",
            id: "read",
            name: "Read",
            input: { file_path: "README.md" },
          },
        ],
      },
    });
    emit("user", {
      type: "user",
      uuid: "result",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "read", content: "工具结果可见" },
        ],
      },
    });
    await page.locator(".workbench-activity-summary").click();
    await page.locator(".workbench-activity summary").click();
    await expect(page.locator(".workbench-activity-detail")).toContainText(
      "工具结果可见",
    );
    emit("assistant", {
      type: "assistant",
      uuid: "thinking-final",
      message: {
        id: "thinking-final",
        content: [
          { type: "thinking", thinking: "活动思考内容" },
          {
            type: "future_cli_block",
            payload: { raw: "不可解析结构保留", long: "x".repeat(500) },
          },
          { type: "text", text: "活动区最终回答" },
        ],
      },
    });
    await expect(page.locator(".workbench-activity-summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.locator(".workbench-activity-summary").press("Enter");
    await expect(page.locator(".workbench-activity summary")).toHaveText([
      /Read/,
      /reasoning/,
      /future_cli_block/,
    ]);
    await page
      .locator(".workbench-activity summary")
      .filter({ hasText: "reasoning" })
      .click();
    await expect(
      page
        .locator(".workbench-activity-detail")
        .filter({ hasText: "活动思考内容" }),
    ).toBeVisible();
    await page
      .locator(".workbench-activity summary")
      .filter({ hasText: "future_cli_block" })
      .click();
    await expect(
      page
        .locator(".workbench-activity-detail")
        .filter({ hasText: "不可解析结构保留" }),
    ).toBeVisible();
    snapshotEvents = [...allEvents];
    service.sessionEvent(env.id, { executionId, status: "completed" });
    snapshotStatus = "completed";
    await page.setViewportSize({ width: 390, height: 844 });
    // 竖屏恢复抽屉导航，正文不再为一级图标栏预留宽度。
    await expect(page.locator(".rail")).toBeHidden();
    await page.screenshot({ path: ".vibe/session-mobile.png", fullPage: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
    await checkSessionDrawer(page, "会话列表");
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

    const routeBefore = page.url();
    await card.dispatchEvent("pointerdown", {
      button: 0,
      clientX: 50,
      clientY: 100,
      pointerType: "touch",
    });
    await expect(
      page.getByRole("menuitem", { name: "多选", exact: true }),
    ).toBeVisible();
    await card.dispatchEvent("pointerup", { button: 0 });
    await card.dispatchEvent("click");
    expect(page.url()).toBe(routeBefore);
    // 合成触摸事件不保证键盘焦点，明确从菜单选项验证 Escape 关闭。
    await page.getByRole("menuitem").first().press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: /^会话操作：/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "多选", exact: true }).click();
    await page
      .getByRole("button", { name: /^会话操作：/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "多选", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "全选当前列表", exact: true })
      .check();
    await page.getByRole("button", { name: "全部归档", exact: true }).click();
    await page.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect
      .poll(() => store.list("sessions").every((s) => s.archived))
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
    await page
      .getByRole("button", { name: "全部取消归档", exact: true })
      .click();
    await page.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect
      .poll(() => store.list("sessions").every((s) => !s.archived))
      .toBe(true);
    await page
      .getByRole("button", { name: "返回最近会话", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^会话操作：/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "多选", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "全选当前列表", exact: true })
      .check();
    await page.getByRole("button", { name: "全部删除", exact: true }).click();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(store.list("sessions").length).toBe(2);
    await page.getByRole("button", { name: "全部删除", exact: true }).click();
    await page.getByRole("button", { name: "确认操作", exact: true }).click();
    await expect.poll(() => store.list("sessions").length).toBe(0);
    await expect(
      page.getByRole("heading", { name: "选择会话，开始协作" }),
    ).toBeVisible();
    store.remove("agents", initialAgent.id);
    store.remove("agents", configAgent.id);
    await page.reload();
    const newSession = page.getByRole("button", {
      name: "新建会话：测试项目",
      exact: true,
    });
    await newSession.click();
    const notice = page.getByRole("dialog");
    await expect(notice).toContainText("暂无适用的智能体");
    await notice.getByRole("button", { name: "新建智能体" }).click();
    await notice.getByLabel("名称", { exact: true }).fill("新职责");
    await notice.getByRole("button", { name: "保存配置" }).click();
    await expect(notice).toHaveCount(0);
    await newSession.click();
    await expect(
      page.getByRole("option", { name: "新职责", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    expect(store.list("sessions")).toHaveLength(0);
    const agent = service.save("agents", {
      name: "项目助手",
      environmentId: env.id,
      instructions: "测试职责",
      injection: "append",
    });
    const sameName = service.save("agents", {
      name: agent.name,
      instructions: "系统级测试职责",
    });
    const broken = service.save("agents", {
      name: "头像加载失败",
      avatar: "data:image/png;base64,AA==",
      supportedRuntimes: ["codex"],
    });
    const singleEnv = store.put("environments", {
      name: "单目标环境",
      approved: true,
      roots: [],
      enabledRuntimes: ["codex"],
    });
    service.peers.set(singleEnv.id, peer as any);
    const single = service.save("projects", {
      name: "单目标",
      directories: [
        { environmentId: singleEnv.id, rootId: "root", relativePath: "." },
      ],
    });
    const longName = "LongAgentName".repeat(7);
    const withAvatar = service.save("agents", {
      name: longName,
      avatar: presetAvatar,
      environmentId: singleEnv.id,
    });
    const updated = store.get("projects", project.id);
    service.save(
      "projects",
      {
        ...updated,
        directories: [
          ...updated.directories,
          {
            environmentId: env.id,
            rootId: "root",
            relativePath: "nested/project",
          },
        ],
      },
      project.id,
      updated.version,
    );
    await page.reload();
    const trigger = page.getByRole("button", {
      name: "新建会话：测试项目",
      exact: true,
    });
    const multiAgent = page.getByRole("option", {
      name: agent.name + " · " + agent.id,
      exact: true,
    });
    await trigger.click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(multiAgent.locator(".identity-avatar")).toHaveText("项");
    await expect(page.getByRole("option", { name: "默认职责" })).toHaveCount(0);
    await expect(
      page
        .getByRole("option", { name: broken.name, exact: true })
        .locator(".identity-avatar"),
    ).toHaveText("头");
    await multiAgent.click();
    const target = page.getByRole("listbox");
    await expect(
      target.getByRole("option", { name: /Claude Code/ }).first(),
    ).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(multiAgent).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(store.list("sessions")).toHaveLength(0);
    await trigger.click();
    await multiAgent.click();
    for (const name of ["Claude Code", "Codex"]) {
      const cli = target.getByRole("option", { name, exact: true });
      await expect(cli).toHaveText(name);
      await expect(cli.locator("svg")).toHaveCount(1);
    }
    await target.getByRole("option", { name: "Claude Code", exact: true }).click();
    await page.keyboard.press("ArrowLeft");
    await expect(target.getByRole("option", { name: "Claude Code", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await target
      .getByRole("option", {
        name: "隔离环境 · root / nested/project",
        exact: true,
      })
      .click();
    await expect.poll(() => store.list("sessions").length).toBe(1);
    const created = store.list("sessions")[0];
    expect(created.relativePath).toBe("nested/project");
    expect(created.agentId).toBe(agent.id);
    expect(created.runtime).toBe("claude");
    expect(created.permission).toBe("ask");
    expect(created.rootId).toBe("root");
    await expect(page).toHaveURL(new RegExp("chat/" + created.id));
    await page.screenshot({
      path: ".vibe/session-menu-desktop.png",
      fullPage: true,
    });
    // root Claude 的完全权限保持可见且不可提交，键盘可选自动审批。
    const permissionNotice = page.locator(".composer").getByRole("note");
    await expect(permissionNotice).toHaveCount(0);
    await page.getByRole("button", { name: "会话权限", exact: true }).click();
    await expect(page.getByRole("option", { name: "完全权限", exact: true })).toBeDisabled();
    await page.getByRole("option", { name: "自动审批", exact: true }).press("Enter");
    await expect.poll(() => store.get("sessions", created.id).permission).toBe("auto");
    await expect(permissionNotice).toHaveCount(0);
    expect(created.agentId).not.toBe(sameName.id);
    const singleTrigger = page.getByRole("button", {
      name: "新建会话：单目标",
      exact: true,
    });
    const singleOption = page.getByRole("option", {
      name: longName,
      exact: true,
    });
    await singleTrigger.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("End");
    await expect(singleOption).toBeFocused();
    await expect(singleOption.locator("img")).toHaveAttribute("src", presetAvatar);
    await page.keyboard.press("Enter");
    await expect.poll(() => store.list("sessions").length).toBe(2);
    const keyboardSession = store
      .list("sessions")
      .find((s) => s.id !== created.id)!;
    await expect(page).toHaveURL(base + "/#chat/" + keyboardSession.id);
    expect(keyboardSession).toMatchObject({
      agentId: withAvatar.id,
      projectId: single.id,
      runtime: "codex",
      environmentId: singleEnv.id,
      rootId: "root",
      relativePath: ".",
    });

    const mobile = await page
      .context()
      .browser()!
      .newContext({
        hasTouch: true,
        isMobile: true,
        viewport: { width: 320, height: 700 },
      });
    try {
      await mobile.addCookies([
        { name: "relay_session", value: cookie, url: base },
      ]);
      const phone = await mobile.newPage();
      service.saveLanguage({ preference: "en" });
      await phone.goto(base + "/#chat");
      for (const theme of ["light", "dark", "bug"]) {
        await phone.evaluate(
          (theme) => localStorage.setItem("relay-theme", theme),
          theme,
        );
        await phone.reload();
        await expect(phone.locator("html")).toHaveAttribute(
          "data-theme",
          theme,
        );
        await phone.getByRole("button", { name: /New session:.*单目标/ }).tap();
        const option = phone.getByRole("option", {
          name: longName,
          exact: true,
        });
        await expect(option.locator("img")).toBeVisible();
        await expect(
          phone.getByRole("option", { name: "Default role", exact: true }),
        ).toHaveCount(0);
        expect(
          await option.evaluate(
            (el) => el.scrollWidth <= el.clientWidth && el.clientHeight > 44,
          ),
        ).toBe(true);
        await phone.screenshot({
          path: `.vibe/session-agent-picker-320-${theme}.png`,
        });
        if (theme === "bug") await option.tap();
      }
      await expect.poll(() => store.list("sessions").length).toBe(3);
      const touchSession = store
        .list("sessions")
        .find((s) => s.id !== created.id && s.id !== keyboardSession.id)!;
      await expect(phone).toHaveURL(base + "/#chat/" + touchSession.id);
      expect(touchSession).toMatchObject({
        agentId: withAvatar.id,
        projectId: single.id,
        runtime: "codex",
        environmentId: singleEnv.id,
      });
      // 英文触屏会话同样通过真实控件保存，刷新后仍带入同一权限。
      await phone.getByRole("button", { name: "Session permission", exact: true }).tap();
      await phone.getByRole("option", { name: "Auto-approve", exact: true }).tap();
      await expect.poll(() => store.get("sessions", touchSession.id).permission).toBe("auto");
      await phone.reload();
      await phone.getByRole("button", { name: "Session permission", exact: true }).tap();
      await expect(phone.getByRole("option", { name: "Auto-approve" })).toHaveAttribute("aria-selected", "true");
      await phone.keyboard.press("Escape");
      await phone.goto(base + "/#chat");
      const projectTrigger = phone.getByRole("button", {
        name: /New session:.*测试项目/,
      });
      await projectTrigger.tap();
      const parent = phone.getByRole("option", {
        name: agent.name + " · " + agent.id,
        exact: true,
      });
      await parent.tap();
      await phone.getByRole("button", { name: "Back to agents" }).tap();
      await expect(parent).toBeFocused();
      await parent.tap();
      await phone.getByRole("option", { name: "Claude Code", exact: true }).tap();
      await phone
        .getByRole("option", {
          name: "隔离环境 · root / nested/project",
        })
        .tap();
      await expect.poll(() => store.list("sessions").length).toBe(4);
      await expect
        .poll(
          () =>
            store
              .list("sessions")
              .filter(
                (s) =>
                  s.agentId === agent.id &&
                  s.runtime === "claude" &&
                  s.relativePath === "nested/project",
              ).length,
        )
        .toBe(2);
    } finally {
      await mobile.close();
    }
    expect(allEvents.length).toBeGreaterThan(10);
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 在真实页面验证跨项目最近工作、项目固定分组、用户时间排序及手机长标题。 */
test("会话按用户消息排序且最近工作标题单行省略", async ({ page, context }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-order-browser-"));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const { app, store, service } = await createApp({
    dataDir: dir,
    publicUrl: `http://127.0.0.1:${port}`,
    webDir: resolve("dist/web"),
    secureCookie: false,
  });
  const cookie = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const first = store.put("projects", { name: "固定项目一", directories: [] });
  const second = store.put("projects", { name: "固定项目二", directories: [] });
  const longTitle = "最新项目会话" + "非常长的中文标题".repeat(30);
  const rows = [
    {
      title: "项目一旧会话",
      projectId: first.id,
      lastUserMessageAt: "2026-01-01T00:00:00Z",
    },
    {
      title: longTitle,
      projectId: second.id,
      lastUserMessageAt: "2026-01-03T00:00:00Z",
    },
    {
      title: "项目一新会话",
      projectId: first.id,
      lastUserMessageAt: "2026-01-02T00:00:00Z",
    },
  ];
  const saved = rows.map((row) =>
    store.put("sessions", { ...row, status: "completed" }),
  );
  store.put("sessions", { title: rows[0].title }, saved[0].id);
  store.put("workbench", {
    title: "工作台旧会话",
    lastUserMessageAt: rows[0].lastUserMessageAt,
    transcript: [],
    status: "completed",
  });
  store.put("workbench", {
    title: "工作台新会话",
    lastUserMessageAt: rows[2].lastUserMessageAt,
    transcript: [],
    status: "completed",
  });
  const address = await app.listen({ host: "0.0.0.0", port });
  const base = address.replace("0.0.0.0", "127.0.0.1");
  try {
    await context.addCookies([
      { name: "relay_session", value: cookie, url: base },
    ]);
    await page.goto(base + "/#workbench");
    await expect(page.locator(".recent-title")).toHaveText([
      longTitle,
      "项目一新会话",
    ]);
    await expect(page.locator(".session-entry")).toHaveCount(2);
    await expect(page.locator(".session-entry").first()).toContainText(
      "工作台新会话",
    );
    await page.goto(base + "/#chat");
    await expect(page.locator(".project-group summary strong")).toHaveText([
      first.name,
      second.name,
    ]);
    await expect(
      page.locator(".project-group").first().locator(".session-entry").first(),
    ).toContainText("项目一新会话");
    await page.goto(base + "/#workbench");
    await page.setViewportSize({ width: 390, height: 844 });
    const title = page.locator(".recent-title").first();
    await expect(title).toBeVisible();
    expect(
      await title.evaluate((el) => {
        const css = getComputedStyle(el);
        return (
          css.whiteSpace === "nowrap" &&
          css.textOverflow === "ellipsis" &&
          el.scrollWidth > el.clientWidth
        );
      }),
    ).toBe(true);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 真实服务端交接与 SSE；原生状态用隔离 RPC 控制，不调用供应商模型。 */
test("交接后原生结束与重连校正即时同步会话", async ({ page, context }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-handoff-status-"));
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((done) => probe.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  const { app, store, service } = await createApp({
    dataDir: dir,
    publicUrl: base,
    webDir: resolve("dist/web"),
    secureCookie: false,
  });
  const cookie = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const env = store.put("environments", {
    name: "隔离环境",
    approved: true,
    roots: [],
    capabilities: ["stage-handoff-short-id-v1"],
  });
  const project = service.save("projects", {
    name: "交接项目",
    directories: [{ environmentId: env.id, rootId: "root", relativePath: "." }],
  });
  const first = randomUUID(),
    done = randomUUID();
  const board = service.save("boards", {
    name: "交接看板",
    projectId: project.id,
    stages: [
      {
        id: randomUUID(),
        fixedRole: "start",
        name: "未开始",
        type: "human",
        targets: [first],
      },
      {
        id: first,
        name: "执行",
        type: "agent",
        agentId: service.save("agents", { name: "Fixture agent" }).id,
        targets: [done],
        environmentId: env.id,
        rootId: "root",
      },
      { id: done, name: "完成", type: "done", targets: [] },
    ],
  });
  let nativeStatus = "running";
  let interactions: any[] = [];
  let reads = 0;
  const peer = {
    call: async (method: string) => {
      if (method === "session.history") {
        reads++;
        return { events: [], status: nativeStatus, interactions };
      }
      return {
        status: method === "execution.prepare" ? "queued" : nativeStatus,
        stateVersion: 4,
      };
    },
    close: () => {},
  };
  service.peers.set(env.id, peer as any);
  const item = service.createItem({
    boardId: board.id,
    startStageId: first,
    title: "状态同步",
  });
  const row = store.get("items", item.id);
  const execution = service.execution(row.executionId);
  service.setState(execution.id, "running", 1);
  await app.listen({ host: "127.0.0.1", port });
  await context.addCookies([
    { name: "relay_session", value: cookie, url: base },
  ]);
  try {
    await page.goto(base + "/#chat/" + execution.session_id);
    await expect(page.locator(".session-history-loading")).toHaveCount(0);
    const stop = page.getByRole("button", { name: "停止", exact: true });
    await expect(stop).toBeEnabled();
    const permission = page.getByRole("button", { name: "会话权限", exact: true });
    await expect(permission).toBeDisabled();
    expect((await permission.boundingBox())!.x).toBeLessThan((await stop.boundingBox())!.x);
    service.submitHandoff(
      item.id,
      "S3",
      "交接完成",
      randomUUID(),
      execution.id,
    );
    await expect(stop).toBeVisible();
    expect(store.get("sessions", execution.session_id).status).toBe("running");
    nativeStatus = "completed";
    service.sessionEvent(env.id, {
      executionId: execution.id,
      status: "completed",
      stateVersion: 2,
      interactions: [],
    });
    await expect(stop).toHaveCount(0, { timeout: 1500 });
    // 模拟旧版本遗留索引；重连只发 execution-state，不发送 update。
    store.put("sessions", { status: "running" }, execution.session_id);
    nativeStatus = "running";
    interactions = [
      {
        id: "approval",
        executionId: execution.id,
        method: "native-approval",
        params: {},
      },
    ];
    await page.reload();
    await expect(stop).toBeVisible();
    await expect(page.locator(".approval")).toBeVisible();
    nativeStatus = "completed";
    interactions = [];
    const before = reads;
    await service.reconcile(env.id, peer as any);
    await expect(stop).toHaveCount(0, { timeout: 1500 });
    await expect(page.locator(".approval")).toHaveCount(0, { timeout: 1500 });
    await expect.poll(() => reads, { timeout: 1500 }).toBeGreaterThan(before);
    expect(store.get("items", item.id).stageId).toBe(done);
    // 浏览器拒绝不属于当前执行的迟到状态，服务端拒绝旧版本和重复确认。
    service.sessionEvents.emit(execution.session_id, {
      type: "execution-state",
      executionId: "obsolete",
      status: "running",
    });
    service.sessionEvent(env.id, {
      executionId: execution.id,
      status: "running",
      stateVersion: 1,
    });
    service.setState(execution.id, "completed", 4);
    await expect(stop).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator(".session-history-loading")).toHaveCount(0);
    await expect(stop).toHaveCount(0);
    await expect(page.locator(".approval")).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 草稿与服务端顺序分开，真实会话页只在保存成功后更新。 */
test("会话项目紧凑分组与手动排序", async ({ browser }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-project-order-browser-"));
  const config = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(config);
  const context = await browser.newContext({ hasTouch: true, locale: "zh-CN" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const projectNames = ["项目甲", "项目乙", "ProjectLongName".repeat(6)];
  const environment = store.put("environments", { approved: true, name: "测试环境", roots: [{ id: "root", path: "/workspace" }] });
  const projects = projectNames.map((name) =>
    service.save("projects", {
      name,
      directories: [{ environmentId: environment.id, rootId: "root", relativePath: "." }],
    }),
  );
  for (const title of ["旧会话", "新会话"]) {
    service.createSession(
      {
        agentId: service.save("agents", { name: "Fixture agent" }).id,
        title,
        projectId: projects[0].id,
        environmentId: environment.id,
        rootId: "root",
        runtime: "codex",
      },
      false,
    );
  }
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  config.publicUrl = base;
  const signIn = async () => {
    const cookie = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(cookie), "owner", Date.now() + 600000);
    await context.addCookies([{ name: "relay_session", value: cookie, url: base }]);
    await page.goto(base + "/#chat");
  };
  store.put("users", { username: "fixture" }, "owner");
  try {
    await signIn();
    const groups = page.locator(".project-group");
    const groupNames = groups.locator("summary strong");
    await expect(groupNames).toHaveText(projectNames);
    const initialSessions = await groups.first().locator(".session-entry strong").allTextContents();
    expect(initialSessions).toHaveLength(2);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const expanded of [true, false]) {
        const geometry = await groups.evaluateAll((items) => items.map((item) => {
          const group = item.getBoundingClientRect();
          const heading = item.querySelector("summary")!.getBoundingClientRect();
          const add = item.querySelector("summary button")!.getBoundingClientRect();
          return { top: group.top, bottom: group.bottom, headingHeight: heading.height, addWidth: add.width, addHeight: add.height };
        }));
        for (let index = 1; index < geometry.length; index++) {
          expect(geometry[index].top - geometry[index - 1].bottom).toBeLessThanOrEqual(8);
        }
        if (width === 390) {
          for (const item of geometry) {
            expect(Math.min(item.headingHeight, item.addWidth, item.addHeight)).toBeGreaterThanOrEqual(44);
          }
        }
        for (const summary of await groups.locator("summary").all()) {
          const group = summary.locator("..");
          if (expanded) await expect(group).toHaveAttribute("open", "");
          else await expect(group).not.toHaveAttribute("open");
          await summary.click({ position: { x: 16, y: 16 } });
        }
      }
    }
    const manage = page.getByRole("button", { name: "项目管理", exact: true });
    const dialog = page.getByRole("dialog", { name: "项目管理" });
    const rows = dialog.locator(".project-management-row strong");
    const order = dialog.getByRole("button", { name: "调整顺序" });
    const up = (name: string) => dialog.getByRole("button", { name: `上移「${name}」`, exact: true });
    const down = (name: string) => dialog.getByRole("button", { name: `下移「${name}」`, exact: true });
    const save = dialog.getByRole("button", { name: "保存", exact: true });
    const last = projectNames[2];
    const sorted = [last, ...projectNames.slice(0, 2)];
    await manage.tap();
    await order.press("Enter");
    await expect(up(projectNames[0])).toBeDisabled();
    await expect(down(last)).toBeDisabled();
    await expect(save).toBeDisabled();
    await up(last).press("Enter");
    await expect(up(last)).toBeFocused();
    await up(last).tap();
    await expect(down(last)).toBeFocused();
    await expect(rows).toHaveText(sorted);
    await expect(groupNames).toHaveText(projectNames);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(order).toBeFocused();
    await expect(rows).toHaveText(projectNames);
    await order.click();
    await up(last).click();
    await page.keyboard.press("Escape");
    await expect(manage).toBeFocused();
    await manage.tap();
    await expect(rows).toHaveText(projectNames);
    await order.click();
    await up(last).click();
    await up(last).click();
    const orderUrl = "**/api/projects/order";
    await page.route(orderUrl, (route) => route.fulfill({ status: 503, json: {} }));
    await save.click();
    await expect(dialog.getByRole("alert")).toContainText("HTTP 503");
    await expect(rows).toHaveText(sorted);
    await expect(groupNames).toHaveText(projectNames);
    await page.unroute(orderUrl);
    await save.click();
    await expect(order).toBeFocused();
    await expect(rows).toHaveText(sorted);
    await expect(groupNames).toHaveText(sorted);
    await page.keyboard.press("Escape");
    await expect(manage).toBeFocused();
    const filter = page.getByRole("button", { name: "筛选项目", exact: true });
    await filter.tap();
    await expect(page.getByRole("option")).toHaveText(["全部项目", ...sorted]);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(groupNames).toHaveText(sorted);
    await context.clearCookies();
    await signIn();
    await expect(groupNames).toHaveText(sorted);
    await expect(groups.nth(1).locator(".session-entry strong")).toHaveText(initialSessions);

    // 通过真实项目端点变更成员，再检查已保存的相对顺序。
    service.peers.set(environment.id, {
      call: async (method: string) =>
        method === "directory.ensure" ? { ok: true } : {},
      close() {},
    } as any);
    const projectPath = base + "/api/projects";
    const created = await page.request.post(projectPath, {
      headers: { origin: base },
      data: { name: "新增项目", directories: projects[0].directories },
    });
    expect(created.ok()).toBe(true);
    await expect(groupNames).toHaveText([...sorted, "新增项目"]);
    const removed = await page.request.delete(projectPath + "/" + projects[1].id, { headers: { origin: base } });
    expect(removed.ok()).toBe(true);
    await expect(groupNames).toHaveText([last, projectNames[0], "新增项目"]);
    for (const locale of ["zh-CN", "en"]) {
      for (const theme of ["light", "dark", "bug"]) {
        service.saveLanguage({ preference: locale });
        await page.evaluate((theme) => localStorage.setItem("relay-theme", theme), theme);
        await page.reload();
        const managementLabel = locale === "en" ? "Project management" : "项目管理";
        await page.getByRole("button", { name: managementLabel, exact: true }).tap();
        const modal = page.getByRole("dialog", { name: managementLabel });
        await modal.getByRole("button", { name: locale === "en" ? "Adjust order" : "调整顺序", exact: true }).tap();
        const move = modal.getByRole("button", { name: locale === "en" ? `Move “${last}” down` : `下移「${last}」` });
        await expect(move).toBeEnabled();
        const hit = (await move.boundingBox())!;
        expect(Math.min(hit.width, hit.height)).toBeGreaterThanOrEqual(44);
        expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        await page.screenshot({ path: `.vibe/audit/project-order-${theme}-${locale}.png` });
        await page.keyboard.press("Escape");
        await expect(modal).toHaveCount(0);
      }
    }
    for (const id of [projects[2].id, (await created.json()).id]) {
      const deleted = await page.request.delete(projectPath + "/" + id, { headers: { origin: base } });
      expect(deleted.ok()).toBe(true);
    }
    await expect(groupNames).toHaveText([projectNames[0]]);
    await page.getByRole("button", { name: "Project management", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Adjust order", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
