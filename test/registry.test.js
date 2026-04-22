const { describe, it } = require("node:test");
const assert = require("node:assert");
const registry = require("../agents/registry");

describe("Agent Registry", () => {
  it("should return all seven agents", () => {
    const agents = registry.getAllAgents();
    assert.strictEqual(agents.length, 7);
    const ids = agents.map((a) => a.id);
    assert.ok(ids.includes("claude-code"));
    assert.ok(ids.includes("codex"));
    assert.ok(ids.includes("copilot-cli"));
    assert.ok(ids.includes("gemini-cli"));
    assert.ok(ids.includes("codebuddy"));
    assert.ok(ids.includes("kiro-cli"));
    assert.ok(ids.includes("opencode"));
  });

  it("should look up agents by ID", () => {
    assert.strictEqual(registry.getAgent("claude-code").name, "Claude Code");
    assert.strictEqual(registry.getAgent("codex").name, "Codex CLI");
    assert.strictEqual(registry.getAgent("copilot-cli").name, "Copilot CLI");
    assert.strictEqual(registry.getAgent("gemini-cli").name, "Gemini CLI");
    assert.strictEqual(registry.getAgent("codebuddy").name, "CodeBuddy");
    assert.strictEqual(registry.getAgent("kiro-cli").name, "Kiro CLI");
    assert.strictEqual(registry.getAgent("nonexistent"), undefined);
  });

  it("should aggregate all process names", () => {
    const all = registry.getAllProcessNames();
    assert.ok(all.length >= 5);
    const names = all.map((p) => p.name);
    // Should contain at least one entry per agent (platform-dependent)
    const agentIds = [...new Set(all.map((p) => p.agentId))];
    assert.ok(agentIds.includes("claude-code"));
    assert.ok(agentIds.includes("codex"));
    assert.ok(agentIds.includes("copilot-cli"));
    assert.ok(agentIds.includes("gemini-cli"));
    assert.ok(agentIds.includes("kiro-cli"));
  });

  it("should have correct capabilities", () => {
    const cc = registry.getAgent("claude-code");
    assert.strictEqual(cc.capabilities.httpHook, true);
    assert.strictEqual(cc.capabilities.permissionApproval, true);
    assert.strictEqual(cc.capabilities.sessionEnd, true);
    assert.strictEqual(cc.capabilities.subagent, true);

    const codex = registry.getAgent("codex");
    assert.strictEqual(codex.capabilities.httpHook, false);
    assert.strictEqual(codex.capabilities.permissionApproval, false);
    assert.strictEqual(codex.capabilities.sessionEnd, false);
    assert.strictEqual(codex.capabilities.subagent, false);

    const copilot = registry.getAgent("copilot-cli");
    assert.strictEqual(copilot.capabilities.httpHook, false);
    assert.strictEqual(copilot.capabilities.permissionApproval, false);
    assert.strictEqual(copilot.capabilities.sessionEnd, true);
    assert.strictEqual(copilot.capabilities.subagent, true);

    const gemini = registry.getAgent("gemini-cli");
    assert.strictEqual(gemini.capabilities.httpHook, false);
    assert.strictEqual(gemini.capabilities.permissionApproval, false);
    assert.strictEqual(gemini.capabilities.sessionEnd, true);
    assert.strictEqual(gemini.capabilities.subagent, false);

    const kiro = registry.getAgent("kiro-cli");
    assert.strictEqual(kiro.capabilities.httpHook, false);
    assert.strictEqual(kiro.capabilities.permissionApproval, false);
    assert.strictEqual(kiro.capabilities.sessionEnd, false);
    assert.strictEqual(kiro.capabilities.subagent, false);
  });

  it("should have eventMap for hook-based agents", () => {
    const cc = registry.getAgent("claude-code");
    assert.strictEqual(cc.eventMap.SessionStart, "idle");
    assert.strictEqual(cc.eventMap.PreToolUse, "working");
    assert.strictEqual(cc.eventMap.Stop, "attention");

    const copilot = registry.getAgent("copilot-cli");
    assert.strictEqual(copilot.eventMap.sessionStart, "idle");
    assert.strictEqual(copilot.eventMap.preToolUse, "working");
    assert.strictEqual(copilot.eventMap.agentStop, "attention");

    const gemini = registry.getAgent("gemini-cli");
    assert.strictEqual(gemini.eventMap.SessionStart, "idle");
    assert.strictEqual(gemini.eventMap.BeforeTool, "working");
    assert.strictEqual(gemini.eventMap.AfterAgent, "attention");
  });

  it("should have logEventMap for poll-based agents", () => {
    const codex = registry.getAgent("codex");
    assert.strictEqual(codex.logEventMap["session_meta"], "idle");
    assert.strictEqual(codex.logEventMap["event_msg:task_started"], "thinking");
    assert.strictEqual(codex.logEventMap["event_msg:exec_command_end"], "working");
    assert.strictEqual(codex.logEventMap["event_msg:patch_apply_end"], "working");
    assert.strictEqual(codex.logEventMap["event_msg:custom_tool_call_output"], "working");
    assert.strictEqual(codex.logEventMap["event_msg:task_complete"], "codex-turn-end");
    assert.strictEqual(codex.logEventMap["event_msg:turn_aborted"], "idle");
  });
});
