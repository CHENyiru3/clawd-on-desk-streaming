const { app, BrowserWindow, screen, Menu, ipcMain, globalShortcut, nativeTheme, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { applyStationaryCollectionBehavior } = require("./mac-window");
const hitGeometry = require("./hit-geometry");
const animationCycle = require("./animation-cycle");
const { translateText, setApiKey, checkTranslatorRuntime } = require("./translate");
const { findNearestWorkArea, computeLooseClamp, SYNTHETIC_WORK_AREA } = require("./work-area");
const { getLaunchSizingWorkArea, getProportionalPixelSize } = require("./size-utils");
const createMacosInputMonitor = require("./macos-input-monitor");
const { runTerminalDiagnosticsCheck } = require("./terminal-diagnostics");
const createGlobalRulesEngine = require("./global-rules");
const createMacosFrontmostAppMonitor = require("./macos-frontmost-app-monitor");
const createMacosClipboardMonitor = require("./macos-clipboard-monitor");
const createMacosNotificationMonitor = require("./macos-notification-monitor");
const createMacosMediaMonitor = require("./macos-media-monitor");
const createClipboardHistory = require("./clipboard-history");
const { sanitizeClipboardText } = require("./clipboard-sanitizer");
const createTimeCheckinRuntime = require("./time-checkin");
const { runHermesCheckin, formatClockLabel } = require("./hermes-checkin");
const initTimeCheckinBubble = require("./time-checkin-bubble");

// ── Autoplay policy: allow sound playback without user gesture ──
// MUST be set before any BrowserWindow is created (before app.whenReady)
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWin = process.platform === "win32";
const LINUX_WINDOW_TYPE = "toolbar";
const MAC_TYPING_PRIVACY_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";


// ── Windows: AllowSetForegroundWindow via FFI ──
let _allowSetForeground = null;
if (isWin) {
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    _allowSetForeground = user32.func("bool __stdcall AllowSetForegroundWindow(int dwProcessId)");
  } catch (err) {
    console.warn("Clawd: koffi/AllowSetForegroundWindow not available:", err.message);
  }
}


// ── Window size presets ──
const SIZES = {
  S: { width: 200, height: 200 },
  M: { width: 280, height: 280 },
  L: { width: 360, height: 360 },
};

// ── Settings (prefs.js + settings-controller.js) ──
//
// `prefs.js` handles disk I/O + schema validation + migrations.
// `settings-controller.js` is the single writer of the in-memory snapshot.
// Module-level `lang`/`showTray`/etc. below are mirror caches kept in sync via
// a subscriber wired after menu.js loads. The ctx setters route writes through
// `_settingsController.applyUpdate()`, which auto-persists.
const prefsModule = require("./prefs");
const { createSettingsController } = require("./settings-controller");
const loginItemHelpers = require("./login-item");
const PREFS_PATH = path.join(app.getPath("userData"), "clawd-prefs.json");
const _initialPrefsLoad = prefsModule.load(PREFS_PATH);

// Lazy helpers — these run inside the action `effect` callbacks at click time,
// long after server.js / hooks/install.js are loaded. Wrapping them in closures
// avoids a chicken-and-egg require order at module load.
function _installAutoStartHook() {
  const { registerHooks } = require("../hooks/install.js");
  registerHooks({ silent: true, autoStart: true, port: getHookServerPort() });
}
function _uninstallAutoStartHook() {
  const { unregisterAutoStart } = require("../hooks/install.js");
  unregisterAutoStart();
}
function _uninstallClaudeHooksNow() {
  const { unregisterHooks } = require("../hooks/install.js");
  unregisterHooks();
}

// Cross-platform "open at login" writer used by both the openAtLogin effect
// and the startup hydration helper. Throws on failure so the action layer can
// surface the error to the UI.
function _writeSystemOpenAtLogin(enabled) {
  if (isLinux) {
    const launchScript = path.join(__dirname, "..", "launch.js");
    const execCmd = app.isPackaged
      ? `"${process.env.APPIMAGE || app.getPath("exe")}"`
      : `node "${launchScript}"`;
    loginItemHelpers.linuxSetOpenAtLogin(enabled, { execCmd });
    return;
  }
  app.setLoginItemSettings(
    loginItemHelpers.getLoginItemSettings({
      isPackaged: app.isPackaged,
      openAtLogin: enabled,
      execPath: process.execPath,
      appPath: app.getAppPath(),
    })
  );
}
function _readSystemOpenAtLogin() {
  if (isLinux) return loginItemHelpers.linuxGetOpenAtLogin();
  return app.getLoginItemSettings(
    app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] }
  ).openAtLogin;
}

// Forward declarations — these are defined later in the file but the
// controller's injectedDeps need to resolve them lazily. Using a function
// wrapper lets us bind them after module scope finishes without a second
// `setDeps()` API on the controller.
function _deferredStartMonitorForAgent(id) {
  return startMonitorForAgent(id);
}
function _deferredStopMonitorForAgent(id) {
  return stopMonitorForAgent(id);
}
function _deferredClearSessionsByAgent(id) {
  return _state && typeof _state.clearSessionsByAgent === "function"
    ? _state.clearSessionsByAgent(id)
    : 0;
}
function _deferredDismissPermissionsByAgent(id) {
  return _perm && typeof _perm.dismissPermissionsByAgent === "function"
    ? _perm.dismissPermissionsByAgent(id)
    : 0;
}

const _settingsController = createSettingsController({
  prefsPath: PREFS_PATH,
  loadResult: _initialPrefsLoad,
  injectedDeps: {
    installAutoStart: _installAutoStartHook,
    uninstallAutoStart: _uninstallAutoStartHook,
    syncClaudeHooksNow: () => _server.syncClawdHooks(),
    uninstallClaudeHooksNow: _uninstallClaudeHooksNow,
    startClaudeSettingsWatcher: () => _server.startClaudeSettingsWatcher(),
    stopClaudeSettingsWatcher: () => _server.stopClaudeSettingsWatcher(),
    setOpenAtLogin: _writeSystemOpenAtLogin,
    startMonitorForAgent: _deferredStartMonitorForAgent,
    stopMonitorForAgent: _deferredStopMonitorForAgent,
    clearSessionsByAgent: _deferredClearSessionsByAgent,
    dismissPermissionsByAgent: _deferredDismissPermissionsByAgent,
    // Theme deps — defined much later in the file, wrapped in lazy closures.
    // activateTheme accepts (themeId, variantId?, overrideMap?) and returns
    // { themeId, variantId } with the actually-resolved variantId
    // (lenient fallback on unknown variants).
    activateTheme: (id, variantId, overrideMap) => _deferredActivateTheme(id, variantId, overrideMap),
    getThemeInfo: (id) => _deferredGetThemeInfo(id),
    removeThemeDir: (id) => _deferredRemoveThemeDir(id),
  },
});

// Mirror of `_settingsController.get("lang")` so existing sync read sites in
// menu.js / state.js / etc. don't have to round-trip through the controller.
// Updated by the subscriber in `wireSettingsSubscribers()` below — never
// assign directly.
let lang = _settingsController.get("lang");
let macTypingPermissionStatus = isMac ? "unavailable" : "unsupported";
setApiKey(_settingsController.get("translateApiKey") || "");

let translatorStatus = {
  backend: "minimax",
  configured: !!((_settingsController.get("translateApiKey") || process.env.MINIMAX_API_KEY || "").trim()),
  health: "unknown",
  lastCheckedAt: null,
  lastError: null,
  lastDirection: null,
};

let terminalDiagnosticsStatus = {
  supported: isMac,
  lastCheckedAt: null,
  lastTargetPid: null,
  lastTargetLabel: null,
  lastResult: "unknown",
  lastError: null,
};

let globalActivityStatus = {
  supported: isMac,
  enabled: !!_settingsController.get("globalActivityEnabled"),
  activeRuleId: null,
  activeVisualState: null,
  lastSignalAt: null,
  collectorStatus: {
    frontmostApp: isMac ? "idle" : "unsupported",
    clipboard: isMac ? "idle" : "unsupported",
    notifications: isMac ? "unsupported" : "unsupported",
    media: isMac ? "idle" : "unsupported",
    browser: isMac ? "idle" : "unsupported",
  },
  lastError: null,
};

let timeCheckinStatus = {
  enabled: !!_settingsController.get("timeCheckinEnabled"),
  nextRunAt: null,
  lastRunAt: _settingsController.get("timeCheckinLastRunAt"),
  lastResult: "unknown",
  lastError: null,
  lastMessagePreview: null,
};

function buildSettingsSnapshot() {
  return {
    ..._settingsController.getSnapshot(),
    macTypingPermissionStatus,
    translatorStatus: { ...translatorStatus },
    terminalDiagnosticsStatus: { ...terminalDiagnosticsStatus },
    globalActivityStatus: {
      ...globalActivityStatus,
      collectorStatus: { ...(globalActivityStatus.collectorStatus || {}) },
    },
    timeCheckinStatus: { ...timeCheckinStatus },
  };
}

const _clipboardHistory = createClipboardHistory({
  maxAgeMs: 60 * 60 * 1000,
  sanitizer: sanitizeClipboardText,
});

let _timeCheckinRuntime = null;
let _timeCheckinBubble = null;

function getTimeCheckinContext(windowMinutes = null) {
  const minutes = Number.isInteger(windowMinutes) && windowMinutes > 0
    ? windowMinutes
    : (_settingsController.get("timeCheckinPreviewClipboardWindowMinutes") || 60);
  return _clipboardHistory.getSanitizedSummary(minutes * 60 * 1000);
}

function getTimeCheckinGeneratorConfig() {
  const cfg = _settingsController.get("timeCheckinGenerator") || {};
  return {
    cwd: cfg.cwd || "",
    command: cfg.command || "",
    args: Array.isArray(cfg.args) ? cfg.args.slice() : [],
    timeoutMs: cfg.timeoutMs || 30000,
  };
}

function buildTimeCheckinTitle(nowDate) {
  return `${formatClockLabel(nowDate)} Check-in`;
}

function buildTimeCheckinBubblePayload(nowDate, message) {
  const clockLabel = formatClockLabel(nowDate);
  const match = /^(\d{1,2}:\d{2})\s*([AP]M)$/i.exec(clockLabel);
  return {
    timeLabel: match ? match[1] : clockLabel,
    meridiem: match ? match[2].toUpperCase() : "",
    title: getUiLang() === "zh" ? "整点问候" : "Check-in",
    message,
    detail: getUiLang() === "zh"
      ? "基于过去一小时的脱敏剪贴板活动。"
      : "Based on sanitized clipboard activity from the past hour.",
    dismissLabel: getUiLang() === "zh" ? "关闭" : "Dismiss",
    requireAction: false,
  };
}

async function generateTimeCheckinMessage({ reason, now }) {
  const context = getTimeCheckinContext();
  const result = await runHermesCheckin({
    config: getTimeCheckinGeneratorConfig(),
    context,
    now,
    slotLabel: buildTimeCheckinTitle(now),
    logger: (msg) => console.warn("Clawd:", msg),
  });
  const message = (result.ok && result.cleanedText) ? result.cleanedText : (result.fallbackMessage || "Take a breath. One clean next step is enough.");
  const generatorStatus = result.ok ? (result.cleanedChanged ? "cleaned" : "ok") : "fallback";
  timeCheckinStatus = {
    ...timeCheckinStatus,
    enabled: !!_settingsController.get("timeCheckinEnabled"),
    lastRunAt: now.getTime(),
    lastResult: generatorStatus,
    lastError: result.ok ? null : (result.message || "Time check-in failed."),
    lastMessagePreview: message,
  };
  _settingsController.applyUpdate("timeCheckinLastRunAt", now.getTime());
  broadcastSettingsSnapshot();
  return {
    status: generatorStatus,
    detail: {
      payload: buildTimeCheckinBubblePayload(now, message),
      message,
      context,
      reason,
      generator: {
        ok: result.ok,
        code: result.code || null,
      },
    },
    message: result.ok
      ? "Time check-in is ready."
      : (result.message || "Time check-in used a fallback message."),
  };
}

function handleTimeCheckinReady(detail) {
  if (!detail) return;
  if (doNotDisturb) {
    broadcastSettingsSnapshot();
    return;
  }
  if (_timeCheckinBubble) _timeCheckinBubble.show(detail.payload);
}

function syncTimeCheckinFromPrefs() {
  const enabled = !!_settingsController.get("timeCheckinEnabled");
  timeCheckinStatus = {
    ...timeCheckinStatus,
    enabled,
    lastRunAt: _settingsController.get("timeCheckinLastRunAt"),
  };
  if (!_timeCheckinRuntime) return;
  if (enabled && isMac) _timeCheckinRuntime.start();
  else _timeCheckinRuntime.stop();
  const runtimeStatus = _timeCheckinRuntime.getStatus();
  timeCheckinStatus = {
    ...timeCheckinStatus,
    nextRunAt: runtimeStatus.nextRunAt,
    lastRunAt: runtimeStatus.lastRunAt || timeCheckinStatus.lastRunAt,
    lastResult: runtimeStatus.lastResult || timeCheckinStatus.lastResult,
    lastError: runtimeStatus.lastError || timeCheckinStatus.lastError,
  };
  broadcastSettingsSnapshot();
}

function updateTranslatorStatusSuccess(direction = null) {
  translatorStatus = {
    ...translatorStatus,
    configured: !!((_settingsController.get("translateApiKey") || process.env.MINIMAX_API_KEY || "").trim()),
    health: "ok",
    lastCheckedAt: Date.now(),
    lastError: null,
    lastDirection: direction || translatorStatus.lastDirection,
  };
}

function updateTranslatorStatusError(err) {
  translatorStatus = {
    ...translatorStatus,
    configured: !!((_settingsController.get("translateApiKey") || process.env.MINIMAX_API_KEY || "").trim()),
    health: "error",
    lastCheckedAt: Date.now(),
    lastError: err && err.message ? err.message : "Translation failed.",
  };
}

function getUiLang() {
  return lang === "zh" ? "zh" : "en";
}

function getTranslateStrings() {
  return getUiLang() === "zh"
    ? {
        emptyClipboard: "剪贴板为空",
        loading: "翻译诊断中…",
        successSource: "Diagnostic sample",
        successText: "这是一个翻译气泡诊断示例。",
        errorText: "这是一个用于检查错误样式的示例。",
      }
    : {
        emptyClipboard: "Clipboard is empty",
        loading: "Running translation diagnostic…",
        successSource: "Diagnostic sample",
        successText: "This is a translation bubble diagnostic sample.",
        errorText: "This is a sample error used to verify the bubble styling.",
      };
}

function broadcastSettingsSnapshot(changes = null) {
  try {
    const payload = { changes, snapshot: buildSettingsSnapshot() };
    for (const bw of BrowserWindow.getAllWindows()) {
      if (!bw.isDestroyed() && bw.webContents && !bw.webContents.isDestroyed()) {
        bw.webContents.send("settings-changed", payload);
      }
    }
  } catch (err) {
    console.warn("Clawd: settings-changed broadcast failed:", err && err.message);
  }
}

const {
  launchAgentTerminal,
  shouldFocusFallbackLaunch,
  shouldTripleClickLaunch,
} = require("./agent-launcher");

function tryOpenAgentCli() {
  const snap = _settingsController.getSnapshot();
  const al = snap && snap.agentLauncher;
  if (!al || !al.enabled) return;
  const r = launchAgentTerminal({
    command: al.command,
    cwd: al.cwd,
  });
  if (!r.ok) console.warn("Clawd: agent launcher:", r.message);
}

function maybeLaunchAgentOnEmptyFocus() {
  const snap = _settingsController.getSnapshot();
  const al = snap && snap.agentLauncher;
  if (!al || !al.enabled) return false;
  if (!shouldFocusFallbackLaunch(al.trigger)) return false;
  const r = launchAgentTerminal({
    command: al.command,
    cwd: al.cwd,
  });
  if (!r.ok) console.warn("Clawd: agent launcher (focus fallback):", r.message);
  return !!r.ok;
}

