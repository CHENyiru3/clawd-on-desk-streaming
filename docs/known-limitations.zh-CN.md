# 已知限制

[返回 README](../README.zh-CN.md)

| 限制 | 说明 |
|------|------|
| **Codex CLI：无法跳转终端** | Codex 通过 JSONL 日志轮询，日志中不含终端 PID，点击桌宠无法跳转到 Codex 终端。Claude Code 和 Copilot CLI 正常。 |
| **Codex CLI：权限通知是只读的** | Clawd 可以在日志轮询检测到 Codex 审批等待时显示通知，远程 SSH 监控部署后也包括远程会话。但 Codex 没有暴露阻塞式审批 API，所以允许或拒绝仍需在 Codex 终端里输入 `y`、`p` 或 `esc`。 |
| **Codex CLI：Windows hooks 禁用** | Codex 在 Windows 上硬编码禁用了 hooks，因此走日志轮询，延迟约 1.5 秒（hook 方式几乎无延迟）。 |
| **Copilot CLI：需手动配置 hooks** | Copilot 需要手动创建 `~/.copilot/hooks/hooks.json`。Claude Code 和 Codex 开箱即用。 |
| **Copilot CLI：无权限气泡** | Copilot 的 `preToolUse` 只支持拒绝，无法做完整的允许/拒绝审批流。权限气泡仅支持 Claude Code。 |
| **Gemini CLI：无 working 状态** | Gemini 的 session JSON 只记录已完成消息，不包含进行中的工具执行。桌宠会从 thinking 直接跳到 happy/error，工作中没有打字动画。 |
| **Gemini CLI：无权限气泡** | Gemini 在终端内处理工具审批。文件轮询无法拦截或展示审批请求。 |
| **Gemini CLI：无法跳转终端** | Session JSON 不携带终端 PID，和 Codex 一样无法做终端聚焦。 |
| **Gemini CLI：轮询延迟** | 约 1.5 秒轮询间隔，另加 4 秒延迟窗口用于批量处理工具完成信号，明显慢于 hook 驱动的 agent。 |
| **远程 SSH：首次需要授权且依赖 SSH 权限** | 在 macOS/Linux 上，Clawd 可以检测本地 SSH 会话（包括 `gg`/goto-ssh alias），并对每台主机询问一次，然后执行自动桥接配置。远程主机仍需可用的 SSH 登录、允许复制 hooks，并支持服务端端口转发。`gg` alias 在部署时必须能被 `ssh <alias>` 访问。若检测被关闭或不可用，请手动执行 `bash scripts/remote-deploy.sh user@host --auto`。 |
| **远程 SSH：无法跳转终端** | 远程会话会跳过 PID 采集，因为服务器 PID 对本地桌面没有意义。Sessions 菜单可以显示远程主机，但点击无法聚焦到具体远程终端会话。 |
| **Kiro CLI：无法区分会话** | Kiro CLI stdin JSON 不含 session_id，所有 Kiro 会话会被合并为单个追踪会话。 |
| **Kiro CLI：无 SessionEnd 事件** | Kiro CLI 没有 SessionEnd 事件，Clawd 无法检测 Kiro 会话结束。 |
| **Kiro CLI：无 subagent 检测** | Kiro CLI 没有 subagent 事件，不会触发杂耍/指挥动画。 |
| **Kiro CLI：终端权限确认仍在终端处理** | macOS 上 Kiro 的状态 hooks 已验证可用；但当 Kiro 显示 `t / y / n` 这类原生权限确认时，当前仍需在终端里处理，Clawd 不接管这类确认。 |
| **opencode：子会话菜单短暂污染** | opencode 通过 `task` 工具分派并行子代理时，子会话会在 Sessions 子菜单里短暂出现（5-8 秒），完成后自动清理。纯视觉问题，不影响建筑动画。 |
| **opencode：终端聚焦锚定启动窗口** | Plugin 跑在 opencode 进程内，`source_pid` 指向启动 opencode 的那个终端。如果你用 `opencode attach` 从另一个窗口接入，点击桌宠只会聚焦到最初的启动窗口。 |
| **macOS/Linux 安装包自动更新** | DMG/AppImage/deb 安装包无法自动更新——使用 `git clone` + `npm start` 可通过 `git pull` 自动更新，或从 GitHub Releases 手动下载。 |
| **Electron 主进程无自动化测试** | 单元测试覆盖了 agent 配置和日志轮询，但状态机、窗口管理、托盘等 Electron 逻辑暂无自动化测试。 |
| **Claude Code：桌宠未运行时工具被自动拒绝** | 桌宠 HTTP 服务未运行时，Clawd 注册的 `PermissionRequest` hook 因 `ECONNREFUSED` 失败，Claude Code 当前会把这种失败当作"用户拒绝"，影响 `Edit`、`Write`、`Bash` 等所有需要权限的工具。这违反 CC 自己的 hooks 文档（声明 HTTP hook 失败应 non-blocking） —— 见 [anthropics/claude-code#46193](https://github.com/anthropics/claude-code/issues/46193)。绕过：保持桌宠运行（推荐），或临时把 `~/.claude/settings.json` 里的 `PermissionRequest` key 重命名以禁用该 hook。 |
