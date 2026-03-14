/**
 * clip-pipeline.js — Clip 業務邏輯管線
 * 移植自 service.py 的 handle_clip()、_build_properties() 等
 * 在 background service worker 執行
 * 依賴：lib/anytype-api.js、lib/markdown-post.js
 */

"use strict";

const WEB_CLIP_TYPE_KEY = "web_clip";
const WEB_CLIP_TYPE_NAME = "Web Clip";
const FALLBACK_TYPE_KEY = "bookmark";
const DEDUP_TTL_MS = 120 * 1000;

const DEFAULT_RELATION_TARGETS = {
  author: ["human", "person"],
  media: ["media", "publisher", "organization"],
  channel: ["channel"],
};



// ── URL normalization ─────────────────────────────────────────────────────────

function normalizeSourceUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || "").trim());
    // 移除 fragment，lowercase scheme/host
    const scheme = u.protocol.toLowerCase().replace(/:$/, "");
    const host = u.hostname.toLowerCase();
    const port = u.port ? `:${u.port}` : "";
    let path = u.pathname || "/";
    if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
    const query = u.search || "";
    return `${scheme}://${host}${port}${path}${query}`;
  } catch (_e) {
    return String(rawUrl || "").trim();
  }
}

// ── SHA-256 signature (WebCrypto) ─────────────────────────────────────────────

