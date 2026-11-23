import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { digest, passwordHash, totp, token } from "../src/server/security.js";

/** 多审批真实 HTTP 状态与窄屏控件回归，不调用外部模型。 */
test("逐项审批仅记录选中操作并更新剩余数量", async ({ page, context }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-approval-browser-"));
  const options = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store } = await createApp(options);
  store.put("users", { username: "fixture" }, "owner");
  const cookie = randomUUID();
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const model = store.put("models", { name: "测试模型" });
  const w = store.put("workbench", {
    title: "审批专项",
    modelId: model.id,
    permission: "ask",
    status: "approval",
    transcript: [],
    approvals: [
      { index: 0, callId: "a", name: "创建工作项", arguments: "项目 A" },
      { index: 1, callId: "b", name: "修改智能体", arguments: "环境 B" },
    ],
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  options.publicUrl = `http://127.0.0.1:${(app.server.address() as any).port}`;
  await context.addCookies([
    { name: "relay_session", value: cookie, url: options.publicUrl },
  ]);
  try {
    await page.goto(options.publicUrl + "/#workbench/" + w.id);
    await expect(
      page.getByRole("button", { name: "全部批准（2 项）" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "拒绝此项" }).first().click();
    await expect(page.getByText("已拒绝", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "全部批准（1 项）" }),
    ).toBeVisible();
    expect(store.get("workbench", w.id).status).toBe("approval");
    expect(store.get("workbench", w.id).approvals[1].decision).toBeUndefined();
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "批准此项" })).toBeVisible();
    await expect(page.getByText("已拒绝", { exact: true })).toBeVisible();
    await page.screenshot({ path: ".vibe/approval-390.png", fullPage: true });
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 真实浏览器覆盖独立密码弹窗、二维码以及两步登录；临时账号不接触部署数据。 */
test("账号安全独立密码弹窗、二维码和分步登录", async ({ page, context }) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-totp-browser-"));
  const options = {
    dataDir: dir,
    publicUrl: "http://127.0.0.1",
    webDir: resolve("dist/web"),
    secureCookie: false,
  };
  const { app, store } = await createApp(options);
  const password = token();
  store.put(
    "users",
    { username: "fixture", password: passwordHash(password), lastTotp: 0 },
    "owner",
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  options.publicUrl = `http://127.0.0.1:${(app.server.address() as any).port}`;
  try {
    await page.goto(options.publicUrl);
    await expect(page.getByLabel("二要素验证码", { exact: true })).toHaveCount(
      0,
    );
    await page.getByLabel("账号", { exact: true }).fill("fixture");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.locator(".login")).toHaveCount(0);
    await page.goto(options.publicUrl + "/#settings");
    await page.getByRole("button", { name: "账号与安全", exact: true }).click();
    await page
      .getByLabel("当前密码", { exact: true })
      .fill("must-not-be-reused");
    const generate = page.getByRole("button", {
      name: "生成二要素密钥",
      exact: true,
    });
    await generate.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("登录密码")).toHaveValue("");
    await expect(dialog.getByLabel("登录密码")).toBeFocused();
    await dialog.getByLabel("登录密码").fill("incorrect");
    await dialog.getByRole("button", { name: "验证并生成密钥" }).click();
    await expect(dialog.getByRole("alert")).toContainText("密码不正确");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(generate).toBeFocused();
    await generate.click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("登录密码")).toHaveValue("");
    await dialog.getByLabel("登录密码").fill(password);
    await dialog.getByRole("button", { name: "验证并生成密钥" }).click();
    const qr = page.getByRole("img", { name: "二要素验证器绑定二维码" });
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute("src", /^data:image\/png;base64,/);
    expect(await qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(
      240,
    );
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue(
      "must-not-be-reused",
    );
    const secret = await page.locator(".config-block code").innerText();
    await qr.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".vibe/totp-settings-1440.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await qr.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const box = await qr.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= 390;
      })
      .toBe(true);
    await page.screenshot({
      path: ".vibe/totp-settings-390.png",
      animations: "disabled",
      fullPage: true,
    });
    await page
      .getByLabel("验证码", { exact: true })
      .fill(totp(secret).generate());
    await page.getByRole("button", { name: "确认启用", exact: true }).click();
    await expect(qr).toHaveCount(0);
    await context.clearCookies();
    await page.goto(options.publicUrl);
    await page.getByLabel("账号", { exact: true }).fill("fixture");
    await page.getByLabel("密码", { exact: true }).fill("wrong");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("账号或凭据不正确");
    await expect(page.getByLabel("二要素验证码", { exact: true })).toHaveCount(
      0,
    );
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByLabel("二要素验证码", { exact: true }),
    ).toBeFocused();
    await expect(page.getByLabel("密码", { exact: true })).toHaveCount(0);
    expect(
      (await context.cookies()).some((c) => c.name === "relay_session"),
    ).toBe(false);
    await page.screenshot({ path: ".vibe/totp-login-390.png", fullPage: true });
    await page.getByRole("button", { name: "返回账号密码登录" }).click();
    await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page
      .getByLabel("二要素验证码", { exact: true })
      .fill(totp(secret).generate({ timestamp: Date.now() + 30000 }));
    await page.getByRole("button", { name: "验证并登录" }).click();
    await expect(page.locator(".login")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
