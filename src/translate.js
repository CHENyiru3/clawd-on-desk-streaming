// src/translate.js — Bi-directional translation (EN↔中文) via MiniMax API
// Quick translate: reads clipboard → calls MiniMax-M2.5 → auto-detects language

const { Anthropic } = require("@anthropic-ai/sdk");

let _client = null;
let _apiKey = null;

function getClient() {
  const apiKey = process.env.MINIMAX_API_KEY || _apiKey;
  if (!apiKey) return null;
  if (!_client || _apiKey !== apiKey) {
    _client = new Anthropic({
      baseURL: "https://api.minimaxi.com/v1",
      apiKey,
    });
    _apiKey = apiKey;
  }
  return _client;
}

function setApiKey(apiKey) {
  _apiKey = apiKey;
  _client = null; // Force re-init on next call
}

/**
 * Detect whether text is primarily Chinese (CJK) or not.
 * Returns "zh" or "en".
 */
function detectLang(text) {
  if (!text) return "en";
  let cjk = 0, latin = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    // CJK Unified Ideographs + Fullwidth Forms + Kangxi Radicals + common punctuation
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
        (cp >= 0xFF00 && cp <= 0xFFEF) || (cp >= 0x2F00 && cp <= 0x2FDF) ||
        (cp >= 0x3000 && cp <= 0x303F)) {
      cjk++;
    } else if ((cp >= 0x0041 && cp <= 0x007A) || (cp >= 0x0030 && cp <= 0x0039)) {
      latin++;
    }
  }
  // If 30%+ of meaningful chars are CJK, treat as Chinese
  const total = cjk + latin;
  return total > 0 && cjk / total > 0.3 ? "zh" : "en";
}

/**
 * Translate text between English and Chinese.
 * Detects input language automatically and translates to the other language.
 * Returns { text, detectedLang } or throws on error.
 */
async function translateText(text) {
  const client = getClient();
  if (!client) {
    throw new Error("MINIMAX_API_KEY not set. Set it in your .env file or Settings.");
  }

  const detected = detectLang(text);
  const isZh = detected === "zh";

  const system = isZh
    ? "You are a professional translator. Translate the user's Chinese text to English (Simplified English). Reply ONLY with the translation, no explanations, no quotes, no notes."
    : "You are a professional translator. Translate the user's English text to Chinese (Simplified Chinese). Reply ONLY with the translation, no explanations, no quotes, no notes.";

  const message = await client.messages.create({
    model: "MiniMax-M2.5",
    max_tokens: 1024,
    system,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text }],
      },
    ],
  });

  const textBlocks = message.content.filter((b) => b.type === "text");
  const translated = textBlocks.map((b) => b.text).join("").trim();
  return { text: translated, detectedLang: detected };
}
module.exports = { translateText, setApiKey, getClient };
