"use strict";

const childProcess = require("child_process");

function formatClockLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildPrompt({ now, slotLabel, context }) {
  const lines = [
    "Write one short coworker-style check-in bubble.",
    "Tone: warm, grounded, concise, not creepy.",
    "Do not mention surveillance, secret detection, or raw sensitive values.",
    "Infer cautiously from clipboard evidence only. Never claim certainty.",
    "Output plain text only, max 100 words.",
    `Current local time: ${formatClockLabel(now)}`,
    `Scheduled slot: ${slotLabel}`,
    `Clipboard entries in the last hour: ${context.counts.totalEntries}`,
    `Redacted entries: ${context.counts.redactedEntries}`,
    "Sanitized clipboard snippets:",
  ];
  if (!context.entries.length) {
    lines.push("- No recent clipboard history.");
  } else {
    for (const entry of context.entries.slice(-12)) {
      lines.push(`- [${new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}] ${entry.text}`);
    }
  }
  return lines.join("\n");
}

function buildFallbackMessage({ now, context }) {
  const slot = formatClockLabel(now);
  if (!context || !context.counts || context.counts.totalEntries === 0) {
    return `It's ${slot}. Quiet stretch so far. Take a breath and set up one good next step for yourself.`;
  }
  if (context.counts.totalEntries === 1) {
    return `It's ${slot}. Looks like you've been moving one thread forward. Nice pace. Give yourself a clean checkpoint before the next stretch.`;
  }
  return `It's ${slot}. You've touched a few threads in the last hour. Take a breath and close the loop on one thing before you switch again.`;
}

function normalizeOutput(stdout) {
  const text = String(stdout || "").trim().replace(/\s+\n/g, "\n");
  if (!text) return "";
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" ");
}

function runHermesCheckin(options = {}) {
  const config = options.config || {};
  const context = options.context || { entries: [], counts: { totalEntries: 0, redactedEntries: 0 } };
  const now = options.now instanceof Date ? options.now : new Date();
  const slotLabel = options.slotLabel || formatClockLabel(now);
  const logger = typeof options.logger === "function" ? options.logger : () => {};

  const prompt = buildPrompt({ now, slotLabel, context });
  const command = typeof config.command === "string" ? config.command.trim() : "";
  const rawArgs = Array.isArray(config.args) ? config.args.filter((v) => typeof v === "string") : [];
  const cwd = typeof config.cwd === "string" && config.cwd.trim() ? config.cwd.trim() : undefined;
  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 30000;

  if (!command) {
    return Promise.resolve({
      ok: false,
      code: "config",
      message: "Time check-in command is not configured.",
      detail: "Missing command",
      prompt,
      fallbackMessage: buildFallbackMessage({ now, context }),
    });
  }

  const args = command === "hermes"
    ? ["chat", "-q", prompt, "-Q", ...rawArgs]
    : rawArgs;

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = childProcess.spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGTERM"); } catch {}
      resolve({
        ok: false,
        code: "timeout",
        message: "Time check-in command timed out.",
        detail: stderr || "timeout",
        prompt,
        fallbackMessage: buildFallbackMessage({ now, context }),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logger(`Hermes check-in spawn failed: ${err && err.message}`);
      resolve({
        ok: false,
        code: "spawn",
        message: "Time check-in command failed to start.",
        detail: err && err.message,
        prompt,
        fallbackMessage: buildFallbackMessage({ now, context }),
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = normalizeOutput(stdout);
      if (code === 0 && text) {
        resolve({
          ok: true,
          text,
          prompt,
        });
        return;
      }
      logger(`Hermes check-in exited with code ${code}: ${stderr || "<no stderr>"}`);
      resolve({
        ok: false,
        code: "command_failed",
        message: "Time check-in command failed.",
        detail: stderr || `exit ${code}`,
        prompt,
        fallbackMessage: buildFallbackMessage({ now, context }),
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

module.exports = {
  runHermesCheckin,
  buildPrompt,
  buildFallbackMessage,
  formatClockLabel,
};
