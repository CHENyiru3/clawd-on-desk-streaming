#!/usr/bin/env bash
# Clawd Desktop Pet — Remote Hook Deployment
# Deploys hook files to a remote server and registers Claude Code hooks.
#
# Usage:
#   bash scripts/remote-deploy.sh user@host [--auto] [--prefix NAME] [--conda-env NAME]
#
# Prerequisites:
#   - SSH access to the remote server
#   - Node.js installed on the remote server
#   - Clawd running locally (for port detection)

set -euo pipefail

# ── Args ──

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/remote-deploy.sh user@host [--auto] [--prefix NAME] [--conda-env NAME]"
  echo ""
  echo "Deploys Clawd hook files to a remote server so that"
  echo "Claude Code and Codex CLI states are synced back to your"
  echo "local Clawd via SSH reverse port forwarding."
  echo ""
  echo "Options:"
  echo "  --auto          Start a background SSH reverse tunnel, restart the"
  echo "                  remote Codex monitor, and verify connectivity."
  echo "  --prefix NAME   Short name for this machine (shown in Sessions menu)."
  echo "                  If omitted, hostname is used automatically."
  echo "  --conda-env NAME"
  echo "                  Activate a remote conda env before running node."
  echo "  --remote-setup-cmd CMD"
  echo "                  Custom remote shell snippet to run before node commands."
  exit 1
fi

