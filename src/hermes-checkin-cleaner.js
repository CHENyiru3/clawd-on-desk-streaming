"use strict";

const STRIP_PATTERNS = [
  /session_id:\s*[^\s]+/gi,
  /©\s*Resumed session/gi,
  /↻\s*Resumed session[^\n]*/gi,
  /\b\d{8}_\d{6}_[a-z0-9]+\b/gi,
  /<think>[\s\S]*?<\/think>/gi,
  /<analysis>[\s\S]*?<\/analysis>/gi,
  /\b(?:Reasoning|Thought|Analysis|Chain[- ]of[- ]thought|COT)\s*:[\s\S]*?(?=(?:Final|Message|Answer)\s*:|$)/gi,
  /["'“][^"'”]{0,200}["'”]\s*\(\d+\s+user messages?,\s*\d+\s+total messages?\)/gim,
  /["'“][^"'”]*\(\d+\s+user messages?,\s*\d+\s+total messages?\)[^"'”]*["'”]?/gim,
  /^(here(?:'|’)s a check-?in|check-?in|message)\s*:\s*/gim,
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
];

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
    .replace(/^["'“]+/, "")
    .replace(/["'”]+$/, "")
    .trim();

  if (candidateLines.length > 1) {
    const lastLine = candidateLines[candidateLines.length - 1]
      .replace(/^(?:Final|Message|Answer)\s*:\s*/i, "")
      .trim();
    if (/[.!?]$/.test(lastLine) || /\b(how|what|ready|good|solid|take|close|pause)\b/i.test(lastLine)) {
      text = lastLine;
    }
  }

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
