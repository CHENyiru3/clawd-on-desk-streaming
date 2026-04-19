// src/focus.js — Terminal focus system (macOS osascript only)

const http = require("http");
const { execFile } = require("child_process");

const MAC_FOCUS_THROTTLE_MS = 1500;
const MAC_FOCUS_TIMEOUT_MS = 1500;
let macFocusInFlight = false;
let macFocusLastRunAt = 0;
let macFocusLastPid = null;
let macQueuedFocusRequest = null;
let macFocusCooldownTimer = null;

function clearMacFocusCooldownTimer() {
  if (macFocusCooldownTimer) {
    clearTimeout(macFocusCooldownTimer);
    macFocusCooldownTimer = null;
  }
}

function scheduleQueuedMacFocus(delayMs) {
  clearMacFocusCooldownTimer();
  if (!macQueuedFocusRequest) return;
  macFocusCooldownTimer = setTimeout(() => {
    macFocusCooldownTimer = null;
    flushQueuedMacFocus();
  }, Math.max(0, delayMs));
}

function flushQueuedMacFocus() {
  if (!macQueuedFocusRequest || macFocusInFlight) return;
  const elapsed = Date.now() - macFocusLastRunAt;
  const remaining = Math.max(0, MAC_FOCUS_THROTTLE_MS - elapsed);
  if (remaining > 0) {
    scheduleQueuedMacFocus(remaining);
    return;
  }
  const nextRequest = macQueuedFocusRequest;
  macQueuedFocusRequest = null;
  executeMacFocusRequest(nextRequest);
}

function executeMacFocusRequest(request) {
  macFocusInFlight = true;
  macFocusLastRunAt = Date.now();
  macFocusLastPid = request.sourcePid;

  const finalize = (result) => {
    macFocusInFlight = false;
    if (typeof request.onResult === "function") {
      try { request.onResult(result); } catch {}
    }
    if (macQueuedFocusRequest) flushQueuedMacFocus();
  };

  focusTerminalWindowLegacy.call(request.ctx, request.sourcePid, request.cwd, finalize, request.pidChain);
  scheduleTerminalTabFocus(request.editor, request.pidChain);
}

function requestMacFocus(sourcePid, cwd, editor, pidChain, onResult, ctx) {
  const elapsed = Date.now() - macFocusLastRunAt;
  const inCooldown = elapsed < MAC_FOCUS_THROTTLE_MS;
  if (inCooldown && macFocusLastPid === sourcePid) return;

  const request = { sourcePid, cwd, editor, pidChain, onResult, ctx };
  if (macFocusInFlight) {
    macQueuedFocusRequest = request;
    return;
  }
  if (inCooldown) {
    macQueuedFocusRequest = request;
    scheduleQueuedMacFocus(MAC_FOCUS_THROTTLE_MS - elapsed);
    return;
  }
  macQueuedFocusRequest = null;
  clearMacFocusCooldownTimer();
  executeMacFocusRequest(request);
}

function scheduleTerminalTabFocus(editor, pidChain) {
  if (!editor || !pidChain || !pidChain.length) return;
  setTimeout(() => {
    const body = JSON.stringify({ pids: pidChain });
    for (let port = 23456; port <= 23460; port++) {
      const tabReq = http.request({
        hostname: "127.0.0.1", port, path: "/focus-tab", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 300,
      }, () => {});
      tabReq.on("error", () => {});
      tabReq.on("timeout", () => tabReq.destroy());
      tabReq.end(body);
    }
  }, 800);
}

function focusTerminalWindow(sourcePid, cwd, editor, pidChain) {
  if (!sourcePid) return;
  requestMacFocus(sourcePid, cwd, editor, pidChain, null, this);
}

function focusTerminalWindowLegacy(sourcePid, cwd, onDone, pidChain) {
  const pidCandidates = [sourcePid];
  if (Array.isArray(pidChain)) {
    for (const pid of pidChain) {
      if (!Number.isFinite(pid) || pid <= 0 || pidCandidates.includes(pid)) continue;
      pidCandidates.push(pid);
      if (pidCandidates.length >= 3) break;
    }
  }
  const applePidList = pidCandidates.join(", ");

  let petX = 0, petY = 0;
  if (this && this.win && !this.win.isDestroyed()) {
    try { [petX, petY] = this.win.getPosition(); } catch {}
  }
  const gap = 8;
  const script = `
    set clawdStatus to "no_process"
    tell application "System Events"
      repeat with targetPid in {${applePidList}}
        set pidValue to contents of targetPid
        set pList to every process whose unix id is pidValue
        if (count of pList) > 0 then
          try
            set procName to name of item 1 of pList
            tell process procName
              set w to count of windows
              if w > 0 then
                set winBounds to bounds of window 1
                set termWidth to (item 3 of winBounds) - (item 1 of winBounds)
                set termHeight to (item 4 of winBounds) - (item 2 of winBounds)
                set newX to (${petX} - termWidth - ${gap})
                if newX < 0 then set newX to 0
                set bounds of window 1 to {newX, ${petY}, newX + termWidth, ${petY} + termHeight}
                set frontmost to true
                return "ok:" & (pidValue as text)
              else
                set clawdStatus to "no_window:" & (pidValue as text)
              end if
            end tell
          on error
            set clawdStatus to "no_window:" & (pidValue as text)
          end try
        end if
      end repeat
    end tell`;
  execFile("osascript", ["-e", script, "-e", "return clawdStatus"], { timeout: MAC_FOCUS_TIMEOUT_MS }, (err, stdout) => {
    if (err) console.warn("focusTerminal macOS failed:", err.message);
    if (onDone) {
      if (err) onDone({ ok: false, reason: "osascript_failed", message: err.message });
      else {
        const result = String(stdout || "").trim();
        if (result.startsWith("ok:")) onDone({ ok: true, targetPid: Number(result.slice(3)) || sourcePid });
        else if (result.startsWith("no_window:")) onDone({ ok: false, reason: "no_window", targetPid: Number(result.slice(10)) || sourcePid });
        else onDone({ ok: false, reason: "no_process" });
      }
    }
  });
}

function cleanup() {
  clearMacFocusCooldownTimer();
  macQueuedFocusRequest = null;
  macFocusInFlight = false;
}

function runMacFocusCheck(sourcePid, cwd, editor, pidChain) {
  return new Promise((resolve) => {
    focusTerminalWindowLegacy.call(this, sourcePid, cwd, resolve, pidChain);
    scheduleTerminalTabFocus(editor, pidChain);
  });
}

// No-op stubs — previously handled Windows PowerShell persistent process
function initFocusHelper() {}
function killFocusHelper() {}

module.exports = function initFocus(ctx) {
  return {
    initFocusHelper,
    killFocusHelper,
    focusTerminalWindow: focusTerminalWindow.bind(ctx),
    clearMacFocusCooldownTimer,
    cleanup,
    runMacFocusCheck: runMacFocusCheck.bind(ctx),
  };
};
