"use strict";

// ── Preferences (pure data layer) ──
//
// This module is the canonical schema definition + load/save/migrate/validate
// for `clawd-prefs.json`. It has zero dependencies on Electron, the store, the
// controller, or anything stateful — it deals in plain snapshots.
//
// `load(prefsPath)`  — read file, migrate to current version, validate, return snapshot
// `save(prefsPath, snapshot)` — validate (lightly) + write JSON
// `getDefaults()` — fresh defaults snapshot (every call returns a new object — never share refs)
// `validate(snapshot)` — coerces an arbitrary object into a valid snapshot, dropping bad fields
// `migrate(raw)` — applies version-to-version migrations, returns the upgraded raw snapshot
//
// Bad-file handling: read failure → backup as `clawd-prefs.json.bak` → return defaults.
// Future-version handling: read succeeds but version > current → warn + refuse to overwrite
//   (caller still gets a valid snapshot, but `save()` becomes a no-op via the locked flag).

const fs = require("fs");
const path = require("path");
const { isPlainObject } = require("./theme-loader");
const { defaultProviderUsageCheckerScriptPath } = require("./provider-usage-checker-path");

const CURRENT_VERSION = 1;

// ── Schema ──
// Each field has: type, default OR defaultFactory, optional enum/normalize/validate.
// `defaultFactory` is required for object/array fields so callers never share references.
const SCHEMA = {
  version: {
    type: "number",
    default: CURRENT_VERSION,
  },
  // Window state
  x: { type: "number", default: 0, validate: (v) => Number.isFinite(v) },
  y: { type: "number", default: 0, validate: (v) => Number.isFinite(v) },
  positionSaved: { type: "boolean", default: false },
  size: {
    type: "string",
    default: "P:10",
    // Accept "S"/"M"/"L" (legacy) or "P:<num>" — full migration happens elsewhere.
    validate: (v) =>
      typeof v === "string" &&
      (v === "S" || v === "M" || v === "L" || /^P:\d+(?:\.\d+)?$/.test(v)),
  },
  // Mini mode runtime state (persisted so Mini Mode survives restart)
  miniMode: { type: "boolean", default: false },
  miniEdge: { type: "string", default: "right", enum: ["left", "right"] },
  preMiniX: { type: "number", default: 0, validate: (v) => Number.isFinite(v) },
  preMiniY: { type: "number", default: 0, validate: (v) => Number.isFinite(v) },
  // Pure data prefs
  lang: { type: "string", default: "en", enum: ["en", "zh"] },
  showTray: { type: "boolean", default: true },
  showDock: { type: "boolean", default: true },
  manageClaudeHooksAutomatically: { type: "boolean", default: true },
  autoStartWithClaude: { type: "boolean", default: false },
  // System-backed: actual truth lives in OS login items / autostart files.
  // `openAtLoginHydrated` starts false; main.js's startup hydrate helper imports
  // the current system value into prefs on first run, then flips this flag.
  // Without hydration, an upgrading user with login-startup already enabled
  // would see prefs report `false` and have it written back to the system.
  openAtLogin: { type: "boolean", default: false },
  openAtLoginHydrated: { type: "boolean", default: false },
  bubbleFollowPet: { type: "boolean", default: false },
  hideBubbles: { type: "boolean", default: false },
  showSessionId: { type: "boolean", default: false },
  soundMuted: { type: "boolean", default: false },
  translateProvider: { type: "string", default: "minimax", enum: ["minimax"] },
  translateApiKey: {
    type: "string",
    default: "",
    normalize: (v) => (typeof v === "string" ? v.trim() : ""),
  },
  macTypingAwarenessEnabled: { type: "boolean", default: process.platform === "darwin" },
  macTypingPermissionPrompted: { type: "boolean", default: false },
  macTypingPermissionDismissed: { type: "boolean", default: false },
  globalActivityEnabled: { type: "boolean", default: process.platform === "darwin" },
  globalActivityRules: {
    type: "object",
    defaultFactory: () => ({
      clipboardReaction: process.platform === "darwin",
      notificationReaction: process.platform === "darwin",
      presenceWake: process.platform === "darwin",
      mediaPlaybackReaction: process.platform === "darwin",
      browserReadingReaction: process.platform === "darwin",
    }),
    normalize: normalizeGlobalActivityRules,
  },
  globalActivityOnboardingShown: { type: "boolean", default: false },
  remoteSshAutoBridgeEnabled: { type: "boolean", default: process.platform === "darwin" || process.platform === "linux" },
  remoteSshTrustedHosts: {
    type: "object",
    defaultFactory: () => ({}),
    normalize: normalizeRemoteSshTrustedHosts,
  },
  timeCheckinEnabled: { type: "boolean", default: process.platform === "darwin" },
  timeCheckinScheduleMode: {
    type: "string",
    default: "hourly",
    enum: ["hourly", "twoHourWithAnchors"],
  },
  timeCheckinGenerator: {
    type: "object",
    defaultFactory: () => ({
      cwd: "/Users/eric_yiru/Desktop/Home",
      command: "hermes",
      args: ["--resume", "20260417_140020_0b84f5"],
      timeoutMs: 120000,
    }),
    normalize: normalizeTimeCheckinGenerator,
  },
  timeCheckinPreviewClipboardWindowMinutes: {
    type: "number",
    default: 60,
    validate: (v) => Number.isInteger(v) && v > 0 && v <= 24 * 60,
  },
  timeCheckinLastRunAt: {
    type: "number",
    default: null,
    allowNull: true,
    validate: (v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0),
  },
  providerUsageHudEnabled: { type: "boolean", default: process.platform === "darwin" },
  providerUsageRefreshEnabled: { type: "boolean", default: process.platform === "darwin" },
  providerUsageLastRunAt: {
    type: "number",
    default: null,
    allowNull: true,
    validate: (v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0),
  },
  providerUsageMiniMaxEnabled: { type: "boolean", default: true },
  providerUsageDeepSeekEnabled: { type: "boolean", default: true },
  providerUsageStaleAfterMinutes: {
    type: "number",
    default: 30,
    validate: (v) => Number.isInteger(v) && v > 0 && v <= 24 * 60,
  },
  providerUsageChecker: {
    type: "object",
    defaultFactory: () => ({
      python: "python3",
      scriptPath: defaultProviderUsageCheckerScriptPath(),
      timeoutMs: 300000,
      browser: "auto",
    }),
    normalize: normalizeProviderUsageChecker,
  },
  // Theme
  theme: { type: "string", default: "clawd" },
  // Phase 2/3 placeholders — schema reserves the keys so future migrations don't need v2.
  agents: {
    type: "object",
    defaultFactory: () => ({
      "claude-code": { enabled: true, permissionsEnabled: true },
      "codex": { enabled: true, permissionsEnabled: true },
      "copilot-cli": { enabled: true, permissionsEnabled: true },
      "gemini-cli": { enabled: true, permissionsEnabled: true },
      "codebuddy": { enabled: true, permissionsEnabled: true },
      "kiro-cli": { enabled: true, permissionsEnabled: true },
      "opencode": { enabled: true, permissionsEnabled: true },
      // Hermes: CLI dangerous-command approvals routed through Clawd bubble.
      "hermes": { enabled: true, permissionsEnabled: true },
    }),
    normalize: normalizeAgents,
  },
  themeOverrides: {
    type: "object",
    defaultFactory: () => ({}),
    normalize: normalizeThemeOverrides,
  },
  // Phase 3b-swap: per-theme variant selection (e.g. {clawd: "chill", mycat: "default"}).
  // Missing key for a theme = use that theme's `default` variant. Unknown variantIds
  // get lenient-fallback to default at load time (see theme-loader._resolveVariant).
  themeVariant: {
    type: "object",
    defaultFactory: () => ({}),
    normalize: normalizeThemeVariant,
  },
  // Optional: spawn the system terminal with a CLI agent command (tray / pet gesture / focus fallback).
  agentLauncher: {
    type: "object",
    defaultFactory: () => ({
      enabled: true,
      command: "hermes",
      cwd: "",
      trigger: "focusFallback",
    }),
    normalize: normalizeAgentLauncher,
  },
  // Hermes Chat panel configuration (command, args, cwd, timeoutMs).
  // Used by hermes-chat.js to spawn `hermes chat -q` per turn.
  hermesChat: {
    type: "object",
    defaultFactory: () => ({
      command: "hermes",
      args: [],
      cwd: "",
      timeoutMs: 300000,
    }),
  },
};

