/**
 * popup.js — Anytype Web Clipper Popup
 * 直連 Anytype API，不需要 Python service
 */

const ANYTYPE_BASE_URL = "http://127.0.0.1:31009";
const ANYTYPE_API_VERSION = "2025-11-08";
const STORAGE_API_KEY = "anytypeApiKey";
const STORAGE_PREFS_BY_SPACE = "clipperPrefsBySpace";
const STORAGE_LAST_SPACE_ID = "clipperLastSpaceId";
const MEDIA_HOSTS = [
  "youtube.com", "youtu.be", "vimeo.com", "spotify.com",
  "soundcloud.com", "buzzsprout.com", "podcasts.apple.com",
];
const TYPE_ICON_GLYPH_MAP = {
  attach: "📎", book: "📘", bookmark: "🔖", bookmarks: "🔖", calendar: "📅",
  chatbubble: "💬", checkbox: "✅", copy: "📄", create: "✍️", document: "📄",
  file: "📄", film: "🎬", flag: "🚩", globe: "🌐", goal: "🎯", hammer: "🔨",
  image: "🖼️", layers: "🗂️", location: "📍", man: "👤", "musical-notes": "🎵",
  note: "📝", person: "👥", reader: "📖", search: "🔎", target: "🎯", videocam: "🎥",
};
const TAG_COLOR_OPTIONS = [
  "grey", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "brown",
];

const byId = (id) => document.getElementById(id);
const els = {
  authView: byId("auth-view"),
  clipperMain: byId("clipper-main"),
  authRetryBtn: byId("auth-retry-btn"),
  authCodeHint: byId("auth-code-hint"),
  challengeCode: byId("challenge-code"),
  confirmCodeBtn: byId("confirm-code-btn"),
  clipBtn: byId("clip-btn"),
  status: byId("status"),
  title: byId("title-input"),
  space: byId("space-select"),
  type: byId("type-select"),
  typeHint: byId("type-icon-hint"),
  tagBox: byId("tag-combobox"),
  tagInput: byId("tag-input"),
  tagDropdown: byId("tag-dropdown"),
  selectedTags: byId("selected-tags"),
  tagEditorPanel: byId("tag-editor-panel"),
  tagEditName: byId("tag-edit-name"),
  tagEditColors: byId("tag-edit-colors"),
  tagEditSave: byId("tag-edit-save"),
  tagEditCancel: byId("tag-edit-cancel"),
  previewDomain: byId("preview-domain"),
  previewWordCount: byId("preview-word-count"),
  previewEmbedCount: byId("preview-embed-count"),
  previewEmbeds: byId("preview-embeds"),
  resultCard: byId("result-card"),
  resultText: byId("result-text"),
  openBtn: byId("open-anytype-btn"),
  copyBtn: byId("copy-object-id-btn"),
  dupModal: byId("duplicate-modal"),
  dupList: byId("duplicate-list"),
  dupUpdate: byId("dup-update-btn"),
  dupCreate: byId("dup-create-btn"),
  dupCancel: byId("dup-cancel-btn"),
  quickSaveToggle: byId("quick-save-toggle"),
  authConnectProgress: byId("auth-connect-progress"),
  levelBar: byId("level-bar"),
  levelCurrent: byId("level-current"),
  levelNext: byId("level-next"),
  levelProgressFill: byId("level-progress-fill"),
  levelProgressText: byId("level-progress-text"),
};

let prefsBySpace = {};
let typeMap = new Map();
let availableTags = [];
let selectedTags = [];
let dropdownItems = [];
let highlightedIndex = -1;
let snapshot = { url: "", domain: "", wordCount: 0, embedUrls: [] };
let submitting = false;
let duplicateResolver = null;
let lastResult = null;
let editingTag = null;
let editingTagColor = "grey";
let challengeId = "";
let authInProgress = false;
let clipperUiInitialized = false;

// --- View 切換 helpers ---
function showAuthView() {
  if (els.authView) els.authView.classList.remove("hidden");
  if (els.clipperMain) els.clipperMain.classList.add("hidden");
}
function showClipperView() {
  if (els.authView) els.authView.classList.add("hidden");
  if (els.clipperMain) els.clipperMain.classList.remove("hidden");
}
function showAuthStep(stepId) {
  if (!els.authView) return;
  for (const step of els.authView.querySelectorAll(".auth-step")) step.classList.add("hidden");
  const target = document.getElementById(stepId);
  if (target) target.classList.remove("hidden");
}

init();

async function init() {
  applyI18n(document);
  if (!hasExtensionApiContext()) {
    setStatus(t("error_no_runtime"));
    if (els.clipBtn) els.clipBtn.disabled = true;
    return;
  }

  setupAuthInputListeners();

  const stored = await chrome.storage.local.get([
    STORAGE_API_KEY,
    STORAGE_PREFS_BY_SPACE,
    STORAGE_LAST_SPACE_ID,
  ]);
  prefsBySpace = stored[STORAGE_PREFS_BY_SPACE] || {};
  const apiKey = String(stored[STORAGE_API_KEY] || "").trim();

  if (!apiKey) {
    showAuthView();
    void startAuthFlow();
    return;
  }

  showClipperView();
  initClipperUI(stored);
}

