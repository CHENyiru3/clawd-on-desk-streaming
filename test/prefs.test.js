"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const prefs = require("../src/prefs");

const tempDirs = [];

function makeTempPath(name = "clawd-prefs.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-prefs-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("prefs.getDefaults", () => {
  it("returns a fresh snapshot every call (no shared object refs)", () => {
    const a = prefs.getDefaults();
    const b = prefs.getDefaults();
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(a.agents, b.agents);
    assert.notStrictEqual(a.themeOverrides, b.themeOverrides);
    assert.notStrictEqual(a.agentLauncher, b.agentLauncher);
    // Mutating one shouldn't affect the other
    a.agents["claude-code"].enabled = false;
    assert.strictEqual(b.agents["claude-code"].enabled, true);
  });

  it("includes the current schema version", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(d.version, prefs.CURRENT_VERSION);
  });

  it("defaults Claude hook management on and Start with Claude off", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(d.manageClaudeHooksAutomatically, true);
    assert.strictEqual(d.autoStartWithClaude, false);
  });

  it("seeds mac typing awareness prefs", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(typeof d.macTypingAwarenessEnabled, "boolean");
    assert.strictEqual(d.macTypingPermissionPrompted, false);
    assert.strictEqual(d.macTypingPermissionDismissed, false);
  });

  it("seeds global activity prefs", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(typeof d.globalActivityEnabled, "boolean");
    assert.strictEqual(d.globalActivityOnboardingShown, false);
    assert.deepStrictEqual(
      Object.keys(d.globalActivityRules).sort(),
      [
        "browserReadingReaction",
        "clipboardReaction",
        "mediaPlaybackReaction",
        "notificationReaction",
        "presenceWake",
      ]
    );
  });

  it("seeds MiniMax translation prefs", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(d.translateProvider, "minimax");
    assert.strictEqual(d.translateApiKey, "");
  });

  it("seeds time check-in prefs", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(typeof d.timeCheckinEnabled, "boolean");
    assert.strictEqual(d.timeCheckinScheduleMode, "twoHourWithAnchors");
    assert.strictEqual(d.timeCheckinPreviewClipboardWindowMinutes, 60);
    assert.deepStrictEqual(d.timeCheckinGenerator, {
      cwd: "/Users/eric_yiru/Desktop/Home",
      command: "hermes",
      args: ["--resume", "20260417_140020_0b84f5"],
      timeoutMs: 30000,
    });
    assert.strictEqual(d.timeCheckinLastRunAt, null);
  });

  it("seeds all known agents as enabled", () => {
    const d = prefs.getDefaults();
    for (const id of ["claude-code", "codex", "copilot-cli", "cursor-agent", "gemini-cli", "codebuddy", "kiro-cli", "opencode"]) {
      assert.strictEqual(d.agents[id].enabled, true, `${id} should default enabled`);
    }
  });

  it("seeds all known agents with permissionsEnabled=true", () => {
    const d = prefs.getDefaults();
    for (const id of ["claude-code", "codex", "copilot-cli", "cursor-agent", "gemini-cli", "codebuddy", "kiro-cli", "opencode"]) {
      assert.strictEqual(
        d.agents[id].permissionsEnabled,
        true,
        `${id} should default permissionsEnabled`
      );
    }
  });

  it("seeds agentLauncher with hermes CLI as default command", () => {
    const d = prefs.getDefaults();
    assert.strictEqual(d.agentLauncher.enabled, true);
    assert.strictEqual(d.agentLauncher.command, "hermes");
    assert.strictEqual(d.agentLauncher.cwd, "");
    assert.strictEqual(d.agentLauncher.trigger, "focusFallback");
  });
});

