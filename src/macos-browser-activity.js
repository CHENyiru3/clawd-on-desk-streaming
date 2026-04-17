"use strict";

const BROWSER_BUNDLE_IDS = new Set([
  "com.apple.Safari",
  "com.google.Chrome",
  "company.thebrowser.Browser",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
  "com.brave.Browser",
]);

function isBrowserApp(appId) {
  return !!(appId && BROWSER_BUNDLE_IDS.has(appId));
}

module.exports = {
  BROWSER_BUNDLE_IDS,
  isBrowserApp,
};
