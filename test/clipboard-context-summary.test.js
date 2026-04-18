"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { summarizeClipboardContext } = require("../src/clipboard-context-summary");

describe("clipboard-context-summary", () => {
  it("derives dominant type and keywords", () => {
    const summary = summarizeClipboardContext({
      entries: [
        { text: "muscle aging discussion notes and revision" },
        { text: "revise aging discussion paragraph for muscle stem cells" },
        { text: "draft notes for discussion section" },
      ],
      counts: { totalEntries: 3, redactedEntries: 0 },
    });
    assert.strictEqual(summary.dominantType, "notes");
    assert.ok(summary.keywords.includes("aging"));
  });

  it("drops confidence when many entries are redacted", () => {
    const summary = summarizeClipboardContext({
      entries: [
        { text: "[REDACTED_TOKEN]" },
        { text: "[REDACTED_EMAIL]" },
        { text: "git status" },
      ],
      counts: { totalEntries: 3, redactedEntries: 2 },
    });
    assert.strictEqual(summary.confidence, "low");
  });
});
