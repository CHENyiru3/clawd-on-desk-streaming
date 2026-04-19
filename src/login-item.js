"use strict";

// ── macOS login item helpers ──
// Uses Electron's app.setLoginItemSettings API.
//
// menu.js and main.js's settings effect/hydration paths use getLoginItemSettings
// from here. test/menu-autostart.test.js imports it too.

function getLoginItemSettings({ isPackaged, openAtLogin, execPath, appPath }) {
  if (isPackaged) return { openAtLogin };
  return {
    openAtLogin,
    path: execPath,
    args: [appPath],
  };
}

module.exports = {
  getLoginItemSettings,
};
