"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { shellSplit, parseSshTarget, parseGgTarget, parsePsLines } = require("../src/remote-ssh-detector");

describe("remote SSH detector", () => {
  it("splits simple quoted shell commands", () => {
    assert.deepStrictEqual(shellSplit('ssh "user@my host"'), ["ssh", "user@my host"]);
  });

  it("parses common ssh targets", () => {
    assert.strictEqual(parseSshTarget("ssh my-server"), "my-server");
    assert.strictEqual(parseSshTarget("ssh user@example.com"), "user@example.com");
    assert.strictEqual(parseSshTarget("ssh -p 2222 user@example.com"), "user@example.com");
    assert.strictEqual(parseSshTarget("ssh -p2222 -J jump user@example.com"), "user@example.com");
  });

  it("ignores managed Clawd tunnel ssh commands", () => {
    assert.strictEqual(
      parseSshTarget('ssh -f -N -M -S /Users/me/.clawd/remote-tunnels/1.sock -R 127.0.0.1:23333:127.0.0.1:23334 user@example.com'),
      null
    );
  });

  it("parses goto-ssh gg aliases", () => {
    assert.strictEqual(parseGgTarget("gg my-server"), "my-server");
    assert.strictEqual(parseGgTarget("/opt/homebrew/bin/gg -f /tmp/goto my-server"), "my-server");
    assert.strictEqual(parseGgTarget("gg -- my-server"), "my-server");
    assert.strictEqual(parseGgTarget("gg -v"), null);
    assert.strictEqual(parseGgTarget("gg version"), null);
  });

  it("extracts unique targets from ps output", () => {
    const targets = parsePsLines([
      "123 ssh user@one",
      "124 /usr/bin/ssh -p 2222 two",
      "125 sftp files",
      "126 ssh user@one",
      "127 /opt/homebrew/bin/gg three",
    ].join("\n"));
    assert.deepStrictEqual(targets, ["user@one", "two", "three"]);
  });
});
