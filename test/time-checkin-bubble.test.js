"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

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

  it("pulses attention when the check-in is acknowledged", () => {
    const calls = [];
    bubble.__test.acknowledge({
      applyState(state, svgOverride) {
        calls.push({ state, svgOverride });
      },
      getSvgOverride(state) {
        return state === "attention" ? "clawd-happy.svg" : null;
      },
    });
    assert.deepStrictEqual(calls, [{ state: "attention", svgOverride: "clawd-happy.svg" }]);
  });

  it("renders the dedicated bubble with white Arial styling and the Clawdie label", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "..", "src", "time-checkin-bubble.html"),
      "utf8"
    );
    assert.match(html, /font-family:\s*Arial,\s*sans-serif;/);
    assert.match(html, /--bg:\s*rgba\(255,\s*255,\s*255,\s*0\.99\);/);
    assert.match(html, /\.dismiss:hover\s*\{/);
    assert.match(html, /transform:\s*translateY\(-1px\);/);
    assert.match(html, /payload\.dismissLabel \|\| "Copy that Clawdie"/);
  });
});
