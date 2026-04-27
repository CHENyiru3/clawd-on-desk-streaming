"use strict";

const SSH_OPTIONS_WITH_VALUE = new Set([
  "-b", "-c", "-D", "-E", "-e", "-F", "-I", "-i", "-J", "-L", "-l", "-m",
  "-O", "-o", "-p", "-Q", "-R", "-S", "-W", "-w"
]);

const GG_OPTIONS_WITH_VALUE = new Set(["-d", "-e", "-f", "-l", "-s"]);
const GG_COMMAND_WORDS = new Set(["help", "version"]);

function shellSplit(command) {
  if (typeof command !== "string" || !command.trim()) return [];
  const out = [];
  let current = "";
  let quote = null;
  let escaping = false;
  for (const ch of command) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (escaping) current += "\\";
  if (current) out.push(current);
  return out;
}

function basename(command) {
  if (typeof command !== "string") return "";
  const normalized = command.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function isClawdManagedSsh(tokens) {
  return tokens.includes("-N")
    && (tokens.includes("-R") || tokens.some((token) => token.startsWith("-R")))
    && (
      tokens.includes("-S")
      || tokens.some((token) => token.includes(".clawd/remote-tunnels"))
      || tokens.some((token) => token.includes("127.0.0.1:23333:127.0.0.1"))
    );
}

function normalizeTarget(rawTarget, options = {}) {
  if (typeof rawTarget !== "string") return null;
  const target = rawTarget.trim();
  if (!target || target.startsWith("-")) return null;
  if (target.includes("=")) return null;
  if (target.includes("/") && !target.includes("@")) return null;
  if (target === "localhost" || target === "127.0.0.1" || target === "::1") {
    if (!options.allowLocalhost) return null;
  }
  return target;
}

function parseSshTarget(command, options = {}) {
  const tokens = Array.isArray(command) ? command.slice() : shellSplit(command);
  if (tokens.length < 2) return null;
  const cmd = basename(tokens[0]);
  if (cmd !== "ssh") return null;
  if (isClawdManagedSsh(tokens)) return null;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (token === "--") {
      return normalizeTarget(tokens[i + 1], options);
    }
    if (token.startsWith("-")) {
      if (SSH_OPTIONS_WITH_VALUE.has(token)) i++;
      else {
        const opt = token.slice(0, 2);
        if (SSH_OPTIONS_WITH_VALUE.has(opt) && token.length > 2) {
          // Combined short option with inline value, e.g. -p2222.
        }
      }
      continue;
    }
    return normalizeTarget(token, options);
  }
  return null;
}

function parseGgTarget(command, options = {}) {
  const tokens = Array.isArray(command) ? command.slice() : shellSplit(command);
  if (tokens.length < 2) return null;
  const cmd = basename(tokens[0]);
  if (cmd !== "gg") return null;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (token === "--") {
      return normalizeTarget(tokens[i + 1], options);
    }
    if (token === "--help" || token === "-h" || token === "-v") return null;
    if (token.startsWith("-")) {
      if (GG_OPTIONS_WITH_VALUE.has(token)) i++;
      continue;
    }
    if (GG_COMMAND_WORDS.has(token)) return null;
    return normalizeTarget(token, options);
  }
  return null;
}

function parseRemoteTarget(command, options = {}) {
  return parseSshTarget(command, options) || parseGgTarget(command, options);
}

function parsePsLines(output, options = {}) {
  if (typeof output !== "string" || !output.trim()) return [];
  const seen = new Set();
  const targets = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^\d+\s+(.+)$/);
    const command = match ? match[1] : trimmed;
    if (/\/?(scp|sftp)(\s|$)/.test(command)) continue;
    const target = parseRemoteTarget(command, options);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  return targets;
}

module.exports = {
  shellSplit,
  parseSshTarget,
  parseGgTarget,
  parseRemoteTarget,
  parsePsLines,
};
