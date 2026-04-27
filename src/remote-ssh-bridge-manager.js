"use strict";

const { execFile } = require("child_process");
const path = require("path");
const { parsePsLines } = require("./remote-ssh-detector");

const DEFAULT_POLL_MS = 15000;
const DEFAULT_RETRY_MS = 5 * 60 * 1000;

function createRemoteSshBridgeManager(options = {}) {
  const execFileImpl = options.execFile || execFile;
  const getSnapshot = options.getSnapshot || (() => ({}));
  const updateTrustedHosts = options.updateTrustedHosts || (() => {});
  const promptTarget = options.promptTarget || (async () => "deny");
  const deployScript = options.deployScript || path.join(__dirname, "..", "scripts", "remote-deploy.sh");
  const now = options.now || (() => Date.now());
  const pollMs = options.pollMs || DEFAULT_POLL_MS;
  const retryMs = options.retryMs || DEFAULT_RETRY_MS;
  const logger = options.logger || (() => {});

  let timer = null;
  let running = false;
  const inFlight = new Set();
  const prompted = new Set();
  const ensured = new Set();

  function supported() {
    return process.platform === "darwin" || process.platform === "linux";
  }

  function getTrusted() {
    const snap = getSnapshot() || {};
    return snap.remoteSshTrustedHosts && typeof snap.remoteSshTrustedHosts === "object"
      ? snap.remoteSshTrustedHosts
      : {};
  }

  function commitHost(target, patch) {
    const trusted = getTrusted();
    const current = trusted[target] || {};
    const next = {
      ...trusted,
      [target]: {
        ...current,
        ...patch,
      },
    };
    return updateTrustedHosts(next);
  }

  function runPs() {
    return new Promise((resolve) => {
      execFileImpl("ps", ["-axo", "pid=,command="], { timeout: 3000 }, (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(parsePsLines(stdout || ""));
      });
    });
  }

  function runDeploy(target) {
    return new Promise((resolve) => {
      execFileImpl("bash", [deployScript, target, "--auto"], { timeout: 120000 }, (err, stdout, stderr) => {
        const output = `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim();
        if (err) {
          resolve({
            ok: false,
            message: output || err.message || "Remote bridge setup failed.",
          });
          return;
        }
        resolve({ ok: true, message: output || "Remote bridge active." });
      });
    });
  }

  async function ensureTarget(target, { force = false } = {}) {
    if (!target || inFlight.has(target)) return { status: "noop" };
    const snap = getSnapshot() || {};
    if (!snap.remoteSshAutoBridgeEnabled) return { status: "disabled" };
    const trusted = getTrusted();
    const entry = trusted[target];

    if (!entry) {
      if (prompted.has(target)) return { status: "prompted" };
      prompted.add(target);
      let choice = "deny";
      try {
        choice = await promptTarget(target);
      } finally {
        prompted.delete(target);
      }
      if (choice !== "allow") {
        commitHost(target, {
          enabled: false,
          target,
          lastStatus: "denied",
          lastError: null,
          lastCheckedAt: now(),
        });
        return { status: "denied" };
      }
      commitHost(target, {
        enabled: true,
        target,
        prefix: "",
        lastStatus: "pending",
        lastError: null,
        lastCheckedAt: now(),
      });
    } else if (entry.enabled === false) {
      return { status: "disabled-host" };
    } else if (!force) {
      const ageMs = now() - (entry.lastCheckedAt || 0);
      if (entry.lastStatus === "ok" && (ensured.has(target) || ageMs < retryMs)) {
        return { status: "fresh" };
      }
      if (entry.lastStatus === "error" && ageMs < retryMs) {
        return { status: "recent-error" };
      }
    }

    inFlight.add(target);
    commitHost(target, {
      target,
      enabled: true,
      lastStatus: "running",
      lastError: null,
      lastCheckedAt: now(),
    });
    try {
      const result = await runDeploy(target);
      commitHost(target, {
        target,
        enabled: true,
        lastStatus: result.ok ? "ok" : "error",
        lastError: result.ok ? null : result.message,
        lastCheckedAt: now(),
      });
      if (result.ok) ensured.add(target);
      else ensured.delete(target);
      return { status: result.ok ? "ok" : "error", message: result.message };
    } catch (err) {
      commitHost(target, {
        target,
        enabled: true,
        lastStatus: "error",
        lastError: err && err.message ? err.message : "Remote bridge setup failed.",
        lastCheckedAt: now(),
      });
      ensured.delete(target);
      return { status: "error", message: err && err.message };
    } finally {
      inFlight.delete(target);
    }
  }

  async function scanOnce() {
    if (running || !supported()) return;
    const snap = getSnapshot() || {};
    if (!snap.remoteSshAutoBridgeEnabled) return;
    running = true;
    try {
      const targets = await runPs();
      for (const target of targets) {
        await ensureTarget(target);
      }
    } catch (err) {
      logger(`remote ssh scan failed: ${err && err.message}`);
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || !supported()) return;
    void scanOnce();
    timer = setInterval(() => { void scanOnce(); }, pollMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    scanOnce,
    ensureTarget,
    supported,
  };
}

module.exports = createRemoteSshBridgeManager;
