/**
 * markdown-post.js — Markdown 後處理
 * 移植自 cleaner.py，純字串操作，在 background service worker 執行
 */

"use strict";

/**
 * 壓縮多餘空行、清理行尾空白
 */
function normalizeMarkdown(markdown) {
  let s = String(markdown || "").replace(/\r\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]+\n/g, "\n");
  return s.trim();
}

/**
 * 留言區截斷、標題去重、段落去重
 */
function sanitizeMarkdown(markdown, title) {
  if (!markdown) return "";
  let trimmed = trimCommentsSection(markdown);
  const blocks = trimmed.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return "";

  const titleNormalized = normalizeForCompare(title || "");
  const cleanedBlocks = [];
  const seenLongBlocks = new Set();

  for (const block of blocks) {
    const normalized = normalizeRelativeDay(block);
    if (!normalized) continue;
    if (titleNormalized && isTitleBlock(normalized, titleNormalized)) continue;
    const compareKey = normalizeForCompare(normalized);
    if (!compareKey) continue;
    if (cleanedBlocks.length > 0 && compareKey === normalizeForCompare(cleanedBlocks[cleanedBlocks.length - 1])) continue;
    if (compareKey.length >= 160) {
      if (seenLongBlocks.has(compareKey)) continue;
      seenLongBlocks.add(compareKey);
    }
    cleanedBlocks.push(normalized);
  }

  return cleanedBlocks.join("\n\n").trim();
}

function trimCommentsSection(markdown) {
  const match = markdown.match(/(?:^|\n)#{1,6}\s*(?:comments?|留言|回應)\s*(?:\n|$)/im);
  if (!match) return markdown;
  return markdown.slice(0, match.index).trimEnd();
}

function normalizeForCompare(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const stripped = text.replace(/^#+\s*/, "").replace(/\s+/g, " ");
  return stripped.toLowerCase().trim();
}

function isTitleBlock(block, normalizedTitle) {
  if (!normalizedTitle) return false;
  const blockKey = normalizeForCompare(block);
  if (!blockKey) return false;
  return (
    blockKey === normalizedTitle ||
    normalizedTitle.startsWith(blockKey) ||
    blockKey.startsWith(normalizedTitle)
  );
}

/**
 * 相對日期正規化（"yesterday"/"today"/"昨天"/"今天" → ISO date）
 */
function normalizeRelativeDay(block) {
  const raw = String(block || "").trim();
  if (!raw) return "";
  const token = raw.replace(/[。．.!,，]+$/, "").trim().toLowerCase();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const yesterday = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  if (/^yesterday(\s+at\s+.+)?$/.test(token)) return yesterday;
  if (/^today(\s+at\s+.+)?$/.test(token)) return todayIso;
  if (token.startsWith("昨天")) return yesterday;
  if (token.startsWith("今天")) return todayIso;
  return raw;
}

/**
 * 移除舊的 embedded media 段落
 */
function stripLegacyEmbedSection(markdown) {
  if (!markdown) return "";
  const lines = markdown.split("\n");
  const output = [];
  let skipping = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{1,6}\s*embedded media\s*$/i.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (!line) continue;
      if (/^https?:\/\/\S+$/i.test(line)) continue;
      if (/^\[[^\]]*embed\]\([^)]+\)$/i.test(line)) continue;
      if (/^[A-Za-z0-9 ._-]*embed$/i.test(line)) continue;
      skipping = false;
    }
    output.push(rawLine);
  }

  return output.join("\n").trim();
}

/**
 * 追加 embedded media 連結段落
 */
function appendEmbeddedMedia(markdown, embeddedUrls) {
  const urls = dedupeUrls((embeddedUrls || []).map((u) => String(u || "").trim()).filter(Boolean));
  if (!urls.length) return markdown;
  const lines = ["### Media Links", ...urls.map((u) => `[${u}](${u})`)];
  const block = lines.join("\n\n").trim();
  if (!block) return markdown;
  if (!markdown) return block;
  return `${markdown}\n\n${block}`;
}

function dedupeUrls(values) {
  const seen = new Set();
  const output = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    output.push(v);
  }
  return output;
}

/**
 * 字數估算（CJK + 拉丁混合）
 */
function estimateWordCount(markdown) {
  const latinWords = (markdown.match(/[A-Za-z0-9_]+/g) || []).length;
  const cjkChars = (markdown.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.max(1, latinWords + Math.max(1, Math.floor(cjkChars / 2)));
}

/**
 * 閱讀時間估算（分鐘）
 */
function estimateReadTime(wordCount, wpm = 260) {
  return Math.max(1, Math.ceil(wordCount / Math.max(wpm, 120)));
}

/**
 * excerpt from markdown
 */
function excerptFromMarkdown(markdown, maxLen = 180) {
  let plain = String(markdown || "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/[#>*`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen - 1).trimEnd() + "…";
}

/**
 * 完整後處理管線
 */
function postProcessMarkdown(markdown, { title = "", embeddedUrls = [] } = {}) {
  let md = normalizeMarkdown(markdown);
  md = sanitizeMarkdown(md, title);
  md = stripLegacyEmbedSection(md);
  md = appendEmbeddedMedia(md, embeddedUrls);
  return md;
}

// Node.js test support
if (typeof module !== "undefined") module.exports = {
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
};
