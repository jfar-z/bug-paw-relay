import { createServer } from "node:net";
import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** 真实页面验证配置持久化，以及三个选择入口的 CLI 与环境联合过滤。 */
test("适用 CLI 配置、新建会话、会话切换与看板过滤", async ({
  page,
  context,
}) => {
  page.setDefaultTimeout(15000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dir = mkdtempSync(join(tmpdir(), "relay-cli-browser-"));
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
  const env = store.put("environments", {
    name: "测试环境",
    approved: true,
    roots: [],
    capabilities: ["runtime-options-v1"],
  });
  const other = store.put("environments", { name: "其他环境" });
  service.peers.set(env.id, {
    call: async (method: string) =>
      method === "runtime.catalog"
        ? {
            models: [
              { id: "model-a", name: "model-a", efforts: ["low", "high"] },
              { id: "model-b", name: "model-b", efforts: ["medium"] },
            ],
            defaults: { model: "model-a" },
          }
        : { events: [], interactions: [] },
    close: () => {},
  } as any);
  const directory = {
    environmentId: env.id,
    rootId: "root",
    relativePath: ".",
  };
  const project = service.save("projects", {
    name: "测试项目",
    directories: [directory],
  });
  const common = service.save("agents", { name: "通用智能体" });
  service.save("agents", {
    name: "Claude 专用",
    supportedRuntimes: ["claude"],
  });
  service.save("agents", { name: "其他环境智能体", environmentId: other.id });
  const session = service.createSession({
    title: "测试会话",
    agentId: service.save("agents", { name: "初始职责" }).id,
    projectId: project.id,
    ...directory,
    runtime: "codex",
  });
  const done = randomUUID();
  const board = service.save("boards", {
    name: "测试流程",
    projectId: project.id,
    stages: [
      {
        id: randomUUID(),
        fixedRole: "start",
        name: "未开始",
        type: "human",
        targets: [done],
      },
      {
        id: randomUUID(),
        name: "开发",
        type: "agent",
        targets: [done],
        ...directory,
        runtime: "codex",
        agentId: common.id,
      },
      { id: done, name: "完成", type: "done", targets: [] },
    ],
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await app.listen({ host: "127.0.0.1", port });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  await context.addCookies([
    { name: "relay_session", value: cookie, url: base },
  ]);
  const choose = async (label: string, option: string) => {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  try {
    await page.goto(base + "/#agents");
    await page
      .locator(".agent-list-item")
      .filter({ hasText: "通用智能体" })
      .click();
    await expect(
      page.getByRole("button", { name: "默认权限", exact: true }),
    ).toContainText("询问模式");
    await choose("默认权限", "完全权限");
    await choose("适用 CLI", "指定 CLI");
    await page.getByRole("checkbox", { name: /Claude Code/ }).uncheck();
    await page.getByRole("checkbox", { name: /Codex/ }).uncheck();
    await expect(
      page.getByRole("button", { name: "保存配置", exact: true }),
    ).toBeDisabled();
    await page.getByRole("checkbox", { name: /Codex/ }).check();
    await choose("读取能力的环境", "测试环境");
    await page
      .locator("summary")
      .filter({ hasText: /^Codex$/ })
      .click();
    await expect(page.locator(".runtime-options")).not.toContainText(
      "读取能力中",
    );
    await choose("CLI 模型", "model-a");
    await choose("CLI 思考深度", "high");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    // 记录当前编辑目标，验证保存后刷新仍保留。
    const edited = store
      .list("agents")
      .find(
        (a) =>
          a.supportedRuntimes?.length === 1 &&
          a.supportedRuntimes[0] === "codex",
      )!;
    expect(edited).toBeTruthy();
    expect(edited.defaultPermission).toBe("full");
    expect(edited.runtimeOptions.codex).toMatchObject({
      model: "model-a",
      effort: "high",
    });
    await page.reload();
    await page
      .locator(".agent-list-item")
      .filter({ hasText: "通用智能体" })
      .click();
    await expect(
      page.getByRole("button", { name: "适用 CLI", exact: true }),
    ).toContainText("指定 CLI");
    await expect(
      page.getByRole("button", { name: "默认权限", exact: true }),
    ).toContainText("完全权限");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".vibe/agent-cli-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    // 三主题窄屏下核对新增字段和完全权限提示。
    for (const theme of ["light", "dark", "bug"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const permission = page.getByRole("button", {
        name: "默认权限",
        exact: true,
      });
      await permission.scrollIntoViewIfNeeded();
      await expect(permission).toBeVisible();
      await expect(
        page.locator(".config-editor .permission-danger").last(),
      ).toBeVisible();
      await page.screenshot({ path: `.vibe/permission-${theme}-mobile.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // 独立放入 Codex 专用记录，使筛选断言不依赖列表默认排序。
    const codexOnly = service.save("agents", {
      name: "Codex 专用",
      supportedRuntimes: ["codex"],
    });
    service.save(
      "agents",
      { ...common, supportedRuntimes: null, defaultPermission: "full" },
      common.id,
      store.get("agents", common.id).version,
    );
    // 首目录看不到仅属第二个环境的两条同名配置。
    service.peers.set(other.id, service.peers.get(env.id)!);
    const twins = [0, 1].map(() => service.save("agents", { name: "同名", environmentId: other.id }));
    service.save("projects", { name: "多目录", directories: [directory, { ...directory, environmentId: other.id }] });
    const leading = [twins[1].id, codexOnly.id, twins[0].id, common.id];
    service.saveAgentOrder([...leading, ...service.list("agents").map(a => a.id).filter(id => !leading.includes(id))]);
    await page.goto(base + "/#chat/" + session.id);
    await page.reload();
    await expect(page.locator(".runtime-options")).not.toContainText(
      "读取能力中",
    );
    await choose("CLI 模型", "model-b");
    await choose("CLI 思考深度", "medium");
    await expect
      .poll(() => store.get("sessions", session.id).runtimeOptions?.effort)
      .toBe("medium");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "CLI 模型", exact: true }),
    ).toContainText("model-b");
    await expect(
      page.getByRole("button", { name: "CLI 思考深度", exact: true }),
    ).toHaveAttribute("title", "medium");
    await choose("CLI 模型", "跟随配置");
    await expect
      .poll(() => store.get("sessions", session.id).runtimeOptions?.model)
      .toBe(null);
    await expect(
      page.getByRole("button", { name: "CLI 思考深度", exact: true }),
    ).toHaveAttribute("title", "跟随配置");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".vibe/runtime-options-mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "会话配置", exact: true }).click();
    await page.getByRole("button", { name: "会话 Agent", exact: true }).click();
    await expect(page.getByRole("option").first()).toHaveAccessibleName("Codex 专用");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "新建会话：多目录", exact: true }).click();
    const menu = page.getByRole("option");
    for (const [index, label] of [`同名 · ${twins[1].id}`, "Codex 专用", `同名 · ${twins[0].id}`, "通用智能体"].entries())
      await expect(menu.nth(index)).toContainText(label);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "会话 Agent", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "Codex 专用", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Claude 专用", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("option", { name: "其他环境智能体", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "新建会话：测试项目", exact: true })
      .click();
    await expect(
      page.getByRole("option", { name: "Codex 专用", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("option", { name: "其他环境智能体" }),
    ).toHaveCount(0);
    const commonOption = page.getByRole("option", {
      name: "通用智能体",
      exact: true,
    });
    await expect(commonOption).toHaveCount(1);
    await commonOption.click();
    const target = page.getByRole("listbox");
    await target.getByRole("option", { name: "Codex", exact: true }).click();
    await expect
      .poll(
        () =>
          store.list("sessions").filter((s) => s.agentId === common.id).length,
      )
      .toBe(1);
    expect(
      store.list("sessions").find((s) => s.agentId === common.id)?.permission,
    ).toBe("full");
    expect(store.get("sessions", session.id).permission).toBe("ask");
    const created = store
      .list("sessions")
      .find((s) => s.agentId === common.id)!;
    await expect(page).toHaveURL(base + "/#chat/" + created.id);
    await page.goto(base + "/#board/" + board.id);
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await page.locator(`[data-flow-stage="${board.stages[1].id}"]`).click();
    await expect(
      page.getByRole("button", { name: "阶段权限", exact: true }),
    ).toContainText("询问模式");
    await page.getByRole("button", { name: "阶段智能体", exact: true }).click();
    await expect(page.getByRole("option").first()).toContainText("Codex 专用");
    await page.getByRole("option", { name: "通用智能体", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "阶段权限", exact: true }),
    ).toContainText("询问模式");
    await choose("阶段智能体", "Codex 专用");
    await choose("CLI 模型", "model-b");
    await choose("CLI 思考深度", "medium");
    await choose("原生运行时", "Claude Code");
    await expect(
      page.getByRole("button", { name: "CLI 模型", exact: true }),
    ).toContainText("跟随配置");
    await expect(
      page.getByRole("button", { name: "阶段智能体", exact: true }),
    ).toContainText("请选择");
    await page.getByRole("button", { name: "阶段智能体", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "Codex 专用", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("option", { name: "通用智能体", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "保存流程", exact: true }).click();
    await expect(page.getByText(/请选择适用的智能体/)).toBeVisible();
    await choose("阶段智能体", "通用智能体");
    await page.getByRole("button", { name: "保存流程", exact: true }).click();
    await expect
      .poll(() => store.get("boards", board.id).stages[1].runtime)
      .toBe("claude");
    expect(store.get("boards", board.id).stages[1].agentId).toBe(common.id);
    // 新增草稿验证自动继承、同值手动覆盖，以及保存后重开保护。
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await page.getByRole("button", { name: "添加阶段", exact: true }).click();
    const draft = page.locator("[data-flow-detail]");
    const draftChoose = async (label: string, option: string) => {
      await draft.getByRole("button", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await draftChoose("阶段类型", "Agent 阶段");
    await draftChoose("项目执行目录", "测试环境 / .");
    await draftChoose("阶段智能体", "通用智能体");
    await page.getByRole("option", { name: "Codex", exact: true }).click();
    await expect(
      draft.getByRole("button", { name: "阶段权限", exact: true }),
    ).toContainText("完全权限");
    await draftChoose("阶段智能体", "Codex 专用");
    await expect(
      draft.getByRole("button", { name: "阶段权限", exact: true }),
    ).toContainText("询问模式");
    await draftChoose("阶段智能体", "通用智能体");
    // 同值选择也算显式覆盖；键盘确认当前选项。
    await draft.getByRole("button", { name: "阶段权限", exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await draftChoose("阶段智能体", "Codex 专用");
    await expect(
      draft.getByRole("button", { name: "阶段权限", exact: true }),
    ).toContainText("完全权限");
    await expect(draft).toContainText("已使用阶段自定义权限");
    await draftChoose("原生运行时", "Claude Code");
    await expect(draft).toContainText("已清除不适用的智能体");
    await expect(
      draft.getByRole("button", { name: "阶段权限", exact: true }),
    ).toContainText("完全权限");
    await draftChoose("阶段智能体", "Claude 专用");
    await page.getByRole("button", { name: "保存流程", exact: true }).click();
    await expect
      .poll(() => store.get("boards", board.id).stages.length)
      .toBe(4);
    expect(store.get("boards", board.id).stages[2].permission).toBe("full");
    // 覆盖配置被移除后的修复入口，创建智能体后仍回到原阶段草稿。
    for (const agent of store.list("agents")) store.remove("agents", agent.id);
    await page.reload();
    await page.getByRole("button", { name: "流程配置", exact: true }).click();
    await page.locator(`[data-flow-stage="${board.stages[1].id}"]`).click();
    await expect(draft).toContainText("暂无适用的智能体");
    await draft.getByRole("button", { name: "新建智能体", exact: true }).click();
    const editor = page.getByRole("dialog");
    await editor.getByLabel("名称", { exact: true }).fill("修复职责");
    await editor.getByRole("button", { name: "保存配置" }).click();
    await expect(editor).toHaveCount(0);
    await draftChoose("阶段智能体", "修复职责");
    await page.getByRole("button", { name: "保存流程", exact: true }).click();
    await expect.poll(() => store.get("boards", board.id).stages[1].agentId)
      .toBe(store.list("agents")[0].id);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await context.clearCookies();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 同一份隔离 SQLite 数据验证拖动落点、保存回退、未保存草稿与跨客户端触控排序。 */
test("智能体排序的桌面、键盘与手机交互", async ({ page, context, browser }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-agent-sort-"));
  const options = { dataDir: dir, publicUrl: "http://127.0.0.1", webDir: resolve("dist/web"), secureCookie: false };
  const { app, store, service } = await createApp(options);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const cookie = randomUUID();
    store.put("users", { username: "fixture" }, "owner");
    store.db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)").run(digest(cookie), "owner", Date.now() + 600000);
    const ids = ["A", "B", "C"].map(name => service.save("agents", { name }).id);
    service.saveAgentOrder(ids);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const url = options.publicUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    for (const client of [context, phone]) await client.addCookies([{ name: "relay_session", value: cookie, url }]);
    await page.goto(url + "/#agents");
    const cards = page.locator(".agent-list-item strong");
    const rows = page.locator(".agent-order-row");
    const draft = page.locator(".agent-editor input").first();
    await expect(cards).toHaveText(["A", "B", "C"]);
    await draft.fill("A draft");
    let writes = 0;
    page.on("request", request => { if (request.method() === "PUT" && request.url().endsWith("/agents/order")) writes++; });
    const dragLastToFirst = async () => {
      const last = (await rows.last().boundingBox())!;
      const first = (await rows.first().boundingBox())!;
      await page.mouse.move(last.x + 42, last.y + last.height / 2);
      await page.mouse.down();
      await page.mouse.move(first.x + 42, first.y + 4, { steps: 6 });
      await expect(rows.first()).toHaveClass(/agent-order-gap/);
      await expect(page.locator(".agent-order-gap")).toHaveCount(1);
    };
    await dragLastToFirst();
    for (const theme of ["light", "dark", "bug"]) {
      await page.locator("html").evaluate((el, value) => { el.dataset.theme = value; }, theme);
      await expect(rows.first()).toHaveCSS("outline-style", "dashed");
      await page.locator(".agents-list").screenshot({ path: `.vibe/agent-order-${theme}.png` });
    }
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(cards).toHaveText(["A", "B", "C"]);
    await dragLastToFirst();
    await page.mouse.move(1, 1);
    await page.mouse.up();
    expect(writes).toBe(0);
    await dragLastToFirst();
    await page.mouse.up();
    await expect.poll(() => service.list("agents").map(a => a.name)).toEqual(["C", "A", "B"]);
    await expect(draft).toHaveValue("A draft");
    // 失败保留已确认顺序；下一次键盘操作可重试，焦点跟随同一智能体。
    const grip = rows.filter({ hasText: "C" }).locator(".agent-grip button");
    await page.route("**/api/agents/order", route => route.fulfill({ status: 409, contentType: "application/json", body: '{"code":"CONFLICT"}' }), { times: 1 });
    await grip.press("ArrowDown");
    await expect(page.locator('.agents-list [role="alert"]')).toBeVisible();
    await expect(cards).toHaveText(["C", "A", "B"]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/agents/order", async route => {
      await gate;
      await route.continue();
    }, { times: 1 });
    await grip.press("ArrowDown");
    try {
      await expect(page.locator(".agents-list [role=status]")).toHaveText("保存中…");
    } finally {
      release();
    }
    await expect(cards).toHaveText(["A", "C", "B"]);
    await expect(grip).toBeFocused();
    await expect(draft).toHaveValue("A draft");
    await page.reload();
    await expect(cards).toHaveText(["A", "C", "B"]);
    await page.getByLabel("搜索智能体").fill("C");
    await expect(cards).toHaveText(["C"]);
    await expect(page.locator(".agent-order-note")).toBeVisible();
    await expect(page.locator(".agent-grip")).toHaveCount(0);

    service.saveLanguage({ preference: "en" });
    const mobile = await phone.newPage();
    await mobile.goto(url + "/#agents");
    const mobileRows = mobile.locator(".agent-order-row");
    await expect(mobileRows.locator("strong")).toHaveText(["A", "C", "B"]);
    const handle = mobile.getByRole("button", { name: /^Drag A to reorder/ });
    const gripBox = (await handle.boundingBox())!;
    const box = (await mobile.locator("#agent-results").boundingBox())!;
    const y = gripBox.y + gripBox.height / 2;
    const touch = await phone.newCDPSession(mobile);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: gripBox.x + gripBox.width / 2, y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width - 5, y }] });
    await expect(mobileRows.last()).toHaveClass(/agent-order-gap/);
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => service.list("agents").map(a => a.name)).toEqual(["C", "B", "A"]);
    await page.reload();
    await expect(cards).toHaveText(["C", "B", "A"]);
  } finally {
    await phone.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 阻断详情必须来自当次删除响应，同时保护详情草稿与历史会话的输入。 */
test("删除智能体展示当次看板引用，解除引用后旧会话显式换选", async ({ page, context }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-delete-browser-"));
  const options = { dataDir: dir, publicUrl: "http://127.0.0.1", webDir: resolve("dist/web"), secureCookie: false };
  const { app, store, service } = await createApp(options);
  try {
    const cookie = randomUUID();
    store.put("users", { username: "fixture" }, "owner");
    store.db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)").run(digest(cookie), "owner", Date.now() + 600000);
    const env = store.put("environments", { name: "Env", approved: true, roots: [] });
    service.peers.set(env.id, { call: async () => ({ events: [], interactions: [] }), close: () => {} } as any);
    const directory = { environmentId: env.id, rootId: "root", relativePath: "." };
    const project = service.save("projects", { name: "Project", directories: [directory] });
    const original = service.save("agents", { name: "Alpha" });
    const replacement = service.save("agents", { name: "Bravo" });
    const session = service.createSession({ title: "Existing", projectId: project.id, ...directory, runtime: "codex", agentId: original.id });
    const executionId = randomUUID();
    store.db.prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)").run(executionId, null, session.id, env.id,
      "completed", JSON.stringify({ agent: original }), new Date().toISOString());
    const history = { events: [{ sequence: 1, executionId, type: "item/completed",
      data: { item: { id: "reply", type: "agentMessage", text: "Existing reply" } } }], interactions: [] };
    service.peers.set(env.id, { call: async () => history, close: () => {} } as any);
    const stages = Array.from({ length: 40 }, (_, index) => ({
      id: randomUUID(), shortId: "S" + (index + 1), name: "部署".repeat(45), agentId: original.id,
    }));
    const board = store.put("boards", { name: "Board", archived: true, projectId: project.id, stages });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const url = options.publicUrl = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    await context.addCookies([{ name: "relay_session", value: cookie, url }]);
    for (const english of [false, true]) {
      service.saveLanguage({ preference: english ? "en" : "zh-CN" });
      await page.setViewportSize(english ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await page.goto(url + "/#agents");
      await page.reload();
      await page.locator(".agent-list-item").filter({ hasText: "Alpha" }).click();
      const trigger = page.locator(".agent-editor-footer button");
      const draft = page.locator(".agent-editor input").first();
      await draft.fill("Alpha draft");
      const dialog = page.getByRole("dialog");
      await trigger.click();
      await dialog.getByRole("button", { name: english ? "Cancel" : "取消", exact: true }).click();
      await expect(draft).toHaveValue("Alpha draft");
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        await trigger.click();
        await dialog.getByRole("button", { name: english ? "Confirm" : "确认", exact: true }).click();
        await expect(dialog).toHaveAccessibleName(english ? "Cannot delete agent" : "无法删除智能体");
        await expect(dialog.getByRole("listitem")).toHaveCount(40);
        await expect(dialog).toContainText("Project");
        await expect(dialog).toContainText(english ? /archived/i : "已归档");
        await dialog.screenshot({ path: `.vibe/agent-deletion-${english ? "en" : "zh"}-${theme}.png`, animations: "disabled" });
        await dialog.getByRole("listitem").last().scrollIntoViewIfNeeded();
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await expect(dialog.getByRole("button")).toBeInViewport();
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await expect(draft).toHaveValue("Alpha draft");
      }
    }
    const trigger = page.locator(".agent-editor-footer button");
    const dialog = page.getByRole("dialog");
    const remove = async () => {
      await trigger.click();
      await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    };
    store.put("boards", { stages: stages.slice(0, 1) }, board.id);
    await remove();
    await expect(dialog.getByRole("listitem")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.route("**/api/agents/" + original.id, route => route.fulfill({
      status: 400, contentType: "application/json", body: JSON.stringify({ code: "REFERENCED" }),
    }), { times: 1 });
    await remove();
    await expect(dialog).toContainText("specific locations are currently unavailable");
    await page.keyboard.press("Escape");
    await page.route("**/api/agents/" + original.id, route => route.abort(), { times: 1 });
    await remove();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    store.remove("boards", board.id);
    await remove();
    await expect(page.locator(".agent-list-item").filter({ hasText: "Alpha" })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url + "/#chat/" + session.id);
    await expect(page.getByText(/The original agent was deleted/)).toBeVisible();
    const composer = page.locator(".session-composer-toolbar").locator("..").locator("textarea");
    await composer.fill("draft");
    await composer.press("Enter");
    await expect(composer).toHaveValue("draft");
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeDisabled();
    await page.getByRole("button", { name: /session agent/i }).click();
    await page.getByRole("option", { name: "Bravo", exact: true }).click();
    await expect(send).toBeEnabled();
    await expect(composer).toHaveValue("draft");
    await expect(page.locator(".messages .message-identity")).toContainText("Alpha");
    expect(store.get("sessions", session.id)).toMatchObject({
      agentId: replacement.id, permission: session.permission, ...directory, runtime: "codex",
    });
  } finally {
    await page.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
