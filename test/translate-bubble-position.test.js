"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { computeTranslateBubbleBounds } = require("../src/translate-bubble-position");

describe("computeTranslateBubbleBounds", () => {
  describe("above-pet (tier 1)", () => {
    it("centers bubble above hitRect.top when there is room", () => {
      // hitTop=108, aboveY=108-100=8, 8>=8 → above fits
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 900 },
        hitRect: { left: 320, top: 108, right: 400, bottom: 188 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      assert.deepStrictEqual(bounds, { x: 210, y: 8, width: 300, height: 100 });
    });

    it("places bubble above when there is exactly enough room", () => {
      // hitRect.top = 108; height = 100; aboveY = 8; edgeMargin = 8 → exactly fits
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 900 },
        hitRect: { left: 320, top: 108, right: 400, bottom: 188 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      assert.deepStrictEqual(bounds, { x: 210, y: 8, width: 300, height: 100 });
    });

    it("uses below-pet when above would extend above work area", () => {
      // aboveY = 88 - 100 = -12 < edgeMargin(8) → does not fit, falls to below
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 900 },
        hitRect: { left: 320, top: 88, right: 400, bottom: 168 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      // Below fits: hitCx=360, belowY=168, 168+100=268<=892
      assert.deepStrictEqual(bounds, { x: 210, y: 168, width: 300, height: 100 });
    });
  });

  describe("below-pet (tier 2)", () => {
    it("centers bubble below hitRect.bottom when above does not fit", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 600 },
        hitRect: { left: 320, top: 8, right: 400, bottom: 88 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      // hitCx = 360; belowY = 88; belowY + 100 = 188 <= 592 → fits
      assert.deepStrictEqual(bounds, { x: 210, y: 88, width: 300, height: 100 });
    });

    it("does not use below-pet when it also does not fit — falls to side", () => {
      // Above: aboveY=20-200=-180<8 → no. Below: 100+200=300>242 → no → side
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 250 },
        hitRect: { left: 320, top: 20, right: 400, bottom: 100 },
        width: 300,
        height: 200,
        gap: 6,
        edgeMargin: 8,
      });

      // spaceRight = 400; spaceLeft = 320; 400 >= 300 → right
      // hitCy = 60; y = clamp(60-100, [8, 42]) = 8
      assert.strictEqual(bounds.x, 406);
      assert.strictEqual(bounds.y, 8);
    });
  });

  describe("side (tier 3 — vertical constraint)", () => {
    it("places bubble to the right when more space on the right", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 250 },
        hitRect: { left: 300, top: 30, right: 380, bottom: 110 },
        width: 300,
        height: 200,
        gap: 6,
        edgeMargin: 8,
      });

      // spaceRight = 420; spaceLeft = 300; 420 >= 300 → right
      // hitCy = 70; maxY = 250-8-200=42; y = clamp(70-100, [8, 42]) = 8
      assert.strictEqual(bounds.x, 386);
      assert.strictEqual(bounds.y, 8);
    });

    it("places bubble to the left when more space on the left", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 250 },
        hitRect: { left: 500, top: 30, right: 580, bottom: 110 },
        width: 300,
        height: 200,
        gap: 6,
        edgeMargin: 8,
      });

      // spaceRight = 220; spaceLeft = 500; 220 < 500 → left
      assert.strictEqual(bounds.x, 194);
    });

    it("clamps right-side x to work-area boundary when bubble exceeds width", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 250 },
        hitRect: { left: 20, top: 30, right: 100, bottom: 110 },
        width: 300,
        height: 200,
        gap: 6,
        edgeMargin: 8,
      });

      // spaceRight = 700 >= 300 → right; x = min(100+6, 500) = 106
      assert.strictEqual(bounds.x, 106);
    });
  });

  describe("horizontal clamping", () => {
    it("clamps x to work area right boundary when hitbox is near right edge", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        hitRect: { left: 1850, top: 200, right: 1910, bottom: 280 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      // hitCx = 1880; aboveY = 200 - 100 = 100 >= 8 → tier 1
      // x = clamp(1880 - 150, [8, 1620]) = 1620
      assert.strictEqual(bounds.x, 1620);
    });

    it("uses below-pet when hitbox is near top and above would be off-screen", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        hitRect: { left: 10, top: 50, right: 90, bottom: 130 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      // hitCx = 50; aboveY = 50 - 100 = -50 < 8 → below-pet
      // belowY = 130; belowY + 100 = 230 <= 1072 → fits below
      // hitCx=50, x = clamp(50-150, [0, 1620]) = 0 (workArea.x clamp)
      assert.strictEqual(bounds.x, 0);
      assert.strictEqual(bounds.y, 130);
    });
  });

  describe("uses hitbox center (not render-window center)", () => {
    it("shifted hitbox produces different x from render-window center", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 900 },
        // render window cx=400; hitbox cx=360
        hitRect: { left: 320, top: 108, right: 400, bottom: 188 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      // Uses hitCx=360 not render-cx=400 → x = 360 - 150 = 210
      assert.strictEqual(bounds.x, 210);
    });

    it("right-shifted hitbox gives different x from render-window center", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 900 },
        // render window cx=400; hitbox cx=420
        hitRect: { left: 380, top: 108, right: 460, bottom: 188 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      // Uses hitCx=420 → x = clamp(420-150, [8, 500]) = 270
      assert.strictEqual(bounds.x, 270);
    });

    it("above-pet case also uses hitbox center", () => {
      const bounds1 = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 900 },
        hitRect: { left: 320, top: 120, right: 400, bottom: 200 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      const bounds2 = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 900 },
        hitRect: { left: 350, top: 120, right: 430, bottom: 200 },
        width: 300,
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      // bounds1 hitCx=360, bounds2 hitCx=390 → different x
      assert.notStrictEqual(bounds1.x, bounds2.x);
    });
  });

  describe("defaults and edge cases", () => {
    it("uses width 300 when width is not provided", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 600 },
        hitRect: { left: 320, top: 100, right: 400, bottom: 180 },
        height: 100,
        gap: 6,
        edgeMargin: 8,
      });

      assert.strictEqual(bounds.width, 300);
    });

    it("uses gap 6 when gap is not provided in side fallback", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 250 },
        hitRect: { left: 300, top: 30, right: 380, bottom: 110 },
        width: 300,
        height: 200,
        edgeMargin: 8,
      });

      // In side fallback, x = min(hitRight + gap, workArea.x + workArea.width - width)
      // spaceRight = 420 >= 300 → right → x = min(380+6, 500)
      assert.strictEqual(bounds.x, 386);
    });

    it("returns the height as provided", () => {
      const bounds = computeTranslateBubbleBounds({
        workArea: { x: 0, y: 0, width: 800, height: 600 },
        hitRect: { left: 320, top: 100, right: 400, bottom: 180 },
        width: 300,
        height: 0,
        gap: 6,
        edgeMargin: 8,
      });

      assert.strictEqual(bounds.height, 0);
    });
  });
});