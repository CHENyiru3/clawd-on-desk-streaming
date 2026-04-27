"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const createRemoteSshBridgeManager = require("../src/remote-ssh-bridge-manager");

function makeManager({
  hosts = {},
  prompt = async () => "allow",
  psOutput = "101 ssh user@host\n",
  now = () => 1000,
  retryMs = 100000,
  deployError = null,
} = {}) {
  let snapshot = {
    remoteSshAutoBridgeEnabled: true,
    remoteSshTrustedHosts: hosts,
  };
  const updates = [];
  const commands = [];
  const manager = createRemoteSshBridgeManager({
    pollMs: 100000,
    retryMs,
    now,
    getSnapshot: () => snapshot,
    updateTrustedHosts(next) {
      snapshot = { ...snapshot, remoteSshTrustedHosts: next };
      updates.push(next);
      return { status: "ok" };
    },
    promptTarget: prompt,
    execFile(command, args, _options, callback) {
      commands.push([command, args]);
      if (command === "ps") {
        callback(null, psOutput, "");
        return;
      }
      if (deployError) {
        callback(new Error(deployError), "", deployError);
        return;
      }
      callback(null, "ok", "");
    },
    deployScript: "/repo/scripts/remote-deploy.sh",
  });
  return { manager, updates, commands, getSnapshot: () => snapshot };
}

describe("remote SSH bridge manager", () => {
  it("prompts for unknown hosts and runs remote-deploy on approval", async () => {
    const { manager, commands, getSnapshot } = makeManager();
    await manager.scanOnce();
    assert.ok(commands.some(([cmd, args]) => cmd === "bash" && args.join(" ") === "/repo/scripts/remote-deploy.sh user@host --auto"));
    assert.strictEqual(getSnapshot().remoteSshTrustedHosts["user@host"].lastStatus, "ok");
  });

  it("remembers denied hosts and does not run deploy", async () => {
    const { manager, commands, getSnapshot } = makeManager({ prompt: async () => "deny" });
    await manager.scanOnce();
    assert.strictEqual(getSnapshot().remoteSshTrustedHosts["user@host"].enabled, false);
    assert.ok(!commands.some(([cmd]) => cmd === "bash"));
  });

  it("skips fresh trusted hosts unless forced", async () => {
    const { manager, commands } = makeManager({
      hosts: {
        "user@host": {
          target: "user@host",
          enabled: true,
          lastStatus: "ok",
          lastCheckedAt: 900,
        },
      },
    });
    await manager.scanOnce();
    assert.ok(!commands.some(([cmd]) => cmd === "bash"));
    await manager.ensureTarget("user@host", { force: true });
    assert.ok(commands.some(([cmd]) => cmd === "bash"));
  });

  it("does not repeatedly deploy an ok host during one app run", async () => {
    let currentNow = 200000;
    const { manager, commands } = makeManager({
      retryMs: 100,
      now: () => currentNow,
      hosts: {
        "user@host": {
          target: "user@host",
          enabled: true,
          lastStatus: "ok",
          lastCheckedAt: 1000,
        },
      },
    });
    await manager.scanOnce();
    assert.strictEqual(commands.filter(([cmd]) => cmd === "bash").length, 1);
    currentNow += 200000;
    await manager.scanOnce();
    assert.strictEqual(commands.filter(([cmd]) => cmd === "bash").length, 1);
  });

  it("backs off recent failed deploy attempts", async () => {
    const { manager, commands } = makeManager({
      hosts: {
        "user@host": {
          target: "user@host",
          enabled: true,
          lastStatus: "error",
          lastCheckedAt: 900,
          lastError: "failed",
        },
      },
    });
    await manager.scanOnce();
    assert.ok(!commands.some(([cmd]) => cmd === "bash"));
  });
});
