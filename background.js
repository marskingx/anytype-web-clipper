/**
 * background.js — Service Worker
 * 直連 Anytype API (port 31009)，不需要 Python service
 */

importScripts(
  "lib/i18n-helper.js",
  "lib/anytype-api.js",
  "lib/markdown-post.js",
  "lib/clip-pipeline.js"
);

// ── API 客戶端工廠 ─────────────────────────────────────────────────────────────

async function getApi() {
  const apiKey = await AnytypeApi.loadApiKey();
  return new AnytypeApi({ apiKey });
}

// ── Message router ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  const handlers = {
    CLIP_CURRENT_TAB: handleClipCurrentTab,
    GET_OPTIONS: handleGetOptions,
    CHECK_DUPLICATE: handleCheckDuplicate,
    UPDATE_TAG: handleUpdateTag,
  };

  const handler = handlers[message.type];
  if (!handler) return;

  handler(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));

  return true; // keep channel open for async response
});

// ── Handler: CLIP_CURRENT_TAB ──────────────────────────────────────────────────

async function handleClipCurrentTab(message) {
  const clipOptions = message.clipOptions || {};
  const isQuickSave = !!clipOptions.quickSave;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) {
    throw new Error(t("error_page_not_clippable"));
  }
  if (isRestrictedUrl(tab.url)) {
    throw new Error(t("error_page_restricted"));
  }

  const api = await getApi();
  const apiKey = await AnytypeApi.loadApiKey();
  if (!apiKey) throw new Error(t("error_not_authenticated"));

  const spaceId = await api.resolveSpaceId(String(clipOptions.spaceId || ""));

  // Quick save: skip content extraction, bookmark only
  if (isQuickSave) {
    const extraction = {
      url: tab.url || "",
      title: String(clipOptions.title || tab.title || "").trim() || "Untitled",
      excerpt: "",
      author: "",
      siteName: "",
      publishedAt: "",
      coverImageUrl: "",
      embeddedUrls: [],
    };
    return runClipPipeline(api, {
      extraction,
      markdown: "",
      spaceId,
      typeKey: String(clipOptions.typeKey || ""),
      tagNames: Array.isArray(clipOptions.tagNames) ? clipOptions.tagNames : [],
      iconEmoji: String(clipOptions.iconEmoji || ""),
      duplicateStrategy: String(clipOptions.duplicateStrategy || "create"),
      duplicateTargetObjectId: String(clipOptions.duplicateTargetObjectId || ""),
      requestNonce: String(clipOptions.requestNonce || ""),
      customFields: clipOptions.customFields || {},
      readTimeMin: 0,
      quickSave: true,
    });
  }

  // Full clip: inject content script (Readability + Turndown + extractor)
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [
      "vendor/readability.js",
      "vendor/turndown.js",
      "lib/content-extractor.js",
    ],
  });

  if (!injected || !injected.result) {
    throw new Error(t("error_extract_failed"));
  }

  const extraction = injected.result;

  // Markdown 後處理
  let markdown = postProcessMarkdown(extraction.markdown || "", {
    title: extraction.title || "",
    embeddedUrls: extraction.embeddedUrls || [],
  });

  if (!markdown) throw new Error(t("error_content_empty"));

  const wordCount = estimateWordCount(markdown);
  const readTimeMin = estimateReadTime(wordCount);

  return runClipPipeline(api, {
    extraction,
    markdown,
    spaceId,
    typeKey: String(clipOptions.typeKey || ""),
    tagNames: Array.isArray(clipOptions.tagNames) ? clipOptions.tagNames : [],
    iconEmoji: String(clipOptions.iconEmoji || ""),
    duplicateStrategy: String(clipOptions.duplicateStrategy || "create"),
    duplicateTargetObjectId: String(clipOptions.duplicateTargetObjectId || ""),
    requestNonce: String(clipOptions.requestNonce || ""),
    customFields: clipOptions.customFields || {},
    readTimeMin,
  });
}

// ── Handler: GET_OPTIONS ───────────────────────────────────────────────────────

async function handleGetOptions(message) {
  const api = await getApi();
  const apiKey = await AnytypeApi.loadApiKey();
  if (!apiKey) return { setup_required: true };
  return getOptions(api, String(message.preferredSpaceId || ""));
}

// ── Handler: CHECK_DUPLICATE ───────────────────────────────────────────────────

async function handleCheckDuplicate(message) {
  const api = await getApi();
  return checkDuplicate(api, {
    url: String(message.url || ""),
    spaceId: String(message.spaceId || ""),
  });
}

// ── Handler: UPDATE_TAG ────────────────────────────────────────────────────────

async function handleUpdateTag(message) {
  const api = await getApi();
  return updateTag(api, {
    spaceId: String(message.spaceId || ""),
    tagId: String(message.tagId || ""),
    oldName: String(message.oldName || ""),
    newName: String(message.newName || ""),
    color: String(message.color || "grey"),
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isRestrictedUrl(url) {
  if (!url) return true;
  if (!/^https?:\/\//i.test(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "chrome.google.com" || host === "chromewebstore.google.com") return true;
    if (host.endsWith(".google.com") && url.includes("/webstore")) return true;
  } catch (_e) {
    return true;
  }
  return false;
}
