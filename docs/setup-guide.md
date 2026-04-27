# Setup Guide

[Back to README](../README.md)

## Agent Setup

**Claude Code** — works out of the box. Hooks are auto-registered on launch. Versioned hooks (`PreCompact`, `PostCompact`, `StopFailure`) are registered only when Clawd can positively detect a compatible Claude Code version; if detection fails (common for packaged macOS launches), Clawd falls back to core hooks and removes stale incompatible versioned hooks automatically.

**Codex CLI** — works out of the box. Clawd polls `~/.codex/sessions/` for JSONL logs automatically.

**Copilot CLI** — requires manual hook setup. See [copilot-setup.md](copilot-setup.md) for instructions.

**Kiro CLI** — run `npm run install:kiro-hooks` if you want hooks registered before launching Clawd. Kiro's built-in `kiro_default` agent is not backed by an editable JSON file, so Clawd creates a custom `clawd` agent and re-syncs it from the latest `kiro_default` each time Clawd starts, then appends hooks. Use `kiro-cli --agent clawd` for a new chat, or `/agent swap clawd` inside an existing Kiro session, when you want hooks enabled. On macOS, state-driven animations have been verified; native terminal permission prompts such as `t / y / n` still need to be answered in the terminal.

## Remote SSH (Claude Code & Codex CLI)

<img src="../assets/screenshot-remote-ssh.png" width="560" alt="Remote SSH — permission bubble from Raspberry Pi">

Clawd can sense AI agent activity on remote servers via SSH reverse port forwarding. Hook events and permission requests travel through the SSH tunnel back to your local Clawd.

This bridge is required when you use a local terminal app such as Ghostty to SSH into a server and run `claude` or `codex` there. Clawd can detect local SSH sessions on macOS/Linux and ask once per host, but it cannot infer remote agent activity from the local Ghostty process alone; the server must send state back through remote hooks or the Codex remote monitor.

**Automatic setup while using Ghostty or another terminal:**

1. Start Clawd locally.
2. Open your normal SSH session, for example `ssh user@remote-host` or `gg my-server`.
3. When Clawd sees a new SSH host, approve the remote bridge prompt.

After approval, Clawd remembers the host or `gg` alias and runs the same automatic deploy path in the background: copy hooks, register Claude Code remote hooks, start a managed reverse tunnel, restart the remote Codex monitor, and verify that the remote server can reach local Clawd. You can manage trusted hosts under Settings -> AI Work -> Diagnostics.

**Manual one-command setup:**

```bash
bash scripts/remote-deploy.sh user@remote-host --auto
```

Use this if you want to configure a host before opening a normal terminal session, or if the automatic prompt is disabled.

If `node` is only available after activating a conda environment, pass that environment name:

```bash
bash scripts/remote-deploy.sh user@remote-host --auto --conda-env simulator
```

The deploy script will activate the conda env for Node-dependent setup and save the resolved Node path so the remote Codex monitor keeps using that env's Node later.
After one successful conda-backed setup, later retries can usually use plain `--auto` because the saved remote Node path is reused.

**Manual SSH configuration** (only needed if you do not use `--auto`; add to your local `~/.ssh/config`):

```
Host my-server
    HostName remote-host
    User user
    RemoteForward 127.0.0.1:23333 127.0.0.1:23333
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

**How it works:**
- **Claude Code** — command hooks on the remote server POST state changes to `localhost:23333`, which the SSH tunnel forwards back to your local Clawd. Permission bubbles work too — the HTTP round-trip goes through the tunnel.
- **Codex CLI** — a standalone log monitor (`codex-remote-monitor.js`) polls JSONL files on the remote server and POSTs state changes through the same tunnel. In `--auto` mode, Clawd starts it through `~/.claude/hooks/clawd-remote-monitor.sh`. Codex approval prompts can appear as read-only Clawd notifications, but the actual `y` / `p` / `esc` response must still be typed in the remote terminal.

Remote hooks run in `CLAWD_REMOTE` mode which skips PID collection (remote PIDs are meaningless locally). Terminal focus is not available for remote sessions.

**Ghostty / SSH troubleshooting:**
- Keep Clawd running locally before starting or reconnecting the SSH session.
- On macOS/Linux, keep Remote SSH auto bridge enabled in Settings -> AI Work -> Diagnostics. Approve the first prompt for each host.
- `gg` aliases are detected directly. The deploy step still uses `ssh <alias>`, so make sure goto-ssh's SSH config integration is enabled for aliases that are not already in `~/.ssh/config`.
- If the prompt does not appear, run `bash scripts/remote-deploy.sh user@remote-host --auto` manually; it sets up the background tunnel and monitor for normal Ghostty usage.
- For manual Claude Code setup, run `node ~/.claude/hooks/install.js --remote` on the server.
- For manual Codex CLI setup, keep `node ~/.claude/hooks/codex-remote-monitor.js` running on the server while Codex is active.
- If Clawd still sleeps, run `ssh -v my-server` and confirm the remote forward was accepted. Some servers disable `AllowTcpForwarding`.

Remote monitor controls after `--auto`:

```bash
ssh my-server '~/.claude/hooks/clawd-remote-monitor.sh status'
ssh my-server '~/.claude/hooks/clawd-remote-monitor.sh restart'
ssh my-server '~/.claude/hooks/clawd-remote-monitor.sh stop'
```

The deploy script also prints the exact local `ssh -S ... -O exit` command for stopping the background tunnel.

> Thanks to [@Magic-Bytes](https://github.com/Magic-Bytes) for the original SSH tunneling idea ([#9](https://github.com/rullerzhou-afk/clawd-on-desk/issues/9)).

## WSL (Windows Subsystem for Linux)

If you run Claude Code inside WSL while Clawd runs on the Windows host, hooks can POST directly to `127.0.0.1:23333` — no SSH tunnel needed, because WSL2 shares localhost with Windows by default.

**Setup:**

```bash
# Inside your WSL shell:
mkdir -p ~/.claude/hooks

