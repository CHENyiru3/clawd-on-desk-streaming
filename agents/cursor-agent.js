// Cursor IDE — Agent (Composer) hooks via ~/.cursor/hooks.json
// Event names are camelCase (Cursor hook spec); cursor-hook.js normalizes to PascalCase for the state machine.

module.exports = {
  id: "cursor-agent",
  name: "Cursor Agent",
  processNames: ["Cursor"],
  eventSource: "hook",
  eventMap: {
    sessionStart: "idle",
    sessionEnd: "sleeping",
    beforeSubmitPrompt: "thinking",
    preToolUse: "working",
    postToolUse: "working",
    postToolUseFailure: "working",
    stop: "attention",
    subagentStart: "juggling",
    subagentStop: "working",
    preCompact: "sweeping",
    afterAgentThought: "thinking",
  },
  capabilities: {
    httpHook: false,
    permissionApproval: false,
    sessionEnd: true,
    subagent: true,
  },
  hookConfig: {
    configFormat: "cursor-hooks-json",
  },
  stdinFormat: "cursorHookJson",
  pidField: "cursor_pid",
};