// First-run import of system-backed settings into prefs. The actual truth for
// `openAtLogin` lives in OS login items / autostart files; if we just trusted
// the schema default (false), an upgrading user with login-startup already
// enabled would silently lose it the first time prefs is saved. So on first
// boot after this field exists in the schema, copy the system value INTO prefs
// and mark it hydrated. After that, prefs is the source of truth and the
// openAtLogin pre-commit gate handles future writes back to the system.
//
// MUST run inside app.whenReady() — Electron's app.getLoginItemSettings() is
// only stable after the app is ready. MUST run before createWindow() so the
// first menu render reads the hydrated value.
function hydrateSystemBackedSettings() {
  if (_settingsController.get("openAtLoginHydrated")) return;
  let systemValue = false;
  try {
    systemValue = !!_readSystemOpenAtLogin();
  } catch (err) {
    console.warn("Clawd: failed to read system openAtLogin during hydration:", err && err.message);
  }
  const result = _settingsController.hydrate({
    openAtLogin: systemValue,
    openAtLoginHydrated: true,
  });
  if (result && result.status === "error") {
    console.warn("Clawd: openAtLogin hydration failed:", result.message);
  }
}

// Capture window/mini runtime state into the controller and write to disk.
// Replaces the legacy `savePrefs()` callsites — they used to read fresh
// `win.getBounds()` and `_mini.*` at save time, so we mirror that here.
function flushRuntimeStateToPrefs() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  _settingsController.applyBulk({
    x: bounds.x,
    y: bounds.y,
    positionSaved: true,
    size: currentSize,
    miniMode: _mini.getMiniMode(),
    miniEdge: _mini.getMiniEdge(),
    preMiniX: _mini.getPreMiniX(),
    preMiniY: _mini.getPreMiniY(),
  });
}

let _codexMonitor = null;          // Codex CLI JSONL log polling instance
let _geminiMonitor = null;         // Gemini CLI session JSON polling instance
let _globalRulesEngine = null;
let _frontmostAppMonitor = null;
let _clipboardMonitor = null;
let _notificationMonitor = null;
let _mediaMonitor = null;

// Hook-based agents have no module-level monitor — they're gated at the
// HTTP route layer. Only log-poll agents hit these branches.
function startMonitorForAgent(agentId) {
  if (agentId === "codex" && _codexMonitor) _codexMonitor.start();
  else if (agentId === "gemini-cli" && _geminiMonitor) _geminiMonitor.start();
}
function stopMonitorForAgent(agentId) {
  if (agentId === "codex" && _codexMonitor) _codexMonitor.stop();
  else if (agentId === "gemini-cli" && _geminiMonitor) _geminiMonitor.stop();
}

function syncMacTypingMonitorFromPrefs() {
  if (!isMac) {
    macTypingPermissionStatus = "unsupported";
    return;
  }
  try {
    if (macTypingAwarenessEnabled) _macInputMonitor.start();
    else {
      _macInputMonitor.stop();
      _state.setComposingActive(false);
    }
    macTypingPermissionStatus = _macInputMonitor.getStatus();
  } catch (err) {
    console.warn("Clawd: failed to sync mac typing monitor:", err && err.message);
    macTypingPermissionStatus = "error";
  }
}

function syncGlobalActivityStatusFromEngine(snapshot = null) {
  const next = snapshot || (_globalRulesEngine ? _globalRulesEngine.getSnapshot() : null);
  if (!next) return;
  globalActivityStatus = {
    ...globalActivityStatus,
    ...next,
    collectorStatus: { ...(next.collectorStatus || globalActivityStatus.collectorStatus || {}) },
  };
}

function handleGlobalRuleSignal(signal) {
  if (!_globalRulesEngine) return;
  const snapshot = _globalRulesEngine.notifySignal(signal);
  syncGlobalActivityStatusFromEngine(snapshot);
  if (_settingsController.get("globalActivityEnabled")) resetIdleTimer();
  if (_state) {
    _state.setGlobalPresenceActive(!!(snapshot && snapshot.presenceActive));
    _state.setGlobalRuleState(snapshot && snapshot.activeVisualState ? snapshot.activeVisualState : null);
  }
  broadcastSettingsSnapshot();
}

function startGlobalActivityCollectors() {
  if (!isMac || !_settingsController.get("globalActivityEnabled")) return;
  try { _frontmostAppMonitor && _frontmostAppMonitor.start(); } catch (err) {
    console.warn("Clawd: failed to start frontmost app monitor:", err && err.message);
  }
  try { _clipboardMonitor && _clipboardMonitor.start(); } catch (err) {
    console.warn("Clawd: failed to start clipboard monitor:", err && err.message);
  }
  try { _notificationMonitor && _notificationMonitor.start(); } catch (err) {
    console.warn("Clawd: failed to start notification monitor:", err && err.message);
  }
  try { _mediaMonitor && _mediaMonitor.start(); } catch (err) {
    console.warn("Clawd: failed to start media monitor:", err && err.message);
  }
}

function stopGlobalActivityCollectors() {
  try { _frontmostAppMonitor && _frontmostAppMonitor.stop(); } catch {}
  try { _clipboardMonitor && _clipboardMonitor.stop(); } catch {}
  try { _notificationMonitor && _notificationMonitor.stop(); } catch {}
  try { _mediaMonitor && _mediaMonitor.stop(); } catch {}
}

function syncGlobalActivityFromPrefs() {
  if (!_globalRulesEngine) return;
  const snap = _settingsController.getSnapshot();
  _globalRulesEngine.refreshFromPrefs(snap);
  if (snap.globalActivityEnabled && isMac) {
    startGlobalActivityCollectors();
  } else {
    stopGlobalActivityCollectors();
    _globalRulesEngine.stop();
    _state.setGlobalPresenceActive(false);
    _state.setGlobalRuleState(null);
  }
  syncGlobalActivityStatusFromEngine();
}

async function maybePromptMacTypingPermission() {
  if (!isMac || !macTypingAwarenessEnabled) return;
  const snap = _settingsController.getSnapshot();
  if (snap.macTypingPermissionPrompted || snap.macTypingPermissionDismissed) return;

  const granted = _macInputMonitor.requestPermission();
  macTypingPermissionStatus = _macInputMonitor.getStatus();
  _settingsController.applyBulk({ macTypingPermissionPrompted: true });
  if (granted) {
    syncMacTypingMonitorFromPrefs();
    return;
  }

  const parent = settingsWindow || win || null;
  const copy = {
    en: {
      title: "Enable typing awareness on macOS?",
      detail: "Clawd can react while you type anywhere on your Mac. macOS requires Input Monitoring permission for this feature.",
      open: "Open Settings",
      later: "Not now",
      dismiss: "Don't ask again",
    },
    zh: {
      title: "要开启 macOS 打字感知吗？",
      detail: "Clawd 可以在你输入时做出反应。macOS 需要为此授予“输入监控”权限。",
      open: "打开设置",
      later: "稍后",
      dismiss: "不再提示",
    },
  }[lang] || {
    title: "Enable typing awareness on macOS?",
    detail: "Clawd can react while you type anywhere on your Mac. macOS requires Input Monitoring permission for this feature.",
    open: "Open Settings",
    later: "Not now",
    dismiss: "Don't ask again",
  };

  try {
    const { response } = await dialog.showMessageBox(parent, {
      type: "info",
      buttons: [copy.open, copy.later, copy.dismiss],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: copy.title,
      detail: copy.detail,
    });
    if (response === 0) {
      await shell.openExternal(MAC_TYPING_PRIVACY_URL);
    } else if (response === 2) {
      _settingsController.applyBulk({ macTypingPermissionDismissed: true });
    }
  } catch (err) {
    console.warn("Clawd: mac typing permission dialog failed:", err && err.message);
  }
}

// ── Theme loader ──
const themeLoader = require("./theme-loader");
themeLoader.init(__dirname, app.getPath("userData"));

// Lenient load so a missing/corrupt user-selected theme can't brick boot.
// If lenient fell back to "clawd" OR the variant fell back to "default",
// hydrate prefs to match so the store stays truth.
//
// Startup runs BEFORE the window is ready, so we call themeLoader.loadTheme
// directly — not activateTheme (which requires ready windows) and not the
// setThemeSelection command (which goes through activateTheme). The runtime
// switch path via UI goes through setThemeSelection post-window-ready.
const _requestedThemeId = _settingsController.get("theme") || "clawd";
const _initialVariantMap = _settingsController.get("themeVariant") || {};
const _requestedVariantId = _initialVariantMap[_requestedThemeId] || "default";
const _initialThemeOverrides = _settingsController.get("themeOverrides") || {};
const _requestedThemeOverrides = _initialThemeOverrides[_requestedThemeId] || null;
let activeTheme = themeLoader.loadTheme(_requestedThemeId, {
  variant: _requestedVariantId,
  overrides: _requestedThemeOverrides,
});
activeTheme._overrideSignature = JSON.stringify(_requestedThemeOverrides || {});
if (activeTheme._id !== _requestedThemeId || activeTheme._variantId !== _requestedVariantId) {
  const nextVariantMap = { ...(_settingsController.get("themeVariant") || {}) };
  // Self-heal: store the resolved ids so next boot doesn't fall back again.
  nextVariantMap[activeTheme._id] = activeTheme._variantId;
  if (activeTheme._id !== _requestedThemeId) {
    delete nextVariantMap[_requestedThemeId];
  }
  const result = _settingsController.hydrate({
    theme: activeTheme._id,
    themeVariant: nextVariantMap,
  });
  if (result && result.status === "error") {
    console.warn("Clawd: theme hydrate after fallback failed:", result.message);
  }
}

