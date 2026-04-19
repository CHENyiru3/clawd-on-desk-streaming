"use strict";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isHiddenMiniRestore({ prefs, size, getNearestWorkArea }) {
  if (!prefs || !prefs.miniMode || !size || typeof getNearestWorkArea !== "function") return false;
  const probeX = isFiniteNumber(prefs.x) ? prefs.x : 0;
  const probeY = isFiniteNumber(prefs.y) ? prefs.y : 0;
  const wa = getNearestWorkArea(probeX + size.width / 2, probeY + size.height / 2);
  if (!wa) return false;
  const hiddenThreshold = Math.max(40, Math.round(size.width * 0.35));
  if ((prefs.miniEdge || "right") === "left") {
    return probeX <= wa.x - hiddenThreshold;
  }
  return probeX >= wa.x + wa.width - hiddenThreshold;
}

function resolveRecoveredNormalPosition({ prefs, size, primaryWorkArea }) {
  const wa = primaryWorkArea || { x: 0, y: 0, width: 1200, height: 800 };
  const fallbackX = wa.x + wa.width - size.width - 20;
  const fallbackY = wa.y + wa.height - size.height - 20;
  return {
    x: isFiniteNumber(prefs && prefs.preMiniX) ? prefs.preMiniX : fallbackX,
    y: isFiniteNumber(prefs && prefs.preMiniY) ? prefs.preMiniY : fallbackY,
  };
}

function resolveStartupWindowState({ prefs, size, primaryWorkArea, getNearestWorkArea }) {
  if (prefs && prefs.miniMode) {
    if (isHiddenMiniRestore({ prefs, size, getNearestWorkArea })) {
      const recovered = resolveRecoveredNormalPosition({ prefs, size, primaryWorkArea });
      return {
        restoreMini: false,
        recoveredFromMini: true,
        x: recovered.x,
        y: recovered.y,
      };
    }
    return { restoreMini: true, recoveredFromMini: false };
  }
  return { restoreMini: false, recoveredFromMini: false };
}

module.exports = {
  isHiddenMiniRestore,
  resolveRecoveredNormalPosition,
  resolveStartupWindowState,
};
