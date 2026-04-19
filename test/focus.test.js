"use strict";

const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert");
const childProcess = require("node:child_process");

function loadFocusWithExecFile(execFileImpl) {
  mock.restoreAll();
  mock.method(childProcess, "execFile", execFileImpl);
  delete require.cache[require.resolve("../src/focus")];
  return require("../src/focus");
}

describe("focus", () => {
  beforeEach(() => {
    mock.restoreAll();
    delete require.cache[require.resolve("../src/focus")];
  });

  it("uses the bound window position for macOS focus requests", async () => {
    let capturedScript = "";
    const initFocus = loadFocusWithExecFile((cmd, args, opts, cb) => {
      capturedScript = args[1];
      cb(null, "ok:123", "");
    });
    const api = initFocus({
      win: {
        isDestroyed: () => false,
        getPosition: () => [120, 250],
      },
    });

    api.focusTerminalWindow(123, "/tmp/demo", null, []);

    assert.match(capturedScript, /set newX to \(120 - termWidth - 8\)/);
    assert.match(capturedScript, /set bounds of window 1 to \{newX, 250, newX \+ termWidth, 250 \+ termHeight\}/);
  });

  it("returns structured macOS focus results", async () => {
    const initFocus = loadFocusWithExecFile((cmd, args, opts, cb) => {
      cb(null, "ok:456", "");
    });
    const api = initFocus({
      win: {
        isDestroyed: () => false,
        getPosition: () => [10, 20],
      },
    });

    const result = await api.runMacFocusCheck(123, "/tmp/demo", null, []);

    assert.deepStrictEqual(result, { ok: true, targetPid: 456 });
  });
});
