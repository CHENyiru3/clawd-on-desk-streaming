"use strict";
const fs = require("fs");
const path = require("path");

// ── Startup log (written to userData, cleared on each launch) ────────────────
const LOG_FILENAME = "startup-debug.log";

/**
 * @param {string} userData
 * @returns {string} log file path
 */
function getLogPath(userData) {
  return path.join(userData, LOG_FILENAME);
}

/**
 * Append a timestamped line to the startup log file.
 * @param {string} userData
 * @param {string} msg
 */
function log(userData, msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(getLogPath(userData), line, "utf8");
  } catch (_) {
    // best-effort
  }
}

/**
 * Clear the startup log on each launch so it reflects fresh boot only.
 * @param {string} userData
 */
function clearLog(userData) {
  try {
    fs.writeFileSync(getLogPath(userData), "", "utf8");
  } catch (_) {
    // best-effort
  }
}

/**
 * Log all startup checkpoint milestones.
 * @param {string} userData
 * @param {string} milestone
 * @param {object} [extra]
 */
function milestone(userData, milestone, extra) {
  let msg = `[MILESTONE] ${milestone}`;
  if (extra) {
    const entries = Object.entries(extra)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    msg += ` ${entries}`;
  }
  log(userData, msg);
}

/**
 * Install global exception/rejection handlers that write to userData.
 * Safe to call multiple times.
 * @param {string} userData
 */
function installGlobalHandlers(userData) {
  const handler = (type, err) => {
    const msg =
      `[${type}] ${err && err.message ? err.message : String(err)}\n` +
      (err && err.stack ? err.stack : "");
    log(userData, msg);
  };
  process.on("uncaughtException", (e) => handler("UncaughtException", e));
  process.on("unhandledRejection", (reason) => handler("UnhandledRejection", reason));
}

/**
 * True when CLAWD_DEBUG_STARTUP=1 env var is set.
 * @returns {boolean}
 */
function isDebugMode() {
  return process.env.CLAWD_DEBUG_STARTUP === "1";
}

module.exports = { log, clearLog, milestone, installGlobalHandlers, isDebugMode, getLogPath };
