"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { pickTerminalDiagnosticsTarget, runTerminalDiagnosticsCheck } = require("../src/terminal-diagnostics");

describe("pickTerminalDiagnosticsTarget", () => {
  it("prefers higher-priority live sessions with sourcePid", () => {
    const sessions = new Map([
      ["idle", { state: "idle", sourcePid: 10, updatedAt: 1, cwd: "/idle" }],
      ["working", { state: "working", sourcePid: 20, updatedAt: 2, cwd: "/working" }],
    ]);
    const result = pickTerminalDiagnosticsTarget(sessions, { idle: 1, working: 3 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.target.sourcePid, 20);
  });

  it("falls back to most recent when priorities tie", () => {
    const sessions = new Map([
      ["a", { state: "working", sourcePid: 10, updatedAt: 1, cwd: "/a" }],
      ["b", { state: "working", sourcePid: 20, updatedAt: 5, cwd: "/b" }],
    ]);
    const result = pickTerminalDiagnosticsTarget(sessions, { working: 3 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.target.sourcePid, 20);
  });

  it("returns no_target when nothing focusable exists", () => {
    const result = pickTerminalDiagnosticsTarget(new Map([
      ["a", { state: "working", updatedAt: 1 }],
    ]), { working: 3 });
    assert.deepStrictEqual(result, {
      ok: false,
      reason: "no_target",
      message: "No terminal target available.",
    });
  });
});

describe("runTerminalDiagnosticsCheck", () => {
  it("passes the selected target into the executor", async () => {
    const sessions = new Map([
      ["s1", { state: "working", sourcePid: 22, updatedAt: 10, cwd: "/repo" }],
    ]);
    const result = await runTerminalDiagnosticsCheck({
      sessions,
      statePriority: { working: 3 },
      executeFocus: async (target) => ({ ok: true, echoedPid: target.sourcePid }),
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.targetPid, 22);
    assert.strictEqual(result.targetLabel, "/repo");
    assert.strictEqual(result.echoedPid, 22);
  });
});
