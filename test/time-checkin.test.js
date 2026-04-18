"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const createTimeCheckinRuntime = require("../src/time-checkin");
const { __test } = require("../src/time-checkin");

describe("time-checkin schedule", () => {
  it("computes the next run from two-hour slots plus anchors", () => {
    const next = __test.computeNextRun(new Date(2026, 3, 17, 16, 30, 0, 0));
    assert.strictEqual(next.getHours(), 17);
    assert.strictEqual(next.getMinutes(), 0);
  });

  it("rolls to the next day after the last slot", () => {
    const next = __test.computeNextRun(new Date(2026, 3, 17, 23, 30, 0, 0));
    assert.strictEqual(next.getDate(), 18);
    assert.strictEqual(next.getHours(), 0);
  });
});

describe("time-checkin runtime", () => {
  it("manual trigger runs even when the scheduler is stopped", async () => {
    const calls = [];
    const runtime = createTimeCheckinRuntime({
      now: () => 1_000,
      setTimeout: () => 1,
      clearTimeout: () => {},
      generateMessage: async () => {
        calls.push("run");
        return { status: "ok", detail: { payload: { mode: "time-checkin" } } };
      },
    });

    await runtime.triggerNow("manual");
    assert.deepStrictEqual(calls, ["run"]);
  });
});