// ── CSS <object> sizing (from theme) ──
function getObjRect(bounds) {
  const state = _state.getCurrentState();
  const file = _state.getCurrentSvg() || (activeTheme && activeTheme.states && activeTheme.states.idle[0]);
  return hitGeometry.getAssetRectScreen(activeTheme, bounds, state, file)
    || { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
}

let win;
let hitWin;  // input window — small opaque rect over hitbox, receives all pointer events
let tray = null;
let contextMenuOwner = null;
// Mirror of _settingsController.get("size") — initialized from disk, kept in
// sync by the settings subscriber. The legacy S/M/L → P:N migration runs
// inside createWindow() because it needs the screen API.
let currentSize = _settingsController.get("size");

// ── Proportional size mode ──
// currentSize = "P:<ratio>" means the pet occupies <ratio>% of the display long edge,
// so rotating the same monitor to portrait does not suddenly shrink the pet.
const PROPORTIONAL_RATIOS = [8, 10, 12, 15];

function isProportionalMode(size) {
  return typeof (size || currentSize) === "string" && (size || currentSize).startsWith("P:");
}

function getProportionalRatio(size) {
  return parseFloat((size || currentSize).slice(2)) || 10;
}

function getCurrentPixelSize(overrideWa) {
  if (!isProportionalMode()) return SIZES[currentSize] || SIZES.S;
  const ratio = getProportionalRatio();
  let wa = overrideWa;
  if (!wa && win && !win.isDestroyed()) {
    const { x, y, width, height } = win.getBounds();
    wa = getNearestWorkArea(x + width / 2, y + height / 2);
  }
  if (!wa) wa = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
  return getProportionalPixelSize(ratio, wa);
}
let contextMenu;
let doNotDisturb = false;
let isQuitting = false;
// Mirror caches — kept in sync with the settings store via the subscriber
// in wireSettingsSubscribers() further down. Read freely; never assign
// directly (writes go through ctx setters → controller.applyUpdate).
let showTray = _settingsController.get("showTray");
let showDock = _settingsController.get("showDock");
let manageClaudeHooksAutomatically = _settingsController.get("manageClaudeHooksAutomatically");
let autoStartWithClaude = _settingsController.get("autoStartWithClaude");
let openAtLogin = _settingsController.get("openAtLogin");
let bubbleFollowPet = _settingsController.get("bubbleFollowPet");
let hideBubbles = _settingsController.get("hideBubbles");
let showSessionId = _settingsController.get("showSessionId");
let soundMuted = _settingsController.get("soundMuted");
let macTypingAwarenessEnabled = _settingsController.get("macTypingAwarenessEnabled");
let petHidden = false;
const DEFAULT_TOGGLE_SHORTCUT = "CommandOrControl+Shift+Alt+C";

const _macInputMonitor = createMacosInputMonitor({
  onStatusChange: (status) => {
    macTypingPermissionStatus = status;
    broadcastSettingsSnapshot();
  },
  logger: (msg) => console.warn("Clawd:", msg),
});

function togglePetVisibility() {
  if (!win || win.isDestroyed()) return;
  if (_mini.getMiniTransitioning()) return;
  if (petHidden) {
    win.showInactive();
    if (isLinux) win.setSkipTaskbar(true);
    if (hitWin && !hitWin.isDestroyed()) {
      hitWin.showInactive();
      if (isLinux) hitWin.setSkipTaskbar(true);
    }
    // Restore any permission bubbles that were hidden
    for (const perm of pendingPermissions) {
      if (perm.bubble && !perm.bubble.isDestroyed()) {
        perm.bubble.showInactive();
        if (isLinux) perm.bubble.setSkipTaskbar(true);
      }
    }
    syncUpdateBubbleVisibility();
    reapplyMacVisibility();
    petHidden = false;
  } else {
    win.hide();
    if (hitWin && !hitWin.isDestroyed()) hitWin.hide();
    // Also hide any permission bubbles
    for (const perm of pendingPermissions) {
      if (perm.bubble && !perm.bubble.isDestroyed()) perm.bubble.hide();
    }
    hideUpdateBubble();
    petHidden = true;
  }
  syncPermissionShortcuts();
  buildTrayMenu();
  buildContextMenu();
}

function registerToggleShortcut() {
  try {
    globalShortcut.register(DEFAULT_TOGGLE_SHORTCUT, togglePetVisibility);
  } catch (err) {
    console.warn("Clawd: failed to register global shortcut:", err.message);
  }
}

function unregisterToggleShortcut() {
  try {
    globalShortcut.unregister(DEFAULT_TOGGLE_SHORTCUT);
  } catch {}
}

function sendToRenderer(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}
function sendToHitWin(channel, ...args) {
  if (hitWin && !hitWin.isDestroyed()) hitWin.webContents.send(channel, ...args);
}

function pushAgentLauncherToHit() {
  const snap = _settingsController.getSnapshot();
  const al = snap && snap.agentLauncher;
  const triple = !!(al && al.enabled && shouldTripleClickLaunch(al.trigger));
  sendToHitWin("hit-state-sync", { agentLauncherTriple: triple });
}

function syncHitStateAfterLoad() {
  const snap = _settingsController.getSnapshot();
  const al = snap && snap.agentLauncher;
  const triple = !!(al && al.enabled && shouldTripleClickLaunch(al.trigger));
  sendToHitWin("hit-state-sync", {
    currentSvg: _state.getCurrentSvg(),
    currentState: _state.getCurrentState(),
    miniMode: _mini.getMiniMode(),
    dndEnabled: doNotDisturb,
    agentLauncherTriple: triple,
  });
}

function syncRendererStateAfterLoad({ includeStartupRecovery = true } = {}) {
  if (_mini.getMiniMode()) {
    sendToRenderer("mini-mode-change", true, _mini.getMiniEdge());
  }
  if (doNotDisturb) {
    sendToRenderer("dnd-change", true);
    if (_mini.getMiniMode()) {
      applyState("mini-sleep");
    } else {
      applyState("sleeping");
    }
    return;
  }
  if (_mini.getMiniMode()) {
    applyState("mini-idle");
    return;
  }

  // Theme hot-reload path (override tweak / variant swap): re-render whatever
  // we were already showing. Going through resolveDisplayState() here flashes
  // "working/typing" when sessions Map still holds a stale session whose
  // state hasn't been stale-downgraded yet — currentState already reflects
  // the user-visible state before reload and stays authoritative.
  if (!includeStartupRecovery) {
    const prev = _state.getCurrentState();
    applyState(prev, getSvgOverride(prev));
    return;
  }

  if (sessions.size > 0) {
    const resolved = resolveDisplayState();
    applyState(resolved, getSvgOverride(resolved));
    return;
  }

  applyState("idle", getSvgOverride("idle"));

  setTimeout(() => {
    if (sessions.size > 0 || doNotDisturb) return;
    detectRunningAgentProcesses((found) => {
      if (found && sessions.size === 0 && !doNotDisturb) {
        _startStartupRecovery();
        resetIdleTimer();
      }
    });
  }, 5000);
}

// ── Sound playback ──
let lastSoundTime = 0;
const SOUND_COOLDOWN_MS = 10000;

function playSound(name) {
  if (soundMuted || doNotDisturb) return;
  const now = Date.now();
  if (now - lastSoundTime < SOUND_COOLDOWN_MS) return;
  const url = themeLoader.getSoundUrl(name);
  if (!url) return;
  lastSoundTime = now;
  sendToRenderer("play-sound", url);
}

function resetSoundCooldown() {
  lastSoundTime = 0;
}

// Sync input window position to match render window's hitbox.
// Called manually after every win position/size change + event-level safety net.
let _lastHitW = 0, _lastHitH = 0;
function syncHitWin() {
  if (!hitWin || hitWin.isDestroyed() || !win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const hit = getHitRectScreen(bounds);
  const x = Math.round(hit.left);
  const y = Math.round(hit.top);
  const w = Math.round(hit.right - hit.left);
  const h = Math.round(hit.bottom - hit.top);
  if (w <= 0 || h <= 0) return;
  hitWin.setBounds({ x, y, width: w, height: h });
  // Update shape if hitbox dimensions changed (e.g. after resize)
  if (w !== _lastHitW || h !== _lastHitH) {
    _lastHitW = w; _lastHitH = h;
    hitWin.setShape([{ x: 0, y: 0, width: w, height: h }]);
  }
}

let mouseOverPet = false;
let dragLocked = false;
let menuOpen = false;
let idlePaused = false;
let forceEyeResend = false;
let themeReloadInProgress = false;

// ── Mini Mode — delegated to src/mini.js ──
// Initialized after state module (needs applyState, resolveDisplayState, etc.)
// See _mini initialization below


// ── Permission bubble — delegated to src/permission.js ──
const { isAgentEnabled: _isAgentEnabled, isAgentPermissionsEnabled: _isAgentPermissionsEnabled } = require("./agent-gate");
const _permCtx = {
  get win() { return win; },
  get lang() { return lang; },
  get sessions() { return sessions; },
  get bubbleFollowPet() { return bubbleFollowPet; },
  get permDebugLog() { return permDebugLog; },
  get doNotDisturb() { return doNotDisturb; },
  get hideBubbles() { return hideBubbles; },
  get petHidden() { return petHidden; },
  getNearestWorkArea,
  getHitRectScreen,
  guardAlwaysOnTop,
  reapplyMacVisibility,
  isAgentPermissionsEnabled: (agentId) =>
    _isAgentPermissionsEnabled({ agents: _settingsController.get("agents") }, agentId),
  focusTerminalForSession: (sessionId) => {
    const s = sessions.get(sessionId);
    if (s && s.sourcePid) focusTerminalWindow(s.sourcePid, s.cwd, s.editor, s.pidChain);
  },
};
const _perm = require("./permission")(_permCtx);
const { showPermissionBubble, resolvePermissionEntry, sendPermissionResponse, repositionBubbles, permLog, PASSTHROUGH_TOOLS, showCodexNotifyBubble, clearCodexNotifyBubbles, syncPermissionShortcuts, replyOpencodePermission } = _perm;
const pendingPermissions = _perm.pendingPermissions;
let permDebugLog = null; // set after app.whenReady()
let updateDebugLog = null; // set after app.whenReady()
let sessionDebugLog = null; // set after app.whenReady()

// ── Translate bubble (Ctrl+Shift+T: clipboard → MiniMax → Chinese/English) ──
let translateWin = null;
let translateHideTimer = null;
let translateMeasuredHeight = 0;

const TRANSLATE_BUBBLE_WIDTH = 300;
const TRANSLATE_BUBBLE_MARGIN = 8;
const TRANSLATE_BUBBLE_GAP = 6;

function computeTranslateBubblePosition() {
  if (!win || win.isDestroyed()) return { x: 100, y: 100 };
  const petBounds = win.getBounds();
  const cx = petBounds.x + petBounds.width / 2;
  const cy = petBounds.y + petBounds.height / 2;
  const wa = getNearestWorkArea(cx, cy);
  const hitRect = bubbleFollowPet && typeof getHitRectScreen === "function"
    ? getHitRectScreen(petBounds)
    : null;

  // Layout: above pet if enough room, else bottom-right corner
  let x;
  if (hitRect) {
    const hitTop = Math.round(hitRect.top);
    const totalH = translateMeasuredHeight + 12;
    if (hitTop - wa.y >= totalH) {
      // Enough room above — place bubble there
      x = Math.max(wa.x, Math.min(cx - Math.round(TRANSLATE_BUBBLE_WIDTH / 2), wa.x + wa.width - TRANSLATE_BUBBLE_WIDTH));
      return { x, y: hitTop - totalH, width: TRANSLATE_BUBBLE_WIDTH };
    }
  }
  // Fallback: bottom-right of work area
  x = wa.x + wa.width - TRANSLATE_BUBBLE_WIDTH - TRANSLATE_BUBBLE_MARGIN;
  const y = wa.y + wa.height - translateMeasuredHeight - 12 - TRANSLATE_BUBBLE_MARGIN;
  return { x, y, width: TRANSLATE_BUBBLE_WIDTH };
}

function createTranslateWin() {
  if (translateWin && !translateWin.isDestroyed()) return;
  translateWin = new BrowserWindow({
    width: TRANSLATE_BUBBLE_WIDTH,
    height: 120,
    x: 0,
    y: 0,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: !isMac,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    ...(isLinux ? { type: LINUX_WINDOW_TYPE } : {}),
    ...(isMac ? { type: "panel" } : {}),
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-translate.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  if (isWin) translateWin.setAlwaysOnTop(true, "pop-up-menu");
  translateWin.loadFile(path.join(__dirname, "translate-bubble.html"));
  translateWin.webContents.once("did-finish-load", () => {
    if (translateWin && !translateWin.isDestroyed()) guardAlwaysOnTop(translateWin);
  });
  translateWin.on("closed", () => { translateWin = null; });
}

function showTranslateBubble() {
  if (!win || win.isDestroyed()) return;
  createTranslateWin();
  if (translateHideTimer) { clearTimeout(translateHideTimer); translateHideTimer = null; }
  const pos = computeTranslateBubblePosition();
  translateMeasuredHeight = translateMeasuredHeight || 120;
  translateWin.setBounds({ ...pos, height: translateMeasuredHeight + 12 });
  translateWin.show();
}

function showTranslateBubblePayload(payload) {
  showTranslateBubble();
  if (translateWin && !translateWin.isDestroyed()) {
    translateWin.webContents.send("translate-show", payload);
  }
}

function hideTranslateBubble(immediate) {
  if (!translateWin || translateWin.isDestroyed()) return;
  if (translateHideTimer) { clearTimeout(translateHideTimer); translateHideTimer = null; }
  if (immediate) {
    translateWin.destroy();
    translateWin = null;
    return;
  }
  translateHideTimer = setTimeout(() => {
    if (translateWin && !translateWin.isDestroyed()) {
      translateWin.destroy();
      translateWin = null;
    }
  }, 250);
}

async function runTranslatorHealthCheck() {
  try {
    const result = await checkTranslatorRuntime();
    updateTranslatorStatusSuccess(result.direction || null);
    broadcastSettingsSnapshot();
    return {
      status: "ok",
      message: "MiniMax translator is ready.",
      detail: result,
    };
  } catch (err) {
    updateTranslatorStatusError(err);
    broadcastSettingsSnapshot();
    return {
      status: "error",
      message: err && err.message ? err.message : "Translation failed.",
      detail: {
        code: err && err.code ? err.code : "unknown",
      },
    };
  }
}

function showTranslateBubbleTest(mode) {
  const strings = getTranslateStrings();
  const base = {
    sourceText: strings.successSource,
    lang: getUiLang(),
    diagnostic: { source: "test", label: "Diagnostic" },
  };
  if (mode === "loading") {
    showTranslateBubblePayload({
      ...base,
      status: "loading",
      direction: "en-zh",
    });
    return { status: "ok", message: "Showing loading translation bubble." };
  }
  if (mode === "success") {
    showTranslateBubblePayload({
      ...base,
      status: "done",
      translatedText: strings.successText,
      direction: "en-zh",
    });
    return { status: "ok", message: "Showing success translation bubble." };
  }
  if (mode === "error") {
    showTranslateBubblePayload({
      ...base,
      status: "error",
      errorMessage: strings.errorText,
    });
    return { status: "ok", message: "Showing error translation bubble." };
  }
  return { status: "error", message: `Unknown translation bubble test mode: ${mode}` };
}

async function runTerminalActionCheck() {
  const result = await runTerminalDiagnosticsCheck({
    sessions,
    statePriority: STATE_PRIORITY,
    executeFocus: (target) => runMacFocusCheck(target.sourcePid, target.cwd, target.editor, target.pidChain),
  });
  terminalDiagnosticsStatus = {
    ...terminalDiagnosticsStatus,
    lastCheckedAt: Date.now(),
    lastTargetPid: result.targetPid || null,
    lastTargetLabel: result.targetLabel || null,
    lastResult: result.ok ? "ok" : "error",
    lastError: result.ok ? null : (result.message || result.reason || "Terminal action check failed."),
  };
  broadcastSettingsSnapshot();
  return result.ok
    ? { status: "ok", message: "Terminal focus and position check completed.", detail: result }
    : { status: "error", message: terminalDiagnosticsStatus.lastError, detail: result };
}

function runGlobalActivityTest(ruleId) {
  if (!_globalRulesEngine) {
    return { status: "error", message: "Global activity engine unavailable." };
  }
  const result = _globalRulesEngine.runTest(ruleId);
  syncGlobalActivityStatusFromEngine();
  if (_state) {
    const snapshot = _globalRulesEngine.getSnapshot();
    _state.setGlobalPresenceActive(!!snapshot.presenceActive);
    _state.setGlobalRuleState(snapshot.activeVisualState || null);
  }
  broadcastSettingsSnapshot();
  return result;
}

async function runTimeCheckinNow() {
  if (!_timeCheckinRuntime) {
    return { status: "error", message: "Time check-in runtime unavailable." };
  }
  await _timeCheckinRuntime.triggerNow("manual");
  return {
    status: timeCheckinStatus.lastResult === "error" ? "error" : "ok",
    message: timeCheckinStatus.lastResult === "error"
      ? (timeCheckinStatus.lastError || "Time check-in failed.")
      : "Time check-in completed.",
    detail: {
      nextRunAt: timeCheckinStatus.nextRunAt,
      lastRunAt: timeCheckinStatus.lastRunAt,
      lastMessagePreview: timeCheckinStatus.lastMessagePreview,
    },
  };
}

function previewTimeCheckinContext() {
  const context = getTimeCheckinContext();
  const lines = context.entries.length
    ? context.entries.map((entry) => `- [${new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}] ${entry.text}`)
    : ["- No recent clipboard history."];
  const detail = [
    `Entries: ${context.counts.totalEntries}`,
    `Redacted: ${context.counts.redactedEntries}`,
    "",
    ...lines,
  ].join("\n");
  if (_timeCheckinBubble) {
    _timeCheckinBubble.show({
      timeLabel: getUiLang() === "zh" ? "预览" : "Preview",
      meridiem: "",
      title: getUiLang() === "zh" ? "脱敏上下文" : "Sanitized Context",
      message: getUiLang() === "zh"
        ? "这是发送给时间问候生成器前的脱敏剪贴板内容。"
        : "This is the sanitized clipboard context before it goes to the time check-in generator.",
      detail,
      dismissLabel: getUiLang() === "zh" ? "关闭" : "Dismiss",
      requireAction: false,
    });
  }
  return {
    status: "ok",
    message: "Showing sanitized context preview.",
    detail: context,
  };
}

async function triggerTranslate() {
  if (doNotDisturb || petHidden) return;
  showTranslateBubble();

  // Read clipboard
  let sourceText;
  try {
    const { clipboard } = require("electron");
    sourceText = clipboard.readText();
  } catch {
    sourceText = "";
  }

  if (!sourceText || !sourceText.trim()) {
    showTranslateBubblePayload({
      status: "error",
      sourceText: "",
      errorMessage: getTranslateStrings().emptyClipboard,
      lang: getUiLang(),
      diagnostic: { source: "clipboard" },
    });
    translateHideTimer = setTimeout(() => { if (translateWin && !translateWin.isDestroyed()) translateWin.destroy(); translateWin = null; }, 3000);
    return;
  }

  showTranslateBubblePayload({
    status: "loading",
    sourceText,
    lang: getUiLang(),
    diagnostic: { source: "clipboard" },
  });

  try {
    const { text: translatedText, direction } = await translateText(sourceText);
    updateTranslatorStatusSuccess(direction);
    broadcastSettingsSnapshot();
    showTranslateBubblePayload({
      status: "done",
      sourceText,
      translatedText,
      lang: getUiLang(),
      direction,
      diagnostic: { source: "clipboard" },
    });
  } catch (err) {
    updateTranslatorStatusError(err);
    broadcastSettingsSnapshot();
    showTranslateBubblePayload({
      status: "error",
      sourceText,
      errorMessage: err && err.message ? err.message : "Translation failed",
      lang: getUiLang(),
      diagnostic: { source: "clipboard" },
    });
  }
}

function handleTranslateHeight(event, height) {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin !== translateWin) return;
  if (typeof height === "number" && height > 0) {
    translateMeasuredHeight = Math.ceil(height);
    const pos = computeTranslateBubblePosition();
    translateWin.setBounds({ ...pos, height: translateMeasuredHeight + 12 });
  }
}

function handleTranslateClose() {
  hideTranslateBubble(false);
}

function cleanupTranslateBubble() {
  if (translateHideTimer) { clearTimeout(translateHideTimer); translateHideTimer = null; }
  if (translateWin && !translateWin.isDestroyed()) {
    translateWin.destroy();
    translateWin = null;
  }
}


const _updateBubbleCtx = {
  get win() { return win; },
  get bubbleFollowPet() { return bubbleFollowPet; },
  get petHidden() { return petHidden; },
  getPendingPermissions: () => pendingPermissions,
  getNearestWorkArea,
  getHitRectScreen,
  guardAlwaysOnTop,
  reapplyMacVisibility,
};
const _updateBubble = require("./update-bubble")(_updateBubbleCtx);
const {
  showUpdateBubble,
  hideUpdateBubble,
  repositionUpdateBubble,
  handleUpdateBubbleAction,
  handleUpdateBubbleHeight,
  syncVisibility: syncUpdateBubbleVisibility,
} = _updateBubble;

_timeCheckinBubble = initTimeCheckinBubble(_updateBubbleCtx);

function repositionFloatingBubbles() {
  if (pendingPermissions.length) repositionBubbles();
  repositionUpdateBubble();
  if (_timeCheckinBubble) _timeCheckinBubble.reposition();
}

// ── macOS cross-Space visibility helper ──
// Prefer native collection behavior over Electron's setVisibleOnAllWorkspaces:
// Electron may briefly hide the window while transforming process type, while
// the native path also mirrors Masko Code's SkyLight-backed stationary Space.
function reapplyMacVisibility() {
  if (!isMac) return;
  const apply = (w) => {
    if (w && !w.isDestroyed()) {
      const deferUntil = Number(w.__clawdMacDeferredVisibilityUntil) || 0;
      if (deferUntil > Date.now()) return;
      if (deferUntil) delete w.__clawdMacDeferredVisibilityUntil;
      w.setAlwaysOnTop(true, MAC_TOPMOST_LEVEL);
      if (!applyStationaryCollectionBehavior(w)) {
        const opts = { visibleOnFullScreen: true };
        if (!showDock) opts.skipTransformProcessType = true;
        w.setVisibleOnAllWorkspaces(true, opts);
        // First, try the native flicker-free path.
        // If the native path fails, use Electron's cross-space API as a fallback.
        // After using Electron as a fallback, try the native enhancement again to avoid Electron resetting the window behavior we want.
        applyStationaryCollectionBehavior(w);
      }
    }
  };
  apply(win);
  apply(hitWin);
  for (const perm of pendingPermissions) apply(perm.bubble);
  apply(_updateBubble.getBubbleWindow());
  apply(contextMenuOwner);
}

// ── State machine — delegated to src/state.js ──
const _stateCtx = {
  get theme() { return activeTheme; },
  get win() { return win; },
  get hitWin() { return hitWin; },
  get doNotDisturb() { return doNotDisturb; },
  set doNotDisturb(v) { doNotDisturb = v; },
  get miniMode() { return _mini.getMiniMode(); },
  get miniTransitioning() { return _mini.getMiniTransitioning(); },
  get mouseOverPet() { return mouseOverPet; },
  get miniSleepPeeked() { return _mini.getMiniSleepPeeked(); },
  set miniSleepPeeked(v) { _mini.setMiniSleepPeeked(v); },
  get miniPeeked() { return _mini.getMiniPeeked(); },
  set miniPeeked(v) { _mini.setMiniPeeked(v); },
  get idlePaused() { return idlePaused; },
  set idlePaused(v) { idlePaused = v; },
  get forceEyeResend() { return forceEyeResend; },
  set forceEyeResend(v) { forceEyeResend = v; },
  get mouseStillSince() { return _tick ? _tick._mouseStillSince : Date.now(); },
  get pendingPermissions() { return pendingPermissions; },
  get showSessionId() { return showSessionId; },
  sendToRenderer,
  sendToHitWin,
  syncHitWin,
  playSound,
  t: (key) => t(key),
  focusTerminalWindow: (...args) => focusTerminalWindow(...args),
  resolvePermissionEntry: (...args) => resolvePermissionEntry(...args),
  miniPeekIn: () => miniPeekIn(),
  miniPeekOut: () => miniPeekOut(),
  buildContextMenu: () => buildContextMenu(),
  buildTrayMenu: () => buildTrayMenu(),
  debugLog: (msg) => sessionLog(msg),
  // Phase 3b: 读 prefs.themeOverrides 判断某个 oneshot state 是否被用户禁用。
  // state.js gate 调这个做 early-return。不做白名单校验——settings-actions
  // 负责写入合法性，这里只读。
  isOneshotDisabled: (stateKey) => {
    const themeId = activeTheme && activeTheme._id;
    if (!themeId || !stateKey) return false;
    const overrides = _settingsController.get("themeOverrides");
    const themeMap = overrides && overrides[themeId];
    const stateMap = themeMap && themeMap.states;
    const entry = (stateMap && stateMap[stateKey]) || (themeMap && themeMap[stateKey]);
    return !!(entry && entry.disabled === true);
  },
  hasAnyEnabledAgent: () => {
    // `get("agents")` returns the live reference (no clone) — we're only
    // reading. Missing agents field falls back to "assume enabled" (the
    // legacy default-true contract for unconfigured installs); but an
    // explicit empty object means every agent was cleared, so return
    // false. Without that distinction, a user who wiped the field would
    // still trigger startup-recovery process scans.
    const agents = _settingsController.get("agents");
    if (!agents || typeof agents !== "object") return true;
    const probe = { agents };
    for (const id of Object.keys(agents)) {
      if (_isAgentEnabled(probe, id)) return true;
    }
    return false;
  },
};
const _state = require("./state")(_stateCtx);
const { setState, applyState, updateSession, resolveDisplayState, getSvgOverride,
        enableDoNotDisturb, disableDoNotDisturb, startStaleCleanup, stopStaleCleanup,
        startWakePoll, stopWakePoll, detectRunningAgentProcesses, buildSessionSubmenu,
        startStartupRecovery: _startStartupRecovery } = _state;
const sessions = _state.sessions;
const STATE_PRIORITY = _state.STATE_PRIORITY;

// ── Hit-test: SVG bounding box → screen coordinates ──
function getHitRectScreen(bounds) {
  const state = _state.getCurrentState();
  const file = _state.getCurrentSvg() || (activeTheme && activeTheme.states && activeTheme.states.idle[0]);
  const hit = hitGeometry.getHitRectScreen(
    activeTheme,
    bounds,
    state,
    file,
    _state.getCurrentHitBox(),
    {
      padX: _mini.getMiniMode() ? _mini.PEEK_OFFSET : 0,
      padY: _mini.getMiniMode() ? 8 : 0,
    }
  );
  return hit || { left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height };
}

// ── Main tick — delegated to src/tick.js ──
const _tickCtx = {
  get theme() { return activeTheme; },
  get win() { return win; },
  get currentState() { return _state.getCurrentState(); },
  get currentSvg() { return _state.getCurrentSvg(); },
  get miniMode() { return _mini.getMiniMode(); },
  get miniTransitioning() { return _mini.getMiniTransitioning(); },
  get dragLocked() { return dragLocked; },
  get menuOpen() { return menuOpen; },
  get idlePaused() { return idlePaused; },
  get isAnimating() { return _mini.getIsAnimating(); },
  get miniSleepPeeked() { return _mini.getMiniSleepPeeked(); },
  set miniSleepPeeked(v) { _mini.setMiniSleepPeeked(v); },
  get miniPeeked() { return _mini.getMiniPeeked(); },
  set miniPeeked(v) { _mini.setMiniPeeked(v); },
  get mouseOverPet() { return mouseOverPet; },
  set mouseOverPet(v) { mouseOverPet = v; },
  get forceEyeResend() { return forceEyeResend; },
  set forceEyeResend(v) { forceEyeResend = v; },
  get startupRecoveryActive() { return _state.getStartupRecoveryActive(); },
  sendToRenderer,
  sendToHitWin,
  setState,
  applyState,
  miniPeekIn: () => miniPeekIn(),
  miniPeekOut: () => miniPeekOut(),
  getObjRect,
  getHitRectScreen,
};
const _tick = require("./tick")(_tickCtx);
const { startMainTick, resetIdleTimer } = _tick;

_macInputMonitor.setHandlers({
  onTypingStart: () => {
    resetIdleTimer();
    _state.setComposingActive(true);
  },
  onTypingStop: () => {
    resetIdleTimer();
    _state.setComposingActive(false);
  },
  onStatusChange: (status) => {
    macTypingPermissionStatus = status;
    broadcastSettingsSnapshot();
  },
  logger: (msg) => console.warn("Clawd:", msg),
});

_globalRulesEngine = createGlobalRulesEngine({
  enabled: !!_settingsController.get("globalActivityEnabled"),
  rules: _settingsController.get("globalActivityRules") || {},
  onStateChange: (visualState, snapshot) => {
    syncGlobalActivityStatusFromEngine(snapshot);
    if (_state) {
      _state.setGlobalPresenceActive(!!(snapshot && snapshot.presenceActive));
      _state.setGlobalRuleState(visualState || null);
    }
  },
  onStatusChange: (snapshot) => {
    syncGlobalActivityStatusFromEngine(snapshot);
  },
});

_frontmostAppMonitor = createMacosFrontmostAppMonitor({
  onAppChange: (signal) => handleGlobalRuleSignal({ type: "frontmost-app-changed", ...signal }),
  onStatus: (status) => {
    _globalRulesEngine.setCollectorStatus("frontmostApp", status);
    _globalRulesEngine.setCollectorStatus("browser", status);
    syncGlobalActivityStatusFromEngine();
  },
});

_clipboardMonitor = createMacosClipboardMonitor({
  readText: () => {
    const { clipboard } = require("electron");
    return clipboard.readText();
  },
  onTextChange: (signal) => {
    if (signal && typeof signal.text === "string" && signal.text.trim()) {
      _clipboardHistory.add(signal.text, signal.at || Date.now());
    }
    handleGlobalRuleSignal({ type: "clipboard-text-changed", ...signal });
  },
  onStatus: (status) => {
    _globalRulesEngine.setCollectorStatus("clipboard", status);
    syncGlobalActivityStatusFromEngine();
  },
});

_notificationMonitor = createMacosNotificationMonitor({
  onStatus: (status) => {
    _globalRulesEngine.setCollectorStatus("notifications", status);
    syncGlobalActivityStatusFromEngine();
  },
});

_mediaMonitor = createMacosMediaMonitor({
  onPlaybackChange: (signal) => handleGlobalRuleSignal({ type: "media-state", ...signal }),
  onStatus: (status) => {
    _globalRulesEngine.setCollectorStatus("media", status);
    syncGlobalActivityStatusFromEngine();
  },
});

_timeCheckinRuntime = createTimeCheckinRuntime({
  generateMessage: ({ reason, now }) => generateTimeCheckinMessage({ reason, now }),
  onCheckinReady: (detail) => handleTimeCheckinReady(detail),
  onStatusChange: (runtimeStatus) => {
    timeCheckinStatus = {
      ...timeCheckinStatus,
      enabled: !!_settingsController.get("timeCheckinEnabled"),
      nextRunAt: runtimeStatus.nextRunAt,
      lastRunAt: runtimeStatus.lastRunAt || timeCheckinStatus.lastRunAt,
      lastResult: runtimeStatus.lastResult || timeCheckinStatus.lastResult,
      lastError: runtimeStatus.lastError || timeCheckinStatus.lastError,
    };
    broadcastSettingsSnapshot();
  },
});

// ── Terminal focus — delegated to src/focus.js ──
const _focus = require("./focus")({ _allowSetForeground });
const { initFocusHelper, killFocusHelper, focusTerminalWindow, clearMacFocusCooldownTimer, runMacFocusCheck } = _focus;

// ── HTTP server — delegated to src/server.js ──
const _serverCtx = {
  get manageClaudeHooksAutomatically() { return manageClaudeHooksAutomatically; },
  get autoStartWithClaude() { return autoStartWithClaude; },
  get doNotDisturb() { return doNotDisturb; },
  get hideBubbles() { return hideBubbles; },
  get pendingPermissions() { return pendingPermissions; },
  get PASSTHROUGH_TOOLS() { return PASSTHROUGH_TOOLS; },
  get STATE_SVGS() { return _state.STATE_SVGS; },
  get sessions() { return sessions; },
  isAgentEnabled: (agentId) => _isAgentEnabled({ agents: _settingsController.get("agents") }, agentId),
  isAgentPermissionsEnabled: (agentId) => _isAgentPermissionsEnabled({ agents: _settingsController.get("agents") }, agentId),
  setState,
  applySupervisorState: (state, svg) => _state.applySupervisorState(state, svg),
  updateSession,
  resolvePermissionEntry,
  sendPermissionResponse,
  showPermissionBubble,
  replyOpencodePermission,
  permLog,
};
const _server = require("./server")(_serverCtx);
const { startHttpServer, getHookServerPort } = _server;

// ── alwaysOnTop recovery (Windows DWM / Shell can strip TOPMOST flag) ──
// The "always-on-top-changed" event only fires from Electron's own SetAlwaysOnTop
// path — it does NOT fire when Explorer/Start menu/Gallery silently reorder windows.
// So we keep the event listener for the cases it does catch (Alt/Win key), and add
// a slow watchdog (20s) to recover from silent shell-initiated z-order drops.
const WIN_TOPMOST_LEVEL = "pop-up-menu";  // above taskbar-level UI
const MAC_TOPMOST_LEVEL = "screen-saver"; // above fullscreen apps on macOS
const TOPMOST_WATCHDOG_MS = 5_000;
let topmostWatchdog = null;
let hwndRecoveryTimer = null;

// Reinitialize HWND input routing after DWM z-order disruptions.
// showInactive() (ShowWindow SW_SHOWNOACTIVATE) is the same call that makes
// the right-click context menu restore drag capability — it forces Windows to
// fully recalculate the transparent window's input target region.
function scheduleHwndRecovery() {
  if (!isWin) return;
  if (hwndRecoveryTimer) clearTimeout(hwndRecoveryTimer);
  hwndRecoveryTimer = setTimeout(() => {
    hwndRecoveryTimer = null;
    if (!win || win.isDestroyed()) return;
    // Just restore z-order — input routing is handled by hitWin now
    win.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    if (hitWin && !hitWin.isDestroyed()) hitWin.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    forceEyeResend = true;
  }, 1000);
}

function guardAlwaysOnTop(w) {
  if (!isWin) return;
  w.on("always-on-top-changed", (_, isOnTop) => {
    if (!isOnTop && w && !w.isDestroyed()) {
      w.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
      if (w === win && !dragLocked && !_mini.getIsAnimating()) {
        forceEyeResend = true;
        const { x, y } = win.getBounds();
        win.setPosition(x + 1, y);
        win.setPosition(x, y);
        syncHitWin();
        scheduleHwndRecovery();
      }
    }
  });
}

function startTopmostWatchdog() {
  if (!isWin || topmostWatchdog) return;
  topmostWatchdog = setInterval(() => {
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    }
    // Keep hitWin topmost too
    if (hitWin && !hitWin.isDestroyed()) {
      hitWin.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    }
    for (const perm of pendingPermissions) {
      if (perm.bubble && !perm.bubble.isDestroyed() && perm.bubble.isVisible()) perm.bubble.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    }
    const updateBubbleWin = _updateBubble.getBubbleWindow();
    if (updateBubbleWin && !updateBubbleWin.isDestroyed() && updateBubbleWin.isVisible()) {
      updateBubbleWin.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    }
  }, TOPMOST_WATCHDOG_MS);
}

function stopTopmostWatchdog() {
  if (topmostWatchdog) { clearInterval(topmostWatchdog); topmostWatchdog = null; }
}

function updateLog(msg) {
  if (!updateDebugLog) return;
  const { rotatedAppend } = require("./log-rotate");
  rotatedAppend(updateDebugLog, `[${new Date().toISOString()}] ${msg}\n`);
}

function sessionLog(msg) {
  if (!sessionDebugLog) return;
  const { rotatedAppend } = require("./log-rotate");
  rotatedAppend(sessionDebugLog, `[${new Date().toISOString()}] ${msg}\n`);
}

// ── Menu — delegated to src/menu.js ──
//
// Setters that previously assigned to module-level vars now route through
// `_settingsController.applyUpdate(key, value)`. The mirror cache is updated
// by the subscriber wired in `wireSettingsSubscribers()` after this ctx is
// built. Side effects that used to live inside setters (e.g.
// `syncPermissionShortcuts()` for hideBubbles) are now reactive and live in
// the subscriber too.
const _menuCtx = {
  get win() { return win; },
  get sessions() { return sessions; },
  get currentSize() { return currentSize; },
  set currentSize(v) { _settingsController.applyUpdate("size", v); },
  get doNotDisturb() { return doNotDisturb; },
  get lang() { return lang; },
  set lang(v) { _settingsController.applyUpdate("lang", v); },
  get showTray() { return showTray; },
  set showTray(v) { _settingsController.applyUpdate("showTray", v); },
  get showDock() { return showDock; },
  set showDock(v) { _settingsController.applyUpdate("showDock", v); },
  get manageClaudeHooksAutomatically() { return manageClaudeHooksAutomatically; },
  get autoStartWithClaude() { return autoStartWithClaude; },
  set autoStartWithClaude(v) { _settingsController.applyUpdate("autoStartWithClaude", v); },
  get openAtLogin() { return openAtLogin; },
  set openAtLogin(v) { _settingsController.applyUpdate("openAtLogin", v); },
  get bubbleFollowPet() { return bubbleFollowPet; },
  set bubbleFollowPet(v) { _settingsController.applyUpdate("bubbleFollowPet", v); },
  get hideBubbles() { return hideBubbles; },
  set hideBubbles(v) { _settingsController.applyUpdate("hideBubbles", v); },
  get showSessionId() { return showSessionId; },
  set showSessionId(v) { _settingsController.applyUpdate("showSessionId", v); },
  get soundMuted() { return soundMuted; },
  set soundMuted(v) { _settingsController.applyUpdate("soundMuted", v); },
  get pendingPermissions() { return pendingPermissions; },
  repositionBubbles: () => repositionFloatingBubbles(),
  get petHidden() { return petHidden; },
  togglePetVisibility: () => togglePetVisibility(),
  get isQuitting() { return isQuitting; },
  set isQuitting(v) { isQuitting = v; },
  get menuOpen() { return menuOpen; },
  set menuOpen(v) { menuOpen = v; },
  get tray() { return tray; },
  set tray(v) { tray = v; },
  get contextMenuOwner() { return contextMenuOwner; },
  set contextMenuOwner(v) { contextMenuOwner = v; },
  get contextMenu() { return contextMenu; },
  set contextMenu(v) { contextMenu = v; },
  enableDoNotDisturb: () => enableDoNotDisturb(),
  disableDoNotDisturb: () => disableDoNotDisturb(),
  enterMiniViaMenu: () => enterMiniViaMenu(),
  exitMiniMode: () => exitMiniMode(),
  getMiniMode: () => _mini.getMiniMode(),
  getMiniTransitioning: () => _mini.getMiniTransitioning(),
  miniHandleResize: (sizeKey) => _mini.handleResize(sizeKey),
  focusTerminalWindow: (...args) => focusTerminalWindow(...args),
  checkForUpdates: (...args) => checkForUpdates(...args),
  getUpdateMenuItem: () => getUpdateMenuItem(),
  buildSessionSubmenu: () => buildSessionSubmenu(),
  // The settings controller is the only writer of persisted prefs. Toggle
  // setters above route through it; resize/sendToDisplay use
  // flushRuntimeStateToPrefs to capture window bounds after movement.
  flushRuntimeStateToPrefs,
  settings: _settingsController,
  syncHitWin,
  getCurrentPixelSize,
  isProportionalMode,
  PROPORTIONAL_RATIOS,
  getHookServerPort: () => getHookServerPort(),
  clampToScreen,
  getNearestWorkArea,
  reapplyMacVisibility,
  discoverThemes: () => themeLoader.discoverThemes(),
  getActiveThemeId: () => activeTheme ? activeTheme._id : "clawd",
  getActiveThemeCapabilities: () => activeTheme ? activeTheme._capabilities : null,
  ensureUserThemesDir: () => themeLoader.ensureUserThemesDir(),
  openSettingsWindow: () => openSettingsWindow(),
  openAgentCli: () => tryOpenAgentCli(),
  runTranslatorHealthCheck: () => runTranslatorHealthCheck(),
  showTranslateBubbleTest: (mode) => showTranslateBubbleTest(mode),
  runTerminalActionCheck: () => runTerminalActionCheck(),
  runGlobalActivityTest: (ruleId) => runGlobalActivityTest(ruleId),
  runTimeCheckinNow: () => runTimeCheckinNow(),
  previewTimeCheckinContext: () => previewTimeCheckinContext(),
  isAgentLauncherEnabled: () => {
    const snap = _settingsController.getSnapshot();
    const al = snap && snap.agentLauncher;
    return !!(al && al.enabled);
  },
};
const _menu = require("./menu")(_menuCtx);
const { t, buildContextMenu, buildTrayMenu, rebuildAllMenus, createTray,
        destroyTray, showPetContextMenu, popupMenuAt, ensureContextMenuOwner,
        requestAppQuit, applyDockVisibility } = _menu;

// ── Settings subscribers ──
//
// Single source of truth: any change to `_settingsController` lands here
// first. We update the mirror caches above (so existing sync read sites
// still work), then fire reactive side effects (menu rebuild, permission
// shortcut resync, bubble reposition, etc.). Setters in the ctx above
// route writes through the controller, so menu clicks and IPC updates
// from a future settings panel land here identically.
const MENU_AFFECTING_KEYS = new Set([
  "lang", "soundMuted", "bubbleFollowPet", "hideBubbles", "showSessionId",
  "manageClaudeHooksAutomatically", "autoStartWithClaude", "openAtLogin", "showTray", "showDock", "theme", "size",
  "agentLauncher",
]);
function wireSettingsSubscribers() {
  _settingsController.subscribe(({ changes }) => {
    // 1. Update mirror caches first so any side-effect handler reads fresh values.
    if ("lang" in changes) lang = changes.lang;
    if ("size" in changes) currentSize = changes.size;
    if ("showTray" in changes) {
      showTray = changes.showTray;
      try { changes.showTray ? createTray() : destroyTray(); } catch (err) {
        console.warn("Clawd: tray toggle failed:", err && err.message);
      }
    }
    if ("showDock" in changes) {
      showDock = changes.showDock;
      try { applyDockVisibility(); } catch (err) {
        console.warn("Clawd: applyDockVisibility failed:", err && err.message);
      }
    }
    if ("manageClaudeHooksAutomatically" in changes) {
      manageClaudeHooksAutomatically = changes.manageClaudeHooksAutomatically;
    }
    // autoStartWithClaude / openAtLogin are object-form pre-commit gates in
    // settings-actions.js — by the time we get here the system call already
    // succeeded (or the commit was rejected), so the subscriber only needs
    // to update the mirror cache. No more registerHooks/setLoginItemSettings
    // here; that violates the unidirectional flow (see plan §4.2).
    if ("autoStartWithClaude" in changes) {
      autoStartWithClaude = changes.autoStartWithClaude;
    }
    if ("openAtLogin" in changes) {
      openAtLogin = changes.openAtLogin;
    }
    if ("bubbleFollowPet" in changes) bubbleFollowPet = changes.bubbleFollowPet;
    if ("hideBubbles" in changes) hideBubbles = changes.hideBubbles;
    if ("showSessionId" in changes) showSessionId = changes.showSessionId;
    if ("soundMuted" in changes) soundMuted = changes.soundMuted;
    if ("macTypingAwarenessEnabled" in changes) {
      macTypingAwarenessEnabled = changes.macTypingAwarenessEnabled;
      try {
        if (isMac && macTypingAwarenessEnabled) _macInputMonitor.start();
        else {
          _macInputMonitor.stop();
          _state.setComposingActive(false);
        }
        macTypingPermissionStatus = _macInputMonitor.getStatus();
      } catch (err) {
        console.warn("Clawd: mac typing awareness sync failed:", err && err.message);
      }
    }
    if ("translateApiKey" in changes) {
      setApiKey(changes.translateApiKey || "");
      translatorStatus = {
        ...translatorStatus,
        configured: !!((changes.translateApiKey || process.env.MINIMAX_API_KEY || "").trim()),
      };
    }
    if ("translateProvider" in changes) {
      translatorStatus = {
        ...translatorStatus,
        backend: changes.translateProvider || "minimax",
      };
    }
    if ("globalActivityEnabled" in changes || "globalActivityRules" in changes) {
      try {
        syncGlobalActivityFromPrefs();
      } catch (err) {
        console.warn("Clawd: global activity sync failed:", err && err.message);
      }
    }
    if (
      "timeCheckinEnabled" in changes
      || "timeCheckinGenerator" in changes
      || "timeCheckinPreviewClipboardWindowMinutes" in changes
      || "timeCheckinLastRunAt" in changes
    ) {
      try {
        syncTimeCheckinFromPrefs();
      } catch (err) {
        console.warn("Clawd: time check-in sync failed:", err && err.message);
      }
    }

    if ("agentLauncher" in changes) {
      try { pushAgentLauncherToHit(); } catch (err) {
        console.warn("Clawd: pushAgentLauncherToHit failed:", err && err.message);
      }
    }

    // 2. Reactive side effects (mirror what the legacy setters / click handlers used to do).
    if ("hideBubbles" in changes) {
      try { syncPermissionShortcuts(); } catch (err) {
        console.warn("Clawd: syncPermissionShortcuts failed:", err && err.message);
      }
    }
    if ("bubbleFollowPet" in changes) {
      try { repositionFloatingBubbles(); } catch (err) {
        console.warn("Clawd: repositionFloatingBubbles failed:", err && err.message);
      }
    }

    // 3. Menu rebuild — only for menu-affecting keys to avoid thrashing on
    //    window position / mini state changes.
    for (const key of Object.keys(changes)) {
      if (MENU_AFFECTING_KEYS.has(key)) {
        try { rebuildAllMenus(); } catch (err) {
          console.warn("Clawd: rebuildAllMenus failed:", err && err.message);
        }
        break;
      }
    }

    // 4. Broadcast to all renderer windows for the future settings panel.
    broadcastSettingsSnapshot(changes);
  });
}
wireSettingsSubscribers();

const ANIMATION_OVERRIDE_ASSET_EXTS = new Set([".svg", ".gif", ".apng", ".png", ".webp", ".jpg", ".jpeg"]);
let animationOverridePreviewTimer = null;

function _buildFileUrl(absPath) {
  try { return pathToFileURL(absPath).href; }
  catch { return null; }
}

function _resolveAnimationAssetAbsPath(filename) {
  if (!filename || !activeTheme) return null;
  try {
    const absPath = themeLoader.getAssetPath(filename);
    return absPath && fs.existsSync(absPath) ? absPath : null;
  } catch {
    return null;
  }
}

function _resolveAnimationAssetsDir(theme = activeTheme) {
  if (!theme) return null;
  const themeAssetsDir = theme._themeDir ? path.join(theme._themeDir, "assets") : null;
  if (themeAssetsDir && fs.existsSync(themeAssetsDir)) return themeAssetsDir;
  const idleFile = theme.states && theme.states.idle && theme.states.idle[0];
  if (!idleFile) return null;
  const resolved = themeLoader.getAssetPath(idleFile);
  return resolved ? path.dirname(resolved) : null;
}

function _buildAnimationAssetUrl(filename) {
  const absPath = _resolveAnimationAssetAbsPath(filename);
  return absPath ? _buildFileUrl(absPath) : null;
}

function _buildAnimationAssetProbe(file) {
  const absPath = _resolveAnimationAssetAbsPath(file);
  if (!absPath) {
    return {
      assetCycleMs: null,
      assetCycleStatus: "unavailable",
      assetCycleSource: null,
    };
  }
  const probe = animationCycle.probeAssetCycle(absPath);
  return {
    assetCycleMs: Number.isFinite(probe && probe.ms) && probe.ms > 0 ? probe.ms : null,
    assetCycleStatus: (probe && probe.status) || "unavailable",
    assetCycleSource: (probe && probe.source) || null,
  };
}

function _readCurrentThemeOverrideMap() {
  const themeId = activeTheme && activeTheme._id;
  if (!themeId || !_settingsController || typeof _settingsController.getSnapshot !== "function") return null;
  const snapshot = _settingsController.getSnapshot();
  return snapshot && snapshot.themeOverrides ? snapshot.themeOverrides[themeId] || null : null;
}

function _hasExplicitAutoReturnOverride(themeOverrideMap, stateKey) {
  const autoReturn = themeOverrideMap && themeOverrideMap.timings && themeOverrideMap.timings.autoReturn;
  return !!(autoReturn && Object.prototype.hasOwnProperty.call(autoReturn, stateKey));
}

function _buildTimingHint(file, fallbackMs = null) {
  const assetProbe = _buildAnimationAssetProbe(file);
  const suggestedDurationMs = assetProbe.assetCycleMs != null
    ? assetProbe.assetCycleMs
    : (Number.isFinite(fallbackMs) && fallbackMs > 0 ? fallbackMs : null);
  const suggestedDurationStatus = assetProbe.assetCycleMs != null
    ? assetProbe.assetCycleStatus
    : (suggestedDurationMs != null ? "fallback" : "unavailable");
  return {
    ...assetProbe,
    suggestedDurationMs,
    suggestedDurationStatus,
    previewDurationMs: suggestedDurationMs,
  };
}

function _listAnimationOverrideAssets(theme = activeTheme) {
  if (!theme) return [];
  const dirs = [];
  const primaryDir = _resolveAnimationAssetsDir(theme);
  const sourceDir = theme._themeDir ? path.join(theme._themeDir, "assets") : null;
  const cacheDir = theme._assetsDir || null;
  for (const dir of [primaryDir, sourceDir, cacheDir]) {
    if (!dir || !fs.existsSync(dir)) continue;
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  const seen = new Set();
  const assets = [];
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!ANIMATION_OVERRIDE_ASSET_EXTS.has(ext)) continue;
      if (seen.has(entry.name)) continue;
      const absPath = _resolveAnimationAssetAbsPath(entry.name) || path.join(dir, entry.name);
      const previewUrl = _buildFileUrl(absPath);
      const probe = animationCycle.probeAssetCycle(absPath);
      assets.push({
        name: entry.name,
        fileUrl: previewUrl,
        ext,
        cycleMs: Number.isFinite(probe && probe.ms) && probe.ms > 0 ? probe.ms : null,
        cycleStatus: (probe && probe.status) || "unavailable",
        cycleSource: (probe && probe.source) || null,
      });
      seen.add(entry.name);
    }
  }
  assets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return assets;
}

