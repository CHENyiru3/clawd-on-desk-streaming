"use strict";

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert");

const { createTranslateBubbleTimer } = require("../src/translate-bubble-timer");

describe("translate-bubble timer", () => {
  let timer;
  let expired;

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    expired = 0;
    timer = createTranslateBubbleTimer({
      onExpire: () => { expired += 1; },
    });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("expires after the scheduled duration", () => {
    timer.schedule(20000);
    mock.timers.tick(19999);
    assert.strictEqual(expired, 0);
    mock.timers.tick(1);
    assert.strictEqual(expired, 1);
  });

  it("pause holds the countdown and resume uses remaining time", () => {
    timer.schedule(20000);
    mock.timers.tick(5000);
    assert.strictEqual(timer.pause(), true);
    const paused = timer.getState();
    assert.strictEqual(paused.paused, true);
    assert.ok(paused.remainingMs <= 15000 && paused.remainingMs >= 14999);
    mock.timers.tick(30000);
    assert.strictEqual(expired, 0);
    assert.strictEqual(timer.resume(), true);
    mock.timers.tick(14999);
    assert.strictEqual(expired, 0);
    mock.timers.tick(1);
    assert.strictEqual(expired, 1);
  });

  it("clear cancels an active timer", () => {
    timer.schedule(5000);
    timer.clear();
    mock.timers.tick(5000);
    assert.strictEqual(expired, 0);
    assert.strictEqual(timer.getState().active, false);
  });
});