describe("prefs.validate", () => {
  it("drops bad fields and falls back to defaults", () => {
    const v = prefs.validate({
      lang: "klingon",       // not in enum
      soundMuted: "yes",     // wrong type
      x: NaN,                // not finite
      bubbleFollowPet: true, // ok
      hideBubbles: 0,        // wrong type
      macTypingAwarenessEnabled: "yes",
      globalActivityEnabled: "yes",
      translateProvider: "googletrans",
      translateApiKey: 42,
    });
    const d = prefs.getDefaults();
    assert.strictEqual(v.lang, d.lang);
    assert.strictEqual(v.soundMuted, false);
    assert.strictEqual(v.x, 0);
    assert.strictEqual(v.bubbleFollowPet, true);
    assert.strictEqual(v.hideBubbles, false);
    assert.strictEqual(typeof v.macTypingAwarenessEnabled, "boolean");
    assert.strictEqual(typeof v.globalActivityEnabled, "boolean");
    assert.strictEqual(v.translateProvider, "minimax");
    assert.strictEqual(v.translateApiKey, "");
  });

  it("keeps valid fields verbatim", () => {
    const v = prefs.validate({
      lang: "zh",
      soundMuted: true,
      bubbleFollowPet: true,
      x: 100,
      y: -50,
      size: "P:15",
      miniEdge: "left",
      theme: "calico",
    });
    assert.strictEqual(v.lang, "zh");
    assert.strictEqual(v.soundMuted, true);
    assert.strictEqual(v.bubbleFollowPet, true);
    assert.strictEqual(v.x, 100);
    assert.strictEqual(v.y, -50);
    assert.strictEqual(v.size, "P:15");
    assert.strictEqual(v.miniEdge, "left");
    assert.strictEqual(v.theme, "calico");
  });

  it("trims translateApiKey and keeps minimax provider", () => {
    const v = prefs.validate({
      translateProvider: "minimax",
      translateApiKey: "  secret-key  ",
    });
    assert.strictEqual(v.translateProvider, "minimax");
    assert.strictEqual(v.translateApiKey, "secret-key");
  });

  it("normalizes time check-in generator fields", () => {
    const v = prefs.validate({
      timeCheckinGenerator: {
        cwd: " /tmp/checkins ",
        command: " hermes ",
        args: ["--resume", "abc", 42, ""],
        timeoutMs: 999999,
      },
      timeCheckinLastRunAt: 1234,
    });
    assert.deepStrictEqual(v.timeCheckinGenerator, {
      cwd: "/tmp/checkins",
      command: "hermes",
      args: ["--resume", "abc"],
      timeoutMs: 120000,
    });
    assert.strictEqual(v.timeCheckinLastRunAt, 1234);
  });

  it("normalizes globalActivityRules and drops malformed entries", () => {
    const v = prefs.validate({
      globalActivityRules: {
        clipboardReaction: true,
        notificationReaction: "yes",
        frontmostAppReaction: false,
      },
    });
    assert.strictEqual(v.globalActivityRules.clipboardReaction, true);
    assert.strictEqual(typeof v.globalActivityRules.notificationReaction, "boolean");
    assert.strictEqual("frontmostAppReaction" in v.globalActivityRules, false);
  });

  it("normalizes agents (drops malformed entries)", () => {
    const v = prefs.validate({
      agents: {
        "claude-code": { enabled: false },
        "bogus-entry": "not an object",
        "codex": { enabled: "true" }, // wrong type — should be dropped
      },
    });
    assert.strictEqual(v.agents["claude-code"].enabled, false);
    // bogus + bad codex use defaults
    assert.strictEqual(v.agents.codex.enabled, true);
    assert.strictEqual(v.agents["bogus-entry"], undefined);
  });

  it("normalizes agents: preserves permissionsEnabled flag", () => {
    const v = prefs.validate({
      agents: {
        "claude-code": { enabled: true, permissionsEnabled: false },
      },
    });
    assert.strictEqual(v.agents["claude-code"].enabled, true);
    assert.strictEqual(v.agents["claude-code"].permissionsEnabled, false);
  });

  it("normalizes agents: fills missing permissionsEnabled from defaults", () => {
    // Pre-subgate prefs files only have { enabled: bool }. Normalization
    // must NOT strip them, but must also NOT invent permissionsEnabled=false
    // — defaults are true, and the gate reads "missing flag" as true anyway.
    const v = prefs.validate({
      agents: {
        "claude-code": { enabled: false },
      },
    });
    assert.strictEqual(v.agents["claude-code"].enabled, false);
    assert.strictEqual(v.agents["claude-code"].permissionsEnabled, true);
  });

  it("normalizes agents: drops non-boolean permissionsEnabled, keeps valid enabled", () => {
    const v = prefs.validate({
      agents: {
        "claude-code": { enabled: false, permissionsEnabled: "nope" },
      },
    });
    assert.strictEqual(v.agents["claude-code"].enabled, false);
    // Bad flag falls back to the default for that agent (true), not dropped
    // altogether — the entry has a valid flag so it survives.
    assert.strictEqual(v.agents["claude-code"].permissionsEnabled, true);
  });

  it("returns defaults for null/non-object input", () => {
    const a = prefs.validate(null);
    const b = prefs.validate("not an object");
    const d = prefs.getDefaults();
    assert.deepStrictEqual(a, d);
    assert.deepStrictEqual(b, d);
  });

  // Phase 3b-swap: themeVariant field
  it("themeVariant defaults to empty object (no migration needed)", () => {
    const d = prefs.getDefaults();
    assert.deepStrictEqual(d.themeVariant, {});
  });

  it("themeVariant drops malformed entries but keeps string/string pairs", () => {
    const v = prefs.validate({
      themeVariant: {
        clawd: "chill",
        calico: "default",
        bogus: 42,           // wrong value type
        "": "chill",         // empty themeId
        nullVal: "",         // empty variantId
      },
    });
    assert.deepStrictEqual(v.themeVariant, { clawd: "chill", calico: "default" });
  });

  it("themeVariant falls back to defaults when not an object", () => {
    const v = prefs.validate({ themeVariant: "nope" });
    assert.deepStrictEqual(v.themeVariant, {});
    const w = prefs.validate({ themeVariant: [1, 2] });
    assert.deepStrictEqual(w.themeVariant, {});
  });

  it("normalizes agentLauncher: drops bad command and invalid trigger", () => {
    const v = prefs.validate({
      agentLauncher: {
        enabled: true,
        command: "claude\nrm",
        cwd: "/tmp",
        trigger: "bogus",
      },
    });
    const d = prefs.getDefaults();
    assert.strictEqual(v.agentLauncher.enabled, true);
    assert.strictEqual(v.agentLauncher.command, d.agentLauncher.command);
    assert.strictEqual(v.agentLauncher.cwd, "/tmp");
    assert.strictEqual(v.agentLauncher.trigger, d.agentLauncher.trigger);
  });

  it("normalizes agentLauncher: keeps valid custom command", () => {
    const v = prefs.validate({
      agentLauncher: {
        enabled: true,
        command: "/usr/local/bin/claude",
        cwd: "",
        trigger: "tripleAndFocus",
      },
    });
    assert.strictEqual(v.agentLauncher.command, "/usr/local/bin/claude");
    assert.strictEqual(v.agentLauncher.trigger, "tripleAndFocus");
  });

  it("normalizes agentLauncher: strips cwd containing ..", () => {
    const v = prefs.validate({
      agentLauncher: {
        enabled: true,
        command: "claude",
        cwd: "/tmp/../etc",
        trigger: "menuOnly",
      },
    });
    assert.strictEqual(v.agentLauncher.cwd, "");
  });
});