function _readResolvedTransition(file) {
  const entry = activeTheme && activeTheme.transitions && activeTheme.transitions[file];
  return {
    in: entry && Number.isFinite(entry.in) ? entry.in : 150,
    out: entry && Number.isFinite(entry.out) ? entry.out : 150,
  };
}

function _hasOwnStateFiles(stateKey) {
  if (!activeTheme) return false;
  const binding = activeTheme._stateBindings && activeTheme._stateBindings[stateKey];
  if (binding && Array.isArray(binding.files) && binding.files[0]) return true;
  if (activeTheme.states && Array.isArray(activeTheme.states[stateKey]) && activeTheme.states[stateKey][0]) return true;
  if (activeTheme.miniMode && activeTheme.miniMode.states
      && Array.isArray(activeTheme.miniMode.states[stateKey]) && activeTheme.miniMode.states[stateKey][0]) {
    return true;
  }
  return false;
}

function _buildTierCardGroup(tierGroup, triggerKind, resolvedTiers, baseTiers, baseHintMap, sectionId = "work") {
  if (!Array.isArray(resolvedTiers)) return [];
  return resolvedTiers.map((tier, index) => {
    const baseTier = Array.isArray(baseTiers) ? baseTiers[index] : null;
    const originalFile = (baseTier && baseTier.originalFile) || tier.file;
    const higherTier = index === 0 ? null : resolvedTiers[index - 1];
    const maxSessions = higherTier ? Math.max(tier.minSessions, higherTier.minSessions - 1) : null;
    const hintTarget = baseHintMap && baseHintMap[originalFile];
    const timingHint = _buildTimingHint(tier.file);
    return {
      id: `${tierGroup}:${originalFile}`,
      slotType: "tier",
      sectionId,
      tierGroup,
      triggerKind,
      originalFile,
      baseFile: originalFile,
      minSessions: tier.minSessions,
      maxSessions,
      currentFile: tier.file,
      currentFileUrl: _buildAnimationAssetUrl(tier.file),
      bindingLabel: `${tierGroup}[${originalFile}]`,
      transition: _readResolvedTransition(tier.file),
      supportsAutoReturn: false,
      supportsDuration: false,
      autoReturnMs: null,
      durationMs: null,
      hasAutoReturnOverride: false,
      ...timingHint,
      displayHintWarning: !!(hintTarget && hintTarget !== originalFile),
      displayHintTarget: hintTarget || null,
    };
  });
}

