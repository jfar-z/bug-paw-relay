import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { ConnectorConfig } from "../src/connector/config.js";
import { environmentModelConfig } from "../src/connector/model-tools.js";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import { AppError } from "../src/shared/contracts.js";
import { modelConfigCapability } from "../src/shared/environment-model-config.js";

for (const width of [1440, 390]) {
  /** 覆盖真实页面和已认证 HTTP 路由，使用隔离的连接器配置验证回执。 */
  test(`环境模型配置与诊断 ${width}px`, async ({ page, context }) => {
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const dir = mkdtempSync(join(tmpdir(), "relay-env-model-browser-"));
    const publicUrl = "https://relay.example";
    const { app, store, service } = await createApp({
      dataDir: dir,
      publicUrl,
      secureCookie: false,
      webDir: resolve("dist/web"),
    });
    service.saveLanguage({ preference: "zh-CN" });
    const token = randomUUID();
    store.put("users", { username: "fixture" }, "owner");
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(token), "owner", Date.now() + 600000);
    const environment = store.put("environments", {
      name: "隔离测试环境",
      approved: true,
      capabilities: [modelConfigCapability],
      tools: {
        claude: {
          available: false,
          messageKey: "connector.runtime.claudeConfig",
        },
      },
    });
    const settings = new ConnectorConfig(join(dir, "connector"));
    const key = randomUUID();
    const endpoint = "https://provider.example";
    settings.update({ serverUrl: publicUrl });
    let dropSave = false;
    let releaseDiagnostic: () => void = () => {};
    let waitForDiagnostic: Promise<void> | undefined;
    service.peers.set(environment.id, {
      call: async (
        method: string,
        {
          operation,
          input,
        }: {
          operation: Parameters<typeof environmentModelConfig>[1];
          input: unknown;
        },
      ) => {
        expect(method).toBe("environment.modelConfig");
        if (operation === "models") {
          await waitForDiagnostic;
          return { models: ["fixture-model"] };
        }
        if (operation === "test")
          return {
            ok: true,
            elapsedMs: 12,
            protocol: "Messages",
          };
        const summary = await environmentModelConfig(
          settings,
          operation,
          input,
        );
        if (operation === "save" && dropSave)
          throw new AppError("OFFLINE", "offline");
        return summary;
      },
      close: () => {},
    } as any);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    await context.addCookies([
      { name: "relay_session", value: token, url: base },
    ]);
    // 在测试代理层设置公共入口源，浏览器请求仍经真实服务端权限和 HTTPS 配置检查。
    await page.route(/\/api\/(?:environments\/[^/]+\/model-config\/[^/]+|state\/query)$/, async (route) => {
      await route.fulfill({
        response: await route.fetch({
          headers: { ...route.request().headers(), origin: publicUrl },
        }),
      });
    });
    try {
      await page.goto(base + "/#environments/" + environment.id);
      await page.getByRole("button", { name: "编码工具", exact: true }).click();
      const configButton = page.getByRole("button", {
        name: "配置 Claude Code API",
      });
      await configButton.click();
      const dialog = page.getByRole("dialog");
      const url = dialog.getByLabel("API 基础地址");
      const model = dialog.getByLabel("模型标识");
      const save = dialog.getByRole("button", { name: "保存并下发" });
      const fetchModels = dialog.getByRole("button", { name: "获取模型列表" });
      await url.fill(endpoint);
      await dialog.getByRole("button", { name: "认证类型" }).click();
      await dialog.getByRole("option", { name: "Bearer Token" }).click();
      await dialog.getByLabel("Bearer Token").fill(key);
      waitForDiagnostic = new Promise<void>((resolve) => {
        releaseDiagnostic = resolve;
      });
      await fetchModels.click();
      await expect(dialog.getByText("目标环境正在获取模型列表…")).toBeVisible();
      await model.fill("manual");
      const staleResponse = page.waitForResponse((response) =>
        response.url().endsWith("/model-config/models"),
      );
      releaseDiagnostic();
      await staleResponse;
      await expect(
        dialog.getByRole("button", { name: "选择返回的模型" }),
      ).toHaveCount(0);
      await fetchModels.click();
      const chooser = dialog.getByRole("button", { name: "选择返回的模型" });
      await chooser.focus();
      await chooser.press("Enter");
      await dialog.getByRole("option", { name: "fixture-model" }).click();
      await expect(model).toHaveValue("fixture-model");
      await dialog.getByRole("button", { name: "测试连接" }).click();
      await expect(dialog.getByText(/Messages.*12/)).toBeVisible();
      expect(settings.read().claude.model).toBeFalsy();
      await save.click();
      await expect(dialog.getByText("目标环境已确认保存配置")).toBeVisible();
      await expect(dialog.getByLabel("Bearer Token")).toHaveValue("");
      await expect(
        dialog.getByText("环境已配置凭据，留空沿用本机凭据。"),
      ).toBeVisible();
      expect(settings.runtime().claude.model).toBe("fixture-model");
      await dialog.screenshot({
        path: `.vibe/playwright/environment-model-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(configButton).toBeFocused();
      await configButton.click();
      await expect(url).toHaveValue(endpoint);
      await url.fill(endpoint + "/new");
      await expect(save).toBeDisabled();
      // 凭据提示出现时，桌面同行输入框保持等高，手机保持单列和焦点。
      const credential = dialog.getByLabel("Bearer Token");
      await expect(
        dialog.getByText("环境已有凭据。变更端点或认证方式时，请填写新凭据。"),
      ).toBeVisible();
      await model.focus();
      await expect(model).toBeFocused();
      const credentialBox = (await credential.boundingBox())!;
      const modelBox = (await model.boundingBox())!;
      expect(modelBox.height).toBeCloseTo(credentialBox.height, 0);
      if (width === 1440) {
        expect(modelBox.y).toBeCloseTo(credentialBox.y, 0);
      } else {
        expect(modelBox.x).toBeCloseTo(credentialBox.x, 0);
        expect(modelBox.y).toBeGreaterThan(credentialBox.y + credentialBox.height);
      }
      await dialog.screenshot({
        path: `.vibe/playwright/environment-model-alignment-${width}.png`,
      });
      await url.fill(endpoint);
      await model.fill("unconfirmed-model");
      dropSave = true;
      await save.click();
      await expect(dialog.getByText(/下发结果未确认/)).toBeVisible();
      await expect(save).toBeDisabled();
      await dialog.getByRole("button", { name: "重新读取环境配置" }).click();
      await expect(
        dialog.getByText("已读取环境当前配置，编辑草稿仍可继续修改。"),
      ).toBeVisible();
      await expect(
        dialog.getByText("unconfirmed-model", { exact: true }),
      ).toBeVisible();
      await expect(save).toBeEnabled();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    } finally {
      releaseDiagnostic();
      // 先排空代理中的状态查询，再关闭测试服务。
      await page.unrouteAll({behavior:"wait"});
      await page.close();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
