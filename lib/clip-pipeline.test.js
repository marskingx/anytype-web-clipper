"use strict";

const { expect } = require("chai");
const {
  normalizeIsoDatetime,
  normalizeSourceUrl,
  normalizeTagNames,
  appendProperty,
  buildProperties,
  filterSupportedProperties,
  estimateWordCount,
  normalizeTagColor,
  purgeDedupCache,
  extractTypeKey,
  findExactNameMatch,
  resolveObjectIds,
  ensureObjectsRawFallbacks,
  runClipPipeline,
  DEFAULT_RELATION_TARGETS,
} = require("./clip-pipeline");

const ISO_FULL_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ── normalizeIsoDatetime ───────────────────────────────────────────────────────

describe("normalizeIsoDatetime", () => {
  it('空字串 → ""', () => {
    expect(normalizeIsoDatetime("")).to.equal("");
  });

  it('null → ""', () => {
    expect(normalizeIsoDatetime(null)).to.equal("");
  });

  it('undefined → ""', () => {
    expect(normalizeIsoDatetime(undefined)).to.equal("");
  });

  it('空白字串 → ""', () => {
    expect(normalizeIsoDatetime("  ")).to.equal("");
  });

  it('無效字串 → ""', () => {
    expect(normalizeIsoDatetime("not-a-date")).to.equal("");
  });

  it("純日期 → 完整 ISO 8601 UTC", () => {
    const result = normalizeIsoDatetime("2021-06-08");
    expect(result).to.match(ISO_FULL_REGEX);
    expect(result.endsWith(".000Z")).to.be.true;
  });

  it("datetime 無秒（原始 bug 輸入）→ 完整 ISO 8601 UTC", () => {
    const result = normalizeIsoDatetime("2021-06-08T09:00");
    expect(result).to.match(ISO_FULL_REGEX);
    expect(result.endsWith(".000Z")).to.be.true;
  });

  it("完整 UTC datetime → 標準化 ISO 8601", () => {
    expect(normalizeIsoDatetime("2021-06-08T09:00:00Z")).to.equal(
      "2021-06-08T09:00:00.000Z"
    );
  });

  it("含時區 datetime → 轉換為 UTC", () => {
    const result = normalizeIsoDatetime("2021-06-08T09:00:00+08:00");
    expect(result).to.match(ISO_FULL_REGEX);
    expect(result.endsWith(".000Z")).to.be.true;
  });

  it("英文日期格式 → 完整 ISO 8601 UTC", () => {
    const result = normalizeIsoDatetime("June 8, 2021");
    expect(result).to.match(ISO_FULL_REGEX);
    expect(result.endsWith(".000Z")).to.be.true;
  });
});

// ── normalizeSourceUrl ────────────────────────────────────────────────────────

describe("normalizeSourceUrl()", () => {
  it("空字串 → 空字串（URL constructor 失敗，fallback 回原值）", () => {
    expect(normalizeSourceUrl("")).to.equal("");
  });

  it("null → 空字串", () => {
    expect(normalizeSourceUrl(null)).to.equal("");
  });

  it("一般 HTTPS URL → 保留不變", () => {
    expect(normalizeSourceUrl("https://example.com/page")).to.equal("https://example.com/page");
  });

  it("大寫 scheme 轉小寫", () => {
    expect(normalizeSourceUrl("HTTPS://EXAMPLE.COM/page")).to.equal("https://example.com/page");
  });

  it("大寫 host 轉小寫", () => {
    expect(normalizeSourceUrl("https://EXAMPLE.COM/page")).to.equal("https://example.com/page");
  });

  it("URL 含 fragment（#） → 移除 fragment", () => {
    expect(normalizeSourceUrl("https://example.com/page#section")).to.equal("https://example.com/page");
  });

  it("path 末尾斜線（非 root）→ 移除", () => {
    expect(normalizeSourceUrl("https://example.com/page/")).to.equal("https://example.com/page");
  });

  it("root path（/）→ 保留", () => {
    expect(normalizeSourceUrl("https://example.com/")).to.equal("https://example.com/");
  });

  it("URL 含 query string → 保留", () => {
    expect(normalizeSourceUrl("https://example.com/search?q=test")).to.equal("https://example.com/search?q=test");
  });

  it("URL 含自訂 port → 保留", () => {
    expect(normalizeSourceUrl("http://localhost:3000/api")).to.equal("http://localhost:3000/api");
  });

  it("非 URL 字串 → fallback 原值（trim）", () => {
    expect(normalizeSourceUrl("not-a-url")).to.equal("not-a-url");
  });
});

// ── normalizeTagNames ─────────────────────────────────────────────────────────

