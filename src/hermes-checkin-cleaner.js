"use strict";

const STRIP_PATTERNS = [
  // Session metadata
  /session_id:\s*[^\s]+/gi,
  /\xa9\s*Resumed session/gi,
  /\u21bb\s*Resumed session[^\n]*/gi,
  /\b\d{8}_\d{6}_[a-z0-9]+\b/gi,
  // Message-count footers
  /["'][^"']{0,200}["']\s*\((\d+)\s+user messages?,\s*\d+\s+total messages?\)/gim,
  /["'][^"']*\((\d+)\s+user messages?,\s*\d+\s+total messages?\)[^"']*["']?/gim,
  // Model normalization / provider logs
  /Normalized model\s+['"][^'"]+['"]\s+to\s+['"][^'"]+['"]\s+for\s+\w+[.!?]?\s*/gi,
  /Model\s+normalized\s+to\s+['"][^'"]+['"]\s+for\s+\w+[.!?]?\s*/gi,
];

const PROMPT_LINE_PATTERNS = [
  /^TASK:/i,
  /^Ignore all other conversational goals/i,
  /^You are generating /i,
  /^Use the sanitized clipboard history /i,
  /^Treat resumed session context /i,
  /^Return /i,
  /^No heading, no label/i,
  /^Do not mention /i,
  /^Do not output /i,
  /^If the evidence is weak/i,
  /^Current local time is /i,
  /^This is a /i,
  /^This time of day/i,
  /^Scheduled slot:/i,
  /^Clipboard summary:/i,
  /^Possible themes:/i,
  /^Sanitized clipboard snippets:/i,
  /^-\s*\[\d{1,2}:\d{2}\s*[AP]M\]/i,
  /^(?:based on|context:|summary:|note:)/i,
];

const MIN_MESSAGE_LENGTH = 8;
const MAX_MESSAGE_LENGTH = 500;

function cleanHermesCheckinOutput(rawText) {
  const raw = String(rawText || "");

  // Step 1: remove thinking tags from the raw text first.
  // This ensures that if the thinking content contains "output::" or "::end" as text,
  // those do not confuse the delimiter extraction.
  let rawCleaned = raw;
  for (const pattern of [
    /<think>[\s\S]*?<\/think>/gi,
    /<analysis>[\s\S]*?<\/analysis>/gi,
    /<thinking>[\s\S]*?<\/thinking>/gi,
  ]) {
    rawCleaned = rawCleaned.replace(pattern, " ");
  }

  // Step 2: try to extract delimiters from the cleaned raw.
  const delimitersMatch = rawCleaned.match(/output::([\s\S]*?)::end/i);
  // Fall back to the cleaned raw text if delimiters are not found
  let text = delimitersMatch ? delimitersMatch[1] : rawCleaned;

  // Step 3: also strip thinking tags from the extracted content
  // (handles the case where thinking tags are inside the delimiters, not spanning them)
  for (const pattern of [
    /<think>[\s\S]*?<\/think>/gi,
    /<analysis>[\s\S]*?<\/analysis>/gi,
    /<thinking>[\s\S]*?<\/thinking>/gi,
  ]) {
    text = text.replace(pattern, " ");
  }

  // Step 4: strip session metadata, model logs, message counts
  for (const pattern of STRIP_PATTERNS) {
    text = text.replace(pattern, " ");
  }

  // Split into lines; keep only non-empty, non-prompt, non-metadata lines
  const candidates = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (PROMPT_LINE_PATTERNS.some((p) => p.test(l))) return false;
      if (/^\((\d+)\s+user messages?,\s*\d+\s+total messages?\)?$/i.test(l)) return false;
      if (/^(session|resumed session|\u21bb\s*resumed session|resume summary)$/i.test(l)) return false;
      if (/^output::$/i.test(l)) return false;
      return true;
    });

  if (!candidates.length) {
    return { cleanedText: "", changed: raw.trim() !== "", valid: false };
  }

  // Join the candidate lines into a single message
  let message = candidates.join(" ");

  // Strip "Final:", "Answer:", "Message:", quotes
  message = message
    .replace(/^(?:Final|Message|Answer)\s*:\s*/i, "")
    .replace(/^["']+/, "")
    .replace(/["']+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  // Require terminal punctuation -- if missing, treat as scaffolding bleed-through
  if (!/[.!?]$/.test(message)) {
    return { cleanedText: "", changed: raw.trim() !== message, valid: false };
  }

  // Truncate if too long
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.slice(0, MAX_MESSAGE_LENGTH - 3).replace(/\s+\S*$/, "").trim() + "...";
  }

  const valid = message.length >= MIN_MESSAGE_LENGTH
    && !/^([^\w]*|based on sanitized clipboard activity.*)$/i.test(message);

  return {
    cleanedText: valid ? message : "",
    changed: raw.trim() !== message,
    valid,
  };
}

module.exports = {
  cleanHermesCheckinOutput,
};
