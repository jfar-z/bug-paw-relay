import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import { Engine } from "../src/connector/engine.js";
import { ConnectorStore } from "../src/connector/store.js";
import { defaultBoardStages } from "../src/shared/board-stages.js";
import { changeServerLanguage } from "./browser-language.js";

test.use({ hasTouch: true });

/** 使用真实会话接口、工具服务和连接器历史，只替代模型发起工具调用的步骤。 */
test("选择看板、审批、回执、归档深链和恢复会话", async ({ page, context }) => {
  const dir = await mkdtemp(join(tmpdir(), "board-card-ui-"));
  const options = {
    dataDir: join(dir, "server"),
    secureCookie: false,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
  };
  const { store, service, sessionBoards, app } = await createApp(options);
  const roots = [{ id: "work", path: dir }];
  const local = new ConnectorStore(join(dir, "env.db"));
  const engine = new Engine(
    local,
    () => ({ roots }),
    () => {},
    async () => {
      throw Error("unexpected callback");
    },
  );
  try {
    const cookie = randomUUID();
    store.put("users", { username: "fixture" }, "owner");
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(cookie), "owner", Date.now() + 600000);
    const env = store.put("environments", {
      name: "Env",
      approved: true,
      platform: "linux/x64",
      roots,
      capabilities: ["mentions-v1", "session-board-v1"],
    });
    const directory = {
      environmentId: env.id,
      rootId: "work",
      relativePath: ".",
    };
    const project = service.save("projects", {
      name: "Release",
      directories: [directory],
    });
    const board = service.save("boards", {
      name: "Roadmap",
      projectId: project.id,
      stages: defaultBoardStages(randomUUID(), randomUUID()),
    });
    let executionId = "";
    let inputEvent: { text: string; nativeText: string; operationId: string } | undefined;
    const peer: any = {
      close() {},
      async call(method: string, p: any) {
        if (method === "execution.start") {
          executionId = p.executionId;
          inputEvent = {
            text: p.message,
            nativeText: p.message.replace("@Roadmap", "@Roadmap (boardId=" + board.id + ")"),
            operationId: p.operationId,
          };
          local.put("localSessions", { cwd: dir }, session.id);
          local.put(
            "localExecutions",
            { sessionId: session.id, status: "running" },
            executionId,
          );
          await invoke("accept", {});
          return { status: "running" };
        }
        if (method === "mentions.search") return {
          items: Array.from({ length: 10 }, (_, i) => ({
            kind: "skill", name: "road-tool-" + i, path: "/skills/road-tool-" + i,
          })),
        };
        // 同时返回环境回显与原生轮次，验证浏览器只保留回复前的一条用户气泡。
        if (method === "session.history" && inputEvent) {
          const history = await engine.call(method, p);
          return {
            ...history,
            events: [{ executionId, sequence: 1, type: "user", data: inputEvent },
              { executionId, sequence: 2, type: "turn/started", data: { turn: { id: executionId } } }],
            nativeHistory: { thread: { turns: [{ id: executionId, items: [
              { type: "userMessage", id: "user", content: [{ type: "text", text: inputEvent.nativeText }] },
              { type: "agentMessage", id: "reply", text: "Board received" },
            ] }] } },
          };
        }
        return engine.call(method, p);
      },
    };
    service.peers.set(env.id, peer);
    const session = service.createSession({
      title: "Session",
      projectId: project.id,
      ...directory,
      runtime: "codex",
      permission: "ask",
      agentId: service.save("agents", { name: "Fixture" }).id,
    });

    function invoke(method: string, args: unknown) {
      return sessionBoards.agent(method, env.id, peer, {
        executionId,
        callId: randomUUID(),
        args,
      });
    }
    await app.listen({ host: "127.0.0.1", port: 0 });
    options.publicUrl =
      "http://127.0.0.1:" + (app.server.address() as { port: number }).port;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: options.publicUrl },
    ]);
    await page.goto(options.publicUrl + "/#chat/" + session.id);
    const input = page.getByRole("combobox", { name: "发送给环境 Agent" });
    await input.fill("@Road");
    await expect(page.getByRole("option").first()).toContainText("Release");
    await expect(page.getByRole("option").first()).toContainText("看板");
    await input.press("Tab");
    await input.press("Enter");
    await expect
      .poll(() => store.get("sessions", session.id).boardIds)
      .toEqual([board.id]);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      const rows = page.locator(".workbench-message-content article.message");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText("@Roadmap");
      await expect(rows.first()).not.toContainText("boardId");
      await expect(rows.last()).toContainText("Board received");
    }
    const draft = {
      boardId: board.id,
      title: "Release".repeat(20),
      summary: "Requirement",
      acceptance: "Acceptance",
    };
    await invoke("create", draft);
    await page.getByRole("button", { name: "查看详情", exact: true }).click();
    await expect(page.getByText("Acceptance", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "拒绝此项" }).click();
    expect(store.list("items")).toHaveLength(0);
    await invoke("create", draft);
    await page.getByRole("button", { name: "查看详情", exact: true }).click();
    await page.getByRole("button", { name: "批准此项" }).click();
    const open = page.getByRole("link", { name: "打开工作项" });
    await expect(open).toHaveCount(1);
    await open.focus();
    await open.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: draft.title }),
    ).toBeVisible();
    const item = store.list("items")[0];
    await page.goBack();
    await invoke("archive", { boardId: board.id, itemId: item.id });
    await page.getByRole("button", { name: "查看详情", exact: true }).click();
    await expect(dialog.getByText(item.id, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "批准此项" }).click();
    await expect.poll(() => store.get("items", item.id).archived).toBe(true);
    await open.click();
    await page.reload();
    await expect(dialog.getByText("已归档", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(open).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await changeServerLanguage(page, "en");
    await page.reload();
    const mobile = page.getByRole("link", { name: "Open work item" });
    await expect(mobile).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mobile.tap();
    await expect(dialog.getByText("Archived", { exact: true })).toBeVisible();
    await page.goto(
      options.publicUrl + "/#board/" + board.id + "/items/" + randomUUID(),
    );
    await expect(dialog.getByRole("alert")).toBeVisible();
    const other = service.save("boards", {
      name: "Roadmap",
      projectId: project.id,
      stages: defaultBoardStages(randomUUID(), randomUUID()),
    });
    await page.goto(
      options.publicUrl + "/#board/" + other.id + "/items/" + item.id,
    );
    await expect(dialog.getByRole("alert")).toContainText("unavailable");
  } finally {
    await page.close();
    await app.close();
    engine.close();
    local.close();
    await rm(dir, { recursive: true, force: true });
  }
});
