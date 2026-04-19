"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { buildPrompt, extractJsonObject } = require("../src/hermes-provider-usage");

describe("hermes-provider-usage", () => {
  it("builds a JSON-only prompt with provider snapshot context", () => {
    const prompt = buildPrompt({
      providers: {
        codex: { windows: [{ label: "5h", remainingPercent: 80 }, { label: "wk", remainingPercent: 62 }] },
        cursor: { windows: [{ label: "Auto", remainingPercent: 54 }, { label: "API", remainingPercent: 18 }] },
        minimax: { windows: [{ label: "5h", remainingPercent: null }], status: "unavailable" },
      },
    }, new Date("2026-04-18T13:15:00Z"));
    assert.match(prompt, /Return valid JSON only/);
    assert.match(prompt, /Do not fetch provider usage in this step/);
    assert.match(prompt, /Do not load or use any skills in this step/);
    assert.match(prompt, /Snapshot JSON:/);
    assert.match(prompt, /Codex windows are 5h and weekly/);
    assert.match(prompt, /MiniMax has only one 5h window/);
    assert.match(prompt, /codex/);
  });

  it("extracts the final JSON object from noisy output", () => {
    const parsed = extractJsonObject("session_id: 123\n{\"overallStatus\":\"normal\",\"summaryText\":\"steady\",\"providerHints\":{}}\n");
    assert.deepStrictEqual(parsed, {
      overallStatus: "normal",
      summaryText: "steady",
      providerHints: {},
    });
  });

  it("prefers the last valid JSON object when Hermes emits extra objects", () => {
    const parsed = extractJsonObject(
      "draft:\n" +
      "{\"ignore\":true}\n" +
      "final:\n" +
      "{\"overallStatus\":\"watch\",\"summaryText\":\"Cursor API is tight.\",\"providerHints\":{\"cursor\":{\"urgency\":\"watch\",\"shortText\":\"API is tight\"}}}\n"
    );
    assert.deepStrictEqual(parsed, {
      overallStatus: "watch",
      summaryText: "Cursor API is tight.",
      providerHints: {
        cursor: {
          urgency: "watch",
          shortText: "API is tight",
        },
      },
    });
  });
});
