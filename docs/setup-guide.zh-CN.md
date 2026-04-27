# 配置指南

[返回 README](../README.zh-CN.md)

## Agent 配置说明

**Claude Code** — 开箱即用。Clawd 启动时会自动注册 hooks。只有在确认 Claude Code 版本兼容时才会注册 versioned hooks（`PreCompact`、`PostCompact`、`StopFailure`）；如果版本无法确认，会自动回退到核心 hooks，并清理旧的不兼容条目。

**Codex CLI** — 开箱即用。Clawd 会自动轮询 `~/.codex/sessions/` 下的 JSONL 日志。

**Copilot CLI** — 需要手动配置 hooks。请参考 [copilot-setup.md](copilot-setup.md)。

**Kiro CLI** — 如果你想在启动 Clawd 前先注册 hooks，可先执行 `npm run install:kiro-hooks`。Kiro 内置的 `kiro_default` 不是一个可编辑的 JSON agent，所以 Clawd 会维护一个自定义 `clawd` agent，并在每次启动时先同步最新的 `kiro_default` 配置，再追加 hooks。需要 hooks 时，请用 `kiro-cli --agent clawd` 新开会话，或者在现有会话里执行 `/agent swap clawd`。目前在 macOS 上，状态类动效已验证可用；但涉及终端里 `t / y / n` 的原生权限确认，仍然只能在终端处理。

## 远程 SSH 模式（Claude Code & Codex CLI）

<img src="../assets/screenshot-remote-ssh.png" width="560" alt="远程 SSH — 来自树莓派的权限气泡">

Clawd 支持通过 SSH 反向端口转发感知远程服务器上的 AI Agent 状态。Hook 事件和权限请求通过 SSH 隧道传回本地 Clawd。

如果你在本地用 Ghostty 等终端 SSH 到服务器，并在服务器上运行 `claude` 或 `codex`，就需要这个远程桥接。Clawd 可在 macOS/Linux 上检测本地 SSH 会话并对每台主机询问一次，但它无法仅从本地 Ghostty 进程推断远程 Agent 状态；远程服务器仍需通过 hooks 或 Codex 远程监控脚本把状态传回本地。

**使用 Ghostty 或其他终端时自动配置：**

1. 先在本地启动 Clawd。
2. 打开平常使用的 SSH 会话，例如 `ssh user@远程主机` 或 `gg my-server`。
3. Clawd 发现新的 SSH 主机后，允许远程桥接提示。

允许后，Clawd 会记住这台主机或 `gg` alias，并在后台执行同一套自动部署流程：复制 hooks、以远程模式注册 Claude Code hooks、启动受管理的反向隧道、重启远程 Codex 监控，并验证远程服务器可以连回本地 Clawd。已信任主机可在 Settings -> AI Work -> Diagnostics 中管理。

**手动一键配置：**

```bash
bash scripts/remote-deploy.sh user@远程主机 --auto
```

如果你想在打开普通终端会话前预先配置主机，或关闭了自动提示，可以手动执行这个命令。

如果 `node` 只有在激活 conda 环境后才可用，请传入环境名：

```bash
bash scripts/remote-deploy.sh user@远程主机 --auto --conda-env simulator
```

部署脚本会在需要 Node 的步骤前激活该 conda 环境，并保存解析出的 Node 路径，让远程 Codex 监控之后继续使用这个环境里的 Node。
一次 conda 配置成功后，后续重试通常可以只用普通的 `--auto`，因为脚本会复用远程已保存的 Node 路径。

**手动 SSH 配置**（不使用 `--auto` 时才需要；添加到本地 `~/.ssh/config`）：

```
Host my-server
    HostName 远程主机
    User user
    RemoteForward 127.0.0.1:23333 127.0.0.1:23333
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

**工作原理：**
- **Claude Code** — 远程 hook 将状态 POST 到 `localhost:23333`，SSH 隧道转发回本地 Clawd。权限气泡也能正常弹出——HTTP 往返通过隧道完成。
- **Codex CLI** — 独立的日志监控脚本（`codex-remote-monitor.js`）在远程轮询 JSONL 文件，通过同一隧道 POST 状态变化。`--auto` 模式会通过 `~/.claude/hooks/clawd-remote-monitor.sh` 启动它。Codex 审批提示可以显示为 Clawd 的只读通知，但真正的 `y` / `p` / `esc` 仍需在远程终端里输入。

远程 hook 以 `CLAWD_REMOTE` 模式运行，跳过 PID 采集（远程 PID 在本地无意义）。远程会话不支持终端聚焦。

**Ghostty / SSH 排查：**
- 先在本地启动 Clawd，再启动或重连 SSH 会话。
- 在 macOS/Linux 上，确认 Settings -> AI Work -> Diagnostics 中的 Remote SSH auto bridge 已启用。每台主机第一次出现时需要允许提示。
- `gg` alias 会被直接检测。部署步骤仍会执行 `ssh <alias>`，所以如果 alias 不在 `~/.ssh/config` 中，请确认 goto-ssh 的 SSH config 集成已启用。
- 如果没有出现提示，请手动执行 `bash scripts/remote-deploy.sh user@远程主机 --auto`；它会为普通 Ghostty 使用方式配置后台隧道和监控。
- 手动配置 Claude Code 时，需要在服务器上执行 `node ~/.claude/hooks/install.js --remote`。
- 手动配置 Codex CLI 时，需要在服务器上持续运行 `node ~/.claude/hooks/codex-remote-monitor.js`。
- 如果 Clawd 仍然睡眠，用 `ssh -v my-server` 确认 remote forward 已被接受。有些服务器会禁用 `AllowTcpForwarding`。

`--auto` 之后可用这些命令管理远程监控：

```bash
ssh my-server '~/.claude/hooks/clawd-remote-monitor.sh status'
ssh my-server '~/.claude/hooks/clawd-remote-monitor.sh restart'
ssh my-server '~/.claude/hooks/clawd-remote-monitor.sh stop'
```

部署脚本也会打印用于停止本地后台隧道的精确 `ssh -S ... -O exit` 命令。

> 感谢 [@Magic-Bytes](https://github.com/Magic-Bytes) 提出 SSH 隧道方案（[#9](https://github.com/rullerzhou-afk/clawd-on-desk/issues/9)）。

## WSL（Windows Subsystem for Linux）

如果你在 WSL 里跑 Claude Code，而 Clawd 跑在 Windows 宿主上，hook 可以直接 POST 到 `127.0.0.1:23333` —— 不需要 SSH 隧道，因为 WSL2 默认与 Windows 共享 localhost。

**配置步骤：**

```bash
# 在 WSL shell 中执行：
mkdir -p ~/.claude/hooks

