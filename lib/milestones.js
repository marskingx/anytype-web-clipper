/**
 * milestones.js — 100-Level Milestone System
 * Single source of truth for milestone data + helper functions.
 * Loaded via <script> in popup.html & options.html, or require() in tests.
 */

// ── Tier Definitions ────────────────────────────────────────────────────────

const TIER_DEFS = [
  { emoji: "\uD83C\uDF31", tierName: "\u521D\u6B21\u6536\u85CF",       start: 1,    end: 10    },
  { emoji: "\uD83D\uDCDA", tierName: "\u77E5\u8B58\u6536\u96C6\u8005", start: 12,   end: 30    },
  { emoji: "\uD83D\uDD25", tierName: "\u6D3B\u8E8D\u526A\u8F2F\u8005", start: 34,   end: 60    },
  { emoji: "\u2B50",        tierName: "\u9AD8\u624B\u4E0A\u8DEF",       start: 65,   end: 110   },
  { emoji: "\uD83D\uDC8E", tierName: "\u767E\u7BC7\u9054\u4EBA",       start: 120,  end: 200   },
  { emoji: "\uD83C\uDFC6", tierName: "\u77E5\u8B58\u5BF6\u5EAB",       start: 220,  end: 380   },
  { emoji: "\uD83D\uDC51", tierName: "\u526A\u8F2F\u5927\u5E2B",       start: 400,  end: 700   },
  { emoji: "\uD83D\uDC32", tierName: "\u50B3\u5947\u6536\u85CF\u5BB6", start: 750,  end: 1200  },
  { emoji: "\uD83D\uDE80", tierName: "\u77E5\u8B58\u5E1D\u570B",       start: 1400, end: 2500  },
  { emoji: "\uD83C\uDF0C", tierName: "\u842C\u7269\u6536\u85CF",       start: 3000, end: 10000 },
];

const ROMAN = ["", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// ── Generate 100 Milestones ─────────────────────────────────────────────────

const MILESTONES = [];

for (let t = 0; t < TIER_DEFS.length; t++) {
  const def = TIER_DEFS[t];
  for (let s = 0; s < 10; s++) {
    const level = t * 10 + s + 1;
    const threshold = s === 0
      ? def.start
      : Math.round(def.start + (def.end - def.start) * (s / 9));
    const name = s === 0 ? def.tierName : def.tierName + " " + ROMAN[s];
    MILESTONES.push({
      id: "lv_" + level,
      level: level,
      tier: t + 1,
      subLevel: s + 1,
      threshold: threshold,
      emoji: def.emoji,
      tierName: def.tierName,
      name: name,
    });
  }
}

// ── Legacy ID Mapping ───────────────────────────────────────────────────────

const LEGACY_ID_MAP = {
  "first_clip": "lv_1",
  "clip_10":    "lv_11",
  "clip_25":    "lv_21",
  "clip_50":    "lv_31",
  "clip_100":   "lv_41",
  "clip_250":   "lv_51",
  "clip_500":   "lv_61",
  "clip_1000":  "lv_71",
};

// ── Helper Functions ────────────────────────────────────────────────────────

/**
 * Returns the highest milestone achieved for the given clip count, or null.
 */
function getLevelForClips(totalClips) {
  if (!totalClips || totalClips < 1) return null;
  let result = null;
  for (const m of MILESTONES) {
    if (totalClips >= m.threshold) result = m;
    else break;
  }
  return result;
}

/**
 * Returns the next milestone after the given level, or null if at max.
 */
function getNextLevel(level) {
  if (!level) return MILESTONES[0] || null;
  const idx = MILESTONES.findIndex(function (m) { return m.level === level; });
  if (idx < 0 || idx >= MILESTONES.length - 1) return null;
  return MILESTONES[idx + 1];
}

/**
 * Returns progress info for rendering level bar.
 * { current, next, fraction }
 */
function getProgressToNext(totalClips) {
  var current = getLevelForClips(totalClips);
  if (!current) {
    return {
      current: null,
      next: MILESTONES[0] || null,
      fraction: MILESTONES[0] ? Math.min(1, totalClips / MILESTONES[0].threshold) : 0,
    };
  }
  var next = getNextLevel(current.level);
  if (!next) {
    return { current: current, next: null, fraction: 1 };
  }
  var range = next.threshold - current.threshold;
  var progress = totalClips - current.threshold;
  return {
    current: current,
    next: next,
    fraction: range > 0 ? Math.min(1, progress / range) : 1,
  };
}

/**
 * Converts legacy milestone IDs to new IDs, deduplicates.
 */
function migrateLegacyIds(ids) {
  if (!Array.isArray(ids)) return [];
  var seen = {};
  var result = [];
  for (var i = 0; i < ids.length; i++) {
    var id = LEGACY_ID_MAP[ids[i]] || ids[i];
    if (!seen[id]) {
      seen[id] = true;
      result.push(id);
    }
  }
  return result;
}

// ── Node.js test support ────────────────────────────────────────────────────

if (typeof module !== "undefined") {
  module.exports = {
    MILESTONES: MILESTONES,
    TIER_DEFS: TIER_DEFS,
    LEGACY_ID_MAP: LEGACY_ID_MAP,
    getLevelForClips: getLevelForClips,
    getNextLevel: getNextLevel,
    getProgressToNext: getProgressToNext,
    migrateLegacyIds: migrateLegacyIds,
  };
}