function _getResolvedStateCardBinding(stateKey) {
  if (!activeTheme) return null;
  const bindingMap = activeTheme._stateBindings || {};
  let cursor = stateKey;
  let hops = 0;
  const visited = new Set([stateKey]);

  while (cursor && hops <= 3) {
    const binding = bindingMap[cursor] || {};
    const files = Array.isArray(binding.files)
      ? binding.files
      : (
        activeTheme.states && Array.isArray(activeTheme.states[cursor]) ? activeTheme.states[cursor]
          : (
            activeTheme.miniMode && activeTheme.miniMode.states && Array.isArray(activeTheme.miniMode.states[cursor])
              ? activeTheme.miniMode.states[cursor]
              : []
          )
      );
    if (files[0]) {
      return {
        currentFile: files[0],
        resolvedState: cursor,
        fallbackTargetState: cursor !== stateKey ? cursor : null,
      };
    }
    const fallbackTo = typeof binding.fallbackTo === "string" && binding.fallbackTo ? binding.fallbackTo : null;
    if (!fallbackTo || visited.has(fallbackTo)) break;
    visited.add(fallbackTo);
    cursor = fallbackTo;
    hops += 1;
  }

  return null;
}

function _buildStateCard(stateKey, triggerKind, themeOverrideMap, options = {}) {
  const resolved = _getResolvedStateCardBinding(stateKey);
  if (!resolved || !resolved.currentFile) return null;
  const currentFile = resolved.currentFile;
  const autoReturnMap = (activeTheme && activeTheme.timings && activeTheme.timings.autoReturn) || {};
  const supportsAutoReturn = Object.prototype.hasOwnProperty.call(autoReturnMap, stateKey);
  const resolvedAutoReturnMs = supportsAutoReturn ? autoReturnMap[stateKey] : null;
  const timingHint = _buildTimingHint(currentFile, resolvedAutoReturnMs);
  const fallbackTargetState = resolved.fallbackTargetState;
  const bindingMap = options.bindingMap || (
    options.bindingPathPrefix === "miniMode.states"
      ? ((activeTheme._bindingBase && activeTheme._bindingBase.miniStates) || {})
      : ((activeTheme._bindingBase && activeTheme._bindingBase.states) || {})
  );
  const bindingPathPrefix = options.bindingPathPrefix || "states";
  return {
    id: `state:${stateKey}`,
    slotType: "state",
    sectionId: options.sectionId || null,
    stateKey,
    triggerKind,
    currentFile,
    resolvedState: resolved.resolvedState,
    fallbackTargetState,
    baseFile: bindingMap[stateKey] || currentFile,
    currentFileUrl: _buildAnimationAssetUrl(currentFile),
    bindingLabel: fallbackTargetState
      ? `${bindingPathPrefix}.${stateKey}.fallbackTo -> ${fallbackTargetState}`
      : `${bindingPathPrefix}.${stateKey}[0]`,
    transition: _readResolvedTransition(currentFile),
    supportsAutoReturn,
    supportsDuration: false,
    autoReturnMs: resolvedAutoReturnMs,
    durationMs: null,
    hasAutoReturnOverride: supportsAutoReturn ? _hasExplicitAutoReturnOverride(themeOverrideMap, stateKey) : false,
    ...timingHint,
    displayHintWarning: false,
    displayHintTarget: null,
  };
}

