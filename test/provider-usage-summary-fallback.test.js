"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { classifyUrgency, buildFallbackSummary } = require("../src/provider-usage-summary-fallback");

describe("provider-usage-summary-fallback", () => {
  it("classifies urgency by remaining percent", () => {
    assert.strictEqual(classifyUrgency({ remainingPercent: 75, fetchedAt: Date.now(), status: "ok" }), "normal");
    assert.strictEqual(classifyUrgency({ remainingPercent: 35, fetchedAt: Date.now(), status: "warning" }), "watch");
    assert.strictEqual(classifyUrgency({ remainingPercent: 10, fetchedAt: Date.now(), status: "critical" }), "tight");
    assert.strictEqual(classifyUrgency({
      status: "warning",
      fetchedAt: Date.now(),
      windows: [
        { remainingPercent: 72, status: "ok" },
        { remainingPercent: 19, status: "critical" },
      ],
    }), "tight");
  });

  it("builds a global fallback summary", () => {
    const summary = buildFallbackSummary({
      providers: {
        codex: {
          fetchedAt: Date.now(),
          status: "critical",
          windows: [{ label: "5h", remainingPercent: 10, status: "critical" }],
        },
        cursor: {
          fetchedAt: Date.now(),
          status: "ok",
          windows: [{ label: "Auto", remainingPercent: 88, status: "ok" }],
        },
      },
    });
    assert.strictEqual(summary.overallStatus, "tight");
    assert.strictEqual(summary.providerHints.codex.urgency, "tight");
  });
});