describe("normalizeTagNames()", () => {
  it("空字串 → 空陣列", () => {
    expect(normalizeTagNames("")).to.deep.equal([]);
  });

  it("null → 空陣列", () => {
    expect(normalizeTagNames(null)).to.deep.equal([]);
  });

  it("空陣列 → 空陣列", () => {
    expect(normalizeTagNames([])).to.deep.equal([]);
  });

  it("陣列輸入 → trim 後回傳", () => {
    expect(normalizeTagNames(["Finance", " Tech "])).to.deep.equal(["Finance", "Tech"]);
  });

  it("逗號分隔字串 → 拆成陣列", () => {
    expect(normalizeTagNames("Finance,Tech")).to.deep.equal(["Finance", "Tech"]);
  });

  it("逗號分隔含空白 → trim 後回傳", () => {
    expect(normalizeTagNames("Finance , Tech ")).to.deep.equal(["Finance", "Tech"]);
  });

  it("重複名稱（case-insensitive）→ 只保留第一個", () => {
    const result = normalizeTagNames(["Finance", "finance", "FINANCE"]);
    expect(result).to.deep.equal(["Finance"]);
  });

  it("空白 entry → 過濾掉", () => {
    expect(normalizeTagNames(["Finance", "", "  "])).to.deep.equal(["Finance"]);
  });
});

// ── appendProperty ────────────────────────────────────────────────────────────

describe("appendProperty()", () => {
  let properties, warnings;

  beforeEach(() => {
    properties = [];
    warnings = [];
  });

  it("null value → 不 push", () => {
    appendProperty(properties, warnings, {}, "key1", null, "text");
    expect(properties).to.have.length(0);
  });

  it("undefined value → 不 push", () => {
    appendProperty(properties, warnings, {}, "key1", undefined, "text");
    expect(properties).to.have.length(0);
  });

  it("空字串 value → 不 push", () => {
    appendProperty(properties, warnings, {}, "key1", "   ", "text");
    expect(properties).to.have.length(0);
  });

  it("text format（預設）→ { key, text }", () => {
    appendProperty(properties, warnings, {}, "excerpt", "Hello", "text");
    expect(properties).to.deep.equal([{ key: "excerpt", text: "Hello" }]);
  });

  it("url format → { key, url }", () => {
    appendProperty(properties, warnings, {}, "source_url", "https://example.com", "url");
    expect(properties).to.deep.equal([{ key: "source_url", url: "https://example.com" }]);
  });

  it("number format（有效數字）→ { key, number }", () => {
    appendProperty(properties, warnings, {}, "read_time_min", "5", "number");
    expect(properties).to.deep.equal([{ key: "read_time_min", number: 5 }]);
  });

  it("number format（無效）→ warning，不 push", () => {
    appendProperty(properties, warnings, {}, "read_time_min", "abc", "number");
    expect(properties).to.have.length(0);
    expect(warnings[0]).to.include("property_number_invalid");
  });

  it("date format（有效 ISO）→ { key, date }", () => {
    appendProperty(properties, warnings, {}, "captured_at", "2024-01-01T00:00:00Z", "date");
    expect(properties[0]).to.have.property("key", "captured_at");
    expect(properties[0].date).to.match(ISO_FULL_REGEX);
  });

  it("date format（無效）→ warning，不 push", () => {
    appendProperty(properties, warnings, {}, "captured_at", "not-a-date", "date");
    expect(properties).to.have.length(0);
    expect(warnings[0]).to.include("property_date_invalid");
  });

  it("checkbox format（boolean true）→ { key, checkbox: true }", () => {
    appendProperty(properties, warnings, {}, "flag", true, "checkbox");
    expect(properties).to.deep.equal([{ key: "flag", checkbox: true }]);
  });

  it("checkbox format（'yes'）→ { key, checkbox: true }", () => {
    appendProperty(properties, warnings, {}, "flag", "yes", "checkbox");
    expect(properties).to.deep.equal([{ key: "flag", checkbox: true }]);
  });

  it("checkbox format（'0'）→ { key, checkbox: false }", () => {
    appendProperty(properties, warnings, {}, "flag", "0", "checkbox");
    expect(properties).to.deep.equal([{ key: "flag", checkbox: false }]);
  });

  it("checkbox format（無效）→ warning，不 push", () => {
    appendProperty(properties, warnings, {}, "flag", "maybe", "checkbox");
    expect(properties).to.have.length(0);
    expect(warnings[0]).to.include("property_checkbox_invalid");
  });

  it("select format → { key, select }", () => {
    appendProperty(properties, warnings, {}, "status", "draft", "select");
    expect(properties).to.deep.equal([{ key: "status", select: "draft" }]);
  });

  it("multi_select format（陣列）→ { key, multi_select }", () => {
    appendProperty(properties, warnings, {}, "tag", ["Finance", "Tech"], "multi_select");
    expect(properties).to.deep.equal([{ key: "tag", multi_select: ["Finance", "Tech"] }]);
  });

  it("multi_select format（逗號字串）→ { key, multi_select }", () => {
    appendProperty(properties, warnings, {}, "tag", "Finance,Tech", "multi_select");
    expect(properties[0].multi_select).to.deep.equal(["Finance", "Tech"]);
  });

  it("propertyDefs 可覆蓋 format（text 傳入但 defs 說是 url）", () => {
    const defs = { source_url: { format: "url" } };
    appendProperty(properties, warnings, defs, "source_url", "https://test.com", "text");
    expect(properties[0]).to.deep.equal({ key: "source_url", url: "https://test.com" });
  });
});

