import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { changeServerLanguage } from "./browser-language.js";
import { digest } from "../src/server/security.js";
/** 真页面与 HTTP 链路验证引用输入，候选环境使用确定性数据覆盖竞态和输入法。 */
test("统一 @ 引用的键盘、搜索竞态、编辑高亮、移动端与实际发送", async ({
  page,
  context,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-mentions-browser-"));
  const appOptions = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    secureCookie: false,
    webDir: resolve("dist/web"),
  };
  const { app, store, service } = await createApp(appOptions);
  const cookie = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const env = store.put("environments", {
    name: "fixture",
    approved: true,
    capabilities: ["mentions-v1"],
    roots: [],
  });
  const project = service.save("projects", {
    name: "fixture",
    directories: [{ environmentId: env.id, rootId: "root" }],
  });
  const queries: string[] = [],
    sent: any[] = [];
  const items = [
    {
      kind: "skill",
      name: "review",
      path: "/skills/review/SKILL.md",
      description: "检查变更",
    },
    { kind: "folder", name: "src", path: "/work/src" },
    { kind: "file", name: "中文 空格.md", path: "/work/中文 空格.md" },
    ...Array.from({ length: 20 }, (_, i) => ({
      kind: "file",
      name: `file-${i}.ts`,
      path: `/work/file-${i}.ts`,
    })),
  ];
  service.peers.set(env.id, {
    call: async (method: string, p: any) => {
      if (method === "session.history")
        return { events: [], status: "idle", interactions: [] };
      if (method === "mentions.search") {
        queries.push(p.query);
        // 独立制造两类不完整结果，检查文件引导在空列表和可选列表中都可达。
        if (["partial", "missing", "docs/report"].includes(p.query)) {
          return {
            items: p.query === "missing" ? [] : [{ kind: "file", name: "report.md", path: "/work/docs/report.md" }],
            warningMessages: p.query === "docs/report" ? [] :
              ["skillsUnavailable", "scanIncomplete"].map(key => ({
                messageKey: "connector.mentions." + key, messageParams: {},
              })),
          };
        }
        if (p.query === "slow") await new Promise((r) => setTimeout(r, 700));
        return {
          items: items.filter((i) => i.name.includes(p.query)).slice(0, 10),
        };
      }
      if (method === "execution.start") {
        sent.push(p);
        return { status: "completed" };
      }
      return {};
    },
    close() {},
  } as any);
  const session = service.createSession({
    agentId: service.save("agents", { name: "Fixture agent" }).id,
    title: "引用测试",
    projectId: project.id,
    environmentId: env.id,
    rootId: "root",
    runtime: "codex",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  appOptions.publicUrl = base;
  await context.addCookies([
    { name: "relay_session", value: cookie, url: base },
  ]);
  try {
    await page.goto(base + "/#chat/" + session.id);
    const input = page.getByRole("combobox", { name: "发送给环境 Agent" });
    await input.fill("mail@host");
    await expect(page.getByRole("listbox", { name: "可引用清单" })).toHaveCount(
      0,
    );
    expect(queries).toHaveLength(0);
    await input.fill("@");
    await expect(page.getByRole("option")).toHaveCount(10);
    await input.press("Enter");
    await expect(input).toHaveValue("@review ");
    await expect(page.locator(".mention-highlight mark")).toHaveText("@review");
    expect(sent).toHaveLength(0);
    await input.press("End");
    await input.press("@");
    await expect(page.getByRole("option")).toHaveCount(10);
    await input.press("ArrowDown");
    await input.press("Tab");
    await expect(input).toHaveValue("@review @src ");
    await expect(page.locator(".mention-highlight mark")).toHaveCount(2);
    await input.press("Shift+Enter");
    await expect(input).toHaveValue("@review @src \n");
    await input.fill("@slow");
    await expect.poll(() => queries.includes("slow")).toBe(true);
    await input.fill("@中文");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText("中文 空格.md");
    await page.waitForTimeout(800);
    await expect(page.getByRole("option")).toHaveCount(1);
    await input.press("Tab");
    await expect(input).toHaveValue("@中文 空格.md ");
    await expect(page.locator(".mention-highlight mark")).toHaveText(
      "@中文 空格.md",
    );
    await input.press("Home");
    await input.press("ArrowRight");
    await input.press("Delete");
    await expect(page.locator(".mention-highlight mark")).toHaveCount(0);
    await input.fill("@");
    await expect(page.getByRole("option")).toHaveCount(10);
    await input.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    await expect(input).toHaveValue("@");
    expect(sent).toHaveLength(0);
    await input.press("Escape");
    await expect(page.getByRole("listbox", { name: "可引用清单" })).toHaveCount(
      0,
    );
    await input.fill(" @no-result");
    await expect(
      page.getByText("没有匹配项，试试文件名、路径或 Skill 名称"),
    ).toBeVisible();
    await input.press("Enter");
    expect(sent).toHaveLength(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await input.fill("看一下 @中文");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.getByRole("option").click();
    await expect(input).toHaveValue("看一下 @中文 空格.md ");
    await expect(page.locator(".mention-highlight mark")).toHaveCount(1);
    for (const theme of ["light", "dark", "bug"]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await input.press("End");
      await input.press("@");
      await expect(page.getByRole("option")).toHaveCount(10);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: `.vibe/mentions-${theme}.png` });
      await input.press("Escape");
      await input.press("Backspace");
    }
    await input.press("Enter");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].mentions).toMatchObject([
      { kind: "file", path: "/work/中文 空格.md", start: 4 },
    ]);
    await expect(input).toHaveValue("");
    await expect(page.locator(".mention-highlight mark")).toHaveCount(0);
    for (const language of ["zh-CN", "en"] as const) {
      await changeServerLanguage(page, language);
      const composer = page.locator("textarea[role=combobox]");
      const status = page.locator(".mention-note");
      for (const query of ["missing", "partial"]) {
        await composer.fill("@" + query);
        await expect(status).toContainText(language === "en" ? "skill list" : "Skill 清单");
        await expect(status).toContainText(language === "en" ? "@docs/report" : "@docs/需求");
        await expect(page.getByRole("option")).toHaveCount(query === "missing" ? 0 : 1);
      }
      await composer.fill("@docs/report");
      await expect(status).toHaveCount(0);
      await page.getByRole("option").click();
      await expect(composer).toHaveValue("@report.md ");
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
