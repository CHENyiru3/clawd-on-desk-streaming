"use strict";

const childProcess = require("node:child_process");
const {
  normalizeUsageSnapshot,
  createEmptyProviderGroup,
  providerGroupHasUsableData,
  markProviderGroupStale,
} = require("./provider-usage-model");
const { fetchMiniMaxUsage } = require("./minimax-usage-fetcher");

function runChecker(config, provider, execFileImpl = childProcess.execFile) {
  const python = config && config.python ? config.python : "python3";
  const scriptPath = config && config.scriptPath ? config.scriptPath : "";
  const timeoutMs = config && Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000;
  const browser = config && config.browser ? config.browser : "auto";
  if (!scriptPath) {
    return Promise.resolve({ ok: false, error: "Provider usage checker script is not configured." });
  }
  return new Promise((resolve) => {
    execFileImpl(
      python,
      [
        scriptPath,
        "--provider",
        provider,
        "--json",
        "--browser",
        browser,
        "--timeout",
        String(Math.max(1, Math.round(timeoutMs / 1000))),
      ],
      { timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr || err.message || `Failed to fetch ${provider} usage.` });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout || "{}"));
          resolve({ ok: true, data: parsed });
        } catch (parseErr) {
          resolve({ ok: false, error: parseErr.message || `Failed to parse ${provider} usage JSON.` });
        }
      }
    );
  });
}

function buildProviderError(provider, error, now) {
  return createEmptyProviderGroup(provider, {
    status: "error",
    fetchedAt: now,
    error,
    source: "checker",
  });
}

async function fetchProviderUsageSnapshots(options = {}) {
  const config = options.config || {};
  const hermesConfig = options.hermesConfig || {};
  const now = typeof options.now === "function" ? options.now() : Date.now();
  const execFileImpl = options.execFileImpl || childProcess.execFile;
  const fetchMiniMaxUsageImpl = options.fetchMiniMaxUsageImpl || fetchMiniMaxUsage;
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const previousSnapshot = options.previousSnapshot || null;

  const [codexResult, cursorResult, minimaxGroup] = await Promise.all([
    runChecker(config, "codex", execFileImpl),
    runChecker(config, "cursor", execFileImpl),
    fetchMiniMaxUsageImpl({
      enabled: options.miniMaxEnabled !== false,
      now: () => now,
      hermesConfig,
      logger,
    }),
  ]);

  const providers = {
    codex: codexResult.ok
      ? normalizeUsageSnapshot("codex", codexResult.data, now)
      : buildProviderError("codex", codexResult.error, now),
    cursor: cursorResult.ok
      ? normalizeUsageSnapshot("cursor", cursorResult.data, now)
      : buildProviderError("cursor", cursorResult.error, now),
    minimax: minimaxGroup,
  };

  let miniMaxError = null;
  const previousMiniMax = previousSnapshot && previousSnapshot.providers ? previousSnapshot.providers.minimax : null;
  if (!providerGroupHasUsableData(providers.minimax) && providerGroupHasUsableData(previousMiniMax)) {
    miniMaxError = providers.minimax && providers.minimax.error
      ? providers.minimax.error
      : "MiniMax usage refresh failed; showing last known data.";
    providers.minimax = markProviderGroupStale(previousMiniMax, miniMaxError, now);
  } else if (providers.minimax && providers.minimax.error) {
    miniMaxError = providers.minimax.error;
  }

  const statuses = Object.values(providers).map((group) => group && group.status);
  return {
    fetchedAt: now,
    providers,
    lastError: miniMaxError,
    lastResult:
      statuses.every((status) => status === "error" || status === "unavailable")
        ? "error"
        : statuses.some((status) => status === "error" || status === "unavailable")
          ? "partial"
          : "ok",
  };
}

module.exports = {
  fetchProviderUsageSnapshots,
  runChecker,
};