const SCHEMA_KEYS = Object.freeze(Object.keys(SCHEMA));

function defaultFor(field) {
  if (typeof field.defaultFactory === "function") return field.defaultFactory();
  return field.default;
}

// Build a fresh defaults snapshot. Each call returns a brand-new object so
// callers can never accidentally mutate a shared default.
function getDefaults() {
  const out = {};
  for (const key of SCHEMA_KEYS) {
    out[key] = defaultFor(SCHEMA[key]);
  }
  return out;
}

function isValidValue(field, value) {
  if (value === undefined) return false;
  if (value === null) return field.allowNull === true;
  if (field.type === "object") {
    return typeof value === "object" && !Array.isArray(value);
  }
  if (typeof value !== field.type) return false;
  if (field.enum && !field.enum.includes(value)) return false;
  if (typeof field.validate === "function" && !field.validate(value)) return false;
  return true;
}

// Coerce an arbitrary object into a valid snapshot — drop bad fields, fill
// missing fields from defaults, run normalize() on objects.
function validate(raw) {
  const out = getDefaults();
  if (!raw || typeof raw !== "object") return out;
  for (const key of SCHEMA_KEYS) {
    if (!(key in raw)) continue;
    const field = SCHEMA[key];
    let value = raw[key];
    if (typeof field.normalize === "function" && field.type !== "object") {
      value = field.normalize(value, out[key]);
    }
    if (field.type === "object" && typeof field.normalize === "function") {
      value = field.normalize(value, out[key]);
    }
    if (isValidValue(field, value)) {
      out[key] = value;
    }
    // else: keep default already in `out`
  }
  return out;
}