function _buildIdleAnimationCards(themeOverrideMap) {
  if (!activeTheme || !Array.isArray(activeTheme.idleAnimations)) return [];
  const baseIdleAnimations = (activeTheme._bindingBase && activeTheme._bindingBase.idleAnimations) || [];
  const overrideMap = themeOverrideMap && themeOverrideMap.idleAnimations;
  return activeTheme.idleAnimations
    .map((entry, index) => {
      if (!entry || typeof entry.file !== "string" || !entry.file) return null;
      const baseEntry = baseIdleAnimations[index] || null;
      const originalFile = (baseEntry && baseEntry.originalFile) || entry.file;
      const durationMs = Number.isFinite(entry.duration) ? entry.duration : null;
      const timingHint = _buildTimingHint(entry.file, durationMs);
      const hasDurationOverride = !!(overrideMap
        && overrideMap[originalFile]
        && Object.prototype.hasOwnProperty.call(overrideMap[originalFile], "durationMs"));
      return {
        id: `idleAnimation:${originalFile}`,
        slotType: "idleAnimation",
        sectionId: "idle",
        triggerKind: "idleAnimation",
        poolIndex: index + 1,
        originalFile,
        baseFile: originalFile,
        currentFile: entry.file,
        currentFileUrl: _buildAnimationAssetUrl(entry.file),
        bindingLabel: `idleAnimations[${index}] (${originalFile})`,
        transition: _readResolvedTransition(entry.file),
        supportsAutoReturn: false,
        supportsDuration: true,
        autoReturnMs: null,
        durationMs,
        hasDurationOverride,
        hasAutoReturnOverride: false,
        ...timingHint,
        previewDurationMs: timingHint.previewDurationMs || durationMs,
        displayHintWarning: false,
        displayHintTarget: null,
      };
    })
    .filter(Boolean);
}

function _pushSection(sections, id, mode, cards) {
  if (!Array.isArray(cards) || cards.length === 0) return;
  sections.push({ id, mode: mode || null, cards });
}

function _buildAnimationOverrideSections() {
  if (!activeTheme) return [];
  const themeOverrideMap = _readCurrentThemeOverrideMap();
  const sections = [];
  const thinking = _buildStateCard("thinking", "thinking", themeOverrideMap);
  const baseBindings = activeTheme._bindingBase || {};
  const workCards = [];
  if (thinking) {
    thinking.sectionId = "work";
    workCards.push(thinking);
  }
  workCards.push(..._buildTierCardGroup(
    "workingTiers",
    "working",
    activeTheme.workingTiers || [],
    baseBindings.workingTiers || [],
    baseBindings.displayHintMap || {},
    "work"
  ));
  workCards.push(..._buildTierCardGroup(
    "jugglingTiers",
    "juggling",
    activeTheme.jugglingTiers || [],
    baseBindings.jugglingTiers || [],
    baseBindings.displayHintMap || {},
    "work"
  ));
  _pushSection(sections, "work", null, workCards);

  const idleMode = activeTheme._capabilities && activeTheme._capabilities.idleMode;
  if (idleMode === "animated") {
    _pushSection(sections, "idle", idleMode, _buildIdleAnimationCards(themeOverrideMap));
  } else {
    const idleCard = _buildStateCard("idle", idleMode === "tracked" ? "idleTracked" : "idleStatic", themeOverrideMap, {
      sectionId: "idle",
    });
    _pushSection(sections, "idle", idleMode, idleCard ? [idleCard] : []);
  }

  const interruptCards = [];
  for (const [stateKey, triggerKind] of [
    ["error", "error"],
    ["attention", "attention"],
    ["notification", "notification"],
    ["sweeping", "sweeping"],
    ["carrying", "carrying"],
  ]) {
    const card = _buildStateCard(stateKey, triggerKind, themeOverrideMap, { sectionId: "interrupts" });
    if (card) interruptCards.push(card);
  }
  _pushSection(sections, "interrupts", null, interruptCards);

  const sleepCards = [];
  const sleepMode = activeTheme._capabilities && activeTheme._capabilities.sleepMode;
  const sleepStates = sleepMode === "direct"
    ? [["sleeping", "sleeping"]]
    : [
      ["yawning", "yawning"],
      ["dozing", "dozing"],
      ["collapsing", "collapsing"],
      ["sleeping", "sleeping"],
    ];
  for (const [stateKey, triggerKind] of sleepStates) {
    const card = _buildStateCard(stateKey, triggerKind, themeOverrideMap, { sectionId: "sleep" });
    if (card) sleepCards.push(card);
  }
  if (_hasOwnStateFiles("waking")) {
    const waking = _buildStateCard("waking", "waking", themeOverrideMap, { sectionId: "sleep" });
    if (waking) sleepCards.push(waking);
  }
  _pushSection(sections, "sleep", sleepMode, sleepCards);

  if (activeTheme.miniMode && activeTheme.miniMode.supported) {
    const miniCards = [];
    for (const stateKey of [
      "mini-idle",
      "mini-enter",
      "mini-enter-sleep",
      "mini-crabwalk",
      "mini-peek",
      "mini-alert",
      "mini-happy",
      "mini-sleep",
    ]) {
      const card = _buildStateCard(stateKey, stateKey, themeOverrideMap, {
        sectionId: "mini",
        bindingPathPrefix: "miniMode.states",
      });
      if (card) miniCards.push(card);
    }
    _pushSection(sections, "mini", null, miniCards);
  }
  return sections;
}

function _buildAnimationOverrideData() {
  if (!activeTheme) return null;
  const meta = themeLoader.getThemeMetadata(activeTheme._id) || {};
  const sections = _buildAnimationOverrideSections();
  return {
    theme: {
      id: activeTheme._id,
      name: meta.name || activeTheme._id,
      variantId: activeTheme._variantId || "default",
      assetsDir: _resolveAnimationAssetsDir(activeTheme),
      capabilities: activeTheme._capabilities || meta.capabilities || null,
    },
    assets: _listAnimationOverrideAssets(activeTheme),
    sections,
    cards: sections.flatMap((section) => section.cards || []),
  };
}

function _previewAnimationOverride(payload) {
  if (!payload || typeof payload !== "object") {
    return { status: "error", message: "previewAnimationOverride payload must be an object" };
  }
  const { stateKey, file, durationMs } = payload;
  if (typeof stateKey !== "string" || !stateKey) {
    return { status: "error", message: "previewAnimationOverride.stateKey must be a non-empty string" };
  }
  if (typeof file !== "string" || !file) {
    return { status: "error", message: "previewAnimationOverride.file must be a non-empty string" };
  }
  if (!_state || typeof _state.applyState !== "function" || typeof _state.resolveDisplayState !== "function") {
    return { status: "error", message: "previewAnimationOverride requires state runtime" };
  }
  if (animationOverridePreviewTimer) {
    clearTimeout(animationOverridePreviewTimer);
    animationOverridePreviewTimer = null;
  }
  try {
    _state.applyState(stateKey, file);
  } catch (err) {
    return { status: "error", message: `previewAnimationOverride: ${err && err.message}` };
  }
  const fallbackMs = (activeTheme && activeTheme.timings && activeTheme.timings.autoReturn && activeTheme.timings.autoReturn[stateKey]) || 1800;
  const holdMs = (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 300)
    ? durationMs
    : fallbackMs;
  animationOverridePreviewTimer = setTimeout(() => {
    animationOverridePreviewTimer = null;
    try {
      const resolved = _state.resolveDisplayState();
      _state.applyState(resolved, _state.getSvgOverride(resolved));
    } catch {}
  }, holdMs);
  return { status: "ok" };
}

// ── IPC: settings panel write entry points ──
// Renderer-side callers (the future settings panel) use these. Menu/main code
// in this process calls _settingsController directly — no IPC round-trip.
ipcMain.handle("settings:get-snapshot", () => buildSettingsSnapshot());
ipcMain.handle("settings:update", (_event, payload) => {
  if (!payload || typeof payload !== "object") {
    return { status: "error", message: "settings:update payload must be { key, value }" };
  }
  return _settingsController.applyUpdate(payload.key, payload.value);
});
ipcMain.handle("settings:command", async (_event, payload) => {
  if (!payload || typeof payload !== "object") {
    return { status: "error", message: "settings:command payload must be { action, payload }" };
  }
  return _settingsController.applyCommand(payload.action, payload.payload);
});
ipcMain.handle("settings:get-animation-overrides-data", () => _buildAnimationOverrideData());
ipcMain.handle("settings:open-theme-assets-dir", async () => {
  const dir = _resolveAnimationAssetsDir(activeTheme);
  if (!dir || !fs.existsSync(dir)) {
    return { status: "error", message: "theme assets directory unavailable" };
  }
  const result = await shell.openPath(dir);
  if (result) return { status: "error", message: result };
  return { status: "ok", path: dir };
});
ipcMain.handle("settings:preview-animation-override", (_event, payload) => _previewAnimationOverride(payload));
ipcMain.handle("settings:open-mac-typing-privacy", async () => {
  if (!isMac) return { status: "error", message: "mac typing privacy settings are only available on macOS" };
  try {
    await shell.openExternal(MAC_TYPING_PRIVACY_URL);
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: err && err.message };
  }
});
ipcMain.handle("settings:run-translator-health-check", () => runTranslatorHealthCheck());
ipcMain.handle("settings:show-translate-bubble-test", (_event, mode) => showTranslateBubbleTest(mode));
ipcMain.handle("settings:run-terminal-action-check", () => runTerminalActionCheck());
ipcMain.handle("settings:run-global-activity-test", (_event, ruleId) => runGlobalActivityTest(ruleId));
ipcMain.handle("settings:get-global-activity-status", () => ({ status: "ok", detail: globalActivityStatus }));
ipcMain.handle("settings:run-time-checkin-now", () => runTimeCheckinNow());
ipcMain.handle("settings:preview-time-checkin-context", () => previewTimeCheckinContext());

// Static metadata for the Agents tab: name, eventSource, capabilities.
// The renderer uses this (alongside the agents snapshot field) to render one
// row per agent. Static because it comes from agents/registry.js — no runtime
// state involved — so the renderer can cache the result and never has to
// re-fetch.
ipcMain.handle("settings:list-themes", () => {
  try {
    const activeId = activeTheme ? activeTheme._id : "clawd";
    return themeLoader.listThemesWithMetadata().map((t) => ({
      ...t,
      active: t.id === activeId,
    }));
  } catch (err) {
    console.warn("Clawd: settings:list-themes failed:", err && err.message);
    return [];
  }
});

// Kept in main so `dialog.showMessageBox` can take a BrowserWindow ref.
const REMOVE_THEME_DIALOG_STRINGS = {
  en: {
    delete: "Delete",
    cancel: "Cancel",
    message: (name) => `Delete theme "${name}"?`,
    detail: "This cannot be undone. All files for this theme will be removed from disk.",
  },
  zh: {
    delete: "删除",
    cancel: "取消",
    message: (name) => `确认删除主题 "${name}"？`,
    detail: "此操作不可撤销。主题的所有文件将从磁盘移除。",
  },
};
ipcMain.handle("settings:confirm-remove-theme", async (event, themeId) => {
  if (typeof themeId !== "string" || !themeId) return { confirmed: false };
  const meta = themeLoader.getThemeMetadata(themeId);
  const displayName = (meta && meta.name) || themeId;
  const parent = BrowserWindow.fromWebContents(event.sender) || settingsWindow || null;
  const s = REMOVE_THEME_DIALOG_STRINGS[lang] || REMOVE_THEME_DIALOG_STRINGS.en;
  try {
    const { response } = await dialog.showMessageBox(parent, {
      type: "warning",
      buttons: [s.delete, s.cancel],
      defaultId: 1,
      cancelId: 1,
      message: s.message(displayName),
      detail: s.detail,
      noLink: true,
    });
    return { confirmed: response === 0 };
  } catch (err) {
    console.warn("Clawd: confirm-remove-theme dialog failed:", err && err.message);
    return { confirmed: false };
  }
});

