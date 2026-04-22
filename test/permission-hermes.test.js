"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Mock Electron so permission.js can be loaded in node:test (no real Electron).
const mockWindows = new Map();
let ipcHandlers = {};

const mockElectron = {
  BrowserWindow: class MockBrowserWindow {
    constructor(opts) {
      const id = `win-${mockWindows.size + 1}`;
      this.id = id;
      this._opts = opts;
      this._closed = false;
      this.webContents = {
        send: (channel, data) => {
          if (channel === "permission-show" && ipcHandlers["permission-show"]) {
            ipcHandlers["permission-show"](data);
          }
        },
        once: (event, cb) => {
          if (event === "did-finish-load") ipcHandlers["did-finish-load"] = cb;
        },
        on: () => {},
        removeListener: () => {},
      };
      mockWindows.set(id, this);
    }
    setBounds() {}
    showInactive() {}
    on(event, cb) {
      if (event === "closed") this._onClosed = cb;
    }
    close() {
      this._closed = true;
      if (this._onClosed) this._onClosed();
    }
    destroy() {
      this._closed = true;
    }
    isDestroyed() { return this._closed; }
  },
  globalShortcut: {
    register: () => true,
    unregister: () => {},
  },
};
mockElectron.BrowserWindow.fromWebContents = (wc) => {
  for (const win of mockWindows.values()) {
    if (win.webContents === wc) return win;
  }
  return null;
};

// Set up Electron mock BEFORE loading permission.js.
require.cache[require.resolve("electron")] = {
  id: require.resolve("electron"),
  filename: require.resolve("electron"),
  loaded: true,
  exports: mockElectron,
};
delete require.cache[require.resolve("../src/permission")];
const permissionModule = require("../src/permission");

// ── shared mock ctx (passed to factory so hooks/logging work) ───────────────

function makeMockCtx() {
  return {
    doNotDisturb: false,
    hideBubbles: false,
    petHidden: false,
    lang: "en",
    permLog: () => {},
    permDebugLog: null,
    win: null,
    bubbleFollowPet: false,
    getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    getHitRectScreen: () => ({ left: 100, top: 100, right: 300, bottom: 300 }),
    showPermissionBubble: () => {},
    resolvePermissionEntry: () => {},
    focusTerminalForSession: () => {},
    guardAlwaysOnTop: () => {},
    reapplyMacVisibility: () => {},
    repositionBubbles: () => {},
    dismissPermissionsByAgent: () => 0,
    isAgentEnabled: () => true,
    isAgentPermissionsEnabled: () => true,
    sessions: new Map(),
    updateSession: () => {},
  };
}

// Instantiate once — all functions share the same internal pendingPermissions array.
const mockCtx = makeMockCtx();
const api = permissionModule(mockCtx);

