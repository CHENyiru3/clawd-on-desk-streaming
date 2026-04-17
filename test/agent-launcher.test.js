"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  validateLauncherCommand,
  validateAgentLauncherUpdate,
  shouldFocusFallbackLaunch,
  shouldTripleClickLaunch,
} = require("../src/agent-launcher");

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
