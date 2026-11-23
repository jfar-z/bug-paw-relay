import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import { commandCapability } from "../src/shared/slash-commands.js";

/** 真实页面和 HTTP 负责分派，节点替身控制发现失败与模型列表。 */
test("管理命令、手机补全及四种接管操作", async ({ page, context }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-command-ui-"));
  const options = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    secureCookie: false,
    webDir: resolve("dist/web"),
  };
  const { app, store, service } = await createApp(options);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    service.saveLanguage({ preference: "zh-CN" });
    const env = store.put("environments", {
      name: "Command environment",
      approved: true,
      capabilities: [commandCapability, "runtime-options-v1"],
      roots: [],
    });
    const directory = {
      environmentId: env.id,
      rootId: "root",
      relativePath: ".",
    };
    const project = service.save("projects", {
      name: "Command project",
      directories: [directory],
    });
    const agent = service.save("agents", { name: "Command agent" });
    const row = {
      identity: "demo",
      name: "demo",
      canonical: "demo",
      description: "Project command",
      argumentHint: "[text]",
      source: "project",
      execution: "skill",
      enabled: false,
    };
    let unavailable = false;
    let executionId = "";
    service.peers.set(env.id, {
      call: async (method: string, data: any) => {
        if (method === "commands.list") {
          if (unavailable) throw Error("offline");
          return [row];
        }
        if (method === "commands.resolve") return row;
        if (method === "execution.start") {
          executionId = data.executionId;
          return { status: "running" };
        }
        if (method === "commands.save") {
          row.enabled = data.change.enabled;
          return row;
        }
        if (method === "commands.rename") return { title: data.title };
        if (method === "runtime.catalog")
          return { models: [{ id: "model-a", name: "model-a" }], defaults: {} };
        if (method === "session.history")
          return { status: "idle", events: [], interactions: [] };
        return {};
      },
      close() {},
    } as any);
    const binding = {
      ...directory,
      runtime: "codex",
      agentId: agent.id,
      projectId: project.id,
    };
    const original = service.createSession({ ...binding, title: "Original" });
    const target = service.createSession({ ...binding, title: "Target" });
    const user = store.put("users", { username: "fixture" }, "owner");
    const cookie = randomUUID();
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(cookie), user.id, Date.now() + 600000);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base =
      "http://127.0.0.1:" + (app.server.address() as { port: number }).port;
    options.publicUrl = base;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: base },
    ]);
    await page.goto(base + "/#environments/" + env.id + "/tools");
    await page
      .getByRole("button", { name: "命令", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    const allow = dialog.getByRole("checkbox", { name: "放行 /demo" });
    await allow.check();
    await expect(allow).toBeChecked();
    unavailable = true;
    await dialog.getByRole("button", { name: "刷新命令清单" }).click();
    await expect(allow).toBeEnabled();
    await expect(allow).toBeChecked();
    unavailable = false;
    await page.goto(base + "/#chat/" + original.id);
    const input = page.getByRole("combobox", { name: "发送给环境 Agent" });
    async function send(message: string) {
      await input.fill(message);
      await input.press("Enter");
    }
    await input.fill("/");
    await expect(page.getByRole("option")).toHaveCount(5);
    await input.fill("/re");
    await expect(page.getByRole("option")).toHaveCount(2);
    await input.press("ArrowDown");
    await input.press("Tab");
    await expect(input).toHaveValue("/resume ");
    await input.press("Enter");
    await dialog.getByRole("button", { name: /Target/ }).click();
    await expect(page).toHaveURL(base + "/#chat/" + target.id);
    await send("/resume absent");
    await expect(input).toHaveValue("/resume absent");
    await expect(page.getByText(/找不到匹配的会话/).first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await input.fill("/re");
    await input.dispatchEvent("keydown", {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    await expect(page.getByRole("option")).toHaveCount(2);
    await page.getByRole("option", { name: /rename/ }).click();
    await expect(input).toHaveValue("/rename ");
    await input.press("Enter");
    await dialog.getByRole("textbox").fill("登录超时排查");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(input).toHaveValue("");
    expect(store.get("sessions", target.id).title).toBe("登录超时排查");
    await send("/model");
    await dialog.getByRole("button", { name: "CLI 模型" }).click();
    await page.getByRole("option", { name: "model-a" }).click();
    await expect(dialog).toHaveCount(0);
    expect(store.get("sessions", target.id).runtimeOptions.model).toBe(
      "model-a",
    );
    await send("/new");
    await expect.poll(() => store.list("sessions").length).toBe(3);
    const created = store
      .list("sessions")
      .find((s) => ![original.id, target.id].includes(s.id))!;
    expect(created).toMatchObject(binding);
    await expect(page).toHaveURL(base + "/#chat/" + created.id);
    await expect(input).toHaveValue("");
    await send("/demo keep arguments");
    await expect(input).toHaveValue("");
    await input.fill("new draft");
    service.setState(executionId, "failed");
    await expect(
      page.getByRole("button", { name: "恢复失败命令的草稿" }),
    ).toBeVisible();
    await expect(input).toHaveValue("new draft");
    await input.fill("");
    await expect(input).toHaveValue("/demo keep arguments");
    await send("/demo running");
    await expect(input).toHaveValue("");
    await send("/resume " + original.id);
    await expect(page).toHaveURL(base + "/#chat/" + original.id);
    expect(service.execution(executionId).state).toBe("running");
    service.setState(executionId, "completed");
    // 切换正式语言设置并重载，覆盖 PWA 同一输入界面的窄屏主题标签。
    for (const locale of ["zh-CN", "en"] as const) {
      service.saveLanguage({ preference: locale });
      await page.reload();
      const composer = page.getByRole("combobox", {
        name:
          locale === "en" ? "Send to environment agent" : "发送给环境 Agent",
        exact: false,
      });
      await composer.fill("/");
      const list = page.getByRole("listbox", {
        name: locale === "en" ? "Commands" : "命令",
      });
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        await expect(
          list.getByRole("option", { name: /demo.*Codex/ }),
        ).toBeVisible();
        await expect(
          list.getByRole("option", { name: /rename.*Relay/ }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await list.screenshot({
          path: ".vibe/slash/" + locale + "-" + theme + ".png",
        });
      }
      await composer.press("Escape");
      await expect(list).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
