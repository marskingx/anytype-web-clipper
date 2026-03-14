/**
 * content-extractor.js — Content Script
 * 注入頁面後提取文章內容、metadata、embedded media
 * 依賴：vendor/readability.js、vendor/turndown.js（需先載入）
 */

(function () {
  "use strict";

  const MEDIA_HOSTS = [
    "youtube.com", "youtu.be", "vimeo.com", "spotify.com",
    "soundcloud.com", "buzzsprout.com", "podcasts.apple.com",
  ];

  function abs(raw) {
    const v = String(raw || "").trim();
    if (!v) return "";
    if (v.startsWith("http://") || v.startsWith("https://")) return v;
    if (v.startsWith("//")) return "https:" + v;
    try { return new URL(v, location.href).toString(); } catch (_e) { return v; }
  }

  function isMedia(rawUrl) {
    try {
      const host = new URL(rawUrl, location.href).hostname.toLowerCase();
      return MEDIA_HOSTS.some((h) => host.includes(h));
    } catch (_e) { return false; }
  }

  // ── Metadata extraction ───────────────────────────────────────────────────

  function getMetaContent(attrName, attrValue) {
    const el = document.querySelector(`meta[${attrName}="${CSS.escape(attrValue)}"]`);
    return el ? (el.getAttribute("content") || "").trim() : "";
  }

  function getJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const results = [];
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent || "");
        if (data) results.push(data);
      } catch (_e) {}
    }
    return results;
  }

  function extractJsonLdValue(blocks, keys) {
    for (const block of blocks) {
      const items = Array.isArray(block) ? block : [block];
      for (const item of items) {
        for (const key of keys) {
          const val = item[key];
          if (typeof val === "string" && val.trim()) return val.trim();
          if (typeof val === "object" && val && val.name) return String(val.name).trim();
        }
      }
    }
    return "";
  }

  function extractMetadata() {
    const jsonld = getJsonLd();
    const meta = {};

    // Title
    meta.title =
      extractJsonLdValue(jsonld, ["headline", "name"]) ||
      getMetaContent("property", "og:title") ||
      getMetaContent("name", "twitter:title") ||
      (document.title || "").trim();

    // Description / excerpt
    meta.description =
      extractJsonLdValue(jsonld, ["description"]) ||
      getMetaContent("property", "og:description") ||
      getMetaContent("name", "twitter:description") ||
      getMetaContent("name", "description") ||
      "";

    // Author
    meta.author =
      extractJsonLdValue(jsonld, ["author"]) ||
      getMetaContent("name", "author") ||
      getMetaContent("property", "article:author") ||
      getMetaContent("name", "twitter:creator") ||
      "";

    // Published date
    meta.publishedAt =
      extractJsonLdValue(jsonld, ["datePublished"]) ||
      getMetaContent("property", "article:published_time") ||
      getMetaContent("property", "og:published_time") ||
      getMetaContent("name", "pubdate") ||
      getMetaContent("name", "date") ||
      getMetaContent("itemprop", "datePublished") ||
      "";

    // Cover image
    meta.coverImageUrl =
      extractJsonLdValue(jsonld, ["image", "thumbnailUrl"]) ||
      getMetaContent("property", "og:image") ||
      getMetaContent("name", "twitter:image") ||
      "";

    // Canonical URL
    const canonical = document.querySelector("link[rel='canonical']");
    meta.canonicalUrl =
      (canonical ? canonical.href : "") ||
      getMetaContent("property", "og:url") ||
      location.href;

    // Site name / media
    meta.siteName =
      extractJsonLdValue(jsonld, ["publisher"]) ||
      getMetaContent("property", "og:site_name") ||
      getMetaContent("name", "application-name") ||
      "";

    // Language
    meta.lang =
      (document.documentElement ? document.documentElement.lang || "" : "") ||
      getMetaContent("property", "og:locale") ||
      "";

    return meta;
  }

  // ── Embedded media extraction ─────────────────────────────────────────────

  function extractEmbeddedUrls() {
    const embedSet = new Set();

    document.querySelectorAll("iframe[src]").forEach((n) => {
      const u = abs(n.getAttribute("src"));
      if (u && isMedia(u)) embedSet.add(u);
    });

    document.querySelectorAll("a[href]").forEach((n) => {
      const u = abs(n.getAttribute("href"));
      if (u && isMedia(u)) embedSet.add(u);
    });

    return Array.from(embedSet).slice(0, 16);
  }

  // ── Word count ────────────────────────────────────────────────────────────

  function estimateWordCount(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const latin = (text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ").match(/\b\w+\b/g) || []).length;
    return cjk + latin;
  }

  // ── Main extraction ───────────────────────────────────────────────────────

  function extractContent() {
    const meta = extractMetadata();
    const embeddedUrls = extractEmbeddedUrls();

    let markdown = "";
    let textContent = "";
    let readabilityTitle = "";
    let readabilityExcerpt = "";
    let warnings = [];

    // Readability extraction
    if (typeof Readability !== "undefined") {
      try {
        const docClone = document.cloneNode(true);
        const reader = new Readability(docClone, { charThreshold: 200 });
        const article = reader.parse();
        if (article && article.content) {
          readabilityTitle = article.title || "";
          readabilityExcerpt = article.excerpt || "";
          textContent = article.textContent || "";

          // Turndown: HTML → Markdown
          if (typeof TurndownService !== "undefined") {
            const td = new TurndownService({
              headingStyle: "atx",
              bulletListMarker: "-",
              codeBlockStyle: "fenced",
            });
            markdown = td.turndown(article.content);
          } else {
            markdown = article.textContent || "";
            warnings.push("turndown_unavailable");
          }
        } else {
          warnings.push("readability_empty_result");
        }
      } catch (e) {
        warnings.push("readability_failed:" + String(e.message || e));
      }
    } else {
      warnings.push("readability_unavailable");
    }

    // Fallback: basic text extraction
    if (!markdown) {
      textContent = document.body ? (document.body.innerText || "") : "";
      markdown = textContent.trim();
    }

    const title = meta.title || readabilityTitle || document.title || "";
    const excerpt = meta.description || readabilityExcerpt || "";
    const wordCount = estimateWordCount(textContent || markdown);

    return {
      url: meta.canonicalUrl || location.href,
      originalUrl: location.href,
      title,
      markdown,
      excerpt,
      author: meta.author || "",
      publishedAt: meta.publishedAt || "",
      coverImageUrl: meta.coverImageUrl || "",
      siteName: meta.siteName || "",
      lang: meta.lang || "",
      domain: location.hostname || "",
      wordCount,
      embeddedUrls,
      warnings,
    };
  }

  // Export result via return value (used with executeScript)
  return extractContent();
})();
