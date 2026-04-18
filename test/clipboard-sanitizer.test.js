"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { sanitizeClipboardText } = require("../src/clipboard-sanitizer");

describe("clipboard-sanitizer", () => {
  it("redacts emails and long digit sequences", () => {
    const result = sanitizeClipboardText("email me at person@example.com and use 1234 5678 9012");
    assert.match(result.text, /\[REDACTED_EMAIL\]/);
    assert.match(result.text, /\[REDACTED_(?:CODE|PHONE)\]/);
    assert.strictEqual(result.redacted, true);
  });

  it("redacts common secret labels and token prefixes", () => {
    const result = sanitizeClipboardText("token=ghp_1234567890abcdef password: hunter2");
    assert.match(result.text, /\[REDACTED_TOKEN\]/);
    assert.match(result.text, /\[REDACTED_SECRET\]/);
    assert.ok(result.redactionCount >= 2);
  });

  it("keeps harmless prose readable", () => {
    const result = sanitizeClipboardText("Draft the update bubble copy for this afternoon.");
    assert.strictEqual(result.text, "Draft the update bubble copy for this afternoon.");
    assert.strictEqual(result.redacted, false);
  });
});
