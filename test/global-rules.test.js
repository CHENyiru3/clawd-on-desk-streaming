"use strict";

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert");

const createGlobalRulesEngine = require("../src/global-rules");

describe("global-rules engine", () => {
  let engine;

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    engine = createGlobalRulesEngine({
      enabled: true,
      rules: {
        clipboardReaction: true,
        notificationReaction: true,
        presenceWake: true,
        mediaPlaybackReaction: true,
        browserReadingReaction: true,
      },
    });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("app switch does not create a visible reaction", () => {
    const snap = engine.notifySignal({
      type: "frontmost-app-changed",
      appId: "com.apple.finder",
      appName: "Finder",
      at: Date.now(),
    });
    assert.strictEqual(snap.activeRuleId, null);
    assert.strictEqual(snap.activeVisualState, null);
  });

  it("app switch still refreshes presence activity", () => {
    const snap = engine.notifySignal({
      type: "frontmost-app-changed",
      appId: "com.apple.finder",
      appName: "Finder",
      at: Date.now(),
    });
    assert.strictEqual(snap.presenceActive, true);
    mock.timers.tick(10001);
    assert.strictEqual(engine.getSnapshot().activeVisualState, null);
  });

  it("clipboard change creates transient carrying state", () => {
    const snap = engine.notifySignal({
      type: "clipboard-text-changed",
      textPreview: "copied",
      at: Date.now(),
    });
    assert.strictEqual(snap.activeRuleId, "clipboardReaction");
    assert.strictEqual(snap.activeVisualState, "carrying");
  });

  it("browser frontmost settles into reading after delay", () => {
    engine.notifySignal({
      type: "frontmost-app-changed",
      appId: "com.apple.Safari",
      appName: "Safari",
      at: Date.now(),
    });
    mock.timers.tick(1200);
    assert.notStrictEqual(engine.getSnapshot().activeVisualState, "reading");
    mock.timers.tick(3000);
    assert.strictEqual(engine.getSnapshot().activeVisualState, "reading");
  });

  it("media playback activates listening", () => {
    const snap = engine.notifySignal({
      type: "media-state",
      playing: true,
      appName: "Music",
      at: Date.now(),
    });
    assert.strictEqual(snap.activeRuleId, "mediaPlaybackReaction");
    assert.strictEqual(snap.activeVisualState, "listening");
  });

  it("setEnabled(false) clears active rule state", () => {
    engine.notifySignal({
      type: "media-state",
      playing: true,
      appName: "Music",
      at: Date.now(),
    });
    const snap = engine.setEnabled(false);
    assert.strictEqual(snap.enabled, false);
    assert.strictEqual(snap.activeVisualState, null);
  });
});