# Copy hook files from the Windows-side repo (adjust the /mnt/ path to your Clawd location)
cp /mnt/d/animation/hooks/{server-config,json-utils,shared-process,clawd-hook,install}.js ~/.claude/hooks/

# Register hooks in remote mode
node ~/.claude/hooks/install.js --remote
```

If you have SSH enabled in WSL, the one-click deploy script also works:

```bash
# From Windows (Git Bash / PowerShell):
bash scripts/remote-deploy.sh youruser@localhost
```

After setup, start Clawd on Windows and run Claude Code in WSL — Clawd reacts to your sessions automatically. Permission bubbles work too.

> **Note:** WSL2 localhost forwarding requires Windows 10 build 18945+ (enabled by default). If it doesn't work, check that `localhostForwarding=true` is not disabled in `%USERPROFILE%\.wslconfig`.

### WSL Networking & Hook Registration (Alternative Approach)

Clawd runs as a Windows Electron app, while your AI coding agents (Claude Code, Kiro CLI, etc.) may run inside WSL. Hook scripts in WSL POST HTTP requests to `127.0.0.1:23333`, so WSL and Windows must share the same localhost.

- **WSL1** — works out of the box. WSL1 naturally shares localhost with Windows, no extra configuration needed.
- **WSL2** — requires mirrored networking mode. WSL2 has its own network stack by default, so `127.0.0.1` points to WSL itself, not Windows. Enable mirrored mode in `%USERPROFILE%\.wslconfig` (create the file if it doesn't exist), then run `wsl --shutdown` to restart WSL:

```ini
[wsl2]
networkingMode=mirrored
```

**Manually register hooks inside WSL:**

Clawd auto-registers Claude Code hooks to `~/.claude/settings.json` on Windows startup. But if your agent runs in WSL, hooks need to be registered in WSL's own home directory. Run inside WSL:

```bash
git clone https://github.com/rullerzhou-afk/clawd-on-desk.git
cd clawd-on-desk

# Claude Code
node hooks/install.js

# Kiro CLI - registers hooks for all custom agents under ~/.kiro/agents/,
# and auto-creates a clawd agent
node hooks/kiro-install.js

# Gemini CLI
node hooks/gemini-install.js

# opencode
node hooks/opencode-install.js
```

> **Tip:** If the repo is cloned inside WSL (e.g. `~/clawd-on-desk`), hook scripts will automatically use WSL's Node.js path. If the repo is on a Windows drive (e.g. `/mnt/c/...`), make sure `node` is in WSL's `PATH`.

## macOS Notes

- **From source** (`npm start`): works out of the box on Intel and Apple Silicon.
- **DMG installer**: the app is not signed with an Apple Developer certificate, so macOS Gatekeeper will block it. To open:
  - Right-click the app → **Open** → click **Open** in the dialog, or
  - Run `xattr -cr /Applications/Clawd\ on\ Desk.app` in Terminal.

## Linux Notes

- **From source** (`npm start`): `--no-sandbox` is passed automatically to work around chrome-sandbox SUID requirements in dev mode.
- **Packages**: AppImage and `.deb` are available from [GitHub Releases](https://github.com/rullerzhou-afk/clawd-on-desk/releases). After deb install, the app icon appears in GNOME's app menu.
- **Terminal focus**: uses `wmctrl` or `xdotool` (whichever is available). Install one for session terminal jumping to work: `sudo apt install wmctrl` or `sudo apt install xdotool`.
- **Auto-update**: when running from a cloned repo, "Check for Updates" performs `git pull` + `npm install` (if dependencies changed) and restarts the app automatically.
