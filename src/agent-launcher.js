"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AGENT_LAUNCHER_TRIGGER_LIST } = require("./prefs");

const COMMAND_MAX = 256;
const CWD_MAX = 4096;
let _lastMacLauncherWindowRequested = false;

function shouldFocusFallbackLaunch(trigger) {
  return trigger === "focusFallback" || trigger === "tripleAndFocus";
}

function shouldTripleClickLaunch(trigger) {
  return trigger === "tripleClick" || trigger === "tripleAndFocus";
}

/** @returns {string|null} error message or null if ok */
function validateLauncherCommand(command) {
  if (typeof command !== "string") return "command must be a string";
  const s = command.trim();
  if (!s) return "command must not be empty";
  if (s.length > COMMAND_MAX) return `command exceeds ${COMMAND_MAX} characters`;
  if (/[\n\r\x00-\x1f;|&`$<>]/.test(s)) return "command contains disallowed characters";
  return null;
}

/** @returns {{ cwd: string, err: string|null }} */
function resolveLauncherCwd(cwdRaw) {
  const home = os.homedir();
  if (cwdRaw == null || typeof cwdRaw !== "string" || !cwdRaw.trim()) {
    return { cwd: home, err: null };
  }
  const s = cwdRaw.trim();
  if (s.length > CWD_MAX) return { cwd: home, err: null };
  if (/[\n\r\x00-\x1f]/.test(s)) return { cwd: home, err: "cwd contains control characters" };
  if (/\.\./.test(s)) return { cwd: home, err: "cwd must not contain .." };
  const n = path.normalize(s);
  try {
    if (!fs.existsSync(n) || !fs.statSync(n).isDirectory()) {
      return { cwd: home, err: null };
    }
    return { cwd: n, err: null };
  } catch {
    return { cwd: home, err: null };
  }
}

function buildMacDoScript(appName, escapedInner) {
  const safeApp = appName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `tell application "${safeApp}" to do script "${escapedInner}"`;
}

function tryMacOsascriptDoScript(appName, escapedInner) {
  const script = buildMacDoScript(appName, escapedInner);
  execFileSync("osascript", ["-e", script], { stdio: "ignore", timeout: 15_000 });
}

function tryReuseMacTerminalWindow(execFileSyncImpl = execFileSync) {
  const script = `
    tell application "Terminal"
      if not running then return "not_running"
      if (count of windows) is 0 then return "no_window"
      reopen
      activate
      return "reused"
    end tell`;
  try {
    const out = execFileSyncImpl("osascript", ["-e", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    });
    return String(out || "").trim() === "reused";
  } catch {
    return false;
  }
}

function macLaunchTerminalDefault({ cwd, command, execFileSyncImpl = execFileSync }) {
  if (_lastMacLauncherWindowRequested && tryReuseMacTerminalWindow(execFileSyncImpl)) {
    return { ok: true, reused: true };
  }
  const inner = `cd ${shellQuoteBash(cwd)} && ${command.trim()}`;
  const escapedInner = inner.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  try {
    const script = buildMacDoScript("Terminal", escapedInner);
    execFileSyncImpl("osascript", ["-e", script], { stdio: "ignore", timeout: 15_000 });
    _lastMacLauncherWindowRequested = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err && err.message) || String(err) };
  }
}

/**
 * Spawn the default graphical terminal with `command` run inside `cwd` (best-effort per OS).
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function launchAgentTerminal({ command, cwd: cwdRaw, _platform = process.platform, _execFileSync = execFileSync, _spawn = spawn } = {}) {
  const cmdErr = validateLauncherCommand(command);
  if (cmdErr) return { ok: false, message: cmdErr };

  const { cwd, err: cwdWarn } = resolveLauncherCwd(cwdRaw);
  if (cwdWarn) console.warn("Clawd: agent launcher cwd:", cwdWarn);

  const platform = _platform;
  if (platform === "darwin") {
    return macLaunchTerminalDefault({ cwd, command, execFileSyncImpl: _execFileSync });
  }

  if (platform === "win32") {
    const cwdWin = cwd.replace(/\//g, "\\");
    const args = ["/c", "start", "", "/D", cwdWin, "cmd", "/k", command.trim()];
    try {
      const child = _spawn("cmd.exe", args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
    } catch (err) {
      return { ok: false, message: (err && err.message) || String(err) };
    }
    return { ok: true };
  }

  // Linux and other Unix: try common terminal emulators
  const bashLine = `cd ${shellQuoteBash(cwd)} && exec ${command.trim()}`;
  const candidates = [
    { bin: "x-terminal-emulator", args: ["-e", "bash", "-lc", bashLine] },
    { bin: "gnome-terminal", args: ["--", "bash", "-lc", bashLine] },
    { bin: "konsole", args: ["-e", "bash", "-lc", bashLine] },
    { bin: "xfce4-terminal", args: ["-e", "bash", "-lc", bashLine] },
    { bin: "kitty", args: ["bash", "-lc", bashLine] },
  ];
  for (const { bin, args } of candidates) {
    const which = spawnWhichSync(bin);
    if (!which) continue;
    try {
      const child = _spawn(which, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { ok: true };
    } catch {
      continue;
    }
  }
  return {
    ok: false,
    message: "No supported terminal found (tried x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, kitty).",
  };
}

function shellQuoteBash(p) {
  if (!p) return "''";
  return `'${String(p).replace(/'/g, `'\"'\"'`)}'`;
}

function spawnWhichSync(bin) {
  const paths = (process.env.PATH || "").split(path.delimiter);
  for (const dir of paths) {
    const full = path.join(dir, bin);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    } catch {
      continue;
    }
  }
  return null;
}

function validateAgentLauncherUpdate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "error", message: "agentLauncher must be a plain object" };
  }
  const required = ["enabled", "command", "cwd", "trigger"];
  for (const k of required) {
    if (!Object.prototype.hasOwnProperty.call(value, k)) {
      return { status: "error", message: `agentLauncher missing field: ${k}` };
    }
  }
  if (typeof value.enabled !== "boolean") {
    return { status: "error", message: "agentLauncher.enabled must be a boolean" };
  }
  const err = validateLauncherCommand(value.command);
  if (err) return { status: "error", message: `agentLauncher.command: ${err}` };
  if (typeof value.cwd !== "string") {
    return { status: "error", message: "agentLauncher.cwd must be a string" };
  }
  if (value.cwd.length > CWD_MAX) {
    return { status: "error", message: `agentLauncher.cwd exceeds ${CWD_MAX} characters` };
  }
  if (/[\n\r\x00-\x1f]/.test(value.cwd)) {
    return { status: "error", message: "agentLauncher.cwd contains control characters" };
  }
  const trimmed = value.cwd.trim();
  if (trimmed && /\.\./.test(trimmed)) {
    return { status: "error", message: "agentLauncher.cwd must not contain .." };
  }
  if (!AGENT_LAUNCHER_TRIGGER_LIST.includes(value.trigger)) {
    return {
      status: "error",
      message: `agentLauncher.trigger must be one of: ${AGENT_LAUNCHER_TRIGGER_LIST.join(", ")}`,
    };
  }
  return { status: "ok" };
}

module.exports = {
  launchAgentTerminal,
  validateLauncherCommand,
  validateAgentLauncherUpdate,
  shouldFocusFallbackLaunch,
  shouldTripleClickLaunch,
  _resetMacLauncherStateForTests() {
    _lastMacLauncherWindowRequested = false;
  },
};
