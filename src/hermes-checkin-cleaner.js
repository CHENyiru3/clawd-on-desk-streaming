"use strict";

const STRIP_PATTERNS = [
  // Internal thinking/resolution tags (XML and markdown)
  /<think>[\s\S]*?<\/think>/gi,
  /<analysis>[\s\S]*?<\/analysis>/gi,
  /<thinking>[\s\S]*?<\/thinking>/gi,
  // Markdown heading sections that are internal scaffolding
  /^#{1,3}\s*(?:Thoughts?|Thinking|Reasoning|Analysis|Summary|Response|Output|Answer|Consideration|Notes?|Context)[\s:]*$/gim,
  // Section headers that wrap short internal content
  /^#{1,2}\s*(?:Final|Message|Bubble|Note)[\s:]*$/gim,
  // Generic reasoning chains
  /\b(?:Reasoning|Thought|Analysis|Chain[- ]of[- ]thought|COT)\s*:[\s\S]*?(?=(?:Final|Message|Answer|Bubble)\s*:|$)/gi,
  // Session metadata
  /session_id:\s*[^\s]+/gi,
  /©\s*Resumed session/gi,
  /↻\s*Resumed session[^\n]*/gi,
  /\b\d{8}_\d{6}_[a-z0-9]+\b/gi,
  // Message-count footers
  /["’"][^"’"]{0,200}["’"]\s*\(\d+\s+user messages?,\s*\d+\s+total messages?\)/gim,
  /["’"][^"’"]*\(\d+\s+user messages?,\s*\d+\s+total messages?\)[^"’"]*["’"]?/gim,
  // Intro scaffolding
  /^(here(?:’|’)s a check-?in|check-?in|message)\s*:\s*/gim,
];

const PROMPT_LINE_PATTERNS = [
  /^TASK:/i,
  /^Ignore all other conversational goals/i,
  /^You are generating /i,
  /^Use the sanitized clipboard history /i,
  /^Treat resumed session context /i,
  /^Return exactly one short message /i,
  /^No heading, no label/i,
  /^Do not mention the resumed session/i,
  /^Do not output think tags/i,
  /^If the evidence is weak/i,
  /^Current local time is /i,
  /^This is a /i,
  /^This time of day often corresponds /i,
  /^Scheduled slot:/i,
  /^Clipboard summary:/i,
  /^Possible themes:/i,
  /^Sanitized clipboard snippets:/i,
  /^Return only the final bubble message\./i,
  /^-\s*\[\d{1,2}:\d{2}\s*[AP]M\]/i,
  // Internal prefix patterns
  /^(?:based on|context:|summary:|note:)/i,
];

const MIN_MESSAGE_LENGTH = 8;
const MAX_MESSAGE_LENGTH = 280;

function cleanHermesCheckinOutput(rawText) {
  const raw = String(rawText || "");
  let text = raw;
  const promptBoundary = "Return only the final bubble message.";
  const boundaryIndex = text.lastIndexOf(promptBoundary);
  if (boundaryIndex >= 0) {
    text = text.slice(boundaryIndex + promptBoundary.length);
  }
  for (const pattern of STRIP_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  const candidateLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (PROMPT_LINE_PATTERNS.some((pattern) => pattern.test(line))) return false;
      if (/^(session|resumed session|↻\s*resumed session|based on sanitized clipboard activity)/i.test(line)) return false;
      if (/^\(?\d+\s+user messages?,\s*\d+\s+total messages?\)?$/i.test(line)) return false;
      if (/^resume summary$/i.test(line)) return false;
      return true;
    });

  text = candidateLines.join(" ");

  text = text
    .replace(/^(?:Final|Message|Answer)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^["'"]+/, "")
    .replace(/["'"]+$/, "")
    .trim();

  if (candidateLines.length > 1) {
    const lastLine = candidateLines[candidateLines.length - 1]
      .replace(/^(?:Final|Message|Answer)\s*:\s*/i, "")
      .trim();
    if (/[.!?]$/.test(lastLine) || /\b(how|what|ready|good|solid|take|close|pause)\b/i.test(lastLine)) {
      text = lastLine;
    }
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    text = text.slice(0, MAX_MESSAGE_LENGTH - 3).replace(/\s+\S*$/, "").trim() + "...";
  }

  // Collapse excess blank lines (max 2 consecutive)
  text = text.replace(/\n{3,}/g, "\n\n");

  // Trim edges
  text = text.trim();

  // Minimum content guard — too short after cleaning means likely scaffolding residue
  const valid = text.length >= MIN_MESSAGE_LENGTH
    && !/^([^\w]*|based on sanitized clipboard activity.*)$/i.test(text);

  return {
    cleanedText: valid ? text : "",
    changed: raw.trim() !== text,
    valid,
  };
}

module.exports = {
  cleanHermesCheckinOutput,
};
