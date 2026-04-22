"use strict";

const ALIGN_MINUTES = Object.freeze([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57]);

function computeNextRun(nowDate) {
  const next = new Date(nowDate.getTime());
  next.setSeconds(0, 0);
  for (const minute of ALIGN_MINUTES) {
    const candidate = new Date(next.getTime());
    candidate.setMinutes(minute, 0, 0);
    if (candidate.getTime() > nowDate.getTime()) return candidate;
  }
  next.setHours(next.getHours() + 1, ALIGN_MINUTES[0], 0, 0);
  return next;
}

module.exports = function createProviderUsageRuntime(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const setTimer = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimer = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const fetchSnapshots = typeof options.fetchSnapshots === "function" ? options.fetchSnapshots : async () => ({ lastResult: "error", providers: {} });
  const summarizeSnapshots = typeof options.summarizeSnapshots === "function" ? options.summarizeSnapshots : async () => ({ ok: false });
  const onUsageUpdate = typeof options.onUsageUpdate === "function" ? options.onUsageUpdate : () => {};
  const onStatusChange = typeof options.onStatusChange === "function" ? options.onStatusChange : () => {};
  const shouldDefer = typeof options.shouldDefer === "function" ? options.shouldDefer : () => false;

  let timer = null;
  let bootstrapTimer = null;
  let running = false;
  let busy = false;
  let snapshot = null;
  let status = {
    running: false,
    nextRunAt: null,
    lastRunAt: null,
    lastReason: null,
    lastResult: "unknown",
    lastError: null,
  };

  function emitStatus() {
    onStatusChange({ ...status });
  }

  async function run(reason, force = false) {
    if ((!running && !force) || busy) return;
    if (!force && shouldDefer()) {
      status = { ...status, nextRunAt: Date.now() + 60 * 1000 };
      emitStatus();
      timer = setTimer(() => {
        timer = null;
        run("deferred");
      }, 60 * 1000);
      return;
    }
    busy = true;
    status = {
      ...status,
      lastRunAt: now(),
      lastReason: reason || "scheduled",
    };
    emitStatus();
    try {
      const fetched = await fetchSnapshots({ reason, now: new Date(status.lastRunAt) });
      const summarized = await summarizeSnapshots({ snapshot: fetched, reason, now: new Date(status.lastRunAt) });
      snapshot = summarized && summarized.snapshot ? summarized.snapshot : fetched;
      if (snapshot) onUsageUpdate(snapshot);
      status = {
        ...status,
        lastResult: summarized && summarized.lastResult ? summarized.lastResult : (fetched && fetched.lastResult ? fetched.lastResult : "ok"),
        lastError: summarized && summarized.lastError ? summarized.lastError : null,
      };
    } catch (err) {
      status = {
        ...status,
        lastResult: "error",
        lastError: err && err.message ? err.message : "Provider usage refresh failed.",
      };
    } finally {
      busy = false;
      if (running) scheduleNext();
      else emitStatus();
    }
  }

  function scheduleNext() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    const nextRun = computeNextRun(new Date(now()));
    status = {
      ...status,
      running,
      nextRunAt: nextRun.getTime(),
    };
    emitStatus();
    timer = setTimer(() => {
      timer = null;
      run("scheduled");
    }, Math.max(1, nextRun.getTime() - now()));
  }

  function start() {
    if (running) return;
    running = true;
    status = { ...status, running: true };
    emitStatus();
    if (bootstrapTimer) clearTimer(bootstrapTimer);
    bootstrapTimer = setTimer(() => {
      bootstrapTimer = null;
      run("bootstrap");
    }, 3000);
    scheduleNext();
  }

  function stop() {
    running = false;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    if (bootstrapTimer) {
      clearTimer(bootstrapTimer);
      bootstrapTimer = null;
    }
    status = {
      ...status,
      running: false,
      nextRunAt: null,
    };
    emitStatus();
  }

  function reschedule() {
    if (!running) {
      emitStatus();
      return;
    }
    scheduleNext();
  }

  function triggerNow(reason = "manual") {
    return run(reason, true);
  }

  return {
    start,
    stop,
    reschedule,
    triggerNow,
    getStatus: () => ({ ...status }),
    getSnapshot: () => snapshot,
  };
};

module.exports.__test = {
  computeNextRun,
};
