"use strict";

const TWO_HOUR_SLOTS = Object.freeze([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
const ANCHOR_HOURS = Object.freeze([10, 17, 23]);

function buildDailySchedule(baseDate) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const day = baseDate.getDate();
  const hours = new Set([...TWO_HOUR_SLOTS, ...ANCHOR_HOURS]);
  return Array.from(hours)
    .sort((a, b) => a - b)
    .map((hour) => new Date(year, month, day, hour, 0, 0, 0));
}

function computeNextRun(nowDate) {
  const today = buildDailySchedule(nowDate);
  for (const slot of today) {
    if (slot.getTime() > nowDate.getTime()) return slot;
  }
  return buildDailySchedule(new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1))[0];
}

module.exports = function createTimeCheckinRuntime(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const setTimer = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimer = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const generateMessage = typeof options.generateMessage === "function" ? options.generateMessage : async () => ({ status: "error", message: "No generator configured." });
  const onCheckinReady = typeof options.onCheckinReady === "function" ? options.onCheckinReady : () => {};
  const onStatusChange = typeof options.onStatusChange === "function" ? options.onStatusChange : () => {};

  let timer = null;
  let running = false;
  let busy = false;
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
    busy = true;
    status = {
      ...status,
      lastRunAt: now(),
      lastReason: reason || "scheduled",
    };
    emitStatus();
    try {
      const result = await generateMessage({ reason, now: new Date(status.lastRunAt) });
      if (result && result.detail) {
        onCheckinReady(result.detail);
      }
      if (result && result.status === "ok") {
        status = {
          ...status,
          lastResult: "ok",
          lastError: null,
        };
      } else {
        status = {
          ...status,
          lastResult: "error",
          lastError: (result && result.message) || "Time check-in failed.",
        };
      }
    } catch (err) {
      status = {
        ...status,
        lastResult: "error",
        lastError: err && err.message ? err.message : "Time check-in failed.",
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
    scheduleNext();
  }

  function stop() {
    running = false;
    if (timer) {
      clearTimer(timer);
      timer = null;
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

  function getStatus() {
    return { ...status };
  }

  return {
    start,
    stop,
    reschedule,
    triggerNow,
    getStatus,
  };
};

module.exports.__test = {
  buildDailySchedule,
  computeNextRun,
};
