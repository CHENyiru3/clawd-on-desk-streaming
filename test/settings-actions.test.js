"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  updateRegistry,
  commandRegistry,
  requireBoolean,
  requireFiniteNumber,
  requireEnum,
} = require("../src/settings-actions");
const prefs = require("../src/prefs");

describe("validator helpers", () => {
  it("requireBoolean accepts only booleans", () => {
    const v = requireBoolean("foo");
    assert.strictEqual(v(true).status, "ok");
    assert.strictEqual(v(false).status, "ok");
    assert.strictEqual(v("true").status, "error");
    assert.strictEqual(v(1).status, "error");
    assert.strictEqual(v(null).status, "error");
  });

  it("requireFiniteNumber rejects NaN/Infinity", () => {
    const v = requireFiniteNumber("x");
    assert.strictEqual(v(0).status, "ok");
    assert.strictEqual(v(-1).status, "ok");
    assert.strictEqual(v(NaN).status, "error");
    assert.strictEqual(v(Infinity).status, "error");
    assert.strictEqual(v("0").status, "error");
  });

  it("requireEnum rejects values outside the allowlist", () => {
    const v = requireEnum("k", ["a", "b"]);
    assert.strictEqual(v("a").status, "ok");
    assert.strictEqual(v("c").status, "error");
  });
});

