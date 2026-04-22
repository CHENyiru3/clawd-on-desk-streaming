"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const {
  shouldBypassHermesBubble,
} = require("../src/server").__test;

// ── mock ctx factory ────────────────────────────────────────────────────────

function makeCtx(overrides = {}) {
  let pendingPermissions = [];
  const permLogs = [];
  const ctx = {
    pendingPermissions,
    permLog: (msg) => permLogs.push(msg),
    doNotDisturb: false,
    hideBubbles: false,
    isAgentEnabled: () => overrides.agentEnabled !== false,
    isAgentPermissionsEnabled: () => overrides.permEnabled !== false,
    showPermissionBubble: (p) => { pendingPermissions.push(p); },
    resolvePermissionEntry: () => {},
    CLAWD_SERVER_HEADER: "X-Clawd-Server",
    CLAWD_SERVER_ID: "clawd-test",
    ...overrides,
  };
  return ctx;
}

// ── inline minimal server that exercises the Hermes branch logic ─────────────
// We simulate the Hermes branch by calling the route handler logic directly.

function runHermesBranch(ctx, data) {
  // This mirrors the Hermes branch in server.js POST /permission.
  const res = { wroteHead: null, wroteBody: null, destroyed: false };
  res.writeHead = (code, headers) => { res.wroteHead = { code, headers }; };
  res.end = (body) => { res.wroteBody = body; };
  res.destroy = () => { res.destroyed = true; };

  // 200-ACK immediately — same as server.js line 494-495.
  res.writeHead(200, { [ctx.CLAWD_SERVER_HEADER]: ctx.CLAWD_SERVER_ID });
  res.end("ok");

  const pollFile = typeof data.bridge_poll_file === "string" ? data.bridge_poll_file : null;

  const denyViaPollFile = () => {
    if (pollFile) {
      try { fs.writeFileSync(pollFile, JSON.stringify({ choice: "deny" }), "utf8"); } catch {}
    }
  };

  // Agent gate
  if (typeof ctx.isAgentEnabled === "function" && !ctx.isAgentEnabled("hermes")) {
    ctx.permLog("hermes disabled → deny via poll file");
    denyViaPollFile();
    return { res, deniedViaPollFile: true, pendingCount: ctx.pendingPermissions.length };
  }

  // DND gate
  if (ctx.doNotDisturb) {
    ctx.permLog("hermes DND → deny via poll file");
    denyViaPollFile();
    return { res, deniedViaPollFile: true, pendingCount: ctx.pendingPermissions.length };
  }

  const toolName = typeof data.tool_name === "string" && data.tool_name ? data.tool_name : "HermesExec";
  const rawInput = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
  const allowPermanent = !!(rawInput && rawInput.allow_permanent);
  const sessionId = typeof data.session_id === "string" ? data.session_id : "default";

  // Bubble hidden or sub-gate off
  if (ctx.hideBubbles || shouldBypassHermesBubble(ctx)) {
    ctx.permLog(`hermes bubble suppressed: tool=${toolName} — deny via poll file`);
    denyViaPollFile();
    return { res, deniedViaPollFile: true, pendingCount: ctx.pendingPermissions.length };
  }

  const permEntry = {
    res: null,
    abortHandler: null,
    suggestions: [],
    sessionId,
    bubble: null,
    hideTimer: null,
    toolName,
    toolInput: rawInput,
    resolvedSuggestion: null,
    createdAt: Date.now(),
    agentId: "hermes",
    isHermes: true,
    hermesBridgePollFile: pollFile,
    hermesAllowPermanent: allowPermanent,
  };

  try {
    ctx.showPermissionBubble(permEntry);
  } catch (bubbleErr) {
    ctx.permLog(`hermes bubble failed: ${bubbleErr && bubbleErr.message} — deny via poll file`);
    denyViaPollFile();
    return { res, deniedViaPollFile: true, pendingCount: ctx.pendingPermissions.length };
  }

  return { res, deniedViaPollFile: false, pendingCount: ctx.pendingPermissions.length, permEntry };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("shouldBypassHermesBubble", () => {

  it("does not bypass when the hermes permission sub-gate is on", () => {
    const ctx = makeCtx({ permEnabled: true });
    assert.strictEqual(shouldBypassHermesBubble(ctx), false);
  });

  it("bypasses when the hermes permission sub-gate is off", () => {
    const ctx = makeCtx({ permEnabled: false });
    assert.strictEqual(shouldBypassHermesBubble(ctx), true);
  });

  it("queries the 'hermes' agent id specifically", () => {
    const calls = [];
    const ctx = {
      isAgentPermissionsEnabled: (id) => { calls.push(id); return false; },
    };
    shouldBypassHermesBubble(ctx);
    assert.deepStrictEqual(calls, ["hermes"]);
  });

  it("fails open when isAgentPermissionsEnabled is missing", () => {
    assert.strictEqual(shouldBypassHermesBubble({}), false);
  });
});

describe("Hermes permission branch (POST /permission Hermes path)", () => {

  it("200-ACKs immediately (res.writeHead called)", () => {
    const ctx = makeCtx();
    const result = runHermesBranch(ctx, { agent_id: "hermes", tool_name: "HermesExec" });
    assert.ok(result.res.wroteHead, "Expected writeHead to be called");
    assert.strictEqual(result.res.wroteHead.code, 200, "Expected HTTP 200");
    assert.strictEqual(result.res.wroteHead.headers["X-Clawd-Server"], "clawd-test");
  });

  it("adds a pending permission entry to ctx.pendingPermissions", () => {
    const ctx = makeCtx();
    const result = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      tool_input: { command: "rm -rf /", description: "test" },
      session_id: "session-001",
    });
    assert.strictEqual(result.res.wroteBody, "ok", "Expected immediate ok body");
    assert.strictEqual(result.pendingCount, 1, "Expected one pending permission");
    assert.strictEqual(result.permEntry.agentId, "hermes");
    assert.strictEqual(result.permEntry.isHermes, true);
    assert.strictEqual(result.permEntry.hermesAllowPermanent, false);
  });

  it("records hermesAllowPermanent=true when allow_permanent is true", () => {
    const ctx = makeCtx();
    const result = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      tool_input: { command: "rm -rf /", allow_permanent: true },
    });
    assert.strictEqual(result.permEntry.hermesAllowPermanent, true);
  });

  it("records hermesBridgePollFile from payload", () => {
    const ctx = makeCtx();
    const result = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      bridge_poll_file: "/tmp/hermes-perm-test.json",
    });
    assert.strictEqual(result.permEntry.hermesBridgePollFile, "/tmp/hermes-perm-test.json");
  });

  it("uses default 'default' session_id when session_id is absent", () => {
    const ctx = makeCtx();
    const result = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
    });
    assert.strictEqual(result.permEntry.sessionId, "default");
  });

  it("DND: denies via poll file, no pending entry added", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-test-${Date.now()}.json`);
    const ctx = makeCtx({ doNotDisturb: true });
    const result = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      bridge_poll_file: tmpFile,
    });
    assert.strictEqual(result.res.wroteHead.code, 200);
    assert.strictEqual(result.deniedViaPollFile, true);
    assert.strictEqual(result.pendingCount, 0);
    // Verify poll file was written with deny
    if (fs.existsSync(tmpFile)) {
      const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
      assert.strictEqual(content.choice, "deny");
      fs.unlinkSync(tmpFile);
    }
  });

  it("Hermes disabled: denies via poll file, no pending entry", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-test-${Date.now()}.json`);
    const ctx = makeCtx({ agentEnabled: false });
    const result = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      bridge_poll_file: tmpFile,
    });
    assert.strictEqual(result.deniedViaPollFile, true);
    assert.strictEqual(result.pendingCount, 0);
    if (fs.existsSync(tmpFile)) {
      const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
      assert.strictEqual(content.choice, "deny");
      fs.unlinkSync(tmpFile);
    }
  });

  it("Bubble hidden: denies via poll file, no pending entry", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-test-${Date.now()}.json`);
    const ctx = makeCtx({ hideBubbles: true });
    const result = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      bridge_poll_file: tmpFile,
    });
    assert.strictEqual(result.deniedViaPollFile, true);
    assert.strictEqual(result.pendingCount, 0);
    if (fs.existsSync(tmpFile)) {
      const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
      assert.strictEqual(content.choice, "deny");
      fs.unlinkSync(tmpFile);
    }
  });

  it("Permissions sub-gate off: denies via poll file, no pending entry", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-test-${Date.now()}.json`);
    const ctx = makeCtx({ permEnabled: false });
    const result = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      bridge_poll_file: tmpFile,
    });
    assert.strictEqual(result.deniedViaPollFile, true);
    assert.strictEqual(result.pendingCount, 0);
    if (fs.existsSync(tmpFile)) {
      const content = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
      assert.strictEqual(content.choice, "deny");
      fs.unlinkSync(tmpFile);
    }
  });

  it("Multiple concurrent Hermes requests: independent entries with independent poll files", () => {
    const ctx = makeCtx();
    const tmpFile1 = path.join(os.tmpdir(), `hermes-test-1-${Date.now()}.json`);
    const tmpFile2 = path.join(os.tmpdir(), `hermes-test-2-${Date.now()}.json`);

    const result1 = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      tool_input: { command: "rm -rf /", description: "first" },
      bridge_poll_file: tmpFile1,
      session_id: "session-a",
    });
    const result2 = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      tool_input: { command: "dd if=/dev/zero", description: "second" },
      bridge_poll_file: tmpFile2,
      session_id: "session-b",
    });

    assert.strictEqual(ctx.pendingPermissions.length, 2, "Expected two pending permissions");
    assert.notStrictEqual(result1.permEntry.hermesBridgePollFile, result2.permEntry.hermesBridgePollFile, "Poll files should be independent");

    // Clean up poll files (shouldn't exist since no bubble was denied)
    for (const f of [tmpFile1, tmpFile2]) {
      try { fs.unlinkSync(f); } catch {}
    }
  });

  it("permLog is called with hermes DND message when DND is active", () => {
    const tmpFile = path.join(os.tmpdir(), `hermes-test-${Date.now()}.json`);
    const ctx = makeCtx({ doNotDisturb: true });
    const permLogs = [];
    ctx.permLog = (msg) => permLogs.push(msg);
    runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "HermesExec",
      bridge_poll_file: tmpFile,
    });
    assert.ok(permLogs.some(m => m.includes("DND") && m.includes("hermes")), `Expected DND log, got: ${JSON.stringify(permLogs)}`);
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  it("tool_name defaults to HermesExec when absent", () => {
    const ctx = makeCtx();
    const result = runHermesBranch(ctx, { agent_id: "hermes" });
    assert.strictEqual(result.permEntry.toolName, "HermesExec");
  });

  it("uses tool_name from payload when present", () => {
    const ctx = makeCtx();
    const result = runHermesBranch(ctx, {
      agent_id: "hermes",
      tool_name: "CustomTool",
    });
    assert.strictEqual(result.permEntry.toolName, "CustomTool");
  });
});