async function computeSignature(parts) {
  const text = parts.join("\n");
  const encoded = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Dedup cache (chrome.storage.session) ─────────────────────────────────────

async function loadDedupCache() {
  if (!globalThis.chrome?.storage?.session) return {};
  const stored = await chrome.storage.session.get(["clipperDedupNonce", "clipperDedupSig"]);
  return {
    nonce: stored.clipperDedupNonce || {},
    sig: stored.clipperDedupSig || {},
  };
}

async function saveDedupCache(cache) {
  if (!globalThis.chrome?.storage?.session) return;
  await chrome.storage.session.set({
    clipperDedupNonce: cache.nonce,
    clipperDedupSig: cache.sig,
  });
}

function purgeDedupCache(cache) {
  const now = Date.now();
  const cutoff = now - DEDUP_TTL_MS;
  for (const store of [cache.nonce, cache.sig]) {
    for (const key of Object.keys(store)) {
      if ((store[key].ts || 0) < cutoff) delete store[key];
    }
  }
}

async function consumeDedupCache(requestNonce, signature) {
  const cache = await loadDedupCache();
  purgeDedupCache(cache);

  if (requestNonce) {
    const entry = cache.nonce[requestNonce];
    if (entry) return { cached: entry.response, reason: "nonce_replay" };
  }

  const sigEntry = cache.sig[signature];
  if (sigEntry) return { cached: sigEntry.response, reason: "content_replay" };

  await saveDedupCache(cache);
  return { cached: null, reason: "none" };
}

async function recordDedupCache(requestNonce, signature, response) {
  const cache = await loadDedupCache();
  purgeDedupCache(cache);
  const entry = { ts: Date.now(), response };
  cache.sig[signature] = entry;
  if (requestNonce) cache.nonce[requestNonce] = entry;
  await saveDedupCache(cache);
}

// ── Tag helpers ───────────────────────────────────────────────────────────────

function normalizeTagNames(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
  const seen = new Set();
  return list
    .map((s) => String(s || "").trim())
    .filter((s) => {
      if (!s) return false;
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

async function ensureAndResolveTagOptions(api, spaceId, tagNames) {
  if (!tagNames.length) return { tagOptions: [], warnings: [] };

  const warnings = [];
  let tagProp;
  try {
    tagProp = await api.getPropertyByKey(spaceId, "tag");
  } catch (e) {
    warnings.push(`get_tag_property_failed:${e.message}`);
    return { tagOptions: [], warnings };
  }

  if (!tagProp || !tagProp.id) {
    warnings.push("tag_property_missing");
    return { tagOptions: [], warnings };
  }

  const propertyId = String(tagProp.id);
  let existingTags;
  try {
    existingTags = await api.listTags(spaceId, propertyId);
  } catch (e) {
    warnings.push(`list_tags_failed:${e.message}`);
    return { tagOptions: [], warnings };
  }

  const byName = {};
  for (const t of existingTags) {
    const name = String(t.name || "").trim();
    if (name) byName[name.toLowerCase()] = t;
  }

  const resolved = [];
  for (const tagName of tagNames) {
    const lookup = tagName.toLowerCase();
    let tagObj = byName[lookup];
    if (!tagObj) {
      try {
        const created = await api.createTag(spaceId, propertyId, { name: tagName });
        tagObj = created.tag || created;
        if (tagObj) byName[lookup] = tagObj;
      } catch (e) {
        warnings.push(`create_tag_failed:${tagName}:${e.message}`);
        continue;
      }
    }
    if (!tagObj) { warnings.push(`create_tag_empty:${tagName}`); continue; }
    const tagKey = String(tagObj.key || "").trim();
    const tagId = String(tagObj.id || "").trim();
    if (tagKey) resolved.push(tagKey);
    else if (tagId) resolved.push(tagId);
    else warnings.push(`tag_option_missing:${tagName}`);
  }

  return { tagOptions: resolved, warnings };
}

// ── Property building ─────────────────────────────────────────────────────────

function normalizeIsoDatetime(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    return d.toISOString();
  } catch (_e) { return ""; }
}

function appendProperty(properties, warnings, propertyDefs, key, value, defaultFormat, pendingObjects) {
  if (value === undefined || value === null) return;
  const k = String(key || "").trim();
  if (!k) return;
  if (typeof value === "string" && !value.trim()) return;

  const propDef = propertyDefs[k] || {};
  const fmt = String(propDef.format || defaultFormat || "text").trim().toLowerCase();

  // 不支援的格式（需要 object ID，無法從純文字轉換）→ 跳過並記錄 warning
  const UNSUPPORTED_FORMATS = new Set(["object", "relation", "status", "tag", "file"]);
  if (UNSUPPORTED_FORMATS.has(fmt)) {
    warnings.push(`Skipped "${k}": format "${fmt}" not supported`);
    return;
  }

  if (fmt === "url") {
    const v = String(value).trim();
    if (v) properties.push({ key: k, url: v });
    return;
  }
  if (fmt === "number") {
    const n = parseFloat(value);
    if (isNaN(n)) { warnings.push(`property_number_invalid:${k}:${value}`); return; }
    properties.push({ key: k, number: n });
    return;
  }
  if (fmt === "date") {
    const iso = normalizeIsoDatetime(String(value));
    if (!iso) { warnings.push(`property_date_invalid:${k}:${value}`); return; }
    properties.push({ key: k, date: iso });
    return;
  }
  if (fmt === "checkbox") {
    const boolMap = { "1": true, "true": true, "yes": true, "y": true, "on": true,
                      "0": false, "false": false, "no": false, "n": false, "off": false };
    if (typeof value === "boolean") { properties.push({ key: k, checkbox: value }); return; }
    const raw = String(value).trim().toLowerCase();
    if (!(raw in boolMap)) { warnings.push(`property_checkbox_invalid:${k}:${value}`); return; }
    properties.push({ key: k, checkbox: boolMap[raw] });
    return;
  }
  if (fmt === "select") {
    const v = String(value).trim();
    if (v) properties.push({ key: k, select: v });
    return;
  }
  if (fmt === "multi_select") {
    const opts = Array.isArray(value)
      ? value.map((i) => String(i).trim()).filter(Boolean)
      : String(value).split(",").map((i) => i.trim()).filter(Boolean);
    if (opts.length) properties.push({ key: k, multi_select: opts });
    return;
  }
  if (fmt === "objects") {
    if (pendingObjects) {
      pendingObjects.push({ key: k, rawValue: String(value) });
    } else {
      warnings.push(`Skipped "${k}": format "objects" requires async resolution`);
    }
    return;
  }
  // text (default)
  const v = String(value).trim();
  if (v) properties.push({ key: k, text: v });
}

function buildProperties({ extraction, selectedTypeKey, readTimeMin, tagOptions, customFields, propertyDefs }) {
  const properties = [];
  const warnings = [];
  const pendingObjects = [];
  const capturedAt = new Date().toISOString();
  const typeKey = String(selectedTypeKey || "").trim().toLowerCase();

  if (typeKey === FALLBACK_TYPE_KEY) {
    appendProperty(properties, warnings, propertyDefs, "source", extraction.url, "url", pendingObjects);
    appendProperty(properties, warnings, propertyDefs, "clip_source", "webclipper", "text", pendingObjects);
    if (tagOptions.length) properties.push({ key: "tag", multi_select: tagOptions });
    return { properties, warnings, pendingObjects };
  }

  appendProperty(properties, warnings, propertyDefs, "source_url", extraction.url, "url", pendingObjects);
  appendProperty(properties, warnings, propertyDefs, "excerpt", extraction.excerpt, "text", pendingObjects);
  appendProperty(properties, warnings, propertyDefs, "read_time_min", readTimeMin, "number", pendingObjects);
  appendProperty(properties, warnings, propertyDefs, "captured_at", capturedAt, "date", pendingObjects);
  appendProperty(properties, warnings, propertyDefs, "author", customFields.author || extraction.author, "text", pendingObjects);
  appendProperty(properties, warnings, propertyDefs, "media", customFields.media || extraction.siteName, "text", pendingObjects);
  appendProperty(properties, warnings, propertyDefs, "cover_image_url", extraction.coverImageUrl, "url", pendingObjects);

  appendProperty(properties, warnings, propertyDefs, "clip_source", "webclipper", "text", pendingObjects);

  if (extraction.embeddedUrls && extraction.embeddedUrls.length) {
    const embJson = JSON.stringify(extraction.embeddedUrls);
    appendProperty(properties, warnings, propertyDefs, "embedded_media_urls", embJson, "text", pendingObjects);
  }

  if (tagOptions.length) properties.push({ key: "tag", multi_select: tagOptions });

  const publishedIso = normalizeIsoDatetime(extraction.publishedAt || "");
  if (publishedIso) appendProperty(properties, warnings, propertyDefs, "published_at", publishedIso, "date", pendingObjects);

  const reserved = new Set([
    "source_url", "excerpt", "read_time_min", "captured_at", "author", "author_raw",
    "media", "media_raw", "cover_image_url", "embedded_media_urls", "tag", "published_at", "source",
    "clip_source",
  ]);
  for (const [cfKey, cfVal] of Object.entries(customFields || {})) {
    if (reserved.has(cfKey) || !cfVal) continue;
    appendProperty(properties, warnings, propertyDefs, cfKey, cfVal, "text", pendingObjects);
  }

  return { properties, warnings, pendingObjects };
}

function filterSupportedProperties(properties, supportedKeys) {
  const filtered = [];
  const dropped = [];
  const seen = new Set();
  for (const item of properties) {
    const key = String(item.key || "").trim();
    if (!key) continue;
    if (supportedKeys.has(key)) {
      filtered.push(item);
    } else if (!seen.has(key)) {
      dropped.push(key);
      seen.add(key);
    }
  }
  return { filtered, dropped };
}

// ── Space / Type setup cache (in-memory, service worker lifetime) ─────────────

const _typeReadySpaces = new Set();
const _spacePropertyDefs = {};

async function ensureType(api, spaceId) {
  if (_typeReadySpaces.has(spaceId)) return;
  await api.ensureWebClipType(spaceId, WEB_CLIP_TYPE_KEY, WEB_CLIP_TYPE_NAME);
  await refreshSpaceProperties(api, spaceId);
  await ensureObjectsRawFallbacks(api, spaceId, _spacePropertyDefs[spaceId]);
  _typeReadySpaces.add(spaceId);
}

async function ensureObjectsRawFallbacks(api, spaceId, propertyDefs) {
  const toCreate = [];
  for (const [key, def] of Object.entries(propertyDefs)) {
    if (String(def.format || "").toLowerCase() !== "objects") continue;
    const rawKey = key + "_raw";
    if (propertyDefs[rawKey]) continue;
    toCreate.push({ key: rawKey, name: key + " (raw text)", format: "text" });
  }
  for (const spec of toCreate) {
    try {
      await api.createProperty(spaceId, spec);
      propertyDefs[spec.key] = { key: spec.key, format: "text" };
    } catch (e) {
      if (String(e.message || "").includes("already exists")) {
        propertyDefs[spec.key] = { key: spec.key, format: "text" };
      }
    }
  }
}

async function refreshSpaceProperties(api, spaceId) {
  const props = await api.listProperties(spaceId);
  _spacePropertyDefs[spaceId] = props;
  return props;
}

async function getSpacePropertyDefs(api, spaceId) {
  if (_spacePropertyDefs[spaceId]) return _spacePropertyDefs[spaceId];
  return refreshSpaceProperties(api, spaceId);
}

// ── Objects resolution helpers ────────────────────────────────────────────────

function extractTypeKey(item) {
  const typeVal = item.type;
  if (typeVal && typeof typeVal === "object") {
    const k = typeVal.key || typeVal.type_key;
    if (k) return String(k).trim();
  }
  if (typeof typeVal === "string") return typeVal.trim();
  const alt = item.type_key || item.typeKey;
  if (alt) return String(alt).trim();
  return "";
}

function findExactNameMatch(hits, name, preferredTypeKeys) {
  const nameLower = String(name || "").trim().toLowerCase();
  if (!nameLower || !hits.length) return "";

  let fallbackId = "";
  for (const hit of hits) {
    const hitName = String(hit.name || "").trim().toLowerCase();
    if (hitName !== nameLower) continue;
    const hitId = String(hit.id || "").trim();
    if (!hitId) continue;
    if (preferredTypeKeys && preferredTypeKeys.length) {
      const tk = extractTypeKey(hit).toLowerCase();
      if (preferredTypeKeys.some((p) => tk.includes(p))) return hitId;
      if (!fallbackId) fallbackId = hitId;
    } else {
      return hitId;
    }
  }
  return fallbackId;
}

async function resolveObjectIds(api, spaceId, rawValue, preferredTypeKeys) {
  const tokens = String(rawValue || "").split(",").map((s) => s.trim()).filter(Boolean);
  const resolved = [];
  const unresolved = [];
  const seen = new Set();

  for (const token of tokens) {
    if (token.startsWith("bafy")) {
      if (!seen.has(token)) { resolved.push(token); seen.add(token); }
      continue;
    }
    try {
      const hits = await api.searchObjects(spaceId, { query: token, limit: 20 });
      const id = findExactNameMatch(hits, token, preferredTypeKeys);
      if (id && !seen.has(id)) {
        resolved.push(id);
        seen.add(id);
      } else if (!id) {
        unresolved.push(token);
      }
    } catch (_e) {
      unresolved.push(token);
    }
  }

  return { resolved, unresolved };
}

// ── Main clip pipeline ────────────────────────────────────────────────────────

async function runClipPipeline(api, {
  extraction,
  markdown,
  spaceId,
  typeKey,
  tagNames = [],
  iconEmoji = "",
  duplicateStrategy = "create",
  duplicateTargetObjectId = "",
  requestNonce = "",
  customFields = {},
  readTimeMin = 1,
  quickSave = false,
}) {
  const warnings = [];

  const normalizedUrl = normalizeSourceUrl(extraction.url || "");
  const clipTitle = String(extraction.title || normalizedUrl || "Untitled").trim().slice(0, 300);

  // Dedup check
  const signature = await computeSignature([spaceId, normalizedUrl, clipTitle, markdown]);
  const { cached, reason } = await consumeDedupCache(requestNonce, signature);
  if (cached) {
    return { ...cached, dedup_applied: true, dedup_reason: reason };
  }

  // Ensure web_clip type exists
  let selectedTypeKey = typeKey || WEB_CLIP_TYPE_KEY;
  if (selectedTypeKey === WEB_CLIP_TYPE_KEY) {
    try {
      await ensureType(api, spaceId);
    } catch (e) {
      warnings.push(`ensure_type_failed_fallback:${e.message}`);
      selectedTypeKey = FALLBACK_TYPE_KEY;
    }
  }

  // Resolve tags
  const { tagOptions, warnings: tagWarnings } = await ensureAndResolveTagOptions(
    api, spaceId, normalizeTagNames(tagNames)
  );
  warnings.push(...tagWarnings);

  // Build properties
  const propertyDefs = await getSpacePropertyDefs(api, spaceId);
  const normalizedCustom = {};
  for (const [k, v] of Object.entries(customFields || {})) {
    const nk = String(k || "").trim();
    const nv = String(v || "").trim();
    if (nk && nv) normalizedCustom[nk] = nv;
  }

  const { properties: rawProps, warnings: propWarnings, pendingObjects } = buildProperties({
    extraction,
    selectedTypeKey,
    readTimeMin,
    tagOptions,
    customFields: normalizedCustom,
    propertyDefs,
  });
  warnings.push(...propWarnings);

  // Resolve objects format properties with raw text fallback
  if (pendingObjects && pendingObjects.length) {
    for (const pending of pendingObjects) {
      const preferredTypes = DEFAULT_RELATION_TARGETS[pending.key] || [];
      const { resolved, unresolved } = await resolveObjectIds(
        api, spaceId, pending.rawValue, preferredTypes
      );
      if (resolved.length) {
        rawProps.push({ key: pending.key, objects: resolved });
      }
      if (unresolved.length) {
        const rawKey = pending.key + "_raw";
        if (propertyDefs[rawKey]) {
          rawProps.push({ key: rawKey, text: unresolved.join(", ") });
        } else {
          warnings.push(`raw_fallback_unavailable:${rawKey}:property does not exist in space`);
        }
      }
    }
  }

  // Filter to known properties
  const { filtered: properties, dropped } = filterSupportedProperties(
    rawProps,
    new Set(Object.keys(propertyDefs))
  );
  if (dropped.length) warnings.push(`dropped_unknown_properties:${dropped.join(",")}`);

  const iconPayload = iconEmoji ? { format: "emoji", emoji: iconEmoji } : null;

  // Create or Update
  let objectId = "";
  let action = "created";

  if (quickSave) {
    // Quick save: single API call, no markdown content (avoids two-step race condition)
    try {
      objectId = await api.createObject(spaceId, {
        typeKey: selectedTypeKey,
        name: clipTitle,
        properties,
        icon: iconPayload,
      });
    } catch (e) {
      if (selectedTypeKey !== FALLBACK_TYPE_KEY) {
        warnings.push(`create_failed_retry_fallback:${e.message}`);
        objectId = await api.createObject(spaceId, {
          typeKey: FALLBACK_TYPE_KEY,
          name: clipTitle,
          properties,
          icon: iconPayload,
        });
      } else {
        throw e;
      }
    }
    action = "bookmarked";
  } else if (duplicateStrategy === "update" && duplicateTargetObjectId) {
    await api.updateClipObject(spaceId, duplicateTargetObjectId, {
      title: clipTitle,
      markdown,
      properties,
      icon: iconPayload,
    });
    objectId = duplicateTargetObjectId;
    action = "updated";
  } else {
    try {
      objectId = await api.createClipObject(spaceId, {
        title: clipTitle,
        markdown,
        properties,
        typeKey: selectedTypeKey,
        icon: iconPayload,
      });
    } catch (e) {
      if (selectedTypeKey !== FALLBACK_TYPE_KEY) {
        warnings.push(`create_failed_retry_fallback:${e.message}`);
        objectId = await api.createClipObject(spaceId, {
          title: clipTitle,
          markdown,
          properties,
          typeKey: FALLBACK_TYPE_KEY,
          icon: iconPayload,
        });
      } else {
        throw e;
      }
    }
  }

  const result = {
    status: "ok",
    object_id: objectId,
    space_id: spaceId,
    action,
    quick_save: quickSave,
    open_url: objectId ? `anytype://object/${objectId}?space=${spaceId}` : "",
    stats: {
      word_count: quickSave ? 0 : (readTimeMin > 0 ? estimateWordCount(markdown) : 0),
      read_time_min: quickSave ? 0 : readTimeMin,
      embedded_media: quickSave ? 0 : (extraction.embeddedUrls || []).length,
      images_queued: 0,
    },
    warnings,
    dedup_applied: false,
    dedup_reason: "none",
  };

  await recordDedupCache(requestNonce, signature, result);
  return result;
}

// ── API options (spaces / types / tags) ───────────────────────────────────────

async function getOptions(api, preferredSpaceId = "") {
  const spacesRaw = await api.listSpaces();
  const spaces = spacesRaw
    .map((s) => ({
      id: String(s.id || s.space_id || "").trim(),
      name: String(s.name || s.title || "").trim(),
    }))
    .filter((s) => s.id);

  if (!spaces.length) throw new Error(t("error_no_spaces"));

  const spaceId = await api.resolveSpaceId(preferredSpaceId);
  const resolvedSpaceId = spaces.some((s) => s.id === spaceId) ? spaceId : spaces[0].id;

  const warnings = [];
  try {
    await ensureType(api, resolvedSpaceId);
  } catch (e) {
    warnings.push(`ensure_type_failed:${e.message}`);
  }

  const typesRaw = await api.listTypes(resolvedSpaceId);
  let types = typesRaw
    .filter((t) => t.key && !t.archived)
    .map((t) => {
      const icon = (typeof t.icon === "object" && t.icon) ? t.icon : {};
      return {
        key: String(t.key).trim(),
        name: String(t.name || t.key).trim(),
        icon_emoji: String(icon.emoji || "").trim(),
        icon: {
          format: String(icon.format || "").trim(),
          emoji: String(icon.emoji || "").trim(),
          name: String(icon.name || "").trim(),
          color: String(icon.color || "").trim(),
        },
      };
    });

  if (!types.length) {
    types = [{ key: "page", name: "Page", icon_emoji: "", icon: { format: "", emoji: "", name: "", color: "" } }];
  }

  const defaultTypeKey = types.some((t) => t.key === WEB_CLIP_TYPE_KEY)
    ? WEB_CLIP_TYPE_KEY
    : (types.some((t) => t.key === FALLBACK_TYPE_KEY) ? FALLBACK_TYPE_KEY : types[0].key);

  const tags = [];
  try {
    const tagProp = await api.getPropertyByKey(resolvedSpaceId, "tag");
    if (tagProp && tagProp.id) {
      const rawTags = await api.listTags(resolvedSpaceId, String(tagProp.id));
      for (const t of rawTags) {
        const id = String(t.id || "").trim();
        const name = String(t.name || "").trim();
        if (!id || !name) continue;
        tags.push({
          id,
          key: String(t.key || "").trim(),
          name,
          color: String(t.color || "grey").trim(),
        });
      }
    }
  } catch (e) {
    warnings.push(`list_tags_failed:${e.message}`);
  }

  return {
    setup_required: false,
    spaces,
    types,
    tags,
    defaults: {
      space_id: resolvedSpaceId,
      type_key: defaultTypeKey,
    },
    warnings,
  };
}

// ── Duplicate check ───────────────────────────────────────────────────────────

async function checkDuplicate(api, { url, spaceId }) {
  const normalizedUrl = normalizeSourceUrl(url);
  const resolvedSpaceId = await api.resolveSpaceId(spaceId);
  const matches = await api.findObjectsBySourceUrl(resolvedSpaceId, normalizedUrl);
  return {
    status: "ok",
    space_id: resolvedSpaceId,
    url: normalizedUrl,
    exists: matches.length > 0,
    matches,
  };
}

// ── Tag update ────────────────────────────────────────────────────────────────

async function updateTag(api, { spaceId, tagId, oldName, newName, color }) {
  const resolvedSpaceId = await api.resolveSpaceId(spaceId);
  if (!newName) throw new Error(t("error_missing_new_name"));

  const normalizedColor = normalizeTagColor(color);
  const tagProp = await api.getPropertyByKey(resolvedSpaceId, "tag");
  if (!tagProp || !tagProp.id) throw new Error("tag_property_missing");

  const propertyId = String(tagProp.id);
  const tags = await api.listTags(resolvedSpaceId, propertyId);

  const oldNameLower = String(oldName || "").toLowerCase();
  const targetTag = tags.find((t) => {
    if (tagId && String(t.id || "").trim() === tagId) return true;
    if (!tagId && oldNameLower && String(t.name || "").trim().toLowerCase() === oldNameLower) return true;
    return false;
  });

  if (!targetTag) throw new Error("tag_not_found");

  const updated = await api.updateTag(resolvedSpaceId, propertyId, String(targetTag.id), {
    name: newName,
    color: normalizedColor,
  });
  const tag = updated.tag || updated;
  return {
    status: "ok",
    space_id: resolvedSpaceId,
    tag: {
      id: String(tag.id || ""),
      key: String(tag.key || ""),
      name: String(tag.name || newName),
      color: String(tag.color || normalizedColor),
    },
  };
}

function normalizeTagColor(raw) {
  const v = String(raw || "grey").toLowerCase().trim();
  const allowed = new Set(["grey","gray","red","orange","yellow","green","cyan","blue","purple","pink","brown"]);
  return allowed.has(v) ? v : "grey";
}

// re-export estimateWordCount from markdown-post (available in same context)
function estimateWordCount(markdown) {
  const latinWords = (markdown.match(/[A-Za-z0-9_]+/g) || []).length;
  const cjkChars = (markdown.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.max(1, latinWords + Math.max(1, Math.floor(cjkChars / 2)));
}

// Node.js test support
if (typeof module !== "undefined") module.exports = {
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
};
