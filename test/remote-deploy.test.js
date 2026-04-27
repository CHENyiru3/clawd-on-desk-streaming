const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SCRIPT_PATH = path.join(__dirname, "..", "scripts", "remote-deploy.sh");
const HOOKS_DIR = path.join(__dirname, "..", "hooks");
const SUPERVISOR_PATH = path.join(HOOKS_DIR, "clawd-remote-monitor.sh");

function parseDeployedFiles() {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  const block = script.match(/FILES=\(\s*\n([\s\S]*?)\n\s*\)/);
  if (!block) throw new Error("FILES=() block not found in remote-deploy.sh");
  const entries = [...block[1].matchAll(/"\$HOOKS_DIR\/([^"]+)"/g)];
  return entries.map((m) => m[1]);
}

function findRelativeRequires(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const matches = [...content.matchAll(/require\(["']\.\/([^"')]+)["']\)/g)];
  return matches.map((m) => (m[1].endsWith(".js") ? m[1] : `${m[1]}.js`));
}

describe("scripts/remote-deploy.sh FILES manifest", () => {
  it("ships every relative require target of every listed file", () => {
    const deployed = parseDeployedFiles();
    assert.ok(deployed.length > 0, "FILES array parsed as empty");
    const deployedSet = new Set(deployed);

    for (const name of deployed) {
      const absPath = path.join(HOOKS_DIR, name);
      assert.ok(fs.existsSync(absPath), `listed file missing: hooks/${name}`);

      const deps = findRelativeRequires(absPath);
      for (const dep of deps) {
        assert.ok(
          deployedSet.has(dep),
          `hooks/${name} requires './${dep.replace(/\.js$/, "")}' but ${dep} is not in scripts/remote-deploy.sh FILES — add it or the remote deploy will ship a broken subset`
        );
      }
    }
  });

  it("ships the remote Codex monitor supervisor", () => {
    const deployed = parseDeployedFiles();
    assert.ok(
      deployed.includes("clawd-remote-monitor.sh"),
      "remote deploy must ship clawd-remote-monitor.sh for --auto Codex monitoring"
    );
  });
});

describe("scripts/remote-deploy.sh auto mode contract", () => {
  it("documents and parses --auto", () => {
    const script = fs.readFileSync(SCRIPT_PATH, "utf8");
    assert.match(script, /Usage: bash scripts\/remote-deploy\.sh user@host \[--auto\] \[--prefix NAME\] \[--conda-env NAME\]/);
    assert.match(script, /--auto\)\s*AUTO_MODE=1; shift ;;/);
  });

  it("supports remote conda env setup for Node.js", () => {
    const script = fs.readFileSync(SCRIPT_PATH, "utf8");
    assert.match(script, /--conda-env\)/);
    assert.match(script, /conda activate "\$CLAWD_REMOTE_CONDA_ENV"/);
    assert.match(script, /CLAWD_REMOTE_CONDA_ENV=\$\(printf "%q" "\$CONDA_ENV"\)/);
    assert.match(script, /Install Node\.js on the remote server first, or pass --conda-env NAME/);
  });

  it("reuses a saved remote Node path after the first conda-backed setup", () => {
    const script = fs.readFileSync(SCRIPT_PATH, "utf8");
    assert.match(script, /~\/\.claude\/hooks\/clawd-remote-env/);
    assert.match(script, /\. ~\/\.claude\/hooks\/clawd-remote-env/);
    assert.match(script, /\[ -n "\$\{CLAWD_NODE_BIN:-\}" \] && \[ -x "\$CLAWD_NODE_BIN" \]/);
    assert.match(script, /"\$CLAWD_NODE_BIN" --version/);
  });

  it("starts an SSH reverse tunnel to the local Clawd runtime port", () => {
    const script = fs.readFileSync(SCRIPT_PATH, "utf8");
    assert.match(script, /CONTROL_PATH="\$TUNNEL_DIR\/\$\{TUNNEL_ID\}\.sock"/);
    assert.match(script, /ssh -S "\$CONTROL_PATH" -O exit "\$SSH_TARGET"/);
    assert.match(script, /ssh -f -N/);
    assert.match(script, /-M/);
    assert.match(script, /-S "\$CONTROL_PATH"/);
    assert.match(script, /-o ExitOnForwardFailure=yes/);
    assert.match(script, /-o ServerAliveInterval=30/);
    assert.match(script, /-R "127\.0\.0\.1:23333:127\.0\.0\.1:\$\{LOCAL_PORT\}"/);
  });

  it("restarts the remote monitor supervisor in auto mode", () => {
    const script = fs.readFileSync(SCRIPT_PATH, "utf8");
    assert.match(script, /CLAWD_REMOTE_PORT=23333 ~\/\.claude\/hooks\/clawd-remote-monitor\.sh restart/);
  });
});

describe("hooks/clawd-remote-monitor.sh", () => {
  it("is executable and supervises codex-remote-monitor.js", () => {
    const stat = fs.statSync(SUPERVISOR_PATH);
    assert.ok(stat.mode & 0o111, "supervisor script should be executable");

    const script = fs.readFileSync(SUPERVISOR_PATH, "utf8");
    assert.match(script, /MONITOR_JS="\$SCRIPT_DIR\/codex-remote-monitor\.js"/);
    assert.match(script, /PID_FILE="\$SCRIPT_DIR\/codex-remote-monitor\.pid"/);
    assert.match(script, /LOG_FILE="\$SCRIPT_DIR\/codex-remote-monitor\.log"/);
    assert.match(script, /ENV_FILE="\$SCRIPT_DIR\/clawd-remote-env"/);
    assert.match(script, /NODE_BIN="\$\{CLAWD_NODE_BIN:-\$\{NODE_BIN:-node\}\}"/);
    assert.match(script, /nohup "\$NODE_BIN" "\$MONITOR_JS" --port "\$PORT"/);
  });

  it("supports start, stop, restart, and status commands", () => {
    const script = fs.readFileSync(SUPERVISOR_PATH, "utf8");
    assert.match(script, /^\s*start\)/m);
    assert.match(script, /^\s*stop\)/m);
    assert.match(script, /^\s*restart\)/m);
    assert.match(script, /^\s*status\)/m);
  });
});

describe("hooks/codex-remote-monitor.js", () => {
  it("mirrors local Codex permission notification heuristics for remote sessions", () => {
    const script = fs.readFileSync(path.join(HOOKS_DIR, "codex-remote-monitor.js"), "utf8");
    assert.match(script, /APPROVAL_HEURISTIC_MS = 2000/);
    assert.match(script, /function extractShellCommand/);
    assert.match(script, /function isExplicitApprovalRequest/);
    assert.match(script, /postState\(entry\.sessionId, "notification", "codex-permission"/);
    assert.match(script, /permission_detail: \{ command: safeCommand \}/);
  });
});
