"use strict";

const SECRET_LABEL_PATTERNS = [
  { regex: /\b(password|passwd|pwd)\s*[:=]\s*[^\s,;]+/gi, replacement: "$1: [REDACTED_SECRET]" },
  { regex: /\b(token|api[_-]?key|secret|access[_-]?key)\s*[:=]\s*[^\s,;]+/gi, replacement: "$1: [REDACTED_TOKEN]" },
  { regex: /\b(account|acct|iban|routing|swift)\s*[:=]\s*[^\s,;]+/gi, replacement: "$1: [REDACTED_ACCOUNT]" },
];

const DIRECT_PATTERNS = [
  { regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[REDACTED_EMAIL]" },
  { regex: /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, replacement: "[REDACTED_PHONE]" },
  { regex: /\b(?:\d[ -]?){6,}\d\b/g, replacement: "[REDACTED_CODE]" },
  { regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g, replacement: "[REDACTED_TOKEN]" },
  { regex: /\b(?:sk|rk|pk|ghp|github_pat|xox[baprs]|AKIA|AIza)[A-Za-z0-9_\-]{8,}\b/g, replacement: "[REDACTED_TOKEN]" },
  { regex: /https?:\/\/[^\s?#]+(?:\?[^#\s]*(?:token|access_token|code|apikey|api_key|password|passwd|secret)=[^#\s&]+[^#\s]*)/gi, replacement: "[REDACTED_URL]" },
];

function sanitizeClipboardText(text) {
  const raw = typeof text === "string" ? text : "";
  let sanitized = raw;
  let redactionCount = 0;

  for (const { regex, replacement } of SECRET_LABEL_PATTERNS) {
    sanitized = sanitized.replace(regex, (...args) => {
      redactionCount += 1;
      if (typeof replacement === "function") return replacement(...args);
      return replacement;
    });
  }

  for (const { regex, replacement } of DIRECT_PATTERNS) {
    sanitized = sanitized.replace(regex, () => {
      redactionCount += 1;
      return replacement;
    });
  }

  sanitized = sanitized.replace(/[ \t]+\n/g, "\n").trim();

  return {
    text: sanitized,
    redacted: redactionCount > 0,
    redactionCount,
  };
}

module.exports = {
  sanitizeClipboardText,
};
