/**
 * popup.spec.js — Anytype Web Clipper E2E Tests
 *
 * 測試情境：Anytype desktop 未執行（port 31009 連不到）
 *   → popup 應顯示 auth-view，auth 嘗試失敗後顯示 auth-step-error
 *
 * 需要真實 Chromium（Extension 限制），透過 fixture 載入 extension
 */

"use strict";

const { test, expect, chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

// ── Extension fixture ─────────────────────────────────────────────────────────

const EXTENSION_PATH = path.resolve(__dirname, "../../");

// 驗證 extension 目錄包含必要檔案
if (!fs.existsSync(path.join(EXTENSION_PATH, "manifest.json"))) {
  throw new Error(`Extension not found at: ${EXTENSION_PATH}`);
}

/**
 * 建立載入 extension 的 browser context，並取得 extensionId
 */
async function launchExtensionContext() {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      "--headless=new",                              // Chrome 112+ 的 headless 模式
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--accept-lang=en",                            // 強制英文 i18n locale
    ],
    locale: "en-US",
  });

  // 等待 service worker 啟動，取得 extensionId
  let background = context.serviceWorkers()[0];
  if (!background) {
    background = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  }

  const extensionId = background.url().split("/")[2];
  return { context, extensionId };
}

// ── Test 1：Extension 載入 ────────────────────────────────────────────────────

test("extension service worker 啟動並取得有效 extensionId", async () => {
  const { context, extensionId } = await launchExtensionContext();
  try {
    expect(extensionId).toBeTruthy();
    expect(extensionId).toMatch(/^[a-z]{32}$/);  // Chrome extension ID 格式
  } finally {
    await context.close();
  }
});

// ── Test 2：Popup 開啟 ─────────────────────────────────────────────────────────

test("popup.html 可以開啟，不 crash", async () => {
  const { context, extensionId } = await launchExtensionContext();
  try {
    const popup = await context.newPage();
    const errors = [];
    popup.on("pageerror", (err) => errors.push(err.message));

    await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "domcontentloaded",
    });

    // 等待 popup body 載入
    await expect(popup.locator("body")).toBeVisible();

    // 不應有 JS 錯誤
    expect(errors).toHaveLength(0);
  } finally {
    await context.close();
  }
});

// ── Test 3：Auth-view 顯示 ────────────────────────────────────────────────────

test("無 API key → auth-view 可見，clipper-main 隱藏", async () => {
  const { context, extensionId } = await launchExtensionContext();
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "domcontentloaded",
    });

    // auth-view 不應含 hidden class
    await expect(popup.locator("#auth-view")).not.toHaveClass(/hidden/, { timeout: 8_000 });
    // clipper-main 應含 hidden class
    await expect(popup.locator("#clipper-main")).toHaveClass(/hidden/);
  } finally {
    await context.close();
  }
});

// ── Test 4：Auth 錯誤狀態（攔截 Anytype 連線）────────────────────────────────

test("連線 Anytype 失敗 → auth-step-error 出現，其他 step 隱藏", async () => {
  const { context, extensionId } = await launchExtensionContext();
  try {
    // 攔截對 Anytype API 的請求，強制返回連線失敗（不依賴 Anytype 是否實際運行）
    await context.route("http://127.0.0.1:31009/**", (route) =>
      route.abort("connectionrefused"),
    );

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "domcontentloaded",
    });

    // 等待 auth error step 出現（connection refused → catch → showAuthStep）
    const errorStep = popup.locator("#auth-step-error");
    await expect(errorStep).not.toHaveClass(/hidden/, { timeout: 8_000 });

    // 其他 auth steps 應該全部隱藏
    for (const stepId of ["auth-step-connecting", "auth-step-code", "auth-step-success"]) {
      await expect(popup.locator(`#${stepId}`)).toHaveClass(/hidden/);
    }
  } finally {
    await context.close();
  }
});

// ── Test 5：i18n 套用 ─────────────────────────────────────────────────────────

test("i18n 正確套用 — data-i18n 元素有翻譯文字（非 key 名稱）", async () => {
  const { context, extensionId } = await launchExtensionContext();
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "domcontentloaded",
    });

    // 等待 auth-view 可見（init 完成）
    await expect(popup.locator("#auth-view")).not.toHaveClass(/hidden/, { timeout: 8_000 });

    // 確認有 data-i18n 元素且 textContent 不是 key 名稱
    const i18nElements = await popup.locator("[data-i18n]").all();
    expect(i18nElements.length).toBeGreaterThan(0);

    for (const el of i18nElements) {
      const key = await el.getAttribute("data-i18n");
      const text = (await el.textContent()).trim();
      // textContent 若等於 key 代表翻譯未套用
      if (text) {
        expect(text).not.toEqual(key);
      }
    }
  } finally {
    await context.close();
  }
});

// ── Test 6：Retry 按鈕存在 ────────────────────────────────────────────────────

test("連線失敗後，retry 按鈕可見且可點擊", async () => {
  const { context, extensionId } = await launchExtensionContext();
  try {
    // 攔截 Anytype API，強制連線失敗
    await context.route("http://127.0.0.1:31009/**", (route) =>
      route.abort("connectionrefused"),
    );

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "domcontentloaded",
    });

    // 等待 error step 出現
    await expect(popup.locator("#auth-step-error")).not.toHaveClass(/hidden/, { timeout: 8_000 });

    // retry 按鈕存在且 enabled
    const retryBtn = popup.locator("#auth-retry-btn");
    await expect(retryBtn).toBeVisible();
    await expect(retryBtn).toBeEnabled();
  } finally {
    await context.close();
  }
});

// ── Test 7：Auth-step-code DOM 結構 ──────────────────────────────────────────

test("auth-step-code 隱藏時，code input 和 confirm 按鈕 DOM 存在", async () => {
  const { context, extensionId } = await launchExtensionContext();
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: "domcontentloaded",
    });

    // 等待 auth-view 可見
    await expect(popup.locator("#auth-view")).not.toHaveClass(/hidden/, { timeout: 8_000 });

    // challenge-code input 和 confirm 按鈕應存在於 DOM（即使 step 隱藏）
    await expect(popup.locator("#challenge-code")).toBeAttached();
    await expect(popup.locator("#confirm-code-btn")).toBeAttached();
  } finally {
    await context.close();
  }
});
