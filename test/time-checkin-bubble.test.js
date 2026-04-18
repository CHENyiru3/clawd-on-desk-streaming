"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const bubble = require("../src/time-checkin-bubble");

describe("time-checkin-bubble", () => {
  it("computes bounded placement", () => {
    const bounds = bubble.__test.computeBounds({
      bubbleFollowPet: false,
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
      petBounds: { x: 1000, y: 700, width: 200, height: 200 },
      hitRect: null,
      height: 200,
      reservedHeight: 0,
    });
    assert.strictEqual(bounds.width, 364);
    assert.ok(bounds.x >= 0);
    assert.ok(bounds.y >= 0);
  });
});
