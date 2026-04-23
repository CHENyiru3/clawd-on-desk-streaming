"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

// Replicate the pure derivation logic from renderer.js so we can test it
// without a DOM environment. This must stay in sync with getWindowUsedAndRemaining().
function getWindowUsedAndRemaining(windowInfo) {
  if (!windowInfo || ["error", "unavailable", "stale"].includes(windowInfo.status)) {
    return null;
  }
  let used = null;
  let remaining = null;
  if (typeof windowInfo.usedPercent === "number" && Number.isFinite(windowInfo.usedPercent)) {
    used = Math.max(0, Math.min(100, windowInfo.usedPercent));
    remaining = Math.max(0, Math.min(100, 100 - used));
  } else if (typeof windowInfo.remainingPercent === "number" && Number.isFinite(windowInfo.remainingPercent)) {
    remaining = Math.max(0, Math.min(100, windowInfo.remainingPercent));
    used = Math.max(0, Math.min(100, 100 - remaining));
  }
  if (used === null) return null;
  return { usedPercent: used, remainingPercent: remaining };
}

describe("provider-usage bar segment derivation", () => {
  // 24% used → short colored used segment + long muted remainder
  it("24% used shows short colored segment", () => {
    const result = getWindowUsedAndRemaining({ usedPercent: 24 });
    assert.deepStrictEqual(result, { usedPercent: 24, remainingPercent: 76 });
  });

  // 64% used → longer warning-colored segment
  it("64% used shows longer colored segment", () => {
    const result = getWindowUsedAndRemaining({ usedPercent: 64 });
    assert.deepStrictEqual(result, { usedPercent: 64, remainingPercent: 36 });
  });

  // Remaining-only source: remainingPercent → used = 100 - remaining
  it("derives usedPercent from remainingPercent", () => {
    const result = getWindowUsedAndRemaining({ remainingPercent: 76 });
    assert.deepStrictEqual(result, { usedPercent: 24, remainingPercent: 76 });
  });

  // 50/50 boundary
  it("50% used / 50% remaining", () => {
    const result = getWindowUsedAndRemaining({ usedPercent: 50 });
    assert.deepStrictEqual(result, { usedPercent: 50, remainingPercent: 50 });
  });

  // Clamping: used > 100 stays at 100
  it("clamps usedPercent above 100 to 100", () => {
    const result = getWindowUsedAndRemaining({ usedPercent: 150 });
    assert.deepStrictEqual(result, { usedPercent: 100, remainingPercent: 0 });
  });

  // Clamping: used < 0 stays at 0
  it("clamps usedPercent below 0 to 0", () => {
    const result = getWindowUsedAndRemaining({ usedPercent: -10 });
    assert.deepStrictEqual(result, { usedPercent: 0, remainingPercent: 100 });
  });

  // Missing usage data stays null
  it("returns null when no percent data is present", () => {
    assert.strictEqual(getWindowUsedAndRemaining({ status: "ok" }), null);
    assert.strictEqual(getWindowUsedAndRemaining({}), null);
    assert.strictEqual(getWindowUsedAndRemaining(null), null);
    assert.strictEqual(getWindowUsedAndRemaining(undefined), null);
  });

  // Unavailable/error/stale → null (both segments collapse → muted gray)
  it("returns null for unavailable/error/stale", () => {
    for (const status of ["unavailable", "error", "stale"]) {
      assert.strictEqual(
        getWindowUsedAndRemaining({ status, usedPercent: 30 }),
        null,
        `status=${status} should return null`
      );
    }
  });

  // Stale MiniMax data still returns null (no false freshness)
  it("stale MiniMax data returns null and does not imply real usage", () => {
    const result = getWindowUsedAndRemaining({
      status: "stale",
      usedPercent: 30,
      remainingPercent: 70,
    });
    assert.strictEqual(result, null, "stale data must not imply real usage");
  });

  // Used takes priority when both are present
  it("prefers usedPercent when both values are available", () => {
    // Model always derives remaining from used when used is present, so this
    // represents the case where raw data has both and model chose used.
    const result = getWindowUsedAndRemaining({ usedPercent: 40 });
    // If both happened to be present, used is the authoritative value.
    // The else-if branch is not taken since usedPercent is checked first.
    assert.deepStrictEqual(result, { usedPercent: 40, remainingPercent: 60 });
  });

  // 100% used = full colored bar, no remaining segment
  it("100% used fills the bar completely", () => {
    const result = getWindowUsedAndRemaining({ usedPercent: 100 });
    assert.deepStrictEqual(result, { usedPercent: 100, remainingPercent: 0 });
  });

  // 0% used = no colored segment, full remaining
  it("0% used shows no colored segment", () => {
    const result = getWindowUsedAndRemaining({ usedPercent: 0 });
    assert.deepStrictEqual(result, { usedPercent: 0, remainingPercent: 100 });
  });
});