function setupAuthInputListeners() {
  if (els.confirmCodeBtn) {
    els.confirmCodeBtn.addEventListener("click", () => void submitCode());
  }
  if (els.challengeCode) {
    els.challengeCode.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void submitCode(); }
    });
    els.challengeCode.addEventListener("input", () => {
      if (String(els.challengeCode.value || "").length === 4) void submitCode();
    });
  }
  if (els.authRetryBtn) {
    els.authRetryBtn.addEventListener("click", () => void startAuthFlow());
  }
}

async function waitForAnytype(onProgress) {
  const MAX_ATTEMPTS = 30;
  const INTERVAL_MS = 1000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2000);
    try {
      await fetch(ANYTYPE_BASE_URL, { signal: ac.signal });
      clearTimeout(timer);
      return true;
    } catch (_e) {
      clearTimeout(timer);
    }
    if (onProgress) onProgress(i + 1, MAX_ATTEMPTS);
    if (i < MAX_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  return false;
}

async function startAuthFlow() {
  if (authInProgress) return;
  authInProgress = true;

  showAuthView();
  showAuthStep("auth-step-connecting");
  if (els.challengeCode) { els.challengeCode.value = ""; els.challengeCode.disabled = false; }
  if (els.confirmCodeBtn) els.confirmCodeBtn.disabled = false;
  if (els.authConnectProgress) els.authConnectProgress.textContent = "";

  // Port polling: wait for Anytype desktop app (retry every 1s, max 30 attempts)
  const connected = await waitForAnytype((attempt, max) => {
    if (els.authConnectProgress) {
      els.authConnectProgress.textContent = t("auth_connect_progress", String(attempt), String(max));
    }
  });

  if (!connected) {
    authInProgress = false;
    showAuthStep("auth-step-error");
    return;
  }

  // Anytype is responding — request auth challenge
  try {
    const resp = await fetch(`${ANYTYPE_BASE_URL}/v1/auth/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Anytype-Version": ANYTYPE_API_VERSION },
      body: JSON.stringify({ app_name: "Lazy to Anytype Clipper" }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || data.message || t("error_challenge_failed"));
    challengeId = String(data.challenge_id || data.challengeId || "").trim();
    if (!challengeId) throw new Error(t("error_no_challenge_id"));

    showAuthStep("auth-step-code");
    if (els.challengeCode) els.challengeCode.focus();
  } catch (_error) {
    authInProgress = false;
    showAuthStep("auth-step-error");
  }
}

async function submitCode() {
  const code = String(els.challengeCode ? els.challengeCode.value : "").trim();
  if (code.length !== 4) return;
  if (els.confirmCodeBtn) els.confirmCodeBtn.disabled = true;
  if (els.challengeCode) els.challengeCode.disabled = true;
  try {
    const resp = await fetch(`${ANYTYPE_BASE_URL}/v1/auth/api_keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Anytype-Version": ANYTYPE_API_VERSION },
      body: JSON.stringify({ challenge_id: challengeId, code }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || data.message || t("error_auth_failed"));
    const apiKey = String(data.api_key || data.apiKey || "").trim();
    if (!apiKey) throw new Error(t("error_no_api_key"));

    await chrome.storage.local.set({ [STORAGE_API_KEY]: apiKey });
    authInProgress = false;
    showAuthStep("auth-step-success");
    const stored = await chrome.storage.local.get([STORAGE_PREFS_BY_SPACE, STORAGE_LAST_SPACE_ID]);
    prefsBySpace = stored[STORAGE_PREFS_BY_SPACE] || {};
    setTimeout(() => {
      showClipperView();
      if (!clipperUiInitialized) {
        initClipperUI(stored);
      } else {
        void loadOptions({ preferredSpaceId: (stored && stored[STORAGE_LAST_SPACE_ID]) || "" });
      }
    }, 800);
  } catch (_error) {
    authInProgress = false;
    if (els.challengeCode) {
      els.challengeCode.value = "";
      els.challengeCode.disabled = false;
      els.challengeCode.classList.add("error");
      setTimeout(() => { if (els.challengeCode) els.challengeCode.classList.remove("error"); }, 400);
      els.challengeCode.focus();
    }
    if (els.confirmCodeBtn) els.confirmCodeBtn.disabled = false;
    if (els.authCodeHint) els.authCodeHint.textContent = t("auth_code_wrong");
  }
}

async function initClipperUI(stored) {
  clipperUiInitialized = true;
  els.space.addEventListener("change", async () => {
    await loadOptions({ preferredSpaceId: els.space.value });
  });
  els.type.addEventListener("change", async () => {
    renderTypeHint();
    await persistPrefs();
  });

  els.tagInput.addEventListener("click", () => {
    closeTagEditor();
    if (els.tagDropdown.classList.contains("hidden")) openTagDropdown();
    else closeTagDropdown();
  });
  els.tagInput.addEventListener("input", () => {
    closeTagEditor();
    if (els.tagDropdown.classList.contains("hidden")) openTagDropdown();
    else refreshTagDropdown();
  });
  els.tagInput.addEventListener("keydown", onTagKeydown);
  els.tagEditSave.addEventListener("click", () => void saveEditedTag());
  els.tagEditCancel.addEventListener("click", closeTagEditor);
  els.tagEditName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void saveEditedTag(); return; }
    if (event.key === "Escape") { event.preventDefault(); closeTagEditor(); }
  });
  document.addEventListener("click", onDocumentClick);

  els.clipBtn.addEventListener("click", runClip);
  els.openBtn.addEventListener("click", openAnytype);
  els.copyBtn.addEventListener("click", copyObjectId);
  els.dupUpdate.addEventListener("click", () => resolveDuplicate("update"));
  els.dupCreate.addEventListener("click", () => resolveDuplicate("create"));
  els.dupCancel.addEventListener("click", () => resolveDuplicate("cancel"));

  await hydrateSnapshot();
  await loadOptions({ preferredSpaceId: (stored && stored[STORAGE_LAST_SPACE_ID]) || "" });
  setStatus(t("status_ready"));

  // Render level bar from stored stats
  if (globalThis.chrome && chrome.storage && chrome.storage.local) {
    const statsStored = await chrome.storage.local.get([STORAGE_STATS_KEY]);
    const stats = statsStored[STORAGE_STATS_KEY] || {};
    renderLevelBar(stats.totalClips || 0);
  }
}

