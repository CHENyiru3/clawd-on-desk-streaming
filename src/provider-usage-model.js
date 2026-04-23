"use strict";

const PROVIDER_ORDER = Object.freeze(["codex", "minimax"]);

const PROVIDER_WINDOW_MAP = Object.freeze({
  codex: [
    { key: "fiveHour", label: "5h", sourceKeys: ["primary"], sourceNames: ["5h"] },
    { key: "weekly", label: "wk", sourceKeys: ["secondary"], sourceNames: ["weekly"] },
  ],
  minimax: [
    { key: "fiveHour", label: "5h", sourceKeys: ["primary"], sourceNames: ["5h", "five_hour"] },
  ],
});

function providerLabel(provider) {
  if (provider === "codex") return "Codex";
  if (provider === "minimax") return "MiniMax";
  return provider;
}

function normalizePercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function statusFromRemaining(remainingPercent) {
  if (typeof remainingPercent !== "number" || !Number.isFinite(remainingPercent)) return "unavailable";
  if (remainingPercent < 20) return "critical";
  if (remainingPercent < 50) return "warning";
  return "ok";
}

function createUsageWindow(overrides = {}) {
  let remainingPercent = normalizePercent(overrides.remainingPercent);
  let usedPercent = normalizePercent(overrides.usedPercent);
  if (usedPercent === null && remainingPercent !== null) usedPercent = normalizePercent(100 - remainingPercent);
  if (remainingPercent === null && usedPercent !== null) remainingPercent = normalizePercent(100 - usedPercent);
  return {
    key: overrides.key || "unknown",
    label: overrides.label || overrides.key || "N/A",
    status: overrides.status || statusFromRemaining(remainingPercent),
    usedPercent,
    remainingPercent,
    detailText: typeof overrides.detailText === "string" ? overrides.detailText : null,
    resetText: typeof overrides.resetText === "string" ? overrides.resetText : null,
  };
}

function createEmptyProviderGroup(provider, overrides = {}) {
  const windows = (PROVIDER_WINDOW_MAP[provider] || []).map((spec) => createUsageWindow({
    key: spec.key,
    label: spec.label,
    status: "unavailable",
    detailText: provider === "minimax" ? "Not connected" : null,
  }));
  return {
    provider,
    label: providerLabel(provider),
    status: "unavailable",
    fetchedAt: null,
    source: null,
    error: null,
    warnings: [],
    windows,
    ...overrides,
  };
}

function cloneProviderGroup(group) {
  if (!group || typeof group !== "object") return group;
  return {
    ...group,
    warnings: Array.isArray(group.warnings) ? group.warnings.slice() : [],
    windows: Array.isArray(group.windows) ? group.windows.map((windowInfo) => windowInfo ? { ...windowInfo } : windowInfo) : [],
  };
}

function providerGroupHasUsableData(group) {
  if (!group || !Array.isArray(group.windows)) return false;
  return group.windows.some((windowInfo) => windowInfo
    && ((typeof windowInfo.remainingPercent === "number" && Number.isFinite(windowInfo.remainingPercent))
      || (typeof windowInfo.usedPercent === "number" && Number.isFinite(windowInfo.usedPercent))));
}

function markProviderGroupStale(group, warning, fetchedAt = Date.now()) {
  const next = cloneProviderGroup(group) || null;
  if (!next) return null;
  next.status = "stale";
  next.fetchedAt = fetchedAt;
  next.error = typeof warning === "string" && warning.trim() ? warning.trim() : next.error;
  next.warnings = Array.isArray(next.warnings) ? next.warnings.slice() : [];
  if (next.error && !next.warnings.includes(next.error)) next.warnings.push(next.error);
  next.windows = Array.isArray(next.windows)
    ? next.windows.map((windowInfo) => windowInfo ? { ...windowInfo, status: "stale" } : windowInfo)
    : [];
  return next;
}

function createEmptyUsageSnapshot() {
  return {
    fetchedAt: null,
    stale: true,
    providers: {
      codex: createEmptyProviderGroup("codex"),
      minimax: createEmptyProviderGroup("minimax"),
    },
    hermesSummary: {
      overallStatus: "unknown",
      summaryText: null,
      providerHints: {},
    },
    hermesStatus: {
      status: "offline",
    },
  };
}

function findWindowSpec(provider, rawWindow, windowKey) {
  const specs = PROVIDER_WINDOW_MAP[provider] || [];
  if (windowKey) {
    const byKey = specs.find((spec) => spec.sourceKeys.includes(windowKey));
    if (byKey) return byKey;
  }
  const rawName = rawWindow && typeof rawWindow.name === "string" ? rawWindow.name.toLowerCase() : "";
  return specs.find((spec) => spec.sourceNames.includes(rawName)) || null;
}