describe("prefs.migrate", () => {
  it("upgrades v0 (no version field) to v1", () => {
    const raw = { lang: "zh", soundMuted: true };
    const upgraded = prefs.migrate(raw);
    assert.strictEqual(upgraded.version, 1);
    assert.ok(upgraded.agents && typeof upgraded.agents === "object");
    assert.ok(upgraded.themeOverrides && typeof upgraded.themeOverrides === "object");
    // Original fields preserved
    assert.strictEqual(upgraded.lang, "zh");
    assert.strictEqual(upgraded.soundMuted, true);
  });

  it("leaves v1 files alone", () => {
    const raw = {
      version: 1,
      lang: "en",
      agents: { "claude-code": { enabled: false } },
    };
    const upgraded = prefs.migrate(raw);
    assert.strictEqual(upgraded.version, 1);
    assert.strictEqual(upgraded.agents["claude-code"].enabled, false);
  });

  it("backfills positionSaved=true for files with non-zero x/y", () => {
    const raw = { version: 1, x: 500, y: 300 };
    const upgraded = prefs.migrate(raw);
    assert.strictEqual(upgraded.positionSaved, true);
  });

  it("backfills positionSaved=false for files with x=0,y=0", () => {
    const raw = { version: 1, x: 0, y: 0 };
    const upgraded = prefs.migrate(raw);
    assert.strictEqual(upgraded.positionSaved, false);
  });

  it("does not overwrite existing positionSaved field", () => {
    const raw = { version: 1, x: 0, y: 0, positionSaved: true };
    const upgraded = prefs.migrate(raw);
    assert.strictEqual(upgraded.positionSaved, true);
  });
});