function resetState() {
  // Clear the module's internal pendingPermissions array (exported by the factory).
  api.pendingPermissions.length = 0;
  ipcHandlers = {};
  mockWindows.clear();
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeHermesPerm(pollFile, extra = {}) {
  return {
    res: null,
    abortHandler: null,
    suggestions: [],
    sessionId: "test-session",
    bubble: null,
    hideTimer: null,
    toolName: "HermesExec",
    toolInput: { command: "rm -rf /", description: "dangerous" },
    resolvedSuggestion: null,
    createdAt: Date.now(),
    agentId: "hermes",
    isHermes: true,
    hermesBridgePollFile: pollFile || null,
    hermesAllowPermanent: extra.allowPermanent || false,
    _hermesChoice: null,
    ...extra,
  };
}

function makeMockWin() {
  const win = new mockElectron.BrowserWindow({});
  return win;
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("permission.js Hermes — handleDecide mapping", () => {

  beforeEach(resetState);
  afterEach(resetState);

  it("hermes-once → removes perm from pendingPermissions (allow path)", () => {
    const win = makeMockWin();
    const perm = makeHermesPerm();
    perm.bubble = win;
    api.pendingPermissions.push(perm);
    assert.strictEqual(api.pendingPermissions.length, 1);

    api.handleDecide({ sender: win.webContents }, "hermes-once");

    assert.strictEqual(api.pendingPermissions.length, 0, "Perm should be removed after Hermes allow");
  });

  it("hermes-session → removes perm from pendingPermissions (allow path)", () => {
    const win = makeMockWin();
    const perm = makeHermesPerm();
    perm.bubble = win;
    api.pendingPermissions.push(perm);

    api.handleDecide({ sender: win.webContents }, "hermes-session");

    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("hermes-always → removes perm from pendingPermissions (allow path)", () => {
    const win = makeMockWin();
    const perm = makeHermesPerm(null, { allowPermanent: true });
    perm.bubble = win;
    api.pendingPermissions.push(perm);

    api.handleDecide({ sender: win.webContents }, "hermes-always");

    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("hermes-deny → removes perm from pendingPermissions (deny path)", () => {
    const win = makeMockWin();
    const perm = makeHermesPerm();
    perm.bubble = win;
    api.pendingPermissions.push(perm);

    api.handleDecide({ sender: win.webContents }, "hermes-deny");

    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("non-matching window does not crash handleDecide", () => {
    // No pending permissions — fromWebContents returns null, handleDecide returns early.
    assert.doesNotThrow(() => {
      api.handleDecide({ sender: { id: "nonexistent" } }, "hermes-once");
    });
    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("hermes-unknown choice maps to allow (non-deny is allow)", () => {
    const win = makeMockWin();
    const perm = makeHermesPerm();
    perm.bubble = win;
    api.pendingPermissions.push(perm);

    api.handleDecide({ sender: win.webContents }, "hermes-unknown");

    assert.strictEqual(api.pendingPermissions.length, 0, "Unknown Hermes choice should resolve allow");
  });
});

describe("permission.js Hermes — poll file write on resolvePermissionEntry", () => {

  beforeEach(resetState);
  afterEach(resetState);

  function writeChoice(perm, behavior) {
    api.pendingPermissions.push(perm);
    api.resolvePermissionEntry(perm, behavior);
  }

  it("writes {choice:'once'} to poll file when _hermesChoice is 'once'", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-poll-${Date.now()}-once.json`);
    const perm = makeHermesPerm(tmpFile);
    perm._hermesChoice = "once";
    writeChoice(perm, "allow");

    assert.ok(fs.existsSync(tmpFile), "Poll file should be created");
    const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.strictEqual(content.choice, "once");
    fs.unlinkSync(tmpFile);
  });

  it("writes {choice:'session'} to poll file", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-poll-${Date.now()}-session.json`);
    const perm = makeHermesPerm(tmpFile);
    perm._hermesChoice = "session";
    writeChoice(perm, "allow");

    const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.strictEqual(content.choice, "session");
    fs.unlinkSync(tmpFile);
  });

  it("writes {choice:'always'} to poll file", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-poll-${Date.now()}-always.json`);
    const perm = makeHermesPerm(tmpFile);
    perm._hermesChoice = "always";
    writeChoice(perm, "allow");

    const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.strictEqual(content.choice, "always");
    fs.unlinkSync(tmpFile);
  });

  it("writes {choice:'deny'} when behavior is 'deny' and no _hermesChoice", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-poll-${Date.now()}-deny.json`);
    const perm = makeHermesPerm(tmpFile);
    writeChoice(perm, "deny");

    const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.strictEqual(content.choice, "deny");
    fs.unlinkSync(tmpFile);
  });

  it("defaults to 'once' when allow without _hermesChoice", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-poll-${Date.now()}-default.json`);
    const perm = makeHermesPerm(tmpFile);
    writeChoice(perm, "allow");

    const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.strictEqual(content.choice, "once", "Should default to 'once'");
    fs.unlinkSync(tmpFile);
  });

  it("does not throw when poll file cannot be written", () => {
    const perm = makeHermesPerm("/nonexistent-dir/hermes-perm-test.json");
    assert.doesNotThrow(() => {
      api.pendingPermissions.push(perm);
      api.resolvePermissionEntry(perm, "deny");
    });
  });

  it("removes perm from pendingPermissions before writing poll file", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-poll-${Date.now()}-remove.json`);
    const perm = makeHermesPerm(tmpFile);
    api.pendingPermissions.push(perm);
    assert.strictEqual(api.pendingPermissions.length, 1);

    api.resolvePermissionEntry(perm, "allow");

    assert.strictEqual(api.pendingPermissions.indexOf(perm), -1, "Perm should be removed");
    const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.strictEqual(content.choice, "once");
    fs.unlinkSync(tmpFile);
  });

  it("writes poll file even when res is null (Hermes has no HTTP res)", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-poll-${Date.now()}-nores.json`);
    const perm = makeHermesPerm(tmpFile);
    perm.res = null;
    api.pendingPermissions.push(perm);

    api.resolvePermissionEntry(perm, "deny");

    const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.strictEqual(content.choice, "deny");
    fs.unlinkSync(tmpFile);
  });

  it("skips poll file gracefully when hermesBridgePollFile is null", () => {
    const perm = makeHermesPerm(null);
    api.pendingPermissions.push(perm);
    // Should not throw even with null pollFile
    assert.doesNotThrow(() => {
      api.resolvePermissionEntry(perm, "allow");
    });
    assert.strictEqual(api.pendingPermissions.length, 0);
  });
});

describe("permission.js Hermes — dismissPermissionsByAgent Hermes cleanup", () => {

  beforeEach(resetState);
  afterEach(resetState);

  it("writes deny to poll file when dismissing Hermes permissions", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-dismiss-${Date.now()}.json`);
    const perm = makeHermesPerm(tmpFile);
    api.pendingPermissions.push(perm);

    api.dismissPermissionsByAgent("hermes");

    assert.ok(fs.existsSync(tmpFile), "Poll file should be created on Hermes dismiss");
    const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.strictEqual(content.choice, "deny", "Should write deny choice");
    fs.unlinkSync(tmpFile);
  });

  it("returns count of dismissed Hermes permissions", () => {
    const tmpFile1 = path.join(os.tmpdir(), `hermes-dismiss-1-${Date.now()}.json`);
    const tmpFile2 = path.join(os.tmpdir(), `hermes-dismiss-2-${Date.now()}.json`);
    api.pendingPermissions.push(makeHermesPerm(tmpFile1));
    api.pendingPermissions.push(makeHermesPerm(tmpFile2));

    const count = api.dismissPermissionsByAgent("hermes");

    assert.strictEqual(count, 2, "Should return count of 2 dismissed permissions");
    for (const f of [tmpFile1, tmpFile2]) {
      try { fs.unlinkSync(f); } catch {}
    }
  });

  it("does not affect non-Hermes pending permissions when dismissing Hermes", () => {
    const hermesFile = path.join(os.tmpdir(), `hermes-dismiss-${Date.now()}.json`);
    const ccPerm = { agentId: "claude-code", bubble: null, res: null };
    api.pendingPermissions.push(makeHermesPerm(hermesFile));
    api.pendingPermissions.push(ccPerm);

    api.dismissPermissionsByAgent("hermes");

    // ccPerm should still be in the array (dismissPermissionsByAgent only acts on Hermes perms)
    assert.strictEqual(api.pendingPermissions.length, 1, "Non-Hermes perm should remain");
    assert.strictEqual(api.pendingPermissions[0].agentId, "claude-code");
    try { fs.unlinkSync(hermesFile); } catch {}
  });

  it("returns 0 when no Hermes permissions are pending", () => {
    api.pendingPermissions.push({ agentId: "claude-code", bubble: null, res: null });
    const count = api.dismissPermissionsByAgent("hermes");
    assert.strictEqual(count, 0);
  });

  it("handles missing poll file gracefully in dismissPermissionsByAgent", () => {
    const perm = makeHermesPerm("/nonexistent/path/hermes-perm.json");
    api.pendingPermissions.push(perm);
    assert.doesNotThrow(() => {
      api.dismissPermissionsByAgent("hermes");
    });
  });
});

describe("permission.js Hermes — bubble close denies", () => {

  beforeEach(resetState);
  afterEach(resetState);

  it("bubble closed without click writes deny to poll file", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-close-${Date.now()}.json`);
    const perm = makeHermesPerm(tmpFile);
    const win = makeMockWin();
    perm.bubble = win;
    api.pendingPermissions.push(perm);

    // Simulate bubble close: permission.js resolves with deny message
    api.resolvePermissionEntry(perm, "deny", "Bubble window closed by user");

    assert.ok(fs.existsSync(tmpFile), "Poll file should exist after bubble close");
    const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.strictEqual(content.choice, "deny");
    fs.unlinkSync(tmpFile);
  });
});