// Apply version-to-version migrations on raw input. Returns the upgraded raw
// object (still needs to be passed through validate()).
//
// v0 → v1: add `version`, `agents`, `themeOverrides` fields. Existing fields
//   stay as-is and get re-validated downstream. Pre-existing prefs files have
//   no `version` key — that's the v0 marker.
function migrate(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const out = { ...raw };
  if (out.version === undefined || out.version === null) {
    out.version = 1;
    if (out.agents === undefined) {
      out.agents = SCHEMA.agents.defaultFactory();
    }
    if (out.themeOverrides === undefined) {
      out.themeOverrides = SCHEMA.themeOverrides.defaultFactory();
    }
  }
  // v1 backfill: positionSaved didn't exist before this field was added.
  // Existing users who have non-default x/y clearly had a saved position.
  if (out.positionSaved === undefined) {
    out.positionSaved =
      (typeof out.x === "number" && out.x !== 0) ||
      (typeof out.y === "number" && out.y !== 0);
  }
  // Future migrations slot in here as `if (out.version < N) { ... out.version = N }`.
  return out;
}

const AGENT_FLAGS = ["enabled", "permissionsEnabled"];

const AGENT_LAUNCHER_TRIGGER_LIST = Object.freeze([
  "menuOnly",
  "tripleClick",
  "focusFallback",
  "tripleAndFocus",
]);
const AGENT_LAUNCHER_TRIGGERS = new Set(AGENT_LAUNCHER_TRIGGER_LIST);
const AGENT_LAUNCHER_COMMAND_MAX = 256;
const AGENT_LAUNCHER_CWD_MAX = 4096;
const TIMECHECKIN_TIMEOUT_MIN = 5000;
const TIMECHECKIN_TIMEOUT_MAX = 120000;
const PROVIDER_USAGE_TIMEOUT_MIN = 5000;
const PROVIDER_USAGE_TIMEOUT_MAX = 300000;