describe("prefs.load", () => {
  it("returns defaults for missing file (ENOENT) without backup", () => {
    const p = makeTempPath();
    const { snapshot, locked } = prefs.load(p);
    assert.strictEqual(locked, false);
    assert.deepStrictEqual(snapshot, prefs.getDefaults());
    // Should NOT have created a backup since file never existed
    assert.strictEqual(fs.existsSync(p + ".bak"), false);
  });

  it("backs up corrupt JSON and returns defaults", () => {
    const p = makeTempPath();
    fs.writeFileSync(p, "{ this is not valid json", "utf8");
    const { snapshot, locked } = prefs.load(p);
    assert.strictEqual(locked, false);
    assert.deepStrictEqual(snapshot, prefs.getDefaults());
    assert.strictEqual(fs.existsSync(p + ".bak"), true);
    assert.strictEqual(
      fs.readFileSync(p + ".bak", "utf8"),
      "{ this is not valid json"
    );
  });

  it("migrates a v0 file (no version field) on load", () => {
    const p = makeTempPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ lang: "zh", x: 100, y: 200, size: "P:12" }),
      "utf8"
    );
    const { snapshot, locked } = prefs.load(p);
    assert.strictEqual(locked, false);
    assert.strictEqual(snapshot.version, 1);
    assert.strictEqual(snapshot.lang, "zh");
    assert.strictEqual(snapshot.x, 100);
    assert.strictEqual(snapshot.y, 200);
    assert.strictEqual(snapshot.size, "P:12");
    // New fields populated from defaults
    assert.ok(snapshot.agents);
    assert.ok(snapshot.themeOverrides);
  });

  it("returns locked=true and warns for future-version files", () => {
    const p = makeTempPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ version: 999, lang: "en" }),
      "utf8"
    );
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    try {
      const { snapshot, locked } = prefs.load(p);
      assert.strictEqual(locked, true);
      assert.strictEqual(snapshot.lang, "en");
      assert.strictEqual(warned, true);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("prefs.save", () => {
  it("writes a valid snapshot that round-trips through load", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.lang = "zh";
    snap.bubbleFollowPet = true;
    snap.x = 42;
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.strictEqual(snapshot.lang, "zh");
    assert.strictEqual(snapshot.bubbleFollowPet, true);
    assert.strictEqual(snapshot.x, 42);
    assert.strictEqual(snapshot.version, 1);
  });

  it("validates before writing — bad fields fall back to defaults on disk", () => {
    const p = makeTempPath();
    const dirty = {
      ...prefs.getDefaults(),
      lang: "klingon",
      x: NaN,
    };
    prefs.save(p, dirty);
    const written = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.strictEqual(written.lang, "en");
    assert.strictEqual(written.x, 0);
  });

  it("round-trips themeOverrides with disabled: true", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.themeOverrides = {
      clawd: {
        states: {
          sweeping: { disabled: true },
        },
      },
    };
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.deepStrictEqual(snapshot.themeOverrides.clawd.states.sweeping, { disabled: true });
  });

  it("themeOverrides: nested state entry preserves file + transition while keeping disabled", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.themeOverrides = {
      clawd: {
        states: {
          attention: {
            disabled: true,
            sourceThemeId: "clawd",
            file: "clawd-happy.svg",
            transition: { in: 100, out: 220 },
          },
        },
      },
    };
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.deepStrictEqual(snapshot.themeOverrides.clawd.states.attention, {
      disabled: true,
      sourceThemeId: "clawd",
      file: "clawd-happy.svg",
      transition: { in: 100, out: 220 },
    });
  });

  it("themeOverrides: state/tier/timing entries round-trip in Path A schema", () => {
    const p = makeTempPath();
    const snap = prefs.getDefaults();
    snap.themeOverrides = {
      clawd: {
        states: {
          attention: {
            file: "clawd-happy.svg",
            transition: { in: 80, out: 140 },
          },
        },
        tiers: {
          workingTiers: {
            "clawd-working-typing.svg": {
              file: "custom-working.svg",
              transition: { in: 0, out: 90 },
            },
          },
        },
        timings: {
          autoReturn: { attention: 2800 },
        },
      },
    };
    prefs.save(p, snap);
    const { snapshot } = prefs.load(p);
    assert.deepStrictEqual(snapshot.themeOverrides.clawd, {
      states: {
        attention: {
          file: "clawd-happy.svg",
          transition: { in: 80, out: 140 },
        },
      },
      tiers: {
        workingTiers: {
          "clawd-working-typing.svg": {
            file: "custom-working.svg",
            transition: { in: 0, out: 90 },
          },
        },
      },
      timings: {
        autoReturn: { attention: 2800 },
      },
    });
  });

  it("themeOverrides: legacy flat state entries normalize into states map", () => {
    const validated = prefs.validate({
      ...prefs.getDefaults(),
      themeOverrides: {
        clawd: {
          attention: { disabled: true },
        },
      },
    });
    assert.deepStrictEqual(validated.themeOverrides, {
      clawd: {
        states: {
          attention: { disabled: true },
        },
      },
    });
  });
});
