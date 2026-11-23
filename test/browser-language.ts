import { expect, type Page } from "@playwright/test";
import type { Locale } from "../src/shared/i18n.js";

/** 模拟另一设备保存偏好，当前页重新联网后读取服务端并保留页面状态。 */
export async function changeServerLanguage(page: Page, locale: Locale) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(origin + "/api/settings/language", {
    headers: { Origin: origin },
    data: { preference: locale },
  });
  expect(response.ok()).toBe(true);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