// ── buildProperties ───────────────────────────────────────────────────────────

describe("buildProperties()", () => {
  const baseExtraction = {
    url: "https://example.com/article",
    title: "Test Article",
    excerpt: "An excerpt",
    author: "John",
    siteName: "Example",
    publishedAt: "2024-01-01T00:00:00Z",
    coverImageUrl: "https://example.com/cover.jpg",
    embeddedUrls: [],
  };

  it("web_clip type → source_url 而非 source", () => {
    const { properties } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "web_clip",
      readTimeMin: 2,
      tagOptions: [],
      customFields: {},
      propertyDefs: {},
    });
    const keys = properties.map((p) => p.key);
    expect(keys).to.include("source_url");
    expect(keys).not.to.include("source");
  });

  it("bookmark type → source 而非 source_url", () => {
    const { properties } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "bookmark",
      readTimeMin: 0,
      tagOptions: [],
      customFields: {},
      propertyDefs: {},
    });
    const keys = properties.map((p) => p.key);
    expect(keys).to.include("source");
    expect(keys).not.to.include("source_url");
  });

  it("tagOptions 有值 → multi_select tag 加入", () => {
    const { properties } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "web_clip",
      readTimeMin: 1,
      tagOptions: ["key_finance", "key_tech"],
      customFields: {},
      propertyDefs: {},
    });
    const tagProp = properties.find((p) => p.key === "tag");
    expect(tagProp).to.exist;
    expect(tagProp.multi_select).to.deep.equal(["key_finance", "key_tech"]);
  });

  it("customFields 非 reserved key → 加入 properties", () => {
    const { properties } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "web_clip",
      readTimeMin: 1,
      tagOptions: [],
      customFields: { my_field: "custom_value" },
      propertyDefs: {},
    });
    const custom = properties.find((p) => p.key === "my_field");
    expect(custom).to.exist;
    expect(custom.text).to.equal("custom_value");
  });

  it("customFields 包含 reserved key → 忽略", () => {
    const { properties } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "web_clip",
      readTimeMin: 1,
      tagOptions: [],
      customFields: { source_url: "https://malicious.com" },
      propertyDefs: {},
    });
    const sourceUrls = properties.filter((p) => p.key === "source_url");
    expect(sourceUrls).to.have.length(1);
    expect(sourceUrls[0].url).to.equal(baseExtraction.url);
  });

  it("clip_source 固定為 'webclipper' 且在 reserved set 中", () => {
    const { properties } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "web_clip",
      readTimeMin: 1,
      tagOptions: [],
      customFields: { clip_source: "hacker" },
      propertyDefs: {},
    });
    const cs = properties.filter((p) => p.key === "clip_source");
    expect(cs).to.have.length(1);
    expect(cs[0].text).to.equal("webclipper");
  });

  it("bookmark type 也包含 clip_source", () => {
    const { properties } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "bookmark",
      readTimeMin: 0,
      tagOptions: [],
      customFields: {},
      propertyDefs: {},
    });
    const cs = properties.find((p) => p.key === "clip_source");
    expect(cs).to.exist;
    expect(cs.text).to.equal("webclipper");
  });

  it("無效 publishedAt → 不加入 published_at，沒有 warning", () => {
    const { properties, warnings } = buildProperties({
      extraction: { ...baseExtraction, publishedAt: "invalid-date" },
      selectedTypeKey: "web_clip",
      readTimeMin: 1,
      tagOptions: [],
      customFields: {},
      propertyDefs: {},
    });
    expect(properties.find((p) => p.key === "published_at")).to.be.undefined;
    expect(warnings).to.have.length(0);
  });
});

// ── filterSupportedProperties ─────────────────────────────────────────────────

