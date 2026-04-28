"use strict";

const os = require("os");
const path = require("path");

function uniquePathEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function defaultUserCliPaths(platform = process.platform, home = os.homedir()) {
  if (platform === "win32") return [];
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
}

function buildCliPath(basePath = process.env.PATH || "", options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || os.homedir();
  const delimiter = options.delimiter || path.delimiter;
  const baseEntries = typeof basePath === "string" && basePath
    ? basePath.split(delimiter)
    : [];
  return uniquePathEntries([
    ...defaultUserCliPaths(platform, home),
    ...baseEntries,
  ]).join(delimiter);
}

function buildCliEnv(baseEnv = process.env, overrides = {}) {
  const env = { ...baseEnv, ...overrides };
  env.PATH = buildCliPath(env.PATH || "", {
    platform: process.platform,
    home: os.homedir(),
    delimiter: path.delimiter,
  });
  return env;
}

module.exports = {
  buildCliEnv,
  buildCliPath,
  defaultUserCliPaths,
};
