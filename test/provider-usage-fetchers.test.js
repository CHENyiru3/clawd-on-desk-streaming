"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { fetchProviderUsageSnapshots } = require("../src/provider-usage-fetchers");

describe("provider-usage-fetchers", () => {
  it("normalizes checker JSON for codex and cursor into structured windows", async () => {
    const calls = [];
    const result = await fetchProviderUsageSnapshots({
      config: { python: "python3", scriptPath: "/tmp/check_usage.py", timeoutMs: 30000, browser: "auto" },
      hermesConfig: { command: "hermes", args: ["--resume", "abc"], timeoutMs: 30000 },
      miniMaxEnabled: true,
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
      fetchMiniMaxUsageImpl: async () => ({
        provider: "minimax",
        status: "warning",
        label: "MiniMax",
        fetchedAt: 1234,
        source: "hermes-skill",
        error: null,
        warnings: [],
        windows: [
          { key: "fiveHour", label: "5h", status: "warning", usedPercent: 99.83, remainingPercent: 0.17, detailText: "coding-plan-search 98%", resetText: "~48m" },
        ],
      }),
    });

    assert.deepStrictEqual(calls, ["codex", "cursor"]);
    assert.strictEqual(result.providers.codex.windows[0].label, "5h");
    assert.strictEqual(result.providers.codex.windows[0].remainingPercent, 80);
    assert.strictEqual(result.providers.cursor.windows[0].label, "Auto");
    assert.strictEqual(result.providers.cursor.windows[1].label, "API");
    assert.strictEqual(result.providers.minimax.windows[0].label, "5h");
    assert.strictEqual(result.providers.minimax.status, "warning");
  });

  it("preserves the last good MiniMax snapshot as stale when refresh fails", async () => {
    const result = await fetchProviderUsageSnapshots({
      config: { python: "python3", scriptPath: "/tmp/check_usage.py", timeoutMs: 30000, browser: "auto" },
      hermesConfig: { command: "hermes", args: ["--resume", "abc"], timeoutMs: 30000 },
      miniMaxEnabled: true,
      now: () => 4321,
      previousSnapshot: {
        providers: {
          minimax: {
            provider: "minimax",
            status: "ok",
            label: "MiniMax",
            fetchedAt: 1200,
            source: "hermes-skill",
            error: null,
            warnings: [],
            windows: [
              { key: "fiveHour", label: "5h", status: "ok", usedPercent: 8, remainingPercent: 92, detailText: "music-2.6 8%", resetText: "~4h" },
            ],
          },
        },
      },
      execFileImpl(cmd, args, opts, cb) {
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
          warnings: [],
        }), "");
      },
      fetchMiniMaxUsageImpl: async () => ({
        provider: "minimax",
        status: "unavailable",
        label: "MiniMax",
        fetchedAt: 4321,
        source: "hermes-skill",
        error: "Hermes could not initialize in this environment.",
        warnings: ["hermes_init_failed"],
        windows: [
          { key: "fiveHour", label: "5h", status: "unavailable", usedPercent: null, remainingPercent: null, detailText: "Not connected", resetText: null },
        ],
      }),
    });

    assert.strictEqual(result.providers.minimax.status, "stale");
    assert.strictEqual(result.providers.minimax.windows[0].status, "stale");
    assert.match(result.lastError, /Hermes could not initialize/i);
  });
});