function isRestrictedUrl(url) {
  if (!url) return true;
  if (!/^https?:\/\//i.test(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "chrome.google.com" || host === "chromewebstore.google.com") return true;
    if (host.endsWith(".google.com") && url.includes("/webstore")) return true;
  } catch (_e) { return true; }
  return false;
}

async function hydrateSnapshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  els.title.value = (tab && tab.title) || "";
  if (!tab || !tab.id) { renderPreview(); return; }
  if (isRestrictedUrl(tab.url)) {
    snapshot = { url: "", domain: "", wordCount: 0, embedUrls: [] };
    renderPreview();
    return;
  }
  let injected;
  try {
    [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (hosts) => {
      const abs = (raw) => {
        const v = String(raw || "").trim();
        if (!v) return "";
        if (v.startsWith("http://") || v.startsWith("https://")) return v;
        if (v.startsWith("//")) return "https:" + v;
        try { return new URL(v, location.href).toString(); } catch (_err) { return v; }
      };
      const isMedia = (rawUrl) => {
        try {
          const host = new URL(rawUrl, location.href).hostname.toLowerCase();
          return hosts.some((h) => host.includes(h));
        } catch (_err) { return false; }
      };
      const embedSet = new Set();
      document.querySelectorAll("iframe[src]").forEach((n) => {
        const u = abs(n.getAttribute("src"));
        if (u && isMedia(u)) embedSet.add(u);
      });
      document.querySelectorAll("a[href]").forEach((n) => {
        const u = abs(n.getAttribute("href"));
        if (u && isMedia(u)) embedSet.add(u);
      });
      const text = document.body ? String(document.body.innerText || "") : "";
      const wc = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
      return {
        url: location.href,
        domain: location.hostname || "",
        wordCount: wc,
        embedUrls: Array.from(embedSet).slice(0, 8),
      };
    },
      args: [MEDIA_HOSTS],
    });
  } catch (_e) {
    snapshot = { url: tab.url || "", domain: new URL(tab.url).hostname || "", wordCount: 0, embedUrls: [] };
    renderPreview();
    return;
  }
  const data = (injected && injected.result) || {};
  snapshot = {
    url: String(data.url || ""),
    domain: String(data.domain || ""),
    wordCount: Number(data.wordCount || 0),
    embedUrls: Array.isArray(data.embedUrls) ? data.embedUrls : [],
  };
  renderPreview();
}

function renderPreview() {
  els.previewDomain.textContent = snapshot.domain || "-";
  els.previewWordCount.textContent = String(snapshot.wordCount || 0);
  els.previewEmbedCount.textContent = String((snapshot.embedUrls || []).length);
  els.previewEmbeds.textContent = "";
  for (const url of (snapshot.embedUrls || []).slice(0, 3)) {
    const row = document.createElement("div");
    row.className = "preview-embed";
    row.textContent = url;
    els.previewEmbeds.appendChild(row);
  }
}

