const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const themeLoader = require("../src/theme-loader");
const hitGeometry = require("../src/hit-geometry");

themeLoader.init(path.join(__dirname, "..", "src"));
const clawd = themeLoader.loadTheme("clawd");

function approx(actual, expected, epsilon = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

describe("hit geometry", () => {
  const bounds = { x: 0, y: 0, width: 200, height: 200 };

  it("derives image sizing from object fit for clawd drag svg", () => {
    const rect = hitGeometry.getAssetRectScreen(clawd, bounds, null, "clawd-react-drag.svg");
    approx(rect.x, -30.5);
    approx(rect.y, -53.6);
    approx(rect.w, 261);
    approx(rect.h, 261);
  });
});
