"use strict";

module.exports = function createClipboardHistory(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0 ? options.maxAgeMs : 60 * 60 * 1000;
  const sanitizer = typeof options.sanitizer === "function"
    ? options.sanitizer
    : (text) => ({ text: typeof text === "string" ? text : "", redacted: false, redactionCount: 0 });

  let entries = [];

  function prune() {
    const cutoff = now() - maxAgeMs;
    entries = entries.filter((entry) => entry && typeof entry.at === "number" && entry.at >= cutoff);
  }

  function add(text, at = now()) {
    if (typeof text !== "string") return;
    const normalized = text.trim();
    if (!normalized) return;
    entries.push({ text: normalized, at });
    prune();
  }

  function getRecentEntries(windowMs = maxAgeMs) {
    prune();
    const cutoff = now() - windowMs;
    return entries.filter((entry) => entry.at >= cutoff).map((entry) => ({ ...entry }));
  }

  function getSanitizedSummary(windowMs = maxAgeMs) {
    const recent = getRecentEntries(windowMs);
    let redactedEntries = 0;
    const sanitizedEntries = recent.map((entry) => {
      const sanitized = sanitizer(entry.text);
      if (sanitized.redacted) redactedEntries += 1;
      return {
        text: sanitized.text,
        at: entry.at,
      };
    });
    return {
      entries: sanitizedEntries,
      counts: {
        totalEntries: sanitizedEntries.length,
        redactedEntries,
      },
    };
  }

  function clear() {
    entries = [];
  }

  return {
    add,
    prune,
    getRecentEntries,
    getSanitizedSummary,
    clear,
  };
};
