#!/usr/bin/env node
// Clawd Desktop Pet — Auto-Start Script
// Registered as a SessionStart hook BEFORE clawd-hook.js.
// Checks if the Electron app is running; if not, launches it detached.
// Uses shared server discovery helpers and should exit quickly in normal cases.

const { spawn } = require("child_process");
const path = require("path");
const { discoverClawdPort } = require("./server-config");

const TIMEOUT_MS = 300;

discoverClawdPort({ timeoutMs: TIMEOUT_MS }, (port) => {
  if (port) {
    process.exit(0);
    return;
  }
  launchApp();
  process.exit(0);
});

function launchApp() {
  const isPackaged = __dirname.includes("app.asar");

  try {
    if (isPackaged) {
      // __dirname: <name>.app/Contents/Resources/app.asar.unpacked/hooks
      // .app bundle: 4 levels up
      const appBundle = path.resolve(__dirname, "..", "..", "..", "..");
      spawn("open", ["-a", appBundle], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else {
      // Source / development mode
      const projectDir = path.resolve(__dirname, "..");
      spawn("npm", ["start"], {
        cwd: projectDir,
        detached: true,
        stdio: "ignore",
      }).unref();
    }
  } catch (err) {
    process.stderr.write(`clawd auto-start: ${err.message}\n`);
  }
}
