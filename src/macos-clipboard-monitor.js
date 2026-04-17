"use strict";

module.exports = function createMacosClipboardMonitor(options = {}) {
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? options.pollIntervalMs : 600;
  const readText = typeof options.readText === "function" ? options.readText : () => "";
  const onTextChange = typeof options.onTextChange === "function" ? options.onTextChange : () => {};
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};

  let timer = null;
  let lastText = null;

  function tick() {
    let text = "";
    try {
      text = String(readText() || "");
    } catch {
      onStatus("error");
      return;
    }
    onStatus("ok");
    if (!text || text === lastText) return;
    lastText = text;
    onTextChange({
      text,
      textPreview: text.slice(0, 80),
      at: Date.now(),
    });
  }

  return {
    start() {
      if (timer) return { ok: true, status: "ok" };
      onStatus("ok");
      timer = setInterval(tick, pollIntervalMs);
      tick();
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