describe("updateRegistry pure-data validators", () => {
  const baseSnapshot = prefs.getDefaults();

  it("lang validates against the enum", () => {
    assert.strictEqual(updateRegistry.lang("en", { snapshot: baseSnapshot }).status, "ok");
    assert.strictEqual(updateRegistry.lang("zh", { snapshot: baseSnapshot }).status, "ok");
    assert.strictEqual(updateRegistry.lang("zh", { snapshot: baseSnapshot }).status, "ok");
    assert.strictEqual(updateRegistry.lang("klingon", { snapshot: baseSnapshot }).status, "error");
  });

  it("size accepts S/M/L and P:<num>", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.size("S", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("M", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("L", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("P:10", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("P:12.5", deps).status, "ok");
    assert.strictEqual(updateRegistry.size("XL", deps).status, "error");
    assert.strictEqual(updateRegistry.size("P:abc", deps).status, "error");
  });

  it("miniEdge accepts only left/right", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.miniEdge("left", deps).status, "ok");
    assert.strictEqual(updateRegistry.miniEdge("right", deps).status, "ok");
    assert.strictEqual(updateRegistry.miniEdge("top", deps).status, "error");
  });

  it("x/y/preMiniX/preMiniY require finite numbers", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.x(0, deps).status, "ok");
    assert.strictEqual(updateRegistry.y(-100, deps).status, "ok");
    assert.strictEqual(updateRegistry.preMiniX(NaN, deps).status, "error");
    assert.strictEqual(updateRegistry.preMiniY(Infinity, deps).status, "error");
  });

  it("function-form boolean fields reject non-booleans", () => {
    const deps = { snapshot: baseSnapshot };
    for (const key of [
      "soundMuted", "bubbleFollowPet", "hideBubbles",
      "showSessionId", "miniMode", "openAtLoginHydrated",
      "macTypingAwarenessEnabled", "macTypingPermissionPrompted", "macTypingPermissionDismissed",
      "globalActivityEnabled", "globalActivityOnboardingShown", "remoteSshAutoBridgeEnabled",
    ]) {
      assert.strictEqual(updateRegistry[key](true, deps).status, "ok", `${key}(true)`);
      assert.strictEqual(updateRegistry[key](false, deps).status, "ok", `${key}(false)`);
      assert.strictEqual(updateRegistry[key]("yes", deps).status, "error", `${key}("yes")`);
    }
  });

  it("translateProvider and translateApiKey validate correctly", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.translateProvider("minimax", deps).status, "ok");
    assert.strictEqual(updateRegistry.translateProvider("googletrans", deps).status, "error");
    assert.strictEqual(updateRegistry.translateApiKey("", deps).status, "ok");
    assert.strictEqual(updateRegistry.translateApiKey("secret", deps).status, "ok");
    assert.strictEqual(updateRegistry.translateApiKey(123, deps).status, "error");
  });

  it("globalActivityRules requires a complete boolean map", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.globalActivityRules({
      clipboardReaction: true,
      notificationReaction: true,
      presenceWake: true,
      mediaPlaybackReaction: true,
      browserReadingReaction: true,
    }, deps).status, "ok");
    assert.strictEqual(updateRegistry.globalActivityRules({ clipboardReaction: true }, deps).status, "error");
    assert.strictEqual(updateRegistry.globalActivityRules("nope", deps).status, "error");
  });

  it("remoteSshTrustedHosts validates entries", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.remoteSshTrustedHosts({
      "user@host": { enabled: true },
    }, deps).status, "ok");
    assert.strictEqual(updateRegistry.remoteSshTrustedHosts({
      "user@host": { enabled: "yes" },
    }, deps).status, "error");
    assert.strictEqual(updateRegistry.remoteSshTrustedHosts("nope", deps).status, "error");
  });

  it("time check-in fields validate correctly", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.timeCheckinEnabled(true, deps).status, "ok");
    assert.strictEqual(updateRegistry.timeCheckinScheduleMode("twoHourWithAnchors", deps).status, "ok");
    assert.strictEqual(updateRegistry.timeCheckinPreviewClipboardWindowMinutes(60, deps).status, "ok");
    assert.strictEqual(updateRegistry.timeCheckinLastRunAt(null, deps).status, "ok");
    assert.strictEqual(updateRegistry.timeCheckinGenerator({
      cwd: "/Users/eric_yiru/Desktop/Home",
      command: "hermes",
      args: ["--resume", "abc"],
      timeoutMs: 120000,
    }, deps).status, "ok");
    assert.strictEqual(updateRegistry.timeCheckinGenerator({
      cwd: "/Users/eric_yiru/Desktop/Home",
      command: "",
      args: ["--resume"],
      timeoutMs: 30000,
    }, deps).status, "error");
    // Time check-in max is 120000 ms
    assert.strictEqual(updateRegistry.timeCheckinGenerator({
      cwd: "/Users/eric_yiru/Desktop/Home",
      command: "hermes",
      args: ["--resume", "abc"],
      timeoutMs: 120001,
    }, deps).status, "error");
    assert.strictEqual(updateRegistry.timeCheckinGenerator({
      cwd: "/Users/eric_yiru/Desktop/Home",
      command: "hermes",
      args: ["--resume", "abc"],
      timeoutMs: 120000,
    }, deps).status, "ok");
  });

  it("hermesChat validator accepts a valid config", () => {
    const deps = { snapshot: baseSnapshot };
    const valid = {
      command: "hermes",
      args: ["chat", "-q"],
      cwd: "/Users/eric_yiru/Desktop",
      timeoutMs: 180000,
    };
    assert.strictEqual(updateRegistry.hermesChat(valid, deps).status, "ok");
  });

  it("hermesChat validator rejects malformed command", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.hermesChat({ command: "", args: [], cwd: "", timeoutMs: 10000 }, deps).status, "error");
    assert.strictEqual(updateRegistry.hermesChat({ command: "  ", args: [], cwd: "", timeoutMs: 10000 }, deps).status, "error");
    assert.strictEqual(updateRegistry.hermesChat({ command: null, args: [], cwd: "", timeoutMs: 10000 }, deps).status, "error");
  });

  it("hermesChat validator rejects malformed args", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.hermesChat({ command: "hermes", args: "not-an-array", cwd: "", timeoutMs: 10000 }, deps).status, "error");
    assert.strictEqual(updateRegistry.hermesChat({ command: "hermes", args: [42], cwd: "", timeoutMs: 10000 }, deps).status, "error");
  });

  it("hermesChat validator rejects malformed cwd", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.hermesChat({ command: "hermes", args: [], cwd: 123, timeoutMs: 10000 }, deps).status, "error");
  });

  it("hermesChat validator rejects out-of-bounds timeout", () => {
    const deps = { snapshot: baseSnapshot };
    const base = { command: "hermes", args: [], cwd: "" };
    assert.strictEqual(updateRegistry.hermesChat({ ...base, timeoutMs: 9999 }, deps).status, "error");
    assert.strictEqual(updateRegistry.hermesChat({ ...base, timeoutMs: 10000 }, deps).status, "ok");
    assert.strictEqual(updateRegistry.hermesChat({ ...base, timeoutMs: 600000 }, deps).status, "ok");
    assert.strictEqual(updateRegistry.hermesChat({ ...base, timeoutMs: 600001 }, deps).status, "error");
    assert.strictEqual(updateRegistry.hermesChat({ ...base, timeoutMs: NaN }, deps).status, "error");
  });

  it("object-form boolean fields validate via entry.validate", () => {
    const deps = { snapshot: baseSnapshot };
    for (const key of ["autoStartWithClaude", "manageClaudeHooksAutomatically", "openAtLogin"]) {
      const entry = updateRegistry[key];
      assert.strictEqual(typeof entry, "object", `${key} should be object-form`);
      assert.strictEqual(typeof entry.validate, "function", `${key} should expose validate`);
      assert.strictEqual(typeof entry.effect, "function", `${key} should expose effect`);
      assert.strictEqual(entry.validate(true, deps).status, "ok", `${key} validate(true)`);
      assert.strictEqual(entry.validate(false, deps).status, "ok", `${key} validate(false)`);
      assert.strictEqual(entry.validate("yes", deps).status, "error", `${key} validate("yes")`);
    }
  });

  it("theme validator requires a non-empty string", () => {
    // theme is now an object-form entry ({ validate, effect }); access
    // the validator directly — the effect needs an activateTheme dep
    // and is covered separately.
    const entry = updateRegistry.theme;
    assert.strictEqual(typeof entry, "object");
    assert.strictEqual(typeof entry.validate, "function");
    assert.strictEqual(typeof entry.effect, "function");
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(entry.validate("clawd", deps).status, "ok");
    assert.strictEqual(entry.validate("", deps).status, "error");
    assert.strictEqual(entry.validate(null, deps).status, "error");
  });

  it("theme effect proxies to deps.activateTheme and maps throws to error", () => {
    const entry = updateRegistry.theme;
    const calls = [];
    const overrideMap = {
      tiers: {
        workingTiers: {
          "clawd-working-typing.svg": { file: "clawd-working-typing-old.svg" },
        },
      },
    };
    const deps = {
      snapshot: { ...baseSnapshot, themeOverrides: { clawd: overrideMap } },
      activateTheme: (id, variantId, targetOverrideMap) => {
        calls.push({ id, variantId, targetOverrideMap });
        if (id === "bad") throw new Error("boom");
      },
    };
    assert.deepStrictEqual(entry.effect("clawd", deps), { status: "ok" });
    assert.deepStrictEqual(calls, [{
      id: "clawd",
      variantId: null,
      targetOverrideMap: overrideMap,
    }]);

    const err = entry.effect("bad", deps);
    assert.strictEqual(err.status, "error");
    assert.match(err.message, /boom/);
  });

  it("theme effect errors when activateTheme dep missing", () => {
    const entry = updateRegistry.theme;
    const result = entry.effect("clawd", { snapshot: baseSnapshot });
    assert.strictEqual(result.status, "error");
    assert.match(result.message, /activateTheme/);
  });

  it("themeVariant requires a plain object (no effect runs)", () => {
    // Plan §6.2: themeVariant must have validator but NO effect — to avoid
    // double-activating theme alongside `theme` field effect.
    const deps = { snapshot: prefs.getDefaults() };
    assert.strictEqual(updateRegistry.themeVariant({}, deps).status, "ok");
    assert.strictEqual(updateRegistry.themeVariant({ clawd: "chill" }, deps).status, "ok");
    assert.strictEqual(updateRegistry.themeVariant("nope", deps).status, "error");
    assert.strictEqual(updateRegistry.themeVariant(null, deps).status, "error");
    assert.strictEqual(updateRegistry.themeVariant([1, 2], deps).status, "error");
    // Object-form entries have `.validate` + `.effect`; pure-data entries are
    // bare functions. themeVariant MUST be the bare-function form.
    assert.strictEqual(typeof updateRegistry.themeVariant, "function");
  });

  it("agents/themeOverrides require plain objects", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.agents({}, deps).status, "ok");
    assert.strictEqual(updateRegistry.agents([], deps).status, "error");
    assert.strictEqual(updateRegistry.themeOverrides({}, deps).status, "ok");
    assert.strictEqual(updateRegistry.themeOverrides("nope", deps).status, "error");
  });

  it("provider usage checker allows five-minute MiniMax checks", () => {
    const deps = { snapshot: baseSnapshot };
    assert.strictEqual(updateRegistry.providerUsageChecker({
      python: "python3",
      scriptPath: "/tmp/check_usage.py",
      timeoutMs: 300000,
      browser: "auto",
    }, deps).status, "ok");
    assert.strictEqual(updateRegistry.providerUsageChecker({
      python: "python3",
      scriptPath: "/tmp/check_usage.py",
      timeoutMs: 300001,
      browser: "auto",
    }, deps).status, "error");
  });
});

