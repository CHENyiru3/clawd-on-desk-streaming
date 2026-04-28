"use strict";

const childProcess = require("child_process");
const { buildPromptInvocation } = require("./hermes-command");
const { buildCliEnv } = require("./cli-env");
const { summarizeClipboardContext } = require("./clipboard-context-summary");
const { cleanHermesCheckinOutput } = require("./hermes-checkin-cleaner");

function formatClockLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildTimeContext(now, slotLabel) {
  const hour24 = now.getHours();
  let partOfDay = "late-night";
  let transitionHint = "slowing down and not overextending";
  if (hour24 >= 5 && hour24 <= 10) {
    partOfDay = "morning";
    transitionHint = "starting the day";
  } else if (hour24 >= 11 && hour24 <= 13) {
    partOfDay = "midday";
    transitionHint = "resetting and regaining momentum";
  } else if (hour24 >= 14 && hour24 <= 16) {
    partOfDay = "afternoon";
    transitionHint = "pushing one meaningful thread forward";
  } else if (hour24 >= 17 && hour24 <= 22) {
    partOfDay = "evening";
    transitionHint = "wrapping up and closing loops";
  }
  return {
    clockLabel: formatClockLabel(now),
    weekdayLabel: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now),
    isoLocalDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    hour24,
    minute: now.getMinutes(),
    partOfDay,
    transitionHint,
    scheduledSlotLabel: slotLabel,
  };
}

function buildPrompt({ now, slotLabel, context }) {
  const timeContext = buildTimeContext(now, slotLabel);
  const summary = summarizeClipboardContext(context);
  const lines = [
    "TASK: Write a Clawd desktop time check-in message.",
    "Ignore all other conversational goals for this turn.",
    "You are generating one short coworker-style bubble body.",
    "Use the sanitized clipboard history below as the main evidence.",
    "Treat resumed session context as background tone only, not the main evidence source.",
    "Wrap the check-in message in output:: and ::end on their own lines. The message should be 1-3 short sentences.",
    "No heading, no label, no markdown, no quotes, no metadata.",
    "Do not mention the resumed session, clipboard, sanitization, or hidden reasoning.",
    "Do not output think tags, analysis, XML tags, or system text.",
    "If the evidence is weak, stay gentle and generic rather than specific.",
    `Current local time is ${timeContext.clockLabel} on ${timeContext.weekdayLabel}, ${timeContext.isoLocalDate}.`,
    `This is a ${timeContext.partOfDay} check-in.`,
    `This time of day often corresponds to ${timeContext.transitionHint}.`,
    `Scheduled slot: ${timeContext.scheduledSlotLabel}.`,
    `Clipboard summary: ${summary.totalEntries} entries, ${summary.redactedEntries} redacted, dominant type ${summary.dominantType}, confidence ${summary.confidence}.`,
    `Possible themes: ${summary.keywords.length ? summary.keywords.join(", ") : "none clearly repeated"}.`,
    "Sanitized clipboard snippets:",
  ];
  if (!context.entries.length) {
    lines.push("- No recent clipboard history.");
  } else {
    for (const entry of context.entries.slice(-10)) {
      lines.push(`- [${new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}] ${entry.text}`);
    }
  }
  lines.push("Wrap the check-in message in output:: and ::end on their own lines.");
  return lines.join("\n");
}

function buildFallbackMessage({ now, context }) {
  const slot = formatClockLabel(now);
  const partOfDay = buildTimeContext(now, slot).partOfDay;
  const totalEntries = context && context.counts ? context.counts.totalEntries || 0 : 0;
  if (partOfDay === "morning") {
    return totalEntries > 0
      ? `It's ${slot}. You've already started moving a few threads forward. Pick one and make the next step feel light.`
      : `It's ${slot}. Fresh start. Give yourself one clear next step and let the rest wait a minute.`;
  }
  if (partOfDay === "midday") {
    return totalEntries > 0
      ? `It's ${slot}. Good point to reset and regain momentum. Close one loop cleanly before the afternoon picks up.`
      : `It's ${slot}. Midday reset. A small pause now will make the next stretch cleaner.`;
  }
  if (partOfDay === "afternoon") {
    return totalEntries > 0
      ? `It's ${slot}. You've touched a few threads this hour. Try to move one meaningful thing over the line before switching again.`
      : `It's ${slot}. Afternoon stretch. One solid checkpoint will help more than scattering your attention.`;
  }
  if (partOfDay === "evening") {
    return totalEntries > 0
      ? `It's ${slot}. Feels like a good wrap-up window. Close one loop and leave yourself a kind handoff into tonight.`
      : `It's ${slot}. Wrap-up time. You do not need to force more than one clean finish right now.`;
  }
  return totalEntries > 0
    ? `It's ${slot}. Late hour. Be gentle with yourself and avoid opening a whole new thread if you can help it.`
    : `It's ${slot}. Late-night check-in. Slow is fine right now; one small next step is enough.`;
}