SSH_TARGET="$1"
HOST_PREFIX=""
AUTO_MODE=0
CONDA_ENV=""
REMOTE_SETUP_CMD=""
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --auto) AUTO_MODE=1; shift ;;
    --conda-env)
      if [ $# -lt 2 ]; then
        echo "ERROR: --conda-env requires a value"
        exit 1
      fi
      CONDA_ENV="$2"
      shift 2
      ;;
    --remote-setup-cmd)
      if [ $# -lt 2 ]; then
        echo "ERROR: --remote-setup-cmd requires a value"
        exit 1
      fi
      REMOTE_SETUP_CMD="$2"
      shift 2
      ;;
    --prefix)
      if [ $# -lt 2 ]; then
        echo "ERROR: --prefix requires a value"
        exit 1
      fi
      HOST_PREFIX="$2"
      shift 2
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPT_DIR/../hooks" && pwd)"
REMOTE_HOOKS_DIR='~/.claude/hooks'
REMOTE_NODE_BIN=""

REMOTE_PRELUDE='
set -e
if [ -n "${CLAWD_REMOTE_SETUP_CMD:-}" ]; then
  eval "$CLAWD_REMOTE_SETUP_CMD"
fi
if [ -n "${CLAWD_REMOTE_CONDA_ENV:-}" ]; then
  __clawd_conda_base=""
  if command -v conda >/dev/null 2>&1; then
    __clawd_conda_base="$(conda info --base 2>/dev/null || true)"
  fi
  if [ -z "$__clawd_conda_base" ]; then
    for __clawd_candidate in "$HOME/miniconda3" "$HOME/anaconda3" "$HOME/miniforge3" "$HOME/mambaforge" "/opt/conda"; do
      if [ -x "$__clawd_candidate/bin/conda" ]; then
        __clawd_conda_base="$__clawd_candidate"
        break
      fi
    done
  fi
  if [ -z "$__clawd_conda_base" ] || [ ! -f "$__clawd_conda_base/etc/profile.d/conda.sh" ]; then
    echo "ERROR: conda not found on remote host; use --remote-setup-cmd to source conda manually." >&2
    exit 127
  fi
  . "$__clawd_conda_base/etc/profile.d/conda.sh"
  conda activate "$CLAWD_REMOTE_CONDA_ENV"
fi
'

remote_shell() {
  local cmd="$1"
  local full_cmd
  full_cmd="${REMOTE_PRELUDE}
${cmd}"
  ssh "$SSH_TARGET" \
    "CLAWD_REMOTE_SETUP_CMD=$(printf "%q" "$REMOTE_SETUP_CMD") CLAWD_REMOTE_CONDA_ENV=$(printf "%q" "$CONDA_ENV") bash -lc $(printf "%q" "$full_cmd")"
}

# Files to deploy
FILES=(
  "$HOOKS_DIR/server-config.js"
  "$HOOKS_DIR/json-utils.js"
  "$HOOKS_DIR/shared-process.js"
  "$HOOKS_DIR/clawd-hook.js"
  "$HOOKS_DIR/install.js"
  "$HOOKS_DIR/codex-remote-monitor.js"
  "$HOOKS_DIR/clawd-remote-monitor.sh"
)

# ── Local port detection ──

LOCAL_PORT=23333
RUNTIME_JSON="$HOME/.clawd/runtime.json"
TUNNEL_DIR="$HOME/.clawd/remote-tunnels"
TUNNEL_ID=$(printf "%s" "$SSH_TARGET" | cksum | awk '{print $1}')
CONTROL_PATH="$TUNNEL_DIR/${TUNNEL_ID}.sock"

if [ -f "$RUNTIME_JSON" ]; then
  DETECTED_PORT=$(node -e "
    try {
      const p = JSON.parse(require('fs').readFileSync('$RUNTIME_JSON', 'utf8')).port;
      if (Number.isInteger(p) && p >= 23333 && p <= 23337) console.log(p);
      else console.log(23333);
    } catch { console.log(23333); }
  " 2>/dev/null || echo 23333)
  LOCAL_PORT="$DETECTED_PORT"
fi

echo "Deploying Clawd hooks to $SSH_TARGET..."
echo "  Local Clawd port: $LOCAL_PORT"
if [ "$AUTO_MODE" -eq 1 ]; then
  echo "  Auto mode: enabled"
fi
if [ -n "$CONDA_ENV" ]; then
  echo "  Remote conda env: $CONDA_ENV"
fi
if [ -n "$REMOTE_SETUP_CMD" ]; then
  echo "  Remote setup command: configured"
fi
echo ""

# ── Verify local files ──

for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: Missing file: $f"
    exit 1
  fi
done

# ── Remote prerequisites ──

echo "Checking remote prerequisites..."

# Create remote directory
remote_shell "mkdir -p ~/.claude/hooks" || {
  echo "ERROR: Failed to create remote directory"
  exit 1
}

# Check Node.js
REMOTE_NODE=$(remote_shell '
if command -v node >/dev/null 2>&1; then
  command -v node
  node --version
elif [ -f ~/.claude/hooks/clawd-remote-env ]; then
  # shellcheck disable=SC1090
  . ~/.claude/hooks/clawd-remote-env
  if [ -n "${CLAWD_NODE_BIN:-}" ] && [ -x "$CLAWD_NODE_BIN" ]; then
    printf "%s\n" "$CLAWD_NODE_BIN"
    "$CLAWD_NODE_BIN" --version
  else
    echo MISSING
  fi
else
  echo MISSING
fi
' 2>/dev/null)
if echo "$REMOTE_NODE" | grep -q "MISSING"; then
  echo "ERROR: Node.js not found on remote server"
  echo "Install Node.js on the remote server first, or pass --conda-env NAME if node is inside conda."
  exit 1
fi
REMOTE_NODE_BIN="$(echo "$REMOTE_NODE" | head -1)"
echo "  Remote node: $(echo "$REMOTE_NODE" | tail -1) ($REMOTE_NODE_BIN)"

# ── Deploy files ──

echo "Copying hook files..."
scp -q "${FILES[@]}" "$SSH_TARGET:~/.claude/hooks/" || {
  echo "ERROR: scp failed"
  exit 1
}
echo "  [OK] Files copied to ~/.claude/hooks/"

remote_shell "chmod +x ~/.claude/hooks/clawd-remote-monitor.sh" || {
  echo "ERROR: Failed to mark remote monitor supervisor executable"
  exit 1
}

if [ -n "$REMOTE_NODE_BIN" ]; then
  remote_shell "printf '%s\n' 'CLAWD_NODE_BIN=\"$REMOTE_NODE_BIN\"' > ~/.claude/hooks/clawd-remote-env" || {
    echo "ERROR: Failed to write remote node config"
    exit 1
  }
fi

# ── Write host prefix ──

if [ -n "$HOST_PREFIX" ]; then
  echo "Writing host prefix: $HOST_PREFIX"
  remote_shell "printf '%s\n' '$HOST_PREFIX' > ~/.claude/hooks/clawd-host-prefix"
  echo "  [OK] Prefix written to ~/.claude/hooks/clawd-host-prefix"
fi

# ── Register hooks ──

echo "Registering Claude Code hooks (remote mode)..."
remote_shell "\"$REMOTE_NODE_BIN\" ~/.claude/hooks/install.js --remote" || {
  echo "WARNING: Hook registration failed (Claude Code may not be installed on remote)"
}

check_remote_forward() {
  remote_shell "\"$REMOTE_NODE_BIN\" -e 'const http=require(\"http\");const req=http.get({hostname:\"127.0.0.1\",port:23333,path:\"/state\",timeout:1500},res=>{const ok=res.headers[\"x-clawd-server\"]===\"clawd-on-desk\";res.resume();res.on(\"end\",()=>process.exit(ok?0:2));});req.on(\"error\",()=>process.exit(1));req.on(\"timeout\",()=>{req.destroy();process.exit(3);});'" >/dev/null 2>&1
}

start_auto_tunnel() {
  echo "Checking remote tunnel..."
  if check_remote_forward; then
    echo "  [OK] Existing remote forward reaches local Clawd"
    return 0
  fi

  mkdir -p "$TUNNEL_DIR"
  if [ -e "$CONTROL_PATH" ]; then
    echo "Stopping stale Clawd SSH tunnel control socket..."
    if [ -S "$CONTROL_PATH" ]; then
      ssh -S "$CONTROL_PATH" -O exit "$SSH_TARGET" >/dev/null 2>&1 || true
    fi
    rm -f "$CONTROL_PATH"
  fi

  echo "Starting background SSH reverse tunnel..."
  ssh -f -N \
    -M \
    -S "$CONTROL_PATH" \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -R "127.0.0.1:23333:127.0.0.1:${LOCAL_PORT}" \
    "$SSH_TARGET" || {
      echo "ERROR: Failed to start SSH reverse tunnel"
      echo "Check that SSH works and the server allows AllowTcpForwarding."
      exit 1
    }

  if check_remote_forward; then
    echo "  [OK] Remote forward is active"
    return 0
  fi

  echo "ERROR: SSH tunnel started, but remote host still cannot reach local Clawd"
  echo "Make sure Clawd is running locally and listening on port ${LOCAL_PORT}."
  exit 1
}

start_remote_monitor() {
  echo "Starting remote Codex monitor supervisor..."
  remote_shell "CLAWD_REMOTE_PORT=23333 ~/.claude/hooks/clawd-remote-monitor.sh restart" || {
    echo "ERROR: Failed to start remote Codex monitor"
    exit 1
  }
}

if [ "$AUTO_MODE" -eq 1 ]; then
  start_auto_tunnel
  start_remote_monitor
fi

# ── Print SSH configuration ──

# Extract host and user from SSH target
SSH_HOST="${SSH_TARGET#*@}"
SSH_USER="${SSH_TARGET%@*}"
if [ "$SSH_USER" = "$SSH_TARGET" ]; then
  SSH_USER=""
fi

echo ""
echo "=========================================="
if [ "$AUTO_MODE" -eq 1 ]; then
echo "  Remote Bridge Active"
else
echo "  SSH Configuration"
fi
echo "=========================================="
echo ""
if [ "$AUTO_MODE" -eq 1 ]; then
echo "A background SSH reverse tunnel is now forwarding remote"
echo "127.0.0.1:23333 back to local Clawd on 127.0.0.1:${LOCAL_PORT}."
echo ""
echo "You can keep using Ghostty normally:"
echo ""
echo "  ssh ${SSH_HOST}"
echo ""
echo "Remote monitor controls:"
echo ""
echo "  ssh ${SSH_HOST} '~/.claude/hooks/clawd-remote-monitor.sh status'"
echo "  ssh ${SSH_HOST} '~/.claude/hooks/clawd-remote-monitor.sh restart'"
echo "  ssh ${SSH_HOST} '~/.claude/hooks/clawd-remote-monitor.sh stop'"
echo ""
echo "Stop the local background tunnel:"
echo ""
echo "  ssh -S \"${CONTROL_PATH}\" -O exit ${SSH_TARGET}"
echo ""
else
echo "Add to your local ~/.ssh/config:"
echo ""
echo "  Host ${SSH_HOST}"
if [ -n "$SSH_USER" ]; then
echo "      User ${SSH_USER}"
fi
echo "      RemoteForward 127.0.0.1:23333 127.0.0.1:${LOCAL_PORT}"
echo "      ExitOnForwardFailure yes"
echo "      ServerAliveInterval 30"
echo "      ServerAliveCountMax 3"
echo ""
echo "Then connect with:  ssh ${SSH_HOST}"
echo ""
fi
echo "=========================================="
echo "  Codex Remote Monitor"
echo "=========================================="
echo ""
if [ "$AUTO_MODE" -eq 1 ]; then
echo "The remote Codex monitor supervisor has been restarted."
echo "It will sync Codex CLI states through the background tunnel."
echo ""
else
echo "On the remote server, start the Codex log monitor:"
echo ""
echo "  node ~/.claude/hooks/codex-remote-monitor.js"
echo ""
echo "Or run in background:"
echo ""
echo "  nohup node ~/.claude/hooks/codex-remote-monitor.js > /dev/null 2>&1 &"
echo ""
echo "The monitor will automatically sync Codex CLI states"
echo "back to your local Clawd through the SSH tunnel."
echo "If the tunnel disconnects, it keeps running silently"
echo "and resumes syncing when you reconnect."
echo ""
fi
echo "Done!"
