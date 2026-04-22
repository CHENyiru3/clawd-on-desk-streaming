"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { fetchProviderUsageSnapshots } = require("../src/provider-usage-fetchers");

describe("provider-usage-fetchers", () => {
  it("normalizes checker JSON for codex and minimax into structured windows", async () => {
    const calls = [];
    const result = await fetchProviderUsageSnapshots({
      config: { python: "python3", scriptPath: "/tmp/check_usage.py", timeoutMs: 30000, browser: "auto" },
      now: () => 1234,
      execFileImpl(cmd, args, opts, cb) {
        calls.push(args[2]);
        cb(null, JSON.stringify({
          provider: args[2],
          source: "auto",
          windows: {
            primary: {
              used_percent: 20,
              remaining_percent: 80,
              reset_description: "tomorrow",
            },
          },
          credits: { remaining: 15 },
          warnings: [],
        }), "");
      },
    });

    assert.deepStrictEqual(calls, ["codex", "minimax"]);
    assert.strictEqual(result.providers.codex.windows[0].label, "5h");
    assert.strictEqual(result.providers.codex.windows[0].remainingPercent, 80);
    assert.strictEqual(result.providers.minimax.windows[0].label, "5h");
    assert.strictEqual(result.providers.minimax.status, "ok");
  });

  it("preserves the last good MiniMax snapshot as stale when refresh fails", async () => {
    const result = await fetchProviderUsageSnapshots({
      config: { python: "python3", scriptPath: "/tmp/check_usage.py", timeoutMs: 30000, browser: "auto" },
      now: () => 4321,
      previousSnapshot: {
        providers: {
          minimax: {
            provider: "minimax",
            status: "ok",
            label: "MiniMax",
            fetchedAt: 1200,
            source: "playwright",
            error: null,
            warnings: [],
            windows: [
              { key: "fiveHour", label: "5h", status: "ok", usedPercent: 8, remainingPercent: 92, detailText: "music-2.6 8%", resetText: "~4h" },
            ],
          },
        },
      },
      execFileImpl(cmd, args, opts, cb) {
        // MiniMax returns an error; codex returns data
        if (args[2] === "minimax") {
          cb(new Error("Playwright failed to launch."), "", "Playwright failed to launch.");
        } else {
          cb(null, JSON.stringify({
            provider: args[2],
            source: "auto",
            windows: { primary: { used_percent: 20, remaining_percent: 80 } },
            warnings: [],
          }), "");
        }
      },
    });

    assert.strictEqual(result.providers.minimax.status, "stale");
    assert.strictEqual(result.providers.minimax.windows[0].status, "stale");
    assert.match(result.lastError, /failed/i);
  });

  it("skips MiniMax checker when MiniMax usage is disabled", async () => {
    const calls = [];
    const result = await fetchProviderUsageSnapshots({
      config: {
        python: "python3",
        scriptPath: "/tmp/check_usage.py",
        timeoutMs: 300000,
        browser: "auto",
        includeMiniMax: false,
      },
      now: () => 5678,
      execFileImpl(cmd, args, opts, cb) {
        calls.push(args[2]);
        cb(null, JSON.stringify({
          provider: args[2],
          source: "auto",
          windows: { primary: { used_percent: 20, remaining_percent: 80 } },
          warnings: [],
        }), "");
      },
    });

    assert.deepStrictEqual(calls, ["codex"]);
    assert.strictEqual(result.providers.codex.status, "ok");
    assert.strictEqual(result.providers.minimax.status, "unavailable");
    assert.strictEqual(result.providers.minimax.source, "disabled");
    assert.strictEqual(result.lastError, null);
    assert.strictEqual(result.lastResult, "ok");
  });
});
