"use strict";

const { isBrowserApp } = require("./macos-browser-activity");

const TRANSIENT_RULES = new Set([
  "frontmostAppReaction",
  "clipboardReaction",
  "notificationReaction",
]);

const RULE_STATE_MAP = {
  frontmostAppReaction: "attention",
  clipboardReaction: "carrying",
  notificationReaction: "notification",
  mediaPlaybackReaction: "listening",
  browserReadingReaction: "reading",
};

const RULE_PRIORITY = {
  notificationReaction: 5,
  clipboardReaction: 4,
  frontmostAppReaction: 3,
  mediaPlaybackReaction: 2,
  browserReadingReaction: 1,
};

module.exports = function createGlobalRulesEngine(options = {}) {
  const nowFn = typeof options.now === "function" ? options.now : () => Date.now();
  const setTimeoutFn = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimeoutFn = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
  const onStatusChange = typeof options.onStatusChange === "function" ? options.onStatusChange : () => {};

  let enabled = !!options.enabled;
  let rules = {
    frontmostAppReaction: true,
    clipboardReaction: true,
    notificationReaction: true,
    presenceWake: true,
    mediaPlaybackReaction: true,
    browserReadingReaction: true,
    ...(options.rules || {}),
  };
  let activeRuleId = null;
  let activeVisualState = null;
  let lastSignalAt = null;
  let lastError = null;
  let collectorStatus = {
    frontmostApp: "idle",
    clipboard: "idle",
    notifications: "unsupported",
    media: "idle",
    browser: "idle",
  };
  let frontmostApp = null;
  let mediaPlaying = false;
  let browserReading = false;
  let decayTimer = null;
  let browserTimer = null;
  let recentPresenceUntil = 0;

  function emit() {
    onStateChange(activeVisualState, getSnapshot());
    onStatusChange(getSnapshot());
  }

  function clearDecayTimer() {
    if (decayTimer) {
      clearTimeoutFn(decayTimer);
      decayTimer = null;
    }
  }

  function clearBrowserTimer() {
    if (browserTimer) {
      clearTimeoutFn(browserTimer);
      browserTimer = null;
    }
  }

  function getSnapshot() {
    return {
      supported: process.platform === "darwin",
      enabled,
      activeRuleId,
      activeVisualState,
      lastSignalAt,
      collectorStatus: { ...collectorStatus },
      lastError,
      presenceActive: recentPresenceUntil > nowFn(),
    };
  }

  function updatePresenceWindow() {
    recentPresenceUntil = nowFn() + 10000;
  }

  function evaluatePersistentRules() {
    if (!enabled) {
      activeRuleId = null;
      activeVisualState = null;
      emit();
      return;
    }
    const candidates = [];
    if (rules.mediaPlaybackReaction && mediaPlaying) candidates.push("mediaPlaybackReaction");
    if (rules.browserReadingReaction && browserReading) candidates.push("browserReadingReaction");
    if (candidates.length === 0) {
      if (!TRANSIENT_RULES.has(activeRuleId)) {
        activeRuleId = null;
        activeVisualState = null;
        emit();
      }
      return;
    }
    candidates.sort((a, b) => RULE_PRIORITY[b] - RULE_PRIORITY[a]);
    const nextRuleId = candidates[0];
    activeRuleId = nextRuleId;
    activeVisualState = RULE_STATE_MAP[nextRuleId] || null;
    emit();
  }

  function activateTransient(ruleId, durationMs) {
    clearDecayTimer();
    activeRuleId = ruleId;
    activeVisualState = RULE_STATE_MAP[ruleId] || null;
    emit();
    decayTimer = setTimeoutFn(() => {
      decayTimer = null;
      activeRuleId = null;
      activeVisualState = null;
      evaluatePersistentRules();
    }, durationMs);
  }

  function handleFrontmostApp(signal) {
    frontmostApp = signal || null;
    if (rules.presenceWake) updatePresenceWindow();
    clearBrowserTimer();
    browserReading = false;
    collectorStatus.frontmostApp = "ok";
    collectorStatus.browser = "ok";
    if (frontmostApp && isBrowserApp(frontmostApp.appId) && rules.browserReadingReaction) {
      browserTimer = setTimeoutFn(() => {
        browserTimer = null;
        browserReading = true;
        evaluatePersistentRules();
      }, 3000);
    }
    if (rules.frontmostAppReaction) {
      activateTransient("frontmostAppReaction", 1200);
    } else {
      evaluatePersistentRules();
    }
  }

  function handleClipboard(signal) {
    collectorStatus.clipboard = "ok";
    lastSignalAt = signal && signal.at ? signal.at : nowFn();
    if (rules.presenceWake) updatePresenceWindow();
    if (rules.clipboardReaction) {
      activateTransient("clipboardReaction", 1600);
    }
  }

  function handleNotification(signal) {
    collectorStatus.notifications = "ok";
    lastSignalAt = signal && signal.at ? signal.at : nowFn();
    if (rules.notificationReaction) {
      activateTransient("notificationReaction", 2500);
    }
  }

  function handleMedia(signal) {
    collectorStatus.media = "ok";
    lastSignalAt = signal && signal.at ? signal.at : nowFn();
    if (rules.presenceWake) updatePresenceWindow();
    mediaPlaying = !!(signal && signal.playing);
    evaluatePersistentRules();
  }

  function notifySignal(signal) {
    if (!signal || !signal.type) return getSnapshot();
    lastSignalAt = signal.at || nowFn();
    switch (signal.type) {
      case "frontmost-app-changed":
        handleFrontmostApp(signal);
        break;
      case "clipboard-text-changed":
        handleClipboard(signal);
        break;
      case "notification":
        handleNotification(signal);
        break;
      case "media-state":
        handleMedia(signal);
        break;
      default:
        break;
    }
    return getSnapshot();
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    if (!enabled) {
      clearDecayTimer();
      clearBrowserTimer();
      activeRuleId = null;
      activeVisualState = null;
      browserReading = false;
      emit();
    } else {
      evaluatePersistentRules();
    }
    return getSnapshot();
  }

  function refreshFromPrefs(snapshot) {
    if (!snapshot) return getSnapshot();
    enabled = snapshot.globalActivityEnabled === true;
    rules = {
      ...rules,
      ...(snapshot.globalActivityRules || {}),
    };
    evaluatePersistentRules();
    return getSnapshot();
  }

  function setCollectorStatus(kind, status, errorMessage = null) {
    if (collectorStatus[kind] !== undefined) collectorStatus[kind] = status;
    lastError = errorMessage || (status === "error" ? "Global activity collector failed." : lastError);
    emit();
  }

  function runTest(ruleId) {
    if (ruleId === "frontmostAppReaction") {
      notifySignal({ type: "frontmost-app-changed", appId: "com.apple.finder", appName: "Finder", at: nowFn() });
      return { status: "ok", message: "Showing app-switch reaction." };
    }
    if (ruleId === "clipboardReaction") {
      notifySignal({ type: "clipboard-text-changed", textPreview: "Sample copied text", at: nowFn() });
      return { status: "ok", message: "Showing clipboard reaction." };
    }
    if (ruleId === "browserReadingReaction") {
      browserReading = true;
      activeRuleId = "browserReadingReaction";
      activeVisualState = "reading";
      emit();
      return { status: "ok", message: "Showing reading reaction." };
    }
    if (ruleId === "mediaPlaybackReaction") {
      mediaPlaying = true;
      activeRuleId = "mediaPlaybackReaction";
      activeVisualState = "listening";
      emit();
      return { status: "ok", message: "Showing listening reaction." };
    }
    return { status: "error", message: `Unknown global activity test: ${ruleId}` };
  }

  function start() {
    enabled = true;
    emit();
    return getSnapshot();
  }

  function stop() {
    clearDecayTimer();
    clearBrowserTimer();
    enabled = false;
    activeRuleId = null;
    activeVisualState = null;
    browserReading = false;
    emit();
    return getSnapshot();
  }

  return {
    start,
    stop,
    getSnapshot,
    getActiveVisualState: () => activeVisualState,
    notifySignal,
    setEnabled,
    refreshFromPrefs,
    setCollectorStatus,
    runTest,
  };
};
