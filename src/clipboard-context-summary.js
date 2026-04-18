"use strict";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "been", "into", "your", "about",
  "will", "just", "over", "than", "then", "they", "them", "their", "what", "when", "were", "where",
  "which", "while", "after", "before", "using", "used", "more", "less", "into", "also", "some", "much",
  "very", "need", "does", "doesn", "dont", "isnt", "cant", "wont", "would", "could", "should", "make",
  "made", "like", "looks", "look", "still", "only", "each", "hour", "time", "check", "checkin", "clipboard",
]);

function classifyEntry(text) {
  if (!text) return "notes";
  if (/[{}[\];]/.test(text) || /\b(function|const|let|return|class|import|export)\b/.test(text)) {
    return "code";
  }
  if (/^\$?\s*(git|npm|node|python|cd|ls|rg|cat|sed|cp|mv|rm)\b/m.test(text)) {
    return "commands";
  }
  if (/[.!?]/.test(text) && /\b(the|and|with|for|from|that)\b/i.test(text)) {
    return "prose";
  }
  return "notes";
}

function extractKeywords(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const words = String(entry.text || "")
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{2,}/g);
    if (!words) continue;
    for (const word of words) {
      if (STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word]) => word);
}

function summarizeClipboardContext(context = {}) {
  const entries = Array.isArray(context.entries) ? context.entries : [];
  const counts = context.counts || { totalEntries: entries.length, redactedEntries: 0 };
  const typeCounts = {
    prose: 0,
    code: 0,
    commands: 0,
    notes: 0,
  };

  for (const entry of entries) {
    typeCounts[classifyEntry(entry && entry.text)] += 1;
  }

  const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];
  const keywords = extractKeywords(entries);
  let confidence = "low";
  if (counts.totalEntries >= 4 || keywords.length >= 3) confidence = "medium";
  if (counts.totalEntries >= 8 || keywords.length >= 4) confidence = "high";
  if (counts.redactedEntries > Math.max(1, Math.floor(counts.totalEntries / 2))) confidence = "low";

  return {
    totalEntries: counts.totalEntries || 0,
    redactedEntries: counts.redactedEntries || 0,
    dominantType,
    keywords,
    confidence,
  };
}

module.exports = {
  summarizeClipboardContext,
};