describe("object-form effects (autoStartWithClaude / manageClaudeHooksAutomatically / openAtLogin)", () => {
  it("autoStartWithClaude effect calls installAutoStart on true", () => {
    let installCalls = 0;
    let uninstallCalls = 0;
    const deps = {
      installAutoStart: () => installCalls++,
      uninstallAutoStart: () => uninstallCalls++,
    };
    const r = updateRegistry.autoStartWithClaude.effect(true, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(installCalls, 1);
    assert.strictEqual(uninstallCalls, 0);
  });

  it("autoStartWithClaude effect calls uninstallAutoStart on false", () => {
    let installCalls = 0;
    let uninstallCalls = 0;
    const deps = {
      installAutoStart: () => installCalls++,
      uninstallAutoStart: () => uninstallCalls++,
    };
    const r = updateRegistry.autoStartWithClaude.effect(false, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(installCalls, 0);
    assert.strictEqual(uninstallCalls, 1);
  });

  it("autoStartWithClaude effect returns error when deps missing", () => {
    const r = updateRegistry.autoStartWithClaude.effect(true, {});
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /requires installAutoStart\/uninstallAutoStart/);
  });

  it("autoStartWithClaude effect catches install throws", () => {
    const deps = {
      installAutoStart: () => { throw new Error("file locked"); },
      uninstallAutoStart: () => {},
    };
    const r = updateRegistry.autoStartWithClaude.effect(true, deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /file locked/);
  });

  it("autoStartWithClaude effect noops when Claude hook management is disabled", () => {
    let installCalls = 0;
    let uninstallCalls = 0;
    const deps = {
      snapshot: { ...prefs.getDefaults(), manageClaudeHooksAutomatically: false },
      installAutoStart: () => installCalls++,
      uninstallAutoStart: () => uninstallCalls++,
    };
    const r = updateRegistry.autoStartWithClaude.effect(true, deps);
    assert.deepStrictEqual(r, { status: "ok", noop: true });
    assert.strictEqual(installCalls, 0);
    assert.strictEqual(uninstallCalls, 0);
  });

  it("manageClaudeHooksAutomatically effect syncs hooks and starts watcher on true", () => {
    let syncCalls = 0;
    let startCalls = 0;
    let stopCalls = 0;
    const deps = {
      syncClaudeHooksNow: () => syncCalls++,
      startClaudeSettingsWatcher: () => startCalls++,
      stopClaudeSettingsWatcher: () => stopCalls++,
    };
    const r = updateRegistry.manageClaudeHooksAutomatically.effect(true, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(syncCalls, 1);
    assert.strictEqual(startCalls, 1);
    assert.strictEqual(stopCalls, 0);
  });

  it("manageClaudeHooksAutomatically effect stops watcher on false", () => {
    let syncCalls = 0;
    let startCalls = 0;
    let stopCalls = 0;
    const deps = {
      syncClaudeHooksNow: () => syncCalls++,
      startClaudeSettingsWatcher: () => startCalls++,
      stopClaudeSettingsWatcher: () => stopCalls++,
    };
    const r = updateRegistry.manageClaudeHooksAutomatically.effect(false, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(syncCalls, 0);
    assert.strictEqual(startCalls, 0);
    assert.strictEqual(stopCalls, 1);
  });

  it("manageClaudeHooksAutomatically effect returns error when deps missing", () => {
    const r = updateRegistry.manageClaudeHooksAutomatically.effect(true, {});
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /syncClaudeHooksNow/);
  });

  it("openAtLogin effect calls setOpenAtLogin with the value", () => {
    let lastValue = null;
    const deps = { setOpenAtLogin: (v) => { lastValue = v; } };
    const r1 = updateRegistry.openAtLogin.effect(true, deps);
    assert.strictEqual(r1.status, "ok");
    assert.strictEqual(lastValue, true);
    const r2 = updateRegistry.openAtLogin.effect(false, deps);
    assert.strictEqual(r2.status, "ok");
    assert.strictEqual(lastValue, false);
  });

  it("openAtLogin effect returns error when deps missing", () => {
    const r = updateRegistry.openAtLogin.effect(true, {});
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /requires setOpenAtLogin/);
  });

  it("openAtLogin effect catches setter throws", () => {
    const deps = { setOpenAtLogin: () => { throw new Error("permission denied"); } };
    const r = updateRegistry.openAtLogin.effect(true, deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /permission denied/);
  });
});

describe("hook commands", () => {
  it("installHooks triggers a one-shot Claude sync without changing prefs", async () => {
    let syncCalls = 0;
    const r = await commandRegistry.installHooks(null, {
      snapshot: prefs.getDefaults(),
      syncClaudeHooksNow: () => syncCalls++,
    });
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(syncCalls, 1);
    assert.strictEqual(r.commit, undefined);
  });

  it("uninstallHooks stops watcher, uninstalls hooks, and commits only manageClaudeHooksAutomatically=false", async () => {
    const calls = [];
    const r = await commandRegistry.uninstallHooks(null, {
      snapshot: { ...prefs.getDefaults(), manageClaudeHooksAutomatically: true, autoStartWithClaude: true },
      stopClaudeSettingsWatcher: () => calls.push("stop"),
      uninstallClaudeHooksNow: () => calls.push("uninstall"),
      startClaudeSettingsWatcher: () => calls.push("start"),
    });
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(calls, ["stop", "uninstall"]);
    assert.deepStrictEqual(r.commit, { manageClaudeHooksAutomatically: false });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r.commit, "autoStartWithClaude"), false);
  });

  it("uninstallHooks restores watcher on uninstall failure when management was enabled", async () => {
    const calls = [];
    const r = await commandRegistry.uninstallHooks(null, {
      snapshot: { ...prefs.getDefaults(), manageClaudeHooksAutomatically: true },
      stopClaudeSettingsWatcher: () => calls.push("stop"),
      uninstallClaudeHooksNow: () => {
        calls.push("uninstall");
        throw new Error("disk locked");
      },
      startClaudeSettingsWatcher: () => calls.push("start"),
    });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /disk locked/);
    assert.deepStrictEqual(calls, ["stop", "uninstall", "start"]);
  });
});

