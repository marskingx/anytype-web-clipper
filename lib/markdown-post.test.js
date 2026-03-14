"use strict";

const { expect } = require("chai");
const {
  normalizeMarkdown,
  trimCommentsSection,
  normalizeForCompare,
  isTitleBlock,
  normalizeRelativeDay,
  stripLegacyEmbedSection,
  appendEmbeddedMedia,
  dedupeUrls,
  estimateWordCount,
  estimateReadTime,
  excerptFromMarkdown,
  sanitizeMarkdown,
  postProcessMarkdown,
} = require("./markdown-post");

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ── normalizeMarkdown ──────────────────────────────────────────────────────────

describe("normalizeMarkdown()", () => {
  it("null / 空字串 → 空字串", () => {
    expect(normalizeMarkdown(null)).to.equal("");
    expect(normalizeMarkdown("")).to.equal("");
  });

  it("3 個以上空行 → 壓縮成 2 個", () => {
    expect(normalizeMarkdown("a\n\n\n\nb")).to.equal("a\n\nb");
  });

  it("行尾空白（trailing spaces）→ 移除", () => {
    expect(normalizeMarkdown("hello   \nworld")).to.equal("hello\nworld");
  });

  it("CRLF → LF", () => {
    expect(normalizeMarkdown("a\r\nb")).to.equal("a\nb");
  });

  it("首尾空白 → trim", () => {
    expect(normalizeMarkdown("  \nhello\n  ")).to.equal("hello");
  });
});

// ── trimCommentsSection ────────────────────────────────────────────────────────

describe("trimCommentsSection()", () => {
  it("無留言 heading → 原文不變", () => {
    const md = "# Title\n\nContent here.";
    expect(trimCommentsSection(md)).to.equal(md);
  });

  it("有 ## Comments → 截斷在 heading 之前", () => {
    const md = "# Article\n\nBody text.\n\n## Comments\n\nUser: hello\n";
    const result = trimCommentsSection(md);
    expect(result).to.include("Body text.");
    expect(result).not.to.include("## Comments");
    expect(result).not.to.include("User: hello");
  });

  it("有 ## 留言 → 截斷（中文）", () => {
    const md = "正文\n\n## 留言\n\n回應";
    const result = trimCommentsSection(md);
    expect(result).to.include("正文");
    expect(result).not.to.include("留言");
  });

  it("有 # comment（h1，單數）→ 也截斷", () => {
    const md = "Content\n\n# Comment\n\nUser replies";
    const result = trimCommentsSection(md);
    expect(result).not.to.include("User replies");
  });
});

// ── normalizeForCompare ────────────────────────────────────────────────────────

describe("normalizeForCompare()", () => {
  it("null / 空字串 → 空字串", () => {
    expect(normalizeForCompare(null)).to.equal("");
    expect(normalizeForCompare("")).to.equal("");
  });

  it("移除 markdown heading 標記（# / ## / ###）", () => {
    expect(normalizeForCompare("# Hello")).to.equal("hello");
    expect(normalizeForCompare("## Hello World")).to.equal("hello world");
  });

  it("轉小寫", () => {
    expect(normalizeForCompare("Hello World")).to.equal("hello world");
  });

  it("多餘空白 → 單一空格", () => {
    expect(normalizeForCompare("hello   world")).to.equal("hello world");
  });
});

// ── isTitleBlock ───────────────────────────────────────────────────────────────

describe("isTitleBlock()", () => {
  it("block 完全等於 title → true", () => {
    expect(isTitleBlock("My Article", "my article")).to.be.true;
  });

  it("block 是 title 的前綴（title startsWith block）→ true", () => {
    // 短 block 是長 title 的開頭
    expect(isTitleBlock("My", "my article")).to.be.true;
  });

  it("block 比 title 長但以 title 開頭 → true", () => {
    expect(isTitleBlock("My Article: Extended Edition", "my article")).to.be.true;
  });

  it("block 和 title 完全不同 → false", () => {
    expect(isTitleBlock("Unrelated Content", "my article")).to.be.false;
  });

  it("空 title → false（無 title 不過濾）", () => {
    expect(isTitleBlock("anything", "")).to.be.false;
  });
});

// ── normalizeRelativeDay ───────────────────────────────────────────────────────