const CLAUDE_HOOKS_DIALOG_STRINGS = {
  en: {
    disableTitle: "Turn off automatic Claude hook management?",
    disableDetail: "Existing Claude hooks in ~/.claude/settings.json stay in place unless you remove them now.",
    disableOnly: "Disable automatic management only",
    disableAndRemove: "Disable and remove installed hooks",
    cancel: "Cancel",
    disconnectTitle: "Disconnect Claude hooks?",
    disconnectDetail: "This removes Clawd-managed Claude hooks from ~/.claude/settings.json and turns off automatic management. Your Start with Claude preference will be kept for later re-enable.",
    disconnect: "Disconnect hooks",
  },
  zh: {
    disableTitle: "关闭 Claude hooks 自动管理？",
    disableDetail: "如果不选择立即移除，`~/.claude/settings.json` 里当前已安装的 Claude hooks 会继续保留。",
    disableOnly: "只关闭自动管理",
    disableAndRemove: "关闭并移除当前 hooks",
    cancel: "取消",
    disconnectTitle: "断开 Claude hooks？",
    disconnectDetail: "这会从 `~/.claude/settings.json` 移除 Clawd 管理的 Claude hooks，并关闭自动管理。`随 Claude Code 启动` 的偏好会保留，方便以后重新启用。",
    disconnect: "断开 hooks",
  },
};
function _getSettingsDialogParent(event) {
  return BrowserWindow.fromWebContents(event.sender) || settingsWindow || null;
}
ipcMain.handle("settings:confirm-disable-claude-hooks", async (event) => {
  const s = CLAUDE_HOOKS_DIALOG_STRINGS[lang] || CLAUDE_HOOKS_DIALOG_STRINGS.en;
  try {
    const { response } = await dialog.showMessageBox(_getSettingsDialogParent(event), {
      type: "warning",
      buttons: [s.disableAndRemove, s.disableOnly, s.cancel],
      defaultId: 1,
      cancelId: 2,
      message: s.disableTitle,
      detail: s.disableDetail,
      noLink: true,
    });
    if (response === 0) return { choice: "disconnect" };
    if (response === 1) return { choice: "disable" };
    return { choice: "cancel" };
  } catch (err) {
    console.warn("Clawd: confirm-disable-claude-hooks dialog failed:", err && err.message);
    return { choice: "cancel" };
  }
});
ipcMain.handle("settings:confirm-disconnect-claude-hooks", async (event) => {
  const s = CLAUDE_HOOKS_DIALOG_STRINGS[lang] || CLAUDE_HOOKS_DIALOG_STRINGS.en;
  try {
    const { response } = await dialog.showMessageBox(_getSettingsDialogParent(event), {
      type: "warning",
      buttons: [s.disconnect, s.cancel],
      defaultId: 1,
      cancelId: 1,
      message: s.disconnectTitle,
      detail: s.disconnectDetail,
      noLink: true,
    });
    return { confirmed: response === 0 };
  } catch (err) {
    console.warn("Clawd: confirm-disconnect-claude-hooks dialog failed:", err && err.message);
    return { confirmed: false };
  }
});

ipcMain.handle("settings:list-agents", () => {
  try {
    const { getAllAgents } = require("../agents/registry");
    return getAllAgents().map((a) => ({
      id: a.id,
      name: a.name,
      eventSource: a.eventSource,
      capabilities: a.capabilities || {},
    }));
  } catch (err) {
    console.warn("Clawd: settings:list-agents failed:", err && err.message);
    return [];
  }
});

// ── Auto-updater — delegated to src/updater.js ──
const _updaterCtx = {
  get doNotDisturb() { return doNotDisturb; },
  get miniMode() { return _mini.getMiniMode(); },
  get lang() { return lang; },
  t, rebuildAllMenus, updateLog,
  showUpdateBubble: (payload) => showUpdateBubble(payload),
  hideUpdateBubble: () => hideUpdateBubble(),
  setUpdateVisualState: (kind) => _state.setUpdateVisualState(kind),
  applyState: (state, svgOverride) => applyState(state, svgOverride),
  resolveDisplayState: () => resolveDisplayState(),
  getSvgOverride: (state) => getSvgOverride(state),
  resetSoundCooldown: () => resetSoundCooldown(),
};
const _updater = require("./updater")(_updaterCtx);
const { setupAutoUpdater, checkForUpdates, getUpdateMenuItem, getUpdateMenuLabel } = _updater;

// ── Settings panel window ──
//
// Single-instance, non-modal, system-titlebar BrowserWindow that hosts the
// settings UI. Reuses ipcMain.handle("settings:get-snapshot" / "settings:update")
// already wired up for the controller. The renderer subscribes to
// settings-changed broadcasts so menu changes and panel changes stay in sync.
let settingsWindow = null;

function getSettingsWindowIcon() {
  // Don't pass an icon on macOS — the system uses the .app bundle icon.
  if (isMac) return undefined;
  if (isWin) {
    // Packaged build: extraResources puts icon.ico at process.resourcesPath.
    // Dev: read it from assets/. The files[] glob in package.json doesn't
    // include assets/icon.ico, so don't try to load it from __dirname/.. in
    // a packaged build — that path doesn't exist inside app.asar.
    return app.isPackaged
      ? path.join(process.resourcesPath, "icon.ico")
      : path.join(__dirname, "..", "assets", "icon.ico");
  }
  // Linux: build config points at assets/icons/, but those aren't shipped in
  // files[]. Skip the icon — the .desktop file (deb/AppImage) provides one.
  return undefined;
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const iconPath = getSettingsWindowIcon();
  const opts = {
    width: 800,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    show: false,
    frame: true,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    title: "Clawd Settings",
    // Match settings.html's dark-mode palette to avoid a white flash before
    // CSS media query kicks in. Hex values must stay in sync with the
    // `--bg` CSS variable in settings.html for each theme.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1f" : "#f5f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload-settings.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  };
  if (iconPath) opts.icon = iconPath;
  settingsWindow = new BrowserWindow(opts);
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.once("ready-to-show", () => {
    settingsWindow.show();
    settingsWindow.focus();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createWindow() {
  // Read everything from the settings controller. The mirror caches above
  // (lang/showTray/etc.) were already initialized at module-load time, so
  // here we just need the position/mini fields plus the legacy size migration.
  const prefs = _settingsController.getSnapshot();
  // Legacy S/M/L → P:N migration. Only kicks in for prefs files that haven't
  // been touched since v0; new files always store the proportional form.
  if (SIZES[prefs.size]) {
    const wa = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
    const px = SIZES[prefs.size].width;
    const ratio = Math.round(px / wa.width * 100);
    const migrated = `P:${Math.max(1, Math.min(75, ratio))}`;
    _settingsController.applyUpdate("size", migrated); // subscriber updates currentSize mirror
  }
  // macOS: apply dock visibility (default visible — but persisted state wins).
  if (isMac) {
    applyDockVisibility();
  }
  const launchSizingWorkArea = getLaunchSizingWorkArea(
    prefs,
    getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA,
    getNearestWorkArea,
  );
  const size = getCurrentPixelSize(launchSizingWorkArea);

  // Restore saved position, or default to bottom-right of primary display.
  // Prefs file always exists in the new architecture (defaults are hydrated
  // by prefs.load()), so the "no prefs" branch from the legacy code is gone —
  // a fresh install gets x=0, y=0 from defaults, and we treat that as "place
  // bottom-right" via the explicit zero check below.
  let startX, startY;
  if (prefs.miniMode) {
    const miniPos = _mini.restoreFromPrefs(prefs, size);
    startX = miniPos.x;
    startY = miniPos.y;
  } else if (prefs.positionSaved) {
    const clamped = clampToScreen(prefs.x, prefs.y, size.width, size.height);
    startX = clamped.x;
    startY = clamped.y;
  } else {
    const workArea = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
    startX = workArea.x + workArea.width - size.width - 20;
    startY = workArea.y + workArea.height - size.height - 20;
  }

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    ...(isLinux ? { type: LINUX_WINDOW_TYPE } : {}),
    ...(isMac ? { type: "panel", roundedCorners: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      backgroundThrottling: false,
      additionalArguments: [
        "--theme-config=" + JSON.stringify(themeLoader.getRendererConfig()),
      ],
    },
  });

  win.setFocusable(false);

  // Watchdog (Linux only): prevent accidental window close.
  // render-process-gone is handled by the global crash-recovery handler below.
  // On macOS/Windows the WM handles window lifecycle differently.
  if (isLinux) {
    win.on("close", (event) => {
      if (!isQuitting) {
        event.preventDefault();
        if (!win.isVisible()) win.showInactive();
      }
    });
    win.on("unresponsive", () => {
      if (isQuitting) return;
      console.warn("Clawd: renderer unresponsive — reloading");
      win.webContents.reload();
    });
  }

  if (isWin) {
    // Windows: use pop-up-menu level to stay above taskbar/shell UI
    win.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
  }
  win.loadFile(path.join(__dirname, "index.html"));
  win.showInactive();
  // Linux WMs may reset skipTaskbar after showInactive — re-apply explicitly
  if (isLinux) win.setSkipTaskbar(true);
  // macOS: apply after showInactive() — it resets NSWindowCollectionBehavior
  reapplyMacVisibility();

  // macOS: startup-time dock state can be overridden during app/window activation.
  // Re-apply once on next tick so persisted showDock reliably takes effect.
  if (isMac) {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      applyDockVisibility();
    }, 0);
  }

  buildContextMenu();
  if (!isMac || showTray) createTray();
  ensureContextMenuOwner();



  // ── Create input window (hitWin) — small rect over hitbox, receives all pointer events ──
  {
    const initBounds = win.getBounds();
    const initHit = getHitRectScreen(initBounds);
    const hx = Math.round(initHit.left), hy = Math.round(initHit.top);
    const hw = Math.round(initHit.right - initHit.left);
    const hh = Math.round(initHit.bottom - initHit.top);

    hitWin = new BrowserWindow({
      width: hw, height: hh, x: hx, y: hy,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      ...(isLinux ? { type: LINUX_WINDOW_TYPE } : {}),
      ...(isMac ? { type: "panel", roundedCorners: false } : {}),
      focusable: !isLinux,  // KEY EXPERIMENT: allow activation to avoid WS_EX_NOACTIVATE input routing bugs (Windows-only issue)
      webPreferences: {
        preload: path.join(__dirname, "preload-hit.js"),
        backgroundThrottling: false,
        additionalArguments: [
          "--hit-theme-config=" + JSON.stringify(themeLoader.getHitRendererConfig()),
        ],
      },
    });
    // setShape: native hit region, no per-pixel alpha dependency.
    // hitWin has no visual content — clipping is irrelevant.
    hitWin.setShape([{ x: 0, y: 0, width: hw, height: hh }]);
    hitWin.setIgnoreMouseEvents(false);  // PERMANENT — never toggle
    if (isMac) hitWin.setFocusable(false);
    hitWin.showInactive();
    // Linux WMs may reset skipTaskbar after showInactive — re-apply explicitly
    if (isLinux) hitWin.setSkipTaskbar(true);
    if (isWin) {
      hitWin.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);
    }
    // macOS: apply after showInactive() — it resets NSWindowCollectionBehavior
    reapplyMacVisibility();
    hitWin.loadFile(path.join(__dirname, "hit.html"));
    if (isWin) guardAlwaysOnTop(hitWin);

    // Event-level safety net for position sync
    const syncFloatingWindows = () => {
      syncHitWin();
      if (bubbleFollowPet) repositionFloatingBubbles();
      else repositionUpdateBubble();
    };
    win.on("move", syncFloatingWindows);
    win.on("resize", syncFloatingWindows);

    // Send initial state to hitWin once it's ready
    hitWin.webContents.on("did-finish-load", () => {
      sendToHitWin("theme-config", themeLoader.getHitRendererConfig());
      if (themeReloadInProgress) return;
      syncHitStateAfterLoad();
    });

    // Crash recovery for hitWin
    hitWin.webContents.on("render-process-gone", (_event, details) => {
      console.error("hitWin renderer crashed:", details.reason);
      if (!hitWin.isDestroyed()) hitWin.webContents.reload();
    });
  }

  ipcMain.on("show-context-menu", showPetContextMenu);

  ipcMain.on("move-window-by", (event, dx, dy) => {
    if (_mini.getMiniMode() || _mini.getMiniTransitioning()) return;
    const { x, y } = win.getBounds();
    const size = getCurrentPixelSize();
    // During drag: allow free movement across screens, only prevent
    // the pet from going completely off-screen (keep 25% visible).
    const newX = x + dx, newY = y + dy;
    const looseClamped = looseClampToDisplays(newX, newY, size.width, size.height);
    win.setBounds({ ...looseClamped, width: size.width, height: size.height });
    syncHitWin();
    if (bubbleFollowPet) repositionFloatingBubbles();
  });

  ipcMain.on("pause-cursor-polling", () => { idlePaused = true; });
  ipcMain.on("resume-from-reaction", () => {
    idlePaused = false;
    if (_mini.getMiniTransitioning()) return;
    sendToRenderer("state-change", _state.getCurrentState(), _state.getCurrentSvg());
  });

  ipcMain.on("drag-lock", (event, locked) => {
    dragLocked = !!locked;
    if (locked) mouseOverPet = true;
  });

  // Reaction relay: hitWin → main → renderWin
  ipcMain.on("start-drag-reaction", () => sendToRenderer("start-drag-reaction"));
  ipcMain.on("end-drag-reaction", () => sendToRenderer("end-drag-reaction"));
  ipcMain.on("play-click-reaction", (_, svg, duration) => {
    sendToRenderer("play-click-reaction", svg, duration);
  });

  ipcMain.on("drag-end", () => {
    if (!_mini.getMiniMode() && !_mini.getMiniTransitioning()) {
      checkMiniModeSnap();
      // After drag, clamp to the nearest screen (loose clamp during drag allows cross-screen).
      // In proportional mode, also recalculate size for the landing display.
      if (win && !win.isDestroyed()) {
        const size = getCurrentPixelSize();
        const { x, y } = win.getBounds();
        const clamped = clampToScreen(x, y, size.width, size.height);
        win.setBounds({ ...clamped, width: size.width, height: size.height });
        syncHitWin();
        repositionUpdateBubble();
      }
    }
  });

  ipcMain.on("exit-mini-mode", () => {
    if (_mini.getMiniMode()) exitMiniMode();
  });

  ipcMain.on("focus-terminal", () => {
    // Find the best session to focus: prefer highest priority (non-idle), then most recent
    let best = null, bestTime = 0, bestPriority = -1;
    for (const [, s] of sessions) {
      if (!s.sourcePid) continue;
      const pri = STATE_PRIORITY[s.state] || 0;
      if (pri > bestPriority || (pri === bestPriority && s.updatedAt > bestTime)) {
        best = s;
        bestTime = s.updatedAt;
        bestPriority = pri;
      }
    }
    if (best) focusTerminalWindow(best.sourcePid, best.cwd, best.editor, best.pidChain);
    else maybeLaunchAgentOnEmptyFocus();
  });

  ipcMain.on("open-agent-cli", () => {
    tryOpenAgentCli();
  });

  ipcMain.on("show-session-menu", () => {
    popupMenuAt(Menu.buildFromTemplate(buildSessionSubmenu()));
  });

  ipcMain.on("bubble-height", (event, height) => _perm.handleBubbleHeight(event, height));
  ipcMain.on("permission-decide", (event, behavior) => _perm.handleDecide(event, behavior));
  ipcMain.on("update-bubble-height", (event, height) => handleUpdateBubbleHeight(event, height));
  ipcMain.on("update-bubble-action", (event, actionId) => handleUpdateBubbleAction(event, actionId));
  ipcMain.on("time-checkin-bubble-height", (event, height) => _timeCheckinBubble && _timeCheckinBubble.handleHeight(event, height));
  ipcMain.on("time-checkin-bubble-dismiss", (event) => _timeCheckinBubble && _timeCheckinBubble.handleDismiss(event));
  ipcMain.on("translate-height", handleTranslateHeight);
  ipcMain.on("translate-close", handleTranslateClose);

  initFocusHelper();
  startMainTick();
  startHttpServer();
  startStaleCleanup();
  // Wait for renderer to be ready before sending initial state
  // If hooks arrived during startup, respect them instead of forcing idle
  // Also handles crash recovery (render-process-gone → reload)
  win.webContents.on("did-finish-load", () => {
    sendToRenderer("theme-config", themeLoader.getRendererConfig());
    if (themeReloadInProgress) return;
    syncRendererStateAfterLoad();
  });

  // ── Crash recovery: renderer process can die from <object> churn ──
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer crashed:", details.reason);
    dragLocked = false;
    idlePaused = false;
    mouseOverPet = false;
    win.webContents.reload();
  });

  guardAlwaysOnTop(win);
  startTopmostWatchdog();

  // ── Display change: re-clamp window to prevent off-screen ──
  // In proportional mode, also recalculate size based on the new work area.
  screen.on("display-metrics-changed", () => {
    reapplyMacVisibility();
    if (!win || win.isDestroyed()) return;
    if (_mini.getMiniMode()) {
      _mini.handleDisplayChange();
      return;
    }
    const size = getCurrentPixelSize();
    const { x, y } = win.getBounds();
    const clamped = clampToScreen(x, y, size.width, size.height);
    if (isProportionalMode() || clamped.x !== x || clamped.y !== y) {
      win.setBounds({ ...clamped, width: size.width, height: size.height });
      syncHitWin();
      repositionUpdateBubble();
    }
  });
  screen.on("display-removed", () => {
    reapplyMacVisibility();
    if (!win || win.isDestroyed()) return;
    if (_mini.getMiniMode()) {
      exitMiniMode();
      return;
    }
    const size = getCurrentPixelSize();
    const { x, y } = win.getBounds();
    const clamped = clampToScreen(x, y, size.width, size.height);
    win.setBounds({ ...clamped, width: size.width, height: size.height });
    syncHitWin();
    repositionUpdateBubble();
  });
  screen.on("display-added", () => {
    reapplyMacVisibility();
    repositionUpdateBubble();
  });
}