async function loadOptions({ preferredSpaceId = "" }) {
  setStatus(t("status_loading_options"));
  try {
    const response = await sendMessageToBackground({
      type: "GET_OPTIONS",
      preferredSpaceId,
    });
    if (!response || !response.ok) throw new Error((response && response.error) || t("error_options_load_failed"));
    const payload = response.result;

    if (payload.setup_required) {
      showAuthView();
      void startAuthFlow();
      return;
    }

    renderSpaces(payload.spaces || [], preferredSpaceId || payload.defaults?.space_id || "");
    const pref = getPrefs(els.space.value);
    renderTypes(payload.types || [], pref.typeKey || payload.defaults?.type_key || "");
    renderTypeHint();

    availableTags = normalizeAvailableTags(payload.tags || []);
    selectedTags = [];
    renderSelectedTags();
    refreshTagDropdown();

    await persistPrefs();
    setStatus(t("status_ready"));
  } catch (error) {
    const msg = String(error.message || error);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch")) {
      setStatus(t("error_connect_anytype"));
    } else {
      setStatus(t("error_options_failed", msg));
    }
  }
}

function renderSpaces(spaces, selectedId) {
  els.space.textContent = "";
  for (const s of spaces) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name || s.id;
    if (s.id === selectedId) o.selected = true;
    els.space.appendChild(o);
  }
}

function renderTypes(types, selectedKey) {
  typeMap = new Map();
  els.type.textContent = "";
  for (const t of types) {
    const key = String(t.key || "").trim();
    if (!key) continue;
    const name = String(t.name || key).trim();
    const icon = normalizeIcon(t.icon || {}, t.icon_emoji || "");
    typeMap.set(key, { key, name, icon });
    const o = document.createElement("option");
    o.value = key;
    o.textContent = buildTypeOptionLabel(name, icon);
    if (key === selectedKey) o.selected = true;
    els.type.appendChild(o);
  }
}

function normalizeIcon(iconRaw, iconEmojiFallback) {
  const icon = { format: "", emoji: "", name: "", color: "" };
  if (iconRaw && typeof iconRaw === "object") {
    icon.format = String(iconRaw.format || "").trim();
    icon.emoji = String(iconRaw.emoji || "").trim();
    icon.name = String(iconRaw.name || "").trim();
    icon.color = String(iconRaw.color || "").trim();
  }
  if (!icon.emoji) icon.emoji = String(iconEmojiFallback || "").trim();
  return icon;
}

function resolveTypeIconGlyph(icon) {
  if (icon && icon.emoji) return String(icon.emoji).trim();
  const nameKey = String((icon && icon.name) || "").trim().toLowerCase();
  return TYPE_ICON_GLYPH_MAP[nameKey] || "▪";
}

function buildTypeOptionLabel(typeName, icon) {
  return `${resolveTypeIconGlyph(icon)} ${typeName}`;
}

function renderTypeHint() {
  const current = typeMap.get(String(els.type.value || "").trim());
  if (!current) { els.typeHint.textContent = ""; return; }
  const icon = current.icon || {};
  const glyph = resolveTypeIconGlyph(icon);
  if (icon.emoji) { els.typeHint.textContent = t("type_icon_official", glyph); return; }
  if (icon.name && icon.color) { els.typeHint.textContent = t("type_icon_named_color", glyph, icon.name, icon.color); return; }
  if (icon.name) { els.typeHint.textContent = t("type_icon_named", glyph, icon.name); return; }
  els.typeHint.textContent = t("type_icon_default", glyph);
}

function getPrefs(spaceId) {
  return prefsBySpace[String(spaceId || "").trim()] || { typeKey: "" };
}

async function persistPrefs() {
  const spaceId = String(els.space.value || "").trim();
  if (!spaceId) return;
  prefsBySpace[spaceId] = { typeKey: String(els.type.value || "").trim() };
  await chrome.storage.local.set({
    [STORAGE_PREFS_BY_SPACE]: prefsBySpace,
    [STORAGE_LAST_SPACE_ID]: spaceId,
  });
}

function normalizeAvailableTags(tags) {
  const seen = new Set();
  const out = [];
  for (const t of tags || []) {
    const id = String((t && t.id) || "").trim();
    const key = String((t && t.key) || "").trim();
    const name = String((t && t.name) || "").trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id, key, name, color: normalizeTagColor(String((t && t.color) || "grey")) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  return out;
}

function enrichTagColor(name, fallbackColor = "grey") {
  const found = availableTags.find((i) => i.name.toLowerCase() === String(name).toLowerCase());
  return found
    ? { id: found.id || "", key: found.key || "", name: found.name, color: found.color }
    : { id: "", key: "", name: String(name), color: normalizeTagColor(fallbackColor) };
}

function renderSelectedTags() {
  els.selectedTags.textContent = "";
  for (const tag of selectedTags) {
    const theme = resolveTagTheme(tag.color);
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = theme.bg;
    chip.style.borderColor = theme.border;

    const dot = document.createElement("span");
    dot.className = "chip-color";
    dot.style.background = resolveTagColorHex(tag.color);

    const label = document.createElement("span");
    label.textContent = tag.name;
    label.style.color = theme.text;

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "chip-edit-btn";
    edit.textContent = "✎";
    edit.style.color = theme.textMuted;
    edit.title = t("tag_edit_title");
    edit.addEventListener("click", (event) => { event.stopPropagation(); openTagEditor(tag); });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.style.color = theme.textMuted;
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedTags = selectedTags.filter((x) => x.name !== tag.name);
      renderSelectedTags();
      refreshTagDropdown();
    });

    chip.append(dot, label, edit, remove);
    els.selectedTags.appendChild(chip);
  }
}