describe("filterSupportedProperties()", () => {
  it("全部 key 都支援 → filtered = 全部，dropped = []", () => {
    const props = [{ key: "source_url", url: "https://example.com" }, { key: "excerpt", text: "hi" }];
    const supportedKeys = new Set(["source_url", "excerpt"]);
    const { filtered, dropped } = filterSupportedProperties(props, supportedKeys);
    expect(filtered).to.have.length(2);
    expect(dropped).to.have.length(0);
  });

  it("不支援的 key → 進入 dropped，不在 filtered", () => {
    const props = [{ key: "unknown_field", text: "x" }];
    const { filtered, dropped } = filterSupportedProperties(props, new Set(["source_url"]));
    expect(filtered).to.have.length(0);
    expect(dropped).to.deep.equal(["unknown_field"]);
  });

  it("重複不支援的 key → dropped 只出現一次", () => {
    const props = [{ key: "bad", text: "a" }, { key: "bad", text: "b" }];
    const { dropped } = filterSupportedProperties(props, new Set([]));
    expect(dropped).to.have.length(1);
    expect(dropped[0]).to.equal("bad");
  });

  it("空 key 的 property → 被跳過，不進 filtered 也不進 dropped", () => {
    const props = [{ key: "", text: "x" }];
    const { filtered, dropped } = filterSupportedProperties(props, new Set(["source_url"]));
    expect(filtered).to.have.length(0);
    expect(dropped).to.have.length(0);
  });
});

// ── estimateWordCount ─────────────────────────────────────────────────────────

describe("estimateWordCount()", () => {
  it("空字串 → 1（最小值）", () => {
    expect(estimateWordCount("")).to.equal(1);
  });

  it("英文單詞 → latinWords + Math.max(1,0) = count+1", () => {
    // 實作：latinWords + Math.max(1, floor(cjkChars/2))
    // 純英文無 CJK：4 + max(1,0) = 4 + 1 = 5
    expect(estimateWordCount("hello world foo bar")).to.equal(5);
  });

  it("中文字元 → 每 2 個中文計 1 個字", () => {
    // 4 個 CJK → floor(4/2) = 2 → max(1, 2) = 2；latin = 0；total = 0 + 2 = 2
    expect(estimateWordCount("你好世界")).to.equal(2);
  });

  it("混合中英文", () => {
    // "Hello 世界" → latin: 1, CJK: 2 → floor(2/2)=1, max(1,1)=1 → total=2
    expect(estimateWordCount("Hello 世界")).to.equal(2);
  });
});

// ── normalizeTagColor (clip-pipeline) ─────────────────────────────────────────

describe("normalizeTagColor() [clip-pipeline]", () => {
  it("標準顏色直接回傳", () => {
    for (const c of ["grey", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "brown"]) {
      expect(normalizeTagColor(c)).to.equal(c);
    }
  });

  it("gray（美式）→ 允許回傳 gray（clip-pipeline 版不轉換）", () => {
    // clip-pipeline.js 的 normalizeTagColor 允許 gray 直接通過
    expect(normalizeTagColor("gray")).to.equal("gray");
  });

  it("未知顏色 → grey", () => {
    expect(normalizeTagColor("magenta")).to.equal("grey");
  });

  it("null → grey", () => {
    expect(normalizeTagColor(null)).to.equal("grey");
  });
});

// ── purgeDedupCache ───────────────────────────────────────────────────────────

describe("purgeDedupCache()", () => {
  it("過期 entry（超過 TTL）→ 被刪除", () => {
    const now = Date.now();
    const oldTs = now - 200 * 1000; // 200s 前，超過 120s TTL
    const cache = {
      nonce: { "old-nonce": { ts: oldTs, response: {} } },
      sig: { "old-sig": { ts: oldTs, response: {} } },
    };
    purgeDedupCache(cache);
    expect(cache.nonce).to.not.have.property("old-nonce");
    expect(cache.sig).to.not.have.property("old-sig");
  });

  it("新的 entry（在 TTL 內）→ 保留", () => {
    const now = Date.now();
    const recentTs = now - 30 * 1000; // 30s 前，在 120s TTL 內
    const cache = {
      nonce: { "new-nonce": { ts: recentTs, response: {} } },
      sig: { "new-sig": { ts: recentTs, response: {} } },
    };
    purgeDedupCache(cache);
    expect(cache.nonce).to.have.property("new-nonce");
    expect(cache.sig).to.have.property("new-sig");
  });

  it("空 cache → 不 crash", () => {
    const cache = { nonce: {}, sig: {} };
    expect(() => purgeDedupCache(cache)).not.to.throw();
  });
});

// ── appendProperty - objects format ──────────────────────────────────────────

