"use strict";

function normalizeSession(sessionId, session, statePriority) {
  if (!session || !session.sourcePid || session.headless) return null;
  return {
    sessionId,
    sourcePid: session.sourcePid,
    cwd: session.cwd || "",
    editor: session.editor || null,
    pidChain: Array.isArray(session.pidChain) ? session.pidChain : null,
    updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : 0,
    priority: statePriority && session.state ? (statePriority[session.state] || 0) : 0,
    label: session.cwd || session.editor || `PID ${session.sourcePid}`,
  };
}

function pickTerminalDiagnosticsTarget(sessions, statePriority) {
  const candidates = [];
  const iterable = sessions instanceof Map ? sessions.entries() : Object.entries(sessions || {});
  for (const [sessionId, session] of iterable) {
    const normalized = normalizeSession(sessionId, session, statePriority);
    if (normalized) candidates.push(normalized);
  }
  if (!candidates.length) {
    return {
      ok: false,
      reason: "no_target",
      message: "No terminal target available.",
    };
  }
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.updatedAt - a.updatedAt;
  });
  return {
    ok: true,
    target: candidates[0],
  };
}

async function runTerminalDiagnosticsCheck({ sessions, statePriority, executeFocus }) {
  const picked = pickTerminalDiagnosticsTarget(sessions, statePriority);
  if (!picked.ok) {
    return {
      ok: false,
      reason: picked.reason,
      message: picked.message,
    };
  }
  const target = picked.target;
  const result = await executeFocus(target);
  return {
    ...result,
    targetPid: target.sourcePid,
    targetLabel: target.label,
    sessionId: target.sessionId,
  };
}

module.exports = {
  pickTerminalDiagnosticsTarget,
  runTerminalDiagnosticsCheck,
};
