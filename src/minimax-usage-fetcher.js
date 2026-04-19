"use strict";

const childProcess = require("node:child_process");
const { buildPromptInvocation } = require("./hermes-command");
const { createEmptyProviderGroup, createUsageWindow, statusFromRemaining } = require("./provider-usage-model");

function buildMiniMaxPrompt(now = new Date()) {
  return [
    "TASK: Check token usage for MiniMax.",
    "Use the token-usage-checker skill.",
    "Load the token-usage-checker skill first.",
    "Follow the skill steps exactly for MiniMax.",
    "Do not use any other skill unless the token-usage-checker skill explicitly requires it.",
    "Only inspect MiniMax.",
    "Use the MiniMax token-plan page workflow from the skill.",
    "Use the currently resumed session context; do not switch sessions.",
    "Read the current MiniMax token-plan page and return JSON only.",
    "Do not include commentary, markdown, headings, tables, think tags, or session metadata.",
    "If login is required, complete it using the skill workflow if credentials are available.",
    "Return this exact shape:",
    "{\"plan\":string|null,\"availableCalls\":number|null,\"limitCalls\":number|null,\"usedCalls\":number|null,\"usedPercent\":number|null,\"remainingPercent\":number|null,\"resetText\":string|null,\"expiresOn\":string|null,\"statusText\":string|null,\"hotItem\":{\"name\":string|null,\"used\":number|null,\"limit\":number|null,\"usedPercent\":number|null}}",
    "Rules:",
    "- Do not skip MiniMax.",
    "- Use only values you can see on the MiniMax token-plan page.",
    "- The main HUD should represent the 5-hour window only.",
    "- The main 5-hour MiniMax plan quota is the authoritative HUD bar.",
    "- If a model-specific row such as coding-plan-search or music-2.6 is present, return it only in hotItem.",
    "- If the page says 599/600, return usedCalls=599 and limitCalls=600.",
    "- If only Chinese labels are visible, preserve the raw visible values.",
    "- If you can compute percentages from visible values, do so. Otherwise return null.",
    "- If the page is unavailable or not authenticated, return nulls and a short statusText.",
    "- Output JSON only. No prose before or after the JSON object.",
    `Current local time: ${now.toLocaleString("en-US")}`,
  ].join("\n");
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
    if ("plan" in candidate || "statusText" in candidate || "remainingPercent" in candidate || "hotItem" in candidate) {
      return candidate;
    }
  }
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function normalizeFiniteNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normalizeMiniMaxPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const usedCalls = normalizeFiniteNumber(payload.usedCalls);
  const limitCalls = normalizeFiniteNumber(payload.limitCalls);
  const availableCalls = normalizeFiniteNumber(payload.availableCalls);
  const usedPercent = normalizeFiniteNumber(payload.usedPercent);
  const remainingPercent = normalizeFiniteNumber(
    payload.remainingPercent != null
      ? payload.remainingPercent
      : (limitCalls && usedCalls != null ? Math.max(0, ((limitCalls - usedCalls) / limitCalls) * 100) : null)
  );
  const hotItem = payload.hotItem && typeof payload.hotItem === "object" ? payload.hotItem : null;
  return {
    plan: typeof payload.plan === "string" ? payload.plan : null,
    availableCalls,
    limitCalls,
    usedCalls,
    usedPercent: usedPercent != null ? usedPercent : (remainingPercent != null ? Math.max(0, 100 - remainingPercent) : null),
    remainingPercent,
    resetText: typeof payload.resetText === "string" ? payload.resetText : null,
    expiresOn: typeof payload.expiresOn === "string" ? payload.expiresOn : null,
    statusText: typeof payload.statusText === "string" ? payload.statusText : null,
    hotItem: hotItem ? {
      name: typeof hotItem.name === "string" ? hotItem.name : null,
      used: normalizeFiniteNumber(hotItem.used),
      limit: normalizeFiniteNumber(hotItem.limit),
      usedPercent: normalizeFiniteNumber(hotItem.usedPercent),
    } : null,
  };
}

