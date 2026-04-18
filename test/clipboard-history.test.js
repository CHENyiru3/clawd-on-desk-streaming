"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const createClipboardHistory = require("../src/clipboard-history");

describe("clipboard-history", () => {
  it("keeps only recent entries and returns sanitized summary", () => {
    let current = 10_000;
    const history = createClipboardHistory({
      now: () => current,
      maxAgeMs: 1000,
      sanitizer: (text) => ({
        text: text.includes("secret") ? "[REDACTED_SECRET]" : text,
        redacted: text.includes("secret"),
        redactionCount: text.includes("secret") ? 1 : 0,
      }),
    });

    history.add("first", 9_100);
    history.add("secret code", 9_500);
    current = 10_200;
    const summary = history.getSanitizedSummary(1000);

    assert.deepStrictEqual(summary.entries, [
      { text: "[REDACTED_SECRET]", at: 9_500 },
    ]);
    assert.deepStrictEqual(summary.counts, {
      totalEntries: 1,
      redactedEntries: 1,
    });
  });
});
