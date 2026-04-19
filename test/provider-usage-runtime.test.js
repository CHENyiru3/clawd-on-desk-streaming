"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const createProviderUsageRuntime = require("../src/provider-usage-runtime");

describe("provider-usage-runtime", () => {
  it("aligns the next run to :05 cadence slots", () => {
    const next = createProviderUsageRuntime.__test.computeNextRun(new Date("2026-04-18T13:06:10"));
    assert.strictEqual(next.getMinutes(), 15);
    assert.strictEqual(next.getSeconds(), 0);
  });

  it("emits updates through fetch and summarize", async () => {
    const updates = [];
    const statuses = [];
    const timers = [];
    let now = Date.parse("2026-04-18T13:04:00Z");
    const runtime = createProviderUsageRuntime({
      now: () => now,
      setTimeout(fn, ms) {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimeout() {},
      fetchSnapshots: async () => ({
        lastResult: "ok",
        providers: { codex: { provider: "codex", status: "ok" } },
      }),
      summarizeSnapshots: async ({ snapshot }) => ({
        snapshot: { ...snapshot, hermesSummary: { overallStatus: "normal", summaryText: "steady", providerHints: {} } },
        lastResult: "ok",
      }),
      onUsageUpdate: (snapshot) => updates.push(snapshot),
      onStatusChange: (status) => statuses.push(status),
    });

    runtime.start();
    assert.ok(timers.length >= 2);
    timers[0].fn();
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].hermesSummary.summaryText, "steady");
    assert.ok(statuses.some((entry) => entry.running === true));
  });
});
