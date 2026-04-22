"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const BRIDGE_SCRIPT = path.join(__dirname, "..", "hooks", "hermes-permission-bridge.py");

// ── Python bridge function tester ─────────────────────────────────────────────
// Uses importlib.util to load the Python module directly, bypassing subprocess
// overhead. This lets us test individual functions in isolation.

function loadBridgeModule(extraEnv = {}) {
  const fullEnv = { ...process.env, ...extraEnv };

  // Build a self-contained Python script that sets env vars, loads the bridge
  // module, and prints JSON-serialized results for the tested functions.
  const pythonScript = `
import sys, os, json, tempfile, importlib.util

# Set env vars from the outer process
${Object.entries(extraEnv).map(([k, v]) => `os.environ[${JSON.stringify(k)}] = ${JSON.stringify(v)}`).join("\n")}

# Capture stderr before loading the module
import io, sys
_captured_stderr = io.StringIO()
_old_stderr = sys.stderr
sys.stderr = _captured_stderr

# Load the bridge module via importlib
spec = importlib.util.spec_from_file_location("hermes_permission_bridge", ${JSON.stringify(BRIDGE_SCRIPT)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

sys.stderr = _old_stderr
_stderr_val = _captured_stderr.getvalue()

result = {
  "installed": "installed" in _stderr_val,
  "stderr": _stderr_val,
  "patterns": list(m.DANGEROUS_PATTERNS),
  "is_dangerous_rm_rf": m._is_dangerous_command("rm -rf /"),
  "is_dangerous_rm_r": m._is_dangerous_command("rm -r /"),
  "is_dangerous_dd": m._is_dangerous_command("dd if=/dev/zero of=/dev/null"),
  "is_dangerous_safe_ls": m._is_dangerous_command("ls -la"),
  "is_dangerous_safe_cat": m._is_dangerous_command("cat file.txt"),
  "env_enabled": os.environ.get("HERMES_PERMISSION_ENABLED", ""),
  "env_url": os.environ.get("CLAWD_PERMISSION_URL", ""),
  "env_session": os.environ.get("HERMES_BRIDGE_SESSION_ID", ""),
}

print(json.dumps(result))
`;

  return new Promise((resolve, reject) => {
    const child = require("child_process").spawn("python3", ["-c", pythonScript], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += String(c); });
    child.stderr.on("data", (c) => { stderr += String(c); });
    child.on("close", (code) => {
      if (code === 0) {
        try { resolve(JSON.parse(stdout.trim())); }
        catch (e) { reject(new Error(`JSON parse failed: ${stdout}\n stderr: ${stderr}`)); }
      } else {
        reject(new Error(`Python exited ${code}: ${stderr}`));
      }
    });
    child.on("error", (err) => reject(err));
  });
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("hermes-permission-bridge Python module", () => {

  it("script file exists at hooks/hermes-permission-bridge.py", () => {
    assert.ok(fs.existsSync(BRIDGE_SCRIPT), "Bridge script should exist");
  });

  it("DANGEROUS_PATTERNS contains rm -rf and dd if= patterns", async () => {
    const r = await loadBridgeModule();
    assert.ok(r.patterns.includes("rm -rf"), `Expected 'rm -rf' in patterns, got: ${r.patterns}`);
    assert.ok(r.patterns.includes("dd if="), `Expected 'dd if=' in patterns, got: ${r.patterns}`);
    assert.ok(r.patterns.includes("mkfs"), `Expected 'mkfs' in patterns, got: ${r.patterns}`);
  });

  it("_is_dangerous_command returns true for 'rm -rf /'", async () => {
    const r = await loadBridgeModule();
    assert.strictEqual(r.is_dangerous_rm_rf, true);
  });

  it("_is_dangerous_command returns false for 'rm -r /' (not rm -rf)", async () => {
    const r = await loadBridgeModule();
    assert.strictEqual(r.is_dangerous_rm_r, false, "'rm -r' should NOT be dangerous (only 'rm -rf')");
  });

  it("_is_dangerous_command returns true for 'dd if=/dev/zero'", async () => {
    const r = await loadBridgeModule();
    assert.strictEqual(r.is_dangerous_dd, true);
  });

  it("_is_dangerous_command returns false for safe commands (ls, cat)", async () => {
    const r = await loadBridgeModule();
    assert.strictEqual(r.is_dangerous_safe_ls, false, "'ls' should not be dangerous");
    assert.strictEqual(r.is_dangerous_safe_cat, false, "'cat' should not be dangerous");
  });

  it("module installs (patches subprocess.Popen) when HERMES_PERMISSION_ENABLED=1", async () => {
    const r = await loadBridgeModule({
      HERMES_PERMISSION_ENABLED: "1",
      CLAWD_PERMISSION_URL: "http://127.0.0.1:23333/permission",
      HERMES_BRIDGE_SESSION_ID: "test-session",
    });
    assert.strictEqual(r.installed, true, "Module should be installed");
  });

  it("module installs when HERMES_PERMISSION_ENABLED='true' (string)", async () => {
    const r = await loadBridgeModule({
      HERMES_PERMISSION_ENABLED: "true",
      CLAWD_PERMISSION_URL: "http://127.0.0.1:23333/permission",
    });
    assert.strictEqual(r.installed, true);
  });

  it("module does NOT install when HERMES_PERMISSION_ENABLED is absent", async () => {
    const r = await loadBridgeModule({});
    assert.strictEqual(r.installed, false, "Module should NOT be installed without env var");
  });

  it("module does NOT install when HERMES_PERMISSION_ENABLED='0'", async () => {
    const r = await loadBridgeModule({
      HERMES_PERMISSION_ENABLED: "0",
      CLAWD_PERMISSION_URL: "http://127.0.0.1:23333/permission",
    });
    assert.strictEqual(r.installed, false, "Module should NOT be installed when enabled='0'");
  });

  it("env vars are correctly read from os.environ", async () => {
    const r = await loadBridgeModule({
      HERMES_PERMISSION_ENABLED: "1",
      CLAWD_PERMISSION_URL: "http://127.0.0.1:55555/permission",
      HERMES_BRIDGE_SESSION_ID: "my-session-id",
    });
    assert.strictEqual(r.env_enabled, "1");
    assert.strictEqual(r.env_url, "http://127.0.0.1:55555/permission");
    assert.strictEqual(r.env_session, "my-session-id");
  });

  it("dangerous patterns include fdisk, mkfs, wipefs, shred -f", async () => {
    const r = await loadBridgeModule();
    const dangerousCommands = [
      "fdisk", "mkfs", "wipefs", "shred -f", "parted",
      "> /dev/sd", "chattr -i", "sfdisk",
    ];
    for (const cmd of dangerousCommands) {
      assert.ok(
        r.patterns.includes(cmd),
        `Expected '${cmd}' in DANGEROUS_PATTERNS, got: ${r.patterns.join(", ")}`
      );
    }
  });

  it("DANGEROUS_PATTERNS does not include safe commands", async () => {
    const r = await loadBridgeModule();
    const safeCommands = ["ls", "cat", "grep", "echo", "mkdir", "touch", "cp", "mv"];
    for (const cmd of safeCommands) {
      assert.ok(
        !r.patterns.includes(cmd),
        `'${cmd}' should not be in DANGEROUS_PATTERNS`
      );
    }
  });

});
