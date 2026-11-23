import { changeServerLanguage } from "./browser-language.js";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import { Store } from "../src/server/store.js";
import { Engine } from "../src/connector/engine.js";
import { attachmentMessage } from "../src/shared/uploads.js";

/** 真实浏览器/HTTP/连接器落盘；原生回合和历史使用受控协议替身，不声称模型验收。 */
for (const runtime of ["codex", "claude"] as const)
  test(`附件选择、失败重试、取消、粘贴、仅附件发送与原生历史恢复 / ${runtime}`, async ({
    page,
    context,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), "relay-attachment-browser-"));
    const root = join(dir, "project");
    await mkdir(root);
    const local = new Store(join(dir, "connector.db"));
    const engine = new Engine(
      local,
      () => ({ roots: [{ id: "root", path: root }] }),
      () => {},
      async () => ({}),
    );
    const appOptions = {
      dataDir: join(dir, "server"),
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
      name: "附件环境",
      approved: true,
      revoked: false,
      capabilities: [
        "file-push-v1",
        "files-v1",
        "mentions-v1",
        "runtime-options-v1",
      ],
      tools: { codex: true, claude: true },
      roots: [{ id: "root", path: root }],
    });
    const project = service.save("projects", {
      name: "附件项目",
      directories: [
        { environmentId: env.id, rootId: "root", relativePath: "." },
      ],
    });
    const starts: any[] = [],
      history: any[] = [];
    let catalogCalls = 0;
    let historyStatus = "idle";
    let delay = 0,
      fail = false;
    const peer = {
      call: async (method: string, params: any) => {
        if (method === "runtime.catalog") {
          catalogCalls++;
          return {
            models: [
              {
                id: "model-long-name-for-toolbar-validation",
                name: "Model",
                efforts: ["low", "high"],
              },
            ],
            defaults: {},
          };
        }
        if (method === "session.history")
          return {
            nativeHistory:
              runtime === "codex"
                ? { thread: { turns: history } }
                : history.map((turn) => ({
                    type: "user",
                    uuid: turn.id,
                    message: {
                      content: turn.items[0].content.map((c: any) => ({
                        type: "text",
                        text: c.text,
                      })),
                    },
                  })),
            events: [],
            status: historyStatus,
            interactions: [],
          };
        if (method === "execution.start") {
          starts.push(params);
          history.push({
            id: params.executionId,
            items: [
              {
                id: params.operationId,
                type: "userMessage",
                content: [
                  {
                    type: "input_text",
                    text: attachmentMessage(
                      params.message,
                      params.attachments || [],
                    ),
                  },
                ],
              },
            ],
          });
          return { status: "completed", stateVersion: 1 };
        }
        if (method === "files.push.write") {
          if (delay) await new Promise((r) => setTimeout(r, delay));
          if (fail)
            throw Object.assign(new Error("fixture"), {
              code: "UPLOAD_WRITE",
              messageKey: "uploads.write",
            });
        }
        if (method.startsWith("files.") || method === "mentions.search")
          return engine.call(method, params);
        return {};
      },
      close: () => {},
    };
    service.peers.set(env.id, peer as any);
    const session = service.createSession({
      agentId: service.save("agents", { name: "Fixture agent" }).id,
      title: "附件会话",
      projectId: project.id,
      environmentId: env.id,
      rootId: "root",
      relativePath: ".",
      runtime,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    appOptions.publicUrl = base;
    await context.addCookies([
      { name: "relay_session", value: cookie, url: base },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let png: Buffer;
    try {
      await page.goto(base + "/#chat/" + session.id);
      png = Buffer.from(
        await page.evaluate(async () => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 48;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#5f7088";
          ctx.fillRect(0, 0, 48, 48);
          const blob = await new Promise<Blob>((resolve) =>
            canvas.toBlob((blob) => resolve(blob!), "image/png"),
          );
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }),
      );
      const chooser = page.locator("input[type=file][multiple]");
      const send = page.getByRole("button", { name: "发送", exact: true });
      const draft = page.getByRole("combobox", { name: "发送给环境 Agent" });
      await expect(send).toBeDisabled();
      delay = 300;
      await chooser.setInputFiles([
        {
          name: "说明 (1).txt",
          mimeType: "text/plain",
          buffer: Buffer.from("attachment content".repeat(30000)),
        },
        { name: "图片.png", mimeType: "image/png", buffer: png },
      ]);
      await expect(
        page.getByText("正在上传", { exact: false }).first(),
      ).toBeVisible();
      await expect(send).toBeDisabled();
      await expect(page.locator(".attachment-item")).toHaveCount(2);
      await expect(send)
        .toBeEnabled({ timeout: 20000 })
        .catch(async (e) => {
          console.log(await page.locator(".attachment-strip").innerText());
          throw e;
        });
      expect(starts).toHaveLength(0);
      await expect(page.locator(".attachment-strip img")).toHaveCount(1);
      await expect
        .poll(() =>
          page
            .locator(".attachment-strip img")
            .evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBe(48);
      // 单文件失败不影响已有引用和文字；重试显式触发。
      await draft.fill("保留说明");
      fail = true;
      await chooser.setInputFiles({
        name: "失败.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("retry"),
      });
      await expect(
        page.getByRole("button", { name: "重新上传 失败.txt" }),
      ).toBeVisible();
      await expect(send).toBeDisabled();
      await expect(draft).toHaveValue("保留说明");
      fail = false;
      await page.getByRole("button", { name: "重新上传 失败.txt" }).click();
      await expect(send).toBeEnabled();
      await page.getByRole("button", { name: "取消或移除 失败.txt" }).click();
      await chooser.setInputFiles({
        name: "取消.txt",
        mimeType: "text/plain",
        buffer: Buffer.alloc(800000),
      });
      await page.getByRole("button", { name: "取消或移除 取消.txt" }).click();
      await expect(page.locator(".attachment-item")).toHaveCount(2);
      await expect(send).toBeEnabled();
      await expect
        .poll(
          async () =>
            (await readdir(join(root, "attachments"))).filter((n) =>
              n.startsWith(".relay-upload-"),
            ).length,
        )
        .toBe(0);
      // 同一组真实配置接口连续操作；响应式布局和菜单开关不重发能力请求或上传。
      const toolbar = page.locator(".session-composer-toolbar");

      await expect(
        toolbar.getByRole("button", { name: "添加附件", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "会话配置", exact: true }),
      ).toHaveCount(0);
      const initialCatalogCalls = catalogCalls;
      for (const width of [320, 390, 900]) {
        await page.setViewportSize({ width, height: 640 });
        const config = page.getByRole("button", {
          name: "会话配置",
          exact: true,
        });
        await expect(config).toBeVisible();
        await expect(config).toHaveAttribute("aria-expanded", "false");
        const closedHeight = (await toolbar.boundingBox())!.height;
        await config.click();
        await expect(config).toHaveAttribute("aria-expanded", "true");
        const region = page.getByRole("region", { name: "会话配置" });
        await expect(region).toBeVisible();
        // 第二行占用真实高度，窄屏保留头像和其余图标。
        const rowBox = (await region.boundingBox())!;
        const triggerBox = (await config.boundingBox())!;
        const attachmentBox = (await toolbar
          .getByRole("button", { name: "添加附件", exact: true })
          .boundingBox())!;
        expect(triggerBox.x).toBeLessThan(attachmentBox.x);
        expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(triggerBox.y);
        expect((await toolbar.boundingBox())!.height).toBeGreaterThan(
          closedHeight + 30,
        );
        expect(
          await region.evaluate((el) => getComputedStyle(el).position),
        ).toBe("static");
        const controls = region.locator("button");
        await expect(controls).toHaveCount(4);
        const boxes = await controls.evaluateAll((els) =>
          els.map((el) => ({
            y: el.getBoundingClientRect().y,
            text: el.textContent,
            svg: !!el.querySelector("svg"),
          })),
        );
        expect(
          Math.max(...boxes.map((b) => b.y)) -
            Math.min(...boxes.map((b) => b.y)),
        ).toBeLessThan(3);
        await expect(controls.first().locator(".identity-avatar")).toHaveText("F");
        for (const index of [2, 3]) {
          expect(boxes[index].text).toBe("");
          expect(boxes[index].svg).toBe(true);
        }
        await draft.click();
        await expect(region).toBeVisible();
        await page
          .locator(".attachment-strip")
          .click({ position: { x: 1, y: 1 } });
        await expect(region).toBeVisible();
        await page
          .getByRole("button", { name: "会话 Agent", exact: true })
          .click();
        await page.keyboard.press("Escape");
        await expect(region).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(config).toBeFocused();
        await config.press("ArrowUp");
        await expect(region).toBeVisible();
        await config.click();
        await expect(region).toBeHidden();
        await expect(draft).toHaveValue("保留说明");
        await expect(page.locator(".attachment-item")).toHaveCount(2);
        expect(
          await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
      }
      expect(catalogCalls).toBe(initialCatalogCalls);
      await page.setViewportSize({ width: 390, height: 640 });
      const config = page.getByRole("button", {
        name: "会话配置",
        exact: true,
      });
      await config.click();
      await page.getByRole("button", { name: "CLI 模型", exact: true }).click();
      await page.getByRole("option", { name: /model-long-name/ }).click();
      await expect(
        page.getByRole("region", { name: "会话配置" }),
      ).toBeVisible();
      await expect
        .poll(
          () => store.get<any>("sessions", session.id)?.runtimeOptions?.model,
        )
        .toBe("model-long-name-for-toolbar-validation");
      await page
        .getByRole("button", { name: "CLI 思考深度", exact: true })
        .click();
      await page.getByRole("option", { name: "high", exact: true }).click();
      await expect
        .poll(
          () => store.get<any>("sessions", session.id)?.runtimeOptions?.effort,
        )
        .toBe("high");
      await page.getByRole("button", { name: "CLI 模型", exact: true }).click();
      await page
        .getByRole("option", { name: "手动输入模型 ID…", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "会话配置" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "刷新模型能力", exact: true })
        .click();
      await expect.poll(() => catalogCalls).toBe(initialCatalogCalls + 1);
      // 保存失败保留服务端有效值，关闭菜单不撤销成功配置。
      await page.route("**/api/sessions/*/config", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: "{}",
        }),
      );
      await page
        .getByRole("button", { name: "CLI 思考深度", exact: true })
        .click();
      await page.getByRole("option", { name: "low", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "CLI 思考深度", exact: true }),
      ).toHaveAttribute("title", /high/);
      await expect(page.getByRole("alert").last()).toBeVisible();
      expect(
        store.get<any>("sessions", session.id)?.runtimeOptions?.effort,
      ).toBe("high");
      await page.unroute("**/api/sessions/*/config");
      await page
        .getByRole("button", { name: "会话 Agent", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Fixture agent", exact: true })
        .click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.route(
        "**/api/environments/*/runtime-catalog",
        async (route) => {
          await new Promise((r) => setTimeout(r, 500));
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: "{}",
          });
        },
      );
      const refresh = page.getByRole("button", {
        name: "刷新模型能力",
        exact: true,
      });
      await refresh.click();
      await expect(refresh).toBeDisabled();
      await expect(refresh).toHaveAttribute("aria-busy", "true");
      await expect(page.locator(".runtime-toolbar-warning")).toBeVisible();
      await page.unroute("**/api/environments/*/runtime-catalog");
      await refresh.click();
      await expect(page.locator(".runtime-toolbar-warning")).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 360 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await refresh.scrollIntoViewIfNeeded();
      const menuBox = await page
        .getByRole("region", { name: "会话配置" })
        .boundingBox();
      expect(menuBox!.y).toBeGreaterThanOrEqual(7);
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(360);
      await refresh.click();
      await page.setViewportSize({ width: 390, height: 640 });

      await page
        .getByRole("heading", { name: "附件会话", exact: true })
        .click();
      await expect(config).toHaveAttribute("aria-expanded", "false");
      await config.click();
      await page.getByRole("button", { name: "CLI 模型", exact: true }).click();
      await expect(
        page.getByRole("listbox", { name: "CLI 模型" }),
      ).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(page.getByRole("listbox", { name: "CLI 模型" })).toHaveCount(
        0,
      );
      await expect(config).toHaveCount(0);
      // 360px、三主题、英文长文案及键盘焦点；视口缩短模拟软键盘占用，不冒充手机实机。
      await page.setViewportSize({ width: 360, height: 640 });
      await page.mouse.move(350, 0);
      await page.waitForTimeout(300);
      for (const theme of ["light", "dark", "bug"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        const strip = page.locator(".attachment-strip");
        expect(await strip.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(
          true,
        );
        await config.click();
        await expect(
          page.getByRole("region", { name: "会话配置" }),
        ).toBeVisible();
        await page.waitForTimeout(250);
        await page.screenshot({
          path: `.vibe/attachments-${runtime}-${theme}-360.png`,
          animations: "disabled",
        });
        await config.click();
      }
      await changeServerLanguage(page, "en");
      await page.setViewportSize({ width: 320, height: 640 });
      await expect(
        page.getByRole("button", { name: "Add attachments", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Send to environment agent" }),
      ).toHaveValue("保留说明");
      await page
        .getByRole("button", { name: "Session configuration", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "CLI reasoning depth", exact: true }),
      ).toHaveAttribute("title", /high/);
      const toolbarOverflow = await toolbar.evaluate((el) => {
        const right = el.getBoundingClientRect().right;
        return {
          width: el.clientWidth,
          scroll: el.scrollWidth,
          overflowing: Array.from(el.querySelectorAll("*"))
            .filter((node) => node.getBoundingClientRect().right > right + 1)
            .map((node) => ({
              class: node.className,
              width: node.getBoundingClientRect().width,
              right: node.getBoundingClientRect().right,
            })),
        };
      });
      expect(
        toolbarOverflow.scroll,
        JSON.stringify(toolbarOverflow),
      ).toBeLessThanOrEqual(toolbarOverflow.width);
      await page.screenshot({
        path: `.vibe/attachments-${runtime}-english-320.png`,
      });
      await page
        .getByRole("button", { name: "Session configuration", exact: true })
        .click();

      await changeServerLanguage(page, "zh-CN");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await draft.fill("");
      // 受理后丢失 HTTP 响应；相同附件重试沿用编号，环境启动仅一次。
      let lose = true;
      const ids: string[] = [];
      await page.route("**/api/sessions/*/send", async (route) => {
        ids.push(route.request().postDataJSON().operationId);
        const response = await route.fetch();
        if (lose) {
          lose = false;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: "{}",
          });
        } else await route.fulfill({ response });
      });
      await send.click();
      await expect(page.locator(".attachment-item")).toHaveCount(2);
      await expect(send).toBeEnabled();
      await send.click();
      await expect(page.locator(".attachment-item")).toHaveCount(0);
      expect(ids[0]).toBe(ids[1]);
      expect(starts).toHaveLength(1);
      expect(starts[0].message).toBe("");
      for (const attachment of starts[0].attachments) {
        const bytes = await readFile(join(root, attachment.path));
        expect(bytes.length).toBe(attachment.size);
      }
      await page.reload();
      await expect(page.locator(".user-message .attachment-open")).toHaveCount(
        2,
      );
      await expect(page.locator(".user-message img")).toHaveCount(1);
      const thumbnail = await page
        .locator(".user-message img")
        .getAttribute("src");
      await page.waitForTimeout(5300);
      await expect(page.locator(".user-message img")).toHaveAttribute(
        "src",
        thumbnail!,
      );

      await page.locator(".user-message .attachment-open").first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
      // @ 从真实附件目录搜索，不产生新的上传。
      await draft.fill("@图片");
      await expect(page.getByRole("option").first()).toContainText("图片.png");
      await draft.press("Tab");
      await expect(page.locator(".mention-highlight mark")).toHaveCount(1);
      await draft.fill("");
      // 拖放使用 DataTransfer，粘贴使用真实浏览器剪贴板。
      await draft.dispatchEvent("drop", {
        dataTransfer: await page.evaluateHandle(() => {
          const data = new DataTransfer();
          data.items.add(
            new File(["drop"], "拖放.txt", { type: "text/plain" }),
          );
          return data;
        }),
      });
      await expect(page.locator(".attachment-item")).toHaveCount(1);
      await draft.focus();
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.evaluate(async (bytes) => {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": new Blob([new Uint8Array(bytes)], {
              type: "image/png",
            }),
            "text/plain": new Blob(["mixed text"], { type: "text/plain" }),
          }),
        ]);
      }, Array.from(png));
      await page.keyboard.press("Control+V");
      await expect(draft).toHaveValue("mixed text");
      await expect(page.locator(".attachment-item")).toHaveCount(2);
      await expect(send).toBeEnabled();
      await chooser.setInputFiles(
        Array.from({ length: 17 }, (_, index) => ({
          name: `empty-${index}.txt`,
          mimeType: "text/plain",
          buffer: Buffer.alloc(0),
        })),
      );
      await expect(page.getByText(/无法添加所选文件/)).toBeVisible();
      await expect(page.locator(".attachment-item")).toHaveCount(2);
      await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
      );
      expect(
        await page.evaluate(async () => {
          const entries = await Promise.all(
            (await caches.keys()).map(async (key) =>
              (await (await caches.open(key)).keys()).map((r) => r.url),
            ),
          );
          return entries.flat().some((url) => /\/api\//.test(url));
        }),
      ).toBe(false);
      delay = 700;
      await chooser.setInputFiles({
        name: "中断.txt",
        mimeType: "text/plain",
        buffer: Buffer.alloc(900000),
      });
      await context.setOffline(true);
      await expect(
        page.getByRole("button", { name: "重新上传 中断.txt" }),
      ).toBeVisible();
      await expect(send).toBeDisabled();
      await context.setOffline(false);
      await page.getByRole("button", { name: "取消或移除 中断.txt" }).click();
      await expect(draft).toHaveValue("mixed text");
      // 旧连接器只禁用上传，不妨碍文字。
      store.put(
        "environments",
        { capabilities: ["files-v1", "mentions-v1"] },
        env.id,
      );
      await page.reload();
      await expect(
        page.getByRole("button", { name: "添加附件", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByText("请升级环境连接器后再上传附件。", { exact: true }),
      ).toBeVisible();
      await draft.fill("普通消息");
      await expect(send).toBeEnabled();
      // 运行中仍可查看配置，刷新与保存保持各自的门禁；停止留在底栏。
      historyStatus = "running";
      store.put(
        "sessions",
        { executionId: "fixture-running", status: "running" },
        session.id,
      );
      await page.reload();
      await page.setViewportSize({ width: 320, height: 640 });
      await page.getByRole("button", { name: "会话配置", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "CLI 模型", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "会话 Agent", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "刷新模型能力", exact: true }),
      ).toBeEnabled();
      await expect(
        toolbar.getByRole("button", { name: "停止", exact: true }),
      ).toBeVisible();
      expect(
        await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      historyStatus = "idle";
      store.put(
        "sessions",
        { executionId: null, status: "idle", archived: true },
        session.id,
      );
      await page.reload();
      await page.getByRole("button", { name: "会话配置", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "CLI 模型", exact: true }),
      ).toBeDisabled();
      await expect(send).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "刷新模型能力", exact: true }),
      ).toBeEnabled();
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      await app.close();
      engine.close();
      local.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
