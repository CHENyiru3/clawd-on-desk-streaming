"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildMiniMaxPrompt,
  extractJsonObject,
  normalizeMiniMaxPayload,
  classifyFailure,
  runHermesPrompt,
  fetchMiniMaxUsage,
} = require("../src/minimax-usage-fetcher");

describe("minimax-usage-fetcher", () => {
  it("builds a strict JSON-only Hermes prompt", () => {
    const prompt = buildMiniMaxPrompt(new Date("2026-04-18T13:15:00Z"));
    assert.match(prompt, /token-usage-checker skill/);
    assert.match(prompt, /Load the token-usage-checker skill first/i);
    assert.match(prompt, /Follow the skill steps exactly for MiniMax/i);
    assert.match(prompt, /Do not use any other skill/i);
    assert.match(prompt, /return JSON only/i);
    assert.match(prompt, /main HUD should represent the 5-hour window only/);
    assert.match(prompt, /do not switch sessions/i);
  });

  it("extracts and normalizes the final JSON payload", () => {
    const parsed = extractJsonObject("session_id: abc\n{\"plan\":\"Starter 月度套餐\",\"usedCalls\":599,\"limitCalls\":600,\"remainingPercent\":0.17,\"resetText\":\"~48分钟后\",\"hotItem\":{\"name\":\"coding-plan-search\",\"usedPercent\":98}}\n");
    const normalized = normalizeMiniMaxPayload(parsed);
    assert.strictEqual(normalized.plan, "Starter 月度套餐");
    assert.strictEqual(normalized.limitCalls, 600);
    assert.strictEqual(normalized.remainingPercent, 0.17);
    assert.strictEqual(normalized.hotItem.name, "coding-plan-search");
  });

  it("extracts the last valid JSON object from messy Hermes output", () => {
    const parsed = extractJsonObject(
      "I will use the token-usage-checker skill.\n" +
      "{\"example\":true}\n" +
      "Final result:\n" +
      "{\"plan\":\"Starter月度套餐\",\"availableCalls\":600,\"limitCalls\":600,\"usedCalls\":50,\"usedPercent\":8,\"remainingPercent\":92,\"resetText\":\"3 小时 56 分钟后重置\",\"expiresOn\":\"05/17/2026\",\"statusText\":\"50/600 8% 已使用\",\"hotItem\":{\"name\":\"music-2.6\",\"used\":50,\"limit\":600,\"usedPercent\":8}}\n"
    );
    assert.strictEqual(parsed.plan, "Starter月度套餐");
    assert.strictEqual(parsed.remainingPercent, 92);
  });

  it("maps Hermes MiniMax payload into a structured provider group", async () => {
    const group = await fetchMiniMaxUsage({
      enabled: true,
      now: () => 1234,
      hermesConfig: { command: "hermes", args: ["--resume", "abc"], timeoutMs: 30000 },
      spawnImpl(command, args, opts) {
        assert.deepStrictEqual(args.slice(-2), ["--resume", "abc"]);
        const listeners = {};
        return {
          stdout: { on(event, cb) { listeners[`stdout:${event}`] = cb; } },
          stderr: { on(event, cb) { listeners[`stderr:${event}`] = cb; } },
          on(event, cb) { listeners[event] = cb; },
          kill() {},
          stdin: {
            write() {},
            end() {
              listeners["stdout:data"]("↻ Resumed session\n{\"plan\":\"Starter 月度套餐\",\"availableCalls\":1,\"limitCalls\":600,\"usedCalls\":599,\"usedPercent\":99.83,\"remainingPercent\":0.17,\"resetText\":\"~48分钟后 (20:00 UTC+8)\",\"expiresOn\":\"05/17/2026\",\"statusText\":\"almost exhausted\",\"hotItem\":{\"name\":\"coding-plan-search\",\"used\":59,\"limit\":60,\"usedPercent\":98}}\n");
              listeners.close(0);
            },
          },
        };
      },
    });

    assert.strictEqual(group.provider, "minimax");
    assert.strictEqual(group.source, "hermes-skill");
    assert.strictEqual(group.windows[0].label, "5h");
    assert.strictEqual(group.windows[0].detailText, "coding-plan-search 98%");
    assert.strictEqual(group.windows[0].status, "critical");
  });

  it("classifies Hermes init failures explicitly", () => {
    const failure = classifyFailure(
      '↻ Resumed session\nFailed to initialize agent: [Errno 1] Operation not permitted: "/Users/test/.hermes/logs/agent.log"',
      "",
      false
    );
    assert.strictEqual(failure.code, "hermes_init_failed");
    assert.match(failure.message, /could not initialize/i);
  });

  it("keeps session noise out of JSON parsing and exposes stderr separately", async () => {
    const result = await runHermesPrompt(
      { command: "hermes", args: ["--resume", "20260417_140020_0b84f5"], timeoutMs: 30000 },
      buildMiniMaxPrompt(new Date("2026-04-18T13:15:00Z")),
      (command, args) => {
        const listeners = {};
        return {
          stdout: { on(event, cb) { listeners[`stdout:${event}`] = cb; } },
          stderr: { on(event, cb) { listeners[`stderr:${event}`] = cb; } },
          on(event, cb) { listeners[event] = cb; },
          kill() {},
          stdin: {
            write() {},
            end() {
              listeners["stdout:data"]('↻ Resumed session 20260417_140020_0b84f5\n{"plan":"Starter月度套餐","availableCalls":600,"limitCalls":600,"usedCalls":50,"usedPercent":8,"remainingPercent":92,"resetText":"3 小时 56 分钟后重置","expiresOn":"05/17/2026","statusText":"50/600 8% 已使用","hotItem":{"name":"music-2.6","used":50,"limit":600,"usedPercent":8}}\n');
              listeners["stderr:data"]("\nsession_id: 20260417_140020_0b84f5\n");
              listeners.close(0);
            },
          },
        };
      }
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.payload.plan, "Starter月度套餐");
    assert.match(result.stderr, /session_id/);
  });
});
