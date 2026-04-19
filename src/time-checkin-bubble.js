const { BrowserWindow } = require("electron");
const path = require("path");

const isMac = process.platform === "darwin";
const WIDTH = 364;
const EDGE_MARGIN = 8;
const GAP = 6;
const MAC_FLOATING_TOPMOST_DELAY_MS = 120;

function deferMacFloatingVisibility(ctx, win) {
  if (!isMac || !win || win.isDestroyed()) return;
  const deferUntil = Date.now() + MAC_FLOATING_TOPMOST_DELAY_MS;
  win.__clawdMacDeferredVisibilityUntil = deferUntil;
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    if (win.__clawdMacDeferredVisibilityUntil === deferUntil) delete win.__clawdMacDeferredVisibilityUntil;
    if (typeof ctx.reapplyMacVisibility === "function") ctx.reapplyMacVisibility();
  }, MAC_FLOATING_TOPMOST_DELAY_MS);
}

function estimateHeight(payload) {
  let height = 184;
  if (payload && payload.message) height += Math.max(0, String(payload.message).length - 80) * 0.18;
  if (payload && payload.detail) height += 18;
  return Math.ceil(height);
}

function computeBounds({ bubbleFollowPet, workArea, petBounds, hitRect, height, reservedHeight }) {
  let x = workArea.x + workArea.width - WIDTH - EDGE_MARGIN;
  let y = workArea.y + workArea.height - EDGE_MARGIN - height - reservedHeight;
  if (bubbleFollowPet && petBounds && hitRect) {
    const hitCx = Math.round((hitRect.left + hitRect.right) / 2);
    const abovePetY = Math.round(hitRect.top) - height;
    const underPetY = Math.round(hitRect.bottom);
    const followBottom = workArea.y + workArea.height - EDGE_MARGIN;
    if (abovePetY >= workArea.y + EDGE_MARGIN) {
      x = Math.max(workArea.x, Math.min(hitCx - Math.round(WIDTH / 2), workArea.x + workArea.width - WIDTH));
      y = abovePetY;
    } else if (underPetY + height <= followBottom) {
      x = Math.max(workArea.x, Math.min(hitCx - Math.round(WIDTH / 2), workArea.x + workArea.width - WIDTH));
      y = underPetY;
    }
  }
  y = Math.max(workArea.y + EDGE_MARGIN, y);
  return { x, y, width: WIDTH, height };
}

function acknowledge(ctx) {
  if (!ctx || typeof ctx.applyState !== "function") return;
  const svgOverride = typeof ctx.getSvgOverride === "function"
    ? ctx.getSvgOverride("attention")
    : undefined;
  ctx.applyState("attention", svgOverride);
}

module.exports = function initTimeCheckinBubble(ctx) {
  let bubble = null;
  let measuredHeight = 0;
  let hideTimer = null;
  let activePayload = null;

  function getPermissionStackHeight() {
    const pending = typeof ctx.getPendingPermissions === "function" ? ctx.getPendingPermissions() : [];
    let total = 0;
    for (const perm of pending) {
      if (!perm || !perm.bubble || perm.bubble.isDestroyed() || !perm.bubble.isVisible()) continue;
      total += perm.measuredHeight || 200;
      total += GAP;
    }
    return total;
  }

  function ensureBubble() {
    if (bubble && !bubble.isDestroyed()) return bubble;
    bubble = new BrowserWindow({
      width: WIDTH,
      height: estimateHeight(activePayload),
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, "preload-time-checkin-bubble.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    bubble.loadFile(path.join(__dirname, "time-checkin-bubble.html"));
    if (typeof ctx.guardAlwaysOnTop === "function") ctx.guardAlwaysOnTop(bubble);
    bubble.on("closed", () => {
      bubble = null;
      measuredHeight = 0;
    });
    bubble.webContents.once("did-finish-load", () => {
      if (activePayload) bubble.webContents.send("time-checkin-bubble-show", activePayload);
    });
    return bubble;
  }

  function reposition() {
    if (!bubble || bubble.isDestroyed() || !ctx.win || ctx.win.isDestroyed()) return;
    const petBounds = ctx.win.getBounds();
    const wa = ctx.getNearestWorkArea(petBounds.x + petBounds.width / 2, petBounds.y + petBounds.height / 2);
    const height = measuredHeight || estimateHeight(activePayload);
    const bounds = computeBounds({
      bubbleFollowPet: ctx.bubbleFollowPet,
      workArea: wa,
      petBounds,
      hitRect: ctx.bubbleFollowPet ? ctx.getHitRectScreen(petBounds) : null,
      height,
      reservedHeight: getPermissionStackHeight(),
    });
    bubble.setBounds(bounds);
  }

  function syncVisibility() {
    if (!bubble || bubble.isDestroyed()) return;
    if (ctx.petHidden) {
      bubble.hide();
      return;
    }
    bubble.showInactive();
    if (isMac) deferMacFloatingVisibility(ctx, bubble);
    else if (typeof ctx.reapplyMacVisibility === "function") ctx.reapplyMacVisibility();
  }

  function show(payload) {
    activePayload = payload;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    const win = ensureBubble();
    const send = () => {
      measuredHeight = 0;
      reposition();
      if (!win.isDestroyed()) {
        win.webContents.send("time-checkin-bubble-show", payload);
        syncVisibility();
      }
    };
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
    else send();
  }

  function hide() {
    if (!bubble || bubble.isDestroyed()) return;
    bubble.webContents.send("time-checkin-bubble-hide");
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (bubble && !bubble.isDestroyed()) bubble.hide();
    }, 220);
  }

  function handleHeight(event, height) {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin !== bubble) return;
    if (typeof height === "number" && height > 0) {
      measuredHeight = Math.ceil(height);
      reposition();
    }
  }

  function handleDismiss(event) {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin !== bubble) return;
    hide();
    acknowledge(ctx);
  }

  function cleanup() {
    if (hideTimer) clearTimeout(hideTimer);
    if (bubble && !bubble.isDestroyed()) bubble.destroy();
    bubble = null;
  }

  return {
    show,
    hide,
    reposition,
    syncVisibility,
    handleHeight,
    handleDismiss,
    cleanup,
    getBubbleWindow: () => bubble,
  };
};

module.exports.__test = {
  acknowledge,
  estimateHeight,
  computeBounds,
};