# 从 Windows 侧的 Clawd 仓库复制 hook 文件（按实际路径调整 /mnt/ 前缀）
cp /mnt/d/animation/hooks/{server-config,json-utils,shared-process,clawd-hook,install}.js ~/.claude/hooks/

# 以远程模式注册 hooks
node ~/.claude/hooks/install.js --remote
```

如果你的 WSL 里开启了 SSH 服务，也可以用一键部署脚本：

```bash
# 从 Windows 侧执行（Git Bash / PowerShell）：
bash scripts/remote-deploy.sh 你的用户名@localhost
```

配置完成后，在 Windows 上启动 Clawd，在 WSL 里运行 Claude Code —— Clawd 会自动感知你的会话。权限气泡也能正常弹出。

> **注意：** WSL2 的 localhost 转发需要 Windows 10 build 18945+（默认开启）。如果不生效，检查 `%USERPROFILE%\.wslconfig` 中 `localhostForwarding=true` 是否被禁用。

### WSL 网络与 Hook 注册（替代方案）

Clawd 跑在 Windows 的 Electron 应用里，而你的 AI 编程助手（Claude Code、Kiro CLI 等）可能跑在 WSL 里。WSL 中的 hook 脚本会把 HTTP 请求发到 `127.0.0.1:23333`，所以 WSL 和 Windows 必须共享同一个 localhost。

- **WSL1** — 开箱即用。WSL1 天然与 Windows 共享 localhost，无需额外配置。
- **WSL2** — 需要镜像网络模式。WSL2 默认拥有独立网络栈，`127.0.0.1` 指向 WSL 自身而不是 Windows。请在 `%USERPROFILE%\.wslconfig` 中启用镜像模式（文件不存在就新建），然后执行 `wsl --shutdown` 重启 WSL：

```ini
[wsl2]
networkingMode=mirrored
```

**在 WSL 中手动注册 hooks：**

Clawd 在 Windows 启动时会自动注册 Claude Code hooks 到 `~/.claude/settings.json`。但如果你的 Agent 跑在 WSL 里，hooks 需要注册到 WSL 自己的 home 目录。请在 WSL 中执行：

```bash
git clone https://github.com/rullerzhou-afk/clawd-on-desk.git
cd clawd-on-desk

# Claude Code
node hooks/install.js

# Kiro CLI - 会将 hooks 注册到 ~/.kiro/agents/ 下所有自定义 agent，
# 并自动创建一个 clawd agent
node hooks/kiro-install.js

# Gemini CLI
node hooks/gemini-install.js

# opencode
node hooks/opencode-install.js
```

> 提示：如果仓库克隆在 WSL 内（如 `~/clawd-on-desk`），hook 脚本会自动使用 WSL 的 Node.js 路径。如果仓库放在 Windows 盘里（如 `/mnt/c/...`），请确保 WSL 的 PATH 中有 `node`。

## macOS 说明

- **源码运行**（`npm start`）：Intel 和 Apple Silicon 均可直接使用。
- **DMG 安装包**：未签名 Apple 开发者证书，macOS Gatekeeper 会拦截。解决方法：
  - 右键点击应用 → **打开** → 在弹窗中点击 **打开**，或
  - 在终端运行 `xattr -cr /Applications/Clawd\ on\ Desk.app`

## Linux 说明

- **源码运行**（`npm start`）：自动传入 `--no-sandbox` 参数，跳过 chrome-sandbox SUID 校验。
- **安装包**：AppImage 和 `.deb` 可从 [GitHub Releases](https://github.com/rullerzhou-afk/clawd-on-desk/releases) 下载。deb 安装后应用图标会出现在 GNOME 应用菜单。
- **终端聚焦**：依赖 `wmctrl` 或 `xdotool`（有一个就行）。安装：`sudo apt install wmctrl` 或 `sudo apt install xdotool`。
- **自动更新**：源码运行时，"检查更新"会执行 `git pull` + `npm install`（依赖有变化时）并自动重启。