describe("remote SSH host commands", () => {
  it("retries a host and queues remote bridge setup", () => {
    const r = commandRegistry.updateRemoteSshHost(
      { target: "user@host", action: "retry" },
      { snapshot: { remoteSshTrustedHosts: {} } }
    );
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(r.commit.remoteSshTrustedHosts["user@host"].lastStatus, "queued");
  });

  it("can disable and forget a host", () => {
    const snapshot = {
      remoteSshTrustedHosts: {
        "user@host": { target: "user@host", enabled: true, lastStatus: "ok" },
      },
    };
    const disabled = commandRegistry.updateRemoteSshHost(
      { target: "user@host", action: "disable" },
      { snapshot }
    );
    assert.strictEqual(disabled.status, "ok");
    assert.strictEqual(disabled.commit.remoteSshTrustedHosts["user@host"].enabled, false);

    const forgotten = commandRegistry.updateRemoteSshHost(
      { target: "user@host", action: "forget" },
      { snapshot }
    );
    assert.strictEqual(forgotten.status, "ok");
    assert.strictEqual(forgotten.commit.remoteSshTrustedHosts["user@host"], undefined);
  });
});

describe("updateRegistry cross-field validators (showTray/showDock)", () => {
  it("rejects disabling tray when dock is already off", () => {
    const snap = { ...prefs.getDefaults(), showTray: true, showDock: false };
    const r = updateRegistry.showTray(false, { snapshot: snap });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /unquittable/);
  });

  it("rejects disabling dock when tray is already off", () => {
    const snap = { ...prefs.getDefaults(), showTray: false, showDock: true };
    const r = updateRegistry.showDock(false, { snapshot: snap });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /unquittable/);
  });

  it("allows disabling tray when dock is on", () => {
    const snap = { ...prefs.getDefaults(), showTray: true, showDock: true };
    assert.strictEqual(updateRegistry.showTray(false, { snapshot: snap }).status, "ok");
  });

  it("allows enabling either at any time", () => {
    const snap = { ...prefs.getDefaults(), showTray: false, showDock: false };
    assert.strictEqual(updateRegistry.showTray(true, { snapshot: snap }).status, "ok");
    assert.strictEqual(updateRegistry.showDock(true, { snapshot: snap }).status, "ok");
  });
});

