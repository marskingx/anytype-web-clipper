/**
 * Playwright E2E config for Anytype Web Clipper Chrome Extension
 *
 * Chrome Extension 限制：
 * - 必須 headless: false（或 --headless=new）才能載入 extension
 * - 只支援 Chromium（不支援 Firefox / WebKit）
 * - 每個 test 使用 launchPersistentContext 取得 extensionId
 */

const { defineConfig } = require("@playwright/test");
const path = require("path");

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,  // extension 測試共用 browser，避免 race condition
  retries: 0,
  reporter: "list",

  use: {
    // Extensions 需要 headed mode（或 --headless=new）
    headless: false,
    // 降低 flakiness
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: "chromium-extension",
      use: {
        // 瀏覽器由每個 spec 的 fixture 啟動（launchPersistentContext）
        // 這裡只宣告 project，fixture 在 popup.spec.js
        browserName: "chromium",
      },
    },
  ],
});
