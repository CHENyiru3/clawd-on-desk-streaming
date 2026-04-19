"use strict";

const childProcess = require("node:child_process");
const { buildPromptInvocation } = require("./hermes-command");

function buildPrompt(snapshot, now = new Date()) {
  const lines = [
    "TASK: Summarize provider usage for Clawd.",
    "Ignore all other conversational goals for this turn.",
    "Do not fetch provider usage in this step.",
    "Do not load or use any skills in this step.",
    "Return valid JSON only.",
    "Do not include headings, markdown, quotes, session metadata, or think tags.",
    "The numeric usage values are authoritative. Do not invent percentages or windows.",
    "Each provider already has structured windows. Respect them exactly.",
    "Codex windows are 5h and weekly.",
    "Cursor windows are Auto and API.",
    "MiniMax has only one 5h window from the MiniMax token-plan workflow.",
    "If MiniMax is unavailable or stale, say so directly and do not infer values.",
    "Return this exact shape: {\"overallStatus\":\"normal|watch|tight|unknown\",\"summaryText\":string|null,\"providerHints\":{\"codex\":{\"urgency\":\"normal|watch|tight|unknown\",\"shortText\":string|null},\"cursor\":{\"urgency\":\"normal|watch|tight|unknown\",\"shortText\":string|null},\"minimax\":{\"urgency\":\"normal|watch|tight|unknown\",\"shortText\":string|null}}}",
    `Current local time: ${now.toLocaleString("en-US")}`,
    `Snapshot JSON: ${JSON.stringify(snapshot)}`,
  ];
  return lines.join("\n");
}

function extractJsonObject(text) {
  const input = String(text || "");
  const candidates = [];
  for (let start = input.indexOf("{"); start !== -1; start = input.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < input.length; index += 1) {
      const ch = input[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === "\"") {
          inString = false;
        }
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth += 1;
        continue;
      }
      if (ch !== "}") continue;
      depth -= 1;
      if (depth !== 0) continue;
      const candidate = input.slice(start, index + 1);
      try {
        candidates.push(JSON.parse(candidate));
      } catch {
        // keep scanning for a later valid object
      }
      break;
    }
  }
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    if ("overallStatus" in candidate || "summaryText" in candidate || "providerHints" in candidate) {
      return candidate;
    }
  }
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function normalizeSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  return {
    overallStatus: typeof summary.overallStatus === "string" ? summary.overallStatus : "unknown",
    summaryText: typeof summary.summaryText === "string" ? summary.summaryText : null,
    providerHints: summary.providerHints && typeof summary.providerHints === "object" ? summary.providerHints : {},
  };
}

function summarizeProviderUsageWithHermes(options = {}) {
  const config = options.config || {};
  const snapshot = options.snapshot || {};
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const now = options.now instanceof Date ? options.now : new Date();
  const prompt = buildPrompt(snapshot, now);
  const invocation = buildPromptInvocation(config, prompt);
  const command = invocation.command;
  const args = invocation.args;
  const cwd = invocation.cwd;
  const timeoutMs = Math.max(invocation.timeoutMs, 300000);

  if (!command) {
    return Promise.resolve({ ok: false, code: "config", message: "Hermes provider usage command is not configured." });
  }

  return new Promise((resolve) => {
    const child = childProcess.spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGTERM"); } catch {}
      resolve({ ok: false, code: "timeout", message: "Hermes provider usage summary timed out." });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: "spawn", message: err && err.message ? err.message : "Hermes spawn failed." });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const parsed = normalizeSummary(extractJsonObject(stdout));
      if (code === 0 && parsed) {
        resolve({ ok: true, summary: parsed });
        return;
      }
      logger(`Hermes provider usage summary failed: code=${code} stderr=${stderr || "<none>"}`);
      resolve({ ok: false, code: "command_failed", message: "Hermes provider usage summary failed." });
    });

    if (invocation.usesStdin) child.stdin.write(prompt);
    child.stdin.end();
  });
}

module.exports = {
  buildPrompt,
  extractJsonObject,
  summarizeProviderUsageWithHermes,
};