describe("removeTheme command", () => {
  const baseSnapshot = { ...prefs.getDefaults(), themeOverrides: {} };

  function makeDeps(overrides = {}) {
    const calls = { removeThemeDir: [], getThemeInfo: [] };
    const deps = {
      snapshot: baseSnapshot,
      getThemeInfo: (id) => {
        calls.getThemeInfo.push(id);
        if (id === "cat") return { builtin: false, active: false };
        if (id === "clawd") return { builtin: true, active: true };
        if (id === "activeUser") return { builtin: false, active: true };
        if (id === "missing") return null;
        return { builtin: false, active: false };
      },
      removeThemeDir: async (id) => {
        calls.removeThemeDir.push(id);
      },
      ...overrides,
    };
    return { deps, calls };
  }

  it("rejects non-string payloads", async () => {
    const { deps } = makeDeps();
    const r = await commandRegistry.removeTheme(null, deps);
    assert.strictEqual(r.status, "error");
  });

  it("rejects built-in themes", async () => {
    const { deps, calls } = makeDeps();
    const r = await commandRegistry.removeTheme("clawd", deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /built-in/);
    assert.deepStrictEqual(calls.removeThemeDir, []);
  });

  it("rejects the active theme", async () => {
    const { deps, calls } = makeDeps();
    const r = await commandRegistry.removeTheme("activeUser", deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /active/);
    assert.deepStrictEqual(calls.removeThemeDir, []);
  });

  it("rejects unknown themes", async () => {
    const { deps, calls } = makeDeps();
    const r = await commandRegistry.removeTheme("missing", deps);
    assert.strictEqual(r.status, "error");
    assert.deepStrictEqual(calls.removeThemeDir, []);
  });

  it("deletes the dir for a valid user theme", async () => {
    const { deps, calls } = makeDeps();
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(calls.removeThemeDir, ["cat"]);
    // No overrides to clean up → no commit field
    assert.strictEqual(r.commit, undefined);
  });

  it("strips themeOverrides entry on success when one exists", async () => {
    const snapshotWithOverride = {
      ...baseSnapshot,
      themeOverrides: { cat: { attention: { sourceThemeId: "cat", file: "x.svg" } } },
    };
    const { deps } = makeDeps({ snapshot: snapshotWithOverride });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.ok(r.commit, "commit field expected");
    assert.deepStrictEqual(r.commit.themeOverrides, {});
  });

  // Phase 3b-swap: removeTheme also strips themeVariant entry
  it("strips themeVariant entry on success when one exists", async () => {
    const snapshotWithVariant = {
      ...baseSnapshot,
      themeVariant: { cat: "chill", clawd: "default" },
    };
    const { deps } = makeDeps({ snapshot: snapshotWithVariant });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.ok(r.commit, "commit field expected");
    assert.deepStrictEqual(r.commit.themeVariant, { clawd: "default" });
    assert.strictEqual(r.commit.themeOverrides, undefined);  // wasn't set
  });

  it("strips both themeOverrides and themeVariant when both present", async () => {
    const snapshotWithBoth = {
      ...baseSnapshot,
      themeOverrides: { cat: { attention: { sourceThemeId: "cat", file: "x.svg" } } },
      themeVariant: { cat: "chill" },
    };
    const { deps } = makeDeps({ snapshot: snapshotWithBoth });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeOverrides, {});
    assert.deepStrictEqual(r.commit.themeVariant, {});
  });

  it("surfaces removeThemeDir throws as error status", async () => {
    const { deps } = makeDeps({
      removeThemeDir: async () => { throw new Error("EBUSY"); },
    });
    const r = await commandRegistry.removeTheme("cat", deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /EBUSY/);
  });

  it("errors when required deps missing", async () => {
    const r = await commandRegistry.removeTheme("cat", { snapshot: baseSnapshot });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /getThemeInfo/);
  });
});

