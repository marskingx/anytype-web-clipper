"use strict";

const { expect } = require("chai");

// AnytypeApi 的 error message 呼叫全域 t()，
// 在 Node.js 環境需先注入 stub，才不會在 require 時崩潰
globalThis.t = (key) => key;

const { AnytypeApi } = require("./anytype-api");

// Chrome storage mock：用記憶體物件模擬 MV3 Promise-based storage API
function setupStorageMock(initialData = {}) {
  const _data = { ...initialData };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const result = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (k in _data) result[k] = _data[k];
          });
          return result;
        },
        async set(obj) {
          Object.assign(_data, obj);
        },
        async remove(keys) {
          (Array.isArray(keys) ? keys : [keys]).forEach(
            (k) => delete _data[k]
          );
        },
        _data, // 暴露給 assertion 用
      },
    },
  };
  return _data;
}

afterEach(() => {
  delete globalThis.chrome;
});

// ── loadApiKey() ──────────────────────────────────────────────────────────────

describe("AnytypeApi.loadApiKey()", () => {
  it("chrome.storage 不存在 → 回傳空字串", async () => {
    const key = await AnytypeApi.loadApiKey();
    expect(key).to.equal("");
  });

  it("storage 有 key → 回傳 key 值", async () => {
    setupStorageMock({ anytypeApiKey: "my-api-key-123" });
    const key = await AnytypeApi.loadApiKey();
    expect(key).to.equal("my-api-key-123");
  });

  it("storage 無 key → 回傳空字串", async () => {
    setupStorageMock({});
    const key = await AnytypeApi.loadApiKey();
    expect(key).to.equal("");
  });

  it("storage 的值含前後空白 → 回傳 trim 後的值", async () => {
    setupStorageMock({ anytypeApiKey: "  trimmed-key  " });
    const key = await AnytypeApi.loadApiKey();
    expect(key).to.equal("trimmed-key");
  });
});

// ── saveApiKey() ──────────────────────────────────────────────────────────────

describe("AnytypeApi.saveApiKey()", () => {
  it("chrome.storage 不存在 → 不 crash", async () => {
    await AnytypeApi.saveApiKey("test-key");
  });

  it("將 key 寫入 storage", async () => {
    const data = setupStorageMock();
    await AnytypeApi.saveApiKey("saved-key-xyz");
    expect(data.anytypeApiKey).to.equal("saved-key-xyz");
  });

  it("重複 save → 覆蓋舊值", async () => {
    const data = setupStorageMock({ anytypeApiKey: "old-key" });
    await AnytypeApi.saveApiKey("new-key");
    expect(data.anytypeApiKey).to.equal("new-key");
  });
});

// ── clearApiKey() ─────────────────────────────────────────────────────────────

describe("AnytypeApi.clearApiKey()", () => {
  it("chrome.storage 不存在 → 不 crash", async () => {
    await AnytypeApi.clearApiKey();
  });

  it("storage 有 key → 刪除後 loadApiKey() 回傳空字串", async () => {
    setupStorageMock({ anytypeApiKey: "existing-key" });
    await AnytypeApi.clearApiKey();
    const key = await AnytypeApi.loadApiKey();
    expect(key).to.equal("");
  });

  it("storage 本來就沒有 key → 不 crash，仍回傳空字串", async () => {
    setupStorageMock({});
    await AnytypeApi.clearApiKey();
    const key = await AnytypeApi.loadApiKey();
    expect(key).to.equal("");
  });
});
