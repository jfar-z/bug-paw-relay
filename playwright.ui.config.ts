import { defineConfig } from "@playwright/test";
/** 真实框架组件回归独立运行；固定截图环境，默认禁止自动更新基线。 */
export default defineConfig({
  testDir: "test",
  testMatch: "ui-library-browser.spec.ts",
  workers: 1,
  timeout: 120000,
  outputDir: ".vibe/ui-browser",
  updateSnapshots: "none",
  snapshotPathTemplate: "{testDir}/ui-baselines/{arg}{ext}",
  expect: { toHaveScreenshot: { animations: "disabled", maxDiffPixels: 0 } },
  use: {
    browserName: "chromium",
    actionTimeout: 10000,
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
});
