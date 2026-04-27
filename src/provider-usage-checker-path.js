"use strict";

const fs = require("fs");
const path = require("path");

const ENV_CHECKER_PATH = "CLAWD_PROVIDER_USAGE_CHECKER_SCRIPT";
const REPO_CHECKER_PATH = path.join(__dirname, "..", "scripts", "provider-usage-checker", "scripts", "check_usage.py");

function defaultFileExists(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

function defaultProviderUsageCheckerScriptPath(options = {}) {
  const env = options.env || process.env;
  const fileExists = options.fileExists || defaultFileExists;
  const envPath = env && typeof env[ENV_CHECKER_PATH] === "string" ? env[ENV_CHECKER_PATH].trim() : "";
  const repoPath = options.repoPath || REPO_CHECKER_PATH;
  const candidates = [envPath, repoPath].filter(Boolean);
  return candidates.find((candidate) => fileExists(candidate)) || envPath || repoPath;
}

function resolveProviderUsageCheckerScriptPath(configuredPath, options = {}) {
  const fileExists = options.fileExists || defaultFileExists;
  const configured = typeof configuredPath === "string" ? configuredPath.trim() : "";
  if (configured && fileExists(configured)) return configured;
  const fallback = defaultProviderUsageCheckerScriptPath(options);
  if (fallback && fileExists(fallback)) return fallback;
  return configured || fallback;
}

module.exports = {
  ENV_CHECKER_PATH,
  REPO_CHECKER_PATH,
  defaultProviderUsageCheckerScriptPath,
  resolveProviderUsageCheckerScriptPath,
};