describe("appendProperty() - objects format", () => {
  let properties, warnings;

  beforeEach(() => {
    properties = [];
    warnings = [];
  });

  it("objects format + pendingObjects 陣列 → push 到 pendingObjects", () => {
    const pending = [];
    const defs = { author: { format: "objects" } };
    appendProperty(properties, warnings, defs, "author", "John Doe", "text", pending);
    expect(properties).to.have.length(0);
    expect(pending).to.have.length(1);
    expect(pending[0]).to.deep.equal({ key: "author", rawValue: "John Doe" });
  });

  it("objects format + 無 pendingObjects → warning", () => {
    const defs = { author: { format: "objects" } };
    appendProperty(properties, warnings, defs, "author", "John Doe", "text");
    expect(properties).to.have.length(0);
    expect(warnings).to.have.length(1);
    expect(warnings[0]).to.include("objects");
    expect(warnings[0]).to.include("async resolution");
  });

  it("objects format + pendingObjects + 空值 → 不排隊（early return by empty check）", () => {
    const pending = [];
    const defs = { author: { format: "objects" } };
    appendProperty(properties, warnings, defs, "author", "  ", "text", pending);
    expect(pending).to.have.length(0);
  });

  it("objects format + 數值 value → rawValue 為字串", () => {
    const pending = [];
    const defs = { score: { format: "objects" } };
    appendProperty(properties, warnings, defs, "score", 42, "text", pending);
    expect(pending[0].rawValue).to.equal("42");
  });
});

// ── buildProperties - objects relay ──────────────────────────────────────────

describe("buildProperties() - objects relay", () => {
  const baseExtraction = {
    url: "https://example.com/article",
    title: "Test Article",
    excerpt: "An excerpt",
    author: "John",
    siteName: "Example",
    publishedAt: "2024-01-01T00:00:00Z",
    coverImageUrl: "https://example.com/cover.jpg",
    embeddedUrls: [],
  };

  it("author 為 objects 格式 → 進 pendingObjects，不在 properties", () => {
    const defs = { author: { format: "objects" } };
    const { properties, pendingObjects } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "web_clip",
      readTimeMin: 1,
      tagOptions: [],
      customFields: {},
      propertyDefs: defs,
    });
    const authorProp = properties.find((p) => p.key === "author");
    expect(authorProp).to.be.undefined;
    expect(pendingObjects.some((p) => p.key === "author")).to.be.true;
  });

  it("author 為 text 格式 → 正常進 properties，pendingObjects 為空", () => {
    const defs = { author: { format: "text" } };
    const { properties, pendingObjects } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "web_clip",
      readTimeMin: 1,
      tagOptions: [],
      customFields: {},
      propertyDefs: defs,
    });
    const authorProp = properties.find((p) => p.key === "author");
    expect(authorProp).to.exist;
    expect(authorProp.text).to.equal("John");
    expect(pendingObjects.filter((p) => p.key === "author")).to.have.length(0);
  });

  it("回傳值包含 pendingObjects 陣列", () => {
    const result = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "web_clip",
      readTimeMin: 1,
      tagOptions: [],
      customFields: {},
      propertyDefs: {},
    });
    expect(result).to.have.property("pendingObjects");
    expect(Array.isArray(result.pendingObjects)).to.be.true;
  });

  it("author_raw 和 media_raw 在 reserved set 中 → customFields 不覆蓋", () => {
    const { properties } = buildProperties({
      extraction: baseExtraction,
      selectedTypeKey: "web_clip",
      readTimeMin: 1,
      tagOptions: [],
      customFields: { author_raw: "hacker", media_raw: "evil" },
      propertyDefs: {},
    });
    expect(properties.find((p) => p.key === "author_raw")).to.be.undefined;
    expect(properties.find((p) => p.key === "media_raw")).to.be.undefined;
  });
});

// ── extractTypeKey ───────────────────────────────────────────────────────────

describe("extractTypeKey()", () => {
  it("type 為 object 且有 key → 回傳 key", () => {
    expect(extractTypeKey({ type: { key: "human" } })).to.equal("human");
  });

  it("type 為 object 且有 type_key → 回傳 type_key", () => {
    expect(extractTypeKey({ type: { type_key: "person" } })).to.equal("person");
  });

  it("type 為 string → 直接回傳", () => {
    expect(extractTypeKey({ type: "page" })).to.equal("page");
  });

  it("type_key fallback → 使用頂層 type_key", () => {
    expect(extractTypeKey({ type_key: "note" })).to.equal("note");
  });

  it("typeKey fallback → 使用頂層 typeKey", () => {
    expect(extractTypeKey({ typeKey: "task" })).to.equal("task");
  });

  it("空物件 → 空字串", () => {
    expect(extractTypeKey({})).to.equal("");
  });

  it("type.key 含前後空白 → trim", () => {
    expect(extractTypeKey({ type: { key: "  human  " } })).to.equal("human");
  });
});

// ── findExactNameMatch ──────────────────────────────────────────────────────

