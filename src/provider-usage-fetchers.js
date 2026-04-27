"use strict";

const childProcess = require("node:child_process");
const {
  normalizeUsageSnapshot,
  createEmptyProviderGroup,
  providerGroupHasUsableData,
  markProviderGroupStale,
} = require("./provider-usage-model");

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

function stabilizeProviderGroup(provider, group, previousSnapshot, enabled, now) {
  if (!enabled) return { group, error: null };
  if (providerGroupHasUsableData(group)) {
    return { group, error: group && group.error ? group.error : null };
  }
  const previous = previousSnapshot && previousSnapshot.providers ? previousSnapshot.providers[provider] : null;
  if (!providerGroupHasUsableData(previous)) {
    return { group, error: group && group.error ? group.error : null };
  }
  const label = group && group.label ? group.label : provider;
  const error = group && group.error
    ? group.error
    : `${label} usage refresh returned no usable data; showing last known data.`;
  return {
    group: markProviderGroupStale(previous, error, now),
    error,
  };
}

async function fetchProviderUsageSnapshots(options = {}) {
  const config = options.config || {};
  const now = typeof options.now === "function" ? options.now() : Date.now();
  const execFileImpl = options.execFileImpl || childProcess.execFile;
  const previousSnapshot = options.previousSnapshot || null;
  const includeMiniMax = config.includeMiniMax !== false;
  const includeDeepSeek = config.includeDeepSeek !== false;

  const [codexResult, minimaxResult, deepseekResult] = await Promise.all([
    runChecker(config, "codex", execFileImpl),
    includeMiniMax
      ? runChecker(config, "minimax", execFileImpl)
      : Promise.resolve({ ok: false, skipped: true, error: null }),
    includeDeepSeek
      ? runChecker(config, "deepseek", execFileImpl)
      : Promise.resolve({ ok: false, skipped: true, error: null }),
  ]);

  const codex = codexResult.ok
    ? normalizeUsageSnapshot("codex", codexResult.data, now)
    : buildProviderError("codex", codexResult.error, now);
  const minimax = minimaxResult.ok
    ? normalizeUsageSnapshot("minimax", minimaxResult.data, now)
    : minimaxResult.skipped
      ? createEmptyProviderGroup("minimax", { fetchedAt: now, source: "disabled" })
      : buildProviderError("minimax", minimaxResult.error, now);
  const deepseek = deepseekResult.ok
    ? normalizeUsageSnapshot("deepseek", deepseekResult.data, now)
    : deepseekResult.skipped
      ? createEmptyProviderGroup("deepseek", { fetchedAt: now, source: "disabled" })
      : buildProviderError("deepseek", deepseekResult.error, now);

  const providers = { codex, minimax, deepseek };

  let providerError = null;

  for (const [provider, enabled] of Object.entries({ codex: true, minimax: includeMiniMax, deepseek: includeDeepSeek })) {
    const stable = stabilizeProviderGroup(provider, providers[provider], previousSnapshot, enabled, now);
    providers[provider] = stable.group;
    if (stable.error) providerError = providerError || stable.error;
  }

  const statuses = [
    providers.codex && providers.codex.status,
    ...(includeMiniMax ? [providers.minimax && providers.minimax.status] : []),
    ...(includeDeepSeek ? [providers.deepseek && providers.deepseek.status] : []),
  ];
  return {
    fetchedAt: now,
    providers,
    lastError: providerError,
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
