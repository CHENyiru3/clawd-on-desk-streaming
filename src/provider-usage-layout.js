"use strict";

function computeHudScale({ containerHeight, contentHeight, topOffset = 10, bottomOffset = 8, minScale = 0.72 }) {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) return 1;
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return 1;
  const availableHeight = Math.max(1, containerHeight - topOffset - bottomOffset);
  if (contentHeight <= availableHeight) return 1;
  const scaled = availableHeight / contentHeight;
  return Math.max(minScale, Math.min(1, scaled));
}

module.exports = {
  computeHudScale,
};
