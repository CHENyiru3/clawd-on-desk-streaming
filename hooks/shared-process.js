// hooks/shared-process.js — Shared process tree walk, stdin reader, platform config (macOS only)
// Used by hook scripts (clawd, copilot, gemini, kiro, codebuddy).
// Zero third-party dependencies — only Node built-ins.

// ── Base platform constants (macOS) ───────────────────────────────────────────

const BASE_TERMINAL_NAMES = [
  "terminal", "iterm2", "alacritty", "wezterm-gui", "kitty",
  "hyper", "tabby", "warp", "ghostty",
];

const SYSTEM_BOUNDARY = new Set(["launchd", "init", "systemd"]);

const BASE_EDITOR_MAP = { "code": "code" };

const DEFAULT_EDITOR_PATH_CHECKS = [
  ["visual studio code", "code"],
];

// ── getPlatformConfig ────────────────────────────────────────────────────────
// Returns { terminalNames: Set, systemBoundary: Set, editorMap: Object, editorPathChecks: Array }
// Options:
//   extraTerminals: string[]  (appended to macOS defaults)
//   extraEditors: Object      (merged with macOS defaults)
//   extraEditorPathChecks: [pattern, editor][]  — prepended before defaults

function getPlatformConfig(options) {
  const opts = options || {};

  // Terminal names
  const et = opts.extraTerminals;
  const terminalNames = et && et.length ? new Set([...BASE_TERMINAL_NAMES, ...et]) : new Set(BASE_TERMINAL_NAMES);

  // System boundary
  const systemBoundary = SYSTEM_BOUNDARY;

  // Editor map
  const ee = opts.extraEditors;
  const editorMap = ee ? { ...BASE_EDITOR_MAP, ...ee } : BASE_EDITOR_MAP;

  // Editor path checks
  const editorPathChecks = opts.extraEditorPathChecks
    ? [...opts.extraEditorPathChecks, ...DEFAULT_EDITOR_PATH_CHECKS]
    : DEFAULT_EDITOR_PATH_CHECKS;

  return { terminalNames, systemBoundary, editorMap, editorPathChecks };
}

// ── createPidResolver ────────────────────────────────────────────────────────
// Factory that returns a resolve() function. First call walks the process tree;
// subsequent calls return the cached result.
//
// Options:
//   platformConfig       — result of getPlatformConfig()
//   agentNames           — Set of agent process names
//   agentCmdlineCheck    — (cmdline: string) => boolean  (optional)
//   startPid             — number (default process.ppid)
//   maxDepth             — number (default 8)

function createPidResolver(options) {
  const { platformConfig } = options;
  const { terminalNames, systemBoundary, editorMap, editorPathChecks } = platformConfig;
  const startPid = options.startPid || process.ppid;
  const maxDepth = options.maxDepth || 8;

  const agentNameSet = options.agentNames || null;
  const agentCmdlineCheck = options.agentCmdlineCheck || null;

  let _cached = null;

  return function resolve() {
    if (_cached) return _cached;

    const { execFileSync } = require("child_process");
    let pid = startPid;
    let lastGoodPid = pid;
    let terminalPid = null;
    let detectedEditor = null;
    let agentPid = null;
    const pidChain = [];

    for (let i = 0; i < maxDepth; i++) {
      pidChain.push(pid);
      let name, parentPid;
      try {
        const ppidOut = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8", timeout: 1000 }).trim();
        const commOut = execFileSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8", timeout: 1000 }).trim();
        name = require("path").basename(commOut).toLowerCase();
        if (!detectedEditor) {
          const fullLower = commOut.toLowerCase();
          for (const [pattern, editor] of editorPathChecks) {
            if (fullLower.includes(pattern)) { detectedEditor = editor; break; }
          }
        }
        parentPid = parseInt(ppidOut, 10);
      } catch { break; }

      if (!detectedEditor && editorMap[name]) detectedEditor = editorMap[name];

      // Agent process detection
      if (!agentPid) {
        if (agentNameSet && agentNameSet.has(name)) {
          agentPid = pid;
        } else if (agentCmdlineCheck && name === "node") {
          try {
            const cmdOut = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 500 });
            if (agentCmdlineCheck(cmdOut)) agentPid = pid;
          } catch {}
        }
      }

      if (systemBoundary.has(name)) break;
      if (terminalNames.has(name)) terminalPid = pid;
      lastGoodPid = pid;
      if (!parentPid || parentPid === pid || parentPid <= 1) break;
      pid = parentPid;
    }

    _cached = { stablePid: terminalPid || lastGoodPid, agentPid, detectedEditor, pidChain };
    return _cached;
  };
}

// ── readStdinJson ────────────────────────────────────────────────────────────
// Reads stdin, parses JSON, returns Promise<Object>.
// 400ms timeout + finishOnce protection. Returns {} on parse failure or timeout.

function readStdinJson() {
  return new Promise((resolve) => {
    const chunks = [];
    let done = false;
    let timer = null;

    const onData = (c) => chunks.push(c);
    function finish() {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", finish);
      let payload = {};
      try {
        const raw = Buffer.concat(chunks).toString();
        if (raw.trim()) payload = JSON.parse(raw);
      } catch {}
      resolve(payload);
    }

    process.stdin.on("data", onData);
    process.stdin.on("end", finish);
    timer = setTimeout(finish, 400);
  });
}

module.exports = { getPlatformConfig, createPidResolver, readStdinJson };
