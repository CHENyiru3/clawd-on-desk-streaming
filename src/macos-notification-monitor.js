"use strict";

module.exports = function createMacosNotificationMonitor(options = {}) {
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};

  let status = process.platform === "darwin" ? "unsupported" : "unsupported";

  return {
    start() {
      onStatus(status);
      return { ok: false, status };
    },
    stop() {},
    getStatus() {
      return status;
    },
  };
};
