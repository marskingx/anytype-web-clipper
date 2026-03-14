const { expect } = require("chai");
const {
  MILESTONES,
  TIER_DEFS,
  LEGACY_ID_MAP,
  getLevelForClips,
  getNextLevel,
  getProgressToNext,
  migrateLegacyIds,
} = require("./milestones");

describe("MILESTONES data integrity", () => {
  it("has exactly 100 milestones", () => {
    expect(MILESTONES).to.have.lengthOf(100);
  });

  it("thresholds are strictly ascending", () => {
    for (let i = 1; i < MILESTONES.length; i++) {
      expect(MILESTONES[i].threshold).to.be.greaterThan(MILESTONES[i - 1].threshold);
    }
  });

  it("10 tiers with 10 levels each", () => {
    for (let t = 1; t <= 10; t++) {
      const tierMs = MILESTONES.filter((m) => m.tier === t);
      expect(tierMs).to.have.lengthOf(10);
    }
  });

  it("IDs are lv_1 through lv_100", () => {
    for (let i = 0; i < 100; i++) {
      expect(MILESTONES[i].id).to.equal("lv_" + (i + 1));
      expect(MILESTONES[i].level).to.equal(i + 1);
    }
  });

  it("first sub-level name has no numeral, others have Roman numerals", () => {
    for (const m of MILESTONES) {
      if (m.subLevel === 1) {
        expect(m.name).to.equal(m.tierName);
      } else {
        expect(m.name).to.include(m.tierName);
        expect(m.name).to.match(/ [IVX]+$/);
      }
    }
  });

  it("TIER_DEFS has 10 entries", () => {
    expect(TIER_DEFS).to.have.lengthOf(10);
  });
});

describe("getLevelForClips()", () => {
  it("0 clips -> null", () => {
    expect(getLevelForClips(0)).to.be.null;
  });

  it("negative clips -> null", () => {
    expect(getLevelForClips(-5)).to.be.null;
  });

  it("1 clip -> lv_1", () => {
    const level = getLevelForClips(1);
    expect(level.id).to.equal("lv_1");
  });

  it("10 clips -> lv_10 (last of tier 1)", () => {
    const level = getLevelForClips(10);
    expect(level.id).to.equal("lv_10");
    expect(level.tier).to.equal(1);
  });

  it("11 clips -> still lv_10 (tier 2 starts at 12)", () => {
    const level = getLevelForClips(11);
    expect(level.id).to.equal("lv_10");
  });

  it("12 clips -> lv_11 (first of tier 2)", () => {
    const level = getLevelForClips(12);
    expect(level.id).to.equal("lv_11");
    expect(level.tier).to.equal(2);
  });

  it("10000 clips -> lv_100", () => {
    const level = getLevelForClips(10000);
    expect(level.id).to.equal("lv_100");
  });

  it("99999 clips -> lv_100 (beyond max)", () => {
    const level = getLevelForClips(99999);
    expect(level.id).to.equal("lv_100");
  });
});

describe("getNextLevel()", () => {
  it("null level -> first milestone", () => {
    const next = getNextLevel(null);
    expect(next.id).to.equal("lv_1");
  });

  it("level 1 -> lv_2", () => {
    const next = getNextLevel(1);
    expect(next.id).to.equal("lv_2");
  });

  it("level 99 -> lv_100", () => {
    const next = getNextLevel(99);
    expect(next.id).to.equal("lv_100");
  });

  it("level 100 -> null (max)", () => {
    const next = getNextLevel(100);
    expect(next).to.be.null;
  });

  it("invalid level -> null", () => {
    const next = getNextLevel(999);
    expect(next).to.be.null;
  });
});

describe("getProgressToNext()", () => {
  it("0 clips -> fraction towards lv_1", () => {
    const p = getProgressToNext(0);
    expect(p.current).to.be.null;
    expect(p.next.id).to.equal("lv_1");
    expect(p.fraction).to.equal(0);
  });

  it("at lv_1 threshold -> fraction 0 towards lv_2", () => {
    const p = getProgressToNext(1);
    expect(p.current.id).to.equal("lv_1");
    expect(p.next.id).to.equal("lv_2");
    expect(p.fraction).to.equal(0);
  });

  it("at max -> fraction 1, next null", () => {
    const p = getProgressToNext(10000);
    expect(p.current.id).to.equal("lv_100");
    expect(p.next).to.be.null;
    expect(p.fraction).to.equal(1);
  });

  it("midway between two levels -> correct fraction", () => {
    // lv_1 threshold=1, lv_2 threshold=2, so at 1 clip: fraction = 0/1 = 0
    // We need to find a range > 1 for a meaningful test
    const lv11 = MILESTONES[10]; // tier 2, sub 1, threshold=12
    const lv12 = MILESTONES[11]; // tier 2, sub 2
    const mid = Math.floor((lv11.threshold + lv12.threshold) / 2);
    const p = getProgressToNext(mid);
    expect(p.fraction).to.be.greaterThan(0);
    expect(p.fraction).to.be.lessThan(1);
  });
});

describe("migrateLegacyIds()", () => {
  it("converts legacy IDs to new IDs", () => {
    const result = migrateLegacyIds(["first_clip", "clip_10"]);
    expect(result).to.deep.equal(["lv_1", "lv_11"]);
  });

  it("keeps new IDs unchanged", () => {
    const result = migrateLegacyIds(["lv_5", "lv_10"]);
    expect(result).to.deep.equal(["lv_5", "lv_10"]);
  });

  it("mixed legacy and new IDs", () => {
    const result = migrateLegacyIds(["first_clip", "lv_5", "clip_100"]);
    expect(result).to.deep.equal(["lv_1", "lv_5", "lv_41"]);
  });

  it("deduplicates", () => {
    const result = migrateLegacyIds(["first_clip", "lv_1"]);
    expect(result).to.deep.equal(["lv_1"]);
  });

  it("null input -> empty array", () => {
    expect(migrateLegacyIds(null)).to.deep.equal([]);
  });

  it("empty array -> empty array", () => {
    expect(migrateLegacyIds([])).to.deep.equal([]);
  });

  it("all 8 legacy IDs map correctly", () => {
    const legacyIds = Object.keys(LEGACY_ID_MAP);
    const result = migrateLegacyIds(legacyIds);
    const expected = Object.values(LEGACY_ID_MAP);
    expect(result).to.deep.equal(expected);
  });
});
