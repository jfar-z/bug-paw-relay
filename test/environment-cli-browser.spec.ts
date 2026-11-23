import { test, expect } from "@playwright/test";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.js";
import { WebSocket } from "ws";
import { nodeAuthVersion, nodeProofText } from "../src/shared/node-identity.js";
import { RpcPeer } from "../src/shared/rpc.js";
import { digest } from "../src/server/security.js";

/** 真实服务和 SQLite 上覆盖离线修改、双浏览器读取及会话入口过滤。 */
test("环境编码工具启停按环境隔离，旧表单由服务端拒绝", async ({
  page,
  browser,
}) => {
  const dataDir = mkdtempSync(join(tmpdir(), "relay-cli-policy-browser-"));
  const options = {
    dataDir,
    publicUrl: "http://127.0.0.1:3180",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store, service } = await createApp(options);
  const second = await browser.newContext();
  let socket: WebSocket | undefined;
  try {
    service.saveLanguage({ preference: "zh-CN" });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    options.publicUrl = base;
    store.put("users", { username: "fixture" }, "owner");
    for (const context of [page.context(), second]) {
      const value = randomUUID();
      store.db
        .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
        .run(digest(value), "owner", Date.now() + 600000);
      await context.addCookies([{ name: "relay_session", value, url: base }]);
    }
    const tools = {
      codex: { available: true, version: "fixture-codex" },
      claude: { available: true, version: "fixture-claude" },
    };
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const identity = publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const env = store.put("environments", {
      name: "Fixture A",
      tools,
      approved: true,
      publicKey: identity,
    });
    // 使用真实 WebSocket 认证和探测上报，RPC 结果使用测试夹具。
    let installs = 0;
    let installed = false;
    let finishInstall: (() => void) | undefined;
    const connect = async (supportsSdk = false) => {
      const ws = new WebSocket(
        base.replace("http:", "ws:") + "/api/node/connect",
      );
      socket = ws;
      const peer = new RpcPeer(
        (data) => ws.send(data),
        async (method, params) => {
          if (method === "identity.challenge")
            return peer.call("identity.authenticate", {
              authVersion: nodeAuthVersion,
              environmentId: env.id,
              signature: sign(
                null,
                Buffer.from(
                  nodeProofText(
                    params.audience,
                    "connect",
                    env.id,
                    identity,
                    "",
                    params.challenge,
                  ),
                ),
                privateKey,
              ).toString("base64"),
              protocol: 1,
              capabilities: supportsSdk ? ["claude-sdk-install-v1"] : [],
              roots: [],
              tools,
              platform: "linux/x64",
            });
          if (method === "claude.sdk.install") {
            installs++;
            await new Promise<void>((resolve) => {
              finishInstall = resolve;
            });
            installed = true;
          }
          if (method === "claude.sdk.install" || method === "claude.sdk.status")
            return {
              mode: "custom",
              version: "0.3.322",
              state: installed ? "installed" : "missing",
              installing: false,
            };
          return { events: [], interactions: [], status: "idle" };
        },
      );
      ws.on("message", (data) => void peer.receive(data.toString()));
      ws.once("close", () => peer.close());
      await expect.poll(() => service.peers.has(env.id)).toBe(true);
      return ws;
    };
    const initialConnection = await connect();
    const other = store.put("environments", {
      name: "Fixture B",
      tools,
      approved: true,
    });
    const directory = {
      environmentId: env.id,
      rootId: "root",
      relativePath: ".",
    };
    const project = service.save("projects", {
      name: "Fixture project",
      directories: [directory],
    });
    const agent = service.save("agents", {
      name: "Fixture role",
      environmentId: env.id,
      supportedRuntimes: ["codex", "claude"],
    });
    const session = service.createSession({
      title: "Fixture history",
      agentId: agent.id,
      projectId: project.id,
      ...directory,
      runtime: "codex",
    });

    const done = randomUUID();
    const board = service.save("boards", {
      name: "Fixture board",
      projectId: project.id,
      stages: [
        {
          id: randomUUID(),
          fixedRole: "start",
          name: "Start",
          type: "human",
          targets: [done],
        },
        {
          id: randomUUID(),
          name: "Run",
          type: "agent",
          agentId: agent.id,
          targets: [done],
          ...directory,
          runtime: "codex",
        },
        { id: done, name: "Done", type: "done", targets: [] },
      ],
    });
    const layout = `/#environments/${env.id}/tools`;
    const api = `/api/environments/${env.id}/runtime-settings`;
    const oldPage = await second.newPage();
    await oldPage.goto(base + "/#chat");
    const staleState = await (
      await second.request.get(base + "/api/state")
    ).json();
    await oldPage.route("**/api/state", (route) =>
      route.fulfill({ json: staleState }),
    );
    await oldPage
      .getByRole("button", { name: /新建会话.*Fixture project/ })
      .click();

    await oldPage
      .getByRole("option", { name: "Fixture role", exact: true })
      .click();
    const target = oldPage.getByRole("listbox");
    initialConnection.close();
    await expect.poll(() => service.peers.has(env.id)).toBe(false);
    await page.goto(base + layout);
    const disableCodex = page.getByRole("button", {
      name: "禁用 Codex",
      exact: true,
    });
    // 在实际工具页验证双列顶部对齐，切为单列后只保留网格行距。
    const grid = page.locator(".ui-card-grid").filter({ has: disableCodex });
    const panels = grid.locator(":scope > .ui-panel");
    await expect(panels).toHaveCount(2);
    const bounds = () => panels.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().toJSON()),
    );
    const [desktopCodex, desktopClaude] = await bounds();
    expect(desktopClaude.left).toBeGreaterThan(desktopCodex.right);
    expect(desktopClaude.top).toBe(desktopCodex.top);
    await page.setViewportSize({ width: 390, height: 844 });
    const [mobileCodex, mobileClaude] = await bounds();
    expect(mobileClaude.left).toBe(mobileCodex.left);
    expect(mobileClaude.top - mobileCodex.bottom).toBe(
      await grid.evaluate((element) => parseFloat(getComputedStyle(element).rowGap)),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    // 注入一次写入失败，其余读写均走真实服务。
    await page.route("**" + api, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 503, json: {} })
        : route.continue(),
    );
    await disableCodex.click();
    await expect(page.getByRole("alert")).toContainText("无法保存编码工具设置");
    await expect(disableCodex).toBeEnabled();
    await page.unroute("**" + api);
    await disableCodex.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "启用 Codex", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByText("fixture-codex", { exact: false }),
    ).toBeVisible();

    const rejection = oldPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/sessions") &&
        response.request().method() === "POST",
    );
    await target.getByRole("option", { name: "Codex", exact: true }).click();
    expect((await (await rejection).json()).code).toBe("CLI_DISABLED");
    await expect(oldPage.getByRole("alert")).toContainText(/禁用/);
    await oldPage.unroute("**/api/state");
    const oldConnector = await connect();
    await page.reload();
    await expect(page.getByText(/请升级连接器以在线安装 SDK/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "在线安装 SDK" }),
    ).toHaveCount(0);
    oldConnector.close();
    await expect.poll(() => service.peers.has(env.id)).toBe(false);
    await connect(true);
    await page.reload();
    const installSdk = page.getByRole("button", { name: "在线安装 SDK" });
    await expect(
      page.getByText(/Fixture A.*Claude Agent SDK 0.3.322/),
    ).toBeVisible();
    // 模拟浏览器丢失提交应答，只有重新检测后才能再次主动安装。
    await page.route("**/claude-sdk", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await installSdk.click();
    await expect(page.getByRole("alert")).toContainText("安装结果待确认");
    await expect(installSdk).toHaveCount(0);
    await page.unroute("**/claude-sdk");
    await page.getByRole("button", { name: "重新检测 SDK" }).click();
    await installSdk.focus();
    await page.keyboard.press("Enter");
    await expect(installSdk).toBeDisabled();
    await expect.poll(() => installs).toBe(1);
    finishInstall!();
    await expect(page.getByText("SDK 已安装", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("SDK 已安装", { exact: true })).toBeVisible();
    expect(installs).toBe(1);
    const blockedSend = await second.request.post(
      base + "/api/sessions/" + session.id + "/send",
      {
        headers: { origin: base },
        data: { operationId: randomUUID(), message: "Turn from an old page" },
      },
    );
    expect(blockedSend.status()).toBe(409);
    expect((await blockedSend.json()).code).toBe("CLI_DISABLED");
    await oldPage.reload();
    await oldPage
      .getByRole("button", { name: /新建会话.*Fixture project/ })
      .click();
    const created = oldPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/sessions") &&
        response.request().method() === "POST",
    );
    await oldPage
      .getByRole("option", { name: "Fixture role", exact: true })
      .click();
    const response = await created;
    expect(response.ok()).toBe(true);
    const { id } = await response.json();
    expect(store.get("sessions", id).runtime).toBe("claude");
    await expect(oldPage).toHaveURL(base + "/#chat/" + id);
    await expect(target).toHaveCount(0);
    await oldPage.goto(base + "/#environments");
    await expect(
      oldPage.locator(".ui-entity-card").filter({ hasText: "Fixture A" }),
    ).not.toContainText("codex");
    await expect(
      oldPage.locator(".ui-entity-card").filter({ hasText: "Fixture B" }),
    ).toContainText("codex");
    await expect(
      (
        await (
          await second.request.get(
            base + `/api/environments/${other.id}/runtime-settings`,
          )
        ).json()
      ).enabledRuntimes,
    ).toEqual(["codex", "claude"]);

    await oldPage.goto(base + "/#agents");
    await expect(
      oldPage.getByRole("checkbox", { name: "Codex", exact: true }),
    ).toHaveCount(0);
    await expect(
      oldPage.getByRole("checkbox", { name: "Claude Code", exact: true }),
    ).toBeChecked();
    expect(store.get("agents", agent.id).supportedRuntimes).toEqual([
      "codex",
      "claude",
    ]);
    await oldPage.goto(base + "/#board/" + board.id);
    await oldPage
      .getByRole("button", { name: "流程配置", exact: true })
      .click();
    await oldPage.locator(`[data-flow-stage="${board.stages[1].id}"]`).click();
    await expect(
      oldPage.getByText("已绑定的编码工具已禁用。", { exact: true }),
    ).toBeVisible();
    await expect(
      oldPage.getByRole("button", { name: "CLI 模型", exact: true }),
    ).toHaveCount(0);
    await oldPage.goto(base + "/#chat/" + session.id);
    await expect(
      oldPage.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
    await expect(
      oldPage.getByText("已绑定的编码工具已禁用。", { exact: true }),
    ).toBeVisible();
    await oldPage
      .getByRole("button", { name: "管理编码工具", exact: true })
      .click();
    await expect(oldPage).toHaveURL(base + layout);
    await expect(
      oldPage.getByRole("button", { name: "启用 Codex", exact: true }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "禁用 Claude Code", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "启用 Claude Code", exact: true }),
    ).toBeVisible();
    await oldPage.goto(base + "/#chat");
    await oldPage
      .getByRole("button", { name: /新建会话.*Fixture project/ })
      .click();
    await expect(
      oldPage.getByText("没有可选的编码工具。请在环境详情中启用工具。"),
    ).toBeVisible();

    const locale = await page.request.post(base + "/api/settings/language", {
      headers: { origin: base },
      data: { preference: "en" },
    });
    expect(locale.ok()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const enable = page.getByRole("button", {
      name: "Enable Codex",
      exact: true,
    });
    for (const theme of ["light", "dark", "bug"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(enable).toBeVisible();
      expect((await enable.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await enable.click();
    await expect(
      page.getByRole("button", { name: "Disable Codex", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Disable Codex", exact: true }),
    ).toBeVisible();
  } finally {
    socket?.terminate();
    await second.close();
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/** SDK 缺失说明覆盖列表与概览，使用真实页面读取隔离环境的探测记录。 */
test("Claude SDK 标签在窄屏及桌面可打开和关闭安装说明", async ({ browser }) => {
  const dataDir = mkdtempSync(join(tmpdir(), "relay-sdk-badge-"));
  const { app, store, service } = await createApp({
    dataDir,
    publicUrl: "https://relay.example",
    secureCookie: false,
    webDir: resolve("dist/web"),
  });
  const context = await browser.newContext({ hasTouch: true });
  try {
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    const token = randomUUID();
    store.put("users", { username: "fixture" }, "owner");
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(token), "owner", Date.now() + 600000);
    await context.addCookies([
      { name: "relay_session", value: token, url: base },
    ]);
    const env = store.put("environments", {
      name: "SDK fixture",
      approved: true,
      tools: {
        claude: { available: false, messageKey: "connector.support.required" },
      },
    });
    const page = await context.newPage();
    await page.goto(base);
    for (const locale of ["zh-CN", "en"]) {
      service.saveLanguage({ preference: locale });
      const label = locale === "en" ? "SDK not installed" : "SDK 未安装";
      const badge = page.getByRole("button", { name: label, exact: true });
      const note = page.getByRole("note", { name: label });
      for (const theme of ["bug", "dark", "light"]) {
        await page.evaluate(
          (value) => localStorage.setItem("relay-theme", value),
          theme,
        );
        await page.reload();
        for (const width of [320, 1440]) {
          await page.setViewportSize({ width, height: 800 });
          for (const route of ["environments", "environments/" + env.id]) {
            await page.goto(base + "/#" + route);
            await expect(badge).toBeVisible();
            await expect(note).toBeHidden();
            await badge.scrollIntoViewIfNeeded();
            expect(
              await badge.evaluate((el) => {
                const rect = el.getBoundingClientRect();
                const card = el
                  .closest(".ui-panel, .ui-entity-card")!
                  .getBoundingClientRect();
                return (
                  rect.left >= card.left &&
                  rect.right <= card.right &&
                  el.scrollWidth <= el.clientWidth
                );
              }),
            ).toBe(true);
            if (width === 320) await badge.tap();
            else await badge.click();
            await expect(note).toContainText("bugpaw-relay claude install");
            await expect(note).toBeInViewport({ ratio: 1 });
            expect(
              await page
                .locator(".content")
                .evaluate((el) => el.scrollWidth - el.clientWidth),
            ).toBe(0);
            await page.mouse.click(2, 2);
            await expect(note).toBeHidden();
            await badge.focus();
            await page.keyboard.press("Enter");
            await expect(note).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(note).toBeHidden();
            await expect(badge).toBeFocused();
          }
        }
      }
    }
    // 环境模式可用、CLI 缺失及未上报都沿用原状态呈现。
    for (const tools of [
      { claude: { available: true } },
      {
        claude: {
          available: false,
          messageKey: "connector.cli.missing",
          messageParams: { runtime: "claude" },
        },
      },
      {},
    ]) {
      store.put("environments", { ...env, tools }, env.id);
      await page.reload();
      await expect(
        page.getByText(env.name, { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "SDK not installed" }),
      ).toHaveCount(0);
    }
  } finally {
    await context.close();
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