function createGroupFromPayload(payload, now) {
  const normalized = normalizeMiniMaxPayload(payload);
  if (!normalized) {
    return createEmptyProviderGroup("minimax", {
      status: "error",
      fetchedAt: now,
      source: "hermes-skill",
      error: "MiniMax returned unusable structured output.",
      warnings: ["invalid_json"],
    });
  }
  const detailText = normalized.hotItem && normalized.hotItem.name
    ? `${normalized.hotItem.name}${normalized.hotItem.usedPercent != null ? ` ${Math.round(normalized.hotItem.usedPercent)}%` : ""}`
    : normalized.plan;
  const resetText = normalized.resetText || normalized.expiresOn || null;
  const window = createUsageWindow({
    key: "fiveHour",
    label: "5h",
    usedPercent: normalized.usedPercent,
    remainingPercent: normalized.remainingPercent,
    status: statusFromRemaining(normalized.remainingPercent),
    detailText,
    resetText,
  });
  return createEmptyProviderGroup("minimax", {
    status: normalized.remainingPercent == null ? "unavailable" : window.status,
    fetchedAt: now,
    source: "hermes-skill",
    error: normalized.remainingPercent == null ? (normalized.statusText || "MiniMax token-plan page was not available.") : null,
    windows: [window],
    warnings: [],
  });
}

function classifyFailure(stdout, stderr, timedOut) {
  const combined = `${String(stdout || "")}\n${String(stderr || "")}`;
  if (timedOut) {
    return {
      code: "hermes_timeout",
      message: "MiniMax usage request timed out after 5 minutes.",
    };
  }
  if (/Failed to initialize agent/i.test(combined) || /agent\.log/i.test(combined) || /Operation not permitted/i.test(combined)) {
    return {
      code: "hermes_init_failed",
      message: "Hermes could not initialize in this environment.",
    };
  }
  if (/login|required|not authenticated|unauthorized/i.test(combined)) {
    return {
      code: "not_authenticated",
      message: "MiniMax token-plan page was not available.",
    };
  }
  return {
    code: "hermes_command_failed",
    message: "MiniMax Hermes command failed.",
  };
}

function runHermesPrompt(config, prompt, spawnImpl = childProcess.spawn) {
  const invocation = buildPromptInvocation(config, prompt);
  const command = invocation.command;
  const args = invocation.args;
  const cwd = invocation.cwd;
  const timeoutMs = Math.max(invocation.timeoutMs, 300000);

  if (!command) {
    return Promise.resolve({ ok: false, code: "config", message: "MiniMax Hermes command is not configured." });
  }

  return new Promise((resolve) => {
    const child = spawnImpl(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      settled = true;
      try { child.kill("SIGTERM"); } catch {}
      const failure = classifyFailure(stdout, stderr, true);
      resolve({ ok: false, ...failure, stdout, stderr });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: "spawn",
        message: err && err.message ? err.message : "MiniMax Hermes spawn failed.",
        stdout,
        stderr,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const payload = extractJsonObject(stdout);
      if (code === 0 && payload) {
        resolve({ ok: true, payload, stdout, stderr });
        return;
      }
      if (code === 0 && !payload) {
        resolve({
          ok: false,
          code: "invalid_json",
          message: "MiniMax returned unusable structured output.",
          stdout,
          stderr,
        });
        return;
      }
      const failure = classifyFailure(stdout, stderr, timedOut);
      resolve({ ok: false, ...failure, stdout, stderr });
    });

    if (invocation.usesStdin) child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function fetchMiniMaxUsage(options = {}) {
  const now = typeof options.now === "function" ? options.now() : Date.now();
  const enabled = options.enabled !== false;
  if (!enabled) {
    return createEmptyProviderGroup("minimax", {
      status: "unavailable",
      fetchedAt: now,
      error: "MiniMax usage refresh disabled.",
      source: "disabled",
    });
  }

  const hermesConfig = options.hermesConfig || {};
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const result = await runHermesPrompt(
    hermesConfig,
    buildMiniMaxPrompt(new Date(now)),
    options.spawnImpl || childProcess.spawn
  );

  if (!result.ok) {
    logger(`MiniMax usage fetch failed (${result.code || "unknown"}): ${result.message || "unknown error"}`);
    return createEmptyProviderGroup("minimax", {
      status: "unavailable",
      fetchedAt: now,
      error: result.message || "MiniMax token-plan page was not available.",
      source: "hermes-skill",
      warnings: result.code ? [result.code] : [],
    });
  }

  return createGroupFromPayload(result.payload, now);
}

module.exports = {
  buildMiniMaxPrompt,
  extractJsonObject,
  normalizeMiniMaxPayload,
  createGroupFromPayload,
  classifyFailure,
  runHermesPrompt,
  fetchMiniMaxUsage,
};
