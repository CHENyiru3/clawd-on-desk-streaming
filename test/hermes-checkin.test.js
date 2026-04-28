"use strict";

const { describe, it, mock } = require("node:test");
const assert = require("node:assert");
const events = require("node:events");

const childProcess = require("child_process");
const { buildPrompt, buildFallbackMessage, buildTimeContext, runHermesCheckin } = require("../src/hermes-checkin");

describe("hermes-checkin prompt building", () => {
  it("includes sanitized snippets and no raw secret markers are required from caller", () => {
    const prompt = buildPrompt({
      now: new Date(2026, 3, 17, 17, 0, 0, 0),
      slotLabel: "5:00 PM Check-in",
      context: {
        entries: [{ text: "[REDACTED_TOKEN]", at: 1 }],
        counts: { totalEntries: 1, redactedEntries: 1 },
      },
    });

    assert.match(prompt, /5:00 PM Check-in/);
    assert.match(prompt, /\[REDACTED_TOKEN\]/);
    assert.match(prompt, /Current local time is 5:00 PM/);
    assert.match(prompt, /This is a evening check-in\./);
  });

  it("builds a time-aware local fallback message", () => {
    const message = buildFallbackMessage({
      now: new Date(2026, 3, 17, 17, 0, 0, 0),
      context: { counts: { totalEntries: 0 } },
    });
    assert.match(message, /It's 5:00 PM/);
    assert.match(message, /Wrap-up time|wrap-up window/i);
  });

  it("builds explicit time context", () => {
    const ctx = buildTimeContext(new Date(2026, 3, 17, 23, 0, 0, 0), "11:00 PM Check-in");
    assert.strictEqual(ctx.clockLabel, "11:00 PM");
    assert.strictEqual(ctx.partOfDay, "late-night");
    assert.match(ctx.transitionHint, /slowing down/i);
  });

  it("runs hermes through non-interactive chat mode while preserving resume args", async () => {
    let captured = null;
    const spawnMock = mock.method(childProcess, "spawn", (command, args, options) => {
      captured = { command, args, options };
      const child = new events.EventEmitter();
      child.stdout = new events.EventEmitter();
      child.stderr = new events.EventEmitter();
      child.stdin = {
        write() {},
        end() {},
      };
      queueMicrotask(() => {
        child.stdout.emit("data", "session_id: 20260418_1\n© Resumed session\noutput::\nWarm check-in.\n::end");
        child.emit("close", 0);
      });
      return child;
    });

    const result = await runHermesCheckin({
      config: {
        command: "hermes",
        args: ["--resume", "20260417_140020_0b84f5"],
        timeoutMs: 30000,
      },
      context: { entries: [], counts: { totalEntries: 0, redactedEntries: 0 } },
      now: new Date(2026, 3, 17, 17, 0, 0, 0),
      slotLabel: "5:00 PM Check-in",
    });

    spawnMock.mock.restore();
    assert.deepStrictEqual(captured, {
      command: "hermes",
      args: [
        "chat",
        "-q",
        buildPrompt({
          now: new Date(2026, 3, 17, 17, 0, 0, 0),
          slotLabel: "5:00 PM Check-in",
          context: { entries: [], counts: { totalEntries: 0, redactedEntries: 0 } },
        }),
        "-Q",
        "--resume",
        "20260417_140020_0b84f5",
      ],
      options: captured.options,
    });
    assert.ok(captured.options.env.PATH.includes("/.local/bin"));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.cleanedText, "Warm check-in.");
    assert.strictEqual(result.cleanedChanged, true);
  });

  it("uses cleaned output even if hermes exits non-zero", async () => {
    const spawnMock = mock.method(childProcess, "spawn", () => {
      const child = new events.EventEmitter();
      child.stdout = new events.EventEmitter();
      child.stderr = new events.EventEmitter();
      child.stdin = {
        write() {},
        end() {},
      };
      queueMicrotask(() => {
        child.stdout.emit("data", "session_id: 20260418_1\nFinal: Keep the pace light and finish one clean thing.");
        child.emit("close", 1);
      });
      return child;
    });

    const result = await runHermesCheckin({
      config: {
        command: "hermes",
        args: ["--resume", "20260417_140020_0b84f5"],
        timeoutMs: 30000,
      },
      context: { entries: [], counts: { totalEntries: 0, redactedEntries: 0 } },
      now: new Date(2026, 3, 17, 17, 0, 0, 0),
      slotLabel: "5:00 PM Check-in",
    });

    spawnMock.mock.restore();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.cleanedText, "Keep the pace light and finish one clean thing.");
    assert.strictEqual(result.code, "nonzero_with_output");
  });

  it("returns a non-logging command_not_found result for ENOENT", async () => {
    const logs = [];
    const spawnMock = mock.method(childProcess, "spawn", () => {
      const child = new events.EventEmitter();
      child.stdout = new events.EventEmitter();
      child.stderr = new events.EventEmitter();
      child.stdin = {
        write() {},
        end() {},
      };
      queueMicrotask(() => {
        const err = new Error("spawn hermes ENOENT");
        err.code = "ENOENT";
        child.emit("error", err);
      });
      return child;
    });

    const result = await runHermesCheckin({
      config: {
        command: "hermes",
        args: [],
        timeoutMs: 30000,
      },
      context: { entries: [], counts: { totalEntries: 0, redactedEntries: 0 } },
      now: new Date(2026, 3, 17, 17, 0, 0, 0),
      slotLabel: "5:00 PM Check-in",
      logger: (msg) => logs.push(msg),
    });

    spawnMock.mock.restore();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "command_not_found");
    assert.match(result.message, /command was not found: hermes/);
    assert.deepStrictEqual(logs, []);
  });
});
