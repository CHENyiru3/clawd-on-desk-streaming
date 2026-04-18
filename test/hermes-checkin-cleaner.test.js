"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { cleanHermesCheckinOutput } = require("../src/hermes-checkin-cleaner");

describe("hermes-checkin-cleaner", () => {
  it("strips resumed-session metadata and think tags", () => {
    const result = cleanHermesCheckinOutput(
      'session_id: 20260418_111111_aaaaaa\n© Resumed session\n<think>hidden</think>\n"resume summary" (17 user messages, 70 total messages)\nHey - take a breath and close one loop.'
    );
    assert.strictEqual(result.cleanedText, "Hey - take a breath and close one loop.");
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.changed, true);
  });

  it("rejects metadata-only output", () => {
    const result = cleanHermesCheckinOutput("session_id: 20260418_111111_aaaaaa\n© Resumed session");
    assert.strictEqual(result.cleanedText, "");
    assert.strictEqual(result.valid, false);
  });
});
