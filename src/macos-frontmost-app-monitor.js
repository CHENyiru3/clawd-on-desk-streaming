"use strict";

const { execFile } = require("child_process");

module.exports = function createMacosFrontmostAppMonitor(options = {}) {
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? options.pollIntervalMs : 1200;
  const execFileImpl = typeof options.execFile === "function" ? options.execFile : execFile;
  const onAppChange = typeof options.onAppChange === "function" ? options.onAppChange : () => {};
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};

  let timer = null;
  let lastAppId = null;

  function poll() {
    const script = [
      "tell application \"System Events\"",
      "set frontProc to first application process whose frontmost is true",
      "set procName to name of frontProc",
      "set procBundle to bundle identifier of frontProc",
      "return procName & linefeed & procBundle",
      "end tell",
    ].join("\n");
    execFileImpl("osascript", ["-e", script], { timeout: 1500 }, (err, stdout) => {
      if (err) {
        onStatus("error");
        return;
      }
      const [appNameRaw, appIdRaw] = String(stdout || "").trim().split(/\r?\n/);
      const appName = appNameRaw || null;
      const appId = appIdRaw || null;
      onStatus("ok");
      if (!appId || appId === lastAppId) return;
      lastAppId = appId;
      onAppChange({
        appId,
        appName,
        at: Date.now(),
      });
    });
  }

  return {
    start() {
      if (timer) return { ok: true, status: "ok" };
      timer = setInterval(poll, pollIntervalMs);
      poll();
      return { ok: true, status: "ok" };
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    getStatus() {
      return timer ? "ok" : "idle";
    },
  };
};
