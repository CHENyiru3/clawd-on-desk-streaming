"use strict";

const { Anthropic } = require("@anthropic-ai/sdk");

const MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";
const MINIMAX_MODEL = "MiniMax-M2.5";

let _client = null;
let _clientApiKey = null;
let _apiKeyOverride = null;
let _clientFactory = (opts) => new Anthropic(opts);

function resolveApiKey() {
  const key = (_apiKeyOverride || process.env.MINIMAX_API_KEY || "").trim();
  return key || null;
}

function getClient() {
  const apiKey = resolveApiKey();
  if (!apiKey) return null;
  if (!_client || _clientApiKey !== apiKey) {
    _client = _clientFactory({
      baseURL: MINIMAX_BASE_URL,
      apiKey,
    });
    _clientApiKey = apiKey;
  }
  return _client;
}

function setApiKey(apiKey) {
  _apiKeyOverride = typeof apiKey === "string" ? apiKey.trim() : "";
  _client = null;
  _clientApiKey = null;
}

function setClientFactoryForTests(factory) {
  _clientFactory = typeof factory === "function" ? factory : ((opts) => new Anthropic(opts));
  _client = null;
  _clientApiKey = null;
}

function detectLang(text) {
  if (!text) return "en";
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (
      (cp >= 0x4E00 && cp <= 0x9FFF) ||
      (cp >= 0x3400 && cp <= 0x4DBF) ||
      (cp >= 0xFF00 && cp <= 0xFFEF) ||
      (cp >= 0x2F00 && cp <= 0x2FDF) ||
      (cp >= 0x3000 && cp <= 0x303F)
    ) {
      cjk++;
    } else if (
      (cp >= 0x0041 && cp <= 0x007A) ||
      (cp >= 0x0030 && cp <= 0x0039)
    ) {
      latin++;
    }
  }
  const total = cjk + latin;
  return total > 0 && cjk / total > 0.3 ? "zh" : "en";
}

function createTranslatorError(code, userMessage, debugMessage) {
  const err = new Error(userMessage);
  err.code = code;
  err.userMessage = userMessage;
  err.debugMessage = debugMessage || userMessage;
  return err;
}

function normalizeMiniMaxError(err) {
  const message = String((err && (err.debugMessage || err.message)) || "").trim();
  if (!resolveApiKey()) {
    return createTranslatorError(
      "missing_key",
      "MiniMax API key is not configured.",
      "MINIMAX_API_KEY not set"
    );
  }
  if (err && typeof err.status === "number" && (err.status === 401 || err.status === 403)) {
    return createTranslatorError("auth", "MiniMax rejected the API key.", message || `status ${err.status}`);
  }
  if (
    /ECONN|ENOTFOUND|ETIMEDOUT|timeout|network|fetch failed|socket/i.test(message) ||
    (err && typeof err.status === "number" && err.status >= 500)
  ) {
    return createTranslatorError(
      "network",
      "Could not reach MiniMax. Check your network and try again.",
      message || "network failure"
    );
  }
  if (err && err.code === "empty_result") {
    return createTranslatorError("empty_result", "MiniMax returned no translated text.", message || "empty result");
  }
  if (message) {
    return createTranslatorError("provider", "MiniMax returned an unexpected response.", message);
  }
  return createTranslatorError("unknown", "Translation failed.", "unknown MiniMax error");
}

function extractTranslatedText(message) {
  const blocks = Array.isArray(message && message.content) ? message.content : [];
  const translated = blocks
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!translated) {
    throw createTranslatorError("empty_result", "MiniMax returned no translated text.", "message contained no text blocks");
  }
  return translated;
}

async function requestTranslation(text) {
  const client = getClient();
  if (!client) {
    throw normalizeMiniMaxError(createTranslatorError("missing_key", "MiniMax API key is not configured.", "missing api key"));
  }
  const detectedLang = detectLang(text);
  const direction = detectedLang === "zh" ? "zh-en" : "en-zh";
  const system = detectedLang === "zh"
    ? "You are a professional translator. Translate the user's Chinese text to concise natural English. Reply only with the translation."
    : "You are a professional translator. Translate the user's English text to concise natural Simplified Chinese. Reply only with the translation.";
  try {
    const message = await client.messages.create({
      model: MINIMAX_MODEL,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text }],
        },
      ],
    });
    return {
      text: extractTranslatedText(message),
      detectedLang,
      direction,
      provider: "minimax",
    };
  } catch (err) {
    throw normalizeMiniMaxError(err);
  }
}

async function translateText(text) {
  return requestTranslation(String(text || ""));
}

async function checkTranslatorRuntime() {
  const client = getClient();
  if (!client) {
    throw normalizeMiniMaxError(createTranslatorError("missing_key", "MiniMax API key is not configured.", "missing api key"));
  }
  const result = await requestTranslation("hello");
  return {
    backend: "minimax",
    configured: true,
    provider: result.provider,
    direction: result.direction,
  };
}

module.exports = {
  MINIMAX_BASE_URL,
  MINIMAX_MODEL,
  getClient,
  setApiKey,
  setClientFactoryForTests,
  detectLang,
  translateText,
  checkTranslatorRuntime,
  normalizeMiniMaxError,
  extractTranslatedText,
};
