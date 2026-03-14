"use strict";

const { expect } = require("chai");
const path = require("path");
const fs = require("fs");
const { JSDOM } = require("jsdom");

// ── 全域設置：必須在 require("./popup") 之前 ──────────────────────────────────
//
// popup.js 在 module 頂層：
//   1. byId() 讀取 document.getElementById → 建立 els
//   2. 呼叫 init() → applyI18n + hasExtensionApiContext
//
// 對策：先掛好 jsdom DOM、t/applyI18n stubs，
//       chrome = null 讓 hasExtensionApiContext() = false，init() 早期 return

const html = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
const dom = new JSDOM(html, { url: "chrome-extension://fake-ext-id" });

globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.chrome = null; // hasExtensionApiContext() → false → init() 早期 return
globalThis.t = (key) => key;
globalThis.applyI18n = () => {};

// popup.js 在 require 時執行 els 建立 + init()（同步完成，無 await）
const {
  isRestrictedUrl,
  normalizeTagColor,
  normalizeAvailableTags,
  resolveTypeIconGlyph,
  buildTypeOptionLabel,
  showAuthView,
  showClipperView,
  showAuthStep,
} = require("./popup");

// ── Helper ────────────────────────────────────────────────────────────────────
const doc = dom.window.document;
const hasClass = (id, cls) => doc.getElementById(id).classList.contains(cls);

// ── isRestrictedUrl() ─────────────────────────────────────────────────────────

describe("isRestrictedUrl()", () => {
  it("null / 空字串 → restricted", () => {
    expect(isRestrictedUrl(null)).to.be.true;
    expect(isRestrictedUrl("")).to.be.true;
  });

  it("非 http/https → restricted", () => {
    expect(isRestrictedUrl("chrome://newtab")).to.be.true;
    expect(isRestrictedUrl("about:blank")).to.be.true;
    expect(isRestrictedUrl("file:///home/user/file.html")).to.be.true;
  });

  it("一般 https URL → not restricted", () => {
    expect(isRestrictedUrl("https://example.com/page")).to.be.false;
    expect(isRestrictedUrl("http://localhost:3000")).to.be.false;
  });

  it("chrome.google.com → restricted", () => {
    expect(isRestrictedUrl("https://chrome.google.com/webstore/detail/ext")).to.be.true;
  });

  it("chromewebstore.google.com → restricted", () => {
    expect(isRestrictedUrl("https://chromewebstore.google.com/detail/ext")).to.be.true;
  });

  it("一般 google.com（無 /webstore）→ not restricted", () => {
    expect(isRestrictedUrl("https://www.google.com/search?q=anytype")).to.be.false;
  });
});

// ── normalizeTagColor() ───────────────────────────────────────────────────────

describe("normalizeTagColor()", () => {
  it("標準顏色直接回傳", () => {
    for (const c of ["grey", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "brown"]) {
      expect(normalizeTagColor(c)).to.equal(c);
    }
  });

  it("gray（美式）→ grey（英式）", () => {
    expect(normalizeTagColor("gray")).to.equal("grey");
  });

  it("未知顏色 → grey", () => {
    expect(normalizeTagColor("magenta")).to.equal("grey");
    expect(normalizeTagColor("black")).to.equal("grey");
    expect(normalizeTagColor("")).to.equal("grey");
  });

  it("null / undefined → grey", () => {
    expect(normalizeTagColor(null)).to.equal("grey");
    expect(normalizeTagColor(undefined)).to.equal("grey");
  });

  it("大小寫不敏感", () => {
    expect(normalizeTagColor("RED")).to.equal("red");
    expect(normalizeTagColor("Blue")).to.equal("blue");
    expect(normalizeTagColor("GREY")).to.equal("grey");
  });
});

// ── normalizeAvailableTags() ──────────────────────────────────────────────────

describe("normalizeAvailableTags()", () => {
  it("null / undefined → 空陣列", () => {
    expect(normalizeAvailableTags(null)).to.deep.equal([]);
    expect(normalizeAvailableTags(undefined)).to.deep.equal([]);
  });

  it("空陣列 → 空陣列", () => {
    expect(normalizeAvailableTags([])).to.deep.equal([]);
  });

  it("空 name 的 tag 被過濾掉", () => {
    expect(normalizeAvailableTags([{ name: "", id: "1" }])).to.have.length(0);
  });

  it("重複名稱（case-insensitive）只保留第一個", () => {
    const result = normalizeAvailableTags([
      { name: "Finance", color: "blue", id: "1" },
      { name: "finance", color: "red", id: "2" },
    ]);
    expect(result).to.have.length(1);
    expect(result[0].name).to.equal("Finance");
    expect(result[0].color).to.equal("blue"); // 保留第一個的顏色
  });

  it("color 正規化（gray → grey）", () => {
    const result = normalizeAvailableTags([{ name: "tag", color: "gray" }]);
    expect(result[0].color).to.equal("grey");
  });

  it("未知 color → grey", () => {
    const result = normalizeAvailableTags([{ name: "tag", color: "neon" }]);
    expect(result[0].color).to.equal("grey");
  });

  it("結果按字母排序", () => {
    const result = normalizeAvailableTags([
      { name: "Zebra" },
      { name: "Apple" },
      { name: "Mango" },
    ]);
    expect(result.map((t) => t.name)).to.deep.equal(["Apple", "Mango", "Zebra"]);
  });
});

