"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { computeHudScale } = require("../src/provider-usage-layout");

describe("provider-usage-layout", () => {
  it("keeps scale at 1 when content fits", () => {
    assert.strictEqual(computeHudScale({ containerHeight: 240, contentHeight: 180 }), 1);
  });

  it("shrinks the hud when content would overflow", () => {
    const scale = computeHudScale({ containerHeight: 160, contentHeight: 220, topOffset: 10, bottomOffset: 8 });
    assert.ok(scale < 1);
    assert.ok(scale >= 0.72);
  });

  it("honors the minimum scale floor", () => {
    assert.strictEqual(
      computeHudScale({ containerHeight: 80, contentHeight: 400, minScale: 0.7 }),
      0.7
    );
  });
});
