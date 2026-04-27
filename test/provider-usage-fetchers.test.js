"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { fetchProviderUsageSnapshots } = require("../src/provider-usage-fetchers");

describe("provider-usage-fetchers", () => {
  it("normalizes checker JSON for codex, minimax, and deepseek into structured windows", async () => {
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

    assert.deepStrictEqual(calls, ["codex", "minimax", "deepseek"]);
    assert.strictEqual(result.providers.codex.windows[0].label, "5h");
    assert.strictEqual(result.providers.codex.windows[0].remainingPercent, 80);
    assert.strictEqual(result.providers.minimax.windows[0].label, "5h");
    assert.strictEqual(result.providers.minimax.status, "ok");
    assert.strictEqual(result.providers.deepseek.windows[0].label, "Left Budget");
    assert.strictEqual(result.providers.deepseek.status, "ok");
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

  it("preserves all last-known provider rows when a refresh returns no usable data", async () => {
    const previousSnapshot = {
      providers: {
        codex: {
          provider: "codex",
          status: "ok",
          label: "Codex",
          fetchedAt: 1200,
          source: "oauth",
          error: null,
          warnings: [],
          windows: [
            { key: "fiveHour", label: "5h", status: "ok", usedPercent: 2, remainingPercent: 98, detailText: null, resetText: "later" },
          ],
        },
        minimax: {
          provider: "minimax",
          status: "ok",
          label: "MiniMax",
          fetchedAt: 1200,
          source: "playwright",
          error: null,
          warnings: [],
          windows: [
            { key: "fiveHour", label: "5h", status: "ok", usedPercent: 29, remainingPercent: 71, detailText: null, resetText: null },
          ],
        },
        deepseek: {
          provider: "deepseek",
          status: "ok",
          label: "DeepSeek",
          fetchedAt: 1200,
          source: "playwright",
          error: null,
          warnings: [],
          windows: [
            { key: "usage", label: "Left Budget", status: "ok", usedPercent: null, remainingPercent: null, displayText: "28.51 CNY", detailText: null, resetText: null },
          ],
        },
      },
    };
    const result = await fetchProviderUsageSnapshots({
      config: { python: "python3", scriptPath: "/tmp/check_usage.py", timeoutMs: 30000, browser: "auto" },
      now: () => 9999,
      previousSnapshot,
      execFileImpl(cmd, args, opts, cb) {
        cb(null, JSON.stringify({
          provider: args[2],
          source: "auto",
          windows: { primary: {} },
          warnings: [],
        }), "");
      },
    });

    assert.strictEqual(result.providers.codex.status, "stale");
    assert.strictEqual(result.providers.codex.windows[0].remainingPercent, 98);
    assert.strictEqual(result.providers.minimax.status, "stale");
    assert.strictEqual(result.providers.minimax.windows[0].remainingPercent, 71);
    assert.strictEqual(result.providers.deepseek.status, "stale");
    assert.strictEqual(result.providers.deepseek.windows[0].displayText, "28.51 CNY");
    assert.strictEqual(result.lastResult, "ok");
  });

  it("skips optional provider checkers when disabled", async () => {
    const calls = [];
    const result = await fetchProviderUsageSnapshots({
      config: {
        python: "python3",
        scriptPath: "/tmp/check_usage.py",
        timeoutMs: 300000,
        browser: "auto",
        includeMiniMax: false,
        includeDeepSeek: false,
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
    assert.strictEqual(result.providers.deepseek.status, "unavailable");
    assert.strictEqual(result.providers.deepseek.source, "disabled");
    assert.strictEqual(result.lastError, null);
    assert.strictEqual(result.lastResult, "ok");
  });
});
