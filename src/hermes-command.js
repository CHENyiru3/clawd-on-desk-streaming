"use strict";

function normalizeCommandConfig(config = {}) {
  return {
    command: typeof config.command === "string" ? config.command.trim() : "",
    args: Array.isArray(config.args) ? config.args.filter((value) => typeof value === "string" && value.trim()) : [],
    cwd: typeof config.cwd === "string" && config.cwd.trim() ? config.cwd.trim() : undefined,
    timeoutMs: Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 30000,
  };
}

function buildPromptInvocation(config = {}, prompt) {
  const normalized = normalizeCommandConfig(config);
  if (!normalized.command) {
    return {
      command: "",
      args: [],
      cwd: normalized.cwd,
      timeoutMs: normalized.timeoutMs,
      usesStdin: false,
    };
  }
  if (normalized.command === "hermes") {
    return {
      command: normalized.command,
      args: ["chat", "-q", String(prompt || ""), "-Q", ...normalized.args],
      cwd: normalized.cwd,
      timeoutMs: normalized.timeoutMs,
      usesStdin: false,
    };
  }
  return {
    command: normalized.command,
    args: normalized.args.slice(),
    cwd: normalized.cwd,
    timeoutMs: normalized.timeoutMs,
    usesStdin: true,
  };
}

module.exports = {
  normalizeCommandConfig,
  buildPromptInvocation,
};