// Phase 3b-swap: atomic theme+variant switch via a single command.
describe("setThemeSelection command", () => {
  const baseSnapshot = { ...prefs.getDefaults(), themeVariant: {} };

  function makeDeps(overrides = {}) {
    const calls = { activateTheme: [] };
    const deps = {
      snapshot: baseSnapshot,
      activateTheme: (themeId, variantId, overrideMap) => {
        calls.activateTheme.push({ themeId, variantId, overrideMap });
        // Simulate lenient variant fallback: "dead" variant → resolves to default
        const resolved = variantId === "dead" ? "default" : variantId;
        return { themeId, variantId: resolved };
      },
      ...overrides,
    };
    return { deps, calls };
  }

  it("rejects missing themeId", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setThemeSelection({}, deps);
    assert.strictEqual(r.status, "error");
  });

  it("rejects non-string variantId when provided", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setThemeSelection({ themeId: "clawd", variantId: 42 }, deps);
    assert.strictEqual(r.status, "error");
  });

  it("accepts string payload as themeId shorthand", () => {
    const { deps, calls } = makeDeps();
    const r = commandRegistry.setThemeSelection("clawd", deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(calls.activateTheme.length, 1);
    assert.strictEqual(calls.activateTheme[0].themeId, "clawd");
    assert.strictEqual(calls.activateTheme[0].variantId, "default");
    assert.strictEqual(calls.activateTheme[0].overrideMap, null);
  });

  it("uses snapshot.themeVariant when variantId not provided", () => {
    const snapshotWithVariant = { ...baseSnapshot, themeVariant: { clawd: "chill" } };
    const { deps, calls } = makeDeps({ snapshot: snapshotWithVariant });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(calls.activateTheme[0].variantId, "chill");
  });

  it("passes the target theme override map into activateTheme", () => {
    const overrideMap = {
      tiers: {
        workingTiers: {
          "clawd-working-typing.svg": { file: "clawd-working-typing-old.svg" },
        },
      },
    };
    const snapshotWithOverride = {
      ...baseSnapshot,
      themeOverrides: { clawd: overrideMap },
    };
    const { deps, calls } = makeDeps({ snapshot: snapshotWithOverride });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(calls.activateTheme[0].overrideMap, overrideMap);
  });

  it("explicit variantId overrides snapshot map", () => {
    const snapshotWithVariant = { ...baseSnapshot, themeVariant: { clawd: "chill" } };
    const { deps, calls } = makeDeps({ snapshot: snapshotWithVariant });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd", variantId: "hyper" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.strictEqual(calls.activateTheme[0].variantId, "hyper");
  });

  it("commits theme + themeVariant atomically", () => {
    const { deps } = makeDeps();
    const r = commandRegistry.setThemeSelection({ themeId: "clawd", variantId: "chill" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.ok(r.commit, "commit field expected");
    assert.strictEqual(r.commit.theme, "clawd");
    assert.deepStrictEqual(r.commit.themeVariant, { clawd: "chill" });
  });

  it("preserves other themes' variantIds when committing", () => {
    const snapshotWithVariant = { ...baseSnapshot, themeVariant: { mycat: "hyper" } };
    const { deps } = makeDeps({ snapshot: snapshotWithVariant });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd", variantId: "chill" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeVariant, { mycat: "hyper", clawd: "chill" });
  });

  it("self-heals by committing the RESOLVED variantId on dead-variant fallback", () => {
    // Scenario: author deleted `chill` variant. User's stored themeVariant
    // still points to `chill`. setThemeSelection calls activateTheme which
    // lenient-falls back to `default` and returns resolved id. The committed
    // themeVariant records `default`, not the dead `chill` the user asked for.
    const snapshotWithDead = { ...baseSnapshot, themeVariant: { clawd: "dead" } };
    const { deps } = makeDeps({ snapshot: snapshotWithDead });
    const r = commandRegistry.setThemeSelection({ themeId: "clawd" }, deps);
    assert.strictEqual(r.status, "ok");
    assert.deepStrictEqual(r.commit.themeVariant, { clawd: "default" });
  });

  it("surfaces activateTheme throws as error status (no commit)", () => {
    const { deps } = makeDeps({
      activateTheme: () => { throw new Error("theme missing"); },
    });
    const r = commandRegistry.setThemeSelection({ themeId: "broken" }, deps);
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /theme missing/);
    assert.strictEqual(r.commit, undefined);
  });

  it("errors when activateTheme dep is missing", () => {
    const r = commandRegistry.setThemeSelection({ themeId: "clawd" }, { snapshot: baseSnapshot });
    assert.strictEqual(r.status, "error");
    assert.match(r.message, /activateTheme/);
  });
});

describe("version validator", () => {
  it("accepts the current version", () => {
    const r = updateRegistry.version(prefs.CURRENT_VERSION, { snapshot: prefs.getDefaults() });
    assert.strictEqual(r.status, "ok");
  });

  it("rejects future versions", () => {
    const r = updateRegistry.version(prefs.CURRENT_VERSION + 1, { snapshot: prefs.getDefaults() });
    assert.strictEqual(r.status, "error");
  });

  it("rejects non-positive numbers", () => {
    const deps = { snapshot: prefs.getDefaults() };
    assert.strictEqual(updateRegistry.version(0, deps).status, "error");
    assert.strictEqual(updateRegistry.version(-1, deps).status, "error");
    assert.strictEqual(updateRegistry.version("1", deps).status, "error");
  });
});