// Read primary display safely — getPrimaryDisplay() can also throw during
// display topology changes, so wrap it. Returns null on failure; the pure
// helpers in work-area.js will fall through to a synthetic last-resort.
function getPrimaryWorkAreaSafe() {
  try {
    const primary = screen.getPrimaryDisplay();
    return (primary && primary.workArea) || null;
  } catch {
    return null;
  }
}

function getNearestWorkArea(cx, cy) {
  return findNearestWorkArea(screen.getAllDisplays(), getPrimaryWorkAreaSafe(), cx, cy);
}

// Loose clamp used during drag: union of all display work areas as the boundary,
// so the pet can freely cross between screens. Only prevents going fully off-screen.
function looseClampToDisplays(x, y, w, h) {
  return computeLooseClamp(screen.getAllDisplays(), getPrimaryWorkAreaSafe(), x, y, w, h);
}

function clampToScreen(x, y, w, h) {
  const nearest = getNearestWorkArea(x + w / 2, y + h / 2);
  const mLeft  = Math.round(w * 0.25);
  const mRight = Math.round(w * 0.25);
  const mTop   = Math.round(h * 0.6);
  const mBot   = Math.round(h * 0.04);
  return {
    x: Math.max(nearest.x - mLeft, Math.min(x, nearest.x + nearest.width - w + mRight)),
    y: Math.max(nearest.y - mTop,  Math.min(y, nearest.y + nearest.height - h + mBot)),
  };
}

// ── Mini Mode — initialized here after state module ──
const _miniCtx = {
  get theme() { return activeTheme; },
  get win() { return win; },
  get currentSize() { return currentSize; },
  get doNotDisturb() { return doNotDisturb; },
  set doNotDisturb(v) { doNotDisturb = v; },
  SIZES,
  getCurrentPixelSize,
  isProportionalMode,
  sendToRenderer,
  sendToHitWin,
  syncHitWin,
  applyState,
  resolveDisplayState,
  getSvgOverride,
  stopWakePoll,
  clampToScreen,
  getNearestWorkArea,
  get bubbleFollowPet() { return bubbleFollowPet; },
  get pendingPermissions() { return pendingPermissions; },
  repositionBubbles: () => repositionFloatingBubbles(),
  buildContextMenu: () => buildContextMenu(),
  buildTrayMenu: () => buildTrayMenu(),
};
const _mini = require("./mini")(_miniCtx);
const { enterMiniMode, exitMiniMode, enterMiniViaMenu, miniPeekIn, miniPeekOut,
        checkMiniModeSnap, cancelMiniTransition, animateWindowX, animateWindowParabola } = _mini;

// Convenience getters for mini state (used throughout main.js)
Object.defineProperties(this || {}, {}); // no-op placeholder
// Mini state is accessed via _mini getters in ctx objects below

// ── Theme switching ──
//
// The `theme` settings effect calls this. MUST throw on failure so the
// controller rejects the commit — otherwise prefs would record a theme id
// that can't actually render. Does NOT write `theme` back to prefs; the
// controller commits after this returns (writing here would infinite-loop).
function activateTheme(themeId, variantId) {
  if (!win || win.isDestroyed()) {
    throw new Error("theme switch requires ready windows");
  }
  // Resolve variantId: explicit arg wins; else current per-theme preference; else default.
  // (Unknown variants lenient-fallback inside loadTheme, so we still commit strict on themeId.)
  const currentVariantMap = _settingsController.get("themeVariant") || {};
  const targetVariant = (typeof variantId === "string" && variantId) ? variantId
    : (currentVariantMap[themeId] || "default");
  const currentOverrides = _settingsController.get("themeOverrides") || {};
  const targetOverrideMap = arguments.length >= 3 ? arguments[2] : (currentOverrides[themeId] || null);
  const targetOverrideSignature = JSON.stringify(targetOverrideMap || {});

  // Joint dedup: same theme + same variant → skip reload. Different variant
  // on same theme MUST run the full reload pipeline (can't hot-patch tiers /
  // displayHint / geometry safely — see plan-settings-panel-3b-swap.md §6.2).
  if (
    activeTheme &&
    activeTheme._id === themeId &&
    activeTheme._variantId === targetVariant &&
    (activeTheme._overrideSignature || "{}") === targetOverrideSignature
  ) {
    return { themeId, variantId: activeTheme._variantId };
  }

  // Strict load first: if it throws, nothing downstream has mutated yet.
  const newTheme = themeLoader.loadTheme(themeId, {
    strict: true,
    variant: targetVariant,
    overrides: targetOverrideMap,
  });
  newTheme._overrideSignature = targetOverrideSignature;
  if (animationOverridePreviewTimer) {
    clearTimeout(animationOverridePreviewTimer);
    animationOverridePreviewTimer = null;
  }

  _state.cleanup();
  _tick.cleanup();
  _mini.cleanup();
  // ⚠️ Don't clear pendingPermissions — bubbles are independent BrowserWindows
  // ⚠️ Don't clear sessions — keep active session tracking
  // ⚠️ Don't clear displayHint — semantic tokens resolve through new theme's map

  if (_mini.getMiniMode() && !newTheme.miniMode.supported) {
    _mini.exitMiniMode();
  }

  activeTheme = newTheme;
  _mini.refreshTheme();
  _state.refreshTheme();
  _tick.refreshTheme();
  if (_mini.getMiniMode()) _mini.handleDisplayChange();

  themeReloadInProgress = true;
  win.webContents.reload();
  hitWin.webContents.reload();

  let ready = 0;
  const onReady = () => {
    if (++ready < 2) return;
    themeReloadInProgress = false;
    syncHitStateAfterLoad();
    syncRendererStateAfterLoad({ includeStartupRecovery: false });
    syncHitWin();
    startMainTick();
  };
  win.webContents.once("did-finish-load", onReady);
  hitWin.webContents.once("did-finish-load", onReady);

  flushRuntimeStateToPrefs();

  // Return resolved ids so the caller (setThemeSelection command) can commit
  // the actually-loaded variantId — handles "author deleted variant" dirty state.
  return { themeId, variantId: newTheme._variantId };
}

// Inject theme deps into the settings controller now that activateTheme,
// themeLoader, and activeTheme are all defined. Uses lazy closures because
// these references are captured at call time (inside an effect or command).
function _deferredActivateTheme(themeId, variantId, overrideMap) {
  return activateTheme(themeId, variantId, overrideMap);
}
function _deferredGetThemeInfo(themeId) {
  const all = themeLoader.discoverThemes();
  const entry = all.find((t) => t.id === themeId);
  if (!entry) return null;
  return {
    builtin: !!entry.builtin,
    active: activeTheme && activeTheme._id === themeId,
  };
}
function _deferredRemoveThemeDir(themeId) {
  const userThemesDir = themeLoader.ensureUserThemesDir();
  if (!userThemesDir) throw new Error("user themes directory unavailable");
  // Re-verify path containment as a defensive check — settings-actions
  // already rejects built-in / active themes, and ensureUserThemesDir only
  // ever returns the userData subtree, but belt + suspenders on an fs.rm
  // call is worth the two lines.
  const target = path.resolve(path.join(userThemesDir, themeId));
  const root = path.resolve(userThemesDir);
  if (!target.startsWith(root + path.sep)) {
    throw new Error(`theme path escapes user themes directory: ${themeId}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  // Rebuild menus so Theme submenu reflects the deleted entry.
  try { rebuildAllMenus(); } catch { /* best-effort */ }
}

// ── Auto-install VS Code / Cursor terminal-focus extension ──
const EXT_ID = "clawd.clawd-terminal-focus";
const EXT_VERSION = "0.1.0";
const EXT_DIR_NAME = `${EXT_ID}-${EXT_VERSION}`;

function installTerminalFocusExtension() {
  const os = require("os");
  const home = os.homedir();

  // Extension source — in dev: ../extensions/vscode/, in packaged: app.asar.unpacked/
  let extSrc = path.join(__dirname, "..", "extensions", "vscode");
  extSrc = extSrc.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);

  if (!fs.existsSync(extSrc)) {
    console.log("Clawd: terminal-focus extension source not found, skipping auto-install");
    return;
  }

  const targets = [
    path.join(home, ".vscode", "extensions"),
    path.join(home, ".cursor", "extensions"),
  ];

  const filesToCopy = ["package.json", "extension.js"];
  let installed = 0;

  for (const extRoot of targets) {
    if (!fs.existsSync(extRoot)) continue; // editor not installed
    const dest = path.join(extRoot, EXT_DIR_NAME);
    // Skip if already installed (check package.json exists)
    if (fs.existsSync(path.join(dest, "package.json"))) continue;
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const file of filesToCopy) {
        fs.copyFileSync(path.join(extSrc, file), path.join(dest, file));
      }
      installed++;
      console.log(`Clawd: installed terminal-focus extension to ${dest}`);
    } catch (err) {
      console.warn(`Clawd: failed to install extension to ${dest}:`, err.message);
    }
  }
  if (installed > 0) {
    console.log(`Clawd: terminal-focus extension installed to ${installed} editor(s). Restart VS Code/Cursor to activate.`);
  }
}

// ── Single instance lock ──
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Another instance is already running — quit silently
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      win.showInactive();
      if (isLinux) win.setSkipTaskbar(true);
    }
    if (hitWin && !hitWin.isDestroyed()) {
      hitWin.showInactive();
      if (isLinux) hitWin.setSkipTaskbar(true);
    }
    reapplyMacVisibility();
  });

  // macOS: hide dock icon early if user previously disabled it
  if (isMac && app.dock) {
    if (_settingsController.get("showDock") === false) {
      app.dock.hide();
    }
  }

  app.whenReady().then(() => {
    // Import system-backed settings (openAtLogin) into prefs on first run.
    // Must run before createWindow() so the first menu draw sees the
    // hydrated value rather than the schema default.
    hydrateSystemBackedSettings();

    permDebugLog = path.join(app.getPath("userData"), "permission-debug.log");
    updateDebugLog = path.join(app.getPath("userData"), "update-debug.log");
    sessionDebugLog = path.join(app.getPath("userData"), "session-debug.log");
    createWindow();
    syncMacTypingMonitorFromPrefs();
    syncGlobalActivityFromPrefs();
    syncTimeCheckinFromPrefs();
    void maybePromptMacTypingPermission();

    // Register global shortcut for toggling pet visibility
    registerToggleShortcut();

    // Register Ctrl+Shift+T for quick translate
    try {
      const TRANSLATE_SHORTCUT = "CommandOrControl+Shift+T";
      const ok = globalShortcut.register(TRANSLATE_SHORTCUT, triggerTranslate);
      if (!ok) console.warn("Clawd: failed to register translate shortcut:", TRANSLATE_SHORTCUT);
    } catch (err) {
      console.warn("Clawd: failed to register translate shortcut:", err.message);
    }

    // Construct log monitors. We always instantiate them so toggling the
    // agent on/off later can call start()/stop() without paying the require
    // cost at click time. Whether we call .start() right now depends on the
    // agent-gate snapshot — a user who disabled Codex at last shutdown
    // shouldn't see its file watcher spin up on the next launch.
    try {
      const CodexLogMonitor = require("../agents/codex-log-monitor");
      const codexAgent = require("../agents/codex");
      _codexMonitor = new CodexLogMonitor(codexAgent, (sid, state, event, extra) => {
        if (state === "codex-permission") {
          updateSession(sid, "notification", event, null, extra.cwd, null, null, null, "codex");
          showCodexNotifyBubble({
            sessionId: sid,
            command: extra.permissionDetail?.command || "",
          });
          return;
        }
        clearCodexNotifyBubbles(sid);
        updateSession(sid, state, event, null, extra.cwd, null, null, null, "codex");
      });
      if (_isAgentEnabled(_settingsController.getSnapshot(), "codex")) {
        _codexMonitor.start();
      }
    } catch (err) {
      console.warn("Clawd: Codex log monitor not started:", err.message);
    }

    try {
      const GeminiLogMonitor = require("../agents/gemini-log-monitor");
      const geminiAgent = require("../agents/gemini-cli");
      _geminiMonitor = new GeminiLogMonitor(geminiAgent, (sid, state, event, extra) => {
        updateSession(sid, state, event, null, extra.cwd, null, null, null, "gemini-cli");
      });
      if (_isAgentEnabled(_settingsController.getSnapshot(), "gemini-cli")) {
        _geminiMonitor.start();
      }
    } catch (err) {
      console.warn("Clawd: Gemini log monitor not started:", err.message);
    }

    // Auto-install VS Code/Cursor terminal-focus extension
    try { installTerminalFocusExtension(); } catch (err) {
      console.warn("Clawd: failed to auto-install terminal-focus extension:", err.message);
    }

    // Auto-updater: setup event handlers (user triggers check via tray menu)
    setupAutoUpdater();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    flushRuntimeStateToPrefs();
    unregisterToggleShortcut();
    globalShortcut.unregisterAll();
    _perm.cleanup();
    _server.cleanup();
    _updateBubble.cleanup();
    if (_timeCheckinBubble) _timeCheckinBubble.cleanup();
    _state.cleanup();
    _tick.cleanup();
    _mini.cleanup();
    _macInputMonitor.stop();
    stopGlobalActivityCollectors();
    if (_globalRulesEngine) _globalRulesEngine.stop();
    if (_codexMonitor) _codexMonitor.stop();
    if (_geminiMonitor) _geminiMonitor.stop();
    stopTopmostWatchdog();
    if (hwndRecoveryTimer) { clearTimeout(hwndRecoveryTimer); hwndRecoveryTimer = null; }
    _focus.cleanup();
    cleanupTranslateBubble();
    if (hitWin && !hitWin.isDestroyed()) hitWin.destroy();
  });

  app.on("window-all-closed", () => {
    if (!isQuitting) return;
    app.quit();
  });
}