describe("findExactNameMatch()", () => {
  it("精確名稱匹配 → 回傳 ID", () => {
    const hits = [{ id: "id1", name: "John Doe" }];
    expect(findExactNameMatch(hits, "John Doe", [])).to.equal("id1");
  });

  it("case-insensitive 匹配", () => {
    const hits = [{ id: "id1", name: "John Doe" }];
    expect(findExactNameMatch(hits, "john doe", [])).to.equal("id1");
  });

  it("有 preferredTypeKeys 且匹配 → 回傳優先型別的 ID", () => {
    const hits = [
      { id: "id1", name: "John", type: { key: "page" } },
      { id: "id2", name: "John", type: { key: "human" } },
    ];
    expect(findExactNameMatch(hits, "John", ["human"])).to.equal("id2");
  });

  it("有 preferredTypeKeys 但無型別匹配 → fallback 到第一個名稱匹配", () => {
    const hits = [
      { id: "id1", name: "John", type: { key: "page" } },
    ];
    expect(findExactNameMatch(hits, "John", ["human"])).to.equal("id1");
  });

  it("無名稱匹配 → 空字串", () => {
    const hits = [{ id: "id1", name: "Jane" }];
    expect(findExactNameMatch(hits, "John", [])).to.equal("");
  });

  it("空 hits → 空字串", () => {
    expect(findExactNameMatch([], "John", [])).to.equal("");
  });

  it("空 name → 空字串", () => {
    expect(findExactNameMatch([{ id: "id1", name: "John" }], "", [])).to.equal("");
  });

  it("hit 無 id → 跳過", () => {
    const hits = [{ name: "John" }];
    expect(findExactNameMatch(hits, "John", [])).to.equal("");
  });
});

// ── resolveObjectIds ────────────────────────────────────────────────────────

describe("resolveObjectIds()", () => {
  it("bafy 開頭 → 直接當 object ID，不呼叫 API", async () => {
    let apiCalled = false;
    const mockApi = {
      searchObjects: () => { apiCalled = true; return []; },
    };
    const { resolved, unresolved } = await resolveObjectIds(mockApi, "sp1", "bafyabc123", []);
    expect(resolved).to.deep.equal(["bafyabc123"]);
    expect(unresolved).to.have.length(0);
    expect(apiCalled).to.be.false;
  });

  it("名稱解析 → 呼叫 searchObjects 並精確匹配", async () => {
    const mockApi = {
      searchObjects: () => [{ id: "obj1", name: "John Doe" }],
    };
    const { resolved, unresolved } = await resolveObjectIds(mockApi, "sp1", "John Doe", []);
    expect(resolved).to.deep.equal(["obj1"]);
    expect(unresolved).to.have.length(0);
  });

  it("逗號分隔多值 → 各別解析", async () => {
    const mockApi = {
      searchObjects: (spaceId, { query }) => {
        if (query === "Alice") return [{ id: "a1", name: "Alice" }];
        if (query === "Bob") return [{ id: "b1", name: "Bob" }];
        return [];
      },
    };
    const { resolved, unresolved } = await resolveObjectIds(mockApi, "sp1", "Alice, Bob", []);
    expect(resolved).to.deep.equal(["a1", "b1"]);
    expect(unresolved).to.have.length(0);
  });

  it("API 錯誤 → token 進 unresolved，不拋例外", async () => {
    const mockApi = {
      searchObjects: () => { throw new Error("network error"); },
    };
    const { resolved, unresolved } = await resolveObjectIds(mockApi, "sp1", "John", []);
    expect(resolved).to.have.length(0);
    expect(unresolved).to.deep.equal(["John"]);
  });

  it("搜尋無匹配 → token 進 unresolved", async () => {
    const mockApi = {
      searchObjects: () => [{ id: "x", name: "Jane" }],
    };
    const { resolved, unresolved } = await resolveObjectIds(mockApi, "sp1", "John", []);
    expect(resolved).to.have.length(0);
    expect(unresolved).to.deep.equal(["John"]);
  });

  it("重複 ID 去重", async () => {
    const mockApi = {
      searchObjects: () => [{ id: "same-id", name: "John" }],
    };
    const { resolved } = await resolveObjectIds(mockApi, "sp1", "John, John", []);
    expect(resolved).to.deep.equal(["same-id"]);
  });

  it("重複 bafy ID 去重", async () => {
    const { resolved } = await resolveObjectIds({}, "sp1", "bafyabc, bafyabc", []);
    expect(resolved).to.deep.equal(["bafyabc"]);
  });

  it("空字串 → 空結果", async () => {
    const { resolved, unresolved } = await resolveObjectIds({}, "sp1", "", []);
    expect(resolved).to.have.length(0);
    expect(unresolved).to.have.length(0);
  });

  it("混合 bafy + 名稱", async () => {
    const mockApi = {
      searchObjects: () => [{ id: "obj1", name: "Alice" }],
    };
    const { resolved } = await resolveObjectIds(mockApi, "sp1", "bafyxyz, Alice", []);
    expect(resolved).to.deep.equal(["bafyxyz", "obj1"]);
  });
});

