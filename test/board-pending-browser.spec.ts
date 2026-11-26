import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import { handoffCapability } from "../src/shared/stage-handoff.js";

/** 真实 HTTP 与页面联调；连接器使用隔离模拟，不代表真实模型验收。 */
for (const width of [1440, 390]) {
  test(`看板续执行、提醒与前台恢复 ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const dir = mkdtempSync(join(tmpdir(), "relay-board-pending-"));
    const options = {
      dataDir: dir,
      publicUrl: "http://127.0.0.1",
      webDir: resolve("dist/web"),
      secureCookie: false,
    };
    const { app, store, service } = await createApp(options);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    options.publicUrl = base;
    const token = randomUUID();
    store.put("users", { username: "fixture" }, "owner");
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(token), "owner", Date.now() + 600000);
    await context.addCookies([
      { name: "relay_session", value: token, url: base },
    ]);
    const environment = store.put("environments", {
      name: "模拟环境",
      roots: [{ id: "root", path: dir }],
      approved: true,
      capabilities: [handoffCapability, "board-resume-v1"],
    });
    const peer = {
      call: async (method: string) =>
        method === "execution.prepare"
          ? { status: "queued", stateVersion: 0 }
          : { status: "running", stateVersion: 1 },
      close: () => {},
    };
    service.peers.set(environment.id, peer as any);
    const project = service.save("projects", {
      name: "联调项目",
      directories: [
        { environmentId: environment.id, rootId: "root", relativePath: "." },
      ],
    });
    const human = randomUUID(),
      agent = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "续执行看板",
      projectId: project.id,
      stages: [
        {
          id: human,
          fixedRole: "start",
          name: "需求",
          type: "human",
          targets: [agent],
        },
        {
          id: agent,
          name: "开发",
          type: "agent",
          agentId: service.save("agents", { name: "Fixture agent" }).id,
          targets: [done],
          environmentId: environment.id,
          rootId: "root",
          relativePath: ".",
          concurrency: 1,
        },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    const item = service.createItem({ boardId: board.id, title: "恢复工作项" });
    service.advance(item.id, agent, "开始", randomUUID());
    await service.tick();
    const original = service.execution(store.get("items", item.id).executionId);
    service.setState(original.id, "completed", 2);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(base + "/#board/" + board.id);
      const card = page.locator(".task").filter({ hasText: "恢复工作项" });
      await expect(card).toContainText("执行结束未推进");
      await expect(page.getByText("1 个待处理", { exact: true })).toBeVisible();
      await card.click();
      await expect(page.locator(".item-overview")).toContainText(
        "执行结束未推进",
      );
      // 打开详情不清除；通过真实发送接口接管，常驻页面无需手动刷新。
      const response = await context.request.post(
        `${base}/api/sessions/${original.session_id}/send`,
        {
          headers: { origin: base },
          data: { operationId: randomUUID(), message: "继续" },
        },
      );
      expect(response.ok()).toBe(true);
      const resumed = await response.json();
      await service.tick();
      await expect(card).toContainText("执行中", { timeout: 3000 });
      await expect(page.locator(".item-overview")).toContainText("执行中", {
        timeout: 3000,
      });
      await expect(page.locator(".attention")).toHaveCount(0);
      service.setState(original.id, "completed", 99);
      expect(store.get("items", item.id).status).toBe("running");
      service.setState(resumed.executionId, "waiting", 2);
      await expect(card).toContainText("等待回复或审批", { timeout: 3000 });
      service.peers.delete(environment.id);
      await expect(card).toContainText("状态待同步", { timeout: 3000 });
      await expect(page.getByText("1 个待处理", { exact: true })).toBeVisible();
      service.peers.set(environment.id, peer as any);
      service.setState(resumed.executionId, "running", 3);
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
      await expect(card.locator(".attention")).toHaveCount(0, {
        timeout: 3000,
      });
      await expect(card).not.toContainText("状态待同步");
      await page.reload();
      await expect(card).toContainText("执行中");
      service.createItem({ boardId: board.id, title: "人工等待" });
      service.setState(resumed.executionId, "completed", 4);
      await expect(page.getByText("2 个待处理", { exact: true })).toBeVisible({
        timeout: 3000,
      });
      // 完成后的第二轮续发及失败后新尝试沿用原会话，旧失败不能污染当前提醒。
      for (const terminal of ["failed", "completed"] as const) {
        const response = await context.request.post(
          `${base}/api/sessions/${original.session_id}/send`,
          {
            headers: { origin: base },
            data: { operationId: randomUUID(), message: `续发到 ${terminal}` },
          },
        );
        expect(response.ok()).toBe(true);
        const next = await response.json();
        await service.tick();
        expect(service.execution(next.executionId).session_id).toBe(
          original.session_id,
        );
        await expect(card).toContainText("执行中");
        await expect(
          page.getByText("1 个待处理", { exact: true }),
        ).toBeVisible();
        service.setState(next.executionId, terminal, 2);
        await expect(card).toContainText(
          terminal === "failed" ? "执行失败" : "执行结束未推进",
        );
        await expect(
          page.getByText("2 个待处理", { exact: true }),
        ).toBeVisible();
      }
      // 读取失败保留上一快照及计数，并明确展示错误。
      await page.route("**/api/state/query", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "状态读取失败" } }),
        }),
      );
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 3000 });
      await expect(page.getByText("2 个待处理", { exact: true })).toBeVisible();
      await page.unroute("**/api/state/query");
      await page.goto(base + "/#board");
      await expect(page.locator(".board-card")).toContainText("2 个待处理");
      await page.screenshot({ path: `.vibe/board-pending-${width}.png` });
      expect(errors).toEqual([]);
    } finally {
      await page.goto("about:blank");
      service.peers.clear();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
