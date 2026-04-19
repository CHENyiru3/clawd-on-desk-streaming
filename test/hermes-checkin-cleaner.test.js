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

  it("extracts the final message when hermes echoes the prompt and reasoning", () => {
    const result = cleanHermesCheckinOutput(
      [
        "TASK: Write a Clawd desktop time check-in message.",
        "Ignore all other conversational goals for this turn.",
        "Clipboard summary: 4 entries, 0 redacted, dominant type prose, confidence medium.",
        "Return only the final bubble message.",
        "Reasoning: The user seems busy and the best tone is supportive.",
        "Final: It's 1:59 PM. Good moment to settle one thread before the afternoon fragments.",
      ].join("\n")
    );
    assert.strictEqual(
      result.cleanedText,
      "It's 1:59 PM. Good moment to settle one thread before the afternoon fragments."
    );
    assert.strictEqual(result.valid, true);
  });

  it("extracts the final line from the real resumed-session output shape", () => {
    const result = cleanHermesCheckinOutput(
      [
        '↻ Resumed session 20260417_140020_0b84f5 "<think>The user is asking Who are you...</think>" (23 user messages, 82 total messages)',
        "",
        "session_id: 20260417_140020_0b84f5",
        "Tightening the discussion narrative on MuSC aging - solid focus. How's the flow feeling?",
      ].join("\n")
    );
    assert.strictEqual(
      result.cleanedText,
      "Tightening the discussion narrative on MuSC aging - solid focus. How's the flow feeling?"
    );
    assert.strictEqual(result.valid, true);
  });
});