// ── ensureObjectsRawFallbacks ────────────────────────────────────────────────

describe("ensureObjectsRawFallbacks()", () => {
  it("propertyDefs 無 objects 格式 → 不呼叫 API", async () => {
    let apiCalled = false;
    const mockApi = { createProperty: () => { apiCalled = true; } };
    const defs = { author: { format: "text" }, media: { format: "url" } };
    await ensureObjectsRawFallbacks(mockApi, "sp1", defs);
    expect(apiCalled).to.be.false;
  });

  it("有 objects 但 _raw 已存在 → 不呼叫 API", async () => {
    let apiCalled = false;
    const mockApi = { createProperty: () => { apiCalled = true; } };
    const defs = {
      author: { format: "objects" },
      author_raw: { key: "author_raw", format: "text" },
    };
    await ensureObjectsRawFallbacks(mockApi, "sp1", defs);
    expect(apiCalled).to.be.false;
  });

  it("有 objects 且 _raw 不存在 + API 成功 → propertyDefs 新增 _raw", async () => {
    const mockApi = { createProperty: () => ({}) };
    const defs = { author: { format: "objects" } };
    await ensureObjectsRawFallbacks(mockApi, "sp1", defs);
    expect(defs).to.have.property("author_raw");
    expect(defs.author_raw.format).to.equal("text");
  });

  it("API 回 'already exists' → 不 throw，propertyDefs 新增 _raw", async () => {
    const mockApi = {
      createProperty: () => { throw new Error("property already exists"); },
    };
    const defs = { author: { format: "objects" } };
    await ensureObjectsRawFallbacks(mockApi, "sp1", defs);
    expect(defs).to.have.property("author_raw");
    expect(defs.author_raw.format).to.equal("text");
  });

  it("API 回其他錯誤 → 不 throw，propertyDefs 不變", async () => {
    const mockApi = {
      createProperty: () => { throw new Error("network timeout"); },
    };
    const defs = { author: { format: "objects" } };
    await ensureObjectsRawFallbacks(mockApi, "sp1", defs);
    expect(defs).to.not.have.property("author_raw");
  });

  it("多個 objects 屬性 → 逐一建立，互不影響", async () => {
    const created = [];
    const mockApi = {
      createProperty: (spaceId, spec) => { created.push(spec.key); },
    };
    const defs = {
      author: { format: "objects" },
      media: { format: "objects" },
      excerpt: { format: "text" },
    };
    await ensureObjectsRawFallbacks(mockApi, "sp1", defs);
    expect(created).to.include("author_raw");
    expect(created).to.include("media_raw");
    expect(created).to.have.length(2);
    expect(defs).to.have.property("author_raw");
    expect(defs).to.have.property("media_raw");
  });

  it("name 格式化 → key + ' (raw text)'", async () => {
    let capturedSpec;
    const mockApi = {
      createProperty: (spaceId, spec) => { capturedSpec = spec; },
    };
    const defs = { reviewer: { format: "objects" } };
    await ensureObjectsRawFallbacks(mockApi, "sp1", defs);
    expect(capturedSpec.name).to.equal("reviewer (raw text)");
  });
});

// ── DEFAULT_RELATION_TARGETS ────────────────────────────────────────────────

describe("DEFAULT_RELATION_TARGETS", () => {
  it("author 偏好 human/person", () => {
    expect(DEFAULT_RELATION_TARGETS.author).to.deep.equal(["human", "person"]);
  });

  it("media 偏好 media/publisher/organization", () => {
    expect(DEFAULT_RELATION_TARGETS.media).to.deep.equal(["media", "publisher", "organization"]);
  });

  it("channel 偏好 channel", () => {
    expect(DEFAULT_RELATION_TARGETS.channel).to.deep.equal(["channel"]);
  });
});

// ── runClipPipeline - objects fallback ────────────────────────────────────────

