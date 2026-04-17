"use strict";

const { execFile } = require("child_process");

module.exports = function createMacosMediaMonitor(options = {}) {
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? options.pollIntervalMs : 2000;
  const execFileImpl = typeof options.execFile === "function" ? options.execFile : execFile;
  const onPlaybackChange = typeof options.onPlaybackChange === "function" ? options.onPlaybackChange : () => {};
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};

  let timer = null;
  let lastSignature = null;

  function poll() {
    const script = [
      "set outLines to {}",
      "try",
      "tell application \"Spotify\"",
      "if player state is playing then set outLines to {\"Spotify\", name of current track, artist of current track}",
      "end tell",
      "end try",
      "if (count of outLines) is 0 then",
      "try",
      "tell application \"Music\"",
      "if player state is playing then set outLines to {\"Music\", name of current track, artist of current track}",
      "end tell",
      "end try",
      "end if",
      "if (count of outLines) is 0 then",
      "return \"stopped\"",
      "end if",
      "return item 1 of outLines & linefeed & item 2 of outLines & linefeed & item 3 of outLines",
    ].join("\n");
    execFileImpl("osascript", ["-e", script], { timeout: 1800 }, (err, stdout) => {
      if (err) {
        onStatus("error");
        return;
      }
      const text = String(stdout || "").trim();
      onStatus("ok");
      const signature = text || "stopped";
      if (signature === lastSignature) return;
      lastSignature = signature;
      if (!text || text === "stopped") {
        onPlaybackChange({ playing: false, at: Date.now() });
        return;
      }
      const [appName, title, artist] = text.split(/\r?\n/);
      onPlaybackChange({
        playing: true,
        appName: appName || null,
        title: title || null,
        artist: artist || null,
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