function openTagEditor(tag) {
  const currentName = String((tag && tag.name) || "").trim();
  if (!currentName) return;
  editingTag = {
    id: String((tag && tag.id) || "").trim(),
    key: String((tag && tag.key) || "").trim(),
    name: currentName,
    color: normalizeTagColor((tag && tag.color) || "grey"),
  };
  editingTagColor = editingTag.color;
  if (els.tagEditName) els.tagEditName.value = editingTag.name;
  renderTagEditorColors();
  if (els.tagEditorPanel) els.tagEditorPanel.classList.remove("hidden");
  closeTagDropdown();
  if (els.tagEditName) { els.tagEditName.focus(); els.tagEditName.select(); }
}

function closeTagEditor() {
  editingTag = null;
  editingTagColor = "grey";
  if (els.tagEditorPanel) els.tagEditorPanel.classList.add("hidden");
  if (els.tagEditName) els.tagEditName.value = "";
  if (els.tagEditColors) els.tagEditColors.textContent = "";
}

function renderTagEditorColors() {
  if (!els.tagEditColors) return;
  els.tagEditColors.textContent = "";
  TAG_COLOR_OPTIONS.forEach((color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tag-color-choice${color === editingTagColor ? " active" : ""}`;
    btn.style.background = resolveTagColorHex(color);
    btn.title = color;
    btn.addEventListener("click", () => { editingTagColor = color; renderTagEditorColors(); });
    els.tagEditColors.appendChild(btn);
  });
}

function openTagDropdown() {
  els.tagDropdown.classList.remove("hidden");
  refreshTagDropdown();
}

function closeTagDropdown() {
  els.tagDropdown.classList.add("hidden");
  highlightedIndex = -1;
}

function refreshTagDropdown() {
  const queryRaw = String(els.tagInput.value || "").trim();
  const query = queryRaw.toLowerCase();
  const selectedSet = new Set(selectedTags.map((t) => t.name.toLowerCase()));

  dropdownItems = availableTags
    .filter((t) => !selectedSet.has(t.name.toLowerCase()))
    .filter((t) => (!query ? true : t.name.toLowerCase().includes(query)))
    .map((t) => ({ kind: "existing", id: t.id || "", key: t.key || "", name: t.name, color: t.color, label: t.name }));

  if (queryRaw && !selectedSet.has(query) && !availableTags.some((t) => t.name.toLowerCase() === query)) {
    dropdownItems.unshift({ kind: "create", id: "", key: "", name: queryRaw, color: "grey", label: t("tag_create_item", queryRaw) });
  }
  if (!queryRaw) {
    dropdownItems.push({ kind: "create_footer", id: "", key: "", name: "", color: "grey", label: t("tag_create_footer") });
  }
  if (!dropdownItems.length) {
    dropdownItems = [{ kind: "empty", id: "", key: "", name: "", color: "grey", label: t("tag_empty") }];
  }
  highlightedIndex = 0;
  renderDropdownItems();
}

function renderDropdownItems() {
  els.tagDropdown.textContent = "";
  dropdownItems.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = `tag-option${item.kind === "create" ? " create" : ""}${item.kind === "create_footer" ? " create-footer" : ""}${idx === highlightedIndex && item.kind !== "create_footer" ? " active" : ""}`;
    if (item.kind !== "empty" && item.kind !== "create_footer") {
      row.style.color = resolveTagTheme(item.color).text;
      const dot = document.createElement("span");
      dot.className = "tag-color";
      dot.style.background = resolveTagColorHex(item.color);
      row.appendChild(dot);
    }
    const text = document.createElement("span");
    text.className = "tag-option-name";
    text.textContent = item.label;
    row.appendChild(text);
    if (item.kind === "existing") {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "tag-option-edit";
      editBtn.textContent = t("tag_edit_btn");
      editBtn.addEventListener("mousedown", (event) => { event.preventDefault(); event.stopPropagation(); });
      editBtn.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openTagEditor(item); });
      row.appendChild(editBtn);
    }
    row.addEventListener("mousedown", (event) => { event.preventDefault(); void selectTagIndex(idx); });
    els.tagDropdown.appendChild(row);
  });
}

async function selectTagIndex(index) {
  const item = dropdownItems[index];
  if (!item || item.kind === "empty" || item.kind === "create_footer") return;
  const name = String(item.name || "").trim();
  if (!selectedTags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    selectedTags.push(enrichTagColor(name, item.color));
  }
  if (!availableTags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    availableTags.push(enrichTagColor(name, item.color));
  }
  els.tagInput.value = "";
  renderSelectedTags();
  refreshTagDropdown();
}

function onTagKeydown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (els.tagDropdown.classList.contains("hidden")) { openTagDropdown(); return; }
    highlightedIndex = Math.min(highlightedIndex + 1, dropdownItems.length - 1);
    renderDropdownItems();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (els.tagDropdown.classList.contains("hidden")) { openTagDropdown(); return; }
    highlightedIndex = Math.max(highlightedIndex - 1, 0);
    renderDropdownItems();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (!els.tagDropdown.classList.contains("hidden") && highlightedIndex >= 0) {
      void selectTagIndex(highlightedIndex);
      return;
    }
  }
  if (event.key === "Escape") closeTagDropdown();
}

function onDocumentClick(event) {
  if (event.target === els.tagInput) return;
  if (els.tagEditorPanel && els.tagEditorPanel.contains(event.target)) return;
  if (els.tagDropdown.contains(event.target)) return;
  if (els.tagBox && els.tagBox.contains(event.target)) { closeTagDropdown(); return; }
  if (els.tagBox && !els.tagBox.contains(event.target)) { closeTagDropdown(); closeTagEditor(); }
}

async function runClip() {
  if (submitting) return;
  submitting = true;
  els.clipBtn.disabled = true;
  hideResult();
  setStatus(t("status_clipping"));
  try {
    await persistPrefs();

    const duplicate = await checkDuplicate();
    let duplicateStrategy = "create";
    let duplicateTargetObjectId = "";
    if (duplicate.exists) {
      const decision = await promptDuplicate(duplicate.matches || []);
      if (!decision) { setStatus(t("status_cancelled")); return; }
      duplicateStrategy = decision.strategy;
      duplicateTargetObjectId = decision.targetObjectId || "";
    }

    const selectedType = typeMap.get(els.type.value) || { icon: {} };
    const icon = selectedType.icon || {};
    const requestNonce =
      globalThis.crypto && globalThis.crypto.randomUUID
        ? globalThis.crypto.randomUUID()
        : String(Date.now());

    const isQuickSave = !!(els.quickSaveToggle && els.quickSaveToggle.checked);

    const response = await sendMessageToBackground({
      type: "CLIP_CURRENT_TAB",
      clipOptions: {
        title: els.title.value || "",
        spaceId: els.space.value || "",
        typeKey: els.type.value || "",
        tagNames: selectedTags.map((t) => t.name),
        iconEmoji: String(icon.emoji || "").trim(),
        duplicateStrategy,
        duplicateTargetObjectId,
        requestNonce,
        quickSave: isQuickSave,
      },
    });

    if (!response || !response.ok) {
      throw new Error((response && response.error) || t("error_unknown"));
    }

    lastResult = response.result || {};
    renderResult(lastResult);
    recordClipSuccess().then((milestone) => { if (milestone) showMilestoneToast(milestone); });
    const stats = lastResult.stats || {};
    const warn = Array.isArray(lastResult.warnings) && lastResult.warnings.length
      ? t("status_warnings", lastResult.warnings.join("; ")) : "";
    const dedup = lastResult.dedup_applied ? t("status_dedup", lastResult.dedup_reason) : "";
    setStatus(t("status_done", lastResult.object_id, String(stats.word_count || 0), String(stats.embedded_media || 0)) + dedup + warn);
  } catch (error) {
    setStatus(t("error_clip_failed", String(error.message || error)));
  } finally {
    submitting = false;
    els.clipBtn.disabled = false;
  }
}

async function checkDuplicate() {
  if (!snapshot.url) return { exists: false, matches: [] };
  const response = await sendMessageToBackground({
    type: "CHECK_DUPLICATE",
    url: snapshot.url,
    spaceId: els.space.value || "",
  });
  if (!response || !response.ok) throw new Error((response && response.error) || t("error_dup_check_failed"));
  return response.result;
}

function promptDuplicate(matches) {
  els.dupList.textContent = "";
  (matches || []).forEach((m, idx) => {
    const objectId = String(m.object_id || "").trim();
    const name = String(m.name || objectId).trim();
    const updated = String(m.updated_at || "").trim();

    const row = document.createElement("div");
    row.className = "duplicate-item";

    const lbl = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "dup-target";
    radio.value = objectId;
    if (idx === 0) radio.checked = true;

    const span = document.createElement("span");
    span.textContent = name;

    if (updated) {
      const br = document.createElement("br");
      const dateSpan = document.createTextNode(updated);
      span.appendChild(br);
      span.appendChild(dateSpan);
    }

    lbl.appendChild(radio);
    lbl.appendChild(span);
    row.appendChild(lbl);
    els.dupList.appendChild(row);
  });
  els.dupModal.classList.remove("hidden");
  return new Promise((resolve) => { duplicateResolver = resolve; });
}

function resolveDuplicate(mode) {
  if (!duplicateResolver) return;
  const done = duplicateResolver;
  duplicateResolver = null;
  els.dupModal.classList.add("hidden");
  if (mode === "cancel") return done(null);
  if (mode === "create") return done({ strategy: "create", targetObjectId: "" });
  const checked = els.dupList.querySelector('input[name="dup-target"]:checked');
  return done({ strategy: "update", targetObjectId: checked ? checked.value : "" });
}

function renderResult(result) {
  const stats = result.stats || {};
  const action = result.action === "updated" ? t("result_updated") : t("result_created");
  els.resultText.textContent = `${action}\nObject: ${result.object_id}\nWord: ${stats.word_count || 0} / Embed: ${stats.embedded_media || 0}`;
  els.resultCard.classList.remove("hidden");
  els.openBtn.classList.toggle("hidden", !String(result.open_url || "").trim());
  els.copyBtn.classList.toggle("hidden", !String(result.object_id || "").trim());
}

function hideResult() {
  els.resultCard.classList.add("hidden");
  els.openBtn.classList.add("hidden");
  els.copyBtn.classList.add("hidden");
}

async function openAnytype() {
  const url = String((lastResult && lastResult.open_url) || "").trim();
  if (!url) return;
  await chrome.tabs.create({ url });
}

async function copyObjectId() {
  const objectId = String((lastResult && lastResult.object_id) || "").trim();
  if (!objectId) return;
  await navigator.clipboard.writeText(objectId);
  setStatus(t("status_copied_id", objectId));
}

function normalizeTagColor(color) {
  const v = String(color || "grey").toLowerCase().trim();
  if (v === "gray") return "grey";
  return new Set(TAG_COLOR_OPTIONS).has(v) ? v : "grey";
}

function resolveTagColorHex(color) {
  return ({
    grey: "#94a3b8", gray: "#94a3b8", red: "#ef4444", orange: "#f97316",
    yellow: "#f59e0b", green: "#22c55e", cyan: "#06b6d4", blue: "#3b82f6",
    purple: "#a855f7", pink: "#ec4899", brown: "#a16207",
  }[normalizeTagColor(color)] || "#94a3b8");
}

function resolveTagTheme(color) {
  const map = {
    grey: { bg: "rgba(148,163,184,0.16)", border: "#475569", text: "#e2e8f0", textMuted: "#cbd5e1" },
    gray: { bg: "rgba(148,163,184,0.16)", border: "#475569", text: "#e2e8f0", textMuted: "#cbd5e1" },
    red: { bg: "rgba(239,68,68,0.18)", border: "#b91c1c", text: "#fecaca", textMuted: "#fca5a5" },
    orange: { bg: "rgba(249,115,22,0.18)", border: "#c2410c", text: "#fed7aa", textMuted: "#fdba74" },
    yellow: { bg: "rgba(245,158,11,0.18)", border: "#b45309", text: "#fde68a", textMuted: "#fcd34d" },
    green: { bg: "rgba(34,197,94,0.18)", border: "#15803d", text: "#bbf7d0", textMuted: "#86efac" },
    cyan: { bg: "rgba(6,182,212,0.18)", border: "#0e7490", text: "#a5f3fc", textMuted: "#67e8f9" },
    blue: { bg: "rgba(59,130,246,0.18)", border: "#1d4ed8", text: "#bfdbfe", textMuted: "#93c5fd" },
    purple: { bg: "rgba(168,85,247,0.18)", border: "#7e22ce", text: "#e9d5ff", textMuted: "#d8b4fe" },
    pink: { bg: "rgba(236,72,153,0.18)", border: "#be185d", text: "#fbcfe8", textMuted: "#f9a8d4" },
    brown: { bg: "rgba(161,98,7,0.24)", border: "#854d0e", text: "#fde68a", textMuted: "#fcd34d" },
  };
  return map[normalizeTagColor(color)] || map.grey;
}

function hasExtensionApiContext() {
  const hasStorage = !!(globalThis.chrome && chrome.storage && chrome.storage.local);
  const hasTabs = !!(globalThis.chrome && chrome.tabs);
  const hasScripting = !!(globalThis.chrome && chrome.scripting);
  const hasRuntime = !!(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function");
  return hasStorage && hasTabs && hasScripting && hasRuntime;
}

async function sendMessageToBackground(message) {
  if (!(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function")) {
    throw new Error(t("error_runtime_unavailable"));
  }
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) { reject(new Error(String(runtimeError.message || runtimeError))); return; }
        resolve(response);
      });
    } catch (error) { reject(error); }
  });
}

function setStatus(text) {
  els.status.textContent = text;
}

async function saveEditedTag() {
  if (!editingTag) return;
  const currentName = String(editingTag.name || "").trim();
  const nextName = String((els.tagEditName && els.tagEditName.value) || "").trim();
  if (!nextName) { setStatus(t("error_tag_name_empty")); return; }
  const nextColor = normalizeTagColor(editingTagColor || editingTag.color || "grey");

  let updatedTag = {
    id: String(editingTag.id || "").trim(),
    key: String(editingTag.key || "").trim(),
    name: nextName,
    color: nextColor,
  };

  const spaceId = String(els.space.value || "").trim();
  if (updatedTag.id && spaceId) {
    try {
      const response = await sendMessageToBackground({
        type: "UPDATE_TAG",
        spaceId,
        tagId: updatedTag.id,
        oldName: currentName,
        newName: nextName,
        color: nextColor,
      });
      if (!response || !response.ok) throw new Error((response && response.error) || "update_tag_failed");
      const payload = response.result.tag || {};
      updatedTag = {
        id: String(payload.id || updatedTag.id),
        key: String(payload.key || updatedTag.key),
        name: String(payload.name || updatedTag.name),
        color: normalizeTagColor(payload.color || updatedTag.color),
      };
    } catch (error) {
      setStatus(t("error_tag_update_failed", String(error.message || error)));
      return;
    }
  }

  selectedTags = selectedTags.map((item) => {
    if (String(item.name || "").toLowerCase() !== currentName.toLowerCase()) return item;
    return { ...item, ...updatedTag };
  });
  availableTags = availableTags.map((item) => {
    if (updatedTag.id && String(item.id || "").trim() === updatedTag.id) return { ...item, ...updatedTag };
    if (!updatedTag.id && String(item.name || "").toLowerCase() === currentName.toLowerCase()) return { ...item, ...updatedTag };
    return item;
  });
  if (!availableTags.some((item) => String(item.name || "").toLowerCase() === updatedTag.name.toLowerCase())) {
    availableTags.push(updatedTag);
  }
  availableTags.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  renderSelectedTags();
  refreshTagDropdown();
  closeTagEditor();
  setStatus(t("status_tag_updated"));
}

// ── 使用統計 ──────────────────────────────────────────────────────────────
const GA4_MEASUREMENT_ID = "G-M3VY53Z088";
const GA4_API_SECRET = "4APi25x1R9aB77Dndy0RBA";
const STORAGE_STATS_KEY = "clipperStats";

// MILESTONES is loaded from lib/milestones.js via <script> tag

function getOrCreateClientId(stats) {
  if (stats.clientId) return stats.clientId;
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function pruneOldDailyClips(daily) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const pruned = {};
  for (const [k, v] of Object.entries(daily || {})) {
    if (k >= cutoffStr) pruned[k] = v;
  }
  return pruned;
}

async function recordClipSuccess() {
  if (!(globalThis.chrome && chrome.storage && chrome.storage.local)) return null;
  const stored = await chrome.storage.local.get([STORAGE_STATS_KEY]);
  const stats = stored[STORAGE_STATS_KEY] || { totalClips: 0, dailyClips: {}, milestones: [], clientId: "" };

  stats.clientId = getOrCreateClientId(stats);
  stats.totalClips = (stats.totalClips || 0) + 1;
  const today = todayKey();
  stats.dailyClips = pruneOldDailyClips(stats.dailyClips);
  stats.dailyClips[today] = (stats.dailyClips[today] || 0) + 1;
  if (!Array.isArray(stats.milestones)) stats.milestones = [];

  // Migrate legacy IDs (first_clip → lv_1, etc.)
  stats.milestones = migrateLegacyIds(stats.milestones);

  let newTierMilestone = null;
  for (const m of MILESTONES) {
    if (stats.totalClips >= m.threshold && !stats.milestones.includes(m.id)) {
      stats.milestones.push(m.id);
      // Only toast on tier entry (subLevel 1) or first clip
      if (m.subLevel === 1) newTierMilestone = m;
    }
  }

  await chrome.storage.local.set({ [STORAGE_STATS_KEY]: stats });
  renderLevelBar(stats.totalClips);
  sendAnalyticsEvent(stats).catch(() => {});
  return newTierMilestone;
}

function showMilestoneToast(milestone) {
  const toast = document.createElement("div");
  toast.className = "milestone-toast";
  toast.textContent = `${milestone.emoji} ${milestone.tierName}！`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function renderLevelBar(totalClips) {
  if (!els.levelBar) return;
  if (!totalClips || totalClips < 1) {
    els.levelBar.classList.add("hidden");
    return;
  }
  const progress = getProgressToNext(totalClips);
  els.levelBar.classList.remove("hidden");

  if (progress.current) {
    els.levelCurrent.textContent = `Lv.${progress.current.level} ${progress.current.emoji} ${progress.current.name}`;
  } else {
    els.levelCurrent.textContent = "Lv.0";
  }

  if (progress.next) {
    els.levelNext.textContent = `Lv.${progress.next.level} ${progress.next.emoji} ${progress.next.name}`;
  } else {
    els.levelNext.textContent = "MAX";
  }

  els.levelProgressFill.style.width = `${Math.round(progress.fraction * 100)}%`;
  els.levelProgressText.textContent = progress.next
    ? `${totalClips}/${progress.next.threshold} clips`
    : `${totalClips} clips`;
}

async function sendAnalyticsEvent(stats) {
  const payload = {
    client_id: stats.clientId,
    events: [{
      name: "clip_success",
      params: { total_clips: stats.totalClips },
    }],
  };
  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

// Node.js test support
if (typeof module !== "undefined") module.exports = {
  isRestrictedUrl,
  normalizeTagColor,
  normalizeAvailableTags,
  resolveTypeIconGlyph,
  buildTypeOptionLabel,
  showAuthView,
  showClipperView,
  showAuthStep,
};