// ── resolveTypeIconGlyph() ────────────────────────────────────────────────────

describe("resolveTypeIconGlyph()", () => {
  it("icon.emoji 存在 → 直接回傳 emoji", () => {
    expect(resolveTypeIconGlyph({ emoji: "🔥" })).to.equal("🔥");
  });

  it("icon.name 在 map 中 → 對應 glyph", () => {
    expect(resolveTypeIconGlyph({ name: "bookmark" })).to.equal("🔖");
    expect(resolveTypeIconGlyph({ name: "note" })).to.equal("📝");
    expect(resolveTypeIconGlyph({ name: "book" })).to.equal("📘");
  });

  it("icon.name 大小寫不敏感（map key 是 lowercase）", () => {
    expect(resolveTypeIconGlyph({ name: "BOOKMARK" })).to.equal("🔖");
    expect(resolveTypeIconGlyph({ name: "Note" })).to.equal("📝");
  });

  it("icon.name 不在 map → fallback ▪", () => {
    expect(resolveTypeIconGlyph({ name: "nonexistent_type" })).to.equal("▪");
  });

  it("空物件 → fallback ▪", () => {
    expect(resolveTypeIconGlyph({})).to.equal("▪");
  });

  it("null → fallback ▪", () => {
    expect(resolveTypeIconGlyph(null)).to.equal("▪");
  });
});

// ── buildTypeOptionLabel() ────────────────────────────────────────────────────

describe("buildTypeOptionLabel()", () => {
  it("emoji icon → glyph + 空格 + name", () => {
    expect(buildTypeOptionLabel("Web Clip", { emoji: "📎" })).to.equal("📎 Web Clip");
  });

  it("named icon → glyph + 空格 + name", () => {
    expect(buildTypeOptionLabel("Bookmark", { name: "bookmark" })).to.equal("🔖 Bookmark");
  });

  it("空 icon → fallback ▪ + 空格 + name", () => {
    expect(buildTypeOptionLabel("Unknown", {})).to.equal("▪ Unknown");
  });
});

// ── Auth 狀態機：View 切換 ─────────────────────────────────────────────────────

describe("showAuthView() / showClipperView()", () => {
  afterEach(() => {
    // 每個測試後重置為初始狀態（兩個 view 都 hidden）
    doc.getElementById("auth-view").classList.add("hidden");
    doc.getElementById("clipper-main").classList.add("hidden");
  });

  it("showAuthView() → auth-view 顯示，clipper-main 隱藏", () => {
    showAuthView();
    expect(hasClass("auth-view", "hidden")).to.be.false;
    expect(hasClass("clipper-main", "hidden")).to.be.true;
  });

  it("showClipperView() → clipper-main 顯示，auth-view 隱藏", () => {
    showClipperView();
    expect(hasClass("clipper-main", "hidden")).to.be.false;
    expect(hasClass("auth-view", "hidden")).to.be.true;
  });
});

// ── Auth 狀態機：Step 切換 ─────────────────────────────────────────────────────

describe("showAuthStep() - auth 狀態機", () => {
  const AUTH_STEPS = [
    "auth-step-connecting",
    "auth-step-code",
    "auth-step-error",
    "auth-step-success",
  ];

  beforeEach(() => {
    // 先顯示 auth-view，讓 showAuthStep 能運作
    showAuthView();
  });

  afterEach(() => {
    // 重置：隱藏所有 steps 和 views
    AUTH_STEPS.forEach((id) => doc.getElementById(id).classList.add("hidden"));
    doc.getElementById("auth-view").classList.add("hidden");
    doc.getElementById("clipper-main").classList.add("hidden");
  });

  for (const activeStep of AUTH_STEPS) {
    it(`showAuthStep("${activeStep}") → 只有 ${activeStep} 顯示`, () => {
      showAuthStep(activeStep);

      for (const step of AUTH_STEPS) {
        if (step === activeStep) {
          expect(hasClass(step, "hidden"), `${step} should be visible`).to.be.false;
        } else {
          expect(hasClass(step, "hidden"), `${step} should be hidden`).to.be.true;
        }
      }
    });
  }

  it("showAuthStep(connecting) → showAuthStep(code) → 只有 code 顯示", () => {
    showAuthStep("auth-step-connecting");
    expect(hasClass("auth-step-connecting", "hidden")).to.be.false;

    showAuthStep("auth-step-code");
    expect(hasClass("auth-step-connecting", "hidden")).to.be.true;
    expect(hasClass("auth-step-code", "hidden")).to.be.false;
  });

  it("auth 完整流程模擬：connecting → code → success", () => {
    showAuthStep("auth-step-connecting");
    expect(hasClass("auth-step-connecting", "hidden")).to.be.false;

    showAuthStep("auth-step-code");
    expect(hasClass("auth-step-code", "hidden")).to.be.false;
    expect(hasClass("auth-step-connecting", "hidden")).to.be.true;

    showAuthStep("auth-step-success");
    expect(hasClass("auth-step-success", "hidden")).to.be.false;
    expect(hasClass("auth-step-code", "hidden")).to.be.true;
  });

  it("auth 失敗流程：connecting → error", () => {
    showAuthStep("auth-step-connecting");
    showAuthStep("auth-step-error");

    expect(hasClass("auth-step-error", "hidden")).to.be.false;
    expect(hasClass("auth-step-connecting", "hidden")).to.be.true;
    expect(hasClass("auth-step-code", "hidden")).to.be.true;
  });
});
