"use strict";

const path = require("path");
const fs = require("fs");
const { expect } = require("chai");
const { JSDOM } = require("jsdom");

// Chrome mock：模擬 chrome.i18n.getMessage，直接讀 en/messages.json
const EN_MESSAGES = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../_locales/en/messages.json"),
    "utf8"
  )
);

function setupChromeMock(messages = EN_MESSAGES) {
  globalThis.chrome = {
    i18n: {
      getMessage(key, subs) {
        const entry = messages[key];
        if (!entry) return "";
        let str = entry.message;
        // Step 1：將 $NAME$ 命名 placeholder 展開為 $1/$2/...
        if (entry.placeholders) {
          for (const [name, def] of Object.entries(entry.placeholders)) {
            str = str.replace(new RegExp(`\\$${name}\\$`, "gi"), def.content);
          }
        }
        // Step 2：將 $1/$2/... 替換為實際 subs 值
        if (Array.isArray(subs)) {
          subs.forEach((v, i) => {
            str = str.replace(new RegExp(`\\$${i + 1}`, "g"), String(v));
          });
        }
        return str;
      },
    },
  };
}

afterEach(() => {
  delete globalThis.chrome;
});

// 在所有測試結束後 require —— 等 module.exports 加好才能使用
const { t, applyI18n } = require("./i18n-helper");

// ── t() ──────────────────────────────────────────────────────────────────────

describe("t()", () => {
  it("chrome API 不存在 → 直接回傳 key 作為 fallback", () => {
    expect(t("status_ready")).to.equal("status_ready");
  });

  it("chrome mock 存在 → 回傳翻譯字串", () => {
    setupChromeMock();
    expect(t("status_ready")).to.equal("Ready");
  });

  it("不存在的 key → getMessage 回傳空字串 → fallback 為 key", () => {
    setupChromeMock();
    expect(t("totally_nonexistent_key_xyz")).to.equal(
      "totally_nonexistent_key_xyz"
    );
  });

  it("單一 substitution → 正確插入", () => {
    setupChromeMock();
    expect(t("error_options_failed", "timeout")).to.equal(
      "Failed to load options: timeout"
    );
  });

  it("三個 substitution (status_done) → 三個值全部正確插入", () => {
    setupChromeMock();
    const result = t("status_done", "abc123", "250", "3");
    expect(result).to.equal("Done: abc123\nWords 250 / Media 3");
  });
});

// ── applyI18n() ───────────────────────────────────────────────────────────────

describe("applyI18n()", () => {
  it("null root → 不 crash", () => {
    expect(() => applyI18n(null)).not.to.throw();
  });

  it("[data-i18n] → textContent 被翻譯覆蓋", () => {
    setupChromeMock();
    const dom = new JSDOM('<p data-i18n="status_ready">舊文字</p>');
    applyI18n(dom.window.document);
    expect(dom.window.document.querySelector("p").textContent).to.equal(
      "Ready"
    );
  });

  it("[data-i18n-placeholder] → placeholder 被翻譯覆蓋", () => {
    setupChromeMock();
    const dom = new JSDOM(
      '<input data-i18n-placeholder="auth_code_placeholder" placeholder="舊的">'
    );
    applyI18n(dom.window.document);
    expect(
      dom.window.document.querySelector("input").placeholder
    ).to.equal("0000");
  });

  it("[data-i18n-title] → title 被翻譯覆蓋", () => {
    setupChromeMock();
    const dom = new JSDOM(
      '<button data-i18n-title="tag_edit_title" title="舊的">btn</button>'
    );
    applyI18n(dom.window.document);
    expect(dom.window.document.querySelector("button").title).to.equal(
      "Edit tag name and color"
    );
  });

  it("翻譯不存在的 key → fallback 為 key，不 crash", () => {
    setupChromeMock();
    const dom = new JSDOM('<span data-i18n="nonexistent_key_xyz">原文</span>');
    applyI18n(dom.window.document);
    expect(dom.window.document.querySelector("span").textContent).to.equal(
      "nonexistent_key_xyz"
    );
  });
});