/** Single-line command/path token — no shell metacharacters (prefs are untrusted). */
function sanitizeAgentLauncherCommand(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > AGENT_LAUNCHER_COMMAND_MAX) return null;
  if (/[\n\r\x00-\x1f;|&`$<>]/.test(s)) return null;
  return s;
}

function sanitizeAgentLauncherCwd(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  if (s.length > AGENT_LAUNCHER_CWD_MAX) return "";
  if (/[\n\r\x00-\x1f]/.test(s)) return "";
  if (/\.\./.test(s)) return "";
  return s;
}

function normalizeAgentLauncher(value, defaultsValue) {
  const d = defaultsValue || SCHEMA.agentLauncher.defaultFactory();
  if (!value || typeof value !== "object") return { ...d };
  const out = { ...d };
  if (typeof value.enabled === "boolean") out.enabled = value.enabled;
  const cmd = sanitizeAgentLauncherCommand(value.command);
  if (cmd != null) out.command = cmd;
  out.cwd = sanitizeAgentLauncherCwd(value.cwd);
  if (typeof value.trigger === "string" && AGENT_LAUNCHER_TRIGGERS.has(value.trigger)) {
    out.trigger = value.trigger;
  }
  return out;
}

function sanitizeTimeCheckinCommand(raw, fallback) {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim();
  if (!s || /[\n\r\x00-\x1f]/.test(s)) return fallback;
  return s;
}

function sanitizeTimeCheckinCwd(raw, fallback) {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim();
  if (!s || s.length > AGENT_LAUNCHER_CWD_MAX || /[\n\r\x00-\x1f]/.test(s)) return fallback;
  return s;
}

function normalizeTimeCheckinArgs(raw, fallback) {
  if (!Array.isArray(raw)) return fallback.slice();
  return raw.filter((value) => typeof value === "string" && value.length > 0 && !/[\n\r\x00-\x1f]/.test(value));
}

function normalizeTimeCheckinGenerator(value, defaultsValue) {
  const defaults = defaultsValue || SCHEMA.timeCheckinGenerator.defaultFactory();
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaults, args: defaults.args.slice() };
  const out = {
    cwd: sanitizeTimeCheckinCwd(value.cwd, defaults.cwd),
    command: sanitizeTimeCheckinCommand(value.command, defaults.command),
    args: normalizeTimeCheckinArgs(value.args, defaults.args),
    timeoutMs: defaults.timeoutMs,
  };
  if (typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs)) {
    out.timeoutMs = Math.max(TIMECHECKIN_TIMEOUT_MIN, Math.min(TIMECHECKIN_TIMEOUT_MAX, Math.round(value.timeoutMs)));
  }
  return out;
}

function normalizeProviderUsageChecker(value, defaultsValue) {
  const defaults = defaultsValue || SCHEMA.providerUsageChecker.defaultFactory();
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaults };
  const out = { ...defaults };
  if (typeof value.python === "string" && value.python.trim()) out.python = value.python.trim();
  if (typeof value.scriptPath === "string" && value.scriptPath.trim()) out.scriptPath = value.scriptPath.trim();
  if (typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs)) {
    out.timeoutMs = Math.max(PROVIDER_USAGE_TIMEOUT_MIN, Math.min(PROVIDER_USAGE_TIMEOUT_MAX, Math.round(value.timeoutMs)));
  }
  if (typeof value.browser === "string" && ["auto", "firefox", "chrome", "safari"].includes(value.browser)) {
    out.browser = value.browser;
  }
  return out;
}

const GLOBAL_ACTIVITY_RULE_KEYS = Object.freeze([
  "clipboardReaction",
  "notificationReaction",
  "presenceWake",
  "mediaPlaybackReaction",
  "browserReadingReaction",
]);

function normalizeGlobalActivityRules(value, defaultsValue) {
  const defaults = defaultsValue || SCHEMA.globalActivityRules.defaultFactory();
  const out = { ...defaults };
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const key of GLOBAL_ACTIVITY_RULE_KEYS) {
    if (typeof value[key] === "boolean") out[key] = value[key];
  }
  return out;
}

function normalizeAgents(value, defaultsValue) {
  if (!value || typeof value !== "object") return defaultsValue;
  const out = { ...defaultsValue };
  for (const id of Object.keys(value)) {
    const entry = value[id];
    if (!entry || typeof entry !== "object") continue;
    const base = (defaultsValue && defaultsValue[id]) || { enabled: true, permissionsEnabled: true };
    const merged = { ...base };
    let touched = false;
    for (const flag of AGENT_FLAGS) {
      if (typeof entry[flag] === "boolean") {
        merged[flag] = entry[flag];
        touched = true;
      }
    }
    if (touched) out[id] = merged;
  }
  return out;
}

function normalizeRemoteSshTrustedHosts(value, defaultsValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultsValue || {};
  const out = {};
  for (const [target, entry] of Object.entries(value)) {
    if (typeof target !== "string" || !target.trim()) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const clean = {
      target: target.trim(),
      enabled: entry.enabled !== false,
      prefix: typeof entry.prefix === "string" ? entry.prefix.trim() : "",
      lastStatus: typeof entry.lastStatus === "string" && entry.lastStatus
        ? entry.lastStatus
        : "unknown",
      lastError: typeof entry.lastError === "string" && entry.lastError ? entry.lastError : null,
      lastCheckedAt: typeof entry.lastCheckedAt === "number" && Number.isFinite(entry.lastCheckedAt)
        ? Math.max(0, Math.floor(entry.lastCheckedAt))
        : null,
    };
    out[clean.target] = clean;
  }
  return out;
}

function normalizeTransitionOverride(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  if (typeof value.in === "number" && Number.isFinite(value.in)) out.in = value.in;
  if (typeof value.out === "number" && Number.isFinite(value.out)) out.out = value.out;
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeSlotOverride(entry, { allowDisabled = true } = {}) {
  if (!isPlainObject(entry)) return null;
  const out = {};
  if (allowDisabled && entry.disabled === true) out.disabled = true;
  if (typeof entry.file === "string" && entry.file) out.file = entry.file;
  if (typeof entry.sourceThemeId === "string" && entry.sourceThemeId) out.sourceThemeId = entry.sourceThemeId;
  if (typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)) out.durationMs = entry.durationMs;
  const transition = normalizeTransitionOverride(entry.transition);
  if (transition) out.transition = transition;
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeStateOverridesMap(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [stateKey, entry] of Object.entries(value)) {
    if (typeof stateKey !== "string" || !stateKey) continue;
    const cleanEntry = normalizeSlotOverride(entry, { allowDisabled: true });
    if (cleanEntry) out[stateKey] = cleanEntry;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeFileKeyedOverrideMap(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [originalFile, entry] of Object.entries(value)) {
    if (typeof originalFile !== "string" || !originalFile) continue;
    const cleanEntry = normalizeSlotOverride(entry, { allowDisabled: false });
    if (cleanEntry) out[originalFile] = cleanEntry;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeAutoReturnOverrides(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [stateKey, duration] of Object.entries(value)) {
    if (typeof stateKey !== "string" || !stateKey) continue;
    if (typeof duration !== "number" || !Number.isFinite(duration)) continue;
    out[stateKey] = duration;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeThemeOverrides(value, defaultsValue) {
  if (!isPlainObject(value)) return defaultsValue;
  const out = {};
  for (const themeId of Object.keys(value)) {
    const themeMap = value[themeId];
    if (!isPlainObject(themeMap)) continue;
    const cleanThemeMap = {};

    // Back-compat: older prefs wrote state entries directly under themeId.
    const legacyStates = {};
    for (const [key, entry] of Object.entries(themeMap)) {
      if (key === "states" || key === "tiers" || key === "timings" || key === "idleAnimations") continue;
      const cleanEntry = normalizeSlotOverride(entry, { allowDisabled: true });
      if (cleanEntry) legacyStates[key] = cleanEntry;
    }

    const explicitStates = normalizeStateOverridesMap(themeMap.states);
    const states = explicitStates ? { ...legacyStates, ...explicitStates } : legacyStates;
    if (Object.keys(states).length > 0) cleanThemeMap.states = states;

    const tierGroups = isPlainObject(themeMap.tiers) ? themeMap.tiers : null;
    const cleanTiers = {};
    if (tierGroups) {
      const working = normalizeFileKeyedOverrideMap(tierGroups.workingTiers);
      const juggling = normalizeFileKeyedOverrideMap(tierGroups.jugglingTiers);
      if (working) cleanTiers.workingTiers = working;
      if (juggling) cleanTiers.jugglingTiers = juggling;
    }
    if (Object.keys(cleanTiers).length > 0) cleanThemeMap.tiers = cleanTiers;

    const timings = isPlainObject(themeMap.timings) ? themeMap.timings : null;
    if (timings) {
      const cleanAutoReturn = normalizeAutoReturnOverrides(timings.autoReturn);
      if (cleanAutoReturn) {
        cleanThemeMap.timings = { autoReturn: cleanAutoReturn };
      }
    }

    const idleAnimations = normalizeFileKeyedOverrideMap(themeMap.idleAnimations);
    if (idleAnimations) cleanThemeMap.idleAnimations = idleAnimations;

    if (Object.keys(cleanThemeMap).length > 0) {
      out[themeId] = cleanThemeMap;
    }
  }
  return out;
}

function normalizeThemeVariant(value, defaultsValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultsValue;
  const out = {};
  for (const themeId of Object.keys(value)) {
    const variantId = value[themeId];
    if (typeof themeId !== "string" || !themeId) continue;
    if (typeof variantId !== "string" || !variantId) continue;
    out[themeId] = variantId;
  }
  return out;
}

// ── Disk I/O ──

// Read prefs from disk. Returns `{ snapshot, locked }`:
//   - snapshot: a valid prefs object (always — falls back to defaults on any error)
//   - locked: true if the file came from a future version; save() should be a no-op
//             to avoid clobbering it.
function load(prefsPath) {
  let raw;
  try {
    const text = fs.readFileSync(prefsPath, "utf8");
    raw = JSON.parse(text);
  } catch (err) {
    // Missing file is normal on first run — return defaults silently.
    if (err && err.code === "ENOENT") {
      return { snapshot: getDefaults(), locked: false };
    }
    // Any other error (parse fail, permission, etc.) → backup + defaults
    try {
      const bak = prefsPath + ".bak";
      fs.copyFileSync(prefsPath, bak);
      console.warn(`Clawd: prefs file unreadable, backed up to ${bak}:`, err.message);
    } catch (bakErr) {
      console.warn("Clawd: prefs file unreadable and backup failed:", err.message, bakErr.message);
    }
    return { snapshot: getDefaults(), locked: false };
  }
  if (!raw || typeof raw !== "object") {
    return { snapshot: getDefaults(), locked: false };
  }
  // Future-version guard: refuse to overwrite a prefs file written by a newer version.
  const incomingVersion = typeof raw.version === "number" ? raw.version : 0;
  if (incomingVersion > CURRENT_VERSION) {
    console.warn(
      `Clawd: prefs file version ${incomingVersion} is newer than supported (${CURRENT_VERSION}). ` +
      `Settings will be readable but not saved to avoid data loss.`
    );
    return { snapshot: validate(raw), locked: true };
  }
  const migrated = migrate(raw);
  return { snapshot: validate(migrated), locked: false };
}

function save(prefsPath, snapshot) {
  const validated = validate(snapshot);
  // Ensure parent directory exists (Electron userData is normally created by the
  // framework, but we can't assume it for tests).
  try {
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
  } catch {}
  fs.writeFileSync(prefsPath, JSON.stringify(validated, null, 2));
}

module.exports = {
  CURRENT_VERSION,
  SCHEMA,
  SCHEMA_KEYS,
  AGENT_FLAGS,
  AGENT_LAUNCHER_TRIGGER_LIST,
  getDefaults,
  validate,
  migrate,
  load,
  save,
};
