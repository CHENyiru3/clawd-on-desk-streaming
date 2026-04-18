"use strict";

const { describe, it, mock } = require("node:test");
const assert = require("node:assert");
const events = require("node:events");

const childProcess = require("child_process");
const { buildPrompt, buildFallbackMessage, runHermesCheckin } = require("../src/hermes-checkin");

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
  });

  it("builds a local fallback message", () => {
    const message = buildFallbackMessage({
      now: new Date(2026, 3, 17, 17, 0, 0, 0),
      context: { counts: { totalEntries: 0 } },
    });
    assert.match(message, /It's 5:00 PM/);
  });

  it("runs hermes through non-interactive chat mode while preserving resume args", async () => {
    let captured = null;
    const spawnMock = mock.method(childProcess, "spawn", (command, args) => {
      captured = { command, args };
      const child = new events.EventEmitter();
      child.stdout = new events.EventEmitter();
      child.stderr = new events.EventEmitter();
      child.stdin = {
        write() {},
        end() {},
      };
      queueMicrotask(() => {
        child.stdout.emit("data", "Warm check-in");
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
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.text, "Warm check-in");
  });
});