function normalizeOutput(stdout) {
  const text = String(stdout || "").trim().replace(/\s+\n/g, "\n");
  if (!text) return "";
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n");
}

function buildResolvedSuccess({ stdout, prompt, cleaned, code = null }) {
  return {
    ok: true,
    rawText: stdout,
    normalizedText: normalizeOutput(stdout),
    cleanedText: cleaned.cleanedText,
    cleanedChanged: cleaned.changed,
    prompt,
    code,
  };
}

function runHermesCheckin(options = {}) {
  const config = options.config || {};
  const context = options.context || { entries: [], counts: { totalEntries: 0, redactedEntries: 0 } };
  const now = options.now instanceof Date ? options.now : new Date();
  const slotLabel = options.slotLabel || formatClockLabel(now);
  const logger = typeof options.logger === "function" ? options.logger : () => {};

  const prompt = buildPrompt({ now, slotLabel, context });
  const invocation = buildPromptInvocation(config, prompt);
  const command = invocation.command;
  const args = invocation.args;
  const cwd = invocation.cwd;
  const timeoutMs = Math.max(invocation.timeoutMs, 120000);

  if (!command) {
    return Promise.resolve({
      ok: false,
      code: "config",
      message: "Time check-in command is not configured.",
      prompt,
      fallbackMessage: buildFallbackMessage({ now, context }),
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = childProcess.spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildCliEnv(),
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGTERM"); } catch {}
      const normalizedText = normalizeOutput(stdout);
      const cleaned = cleanHermesCheckinOutput(normalizedText);
      if (cleaned.valid) {
        resolve(buildResolvedSuccess({
          stdout,
          prompt,
          cleaned,
          code: "timeout_with_output",
        }));
        return;
      }
      resolve({
        ok: false,
        code: "timeout",
        message: "Time check-in command timed out.",
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
      const commandNotFound = err && err.code === "ENOENT";
      if (!commandNotFound) {
        logger(`Hermes check-in spawn failed: ${err && err.message}`);
      }
      resolve({
        ok: false,
        code: commandNotFound ? "command_not_found" : "spawn",
        message: commandNotFound
          ? `Time check-in command was not found: ${command}. Check the Hermes command in Settings.`
          : "Time check-in command failed to start.",
        prompt,
        fallbackMessage: buildFallbackMessage({ now, context }),
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const normalizedText = normalizeOutput(stdout);
      const cleaned = cleanHermesCheckinOutput(normalizedText);
      if (cleaned.valid) {
        resolve(buildResolvedSuccess({
          stdout,
          prompt,
          cleaned,
          code: code === 0 ? null : "nonzero_with_output",
        }));
        return;
      }
      logger(`Hermes check-in exited with code ${code}: ${stderr || "<no stderr>"}`);
      resolve({
        ok: false,
        code: "command_failed",
        message: "Time check-in command failed.",
        rawText: stdout,
        normalizedText,
        cleanedText: cleaned.cleanedText,
        prompt,
        fallbackMessage: buildFallbackMessage({ now, context }),
      });
    });

    if (invocation.usesStdin) {
      child.stdin.write(prompt);
    }
    child.stdin.end();
  });
}

module.exports = {
  runHermesCheckin,
  buildPrompt,
  buildFallbackMessage,
  buildTimeContext,
  formatClockLabel,
};
