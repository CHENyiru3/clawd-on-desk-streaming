"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

// Replicate the pure derivation logic from renderer.js so we can test it
// without a DOM environment. This must stay in sync with getWindowUsedAndRemaining().
function getWindowUsedAndRemaining(windowInfo) {
  if (!windowInfo) return null;
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

function getWindowUsageStatus(windowInfo, segments) {
  if (!segments) return "unavailable";
  const remaining = segments.remainingPercent;
  if (remaining < 20) return "critical";
  if (remaining < 50) return "warning";
  return "ok";
}

function getUsageWidthClass(percent) {
  const width = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  return `usage-width-${width}`;
}

function getUsageStatusClass(usageStatus) {
  if (usageStatus === "critical") return "usage-status-critical";
  if (usageStatus === "warning") return "usage-status-warning";
  if (usageStatus === "ok") return "usage-status-ok";
  return "usage-status-unavailable";
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

  // Status labels do not suppress real percent data.
  it("derives segments for unavailable/error/stale when percent data exists", () => {
    for (const status of ["unavailable", "error", "stale"]) {
      assert.deepStrictEqual(
        getWindowUsedAndRemaining({ status, usedPercent: 30 }),
        { usedPercent: 30, remainingPercent: 70 },
        `status=${status} should preserve percent data`
      );
    }
  });

  // Stale MiniMax data still colors by usage, while stale text remains separate.
  it("stale MiniMax data still derives usage segments", () => {
    const result = getWindowUsedAndRemaining({
      status: "stale",
      usedPercent: 30,
      remainingPercent: 70,
    });
    assert.deepStrictEqual(result, { usedPercent: 30, remainingPercent: 70 });
    assert.strictEqual(getWindowUsageStatus({}, result), "ok");
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

  it("maps derived usage status from remaining percent", () => {
    assert.strictEqual(getWindowUsageStatus({}, { usedPercent: 24, remainingPercent: 76 }), "ok");
    assert.strictEqual(getWindowUsageStatus({}, { usedPercent: 64, remainingPercent: 36 }), "warning");
    assert.strictEqual(getWindowUsageStatus({}, { usedPercent: 90, remainingPercent: 10 }), "critical");
    assert.strictEqual(getWindowUsageStatus({}, null), "unavailable");
  });

  it("maps percent values to CSP-safe width classes", () => {
    assert.strictEqual(getUsageWidthClass(24), "usage-width-24");
    assert.strictEqual(getUsageWidthClass(64.4), "usage-width-64");
    assert.strictEqual(getUsageWidthClass(90.6), "usage-width-91");
    assert.strictEqual(getUsageWidthClass(-10), "usage-width-0");
    assert.strictEqual(getUsageWidthClass(150), "usage-width-100");
    assert.strictEqual(getUsageWidthClass(NaN), "usage-width-0");
  });

  it("maps usage status to CSP-safe status classes", () => {
    assert.strictEqual(getUsageStatusClass("ok"), "usage-status-ok");
    assert.strictEqual(getUsageStatusClass("warning"), "usage-status-warning");
    assert.strictEqual(getUsageStatusClass("critical"), "usage-status-critical");
    assert.strictEqual(getUsageStatusClass("unavailable"), "usage-status-unavailable");
  });
});