describe("normalizeRelativeDay()", () => {
  it("空字串 → 空字串", () => {
    expect(normalizeRelativeDay("")).to.equal("");
  });

  it("普通文字（非相對日期）→ 原樣回傳", () => {
    const block = "This is just a normal paragraph.";
    expect(normalizeRelativeDay(block)).to.equal(block);
  });

  it("'yesterday' → YYYY-MM-DD 格式", () => {
    const result = normalizeRelativeDay("yesterday");
    expect(result).to.match(ISO_DATE_REGEX);
  });

  it("'today' → YYYY-MM-DD 格式", () => {
    const result = normalizeRelativeDay("today");
    expect(result).to.match(ISO_DATE_REGEX);
  });

  it("'昨天' → YYYY-MM-DD 格式", () => {
    const result = normalizeRelativeDay("昨天");
    expect(result).to.match(ISO_DATE_REGEX);
  });

  it("'today' 和 'yesterday' 回傳的日期 today > yesterday", () => {
    const today = normalizeRelativeDay("today");
    const yesterday = normalizeRelativeDay("yesterday");
    expect(today > yesterday).to.be.true;
  });

  it("末尾標點（。）被去除後才比較", () => {
    const result = normalizeRelativeDay("yesterday。");
    expect(result).to.match(ISO_DATE_REGEX);
  });
});

// ── stripLegacyEmbedSection ───────────────────────────────────────────────────

describe("stripLegacyEmbedSection()", () => {
  it("null / 空字串 → 空字串", () => {
    expect(stripLegacyEmbedSection(null)).to.equal("");
    expect(stripLegacyEmbedSection("")).to.equal("");
  });

  it("無 Embedded Media heading → 原文不變", () => {
    const md = "# Title\n\nContent here.";
    expect(stripLegacyEmbedSection(md)).to.equal(md);
  });

  it("有 ## Embedded Media → 移除 heading 和 URL 行", () => {
    const md = "Content\n\n## Embedded Media\n\nhttps://youtube.com/watch?v=abc\n\nNext section";
    const result = stripLegacyEmbedSection(md);
    expect(result).to.include("Content");
    expect(result).not.to.include("Embedded Media");
    expect(result).not.to.include("youtube.com");
  });

  it("Embedded Media 後接非 URL 非空行 → 重新開始輸出", () => {
    const md = "Article\n\n## Embedded Media\n\nhttps://youtube.com/abc\n\nReal next section";
    const result = stripLegacyEmbedSection(md);
    expect(result).to.include("Real next section");
  });
});

// ── appendEmbeddedMedia ────────────────────────────────────────────────────────

describe("appendEmbeddedMedia()", () => {
  it("無 URLs → 原 markdown 不變", () => {
    const md = "# Article";
    expect(appendEmbeddedMedia(md, [])).to.equal(md);
  });

  it("null URLs → 原 markdown 不變", () => {
    expect(appendEmbeddedMedia("content", null)).to.equal("content");
  });

  it("有 URLs → 追加 ### Media Links 段落", () => {
    const result = appendEmbeddedMedia("Article", ["https://youtube.com/abc"]);
    expect(result).to.include("### Media Links");
    expect(result).to.include("https://youtube.com/abc");
  });

  it("重複 URL → 只出現一條 link 項目", () => {
    const result = appendEmbeddedMedia("Article", [
      "https://youtube.com/abc",
      "https://youtube.com/abc",
    ]);
    // markdown link 格式 [URL](URL) 每個 URL 出現兩次（text + href），
    // 改計算含有該 URL 的「完整 link」行數
    const linkLines = result.split("\n").filter((l) => l.includes("[https://youtube.com/abc]"));
    expect(linkLines).to.have.length(1);
  });

  it("空 markdown + 有 URLs → 只輸出 media block", () => {
    const result = appendEmbeddedMedia("", ["https://youtube.com/abc"]);
    expect(result).to.include("### Media Links");
  });
});

// ── dedupeUrls ────────────────────────────────────────────────────────────────

describe("dedupeUrls()", () => {
  it("空陣列 → 空陣列", () => {
    expect(dedupeUrls([])).to.deep.equal([]);
  });

  it("重複 URL → 只保留第一個", () => {
    const result = dedupeUrls(["https://a.com", "https://a.com", "https://b.com"]);
    expect(result).to.deep.equal(["https://a.com", "https://b.com"]);
  });

  it("空字串 URL → 過濾掉", () => {
    const result = dedupeUrls(["https://a.com", "", "https://b.com"]);
    expect(result).to.deep.equal(["https://a.com", "https://b.com"]);
  });
});

// ── estimateWordCount ──────────────────────────────────────────────────────────

describe("estimateWordCount() [markdown-post]", () => {
  it("空字串 → 1（最小值）", () => {
    expect(estimateWordCount("")).to.equal(1);
  });

  it("純英文：n 個單詞 + max(1,0) = n+1", () => {
    // "hello world" → 2 latinWords + max(1,0)=1 → 3
    expect(estimateWordCount("hello world")).to.equal(3);
  });

  it("中文字元 → CJK+拉丁混合計算", () => {
    // "你好" → 0 latin + max(1, floor(2/2))=1 → 1
    expect(estimateWordCount("你好")).to.equal(1);
  });
});

// ── estimateReadTime ───────────────────────────────────────────────────────────