describe("runClipPipeline() - objects fallback", () => {
  let savedCryptoDesc, savedChrome;

  beforeEach(() => {
    savedCryptoDesc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      value: {
        subtle: {
          digest: async () => new Uint8Array(32).buffer,
        },
      },
      writable: true,
      configurable: true,
    });
    savedChrome = globalThis.chrome;
    globalThis.chrome = {
      storage: {
        session: {
          get: async () => ({}),
          set: async () => {},
        },
      },
    };
  });

  afterEach(() => {
    if (savedCryptoDesc) {
      Object.defineProperty(globalThis, "crypto", savedCryptoDesc);
    }
    globalThis.chrome = savedChrome;
  });

  const fallbackExtraction = {
    url: "https://example.com/article",
    title: "Test Article",
    excerpt: "An excerpt",
    author: "Unknown Author",
    siteName: "Example",
    publishedAt: "",
    coverImageUrl: "",
    embeddedUrls: [],
  };

  function makeMockApi(spaceId, { createPropertyFails = false } = {}) {
    const baseDefs = {
      source_url: { format: "url", key: "source_url" },
      excerpt: { format: "text", key: "excerpt" },
      read_time_min: { format: "number", key: "read_time_min" },
      captured_at: { format: "date", key: "captured_at" },
      author: { format: "objects", key: "author" },
      media: { format: "text", key: "media" },
      cover_image_url: { format: "url", key: "cover_image_url" },
      clip_source: { format: "text", key: "clip_source" },
    };
    let capturedCreateProps;
    const api = {
      ensureWebClipType: async () => {},
      listProperties: async () => ({ ...baseDefs }),
      createProperty: async () => {
        if (createPropertyFails) throw new Error("network timeout");
        return {};
      },
      getPropertyByKey: async () => ({ id: "tag-prop-id" }),
      listTags: async () => [],
      searchObjects: async () => [],
      createClipObject: async (sid, args) => {
        capturedCreateProps = args.properties;
        return "obj-" + sid;
      },
    };
    return { api, getCapturedProps: () => capturedCreateProps };
  }

  it("unresolved + _raw 在 propertyDefs → properties 含 _raw entry", async () => {
    const spaceId = "sp-fallback-avail-" + Date.now();
    const { api, getCapturedProps } = makeMockApi(spaceId);
    const result = await runClipPipeline(api, {
      extraction: fallbackExtraction,
      markdown: "# Test",
      spaceId,
      tagNames: [],
      readTimeMin: 1,
      customFields: {},
    });
    const props = getCapturedProps();
    const rawEntry = props.find((p) => p.key === "author_raw");
    expect(rawEntry).to.exist;
    expect(rawEntry.text).to.equal("Unknown Author");
    expect(result.warnings.some((w) => w.includes("raw_fallback_unavailable"))).to.be.false;
  });

  it("unresolved + _raw 不在 propertyDefs → warnings 含 raw_fallback_unavailable", async () => {
    const spaceId = "sp-fallback-unavail-" + Date.now();
    const { api, getCapturedProps } = makeMockApi(spaceId, { createPropertyFails: true });
    const result = await runClipPipeline(api, {
      extraction: fallbackExtraction,
      markdown: "# Test",
      spaceId,
      tagNames: [],
      readTimeMin: 1,
      customFields: {},
    });
    const props = getCapturedProps();
    expect(props.find((p) => p.key === "author_raw")).to.be.undefined;
    expect(result.warnings.some((w) => w.includes("raw_fallback_unavailable:author_raw"))).to.be.true;
  });

  it("clip_source property 固定為 'webclipper'", async () => {
    const spaceId = "sp-clip-source-" + Date.now();
    const { api, getCapturedProps } = makeMockApi(spaceId);
    await runClipPipeline(api, {
      extraction: fallbackExtraction,
      markdown: "# Test",
      spaceId,
      tagNames: [],
      readTimeMin: 1,
      customFields: {},
    });
    const props = getCapturedProps();
    const cs = props.find((p) => p.key === "clip_source");
    expect(cs).to.exist;
    expect(cs.text).to.equal("webclipper");
  });

  it("quickSave: true → action 為 'bookmarked'，stats 全為 0", async () => {
    const spaceId = "sp-quick-save-" + Date.now();
    let capturedCreateArgs;
    const baseDefs = {
      source_url: { format: "url", key: "source_url" },
      clip_source: { format: "text", key: "clip_source" },
    };
    const api = {
      ensureWebClipType: async () => {},
      listProperties: async () => ({ ...baseDefs }),
      createProperty: async () => ({}),
      getPropertyByKey: async () => ({ id: "tag-prop-id" }),
      listTags: async () => [],
      searchObjects: async () => [],
      createObject: async (sid, args) => {
        capturedCreateArgs = args;
        return "obj-quick-" + sid;
      },
      createClipObject: async () => { throw new Error("should not be called for quickSave"); },
    };
    const result = await runClipPipeline(api, {
      extraction: { url: "https://example.com", title: "Quick", excerpt: "", author: "", siteName: "", publishedAt: "", coverImageUrl: "", embeddedUrls: [] },
      markdown: "",
      spaceId,
      tagNames: [],
      readTimeMin: 0,
      quickSave: true,
    });
    expect(result.action).to.equal("bookmarked");
    expect(result.quick_save).to.be.true;
    expect(result.stats.word_count).to.equal(0);
    expect(result.stats.read_time_min).to.equal(0);
    expect(capturedCreateArgs).to.exist;
    expect(capturedCreateArgs.name).to.equal("Quick");
  });
});
