"use strict";

function classifyUrgency(windowOrGroup, { now = Date.now(), staleAfterMs = 30 * 60 * 1000 } = {}) {
  if (!windowOrGroup) return "unknown";
  if (windowOrGroup.status === "error" || windowOrGroup.status === "unavailable") return "unknown";
  if (windowOrGroup.fetchedAt && now - windowOrGroup.fetchedAt > staleAfterMs) return "unknown";
  const windows = Array.isArray(windowOrGroup.windows) ? windowOrGroup.windows : [windowOrGroup];
  let urgency = "unknown";
  for (const window of windows) {
    if (!window) continue;
    const remainingPercent = typeof window.remainingPercent === "number" && Number.isFinite(window.remainingPercent)
      ? window.remainingPercent
      : null;
    if (remainingPercent == null) continue;
    if (remainingPercent < 20) return "tight";
    if (remainingPercent < 50) urgency = urgency === "unknown" ? "watch" : urgency;
    else if (urgency === "unknown") urgency = "normal";
  }
  return urgency;
}

function buildProviderShortText(provider, urgency, group) {
  const firstWindow = group && Array.isArray(group.windows) ? group.windows[0] : null;
  if (urgency === "tight") return firstWindow && firstWindow.label ? `${firstWindow.label} running tight` : "running tight";
  if (urgency === "watch") return firstWindow && firstWindow.label ? `${firstWindow.label} worth watching` : "worth watching";
  if (urgency === "normal") return "steady";
  return provider === "minimax" ? "MiniMax not connected" : "not connected";
}

function buildFallbackSummary(snapshot, options = {}) {
  const providerHints = {};
  const groups = snapshot && snapshot.providers ? snapshot.providers : {};
  let overallStatus = "unknown";
  for (const [provider, group] of Object.entries(groups)) {
    const urgency = classifyUrgency(group, options);
    providerHints[provider] = {
      urgency,
      shortText: buildProviderShortText(provider, urgency, group),
    };
    if (urgency === "tight") overallStatus = "tight";
    else if (urgency === "watch" && overallStatus !== "tight") overallStatus = "watch";
    else if (urgency === "normal" && overallStatus === "unknown") overallStatus = "normal";
  }
  return {
    overallStatus,
    summaryText:
      overallStatus === "tight" ? "One usage window is running tight." :
      overallStatus === "watch" ? "One usage window is worth watching." :
      overallStatus === "normal" ? "Usage looks steady." :
      "Usage data is incomplete right now.",
    providerHints,
  };
}

module.exports = {
  classifyUrgency,
  buildFallbackSummary,
};
