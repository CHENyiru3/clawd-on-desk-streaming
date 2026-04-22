"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  createEmptyUsageSnapshot,
  mergeUsageSnapshot,
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
