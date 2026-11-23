import { changeServerLanguage } from "./browser-language.js";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { Engine } from "../src/connector/engine.js";
import { Store } from "../src/server/store.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** 所有写请求经过真实 HTTP/SQLite；环境离线，不调用真实模型。 */
async function fixture(context: any, allowReview = false) {
  const dir = await mkdtemp(join(tmpdir(), "relay-item-start-ui-"));
  const config = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(config);
  store.put("users", { username: "fixture" }, "owner");
  const cookie = randomUUID();
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const environment = store.put("environments", {
    name: "fixture",
    status: "offline",
  });
  const directory = {
    environmentId: environment.id,
    rootId: "fixture",
    relativePath: ".",
  };
  const project = service.save("projects", {
    name: "起点测试",
    directories: [directory],
  });
  const agent = service.save("agents", {
    name: "fixture",
    environmentId: environment.id,
    instructions: "测试",
    supportedRuntimes: ["codex"],
  });
  const first = randomUUID(),
    human = randomUUID(),
    auto = randomUUID(),
    done = randomUUID();
  const board = service.save("boards", {
    name: "起点测试",
    projectId: project.id,
    stages: [
      {
        id: first,
        fixedRole: "start",
        name: "产品",
        type: "human",
        targets: allowReview ? [human, done] : [done],
      },
      { id: human, name: "产品", type: "human", targets: [done] },
      {
        id: auto,
        name: "开发" + "LongStage".repeat(8),
        type: "agent",
        targets: [done],
        ...directory,
        agentId: agent.id,
        runtime: "codex",
        permission: "full",
        concurrency: 1,
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
  return {
    store,
    service,
    dir,
    environment,
    board,
    first,
    human,
    auto,
    done,
    base,
    async close() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("创建与人工交接附件落盘，刷新后保留各自路径", async ({
  page,
  context,
}) => {
  const f = await fixture(context, true);
  const root = join(f.dir, "project");
  await mkdir(root);
  const local = new Store(join(f.dir, "connector.db"));
  const engine = new Engine(
    local,
    () => ({ roots: [{ id: "fixture", path: root }] }),
    () => {},
    async () => ({}),
  );
  const peer = {
    call: (method: string, params: any) => engine.call(method, params),
    close: () => {},
  };
  f.store.put(
    "environments",
    {
      ...f.environment,
      approved: true,
      capabilities: ["board-attachments-v1", "file-push-v1"],
    },
    f.environment.id,
  );
  const file = (body: string) => ({
    name: "note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(body),
  });
  try {
    await page.goto(f.base + "/#board/" + f.board.id);
    await page.getByRole("button", { name: "新建工作项", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("标题", { exact: true }).fill("附件核对");
    await dialog
      .getByLabel("添加附件")
      .setInputFiles([file("first"), file("second")]);
    const create = dialog.getByRole("button", {
      name: "创建工作项",
      exact: true,
    });
    await create.click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(f.store.list("items")).toHaveLength(0);
    f.service.peers.set(f.environment.id, peer as any);
    await create.click();
    const card = page.getByRole("heading", { name: "附件核对", exact: true });
    await card.click();
    const paths = dialog.locator(".handoff-history code");
    await expect(paths).toHaveCount(2);
    const originals = await paths.allTextContents();
    expect(new Set(originals).size).toBe(2);
    expect(
      await Promise.all(originals.map((p) => readFile(join(root, p), "utf8"))),
    ).toEqual(["first", "second"]);
    // 两个窗口冻结同一版本，先提交者保存，旧表单继续显示原输入。
    const second = await context.newPage();
    await second.goto(f.base + "/#board/" + f.board.id);
    await second.getByRole("heading", { name: "附件核对", exact: true }).click();
    await second.getByRole("dialog").getByRole("button", { name: "编辑", exact: true }).click();
    const stale = second.getByRole("dialog", { name: "编辑工作项" });
    await stale.getByLabel("标题", { exact: true }).fill("旧草稿");
    await dialog.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑工作项" });
    await editor.getByRole("button", { name: /取消或移除/ }).first().click();
    await editor.getByLabel("添加附件").setInputFiles(file("new"));
    await editor.locator("textarea").fill("更新后的需求");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(dialog).toContainText("更新后的需求");
    expect(await readFile(join(root, originals[0]), "utf8")).toBe("first");
    await stale.getByRole("button", { name: "保存", exact: true }).click();
    await expect(stale.getByRole("alert")).toContainText("工作项已变更");
    await expect(stale.getByLabel("标题", { exact: true })).toHaveValue("旧草稿");
    await second.close();
    await dialog.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(editor.locator("code")).toHaveCount(2);
    expect(await editor.locator("code").allTextContents()).not.toContain(originals[0]);
    await editor.getByLabel("标题", { exact: true }).fill("放弃修改");
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "附件核对" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // 拖到人工阶段后改选完成阶段，核对最终交接的文件与历史。
    const from = (await card.boundingBox())!;
    const to = (await page.locator(`[data-drop-stage="${f.human}"]`).boundingBox())!;
    await page.mouse.move(from.x + 5, from.y + 5);
    await page.mouse.down();
    await page.mouse.move(to.x + 50, to.y + 70, { steps: 8 });
    await page.mouse.up();
    await expect(dialog).toHaveAccessibleName("交接与推进");
    await dialog.getByRole("button", { name: "目标阶段", exact: true }).click();
    await page.getByRole("option").last().click();
    const picker = dialog.locator(".item-handoff .ui-attachment-picker");
    const submit = dialog.getByRole("button", { name: "提交交接并推进" });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const uploadBox = (await picker.boundingBox())!;
      const submitBox = (await submit.boundingBox())!;
      const gap = submitBox.y - uploadBox.y - uploadBox.height;
      expect(gap).toBeGreaterThanOrEqual(8);
      expect(gap).toBeLessThanOrEqual(12);
      if (width === 390) {
        expect(Math.min(uploadBox.width, uploadBox.height, submitBox.width, submitBox.height)).toBeGreaterThanOrEqual(44);
      }
    }
    // 用真实文件选择事件覆盖窄屏点击，再验证移除后可重新添加。
    const choosing = page.waitForEvent("filechooser");
    await picker.click();
    await (await choosing).setFiles(file("third"));
    const remove = dialog.getByRole("button", { name: /取消或移除/ });
    const removeBox = (await remove.boundingBox())!;
    expect((await submit.boundingBox())!.y - removeBox.y - removeBox.height).toBeGreaterThanOrEqual(8);
    await remove.click();
    await expect(remove).toHaveCount(0);
    await dialog.getByLabel("添加附件").setInputFiles(file("third"));
    await dialog.locator(".item-handoff textarea").fill("交接附件");
    // 缩小可用高度模拟键盘占屏，离线失败后原草稿可直接重试。
    await page.setViewportSize({ width: 390, height: 400 });
    f.service.peers.delete(f.environment.id);
    await submit.click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.locator(".item-handoff textarea")).toHaveValue("交接附件");
    await expect(remove).toBeVisible();
    expect(f.store.list("items")[0].stageId).toBe(f.first);
    f.service.peers.set(f.environment.id, peer as any);
    await dialog.getByRole("button", { name: "提交交接并推进" }).click();
    await expect(dialog).toBeHidden();
    expect(f.store.list("items")[0].stageId).toBe(f.done);
    f.service.peers.delete(f.environment.id);
    await page.reload();
    await card.click();
    await expect(paths).toHaveCount(4);
    await expect(dialog.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
    expect(
      await readFile(join(root, await paths.first().innerText()), "utf8"),
    ).toBe("third");
    await expect(dialog.locator(".handoff-entry").last()).toContainText(
      "创建工作项",
    );
  } finally {
    f.service.peers.delete(f.environment.id);
    engine.close();
    local.close();
    await f.close();
  }
});

test("普通人工节点在英文窄屏移除失败上传后保存文字", async ({ page, context }) => {
  const f = await fixture(context);
  try {
    const item = f.service.createItem({ title: "Review draft", boardId: f.board.id, startStageId: f.human });
    f.service.saveLanguage({ preference: "en" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(f.base + "/#board/" + f.board.id);
    await page.getByRole("heading", { name: "Review draft" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit work item" });
    await expect(editor.getByLabel("Title", { exact: true })).toBeFocused();
    await editor.getByLabel("Title", { exact: true }).fill("Reviewed draft");
    await editor.locator("textarea").fill("Ready for handoff");
    await editor.locator('input[type="file"]').setInputFiles({
      name: "offline.txt", mimeType: "text/plain", buffer: Buffer.from("local"),
    });
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor.getByRole("alert")).toBeVisible();
    expect(f.store.get("items", item.id).title).toBe("Review draft");
    await editor.getByRole("button", { name: /offline\.txt/ }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toBeHidden();
    await page.reload();
    await page.getByRole("heading", { name: "Reviewed draft" }).click();
    await expect(page.getByRole("dialog")).toContainText("Ready for handoff");
    expect(f.store.get("items", item.id).stageId).toBe(f.human);
    expect(f.store.list("sessions")).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("任意起点真实创建、三主题双语移动端与焦点", async ({ page, context }) => {
  const f = await fixture(context);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(f.base + "/#board/" + f.board.id);
    const open = page.getByRole("button", {
      name: /^(新建工作项|New work item)$/,
    });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await open.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByLabel("标题", { exact: true })).toBeFocused();
        const select = dialog.getByRole("button", {
          name: "起始阶段",
          exact: true,
        });
        await expect(select).toContainText("1. 产品 · 人工 · 默认起点");
        await select.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("option")).toHaveCount(4);
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(select).toBeFocused();
        await expect(dialog).toContainText("创建后将按此阶段配置自动执行");
        await expect(dialog.locator(".creation-effect .danger")).toHaveText(
          /完全权限/,
        );
        await select.click();
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        const box = await page.getByRole("listbox").boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `.vibe/start-${theme}-${width}.png`,
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(select).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(open).toBeFocused();
      }
    }
    await page.setViewportSize({ width: 390, height: 420 });
    // 模拟软键盘缩小可视区域，仍能滚动到提交按钮。
    for (const [target, option, status] of [
      [f.first, null, "human"],
      [f.human, /^2\./, "human"],
      [f.auto, /^3\./, "queued"],
      [f.done, /^4\./, "done"],
    ] as const) {
      await open.click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("button", { name: "起始阶段", exact: true }),
      ).toContainText("默认起点");
      await dialog.getByLabel("标题", { exact: true }).fill(`目标-${target}`);
      if (option) {
        await dialog
          .getByRole("button", { name: "起始阶段", exact: true })
          .click();
        await page.getByRole("option", { name: option }).click();
      }
      await dialog
        .getByRole("button", { name: "创建工作项", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      const item = f.store
        .list("items")
        .find((i: any) => i.title === `目标-${target}`)!;
      expect(item.stageId).toBe(target);
      expect(item.status).toBe(status);
      await expect(
        page.locator(".column").filter({
          has: page.getByRole("heading", {
            name: `目标-${target}`,
            exact: true,
          }),
        }),
      ).toHaveCount(1);
    }
    expect(f.store.list("sessions")).toHaveLength(1);
    expect(f.store.db.prepare("SELECT * FROM executions").all()).toHaveLength(
      1,
    );
    expect(f.store.list("handoffs")).toHaveLength(0);
    // 搜索条件保留，仍显示真实目标阶段的成功消息。
    await page.getByPlaceholder("搜索工作项、标签").fill("不会匹配");
    await changeServerLanguage(page, "en");
    await open.click();
    const dialog = page.getByRole("dialog", { name: "New work item" });
    await dialog.getByLabel("Title", { exact: true }).fill("English creation");
    await dialog
      .getByRole("button", { name: "Start stage", exact: true })
      .click();
    await page.getByRole("option", { name: /^4\./ }).click();
    await expect(dialog).toContainText(
      "Mark as done immediately without starting an Agent",
    );
    await dialog
      .getByRole("button", { name: "Create work item", exact: true })
      .click();
    await expect(
      page.getByText("Work item created. Start stage: 完成", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder("Search work items and tags"),
    ).toHaveValue("不会匹配");
    expect(errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("配置冲突保留草稿、阶段失效重选与响应丢失防重", async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  try {
    await page.goto(f.base + "/#board/" + f.board.id);
    await page.getByRole("button", { name: "新建工作项", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const select = dialog.getByRole("button", {
      name: "起始阶段",
      exact: true,
    });
    await expect(select).toBeEnabled();
    await dialog.getByLabel("标题", { exact: true }).fill("草稿标题");
    await dialog.getByLabel("需求内容").fill("草稿正文");
    await dialog.getByLabel("标签（逗号分隔）").fill("保留,标签");
    await select.click();
    await page.getByRole("option", { name: /^2\./ }).click();
    let changed = false;
    await page.route("**/api/items", async (route) => {
      if (!changed) {
        changed = true;
        const latest = f.store.get("boards", f.board.id);
        const draft = {
          ...latest,
          stages: latest.stages.filter((s: any) => s.id !== f.human),
        };
        const preview = f.service.previewBoardFlow(
          f.board.id,
          draft,
          latest.version,
        );
        f.service.save(
          "boards",
          { ...draft, confirmationToken: preview.confirmationToken },
          f.board.id,
          latest.version,
        );
      }
      await route.continue();
    });
    await dialog
      .getByRole("button", { name: "创建工作项", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("配置已变更");
    expect(f.store.list("items")).toHaveLength(0);
    await dialog.getByRole("button", { name: "读取最新流程" }).click();
    await expect(dialog.getByRole("alert")).toContainText("起始阶段已失效");
    await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(
      "草稿标题",
    );
    await expect(dialog.getByLabel("需求内容")).toHaveValue("草稿正文");
    await expect(dialog.getByLabel("标签（逗号分隔）")).toHaveValue(
      "保留,标签",
    );
    await expect(
      dialog.getByRole("button", { name: "创建工作项", exact: true }),
    ).toBeDisabled();
    await select.click();
    await page.getByRole("option", { name: /^2\./ }).click();
    await page.unroute("**/api/items");
    const requests: any[] = [];
    await page.route("**/api/items", async (route) => {
      requests.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (requests.length === 1) await route.abort();
      else await route.fulfill({ response });
    });
    await dialog
      .getByRole("button", { name: "创建工作项", exact: true })
      .dblclick();
    await expect(dialog.getByRole("alert")).toContainText("创建结果尚未确认");
    await expect(select).toBeDisabled();
    await expect(dialog.getByLabel("标题", { exact: true })).toHaveAttribute(
      "readonly",
      "",
    );
    expect(f.store.list("items")).toHaveLength(1);
    await dialog.getByRole("button", { name: "核实并重试原创建" }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(f.store.list("items")).toHaveLength(1);
    expect(f.store.list("sessions")).toHaveLength(1);
  } finally {
    await f.close();
  }
});

/** 读取失败及流程空态不丢草稿；离线恢复不会自动重放写请求。 */
test("加载失败重试、空流程与英文离线提示", async ({ page, context }) => {
  const f = await fixture(context);
  try {
    await page.goto(f.base + "/#board/" + f.board.id);
    const open = page.getByRole("button", {
      name: /^(新建工作项|New work item)$/,
    });
    await expect(open).toBeVisible();
    await changeServerLanguage(page, "en");
    let fail = true;
    await page.route("**/api/state", async (route) => {
      if (fail)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "fixture read failure" }),
        });
      else await route.continue();
    });
    await open.click();
    const dialog = page.getByRole("dialog", { name: "New work item" });
    await expect(dialog.getByRole("alert")).toContainText(
      "Could not load the workflow",
    );
    await dialog.getByLabel("Title", { exact: true }).fill("Retained draft");
    await expect(
      dialog.getByRole("button", { name: "Create work item", exact: true }),
    ).toBeDisabled();
    fail = false;
    await dialog.getByRole("button", { name: "Load latest workflow" }).click();
    await expect(
      dialog.getByRole("button", { name: "Start stage", exact: true }),
    ).toContainText("Default start");
    await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(
      "Retained draft",
    );
    await context.setOffline(true);
    await dialog
      .getByRole("button", { name: "Create work item", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("You are offline");
    await context.setOffline(false);
    expect(f.store.list("items")).toHaveLength(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    // 直接注入异常流程验证空态，不将其描述为正常流程编辑器可保存的配置。
    f.store.put(
      "boards",
      { stages: f.board.stages.filter((s: any) => s.type === "done") },
      f.board.id,
    );
    await open.click();
    await expect(dialog).toContainText(
      "The workflow has no valid default start stage",
    );
    await expect(
      dialog.getByRole("button", { name: "Create work item", exact: true }),
    ).toBeDisabled();
    expect(f.store.list("items")).toHaveLength(0);
  } finally {
    await f.close();
  }
});
