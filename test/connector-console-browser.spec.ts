import { test, expect } from "@playwright/test";
import Fastify from "fastify";
import { messages } from "../src/shared/i18n.js";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** 真控制台加本地模型桩：验证 UI、鉴权、持久化及重启，不调用真实模型。 */
test("环境控制台模型选择、测试连接和主题重启恢复", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-console-browser-"));
  const claudeFixture = process.platform === "win32" ? "claude.cmd" : "claude";
  writeFileSync(join(dir, claudeFixture), process.platform === "win32"
    ? "@echo fixture-claude 1.0"
    : "#!/bin/sh\necho fixture-claude 1.0\n", { mode: 0o700 });
  let child: ChildProcess | undefined;
  const start = async () => {
    child = spawn(
      process.execPath,
      ["dist/connector/main.js", "web", "--no-open"],
      {
        env: { ...process.env, BUGPAW_HOME: dir, PATH: dir + delimiter + process.env.PATH },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("控制台启动超时")), 15000);
      child!.stdout!.on("data", (data) => {
        output += data.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#\S+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      child!.on("exit", () => {
        clearTimeout(timer);
        reject(Error("控制台提前退出"));
      });
    });
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  };
  const api = Fastify();
  let delay = false;
  api.get("/v1/models", async () => {
    if (delay) await new Promise((r) => setTimeout(r, 300));
    return { data: [{ id: "model-a" }, { id: "model-b" }] };
  });
  api.post("/v1/responses", async () => ({
    object: "response",
    status: "completed",
    output: [],
  }));
  api.post("/v1/messages", async () => ({
    type: "message",
    content: [{ type: "text", text: "OK" }],
  }));
  await api.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(api.server.address() as any).port}`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const url = await start();
    await page.goto(url);
    await expect(page.locator("#message")).toHaveText("配置已读取");
    const unauthorized = await page.request.post(
      new URL("/api/models", url).href,
      { data: {} },
    );
    expect(unauthorized.ok()).toBe(false);
    await page.getByRole("button", { name: "深色主题", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("#message")).toHaveText("配置已读取");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // 新安装必须显式配置部署地址，模型设置不再依赖私人域名默认值。
    await expect(page.locator("#serverUrl")).toHaveValue("");
    await page.getByRole("tab", { name: "CLI 工具" }).click();
    await page.getByRole("radio", { name: "使用环境 Claude Code" }).check();
    await page.locator("#claudeModeSave").click();
    await expect(page.locator("#claudeSupportNext")).toContainText("/login");
    await page.getByRole("radio", { name: "自定义 API 端点" }).check();
    await page.getByRole("tab", { name: "概览" }).click();
    await page.locator("#serverUrl").fill(base);
    await page.locator("#save").click();
    await expect(page.locator("#message")).toHaveText("操作成功");
    await page.getByRole("tab", { name: "CLI 工具" }).click();
    // 使用本地配置接口往返保存，验证清空后可以恢复 PATH 查找。
    for (const runtime of ["codex", "claude"]) {
      await expect(page.locator("#" + runtime + "Command")).toHaveValue("");
      await page.locator("#" + runtime + "Command").fill("/tools/" + runtime);
    }
    await page.locator("#save").click();
    await expect(page.locator("#message")).toHaveText("操作成功");
    await page.reload();
    await page.getByRole("tab", { name: "CLI 工具" }).click();
    for (const runtime of ["codex", "claude"]) {
      const input = page.locator("#" + runtime + "Command");
      await expect(input).toHaveValue("/tools/" + runtime);
      await input.fill("");
    }
    await page.locator("#codexUrl").fill("http://192.168.100.2/v1");
    await expect(page.locator("#codexHttpHint")).toBeVisible();
    await page.locator("#codexUrl").fill("http://localhost/v1");
    await expect(page.locator("#codexHttpHint")).toBeHidden();
    await page.locator("#codexUrl").fill(base + "/v1");
    await page.locator("#codexKey").fill("fixture-browser-key");
    await page.locator("#codexFetch").click();
    await expect(page.locator("#codexFeedback")).toContainText(
      "已获取 2 个模型",
    );
    await page.locator("#codexChoose").press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator("#codexModel")).toHaveValue("model-b");
    await expect(page.locator("#codexChoose")).toBeFocused();
    await page.locator("#codexTest").click();
    await expect(page.locator("#codexFeedback")).toContainText(
      "连接成功 · Responses",
    );
    await page.locator("#claudeUrl").fill(base);
    await page.locator("#claudeKey").fill("fixture-browser-key");
    await page.locator("#claudeFetch").click();
    await expect(page.locator("#claudeFeedback")).toContainText(
      "已获取 2 个模型",
    );
    await page.locator("#claudeChoose").click();
    await page.getByRole("option", { name: "model-a", exact: true }).click();
    await page.locator("#claudeTest").click();
    await expect(page.locator("#claudeFeedback")).toContainText(
      "连接成功 · Messages",
    );
    await page.locator("#codexChoose").click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#codexModels")).toBeHidden();
    await page.locator("#save").click();
    await expect(page.locator("#message")).toHaveText("操作成功");
    for (const runtime of ["codex", "claude"]) {
      await expect(page.locator("#" + runtime + "Command")).toHaveValue("");
    }
    await expect(page.locator("#codexKey")).toHaveValue("");
    const plan = page.locator("#claudeInstallPlan");
    await expect(plan.getByRole("listitem")).toHaveCount(1);
    await expect(plan).toContainText("registry.npmjs.org");
    await expect(plan).toContainText("components/claude-sdk/0.3.322");
    await expect(page.locator("#claudeCliStatus")).toContainText("fixture-claude 1.0");
    await expect(page.locator("#claudeAccount")).not.toBeEmpty();
    // 环境模式只检查可执行程序，存盘与重启后保留另一种模式的凭据。
    const nativeMode = page.getByRole("radio", { name: "使用环境 Claude Code" });
    await nativeMode.check();
    await expect(page.locator("#claudeUrl")).toBeHidden();
    await expect(page.locator("#claudeFetch")).toBeHidden();
    await expect(page.locator("#claudeTest")).toBeHidden();
    await page.locator("#claudeCommand").fill("/missing/claude-fixture");
    await page.getByRole("button", { name: "检查环境", exact: true }).click();
    await expect(page.locator("#claudeCheckFeedback")).toContainText("找不到 claude");
    await page.locator("#claudeModeSave").click();
    await expect(page.locator("#claudePathError")).toBeVisible();
    await expect(page.locator("#claudeInstall")).toBeHidden();
    await expect(page.locator("#claudeCommand")).toHaveAttribute("aria-invalid", "true");
    await page.locator("#claudeCommand").fill("");
    await page.getByRole("button", { name: "检查环境", exact: true }).click();
    await expect(page.locator("#claudeCheckFeedback")).toContainText("CLI 可运行");
    await page.locator("#save").click();
    await expect(page.locator("#message")).toHaveText("操作成功");
    await stop();
    await page.goto(await start());
    await page.getByRole("tab", { name: "CLI 工具" }).click();
    await expect(nativeMode).toBeChecked();
    await expect(page.locator("#claudeSdkStatus")).toContainText("此模式无需安装");
    await expect(page.locator("#claudeSupportNext")).toContainText("/login");
    await expect(page.locator("#claudeInstall")).toBeHidden();
    await expect(page.locator("#claudeUrl")).toBeHidden();
    await page.getByRole("radio", { name: "自定义 API 端点" }).check();
    await expect(page.locator("#claudeUrl")).toHaveValue(base);
    await expect(page.locator("#claudeKey")).toHaveValue("");
    await page.locator("#claudeTest").click();
    await expect(page.locator("#claudeFeedback")).toContainText("连接成功");
    await page.locator("#save").click();
    await expect(page.locator("#message")).toHaveText("操作成功");
    await page.locator("#codexTest").click();
    await expect(page.locator("#codexFeedback")).toContainText("连接成功");
    delay = true;
    await page.locator("#codexFetch").click();
    await page.locator("#codexUrl").fill(base + "/changed");
    await expect(page.locator("#codexFetch")).toBeEnabled();
    await expect(page.locator("#codexChoose")).toBeDisabled();
    await expect(page.locator("#codexFeedback")).toHaveText("");
    await page.locator("#codexTest").click();
    await expect(page.locator("#codexFeedback")).toContainText(
      messages["errors.KEY_REQUIRED.the.api.url.has.changed.re"]["zh-CN"],
    );
    await page.locator("#codexUrl").fill(base + "/v1");
    await page.locator("#save").click();
    await expect(page.locator("#message")).toHaveText("操作成功");
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, value] of [
        ["浅色", "light"],
        ["深色", "dark"],
        ["BUG", "bug"],
      ]) {
        await page
          .getByRole("button", { name: name + "主题", exact: true })
          .click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          await page
            .locator('.theme-switch button[aria-pressed="true"]')
            .count(),
        ).toBe(1);
        expect(
          await page
            .locator(".theme-switch button")
            .evaluateAll((buttons) =>
              buttons.map((b) =>
                getComputedStyle(b).getPropertyValue("--canvas"),
              ),
            ),
        ).toEqual(
          Array(3).fill(
            await page
              .locator("html")
              .evaluate((e) =>
                getComputedStyle(e).getPropertyValue("--canvas"),
              ),
          ),
        );
        expect(
          await page.evaluate(() => localStorage.getItem("relay-theme")),
        ).toBe(value);
        const box = await page.locator(".language-control").boundingBox();
        expect(box!.x + box!.width).toBeGreaterThan(width - 35);
        await page.mouse.move(0, 0);
        expect(
          await page
            .locator(".brand img")
            .evaluate((e: HTMLImageElement) => e.naturalWidth),
        ).toBeGreaterThan(0);
        await page.screenshot({
          path: `.vibe/connector-console-${width}-${value}.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    // 页面只模拟未知控制接口的响应；真实身份拒绝由 node-security 用例验证。
    await page.route("**/api/status", (route) => route.fulfill({ json: {
      running: true, status: "unknown", registered: true,
    } }));
    await page.route("**/api/stop", (route) => route.fulfill({ status: 409, json: {
      code: "WORKER_UNREACHABLE", messageKey: "connector.workerUnreachable",
    } }));
    for (const [locale, label, status] of [
      ["zh-CN", "简体中文", "状态未知，请检查本机控制接口"],
      ["en", "English", "Status unknown; check the local control interface"],
    ] as const) {
      await page.locator("#language-toggle").click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await expect(page.locator("#status")).toContainText(status);
      await expect(page.locator("#start")).toBeDisabled();
      await page.locator("#stop").click();
      await page.locator("#confirm-stop").click();
      await expect(page.locator("#message")).toHaveText(messages["connector.workerUnreachable"][locale]);
    }
    await page.unroute("**/api/status");
    await page.unroute("**/api/stop");
    await page.locator("#language-toggle").click();
    await page.getByRole("option", { name: "简体中文", exact: true }).click();
    await stop();
    const restarted = await start();
    expect(new URL(restarted).origin).toBe(new URL(url).origin);
    await page.goto(restarted);
    await expect(page.locator("#message")).toHaveText("配置已读取");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "bug");
    expect(errors).toEqual([]);
    await stop();
    const occupied = Fastify();
    await occupied.listen({
      host: "127.0.0.1",
      port: Number(new URL(restarted).port),
    });
    try {
      const fallback = await start();
      expect(new URL(fallback).origin).not.toBe(new URL(restarted).origin);
      await page.goto(fallback);
      await expect(page.locator("#message")).toHaveText("配置已读取");
      expect(occupied.server.listening).toBe(true);
    } finally {
      await occupied.close();
    }
  } finally {
    await stop();
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