describe("estimateReadTime()", () => {
  it("0 字 → 1 分鐘（最小值）", () => {
    expect(estimateReadTime(0)).to.equal(1);
  });

  it("260 字（預設 wpm）→ 1 分鐘", () => {
    expect(estimateReadTime(260)).to.equal(1);
  });

  it("261 字 → 2 分鐘（ceil）", () => {
    expect(estimateReadTime(261)).to.equal(2);
  });

  it("1040 字 → 4 分鐘", () => {
    expect(estimateReadTime(1040)).to.equal(4);
  });

  it("自訂 wpm = 130 → 用自訂 wpm 計算", () => {
    // 130 words / 130 wpm = 1 min
    expect(estimateReadTime(130, 130)).to.equal(1);
    // 131 words / 130 wpm = ceil(1.007...) = 2 min
    expect(estimateReadTime(131, 130)).to.equal(2);
  });
});

// ── excerptFromMarkdown ────────────────────────────────────────────────────────

describe("excerptFromMarkdown()", () => {
  it("空字串 → 空字串", () => {
    expect(excerptFromMarkdown("")).to.equal("");
  });

  it("移除 markdown 圖片語法", () => {
    const result = excerptFromMarkdown("![alt](https://img.com/photo.jpg) Some text");
    expect(result).not.to.include("![");
    expect(result).to.include("Some text");
  });

  it("移除 markdown 連結語法（保留純文字）", () => {
    const result = excerptFromMarkdown("[Click here](https://example.com) for more");
    expect(result).not.to.include("[Click here]");
    expect(result).not.to.include("(https://");
    expect(result).to.include("for more");
  });

  it("移除 heading / bold / code 符號", () => {
    const result = excerptFromMarkdown("# Title\n**bold** `code`");
    expect(result).not.to.match(/^#/);
  });

  it("超過 maxLen → 截斷並加 …", () => {
    const longText = "a".repeat(200);
    const result = excerptFromMarkdown(longText, 180);
    expect(result.length).to.be.at.most(180);
    expect(result.endsWith("…")).to.be.true;
  });

  it("短於 maxLen → 不截斷，不加 …", () => {
    const result = excerptFromMarkdown("Short text", 180);
    expect(result).to.equal("Short text");
    expect(result.endsWith("…")).to.be.false;
  });
});

// ── sanitizeMarkdown ───────────────────────────────────────────────────────────

describe("sanitizeMarkdown()", () => {
  it("空字串 → 空字串", () => {
    expect(sanitizeMarkdown("")).to.equal("");
    expect(sanitizeMarkdown(null)).to.equal("");
  });

  it("與 title 相同的段落 → 被移除", () => {
    const md = "My Article\n\nThis is the actual content.";
    const result = sanitizeMarkdown(md, "My Article");
    expect(result).not.to.include("My Article");
    expect(result).to.include("This is the actual content.");
  });

  it("連續重複段落 → 只保留第一個", () => {
    const md = "Block A\n\nBlock A\n\nBlock B";
    const result = sanitizeMarkdown(md);
    const count = (result.match(/Block A/g) || []).length;
    expect(count).to.equal(1);
  });

  it("Comments heading 之後的內容 → 被截斷", () => {
    const md = "Main content\n\n## Comments\n\nUser: hello";
    const result = sanitizeMarkdown(md);
    expect(result).to.include("Main content");
    expect(result).not.to.include("User: hello");
  });

  it("長段落（>=160 字元）重複 → 只保留第一個", () => {
    // 用獨特前綴確保子串只在完整 block 中出現一次
    const longBlock = "LONG_BLOCK_START_" + "x".repeat(145);
    const md = `${longBlock}\n\n${longBlock}`;
    const result = sanitizeMarkdown(md);
    const count = (result.match(/LONG_BLOCK_START_/g) || []).length;
    expect(count).to.equal(1);
  });
});

// ── postProcessMarkdown ────────────────────────────────────────────────────────

describe("postProcessMarkdown()", () => {
  it("空字串 → 空字串", () => {
    expect(postProcessMarkdown("")).to.equal("");
  });

  it("多餘空行被壓縮", () => {
    const md = "a\n\n\n\nb";
    const result = postProcessMarkdown(md);
    expect(result).not.to.include("\n\n\n");
  });

  it("title 段落被移除 + embedded URLs 被追加", () => {
    const md = "My Article\n\nActual content here.";
    const result = postProcessMarkdown(md, {
      title: "My Article",
      embeddedUrls: ["https://youtube.com/watch?v=abc"],
    });
    expect(result).not.to.include("My Article");
    expect(result).to.include("Actual content here.");
    expect(result).to.include("### Media Links");
  });

  it("舊 Embedded Media 段落被移除，新的被追加", () => {
    const md = "Content\n\n## Embedded Media\n\nhttps://old.url/video";
    const result = postProcessMarkdown(md, {
      embeddedUrls: ["https://youtube.com/new"],
    });
    expect(result).not.to.include("https://old.url/video");
    expect(result).to.include("https://youtube.com/new");
  });
});
