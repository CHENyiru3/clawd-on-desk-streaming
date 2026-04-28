"use strict";

const { describe, it, mock } = require("node:test");
const assert = require("node:assert");
const events = require("node:events");
const fs = require("fs");
const os = require("os");
const path = require("path");

const childProcess = require("child_process");
const { initHistory, clearHistory, sendMessage } = require("../src/hermes-chat");

describe("hermes-chat", () => {
  it("spawns Hermes with the CLI PATH and permission bridge env", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-hermes-chat-"));
    initHistory(tmpDir);
    clearHistory();

    let captured = null;
    const spawnMock = mock.method(childProcess, "spawn", (command, args, options) => {
      captured = { command, args, options };
      const child = new events.EventEmitter();
      child.stdout = new events.EventEmitter();
      child.stderr = new events.EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit("data", "Done.");
        child.emit("close", 0);
      });
      return child;
    });

    const result = await new Promise((resolve) => {
      sendMessage({
        text: "hello",
        config: { command: "hermes", args: [], cwd: "", timeoutMs: 30000 },
        ctx: { clawdServerPort: 24567, hermesSessionId: "test-session" },
        onToken() {},
        onComplete: (ok, message, code) => resolve({ ok, message, code }),
      });
    });

    spawnMock.mock.restore();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(captured.command, "hermes");
    assert.deepStrictEqual(captured.args.slice(0, 2), ["chat", "-q"]);
    assert.ok(captured.options.env.PATH.includes("/.local/bin"));
    assert.match(captured.options.env.PYTHONPATH, /hooks/);
    assert.strictEqual(captured.options.env.HERMES_PERMISSION_ENABLED, "1");
    assert.strictEqual(captured.options.env.CLAWD_PERMISSION_URL, "http://127.0.0.1:24567/permission");
    assert.strictEqual(captured.options.env.HERMES_SESSION_KEY, "test-session");
  });
});
