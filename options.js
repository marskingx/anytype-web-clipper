/**
 * options.js — Anytype Web Clipper Options Page
 * 顯示連線狀態、API Key 管理（清除 / 重新驗證）
 */

const ANYTYPE_BASE_URL = "http://127.0.0.1:31009";
const ANYTYPE_API_VERSION = "2025-11-08";
const STORAGE_API_KEY = "anytypeApiKey";
const STORAGE_STATS_KEY = "clipperStats";

const byId = (id) => document.getElementById(id);
const els = {
  connectionBadge: byId("connection-badge"),
  testBtn: byId("test-btn"),
  apikeyStatus: byId("apikey-status"),
  clearBtn: byId("clear-btn"),
  status: byId("status"),
  statTotal: byId("stat-total"),
  statToday: byId("stat-today"),
  milestoneTiers: byId("milestone-tiers"),
};

applyI18n(document);

function setStatus(text, isError) {
  els.status.textContent = text;
  els.status.style.color = isError ? "#ef4444" : "#22c55e";
}

function setBadge(connected) {
  els.connectionBadge.textContent = connected ? t("status_connected") : t("status_disconnected");
  els.connectionBadge.className = `status-badge ${connected ? "connected" : "disconnected"}`;
}

async function loadSettings() {
  if (!(globalThis.chrome && chrome.storage && chrome.storage.local)) {
    setStatus(t("error_extension_api_unavailable"), true);
    return;
  }
  const stored = await chrome.storage.local.get([STORAGE_API_KEY]);
  const apiKey = String(stored[STORAGE_API_KEY] || "").trim();
  if (apiKey) {
    els.apikeyStatus.textContent = t("options_api_key_saved", apiKey.slice(-4));
  } else {
    els.apikeyStatus.textContent = t("options_api_key_missing");
  }
}

async function testConnection() {
  setBadge(false);
  setStatus(t("status_testing"), false);
  try {
    const resp = await fetch(`${ANYTYPE_BASE_URL}/v1/spaces`, {
      method: "GET",
      headers: { "Anytype-Version": ANYTYPE_API_VERSION },
    });
    if (resp.ok || resp.status === 401) {
      // 401 表示 API server 在線（只是沒帶 key），也視為連線成功
      setBadge(true);
      setStatus(t("status_api_ok"), false);
    } else {
      setBadge(false);
      setStatus(t("error_http_status", String(resp.status)), true);
    }
  } catch (_err) {
    setBadge(false);
    setStatus(t("error_connect_anytype"), true);
  }
}

async function clearApiKey() {
  if (!(globalThis.chrome && chrome.storage && chrome.storage.local)) return;
  await chrome.storage.local.remove([STORAGE_API_KEY]);
  setBadge(false);
  els.apikeyStatus.textContent = t("options_api_key_cleared");
  setStatus(t("status_api_key_cleared"), false);
}

// MILESTONES, TIER_DEFS, getLevelForClips, migrateLegacyIds loaded from lib/milestones.js

async function loadStats() {
  if (!(globalThis.chrome && chrome.storage && chrome.storage.local)) return;
  if (!els.statTotal || !els.statToday || !els.milestoneTiers) return;

  const stored = await chrome.storage.local.get([STORAGE_STATS_KEY]);
  const stats = stored[STORAGE_STATS_KEY] || { totalClips: 0, dailyClips: {}, milestones: [] };
  const today = new Date().toISOString().slice(0, 10);
  const totalClips = stats.totalClips || 0;

  els.statTotal.textContent = String(totalClips);
  els.statToday.textContent = String((stats.dailyClips && stats.dailyClips[today]) || 0);

  // Migrate legacy IDs for display
  const migratedIds = migrateLegacyIds(Array.isArray(stats.milestones) ? stats.milestones : []);
  const achieved = new Set(migratedIds);
  const currentLevel = getLevelForClips(totalClips);

  els.milestoneTiers.textContent = "";

  for (let t = 0; t < TIER_DEFS.length; t++) {
    const tierDef = TIER_DEFS[t];
    const tierMilestones = MILESTONES.filter(function (m) { return m.tier === t + 1; });

    // Tier group container
    const group = document.createElement("div");
    group.className = "tier-group";

    // Tier header
    const header = document.createElement("div");
    header.className = "tier-header";
    const emojiSpan = document.createElement("span");
    emojiSpan.className = "tier-emoji";
    emojiSpan.textContent = tierDef.emoji;
    const nameSpan = document.createElement("span");
    nameSpan.className = "tier-name";
    nameSpan.textContent = tierDef.tierName;
    const rangeSpan = document.createElement("span");
    rangeSpan.className = "tier-range";
    rangeSpan.textContent = tierDef.start + " - " + tierDef.end + " clips";
    header.appendChild(emojiSpan);
    header.appendChild(nameSpan);
    header.appendChild(rangeSpan);
    group.appendChild(header);

    // Cards grid (5 columns × 2 rows)
    const cards = document.createElement("div");
    cards.className = "tier-cards";
    for (const m of tierMilestones) {
      const card = document.createElement("div");
      const isCurrent = currentLevel && currentLevel.id === m.id;
      const isAchieved = achieved.has(m.id) || (totalClips >= m.threshold);
      card.className = "milestone-card" + (isCurrent ? " current" : isAchieved ? " achieved" : "");

      const levelEl = document.createElement("div");
      levelEl.className = "mc-level";
      levelEl.textContent = "Lv." + m.level;

      const nameEl = document.createElement("div");
      nameEl.className = "mc-name";
      nameEl.textContent = m.name;

      const thresholdEl = document.createElement("div");
      thresholdEl.className = "mc-threshold";
      thresholdEl.textContent = m.threshold + " clips";

      card.appendChild(levelEl);
      card.appendChild(nameEl);
      card.appendChild(thresholdEl);
      cards.appendChild(card);
    }
    group.appendChild(cards);
    els.milestoneTiers.appendChild(group);
  }
}

els.testBtn.addEventListener("click", () => void testConnection());
els.clearBtn.addEventListener("click", () => void clearApiKey());

void loadSettings();
void testConnection();
void loadStats();
