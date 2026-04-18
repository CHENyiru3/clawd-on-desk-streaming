"use strict";

function createTranslateBubbleTimer(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const setTimeoutFn = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimeoutFn = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const onExpire = typeof options.onExpire === "function" ? options.onExpire : () => {};

  let timer = null;
  let remainingMs = 0;
  let deadline = 0;
  let paused = false;

  function clear() {
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
    remainingMs = 0;
    deadline = 0;
    paused = false;
  }

  function schedule(ms) {
    clear();
    if (!(ms > 0)) return;
    remainingMs = ms;
    deadline = now() + ms;
    timer = setTimeoutFn(() => {
      timer = null;
      remainingMs = 0;
      deadline = 0;
      paused = false;
      onExpire();
    }, ms);
  }

  function pause() {
    if (paused || !timer) return false;
    clearTimeoutFn(timer);
    timer = null;
    remainingMs = Math.max(0, deadline - now());
    paused = true;
    return true;
  }

  function resume() {
    if (!paused || !(remainingMs > 0)) return false;
    paused = false;
    deadline = now() + remainingMs;
    timer = setTimeoutFn(() => {
      timer = null;
      remainingMs = 0;
      deadline = 0;
      paused = false;
      onExpire();
    }, remainingMs);
    return true;
  }

  function getState() {
    return {
      active: !!timer || paused,
      paused,
      remainingMs: paused ? remainingMs : Math.max(0, deadline - now()),
    };
  }

  return {
    clear,
    schedule,
    pause,
    resume,
    getState,
  };
}

module.exports = {
  createTranslateBubbleTimer,
};
