"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  launchAgentTerminal,
  validateLauncherCommand,
  validateAgentLauncherUpdate,
  shouldFocusFallbackLaunch,
  shouldTripleClickLaunch,
  _resetMacLauncherStateForTests,
} = require("../src/agent-launcher");

describe("agent-launcher macOS reuse behavior", () => {
  it("reuses the previous Terminal window when it is still open", () => {
    _resetMacLauncherStateForTests();
    const calls = [];
    const execFileSyncImpl = (_bin, args, opts) => {
      calls.push({ args, opts });
      if (calls.length === 1) return "";
      return "reused\n";
    };

    const first = launchAgentTerminal({
      command: "claude",
      cwd: "",
      _platform: "darwin",
      _execFileSync: execFileSyncImpl,
    });
    const second = launchAgentTerminal({
      command: "claude",
      cwd: "",
      _platform: "darwin",
      _execFileSync: execFileSyncImpl,
    });

    assert.deepStrictEqual(first, { ok: true });
    assert.deepStrictEqual(second, { ok: true, reused: true });
    assert.strictEqual(calls.length, 2);
    assert.match(calls[1].args[1], /count of windows/);
  });

  it("falls back to opening a new Terminal window when the previous one was closed", () => {
    _resetMacLauncherStateForTests();
    let reuseChecks = 0;
    const calls = [];
    const execFileSyncImpl = (_bin, args) => {
      calls.push(args);
      if (args[1].includes("count of windows")) {
        reuseChecks++;
        return "no_window\n";
      }
      return "";
    };

    launchAgentTerminal({
      command: "claude",
      cwd: "",
      _platform: "darwin",
      _execFileSync: execFileSyncImpl,
    });
    const second = launchAgentTerminal({
      command: "claude",
      cwd: "",
      _platform: "darwin",
      _execFileSync: execFileSyncImpl,
    });

    assert.deepStrictEqual(second, { ok: true });
    assert.strictEqual(reuseChecks, 1);
    assert.strictEqual(calls.length, 3);
  });
});

describe("agent-launcher.validateLauncherCommand", () => {
  it("accepts simple commands", () => {
    assert.strictEqual(validateLauncherCommand("claude"), null);
    assert.strictEqual(validateLauncherCommand("/usr/local/bin/claude"), null);
    assert.strictEqual(validateLauncherCommand("opencode run"), null);
  });

  it("rejects newlines and shell metacharacters", () => {
    assert.ok(validateLauncherCommand("a\nb"));
    assert.ok(validateLauncherCommand("a;b"));
    assert.ok(validateLauncherCommand("a|b"));
  });
});

describe("agent-launcher.validateAgentLauncherUpdate", () => {
  const ok = {
    enabled: true,
    command: "claude",
    cwd: "",
    trigger: "menuOnly",
  };

  it("accepts a full valid object", () => {
    assert.deepStrictEqual(validateAgentLauncherUpdate(ok), { status: "ok" });
  });

  it("rejects missing fields", () => {
    const r = validateAgentLauncherUpdate({ enabled: true, command: "x", cwd: "" });
    assert.strictEqual(r.status, "error");
    assert.ok(String(r.message).includes("trigger"));
  });

  it("rejects bad cwd with ..", () => {
    const r = validateAgentLauncherUpdate({ ...ok, cwd: "/tmp/../etc" });
    assert.strictEqual(r.status, "error");
  });
});

describe("agent-launcher trigger helpers", () => {
  it("classifies focus fallback triggers", () => {
    assert.strictEqual(shouldFocusFallbackLaunch("menuOnly"), false);
    assert.strictEqual(shouldFocusFallbackLaunch("tripleClick"), false);
    assert.strictEqual(shouldFocusFallbackLaunch("focusFallback"), true);
    assert.strictEqual(shouldFocusFallbackLaunch("tripleAndFocus"), true);
  });

  it("classifies triple-click triggers", () => {
    assert.strictEqual(shouldTripleClickLaunch("menuOnly"), false);
    assert.strictEqual(shouldTripleClickLaunch("tripleClick"), true);
    assert.strictEqual(shouldTripleClickLaunch("focusFallback"), false);
    assert.strictEqual(shouldTripleClickLaunch("tripleAndFocus"), true);
  });
});
