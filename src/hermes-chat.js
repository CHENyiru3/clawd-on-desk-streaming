"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

// ── ANSI strip ──────────────────────────────────────────────────────────────
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text) {
  return String(text || "").replace(ANSI_REGEX, "");
}

function stripTrailingPrompt(text) {
  // Remove terminal control sequences that might trail the response
  // (e.g., leftover cursor movements, bell chars)
  return text
    .replace(/\x07/g, "")          // bell
    .replace(/\x1B\[?K/g, "")       // clear line
    .replace(/\x1B\[?1M/g, "")      // mouse tracking
    .trimEnd();
}

// ── Config normalization ────────────────────────────────────────────────────
function normalizeConfig(raw = {}) {
  return {
    command: typeof raw.command === "string" ? raw.command.trim() : "hermes",
    args: Array.isArray(raw.args) ? raw.args.filter((v) => typeof v === "string" && v) : [],
    cwd: typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : undefined,
    timeoutMs: Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0 ? raw.timeoutMs : 180000,
  };
}

// ── Prompt builder ─────────────────────────────────────────────────────────
function buildChatPrompt(messages) {
  // Format conversation as a simple text prompt for hermes chat -q
  // Hermes will prepend its own system prompt automatically
  const lines = messages.map((m) => {
    if (m.role === "system") return `SYSTEM: ${m.content}`;
    if (m.role === "user") return `USER: ${m.content}`;
    if (m.role === "assistant") return `ASSISTANT: ${m.content}`;
    return `${m.role}: ${m.content}`;
  });
  return lines.join("\n\n");
}

// ── History persistence ─────────────────────────────────────────────────────
function getHistoryPath() {
  // Determined lazily to avoid requiring electron app.path at module load
  // Caller passes userDataPath; stored as closure variable
  return null; // set by init()
}

let _historyPath = null;
let _history = [];  // [{role, content, at}]

function initHistory(userDataPath) {
  _historyPath = path.join(userDataPath, "hermes-chat-history.json");
  try {
    if (fs.existsSync(_historyPath)) {
      const raw = fs.readFileSync(_historyPath, "utf8");
      const parsed = JSON.parse(raw);
      _history = Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    _history = [];
  }
  return _history;
}

function saveHistory() {
  if (!_historyPath) return;
  try {
    const tmp = _historyPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(_history, null, 2), "utf8");
    fs.renameSync(tmp, _historyPath);
  } catch (err) {
    console.warn("[HermesChat] Failed to save history:", err.message);
  }
}

function clearHistory() {
  _history = [];
  saveHistory();
}

// ── Core: sendMessage ───────────────────────────────────────────────────────
//
// options = {
//   text,           // user message text
//   config,         // { command, args, cwd, timeoutMs }
//   onToken,        // (token: string, isFirst: bool, isLast: bool) => void
//   onComplete,     // (ok: bool, message: string, code: string) => void
// }
function sendMessage(options) {
  const {
    text,
    config: rawConfig,
    onToken,
    onComplete,
  } = options;

  const config = normalizeConfig(rawConfig);

  // Add user message to history
  _history.push({ role: "user", content: text, at: Date.now() });

  // Build prompt from full conversation
  const prompt = buildChatPrompt(_history);
  const command = config.command || "hermes";

  // Build args: hermes chat -q "prompt" -Q ...extraArgs
  const extraArgs = config.args || [];
  const args = ["chat", "-q", prompt, "-Q", ...extraArgs];

  const cwd = config.cwd;
  const timeoutMs = Math.max(config.timeoutMs, 30000);

  let settled = false;
  let fullResponse = "";
  let isFirst = true;
  let timer = null;

  const cleanup = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const settle = (ok, message, code) => {
    if (settled) return;
    settled = true;
    cleanup();

    // Strip ANSI and trailing control chars from final response
    const cleanText = stripTrailingPrompt(stripAnsi(fullResponse));

    // Store assistant response in history
    if (cleanText) {
      _history.push({ role: "assistant", content: cleanText, at: Date.now() });
      saveHistory();
    }

    // Trim history to last 100 messages (50 turns) to prevent unbounded growth
    if (_history.length > 100) {
      _history = _history.slice(-100);
      saveHistory();
    }

    onComplete(ok, cleanText, code);
  };

  timer = setTimeout(() => {
    settle(false, "Command timed out.", "timeout");
    try { child.kill("SIGTERM"); } catch {}
  }, timeoutMs);

  const child = childProcess.spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    // Don't inherit env — keep Clawd's env clean
    env: { ...process.env },
  });

  child.stdout.on("data", (chunk) => {
    const raw = String(chunk);
    fullResponse += raw;

    // Strip ANSI per-chunk for display
    const clean = stripAnsi(raw);
    if (clean) {
      onToken(clean, isFirst, false);
      isFirst = false;
    }
  });

  child.stderr.on("data", (chunk) => {
    // Suppress stderr — hermes may emit progress/spinner to stderr
    // (it's not useful in the chat bubble)
  });

  child.on("error", (err) => {
    // spawn failed — command not found, permission denied, etc.
    settle(false, `Failed to start: ${err.message}`, "spawn");
  });

  child.on("close", (code) => {
    if (!settled) {
      settle(code === 0, code === 0 ? "Done" : `Exited with code ${code}`, String(code));
    }
  });
}

// ── Module API ─────────────────────────────────────────────────────────────
module.exports = {
  initHistory,
  sendMessage,
  clearHistory,
  getHistory: () => _history.slice(),  // safe copy
};
