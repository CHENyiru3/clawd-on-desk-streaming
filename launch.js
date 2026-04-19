#!/usr/bin/env node

// macOS-only launcher that ensures Electron runs in GUI mode.
//
// Claude Code sets ELECTRON_RUN_AS_NODE=1, which forces Electron to behave as
// a plain Node.js process — the browser layer never initializes, so
// require("electron").app is undefined.
//
// This launcher strips that variable before spawning the real Electron binary.

const { spawn } = require("child_process");
const electron = require("electron");

// Load .env file so environment variables (e.g. MINIMAX_API_KEY) are available
// to the Electron process. Safe to call even if no .env exists.
try { require("dotenv/config"); } catch {}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ["."], {
  stdio: "inherit",
  env,
  cwd: __dirname,
});

child.on("close", (code) => process.exit(code ?? 0));

