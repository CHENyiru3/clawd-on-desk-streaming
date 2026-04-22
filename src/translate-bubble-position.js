"use strict";

const isMac = process.platform === "darwin";
const MAC_FLOATING_TOPMOST_DELAY_MS = 120;

// ── Pure helper: compute translation bubble bounds from geometry ─────────────
//
// Three-tier positioning model (all use hitbox center for x):
//   1. above-pet  — bubble centered at hitRect.top, only if it fits
//   2. below-pet  — bubble centered at hitRect.bottom, only if it fits
//   3. side       — bubble to the right or left of the hitbox, vertically
//                   centered in the hitbox; used only when vertical space
//                   is too constrained for either above or below
//
// Returns { x, y, width, height } suitable for BrowserWindow.setBounds().
// All coordinates are absolute (screen-space) integers.
function computeTranslateBubbleBounds({
  workArea,  // { x, y, width, height }
  hitRect,   // { left, top, right, bottom }
  width,     // bubble width (default 300)
  height,    // bubble height (measured or estimated)
  gap,       // gap from hitbox edge in side fallback
  edgeMargin, // work-area clamp margin
}) {
  width = width || 300;
  gap = gap || 6;
  edgeMargin = edgeMargin || 8;

  // Center x uses hitbox center, not render-window center (pet-centered interaction)
  const hitCx = Math.round((hitRect.left + hitRect.right) / 2);
  const hitTop = Math.round(hitRect.top);
  const hitBottom = Math.round(hitRect.bottom);
  const hitRight = Math.round(hitRect.right);
  const hitLeft = Math.round(hitRect.left);

  let x;
  let y;

  // Tier 1: above the pet
  const aboveY = hitTop - height;
  if (aboveY >= workArea.y + edgeMargin) {
    x = Math.max(workArea.x, Math.min(hitCx - Math.round(width / 2), workArea.x + workArea.width - width));
    y = aboveY;
    return { x, y, width, height };
  }

  // Tier 2: below the pet
  const belowY = hitBottom;
  if (belowY + height <= workArea.y + workArea.height - edgeMargin) {
    x = Math.max(workArea.x, Math.min(hitCx - Math.round(width / 2), workArea.x + workArea.width - width));
    y = belowY;
    return { x, y, width, height };
  }

  // Tier 3: side — only when vertical space is too constrained
  const hitCy = Math.round((hitRect.top + hitRect.bottom) / 2);
  const spaceRight = workArea.x + workArea.width - hitRight;
  const spaceLeft = hitLeft - workArea.x;

  if (spaceRight >= width || spaceRight >= spaceLeft) {
    x = Math.min(hitRight + gap, workArea.x + workArea.width - width);
  } else {
    x = Math.max(workArea.x, hitLeft - gap - width);
  }

  const maxY = workArea.y + workArea.height - edgeMargin - height;
  y = Math.max(workArea.y + edgeMargin, Math.min(hitCy - Math.round(height / 2), maxY));

  return { x, y, width, height };
}

// ── macOS floating visibility helper (mirrors update-bubble.js pattern) ─────
function deferTranslateMacVisibility(translateWin, reapplyFn) {
  if (!isMac || !translateWin || translateWin.isDestroyed()) return;
  const deferUntil = Date.now() + MAC_FLOATING_TOPMOST_DELAY_MS;
  translateWin.__clawdMacDeferredVisibilityUntil = deferUntil;
  setTimeout(() => {
    if (!translateWin || translateWin.isDestroyed()) return;
    if (translateWin.__clawdMacDeferredVisibilityUntil === deferUntil) {
      delete translateWin.__clawdMacDeferredVisibilityUntil;
    }
    if (typeof reapplyFn === "function") reapplyFn();
  }, MAC_FLOATING_TOPMOST_DELAY_MS);
}

module.exports = {
  computeTranslateBubbleBounds,
  deferTranslateMacVisibility,
  __test: { computeTranslateBubbleBounds },
};