// Agent registry — loads all agent configs, provides lookup API
// Used by main.js for process detection and session tracking

const claudeCode = require("./claude-code");
const codex = require("./codex");
const copilotCli = require("./copilot-cli");
const geminiCli = require("./gemini-cli");
const codebuddy = require("./codebuddy");
const kiroCli = require("./kiro-cli");
const opencode = require("./opencode");

const AGENTS = [claudeCode, codex, copilotCli, geminiCli, codebuddy, kiroCli, opencode];
const AGENT_MAP = new Map(AGENTS.map((a) => [a.id, a]));

module.exports = {
  getAllAgents: () => AGENTS,
  getAgent: (id) => AGENT_MAP.get(id),

  // Aggregate all agent process names for detectRunningAgentProcesses()
  getAllProcessNames: () => {
    const result = [];
    for (const a of AGENTS) {
      const names = a.processNames;
      for (const n of names) result.push({ name: n, agentId: a.id });
    }
    return result;
  },
};
