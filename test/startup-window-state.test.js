"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  isHiddenMiniRestore,
  resolveRecoveredNormalPosition,
  resolveStartupWindowState,
} = require("../src/startup-window-state");

describe("startup-window-state", () => {
  const size = { width: 280, height: 280 };
  const primaryWorkArea = { x: 0, y: 0, width: 1440, height: 900 };
  const getNearestWorkArea = () => primaryWorkArea;

  it("detects hidden left-edge mini restores", () => {
    assert.strictEqual(isHiddenMiniRestore({
      prefs: { miniMode: true, miniEdge: "left", x: -210, y: 468 },
      size,
      getNearestWorkArea,
    }), true);
  });

  it("does not flag visible normal state as hidden mini restore", () => {
    assert.strictEqual(isHiddenMiniRestore({
      prefs: { miniMode: false, x: 200, y: 200 },
      size,
      getNearestWorkArea,
    }), false);
  });

  it("recovers to pre-mini coordinates when mini restore is hidden", () => {
    const recovered = resolveRecoveredNormalPosition({
      prefs: { preMiniX: 65, preMiniY: 473 },
      size,
      primaryWorkArea,
    });
    assert.deepStrictEqual(recovered, { x: 65, y: 473 });
  });

  it("resolves startup into normal mode when mini restore would be hidden", () => {
    const state = resolveStartupWindowState({
      prefs: { miniMode: true, miniEdge: "left", x: -210, y: 468, preMiniX: 65, preMiniY: 473 },
      size,
      primaryWorkArea,
      getNearestWorkArea,
    });
    assert.deepStrictEqual(state, {
      restoreMini: false,
      recoveredFromMini: true,
      x: 65,
      y: 473,
    });
  });

  it("keeps visible mini restores in mini mode", () => {
    const state = resolveStartupWindowState({
      prefs: { miniMode: true, miniEdge: "right", x: 1300, y: 400 },
      size,
      primaryWorkArea,
      getNearestWorkArea,
    });
    assert.deepStrictEqual(state, {
      restoreMini: true,
      recoveredFromMini: false,
    });
  });
});
