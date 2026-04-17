"use strict";

const isMac = process.platform === "darwin";

const STATUS_UNSUPPORTED = "unsupported";
const STATUS_UNAVAILABLE = "unavailable";
const STATUS_DENIED = "denied";
const STATUS_GRANTED = "granted";
const STATUS_ERROR = "error";

const KEY_DOWN_EVENT = 10;
const FLAGS_CHANGED_EVENT = 12;
const TAP_DISABLED_BY_TIMEOUT = 0xFFFFFFFE;
const TAP_DISABLED_BY_USER_INPUT = 0xFFFFFFFF;

const SESSION_EVENT_TAP = 1;
const HEAD_INSERT_EVENT_TAP = 0;
const LISTEN_ONLY_TAP = 1;
const COMPOSING_IDLE_MS = 1200;

module.exports = function createMacosInputMonitor(options = {}) {
  const setTimeoutFn = options.setTimeout || setTimeout;
  const clearTimeoutFn = options.clearTimeout || clearTimeout;

  let onTypingStart = typeof options.onTypingStart === "function" ? options.onTypingStart : () => {};
  let onTypingStop = typeof options.onTypingStop === "function" ? options.onTypingStop : () => {};
  let onStatusChange = typeof options.onStatusChange === "function" ? options.onStatusChange : () => {};
  let logger = typeof options.logger === "function" ? options.logger : () => {};

  let koffi = null;
  let quartz = null;
  let coreFoundation = null;
  let preflightListenEventAccess = null;
  let requestListenEventAccess = null;
  let eventTapCreate = null;
  let eventTapEnable = null;
  let machPortCreateRunLoopSource = null;
  let machPortInvalidate = null;
  let cfRunLoopGetCurrent = null;
  let cfRunLoopAddSource = null;
  let cfRunLoopRemoveSource = null;
  let cfRelease = null;
  let commonModes = null;

  let registeredCallback = null;
  let callbackType = null;
  let tapPort = null;
  let runLoopSource = null;
  let runLoop = null;
  let stopTimer = null;
  let typingActive = false;
  let running = false;
  let lastStatus = isMac ? STATUS_UNAVAILABLE : STATUS_UNSUPPORTED;

  function emitStatus(nextStatus) {
    if (nextStatus === lastStatus) return;
    lastStatus = nextStatus;
    try { onStatusChange(nextStatus); } catch {}
  }

  function loadNative() {
    if (!isMac) {
      emitStatus(STATUS_UNSUPPORTED);
      return false;
    }
    if (quartz && coreFoundation) return true;
    try {
      koffi = require("koffi");
      quartz = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
      coreFoundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");

      preflightListenEventAccess = quartz.func("bool CGPreflightListenEventAccess(void)");
      requestListenEventAccess = quartz.func("bool CGRequestListenEventAccess(void)");
      callbackType = koffi.proto("void * CGEventTapCallback(void *proxy, uint32 type, void *event, void *userInfo)");

      eventTapCreate = quartz.func("void * CGEventTapCreate(uint32 tap, uint32 place, uint32 options, uint64 eventsOfInterest, CGEventTapCallback *callback, void *userInfo)");
      eventTapEnable = quartz.func("void CGEventTapEnable(void *tap, bool enable)");
      machPortCreateRunLoopSource = coreFoundation.func("void * CFMachPortCreateRunLoopSource(void *allocator, void *port, long order)");
      machPortInvalidate = coreFoundation.func("void CFMachPortInvalidate(void *port)");
      cfRunLoopGetCurrent = coreFoundation.func("void * CFRunLoopGetCurrent(void)");
      cfRunLoopAddSource = coreFoundation.func("void CFRunLoopAddSource(void *rl, void *source, void *mode)");
      cfRunLoopRemoveSource = coreFoundation.func("void CFRunLoopRemoveSource(void *rl, void *source, void *mode)");
      cfRelease = coreFoundation.func("void CFRelease(void *obj)");

      const commonModesSymbol = coreFoundation.symbol("kCFRunLoopCommonModes", "void *");
      commonModes = koffi.decode(commonModesSymbol, "void *");
      emitStatus(preflightListenEventAccess() ? STATUS_GRANTED : STATUS_DENIED);
      return true;
    } catch (err) {
      logger(`macOS input monitor unavailable: ${err && err.message}`);
      emitStatus(STATUS_UNAVAILABLE);
      return false;
    }
  }

  function clearTypingTimer() {
    if (stopTimer) {
      clearTimeoutFn(stopTimer);
      stopTimer = null;
    }
  }

  function scheduleTypingStop() {
    clearTypingTimer();
    stopTimer = setTimeoutFn(() => {
      stopTimer = null;
      if (!typingActive) return;
      typingActive = false;
      try { onTypingStop(); } catch {}
    }, COMPOSING_IDLE_MS);
  }

  function noteTypingEvent() {
    if (!typingActive) {
      typingActive = true;
      try { onTypingStart(); } catch {}
    }
    scheduleTypingStop();
  }

  function getStatus() {
    if (!loadNative()) return lastStatus;
    try {
      const granted = preflightListenEventAccess();
      emitStatus(granted ? STATUS_GRANTED : STATUS_DENIED);
      return lastStatus;
    } catch {
      emitStatus(STATUS_ERROR);
      return lastStatus;
    }
  }

  function requestPermission() {
    if (!loadNative()) return lastStatus === STATUS_GRANTED;
    try {
      const granted = requestListenEventAccess();
      emitStatus(granted ? STATUS_GRANTED : STATUS_DENIED);
      return granted;
    } catch (err) {
      logger(`macOS input monitor request failed: ${err && err.message}`);
      emitStatus(STATUS_ERROR);
      return false;
    }
  }

  function stop() {
    clearTypingTimer();
    if (typingActive) {
      typingActive = false;
      try { onTypingStop(); } catch {}
    }
    running = false;
    if (runLoop && runLoopSource && commonModes) {
      try { cfRunLoopRemoveSource(runLoop, runLoopSource, commonModes); } catch {}
    }
    if (runLoopSource) {
      try { cfRelease(runLoopSource); } catch {}
      runLoopSource = null;
    }
    if (tapPort) {
      try { machPortInvalidate(tapPort); } catch {}
      try { cfRelease(tapPort); } catch {}
      tapPort = null;
    }
    if (registeredCallback && koffi) {
      try { koffi.unregister(registeredCallback); } catch {}
      registeredCallback = null;
    }
    runLoop = null;
  }

  function start() {
    if (running) return { ok: true, status: getStatus() };
    if (!loadNative()) return { ok: false, status: lastStatus };
    if (getStatus() !== STATUS_GRANTED) return { ok: false, status: lastStatus };

    try {
      const mask = (1 << KEY_DOWN_EVENT) | (1 << FLAGS_CHANGED_EVENT);
      registeredCallback = koffi.register((proxy, type, event) => {
        try {
          if (type === TAP_DISABLED_BY_TIMEOUT || type === TAP_DISABLED_BY_USER_INPUT) {
            if (tapPort) eventTapEnable(tapPort, true);
            return event;
          }
          if (type === KEY_DOWN_EVENT) noteTypingEvent();
        } catch {}
        return event;
      }, koffi.pointer(callbackType));

      tapPort = eventTapCreate(
        SESSION_EVENT_TAP,
        HEAD_INSERT_EVENT_TAP,
        LISTEN_ONLY_TAP,
        mask,
        registeredCallback,
        null
      );
      if (!tapPort) {
        emitStatus(STATUS_DENIED);
        stop();
        return { ok: false, status: lastStatus };
      }

      runLoopSource = machPortCreateRunLoopSource(null, tapPort, 0);
      runLoop = cfRunLoopGetCurrent();
      cfRunLoopAddSource(runLoop, runLoopSource, commonModes);
      eventTapEnable(tapPort, true);
      running = true;
      emitStatus(STATUS_GRANTED);
      return { ok: true, status: lastStatus };
    } catch (err) {
      logger(`macOS input monitor start failed: ${err && err.message}`);
      emitStatus(STATUS_ERROR);
      stop();
      return { ok: false, status: lastStatus };
    }
  }

  function setHandlers(nextHandlers = {}) {
    if (typeof nextHandlers.onTypingStart === "function") onTypingStart = nextHandlers.onTypingStart;
    if (typeof nextHandlers.onTypingStop === "function") onTypingStop = nextHandlers.onTypingStop;
    if (typeof nextHandlers.onStatusChange === "function") onStatusChange = nextHandlers.onStatusChange;
    if (typeof nextHandlers.logger === "function") logger = nextHandlers.logger;
  }

  return {
    STATUS_UNSUPPORTED,
    STATUS_UNAVAILABLE,
    STATUS_DENIED,
    STATUS_GRANTED,
    STATUS_ERROR,
    start,
    stop,
    getStatus,
    requestPermission,
    setHandlers,
    get composingIdleMs() { return COMPOSING_IDLE_MS; },
  };
};
