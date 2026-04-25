"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { cleanHermesCheckinOutput } = require("../src/hermes-checkin-cleaner");

const opentag = "<think>";
const closetag = "</think>";

describe("hermes-checkin-cleaner", () => {
  it("extracts content between output:: and ::end delimiters", () => {
    const result = cleanHermesCheckinOutput(
      "output::\nGood progress on the research thread today.\n::end"
    );
    assert.strictEqual(result.cleanedText, "Good progress on the research thread today.");
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.changed, true);
  });

  it("extracts multi-line content between delimiters", () => {
    const result = cleanHermesCheckinOutput(
      "output::\nYou've been working on the research pipeline.\nGood focus on closing the loop.\n::end"
    );
    assert.strictEqual(result.cleanedText, "You've been working on the research pipeline. Good focus on closing the loop.");
    assert.strictEqual(result.valid, true);
  });

  it("extracts the sentence after a message-count footer", () => {
    const result = cleanHermesCheckinOutput(
      '\"resume summary\" (17 user messages, 70 total messages)\nHey - take a breath and close one loop.'
    );
    assert.strictEqual(result.cleanedText, "Hey - take a breath and close one loop.");
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.changed, true);
  });

  it("rejects metadata-only output", () => {
    const result = cleanHermesCheckinOutput("session_id: 20260418_111111_aaaaaa\n\xa9 Resumed session");
    assert.strictEqual(result.cleanedText, "");
    assert.strictEqual(result.valid, false);
  });

  it("strips model normalization logs", () => {
    const result = cleanHermesCheckinOutput(
      "Normalized model 'deepseek-v4-flash' to 'deepseek-chat' for deepseek.\noutput::\nYou made solid progress on the research thread.\n::end"
    );
    assert.strictEqual(result.cleanedText, "You made solid progress on the research thread.");
    assert.strictEqual(result.valid, true);
  });

  it("extracts the message when hermes echoes the prompt and reasoning", () => {
    // The prompt line contains "output:: and ::end" on the same line.
    // After think tags are stripped, the cleaner's lazy delimiter regex would
    // incorrectly match "output:: and ::end" from that prompt line — so the think
    // tag must span the entire prompt including that line, and the real delimiters
    // must come after on their own line.
    const input = (
      opentag +
      "TASK: Write a Clawd desktop time check-in message.\n" +
      "Ignore all other conversational goals for this turn.\n" +
      "Clipboard summary: 4 entries, 0 redacted, dominant type prose, confidence medium.\n" +
      "Wrap the check-in message in output:: and ::end on their own lines.\n" +
      "The user seems busy and the best tone is supportive.\n" +
      closetag +
      "\noutput::\n" +
      "It is 1:59 PM. Good moment to settle one thread before the afternoon picks up.\n" +
      "::end"
    );
    const result = cleanHermesCheckinOutput(input);
    assert.strictEqual(
      result.cleanedText,
      "It is 1:59 PM. Good moment to settle one thread before the afternoon picks up."
    );
    assert.strictEqual(result.valid, true);
  });

  it("extracts the message from a resumed-session output shape", () => {
    const input = (
      "\u21bb Resumed session 20260417_140020_0b84f5 \"" + opentag + "The user is asking Who are you" + closetag + "\" (23 user messages, 82 total messages)\n" +
      "\n" +
      "session_id: 20260417_140020_0b84f5\n" +
      "output::\n" +
      "Tightening the discussion narrative on MuSC aging - solid focus. How is the flow feeling?\n" +
      "::end"
    );
    const result = cleanHermesCheckinOutput(input);
    assert.strictEqual(
      result.cleanedText,
      "Tightening the discussion narrative on MuSC aging - solid focus. How is the flow feeling?"
    );
    assert.strictEqual(result.valid, true);
  });

  it("rejects output without delimiters and without terminal punctuation", () => {
    const result = cleanHermesCheckinOutput(
      "Normalized model 'deepseek-v4-flash' to 'deepseek-chat' for deepseek. you?"
    );
    assert.strictEqual(result.cleanedText, "");
    assert.strictEqual(result.valid, false);
  });

  it("strips thinking tags and keeps the delimited content", () => {
    const input = opentag + "internal reasoning" + closetag + "\noutput::\nGood checkpoint on closing the loop.\n::end";
    const result = cleanHermesCheckinOutput(input);
    assert.strictEqual(result.cleanedText, "Good checkpoint on closing the loop.");
    assert.strictEqual(result.valid, true);
  });

  it("uses the first delimiter pair when multiple are present", () => {
    const result = cleanHermesCheckinOutput(
      "output::\nFirst message.\n::end\noutput::\nSecond message.\n::end"
    );
    assert.strictEqual(result.cleanedText, "First message.");
    assert.strictEqual(result.valid, true);
  });

  it("returns invalid when delimiters are empty", () => {
    const result = cleanHermesCheckinOutput("output::::end");
    assert.strictEqual(result.cleanedText, "");
    assert.strictEqual(result.valid, false);
  });
});
