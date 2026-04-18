"use strict";

const STRIP_PATTERNS = [
  /session_id:\s*[^\s]+/gi,
  /©\s*Resumed session/gi,
  /\b\d{8}_\d{6}_[a-z0-9]+\b/gi,
  /<think>[\s\S]*?<\/think>/gi,
  /<analysis>[\s\S]*?<\/analysis>/gi,
  /["'“][^"'”]{0,200}["'”]\s*\(\d+\s+user messages?,\s*\d+\s+total messages?\)/gim,
  /["'“][^"'”]*\(\d+\s+user messages?,\s*\d+\s+total messages?\)[^"'”]*["'”]?/gim,
  /^(here(?:'|’)s a check-?in|check-?in|message)\s*:\s*/gim,
];

function cleanHermesCheckinOutput(rawText) {
  const raw = String(rawText || "");
  let text = raw;
  for (const pattern of STRIP_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  text = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^(session|resumed session|based on sanitized clipboard activity)/i.test(line)) return false;
      if (/^\(?\d+\s+user messages?,\s*\d+\s+total messages?\)?$/i.test(line)) return false;
      if (/^resume summary$/i.test(line)) return false;
      return true;
    })
    .join(" ");

  text = text
    .replace(/\s+/g, " ")
    .replace(/^["'“]+/, "")
    .replace(/["'”]+$/, "")
    .trim();

  if (text.length > 280) {
    text = text.slice(0, 277).replace(/\s+\S*$/, "").trim() + "...";
  }

  const valid = !!text && !/^([^\w]*|based on sanitized clipboard activity.*)$/i.test(text);
  return {
    cleanedText: valid ? text : "",
    changed: raw.trim() !== text,
    valid,
  };
}

module.exports = {
  cleanHermesCheckinOutput,
};