function buildWindowFromRaw(provider, spec, rawWindow, extras) {
  if (!rawWindow || typeof rawWindow !== "object") {
    return createUsageWindow({
      key: spec.key,
      label: spec.label,
      status: "unavailable",
      detailText: provider === "minimax" ? "Not connected" : null,
    });
  }

  let remainingPercent = normalizePercent(rawWindow.remaining_percent);
  let usedPercent = normalizePercent(rawWindow.used_percent);
  if (usedPercent === null && remainingPercent !== null) usedPercent = normalizePercent(100 - remainingPercent);
  if (remainingPercent === null && usedPercent !== null) remainingPercent = normalizePercent(100 - usedPercent);
  const detailText = typeof rawWindow.detail_text === "string" ? rawWindow.detail_text : null;

  return createUsageWindow({
    key: spec.key,
    label: spec.label,
    usedPercent,
    remainingPercent,
    status: statusFromRemaining(remainingPercent),
    detailText,
    resetText: rawWindow.reset_description || rawWindow.resets_at || null,
  });
}

function rollupProviderStatus(group, explicitStatus) {
  if (explicitStatus === "error" || explicitStatus === "unavailable" || explicitStatus === "stale") return explicitStatus;
  let result = "unavailable";
  for (const window of group.windows || []) {
    if (!window) continue;
    if (window.status === "critical") return "critical";
    if (window.status === "warning") result = "warning";
    else if (window.status === "ok" && result === "unavailable") result = "ok";
  }
  return result;
}

function normalizeUsageSnapshot(provider, rawSnapshot, now = Date.now()) {
  if (!rawSnapshot || typeof rawSnapshot !== "object") {
    return createEmptyProviderGroup(provider, {
      status: "error",
      error: "Provider usage snapshot missing.",
      fetchedAt: now,
    });
  }

  const specs = PROVIDER_WINDOW_MAP[provider] || [];
  const rawWindows = rawSnapshot.windows && typeof rawSnapshot.windows === "object" ? rawSnapshot.windows : {};
  const extras = rawSnapshot.extras && typeof rawSnapshot.extras === "object" ? rawSnapshot.extras : {};
  const bySpecKey = new Map();

  for (const [windowKey, rawWindow] of Object.entries(rawWindows)) {
    const spec = findWindowSpec(provider, rawWindow, windowKey);
    if (spec) bySpecKey.set(spec.key, buildWindowFromRaw(provider, spec, rawWindow, extras));
  }

  const windows = specs.map((spec) => bySpecKey.get(spec.key) || createUsageWindow({
    key: spec.key,
    label: spec.label,
    status: "unavailable",
    detailText: provider === "minimax" ? "Not connected" : null,
  }));

  const explicitStatus = typeof rawSnapshot.status === "string" ? rawSnapshot.status : null;
  const group = createEmptyProviderGroup(provider, {
    fetchedAt: now,
    source: typeof rawSnapshot.source === "string" ? rawSnapshot.source : null,
    error: typeof rawSnapshot.error === "string" ? rawSnapshot.error : null,
    warnings: Array.isArray(rawSnapshot.warnings) ? rawSnapshot.warnings.slice() : [],
    windows,
  });
  group.status = rollupProviderStatus(group, explicitStatus);
  return group;
}

function mergeUsageSnapshot(baseSnapshot, providerGroups, hermesSummary, fetchedAt) {
  const snapshot = createEmptyUsageSnapshot();
  snapshot.fetchedAt = fetchedAt || Date.now();
  snapshot.stale = false;
  for (const provider of PROVIDER_ORDER) {
    if (providerGroups && providerGroups[provider]) snapshot.providers[provider] = providerGroups[provider];
    else if (baseSnapshot && baseSnapshot.providers && baseSnapshot.providers[provider]) snapshot.providers[provider] = baseSnapshot.providers[provider];
  }
  if (hermesSummary && typeof hermesSummary === "object") {
    snapshot.hermesSummary = {
      overallStatus: hermesSummary.overallStatus || "unknown",
      summaryText: hermesSummary.summaryText || null,
      providerHints: hermesSummary.providerHints && typeof hermesSummary.providerHints === "object"
        ? { ...hermesSummary.providerHints }
        : {},
    };
  }
  if (baseSnapshot && baseSnapshot.hermesStatus && typeof baseSnapshot.hermesStatus === "object") {
    snapshot.hermesStatus = { ...baseSnapshot.hermesStatus };
  }
  return snapshot;
}

function withHermesStatus(baseSnapshot, status) {
  const snapshot = baseSnapshot && typeof baseSnapshot === "object"
    ? {
        ...baseSnapshot,
        providers: baseSnapshot.providers ? { ...baseSnapshot.providers } : {},
        hermesSummary: baseSnapshot.hermesSummary && typeof baseSnapshot.hermesSummary === "object"
          ? {
              ...baseSnapshot.hermesSummary,
              providerHints: {
                ...((baseSnapshot.hermesSummary && baseSnapshot.hermesSummary.providerHints) || {}),
              },
            }
          : undefined,
      }
    : createEmptyUsageSnapshot();
  snapshot.hermesStatus = { status: status || "offline" };
  return snapshot;
}

module.exports = {
  PROVIDER_ORDER,
  PROVIDER_WINDOW_MAP,
  createUsageWindow,
  createEmptyProviderGroup,
  createEmptyUsageSnapshot,
  cloneProviderGroup,
  providerGroupHasUsableData,
  markProviderGroupStale,
  normalizeUsageSnapshot,
  mergeUsageSnapshot,
  withHermesStatus,
  providerLabel,
  statusFromRemaining,
};
