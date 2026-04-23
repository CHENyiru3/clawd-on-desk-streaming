"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  createEmptyUsageSnapshot,
  mergeUsageSnapshot,
  normalizeUsageSnapshot,
  withHermesStatus,
} = require("../src/provider-usage-model");

describe("provider-usage-model Hermes status", () => {
  it("adds Hermes status without dropping provider data", () => {
    const base = createEmptyUsageSnapshot();
    base.providers.codex.windows[0].remainingPercent = 42;
    base.providers.codex.windows[0].status = "warning";

    const next = withHermesStatus(base, "working");

    assert.strictEqual(next.hermesStatus.status, "working");
    assert.strictEqual(next.providers.codex.windows[0].remainingPercent, 42);
    assert.strictEqual(next.providers.codex.windows[0].status, "warning");
  });

  it("preserves Hermes status across provider usage merges", () => {
    const base = withHermesStatus(createEmptyUsageSnapshot(), "available");
    const next = mergeUsageSnapshot(base, {}, null, 1234);

    assert.strictEqual(next.hermesStatus.status, "available");
    assert.ok(next.providers.codex);
    assert.ok(next.providers.minimax);
  });
});

describe("provider-usage-model percent normalization", () => {
  it("treats used-only raw windows as usable data", () => {
    const cases = [
      { used: 24, remaining: 76, status: "ok" },
      { used: 64, remaining: 36, status: "warning" },
      { used: 90, remaining: 10, status: "critical" },
    ];

    for (const item of cases) {
      const group = normalizeUsageSnapshot("minimax", {
        windows: {
          primary: {
            used_percent: item.used,
          },
        },
      }, 1234);

      assert.strictEqual(group.status, item.status);
      assert.strictEqual(group.windows[0].usedPercent, item.used);
      assert.strictEqual(group.windows[0].remainingPercent, item.remaining);
      assert.strictEqual(group.windows[0].status, item.status);
    }
  });

  it("still marks missing percent data unavailable", () => {
    const group = normalizeUsageSnapshot("minimax", {
      windows: {
        primary: {
          detail_text: "connected but no percentage",
        },
      },
    }, 1234);

    assert.strictEqual(group.status, "unavailable");
    assert.strictEqual(group.windows[0].status, "unavailable");
    assert.strictEqual(group.windows[0].usedPercent, null);
    assert.strictEqual(group.windows[0].remainingPercent, null);
  });
});
