import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** 隔离真实 HTTP 与数据库，覆盖准入、损失确认、历史缺失和响应丢失。 */
test("看板流程准入与删除确认在三主题和移动端保持一致", async ({
  page,
  context,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "relay-flow-ui-"));
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
      name: "流程测试",
      directories: [],
    });
    const first = randomUUID(),
      old = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "流程测试",
      projectId: project.id,
      stages: [
        {
          id: first,
          fixedRole: "start",
          name: "起点",
          type: "human",
          targets: [old, done],
        },
        { id: old, name: "旧阶段", type: "human", targets: [done] },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    const item = service.createItem({
      boardId: board.id,
      title: "历史工作项",
      content: "正文保留",
    });
    store.put("items", { stageId: old, archived: true }, item.id);
    store.put("handoffs", {
      itemId: item.id,
      from: first,
      to: old,
      record: "将丢失",
      artifacts: [{ id: randomUUID() }],
    });
    store.put("handoffs", {
      itemId: item.id,
      from: first,
      to: done,
      record: "应保留",
      artifacts: [],
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
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await expect(
      page.getByText("当前可编辑流程", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: /S2 · 旧阶段/ }).click();
    await page.getByRole("button", { name: "移除", exact: true }).click();
    const save = page.getByRole("button", { name: "保存流程", exact: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await save.click();
        const dialog = page.getByRole("dialog", {
          name: "确认删除阶段及历史损失",
        });
        await expect(dialog).toContainText(
          "影响 1 个工作项、1 条交接记录、1 个产物",
        );
        await expect(dialog).toContainText("原下载入口将不可访问");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `.vibe/flow-${theme}-${width}.png`,
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(save).toBeFocused();
        expect(store.get("boards", board.id).version).toBe(1);
        expect(store.list("handoffs")).toHaveLength(2);
      }
    }
    // 保存竞争：新增在途项后拒绝旧草稿，保留已删除的阶段草稿。
    // 在提交发出后制造竞争，避免后台轮询先禁用按钮而无法测试服务端重验。
    let blocker: any;
    await page.route(
      `**/api/boards/${board.id}/flow-preview`,
      async (route) => {
        blocker = service.createItem({
          boardId: board.id,
          title: "不可见阻塞项",
        });
        await route.continue();
      },
    );
    await save.click();
    await expect(page.getByRole("alert")).toContainText("须保留出口");
    await expect(
      page.getByRole("status").filter({ hasText: "1 个在途工作项" }),
    ).toBeVisible();
    await expect(page.locator("[data-flow-stage]")).toHaveCount(2);
    await page.unroute(`**/api/boards/${board.id}/flow-preview`);
    service.archiveItem(blocker.id, true);
    await page.getByRole("button", { name: "重新检查编辑条件" }).click();
    await expect(
      page.getByText("当前可编辑流程", { exact: false }),
    ).toBeVisible();
    await save.click();
    // 确认期间新增历史，服务端必须要求重新评估。
    store.put("handoffs", {
      itemId: item.id,
      from: old,
      to: done,
      record: "后到历史",
      artifacts: [],
    });
    await page.getByRole("button", { name: "接受损失并保存" }).click();
    await expect(page.getByRole("alert")).toContainText("重新保存以评估并确认");
    await save.click();
    await expect(page.getByRole("dialog")).toContainText("2 条交接记录");
    // 服务端写成功但响应丢失；重放同一 operationId 不重复副作用。
    let dropped = false;
    await page.route(`**/api/boards/${board.id}`, async (route) => {
      if (route.request().method() === "PUT" && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await page.getByRole("button", { name: "接受损失并保存" }).click();
    await expect(page.getByRole("alert")).toContainText("保存结果尚未确认");
    await page.getByRole("button", { name: "核实并重试原保存" }).click();
    await expect(
      page.getByRole("checkbox", { name: "显示归档" }),
    ).toBeVisible();
    expect(store.get("boards", board.id).version).toBe(2);
    expect(store.list("handoffs")).toHaveLength(1);
    await page.getByRole("checkbox", { name: "显示归档" }).check();
    await page
      .getByRole("heading", { name: "历史工作项", exact: true })
      .click();
    const detail = page.locator(".item-detail");
    await expect(detail).toContainText("原阶段已删除");
    await expect(detail).toContainText("历史记录不完整");
    await expect(detail).toContainText("正文保留");
    await expect(detail).toContainText("应保留");
    await expect(
      detail.getByRole("button", { name: "恢复", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await expect(save).toBeDisabled();
    await page.getByRole("button", { name: "添加阶段", exact: true }).click();
    await save.click();
    await expect(page.getByText("流程已更新", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await page.getByRole("button", { name: /S4 · 新阶段/ }).click();
    await page.getByRole("button", { name: "移除", exact: true }).click();
    await save.click();
    await expect(page.getByRole("dialog")).toContainText("无交接记录受影响");
    await page
      .getByRole("button", { name: "取消，继续编辑", exact: true })
      .click();
    const current = store.get("boards", board.id);
    service.save(
      "boards",
      { ...current, name: "其他入口更新" },
      board.id,
      current.version,
    );
    await save.click();
    await expect(page.getByRole("alert")).toContainText("版本");
    await expect(page.locator("[data-flow-stage]")).toHaveCount(2);
    // 重新进入读取最新版本；有在途项仍允许新增阶段和改标题。
    service.archiveItem(blocker.id, false);
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload();
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "添加阶段", exact: true }),
    ).toBeEnabled();
    await page.locator(`[data-flow-stage="${first}"]`).click();
    await expect(page.getByRole("checkbox", { name: /完成/ })).toBeDisabled();
    await page.getByLabel("阶段名称", { exact: true }).fill("进行中的起点");
    await page.getByLabel("名称", { exact: true }).fill("阻塞时独立改名");
    await save.click();
    await expect
      .poll(() => store.get("boards", board.id).name)
      .toBe("阻塞时独立改名");
    expect(store.get("boards", board.id).stages[0].name).toBe("进行中的起点");
    expect(store.get("items", blocker.id).stageId).toBe(first);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/** 真实 API 编号与响应丢失重放；历史描述不跟随当前名称漂移。 */
test("阶段短编号展示、草稿与复制重放", async ({ page, context }) => {
  const dir = await mkdtemp(join(tmpdir(), "relay-short-id-ui-"));
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
      name: "编号测试",
      directories: [],
    });
    const first = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "编号测试",
      projectId: project.id,
      stages: [
        {
          id: first,
          fixedRole: "start",
          name: "同名阶段",
          type: "human",
          targets: [done],
        },
        { id: done, name: "同名阶段", type: "done", targets: [] },
      ],
    });
    const item = service.createItem({
      boardId: board.id,
      title: "编号工作项",
      content: "真实接口",
    });
    store.put("handoffs", {
      itemId: item.id,
      from: first,
      to: done,
      fromStage: { id: first, shortId: "S1", name: "历史名称", type: "human" },
      toStage: { id: done, shortId: "S2", name: "旧终点", type: "done" },
      record: "原始历史",
      artifacts: [],
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    config.publicUrl = base;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: base },
    ]);
    await page.goto(base + "/#board/" + board.id);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await expect(
          page.locator(".column-title").filter({ hasText: "S1 · 同名阶段" }),
        ).toBeVisible();
      }
    }
    await page.getByRole("button", { name: /编号工作项/ }).click();
    await expect(page.getByText("S1 · 历史名称 → S2 · 旧终点")).toBeVisible();
    const target = page.getByRole("button", { name: "目标阶段", exact: true });
    await target.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("option", { name: "S2 · 同名阶段" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.goto(base + "/#board/" + board.id);
    // 服务端已成功但响应丢失，第二次点击必须复用同一操作编号。
    const operations: string[] = [];
    await page.route("**/api/boards/" + board.id + "/copy", async (route) => {
      operations.push(route.request().postDataJSON().operationId);
      const response = await route.fetch();
      if (operations.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await page
      .locator(".ui-board-toolbar")
      .getByRole("button", { name: "更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "配置副本", exact: true }).click();
    await expect.poll(() => operations.length).toBe(1);
    await page
      .locator(".ui-board-toolbar")
      .getByRole("button", { name: "更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "配置副本", exact: true }).click();
    await expect.poll(() => operations.length).toBe(2);
    expect(operations[0]).toBe(operations[1]);
    expect(store.list("boards").length).toBe(2);
    store.put("items", { archived: true }, item.id);
    await page.reload();
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /S1 · 同名阶段/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /添加阶段/ }).click();
    await expect(
      page.getByRole("heading", { name: /保存后分配编号/ }),
    ).toBeVisible();
    await page.locator(".language-control .select-trigger").click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await page
      .getByLabel("Stage name", { exact: true })
      .fill("Long stage name");
    await expect(
      page.getByRole("heading", { name: /Number assigned after saving/ }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/** 固定身份、双语草稿、真实保存及默认入口一起验收。 */
test("固定起点改名、保护、默认选择与空目标", async ({ page, context }) => {
  const dir = await mkdtemp(join(tmpdir(), "relay-fixed-start-ui-"));
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
      name: "固定入口",
      directories: [],
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    config.publicUrl = `http://127.0.0.1:${(app.server.address() as any).port}`;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: config.publicUrl },
    ]);
    await page.goto(config.publicUrl + "/#board");
    await page.getByRole("button", { name: "新建看板", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("固定节点验收");
    await page.getByRole("button", { name: "所属项目", exact: true }).click();
    await page.getByRole("option", { name: project.name, exact: true }).click();
    await page.getByRole("button", { name: "创建看板", exact: true }).click();
    await expect.poll(() => store.list("boards").length).toBe(1);
    const board = store.list("boards")[0];
    expect(board.stages.map((s: any) => s.nameKey)).toEqual([
      "board.stage.notStarted",
      "board.stage.done",
    ]);
    await page.goto(config.publicUrl + "/#board/" + board.id);
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    const startCard = page.locator(`[data-flow-stage="${board.stages[0].id}"]`);
    const endCard = page.locator(`[data-flow-stage="${board.stages[1].id}"]`);
    const stageName = (label = "阶段名称") =>
      page.getByLabel(label, { exact: true });
    await startCard.click();
    await expect(stageName()).toHaveValue("未开始");
    await expect(
      page.getByRole("button", { name: "阶段类型", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /移除|上移|下移/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /添加阶段/ }).click();
    await expect(
      page.getByRole("button", { name: "上移", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "移除", exact: true }).click();
    const language = async (name: string) => {
      await page.locator(".language-control .select-trigger").click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    await startCard.click();
    await language("English");
    await expect(stageName("Stage name")).toHaveValue("Not started");
    await stageName("Stage name").fill("未开始");
    await language("简体中文");
    await endCard.click();
    await stageName().fill("验收完成");
    await startCard.click();
    await page.getByRole("checkbox", { name: /验收完成/ }).click();
    await page.getByRole("button", { name: "保存流程", exact: true }).click();
    await expect.poll(() => store.get("boards", board.id).version).toBe(2);
    const saved = store.get("boards", board.id);
    expect(saved.stages[0].nameKey).toBeUndefined();
    expect(saved.stages[0].targets).toEqual([]);
    expect(saved.stages[0].id).toBe(board.stages[0].id);
    await page.reload();
    await language("English");
    await expect(page.locator(".column-title").first()).toContainText("未开始");
    await language("简体中文");
    await page.getByRole("button", { name: "新建工作项", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "起始阶段", exact: true }),
    ).toContainText("未开始");
    await dialog.getByRole("button", { name: "起始阶段", exact: true }).click();
    await page.getByRole("option", { name: /验收完成/ }).click();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "新建工作项", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "起始阶段", exact: true }),
    ).toContainText("未开始");
    await dialog.getByLabel("标题", { exact: true }).fill("等待人工");
    await dialog
      .getByRole("button", { name: "创建工作项", exact: true })
      .click();
    await expect.poll(() => store.list("items").length).toBe(1);
    expect(store.list("items")[0].stageId).toBe(board.stages[0].id);
    expect(store.list("executions")).toHaveLength(0);
    expect(store.list("sessions")).toHaveLength(0);
    await page.getByRole("button", { name: /等待人工/ }).click();
    await expect(page.getByRole("dialog")).toContainText("无允许推进目标");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/** 跨阶段草稿、连线方向和窄屏返回位置通过真实看板接口验收。 */
test("总览突出有向关系，整页校验定位隐藏字段并保留草稿", async ({
  page,
  context,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "relay-flow-diagram-"));
  const config = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(config);
  try {
    store.put("users", { username: "fixture" }, "owner");
    service.saveLanguage({ preference: "zh-CN" });
    const cookie = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(cookie), "owner", Date.now() + 600000);
    const start = randomUUID(),
      first = randomUUID(),
      second = randomUUID(),
      done = randomUUID();
    const longName = "阶段全名".repeat(18);
    const project = service.save("projects", {
      name: "路线测试",
      directories: [],
    });
    const board = service.save("boards", {
      name: "路线测试",
      projectId: project.id,
      stages: [
        {
          id: start,
          fixedRole: "start",
          name: "起点",
          type: "human",
          targets: [first, done],
        },
        { id: first, name: longName, type: "human", targets: [second] },
        { id: second, name: longName, type: "human", targets: [first, done] },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: randomUUID(),
          name: `人工阶段 ${index + 1}`,
          type: "human",
          targets: [],
        })),
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    config.publicUrl = `http://127.0.0.1:${(app.server.address() as any).port}`;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: config.publicUrl },
    ]);
    const url = config.publicUrl + "/#board/" + board.id;
    const tab = page.getByRole("button", { name: "流程配置", exact: true });
    const card = (id: string) => page.locator(`[data-flow-stage="${id}"]`);
    const edge = (from: string, to: string) =>
      page.locator(`[data-from="${from}"][data-to="${to}"]`);
    const name = page.getByLabel("阶段名称", { exact: true });
    const save = page.getByRole("button", { name: "保存流程", exact: true });
    const heading = page.locator("[data-flow-heading]");
    await page.goto(url);
    await page.route("**/api/boards/*/editability", (route) => route.abort());
    await tab.click();
    await expect(
      page.getByText("无法检查流程编辑条件。", { exact: true }),
    ).toBeVisible();
    await page.unroute("**/api/boards/*/editability");
    await page.getByRole("button", { name: "重新检查编辑条件" }).click();
    await expect(
      page.getByText("当前可编辑流程", { exact: false }),
    ).toBeVisible();
    await expect(heading).toHaveCount(0);
    await expect(page.locator("[data-relation]")).toHaveCount(5);
    expect(
      (await page.locator(".ui-flow-tracks > svg").boundingBox())?.height,
    ).toBeGreaterThan(400);
    await expect(edge(second, first)).toHaveAttribute(
      "stroke-dasharray",
      "4 3",
    );
    await card(first).focus();
    await page.keyboard.press("Enter");
    await expect(heading).toBeFocused();
    await expect(edge(start, first)).toHaveAttribute(
      "data-relation",
      "incoming",
    );
    await expect(edge(first, second)).toHaveAttribute(
      "data-relation",
      "outgoing",
    );
    await expect(edge(start, done)).toHaveAttribute("data-relation", "muted");
    await name.clear();
    await card(second).click();
    await name.fill("复核");
    await page.getByRole("checkbox", { name: "S1 · 起点" }).check();
    await expect(edge(second, start)).toHaveCount(1);
    await save.click();
    await expect(heading).toContainText("S2");
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await name.fill(longName);
    await card(second).click();
    await expect(name).toHaveValue("复核");
    await page.getByRole("button", { name: "上移", exact: true }).click();
    await expect(edge(second, start)).toHaveCount(1);
    await page.getByRole("button", { name: "工作项", exact: true }).click();
    const discard = page.getByRole("dialog", {
      name: "放弃未保存的流程修改？",
    });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "取消，继续编辑" }).click();
    await expect(name).toHaveValue("复核");
    await save.click();
    await expect(page.getByText("流程已更新", { exact: true })).toBeVisible();
    expect(store.get("boards", board.id).stages[1].targets).toContain(start);
    await page.reload();
    await tab.click();
    await expect(card(second)).toContainText("复核");
    await expect(edge(second, start)).toHaveCount(1);
    await card(first).click();
    for (const theme of ["light", "dark", "bug"]) {
      const control = page.getByRole("button", {
        name: { light: "浅色主题", dark: "深色主题", bug: "BUG主题" }[theme],
        exact: true,
      });
      await control.click();
      await expect(control).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({
        path: `.vibe/diagram-${theme}-desktop.png`,
        animations: "disabled",
      });
    }
    await page.getByRole("button", { name: "返回流程总览" }).click();
    await page.setViewportSize({ width: 390, height: 760 });
    await expect(card(first)).toContainText(longName);
    await expect(card(second).locator("[data-flow-targets]")).toBeVisible();
    await card(done).scrollIntoViewIfNeeded();
    const position = await card(done).boundingBox();
    await card(done).click();
    await expect(heading).toContainText("完成");
    await expect(save).toBeInViewport();
    await page.screenshot({ path: ".vibe/diagram-mobile.png" });
    await page.getByRole("button", { name: "返回流程总览" }).click();
    await expect(card(done)).toBeFocused();
    expect((await card(done).boundingBox())!.y).toBeCloseTo(position!.y, 0);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
