"use strict";

// ── Settings panel renderer ──
//
// Strict unidirectional flow (plan §4.2):
//
//   1. UI clicks → settingsAPI.update(key, value) → main → controller
//   2. Controller commits → broadcasts settings-changed
//   3. settingsAPI.onChanged fires → renderUI() rebuilds the affected row(s)
//
// We never optimistically toggle a switch in the click handler. The visual
// state always reflects what the store says — period. Failures show a toast
// and the switch stays in its previous position because the store was never
// committed.

// ── i18n (mirror src/i18n.js — bubbles can't require electron modules) ──
const STRINGS = {
  en: {
    settingsTitle: "Settings",
    settingsSubtitle: "Configure how Clawd behaves on your desktop.",
    sidebarGeneral: "General",
    sidebarAgents: "Agents",
    sidebarTheme: "Theme",
    sidebarAnimMap: "Animation Map",
    sidebarAnimOverrides: "Animation Overrides",
    sidebarShortcuts: "Shortcuts",
    sidebarAbout: "About",
    sidebarSoon: "Soon",
    sectionAppearance: "Appearance",
    sectionTranslation: "Translation",
    sectionDiagnostics: "Diagnostics",
    sectionGlobalActivity: "Global Activity",
    sectionTimeCheckins: "Time Check-ins",
    sectionProviderUsage: "Provider Usage HUD",
    sectionStartup: "Startup",
    sectionBubbles: "Bubbles",
    agentsTitle: "Agents",
    agentsSubtitle: "Turn tracking on or off per agent. Disabled agents stop log monitors and drop hook events at the HTTP boundary — they won't drive the pet, show permission bubbles, or keep sessions.",
    agentsEmpty: "No agents registered.",
    sectionAgentLauncher: "CLI agent launcher",
    agentLauncherSubtitle:
      "Open the system terminal and run a CLI agent (default: hermes — same idea as codex or claude). Command must be a single line without shell metacharacters. Empty working directory uses your home folder.",
    rowAgentLauncherEnabled: "Enable launcher",
    rowAgentLauncherEnabledDesc:
      "Shows Open CLI agent in the tray and pet menu. Optional gestures below only apply when this is on.",
    rowAgentLauncherCommand: "Command",
    rowAgentLauncherCommandDesc: "Executable or path plus args, one line (max 256 characters).",
    rowAgentLauncherCwd: "Working directory",
    rowAgentLauncherCwdDesc: "Optional. Leave blank for home. Invalid paths fall back to home at launch.",
    rowAgentLauncherTrigger: "Extra triggers",
    triggerMenuOnly: "Menus only",
    triggerTripleClick: "Triple-click on idle pet (opens CLI)",
    triggerFocusFallback: "When pet click has no session to focus, open CLI instead",
    triggerTripleAndFocus: "Triple-click + focus-or-open fallback",
    sectionHermesChat: "Hermes Chat",
    hermesChatSubtitle:
      "Configure how Clawd talks to Hermes via `hermes chat -q`. The command and args are passed directly; working directory is optional.",
    rowHermesChatCommand: "Command",
    rowHermesChatCommandDesc: "Hermes executable name or full path.",
    rowHermesChatArgs: "Extra args",
    rowHermesChatArgsDesc: "Additional arguments passed after -Q (one per line, parsed on save).",
    rowHermesChatCwd: "Working directory",
    rowHermesChatCwdDesc: "Optional. Leave blank to inherit Clawd's working directory.",
    rowHermesChatTimeout: "Timeout (seconds)",
    rowHermesChatTimeoutDesc: "Max wait time per message before giving up.",
    actionTestHermesChat: "Test Connection",
    actionClearHermesHistory: "Clear History",
    toastHermesTestOk: "Hermes responded successfully.",
    toastHermesTestFailed: "Hermes test failed: {msg}",
    toastHermesHistoryCleared: "Chat history cleared.",
    eventSourceHook: "Hook",
    eventSourceLogPoll: "Log poll",
    eventSourcePlugin: "Plugin",
    badgePermissionBubble: "Permission bubble",
    rowAgentPermissions: "Show pop-up bubbles",
    rowAgentPermissionsDesc: "Turn off to let this agent handle prompts in its own terminal instead of showing a Clawd bubble.",
    rowLanguage: "Language",
    rowLanguageDesc: "Interface language for menus and bubbles.",
    rowSound: "Sound effects",
    rowSoundDesc: "Play a chime when Clawd finishes a task or asks for input.",
    rowTranslateApiKey: "MiniMax API key",
    rowTranslateApiKeyDesc: "Used for Ctrl+Shift+T clipboard translation and translator diagnostics.",
    rowTranslatorBackend: "Translator backend",
    rowTranslatorBackendDesc: "MiniMax",
    rowTranslatorStatus: "Translator status",
    rowTranslatorStatusConfigured: "Configured",
    rowTranslatorStatusMissing: "Not configured",
    rowTranslatorHealthUnknown: "Health unknown",
    rowTranslatorHealthOk: "Health OK",
    rowTranslatorHealthError: "Health error",
    rowTranslatorLastErrorNone: "No recent errors.",
    rowTerminalStatus: "Terminal action check",
    rowTerminalStatusDesc: "Verify focus and position behavior for tracked terminal windows.",
    rowTerminalStatusUnsupported: "This check is only available on macOS.",
    rowTerminalStatusUnknown: "No checks run yet.",
    rowTerminalStatusOk: "Last check succeeded.",
    rowTerminalStatusError: "Last check failed.",
    actionTestTranslator: "Test Translator",
    actionShowBubbleLoading: "Show Bubble: Loading",
    actionShowBubbleSuccess: "Show Bubble: Success",
    actionShowBubbleError: "Show Bubble: Error",
    actionTestTerminalFocus: "Test Terminal Focus & Position",
    rowProviderUsageHudEnabled: "Show usage HUD",
    rowProviderUsageHudEnabledDesc: "Display provider usage bars on the right side of Clawd.",
    rowProviderUsageRefreshEnabled: "Background refresh",
    rowProviderUsageRefreshEnabledDesc: "Refresh provider usage every 10 minutes. MiniMax checks can take up to 5 minutes.",
    rowProviderUsageMiniMaxEnabled: "MiniMax best-effort",
    rowProviderUsageMiniMaxEnabledDesc: "Keep a MiniMax slot in the HUD even when live usage is unavailable or Hermes cannot initialize.",
    rowProviderUsageStaleAfter: "Stale threshold (minutes)",
    rowProviderUsageStaleAfterDesc: "How long a usage snapshot stays fresh before it is treated as stale.",
    rowProviderUsageStatus: "Provider usage status",
    rowProviderUsageStatusIdle: "No refreshes have run yet.",
    rowProviderUsageStatusOk: "Usage HUD is updating normally.",
    rowProviderUsageStatusPartial: "Some providers are unavailable.",
    rowProviderUsageStatusFallback: "Using fallback summary logic.",
    rowProviderUsageStatusError: "Provider refresh failed.",
    actionRefreshProviderUsageNow: "Refresh Provider Usage Now",
    actionPreviewProviderUsageHud: "Preview Provider Usage HUD",
    toastActionOk: "Done.",
    rowOpenAtLogin: "Open at login",
    rowOpenAtLoginDesc: "Start Clawd automatically when you log in.",
    rowManageClaudeHooks: "Manage Claude hooks automatically",
    rowManageClaudeHooksDesc: "Sync Claude hooks at startup and restore them if ~/.claude/settings.json gets overwritten.",
    rowManageClaudeHooksOffNote: "Turning this off stops future automatic management only. Existing Claude hooks stay installed unless you disconnect them.",
    actionDisconnectClaudeHooks: "Disconnect",
    rowStartWithClaude: "Start with Claude Code",
    rowStartWithClaudeDesc: "Auto-launch Clawd whenever a Claude Code session starts.",
    rowStartWithClaudeDisabledDesc: "Requires automatic Claude hook management. Port changes and overwritten settings will not be reconciled while management is off.",
    rowBubbleFollow: "Bubbles follow Clawd",
    rowBubbleFollowDesc: "Place permission and update bubbles next to the pet instead of the screen corner.",
    rowHideBubbles: "Hide all bubbles",
    rowHideBubblesDesc: "Suppress permission, notification, and update bubbles entirely.",
    rowShowSessionId: "Show session ID",
    rowShowSessionIdDesc: "Append the short session ID to bubble headers and the Sessions menu.",
    rowMacTypingAwareness: "Typing awareness (macOS)",
    rowMacTypingAwarenessDesc: "Let Clawd react while you type anywhere on your Mac. Requires Input Monitoring.",
    rowMacTypingAwarenessUnsupported: "This feature is only available on macOS.",
    rowMacTypingStatusGranted: "Permission granted.",
    rowMacTypingStatusDenied: "Input Monitoring not granted yet.",
    rowMacTypingStatusUnavailable: "Permission status unavailable on this system.",
    rowMacTypingStatusError: "Permission check failed. Try reopening System Settings.",
    actionOpenMacTypingPrivacy: "Open Settings",
    rowGlobalActivity: "Enable global activity (macOS)",
    rowGlobalActivityDesc: "Let Clawd react to app switches, clipboard activity, reading, and media beyond agent sessions.",
    rowGlobalActivityUnsupported: "This feature is only available on macOS.",
    rowGlobalActivityStatus: "Global activity status",
    rowGlobalActivityStatusIdle: "No global rule active.",
    rowGlobalActivityStatusActive: "Active rule: {rule}",
    rowGlobalActivityLastErrorNone: "No recent collector errors.",
    rowGlobalRuleClipboard: "Clipboard reaction",
    rowGlobalRuleNotification: "Notification reaction",
    rowGlobalRulePresence: "Presence wake",
    rowGlobalRuleMedia: "Media playback reaction",
    rowGlobalRuleBrowser: "Browser reading reaction",
    rowGlobalCollectorFrontmost: "Frontmost app",
    rowGlobalCollectorClipboard: "Clipboard",
    rowGlobalCollectorNotification: "Notifications",
    rowGlobalCollectorMedia: "Media",
    rowGlobalCollectorBrowser: "Browser",
    actionTestGlobalClipboard: "Test Clipboard",
    actionTestGlobalReading: "Test Reading",
    actionTestGlobalListening: "Test Listening",
    rowTimeCheckinEnabled: "Enable scheduled check-ins",
    rowTimeCheckinEnabledDesc: "Generate a warm time-aware check-in every 2 hours, using the past hour of sanitized clipboard history as the main evidence.",
    rowTimeCheckinSchedule: "Schedule",
    rowTimeCheckinScheduleDesc: "Every 2 hours, with key checkpoints at 10:00 AM, 5:00 PM, and 11:00 PM.",
    rowTimeCheckinWindow: "Clipboard window (minutes)",
    rowTimeCheckinWindowDesc: "How much recent clipboard history to summarize for each check-in.",
    rowTimeCheckinGeneratorCwd: "Generator working directory",
    rowTimeCheckinGeneratorCwdDesc: "The folder used when running the resumed Hermes session for tone continuity.",
    rowTimeCheckinGeneratorCommand: "Generator command",
    rowTimeCheckinGeneratorCommandDesc: "Executable used for scheduled check-ins.",
    rowTimeCheckinGeneratorArgs: "Generator args",
    rowTimeCheckinGeneratorArgsDesc: "Arguments passed to the generator command.",
    rowTimeCheckinGeneratorTimeout: "Generator timeout (ms)",
    rowTimeCheckinGeneratorTimeoutDesc: "How long Clawd waits before falling back to a local message.",
    rowTimeCheckinStatus: "Check-in status",
    rowTimeCheckinStatusIdle: "No check-ins have run yet.",
    rowTimeCheckinStatusOk: "Last check-in completed.",
    rowTimeCheckinStatusCleaned: "Last check-in was cleaned before display.",
    rowTimeCheckinStatusFallback: "Last check-in used a local fallback.",
    rowTimeCheckinStatusError: "Last check-in used a fallback or failed.",
    actionRunTimeCheckinNow: "Run Time Check-in Now",
    actionPreviewTimeCheckinContext: "Preview Sanitized Context",
    placeholderTitle: "Coming soon",
    placeholderDesc: "This panel will land in a future Clawd release. The plan lives in docs/plan-settings-panel.md.",
    toastSaveFailed: "Couldn't save: ",
    langEnglish: "English",
    langChinese: "中文",
    themeTitle: "Theme",
    themeSubtitle: "Pick a theme for Clawd. Cards show built-in + capability badges so you can see tracked/static/mini differences before switching.",
    themeEmpty: "No themes available.",
    themeBadgeBuiltin: "Built-in",
    themeBadgeActive: "Active",
    themeCapabilityTracked: "Tracked idle",
    themeCapabilityAnimated: "Animated idle",
    themeCapabilityStatic: "Static theme",
    themeCapabilityMini: "Mini",
    themeCapabilityDirectSleep: "Direct sleep",
    themeCapabilityNoReactions: "No reactions",
    themeActiveIndicator: "\u2713 Active",
    themeThumbMissing: "\u{1F3AD}",
    themeDeleteLabel: "Delete theme",
    themeVariantStripLabel: "Variants",
    toastThemeDeleted: "Theme deleted.",
    toastThemeDeleteFailed: "Couldn't delete theme: ",
    animMapTitle: "Animation Map",
    animMapSubtitle: "Silence individual interrupt animations. Events still fire — Clawd just skips the visual and sound for the selected states.",
    animMapSemanticsNote: "Disable = no visual + no sound. Permission bubbles, sessions, and terminal focus still work.",
    animMapResetAll: "Reset all",
    animMapAttentionLabel: "Task complete (happy)",
    animMapAttentionDesc: "The happy bounce when the agent finishes a turn (Stop / PostCompact).",
    animMapErrorLabel: "Error flash",
    animMapErrorDesc: "The shake animation when a tool call fails.",
    animMapSweepingLabel: "Context sweep",
    animMapSweepingDesc: "The broom animation during PreCompact / context clearing.",
    animMapNotificationLabel: "Notification",
    animMapNotificationDesc: "The bell animation for permission requests and elicitations.",
    animMapCarryingLabel: "Worktree carry",
    animMapCarryingDesc: "The carrying animation when a worktree is created.",
    toastAnimMapResetOk: "Animation overrides cleared.",
    animOverridesTitle: "Animation Overrides",
    animOverridesSubtitle: "Swap per-card files and adjust fade / return timing for the current theme.",
    animOverridesCurrentTheme: "Current theme",
    animOverridesOpenThemeTab: "Open Theme tab",
    animOverridesOpenAssets: "Open assets folder",
    animOverridesResetAll: "Reset all to default",
    animOverridesChangeFile: "Change file",
    animOverridesPreview: "Preview once",
    animOverridesReset: "Reset slot",
    animOverridesFade: "Fade",
    animOverridesFadeIn: "In",
    animOverridesFadeOut: "Out",
    animOverridesSaveFade: "Save fade",
    animOverridesDuration: "Auto-return",
    animOverridesSaveDuration: "Save timing",
    animOverridesContinuousHint: "Continuous state: no auto-return editor here.",
    animOverridesAssetCycle: "Asset cycle",
    animOverridesSuggestedTiming: "Suggested timing",
    animOverridesTimingEstimated: "estimated",
    animOverridesTimingFallback: "theme default",
    animOverridesTimingUnavailable: "unavailable",
    animOverridesDisplayHintWarning: "displayHintMap can override this slot at runtime.",
    animOverridesFallbackHint: "This slot currently falls back to {state}.",
    animOverridesOverriddenTooltip: "Modified from default",
    animOverridesUseOwnFile: "Use own file",
    animOverridesDurationIdle: "Pool hold",
    animOverridesSectionIdle: "Idle",
    animOverridesSectionWork: "Work",
    animOverridesSectionInterrupts: "Interrupts",
    animOverridesSectionSleep: "Sleep",
    animOverridesSectionMini: "Mini Mode",
    animOverridesSectionIdleTracked: "Cursor-follow idle",
    animOverridesSectionIdleAnimated: "Idle random pool",
    animOverridesSectionIdleStatic: "Single static idle",
    animOverridesSectionSleepFull: "Full sleep sequence",
    animOverridesSectionSleepDirect: "Direct sleep only",
    animOverridesExpandRow: "Expand",
    animOverridesModalTitle: "Choose an asset file",
    animOverridesModalSubtitle: "Add files to the current theme assets folder, then refresh the list here.",
    animOverridesModalEmpty: "No supported assets found in this theme yet.",
    animOverridesModalSelected: "Selected file",
    animOverridesModalUse: "Use this file",
    animOverridesModalCancel: "Cancel",
    animOverridesRefresh: "Refresh list",
  },
  zh: {
    settingsTitle: "设置",
    settingsSubtitle: "配置 Clawd 在桌面上的行为。",
    sidebarGeneral: "通用",
    sidebarAgents: "Agent 管理",
    sidebarTheme: "主题",
    sidebarAnimMap: "动画映射",
    sidebarAnimOverrides: "动画替换",
    sidebarShortcuts: "快捷键",
    sidebarAbout: "关于",
    sidebarSoon: "待推出",
    sectionAppearance: "外观",
    sectionTranslation: "翻译",
    sectionDiagnostics: "诊断",
    sectionGlobalActivity: "全局活动",
    sectionTimeCheckins: "整点问候",
    sectionProviderUsage: "用量状态条",
    sectionStartup: "启动",
    sectionBubbles: "气泡",
    agentsTitle: "Agent 管理",
    agentsSubtitle: "按 agent 类型开关追踪。关闭后会停掉日志监视器、在 HTTP 入口丢弃 hook 事件——不会再驱动桌宠、不弹权限气泡、不记会话。",
    agentsEmpty: "没有已注册的 agent。",
    sectionAgentLauncher: "CLI 代理启动器",
    agentLauncherSubtitle:
      "在系统终端里运行 CLI 代理（默认 hermes，与 codex、claude 同类）。命令须单行、无 shell 元字符；工作目录留空用主目录。",
    rowAgentLauncherEnabled: "启用启动器",
    rowAgentLauncherEnabledDesc: "在托盘与桌宠菜单显示「打开 CLI 代理」。下面手势仅在开启时生效。",
    rowAgentLauncherCommand: "命令",
    rowAgentLauncherCommandDesc: "可执行文件或路径与参数，一行（最多 256 字符）。",
    rowAgentLauncherCwd: "工作目录",
    rowAgentLauncherCwdDesc: "可选；留空用主目录。若路径无效，启动时会回退到主目录。",
    rowAgentLauncherTrigger: "额外触发",
    triggerMenuOnly: "仅菜单",
    triggerTripleClick: "待机时三连击桌宠（打开 CLI）",
    triggerFocusFallback: "点击聚焦无会话时改为打开 CLI",
    triggerTripleAndFocus: "三连击 + 无会话时打开 CLI",
    sectionHermesChat: "Hermes 对话",
    hermesChatSubtitle:
      "配置 Clawd 如何通过 `hermes chat -q` 与 Hermes 通信。命令和参数直接传递；工作目录可选。",
    rowHermesChatCommand: "命令",
    rowHermesChatCommandDesc: "Hermes 可执行文件名或完整路径。",
    rowHermesChatArgs: "额外参数",
    rowHermesChatArgsDesc: "-Q 之后附加的参数（每行一个，保存时解析）。",
    rowHermesChatCwd: "工作目录",
    rowHermesChatCwdDesc: "可选；留空继承 Clawd 的工作目录。",
    rowHermesChatTimeout: "超时（秒）",
    rowHermesChatTimeoutDesc: "每次消息最大等待时间，超时则放弃。",
    actionTestHermesChat: "测试连接",
    actionClearHermesHistory: "清除历史",
    toastHermesTestOk: "Hermes 响应成功。",
    toastHermesTestFailed: "Hermes 测试失败：{msg}",
    toastHermesHistoryCleared: "对话历史已清除。",
    eventSourceHook: "Hook",
    eventSourceLogPoll: "日志轮询",
    eventSourcePlugin: "插件",
    badgePermissionBubble: "权限气泡",
    rowAgentPermissions: "显示弹窗",
    rowAgentPermissionsDesc: "关闭后让该 agent 在自己的终端里处理提示，不再弹 Clawd 气泡。",
    rowLanguage: "语言",
    rowLanguageDesc: "菜单和气泡的界面语言。",
    rowSound: "音效",
    rowSoundDesc: "Clawd 完成任务或需要输入时播放提示音。",
    rowTranslateApiKey: "MiniMax API key",
    rowTranslateApiKeyDesc: "用于 Ctrl+Shift+T 剪贴板翻译和翻译诊断。",
    rowTranslatorBackend: "翻译后端",
    rowTranslatorBackendDesc: "MiniMax",
    rowTranslatorStatus: "翻译状态",
    rowTranslatorStatusConfigured: "已配置",
    rowTranslatorStatusMissing: "未配置",
    rowTranslatorHealthUnknown: "健康状态未知",
    rowTranslatorHealthOk: "健康状态正常",
    rowTranslatorHealthError: "健康状态异常",
    rowTranslatorLastErrorNone: "最近没有错误。",
    rowTerminalStatus: "终端动作检查",
    rowTerminalStatusDesc: "检查已追踪终端窗口的聚焦和定位行为。",
    rowTerminalStatusUnsupported: "此检查目前仅在 macOS 上可用。",
    rowTerminalStatusUnknown: "尚未运行检查。",
    rowTerminalStatusOk: "最近一次检查成功。",
    rowTerminalStatusError: "最近一次检查失败。",
    actionTestTranslator: "测试翻译",
    actionShowBubbleLoading: "显示气泡：加载中",
    actionShowBubbleSuccess: "显示气泡：成功",
    actionShowBubbleError: "显示气泡：错误",
    actionTestTerminalFocus: "测试终端聚焦和定位",
    rowProviderUsageHudEnabled: "显示用量条",
    rowProviderUsageHudEnabledDesc: "在 Clawd 右侧显示 provider 用量条。",
    rowProviderUsageRefreshEnabled: "后台刷新",
    rowProviderUsageRefreshEnabledDesc: "每 10 分钟刷新一次 provider 用量。MiniMax 检查最多可能需要 5 分钟。",
    rowProviderUsageMiniMaxEnabled: "MiniMax 尽力而为",
    rowProviderUsageMiniMaxEnabledDesc: "即使暂时拿不到实时用量，或 Hermes 无法初始化，也保留 MiniMax 一栏。",
    rowProviderUsageStaleAfter: "过期阈值（分钟）",
    rowProviderUsageStaleAfterDesc: "超过这个时间后，用量快照会被视为过期。",
    rowProviderUsageStatus: "Provider 用量状态",
    rowProviderUsageStatusIdle: "还没有运行刷新。",
    rowProviderUsageStatusOk: "用量条更新正常。",
    rowProviderUsageStatusPartial: "部分 provider 暂时不可用。",
    rowProviderUsageStatusFallback: "当前使用本地回退摘要。",
    rowProviderUsageStatusError: "Provider 刷新失败。",
    actionRefreshProviderUsageNow: "立即刷新用量",
    actionPreviewProviderUsageHud: "预览用量条",
    toastActionOk: "已完成。",
    rowOpenAtLogin: "开机自启",
    rowOpenAtLoginDesc: "登录系统时自动启动 Clawd。",
    rowManageClaudeHooks: "自动管理 Claude hooks",
    rowManageClaudeHooksDesc: "启动时同步 Claude hooks，并在 `~/.claude/settings.json` 被其他工具覆盖后自动补回。",
    rowManageClaudeHooksOffNote: "关闭后只会停止后续自动管理。当前已安装的 Claude hooks 会保留，除非你主动断开。",
    actionDisconnectClaudeHooks: "断开",
    rowStartWithClaude: "随 Claude Code 启动",
    rowStartWithClaudeDesc: "Claude Code 会话开始时自动拉起 Clawd。",
    rowStartWithClaudeDisabledDesc: "需要先开启 Claude hooks 自动管理。关闭期间，端口变化和外部覆盖都不会被自动修补。",
    rowBubbleFollow: "气泡跟随 Clawd",
    rowBubbleFollowDesc: "把权限气泡和更新气泡放在桌宠旁边，而不是屏幕角落。",
    rowHideBubbles: "隐藏所有气泡",
    rowHideBubblesDesc: "完全屏蔽权限、通知和更新气泡。",
    rowShowSessionId: "显示会话 ID",
    rowShowSessionIdDesc: "在气泡标题和会话菜单后追加短会话 ID。",
    rowMacTypingAwareness: "打字感知（macOS）",
    rowMacTypingAwarenessDesc: "让 Clawd 在你输入时做出反应。需要“输入监控”权限。",
    rowMacTypingAwarenessUnsupported: "此功能仅在 macOS 上可用。",
    rowMacTypingStatusGranted: "权限已授予。",
    rowMacTypingStatusDenied: "尚未授予“输入监控”权限。",
    rowMacTypingStatusUnavailable: "当前系统无法读取权限状态。",
    rowMacTypingStatusError: "权限检查失败，请尝试重新打开系统设置。",
    actionOpenMacTypingPrivacy: "打开设置",
    rowGlobalActivity: "启用全局活动（macOS）",
    rowGlobalActivityDesc: "让 Clawd 能对应用切换、剪贴板、阅读和媒体播放等通用桌面行为作出反应，而不只是在 agent 会话中活动。",
    rowGlobalActivityUnsupported: "该功能目前仅在 macOS 上可用。",
    rowGlobalActivityStatus: "全局活动状态",
    rowGlobalActivityStatusIdle: "当前没有激活的全局规则。",
    rowGlobalActivityStatusActive: "当前规则：{rule}",
    rowGlobalActivityLastErrorNone: "最近没有采集器错误。",
    rowGlobalRuleClipboard: "剪贴板反应",
    rowGlobalRuleNotification: "通知反应",
    rowGlobalRulePresence: "存在感唤醒",
    rowGlobalRuleMedia: "媒体播放反应",
    rowGlobalRuleBrowser: "浏览器阅读反应",
    rowGlobalCollectorFrontmost: "前台应用",
    rowGlobalCollectorClipboard: "剪贴板",
    rowGlobalCollectorNotification: "通知",
    rowGlobalCollectorMedia: "媒体",
    rowGlobalCollectorBrowser: "浏览器",
    actionTestGlobalClipboard: "测试剪贴板",
    actionTestGlobalReading: "测试阅读",
    actionTestGlobalListening: "测试聆听",
    rowTimeCheckinEnabled: "启用定时问候",
    rowTimeCheckinEnabledDesc: "每 2 小时生成一条带时间感的温和问候，并以前 1 小时的脱敏剪贴板历史作为主要依据。",
    rowTimeCheckinSchedule: "时间表",
    rowTimeCheckinScheduleDesc: "每 2 小时一次，并包含 10:00、17:00、23:00 这些关键时点。",
    rowTimeCheckinWindow: "剪贴板窗口（分钟）",
    rowTimeCheckinWindowDesc: "每次问候会总结多少分钟内的剪贴板历史。",
    rowTimeCheckinGeneratorCwd: "生成器工作目录",
    rowTimeCheckinGeneratorCwdDesc: "运行恢复的 Hermes 会话以保持语气连续性时使用的目录。",
    rowTimeCheckinGeneratorCommand: "生成器命令",
    rowTimeCheckinGeneratorCommandDesc: "用于定时问候的可执行命令。",
    rowTimeCheckinGeneratorArgs: "生成器参数",
    rowTimeCheckinGeneratorArgsDesc: "传给生成器命令的参数。",
    rowTimeCheckinGeneratorTimeout: "生成器超时（毫秒）",
    rowTimeCheckinGeneratorTimeoutDesc: "超过该时间后会回退到本地模板消息。",
    rowTimeCheckinStatus: "问候状态",
    rowTimeCheckinStatusIdle: "尚未运行过问候。",
    rowTimeCheckinStatusOk: "上一次问候已完成。",
    rowTimeCheckinStatusCleaned: "上一次问候在显示前经过清洗。",
    rowTimeCheckinStatusFallback: "上一次问候使用了本地回退消息。",
    rowTimeCheckinStatusError: "上一次问候使用了回退消息或失败。",
    actionRunTimeCheckinNow: "立即运行时间问候",
    actionPreviewTimeCheckinContext: "预览脱敏上下文",
    placeholderTitle: "即将推出",
    placeholderDesc: "此面板将在 Clawd 后续版本中加入，规划见 docs/plan-settings-panel.md。",
    toastSaveFailed: "保存失败：",
    langEnglish: "English",
    langChinese: "中文",
    themeTitle: "主题",
    themeSubtitle: "为 Clawd 选择一个主题。卡片会显示内建和能力角标，切换前就能看出 tracked / static / mini 等差异。",
    themeEmpty: "没有可用的主题。",
    themeBadgeBuiltin: "内建",
    themeBadgeActive: "当前",
    themeCapabilityTracked: "跟随 idle",
    themeCapabilityAnimated: "动画 idle",
    themeCapabilityStatic: "静态主题",
    themeCapabilityMini: "Mini",
    themeCapabilityDirectSleep: "直睡",
    themeCapabilityNoReactions: "无反应",
    themeActiveIndicator: "\u2713 当前",
    themeThumbMissing: "\u{1F3AD}",
    themeDeleteLabel: "删除主题",
    themeVariantStripLabel: "变体",
    toastThemeDeleted: "主题已删除。",
    toastThemeDeleteFailed: "删除主题失败：",
    animMapTitle: "动画映射",
    animMapSubtitle: "关掉不想看的打扰动画。事件照样会触发——Clawd 只是不再播放对应的动画和音效。",
    animMapSemanticsNote: "关闭 = 不播动画 + 不响音效。权限气泡、会话记录、终端聚焦照常工作。",
    animMapResetAll: "全部恢复",
    animMapAttentionLabel: "完成提示（happy）",
    animMapAttentionDesc: "Agent 结束一轮时的开心跳动（Stop / PostCompact）。",
    animMapErrorLabel: "错误提示",
    animMapErrorDesc: "工具调用失败时的抖动动画。",
    animMapSweepingLabel: "上下文清理",
    animMapSweepingDesc: "PreCompact / 清空上下文时的扫把动画。",
    animMapNotificationLabel: "通知提示",
    animMapNotificationDesc: "权限请求、消息询问时的铃铛动画。",
    animMapCarryingLabel: "Worktree 搬运",
    animMapCarryingDesc: "创建 worktree 时的搬运动画。",
    toastAnimMapResetOk: "动画覆盖已清空。",
    animOverridesTitle: "动画替换",
    animOverridesSubtitle: "按卡片换文件，并调整当前主题的淡入淡出与返回时机。",
    animOverridesCurrentTheme: "当前主题",
    animOverridesOpenThemeTab: "打开主题页",
    animOverridesOpenAssets: "打开素材目录",
    animOverridesResetAll: "全部恢复默认",
    animOverridesChangeFile: "换文件",
    animOverridesPreview: "预览一次",
    animOverridesReset: "恢复槽位",
    animOverridesFade: "Fade",
    animOverridesFadeIn: "入",
    animOverridesFadeOut: "出",
    animOverridesSaveFade: "保存 Fade",
    animOverridesDuration: "返回时长",
    animOverridesSaveDuration: "保存时长",
    animOverridesContinuousHint: "持续态不提供 auto-return 编辑。",
    animOverridesAssetCycle: "素材周期",
    animOverridesSuggestedTiming: "建议时长",
    animOverridesTimingEstimated: "估算",
    animOverridesTimingFallback: "主题默认值",
    animOverridesTimingUnavailable: "不可用",
    animOverridesDisplayHintWarning: "运行时可能被 displayHintMap 盖掉。",
    animOverridesFallbackHint: "这个槽位当前回退到 {state}。",
    animOverridesOverriddenTooltip: "已修改（非默认值）",
    animOverridesUseOwnFile: "使用独立素材",
    animOverridesDurationIdle: "驻留时长",
    animOverridesSectionIdle: "Idle",
    animOverridesSectionWork: "工作态",
    animOverridesSectionInterrupts: "打扰态",
    animOverridesSectionSleep: "睡眠",
    animOverridesSectionMini: "Mini Mode",
    animOverridesSectionIdleTracked: "跟随鼠标的 idle",
    animOverridesSectionIdleAnimated: "idle 随机池",
    animOverridesSectionIdleStatic: "单张静态 idle",
    animOverridesSectionSleepFull: "完整睡眠序列",
    animOverridesSectionSleepDirect: "直睡模式",
    animOverridesExpandRow: "展开",
    animOverridesModalTitle: "选择素材文件",
    animOverridesModalSubtitle: "把文件放进当前主题 assets 目录后，可在这里刷新列表重新选择。",
    animOverridesModalEmpty: "当前主题里还没有可用素材。",
    animOverridesModalSelected: "当前选中",
    animOverridesModalUse: "使用这个文件",
    animOverridesModalCancel: "取消",
    animOverridesRefresh: "刷新列表",
  },
};

let snapshot = null;
let activeTab = "general";
// Static per-agent metadata from agents/registry.js via settings:list-agents.
// Fetched once at boot (since it can't change while the app is running).
// Null until hydrated — renderAgentsTab() renders an empty placeholder.
let agentMetadata = null;

// Theme list cache. Unlike agents, this CAN change at runtime (user deletes
// a theme, drops a new one into the folder). Null until first fetch; refreshed
// on tab open, after removeTheme succeeds, and on `theme` broadcasts.
let themeList = null;
let animationOverridesData = null;
let assetPickerState = null;
let assetPickerPollTimer = null;
const expandedOverrideRowIds = new Set();

const AGENT_LAUNCHER_TRIGGERS_UI = [
  { value: "menuOnly", labelKey: "triggerMenuOnly" },
  { value: "tripleClick", labelKey: "triggerTripleClick" },
  { value: "focusFallback", labelKey: "triggerFocusFallback" },
  { value: "tripleAndFocus", labelKey: "triggerTripleAndFocus" },
];

function readAgentLauncherPrefs() {
  const base = {
    enabled: true,
    command: "hermes",
    cwd: "",
    trigger: "focusFallback",
  };
  const al = snapshot && snapshot.agentLauncher;
  return al && typeof al === "object" ? { ...base, ...al } : base;
}

function commitAgentLauncher(partial) {
  const next = { ...readAgentLauncherPrefs(), ...partial };
  return window.settingsAPI.update("agentLauncher", next);
}

const _HERMES_CHAT_DEFAULTS = {
  command: "hermes",
  args: [],
  cwd: "",
  timeoutMs: 180000,
};
function readHermesChatPrefs() {
  const hc = snapshot && snapshot.hermesChat;
  return hc && typeof hc === "object" ? { ..._HERMES_CHAT_DEFAULTS, ...hc } : { ..._HERMES_CHAT_DEFAULTS };
}
function commitHermesChat(partial) {
  const next = { ...readHermesChatPrefs(), ...partial };
  return window.settingsAPI.update("hermesChat", next);
}
function commitHermesChatText(field, raw) {
  const cur = readHermesChatPrefs();
  if (String(raw) === String(cur[field] || "")) return;
  Promise.resolve(commitHermesChat({ [field]: raw })).then((result) => {
    if (!result || result.status !== "ok") {
      showToast(t("toastSaveFailed") + " " + ((result && result.message) || "unknown"), { error: true });
    }
  });
}

function t(key) {
  const lang = (snapshot && snapshot.lang) || "en";
  const dict = STRINGS[lang] || STRINGS.en;
  return dict[key] || key;
}

// ── Toast ──
const toastStack = document.getElementById("toastStack");
function showToast(message, { error = false, ttl = 3500 } = {}) {
  const node = document.createElement("div");
  node.className = "toast" + (error ? " error" : "");
  node.textContent = message;
  toastStack.appendChild(node);
  // Force reflow then add visible class so the transition runs.
  // eslint-disable-next-line no-unused-expressions
  node.offsetHeight;
  node.classList.add("visible");
  setTimeout(() => {
    node.classList.remove("visible");
    setTimeout(() => node.remove(), 240);
  }, ttl);
}

// ── Sidebar ──
const SIDEBAR_TABS = [
  { id: "general", icon: "\u2699", labelKey: "sidebarGeneral", available: true },
  { id: "agents", icon: "\u26A1", labelKey: "sidebarAgents", available: true },
  { id: "theme", icon: "\u{1F3A8}", labelKey: "sidebarTheme", available: true },
  { id: "animMap", icon: "\u{1F3AC}", labelKey: "sidebarAnimMap", available: true },
  { id: "animOverrides", icon: "\u{1F39E}", labelKey: "sidebarAnimOverrides", available: true },
  { id: "shortcuts", icon: "\u2328", labelKey: "sidebarShortcuts", available: false },
  { id: "about", icon: "\u2139", labelKey: "sidebarAbout", available: false },
];

function renderSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.innerHTML = "";
  for (const tab of SIDEBAR_TABS) {
    const item = document.createElement("div");
    item.className = "sidebar-item";
    if (!tab.available) item.classList.add("disabled");
    if (tab.id === activeTab) item.classList.add("active");
    item.innerHTML =
      `<span class="sidebar-item-icon">${tab.icon}</span>` +
      `<span class="sidebar-item-label">${escapeHtml(t(tab.labelKey))}</span>` +
      (tab.available ? "" : `<span class="sidebar-item-soon">${escapeHtml(t("sidebarSoon"))}</span>`);
    if (tab.available) {
      item.addEventListener("click", () => {
        activeTab = tab.id;
        renderSidebar();
        renderContent();
      });
    }
    sidebar.appendChild(item);
  }
}

// ── Content ──
function renderContent() {
  const content = document.getElementById("content");
  if (activeTab !== "animOverrides" && assetPickerState) closeAssetPicker();
  content.innerHTML = "";
  if (activeTab === "general") {
    renderGeneralTab(content);
  } else if (activeTab === "agents") {
    renderAgentsTab(content);
  } else if (activeTab === "theme") {
    renderThemeTab(content);
  } else if (activeTab === "animMap") {
    renderAnimMapTab(content);
  } else if (activeTab === "animOverrides") {
    renderAnimOverridesTab(content);
  } else {
    renderPlaceholder(content);
  }
}

// ── Animation Map tab (Phase 3b — Disable-only) ──

// 每行一个 oneshot state。顺序影响 UI 排列——按优先级从高到低。
const ANIM_MAP_ROWS = [
  { stateKey: "error",        labelKey: "animMapErrorLabel",        descKey: "animMapErrorDesc" },
  { stateKey: "notification", labelKey: "animMapNotificationLabel", descKey: "animMapNotificationDesc" },
  { stateKey: "sweeping",     labelKey: "animMapSweepingLabel",     descKey: "animMapSweepingDesc" },
  { stateKey: "attention",    labelKey: "animMapAttentionLabel",    descKey: "animMapAttentionDesc" },
  { stateKey: "carrying",     labelKey: "animMapCarryingLabel",     descKey: "animMapCarryingDesc" },
];

function renderAnimMapTab(parent) {
  const h1 = document.createElement("h1");
  h1.textContent = t("animMapTitle");
  parent.appendChild(h1);

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = t("animMapSubtitle");
  parent.appendChild(subtitle);

  const note = document.createElement("p");
  note.className = "subtitle";
  note.textContent = t("animMapSemanticsNote");
  parent.appendChild(note);

  const themeId = (snapshot && snapshot.theme) || "clawd";
  const rows = ANIM_MAP_ROWS.map((spec) => buildAnimMapRow(spec, themeId));
  parent.appendChild(buildSection("", rows));

  const hasAny = readThemeOverrideMap(themeId) !== null;
  const resetWrap = document.createElement("div");
  resetWrap.className = "anim-map-reset";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "theme-delete-btn anim-map-reset-btn";
  resetBtn.textContent = t("animMapResetAll");
  if (!hasAny) resetBtn.disabled = true;
  attachActivation(resetBtn, () =>
    window.settingsAPI.command("resetThemeOverrides", { themeId })
      .then((result) => {
        if (result && result.status === "ok" && !result.noop) {
          showToast(t("toastAnimMapResetOk"));
        }
        return result;
      })
  );
  resetWrap.appendChild(resetBtn);
  parent.appendChild(resetWrap);
}

function readThemeOverrideMap(themeId) {
  const all = snapshot && snapshot.themeOverrides;
  const map = all && all[themeId];
  if (!map || typeof map !== "object") return null;
  const keys = [
    ...(map.states ? Object.keys(map.states) : []),
    ...(map.tiers && map.tiers.workingTiers ? Object.keys(map.tiers.workingTiers) : []),
    ...(map.tiers && map.tiers.jugglingTiers ? Object.keys(map.tiers.jugglingTiers) : []),
    ...(map.timings && map.timings.autoReturn ? Object.keys(map.timings.autoReturn) : []),
  ];
  return keys.length > 0 ? map : null;
}

function isStateDisabled(themeId, stateKey) {
  const map = readThemeOverrideMap(themeId);
  const states = map && map.states;
  const entry = (states && states[stateKey]) || (map && map[stateKey]);
  return !!(entry && entry.disabled === true);
}

function buildAnimMapRow(spec, themeId) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label"></span>` +
      `<span class="row-desc"></span>` +
    `</div>` +
    `<div class="row-control"><div class="switch" role="switch" tabindex="0"></div></div>`;
  row.querySelector(".row-label").textContent = t(spec.labelKey);
  row.querySelector(".row-desc").textContent = t(spec.descKey);
  const sw = row.querySelector(".switch");

  const disabled = isStateDisabled(themeId, spec.stateKey);
  const visualOn = !disabled; // ON = 动画启用
  if (visualOn) sw.classList.add("on");
  sw.setAttribute("aria-checked", visualOn ? "true" : "false");

  attachActivation(sw, () => {
    const nextDisabled = !isStateDisabled(themeId, spec.stateKey);
    return window.settingsAPI.command("setThemeOverrideDisabled", {
      themeId,
      stateKey: spec.stateKey,
      disabled: nextDisabled,
    });
  });
  return row;
}

// ── Theme tab ──

function fetchThemes() {
  if (!window.settingsAPI || typeof window.settingsAPI.listThemes !== "function") {
    themeList = [];
    return Promise.resolve([]);
  }
  return window.settingsAPI.listThemes().then((list) => {
    themeList = Array.isArray(list) ? list : [];
    return themeList;
  }).catch((err) => {
    console.warn("settings: listThemes failed", err);
    themeList = [];
    return [];
  });
}

function renderThemeTab(parent) {
  const h1 = document.createElement("h1");
  h1.textContent = t("themeTitle");
  parent.appendChild(h1);

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = t("themeSubtitle");
  parent.appendChild(subtitle);

  if (themeList === null) {
    const loading = document.createElement("div");
    loading.className = "placeholder-desc";
    parent.appendChild(loading);
    fetchThemes().then(() => {
      if (activeTab === "theme") renderContent();
    });
    return;
  }

  if (themeList.length === 0) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.innerHTML = `<div class="placeholder-desc">${escapeHtml(t("themeEmpty"))}</div>`;
    parent.appendChild(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "theme-grid";
  for (const theme of themeList) {
    grid.appendChild(buildThemeCard(theme));
  }
  parent.appendChild(grid);
}

// Resolve an `{en, zh}` object or a plain string to a localized string.
// Falls back across languages before giving up.
function localizeField(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const lang = (snapshot && snapshot.lang) || "en";
    if (value[lang]) return value[lang];
    if (value.en) return value.en;
    if (value.zh) return value.zh;
    const firstKey = Object.keys(value)[0];
    if (firstKey) return value[firstKey];
  }
  return "";
}

// Target visual content size inside theme-thumb frames. Picked to match
// clawd's natural ratio (~0.51) so pixel pets stay full-size while
// tight-canvas themes like calico (~0.80) get scaled down to feel balanced.
const PREVIEW_TARGET_CONTENT_RATIO = 0.55;

function applyThemePreviewScale(img, contentRatio) {
  if (!Number.isFinite(contentRatio) || contentRatio <= 0) return;
  if (contentRatio <= PREVIEW_TARGET_CONTENT_RATIO) return;
  const scale = PREVIEW_TARGET_CONTENT_RATIO / contentRatio;
  const pct = `${(scale * 100).toFixed(2)}%`;
  img.style.maxWidth = pct;
  img.style.maxHeight = pct;
}

function applyThemePreviewOffset(img, offsetPct) {
  if (!offsetPct) return;
  const { x, y } = offsetPct;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) return;
  img.style.transform = `translate(${x.toFixed(2)}%, ${y.toFixed(2)}%)`;
}

function getThemeCapabilityBadgeLabels(theme) {
  const caps = theme && theme.capabilities;
  if (!caps || typeof caps !== "object") return [];
  const badges = [];
  if (caps.idleMode === "tracked") badges.push(t("themeCapabilityTracked"));
  else if (caps.idleMode === "animated") badges.push(t("themeCapabilityAnimated"));
  else if (caps.idleMode === "static") badges.push(t("themeCapabilityStatic"));
  if (caps.miniMode) badges.push(t("themeCapabilityMini"));
  if (caps.sleepMode === "direct") badges.push(t("themeCapabilityDirectSleep"));
  if (caps.reactions === false) badges.push(t("themeCapabilityNoReactions"));
  return badges;
}

function buildThemeCard(theme) {
  const card = document.createElement("div");
  card.className = "theme-card";
  card.setAttribute("role", "radio");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-checked", theme.active ? "true" : "false");
  if (theme.active) card.classList.add("active");

  const thumb = document.createElement("div");
  thumb.className = "theme-thumb";
  if (theme.previewFileUrl) {
    const img = document.createElement("img");
    img.src = theme.previewFileUrl;
    img.alt = "";
    img.draggable = false;
    applyThemePreviewScale(img, theme.previewContentRatio);
    applyThemePreviewOffset(img, theme.previewContentOffsetPct);
    thumb.appendChild(img);
  } else {
    const glyph = document.createElement("span");
    glyph.className = "theme-thumb-empty";
    glyph.textContent = t("themeThumbMissing");
    thumb.appendChild(glyph);
  }
  card.appendChild(thumb);

  const name = document.createElement("div");
  name.className = "theme-card-name";
  const nameText = document.createElement("span");
  nameText.className = "theme-card-name-text";
  nameText.textContent = theme.name || theme.id;
  name.appendChild(nameText);
  if (theme.builtin) {
    const badge = document.createElement("span");
    badge.className = "theme-card-badge";
    badge.textContent = t("themeBadgeBuiltin");
    name.appendChild(badge);
  }
  card.appendChild(name);

  const capLabels = getThemeCapabilityBadgeLabels(theme);
  if (capLabels.length) {
    const caps = document.createElement("div");
    caps.className = "theme-card-capabilities";
    for (const label of capLabels) {
      const badge = document.createElement("span");
      badge.className = "theme-card-badge";
      badge.textContent = label;
      caps.appendChild(badge);
    }
    card.appendChild(caps);
  }

  const canDelete = !theme.builtin && !theme.active;
  if (theme.active || canDelete) {
    const footer = document.createElement("div");
    footer.className = "theme-card-footer";
    const indicator = document.createElement("span");
    indicator.className = "theme-card-check";
    indicator.textContent = theme.active ? t("themeActiveIndicator") : "";
    footer.appendChild(indicator);
    if (canDelete) {
      const btn = document.createElement("button");
      btn.className = "theme-delete-btn";
      btn.type = "button";
      btn.textContent = "\u{1F5D1}";
      btn.title = t("themeDeleteLabel");
      btn.setAttribute("aria-label", t("themeDeleteLabel"));
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        handleDeleteTheme(theme);
      });
      footer.appendChild(btn);
    }
    card.appendChild(footer);
  }

  if (!theme.active) {
    // Phase 3b-swap: theme switches go through setThemeSelection so the
    // stored themeVariant[themeId] is honoured (or self-healed on dead ids).
    // applyUpdate("theme", id) would bypass the variant-resolution path.
    attachActivation(card, () => window.settingsAPI.command("setThemeSelection", { themeId: theme.id }));
  }
  return card;
}

function handleDeleteTheme(theme) {
  if (!window.settingsAPI) return;
  window.settingsAPI
    .confirmRemoveTheme(theme.id)
    .then((res) => {
      if (!res || !res.confirmed) return null;
      return window.settingsAPI.command("removeTheme", theme.id);
    })
    .then((result) => {
      if (result == null) return;
      if (result.status !== "ok") {
        const msg = (result && result.message) || "unknown error";
        showToast(t("toastThemeDeleteFailed") + msg, { error: true });
        return;
      }
      showToast(t("toastThemeDeleted"));
      fetchThemes().then(() => {
        if (activeTab === "theme") renderContent();
      });
    })
    .catch((err) => {
      showToast(t("toastThemeDeleteFailed") + (err && err.message), { error: true });
    });
}

function fetchAnimationOverridesData() {
  if (!window.settingsAPI || typeof window.settingsAPI.getAnimationOverridesData !== "function") {
    animationOverridesData = { theme: null, assets: [], cards: [] };
    return Promise.resolve(animationOverridesData);
  }
  return window.settingsAPI.getAnimationOverridesData().then((data) => {
    animationOverridesData = data || { theme: null, assets: [], cards: [] };
    return animationOverridesData;
  }).catch((err) => {
    console.warn("settings: getAnimationOverridesData failed", err);
    animationOverridesData = { theme: null, assets: [], cards: [] };
    return animationOverridesData;
  });
}

function getAnimOverrideCardById(cardId) {
  const cards = animationOverridesData && animationOverridesData.cards;
  return Array.isArray(cards) ? cards.find((card) => card.id === cardId) || null : null;
}

function getAnimationAssetsSignature(data = animationOverridesData) {
  const assets = data && Array.isArray(data.assets) ? data.assets : [];
  return assets.map((asset) => [
    asset.name,
    asset.cycleMs == null ? "" : asset.cycleMs,
    asset.cycleStatus || "",
  ].join(":")).join("\n");
}

function stopAssetPickerPolling() {
  if (assetPickerPollTimer) {
    clearInterval(assetPickerPollTimer);
    assetPickerPollTimer = null;
  }
}

function closeAssetPicker() {
  assetPickerState = null;
  stopAssetPickerPolling();
  renderAssetPickerModal();
}

function normalizeAssetPickerSelection() {
  if (!assetPickerState || !animationOverridesData) return;
  const assets = Array.isArray(animationOverridesData.assets) ? animationOverridesData.assets : [];
  if (!assets.length) {
    assetPickerState.selectedFile = null;
    return;
  }
  const stillExists = assets.some((asset) => asset.name === assetPickerState.selectedFile);
  if (!stillExists) assetPickerState.selectedFile = assets[0].name;
}

function captureAssetPickerScrollState() {
  if (!assetPickerState) return;
  const list = document.querySelector(".asset-picker-list");
  if (!list) return;
  assetPickerState.listScrollTop = list.scrollTop;
}

function restoreAssetPickerScrollState(list) {
  if (!list || !assetPickerState || typeof assetPickerState.listScrollTop !== "number") return;
  const target = assetPickerState.listScrollTop;
  list.scrollTop = target;
  requestAnimationFrame(() => {
    if (document.body.contains(list)) list.scrollTop = target;
  });
}

function shouldRefreshAssetPickerModal({ previousSignature, previousSelectedFile }) {
  if (!assetPickerState) return false;
  if (assetPickerState.selectedFile !== previousSelectedFile) return true;
  return getAnimationAssetsSignature() !== previousSignature;
}

function startAssetPickerPolling() {
  stopAssetPickerPolling();
  assetPickerPollTimer = setInterval(() => {
    if (!assetPickerState) return;
    const previousSignature = getAnimationAssetsSignature();
    const previousSelectedFile = assetPickerState.selectedFile;
    fetchAnimationOverridesData().then(() => {
      normalizeAssetPickerSelection();
      if (shouldRefreshAssetPickerModal({ previousSignature, previousSelectedFile })) {
        renderAssetPickerModal();
      }
    });
  }, 1500);
}

function previewStateForCard(card) {
  if (!card) return null;
  if (card.slotType === "tier") {
    return card.tierGroup === "jugglingTiers" ? "juggling" : "working";
  }
  if (card.slotType === "idleAnimation") return "idle";
  return card.stateKey;
}

function buildAnimOverrideRequest(card, patch) {
  const themeId = animationOverridesData && animationOverridesData.theme && animationOverridesData.theme.id;
  const base = {
    themeId,
    slotType: card.slotType,
  };
  if (card.slotType === "tier") {
    base.tierGroup = card.tierGroup;
    base.originalFile = card.originalFile;
  } else if (card.slotType === "idleAnimation") {
    base.originalFile = card.originalFile;
  } else {
    base.stateKey = card.stateKey;
  }
  return { ...base, ...patch };
}

function runAnimationOverrideCommand(card, patch) {
  const payload = buildAnimOverrideRequest(card, patch);
  return window.settingsAPI.command("setAnimationOverride", payload).then((result) => {
    if (!result || result.status !== "ok" || result.noop) return result;
    return fetchAnimationOverridesData().then(() => {
      normalizeAssetPickerSelection();
      if (activeTab === "animOverrides") renderContent();
      renderAssetPickerModal();
      return result;
    });
  });
}

function openAssetPicker(card) {
  assetPickerState = {
    cardId: card.id,
    selectedFile: card.currentFile,
  };
  renderAssetPickerModal();
  startAssetPickerPolling();
}

function formatSessionRange(minSessions, maxSessions) {
  const lang = (snapshot && snapshot.lang) || "en";
  if (lang === "zh") {
    if (maxSessions == null) return `${minSessions}+ 会话`;
    if (minSessions === maxSessions) return `${minSessions} 会话`;
    return `${minSessions}-${maxSessions} 会话`;
  }
  if (maxSessions == null) return `${minSessions}+ sessions`;
  if (minSessions === maxSessions) return `${minSessions} session${minSessions === 1 ? "" : "s"}`;
  return `${minSessions}-${maxSessions} sessions`;
}

function getAnimOverrideTriggerLabel(card) {
  switch (card.triggerKind) {
    case "idleTracked": return "Idle follow";
    case "idleStatic": return "Idle";
    case "idleAnimation": return `Idle random #${card.poolIndex || 1}`;
    case "thinking": return "UserPromptSubmit";
    case "working": return `PreToolUse (${formatSessionRange(card.minSessions, card.maxSessions)})`;
    case "juggling": return `SubagentStart (${formatSessionRange(card.minSessions, card.maxSessions)})`;
    case "error": return "PostToolUseFailure";
    case "attention": return "Stop / PostCompact";
    case "notification": return "PermissionRequest";
    case "sweeping": return "PreCompact";
    case "carrying": return "WorktreeCreate";
    case "yawning": return "Sleep: yawn";
    case "dozing": return "Sleep: doze";
    case "collapsing": return "Sleep: collapse";
    case "sleeping": return "60s no events";
    case "waking": return "Wake";
    case "mini-idle": return "Mini idle";
    case "mini-enter": return "Mini enter";
    case "mini-enter-sleep": return "Mini enter sleep";
    case "mini-crabwalk": return "Mini crabwalk";
    case "mini-peek": return "Mini peek";
    case "mini-alert": return "Mini alert";
    case "mini-happy": return "Mini happy";
    case "mini-sleep": return "Mini sleep";
    default: return card.triggerKind || card.stateKey || card.id;
  }
}

function getAnimOverrideSectionTitle(section) {
  if (!section || !section.id) return "";
  switch (section.id) {
    case "idle": return t("animOverridesSectionIdle");
    case "work": return t("animOverridesSectionWork");
    case "interrupts": return t("animOverridesSectionInterrupts");
    case "sleep": return t("animOverridesSectionSleep");
    case "mini": return t("animOverridesSectionMini");
    default: return section.id;
  }
}

function getAnimOverrideSectionSubtitle(section) {
  if (!section) return "";
  if (section.id === "idle") {
    if (section.mode === "tracked") return t("animOverridesSectionIdleTracked");
    if (section.mode === "animated") return t("animOverridesSectionIdleAnimated");
    if (section.mode === "static") return t("animOverridesSectionIdleStatic");
  }
  if (section.id === "sleep") {
    if (section.mode === "full") return t("animOverridesSectionSleepFull");
    if (section.mode === "direct") return t("animOverridesSectionSleepDirect");
  }
  return "";
}

function buildAnimOverrideSection(section) {
  const wrapper = document.createElement("section");
  wrapper.className = "anim-override-section";

  const head = document.createElement("div");
  head.className = "anim-override-section-head";

  const title = document.createElement("div");
  title.className = "section-title";
  title.textContent = getAnimOverrideSectionTitle(section);
  head.appendChild(title);

  const subtitleText = getAnimOverrideSectionSubtitle(section);
  if (subtitleText) {
    const subtitle = document.createElement("div");
    subtitle.className = "anim-override-section-subtitle";
    subtitle.textContent = subtitleText;
    head.appendChild(subtitle);
  }
  wrapper.appendChild(head);

  const list = document.createElement("div");
  list.className = "anim-override-list";
  for (const card of (section.cards || [])) {
    list.appendChild(buildAnimOverrideRow(card));
  }
  wrapper.appendChild(list);
  return wrapper;
}

function buildAnimPreviewNode(fileUrl) {
  const frame = document.createElement("div");
  frame.className = "anim-override-preview-frame";
  if (fileUrl) {
    const img = document.createElement("img");
    img.src = fileUrl;
    img.alt = "";
    img.draggable = false;
    frame.appendChild(img);
  } else {
    const glyph = document.createElement("span");
    glyph.className = "theme-thumb-empty";
    glyph.textContent = t("themeThumbMissing");
    frame.appendChild(glyph);
  }
  return frame;
}

function renderAnimOverridesTab(parent) {
  const h1 = document.createElement("h1");
  h1.textContent = t("animOverridesTitle");
  parent.appendChild(h1);

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = t("animOverridesSubtitle");
  parent.appendChild(subtitle);

  if (animationOverridesData === null) {
    const loading = document.createElement("div");
    loading.className = "placeholder-desc";
    parent.appendChild(loading);
    fetchAnimationOverridesData().then(() => {
      if (activeTab === "animOverrides") renderContent();
    });
    return;
  }

  const data = animationOverridesData;
  const themeMeta = document.createElement("div");
  themeMeta.className = "anim-override-meta";
  const themeLabel = document.createElement("div");
  themeLabel.className = "anim-override-meta-label";
  themeLabel.textContent = `${t("animOverridesCurrentTheme")}: ${(data.theme && data.theme.name) || "clawd"}`;
  themeMeta.appendChild(themeLabel);

  const themeBtn = document.createElement("button");
  themeBtn.type = "button";
  themeBtn.className = "soft-btn";
  themeBtn.textContent = t("animOverridesOpenThemeTab");
  themeBtn.addEventListener("click", () => {
    activeTab = "theme";
    renderSidebar();
    renderContent();
  });
  themeMeta.appendChild(themeBtn);

  const assetsBtn = document.createElement("button");
  assetsBtn.type = "button";
  assetsBtn.className = "soft-btn";
  assetsBtn.textContent = t("animOverridesOpenAssets");
  attachActivation(assetsBtn, () => window.settingsAPI.openThemeAssetsDir());
  themeMeta.appendChild(assetsBtn);

  const themeId = data.theme && data.theme.id;
  const resetAllBtn = document.createElement("button");
  resetAllBtn.type = "button";
  resetAllBtn.className = "soft-btn";
  resetAllBtn.textContent = t("animOverridesResetAll");
  resetAllBtn.disabled = !themeId || readThemeOverrideMap(themeId) === null;
  attachActivation(resetAllBtn, () =>
    window.settingsAPI.command("resetThemeOverrides", { themeId }).then((result) => {
      if (result && result.status === "ok" && !result.noop) {
        showToast(t("toastAnimMapResetOk"));
      }
      return result;
    })
  );
  themeMeta.appendChild(resetAllBtn);
  parent.appendChild(themeMeta);

  const sections = Array.isArray(data.sections) ? data.sections : [];
  for (const section of sections) {
    if (!section || !Array.isArray(section.cards) || !section.cards.length) continue;
    parent.appendChild(buildAnimOverrideSection(section));
  }
  renderAssetPickerModal();
}

function triggerPreviewOnce(card) {
  window.settingsAPI.previewAnimationOverride({
    stateKey: previewStateForCard(card),
    file: card.currentFile,
    durationMs: getAnimationPreviewDuration(null, card),
  });
}

function isCardOverridden(card) {
  const themeId = animationOverridesData && animationOverridesData.theme && animationOverridesData.theme.id;
  if (!themeId) return false;
  const map = readThemeOverrideMap(themeId);
  if (!map) return false;
  if (card.slotType === "tier") {
    const group = map.tiers && map.tiers[card.tierGroup];
    return !!(group && group[card.originalFile]);
  }
  if (card.slotType === "idleAnimation") {
    const group = map.idleAnimations;
    return !!(group && group[card.originalFile]);
  }
  const entry = map.states && map.states[card.stateKey];
  if (entry) return true;
  const autoReturn = map.timings && map.timings.autoReturn;
  return !!(autoReturn && Object.prototype.hasOwnProperty.call(autoReturn, card.stateKey));
}

function buildAnimOverrideRow(card) {
  const row = document.createElement("details");
  row.className = "anim-override-row";
  if (card.fallbackTargetState) row.classList.add("inherited");
  row.dataset.rowId = card.id;
  if (expandedOverrideRowIds.has(card.id)) row.open = true;
  row.addEventListener("toggle", () => {
    if (row.open) expandedOverrideRowIds.add(card.id);
    else expandedOverrideRowIds.delete(card.id);
  });

  row.appendChild(buildAnimOverrideSummary(card));
  row.appendChild(buildAnimOverrideDrawer(card));
  return row;
}

function buildAnimOverrideSummary(card) {
  const summary = document.createElement("summary");

  const chevron = document.createElement("span");
  chevron.className = "anim-override-chevron";
  chevron.textContent = "\u25B8"; // ▸
  chevron.setAttribute("aria-hidden", "true");
  summary.appendChild(chevron);

  const thumb = document.createElement("div");
  thumb.className = "anim-override-thumb";
  thumb.title = t("animOverridesPreview");
  if (card.currentFileUrl) {
    const img = document.createElement("img");
    img.src = card.currentFileUrl;
    img.alt = "";
    img.draggable = false;
    thumb.appendChild(img);
  }
  thumb.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    triggerPreviewOnce(card);
  });
  summary.appendChild(thumb);

  const text = document.createElement("div");
  text.className = "anim-override-summary-text";
  const trigger = document.createElement("div");
  trigger.className = "anim-override-trigger";
  trigger.textContent = getAnimOverrideTriggerLabel(card);
  text.appendChild(trigger);
  const file = document.createElement("div");
  file.className = "anim-override-file";
  file.textContent = card.currentFile;
  file.title = card.bindingLabel || "";
  text.appendChild(file);
  if (card.fallbackTargetState) {
    const chip = document.createElement("div");
    chip.className = "anim-override-fallback-chip";
    chip.title = getAnimFallbackHint(card);
    const arrow = document.createElement("span");
    arrow.className = "anim-override-fallback-chip-arrow";
    arrow.textContent = "\u21B7"; // ↷
    arrow.setAttribute("aria-hidden", "true");
    chip.appendChild(arrow);
    const target = document.createElement("span");
    target.textContent = card.fallbackTargetState;
    chip.appendChild(target);
    text.appendChild(chip);
  }
  summary.appendChild(text);

  const badges = document.createElement("div");
  badges.className = "anim-override-summary-badges";
  if (card.displayHintWarning) {
    const warn = document.createElement("span");
    warn.className = "anim-override-badge anim-override-badge-warn";
    warn.textContent = "\u26A0"; // ⚠
    warn.title = t("animOverridesDisplayHintWarning");
    badges.appendChild(warn);
  }
  if (isCardOverridden(card)) {
    const dotWrap = document.createElement("span");
    dotWrap.className = "anim-override-badge";
    dotWrap.title = t("animOverridesOverriddenTooltip");
    const dot = document.createElement("span");
    dot.className = "anim-override-badge-dot";
    dotWrap.appendChild(dot);
    badges.appendChild(dotWrap);
  }
  summary.appendChild(badges);

  const changeBtn = document.createElement("button");
  changeBtn.type = "button";
  changeBtn.className = "soft-btn accent anim-override-summary-change";
  changeBtn.textContent = card.fallbackTargetState ? t("animOverridesUseOwnFile") : t("animOverridesChangeFile");
  changeBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openAssetPicker(card);
  });
  summary.appendChild(changeBtn);

  return summary;
}

function buildAnimOverrideDrawer(card) {
  const drawer = document.createElement("div");
  drawer.className = "anim-override-drawer";

  if (card.fallbackTargetState) {
    const hint = document.createElement("div");
    hint.className = "anim-override-binding";
    hint.textContent = getAnimFallbackHint(card);
    drawer.appendChild(hint);
  }

  if (card.displayHintWarning) {
    const warning = document.createElement("div");
    warning.className = "anim-override-warning";
    warning.textContent = t("animOverridesDisplayHintWarning");
    drawer.appendChild(warning);
  }

  const head = document.createElement("div");
  head.className = "anim-override-drawer-head";
  const bigPreview = document.createElement("div");
  bigPreview.className = "anim-override-drawer-preview";
  bigPreview.title = t("animOverridesPreview");
  if (card.currentFileUrl) {
    const img = document.createElement("img");
    img.src = card.currentFileUrl;
    img.alt = "";
    img.draggable = false;
    bigPreview.appendChild(img);
  }
  bigPreview.addEventListener("click", () => triggerPreviewOnce(card));
  head.appendChild(bigPreview);

  const info = document.createElement("div");
  info.className = "anim-override-drawer-info";
  const binding = document.createElement("div");
  binding.className = "anim-override-binding";
  binding.textContent = card.bindingLabel;
  info.appendChild(binding);
  info.appendChild(buildAnimTimingHint(
    t("animOverridesAssetCycle"),
    card.assetCycleMs,
    card.assetCycleStatus
  ));
  if ((card.supportsAutoReturn || card.supportsDuration) && card.assetCycleMs == null && card.suggestedDurationMs != null) {
    info.appendChild(buildAnimTimingHint(
      card.supportsDuration ? t("animOverridesDurationIdle") : t("animOverridesSuggestedTiming"),
      card.suggestedDurationMs,
      card.suggestedDurationStatus
    ));
  }
  if (!card.supportsAutoReturn && !card.supportsDuration) {
    const hint = document.createElement("div");
    hint.className = "anim-override-binding";
    hint.textContent = t("animOverridesContinuousHint");
    info.appendChild(hint);
  }
  head.appendChild(info);
  drawer.appendChild(head);

  const sliders = document.createElement("div");
  sliders.className = "anim-override-sliders";
  sliders.appendChild(buildAnimOverrideSliderRow({
    label: t("animOverridesFadeIn"),
    min: 0, max: 1000, step: 10,
    value: card.transition.in,
    onCommit: (v) => runAnimationOverrideCommand(card, {
      transition: { in: v, out: card.transition.out },
    }),
  }));
  sliders.appendChild(buildAnimOverrideSliderRow({
    label: t("animOverridesFadeOut"),
    min: 0, max: 1000, step: 10,
    value: card.transition.out,
    onCommit: (v) => runAnimationOverrideCommand(card, {
      transition: { in: card.transition.in, out: v },
    }),
  }));
  if (card.supportsAutoReturn) {
    const current = Number.isFinite(card.autoReturnMs) ? card.autoReturnMs : (card.suggestedDurationMs || 3000);
    sliders.appendChild(buildAnimOverrideSliderRow({
      label: t("animOverridesDuration"),
      min: 500, max: 10000, step: 100,
      value: current,
      numberMin: 500,
      numberMax: 60000,
      onCommit: (v) => {
        if (!Number.isFinite(v) || v < 500 || v > 60000) return;
        return runAnimationOverrideCommand(card, { autoReturnMs: v });
      },
    }));
  }
  if (card.supportsDuration) {
    const current = Number.isFinite(card.durationMs) ? card.durationMs : (card.suggestedDurationMs || 3000);
    sliders.appendChild(buildAnimOverrideSliderRow({
      label: t("animOverridesDurationIdle"),
      min: 500, max: 20000, step: 100,
      value: current,
      numberMin: 500,
      numberMax: 60000,
      onCommit: (v) => {
        if (!Number.isFinite(v) || v < 500 || v > 60000) return;
        return runAnimationOverrideCommand(card, { durationMs: v });
      },
    }));
  }
  drawer.appendChild(sliders);

  const footer = document.createElement("div");
  footer.className = "anim-override-drawer-footer";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "soft-btn";
  resetBtn.textContent = t("animOverridesReset");
  resetBtn.disabled = !isCardOverridden(card);
  attachActivation(resetBtn, () => {
    const patch = {
      file: null,
      transition: null,
      ...(card.supportsAutoReturn ? { autoReturnMs: null } : {}),
      ...(card.supportsDuration ? { durationMs: null } : {}),
    };
    return runAnimationOverrideCommand(card, patch);
  });
  footer.appendChild(resetBtn);
  drawer.appendChild(footer);

  return drawer;
}

function buildAnimOverrideSliderRow({ label, min, max, step, value, numberMin, numberMax, onCommit }) {
  const row = document.createElement("div");
  row.className = "anim-override-slider-row";

  const lbl = document.createElement("span");
  lbl.className = "anim-override-slider-label";
  lbl.textContent = label;
  row.appendChild(lbl);

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(clampNumber(value, min, max));
  row.appendChild(range);

  const number = document.createElement("input");
  number.type = "number";
  number.min = String(Number.isFinite(numberMin) ? numberMin : min);
  number.max = String(Number.isFinite(numberMax) ? numberMax : max);
  number.step = String(step);
  number.value = String(value);
  row.appendChild(number);

  range.addEventListener("input", () => {
    number.value = range.value;
  });
  range.addEventListener("change", () => {
    const v = Number(range.value);
    if (Number.isFinite(v)) onCommit(v);
  });
  number.addEventListener("input", () => {
    const v = Number(number.value);
    if (Number.isFinite(v)) range.value = String(clampNumber(v, min, max));
  });
  const commitFromNumber = () => {
    const v = Number(number.value);
    if (Number.isFinite(v)) onCommit(v);
  };
  number.addEventListener("change", commitFromNumber);
  number.addEventListener("blur", commitFromNumber);

  return row;
}

function clampNumber(v, min, max) {
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

function formatAnimTimingValue(ms, status) {
  if (status === "static") return "—";
  let text = Number.isFinite(ms) && ms > 0
    ? `${ms} ms`
    : t("animOverridesTimingUnavailable");
  if (status === "estimated") text += ` (${t("animOverridesTimingEstimated")})`;
  else if (status === "fallback") text += ` (${t("animOverridesTimingFallback")})`;
  return text;
}

function getAnimFallbackHint(card) {
  if (!card || !card.fallbackTargetState) return "";
  return t("animOverridesFallbackHint").replace("{state}", card.fallbackTargetState);
}

function buildAnimTimingHint(label, ms, status) {
  const line = document.createElement("div");
  line.className = "anim-override-binding";
  line.textContent = `${label}: ${formatAnimTimingValue(ms, status)}`;
  return line;
}

function getAnimationPreviewDuration(asset, card) {
  if (asset && Number.isFinite(asset.cycleMs) && asset.cycleMs > 0) return asset.cycleMs;
  if (card && Number.isFinite(card.previewDurationMs) && card.previewDurationMs > 0) return card.previewDurationMs;
  if (card && card.supportsAutoReturn && Number.isFinite(card.autoReturnMs) && card.autoReturnMs > 0) {
    return card.autoReturnMs;
  }
  return null;
}

function getSelectedAnimationAsset() {
  if (!assetPickerState || !animationOverridesData) return null;
  const assets = Array.isArray(animationOverridesData.assets) ? animationOverridesData.assets : [];
  return assets.find((asset) => asset.name === assetPickerState.selectedFile) || null;
}

function populateAssetPickerDetail(detail, selected) {
  detail.innerHTML = "";
  detail.appendChild(buildAnimPreviewNode(selected && selected.fileUrl));
  const selectedLabel = document.createElement("div");
  selectedLabel.className = "anim-override-file";
  selectedLabel.textContent = `${t("animOverridesModalSelected")}: ${selected ? selected.name : "-"}`;
  detail.appendChild(selectedLabel);
  detail.appendChild(buildAnimTimingHint(
    t("animOverridesAssetCycle"),
    selected && selected.cycleMs,
    selected && selected.cycleStatus
  ));
}

function syncAssetPickerSelectionUi() {
  const root = document.getElementById("modalRoot");
  if (!root || !assetPickerState) return;
  const selected = getSelectedAnimationAsset();
  for (const item of root.querySelectorAll(".asset-picker-item")) {
    item.classList.toggle("active", item.dataset.assetName === (selected && selected.name));
  }
  const detail = root.querySelector(".asset-picker-detail");
  if (detail) populateAssetPickerDetail(detail, selected);
  const previewBtn = root.querySelector(".asset-picker-preview-btn");
  if (previewBtn) previewBtn.disabled = !selected;
  const useBtn = root.querySelector(".asset-picker-use-btn");
  if (useBtn) useBtn.disabled = !selected;
}

function renderAssetPickerModal() {
  const root = document.getElementById("modalRoot");
  if (!root) return;
  captureAssetPickerScrollState();
  root.innerHTML = "";
  if (!assetPickerState || !animationOverridesData) return;
  const card = getAnimOverrideCardById(assetPickerState.cardId);
  if (!card) {
    closeAssetPicker();
    return;
  }
  normalizeAssetPickerSelection();
  const assets = Array.isArray(animationOverridesData.assets) ? animationOverridesData.assets : [];
  const selected = getSelectedAnimationAsset();

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeAssetPicker();
  });

  const modal = document.createElement("div");
  modal.className = "asset-picker-modal";

  const title = document.createElement("h2");
  title.textContent = t("animOverridesModalTitle");
  modal.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = t("animOverridesModalSubtitle");
  modal.appendChild(subtitle);

  const refreshRow = document.createElement("div");
  refreshRow.className = "asset-picker-toolbar";
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "soft-btn";
  refreshBtn.textContent = t("animOverridesRefresh");
  attachActivation(refreshBtn, () => fetchAnimationOverridesData().then(() => {
    normalizeAssetPickerSelection();
    renderAssetPickerModal();
    return { status: "ok" };
  }));
  refreshRow.appendChild(refreshBtn);

  const openAssetsBtn = document.createElement("button");
  openAssetsBtn.type = "button";
  openAssetsBtn.className = "soft-btn";
  openAssetsBtn.textContent = t("animOverridesOpenAssets");
  attachActivation(openAssetsBtn, () => window.settingsAPI.openThemeAssetsDir());
  refreshRow.appendChild(openAssetsBtn);
  modal.appendChild(refreshRow);

  const body = document.createElement("div");
  body.className = "asset-picker-body";

  const list = document.createElement("div");
  list.className = "asset-picker-list";
  if (!assets.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder-desc";
    empty.textContent = t("animOverridesModalEmpty");
    list.appendChild(empty);
  } else {
    for (const asset of assets) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "asset-picker-item" + (selected && selected.name === asset.name ? " active" : "");
      item.dataset.assetName = asset.name;
      item.textContent = asset.name;
      item.addEventListener("click", () => {
        assetPickerState.selectedFile = asset.name;
        syncAssetPickerSelectionUi();
      });
      list.appendChild(item);
    }
  }
  body.appendChild(list);
  restoreAssetPickerScrollState(list);

  const detail = document.createElement("div");
  detail.className = "asset-picker-detail";
  populateAssetPickerDetail(detail, selected);
  body.appendChild(detail);
  modal.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "asset-picker-footer";

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "soft-btn asset-picker-preview-btn";
  previewBtn.textContent = t("animOverridesPreview");
  previewBtn.disabled = !selected;
  attachActivation(previewBtn, () => {
    const currentSelected = getSelectedAnimationAsset();
    if (!currentSelected) return { status: "error", message: "no asset selected" };
    return window.settingsAPI.previewAnimationOverride({
      stateKey: previewStateForCard(card),
      file: currentSelected.name,
      durationMs: getAnimationPreviewDuration(currentSelected, card),
    });
  });
  footer.appendChild(previewBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "soft-btn";
  cancelBtn.textContent = t("animOverridesModalCancel");
  cancelBtn.addEventListener("click", () => closeAssetPicker());
  footer.appendChild(cancelBtn);

  const useBtn = document.createElement("button");
  useBtn.type = "button";
  useBtn.className = "soft-btn accent asset-picker-use-btn";
  useBtn.textContent = t("animOverridesModalUse");
  useBtn.disabled = !selected;
  attachActivation(useBtn, () => {
    const currentSelected = getSelectedAnimationAsset();
    if (!currentSelected) return { status: "error", message: "no asset selected" };
    return runAnimationOverrideCommand(card, { file: currentSelected.name }).then((result) => {
      if (result && result.status === "ok") {
        closeAssetPicker();
        if (window.settingsAPI && typeof window.settingsAPI.previewAnimationOverride === "function") {
          window.settingsAPI.previewAnimationOverride({
            stateKey: previewStateForCard(card),
            file: currentSelected.name,
            durationMs: getAnimationPreviewDuration(currentSelected, card),
          }).then((previewResult) => {
            if (!previewResult || previewResult.status === "ok") return;
            showToast(t("toastSaveFailed") + previewResult.message, { error: true });
          }).catch((err) => {
            showToast(t("toastSaveFailed") + (err && err.message), { error: true });
          });
        }
      }
      return result;
    });
  });
  footer.appendChild(useBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  root.appendChild(overlay);
}

function renderAgentsTab(parent) {
  const h1 = document.createElement("h1");
  h1.textContent = t("agentsTitle");
  parent.appendChild(h1);

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = t("agentsSubtitle");
  parent.appendChild(subtitle);

  if (!agentMetadata || agentMetadata.length === 0) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.innerHTML = `<div class="placeholder-desc">${escapeHtml(t("agentsEmpty"))}</div>`;
    parent.appendChild(empty);
  } else {
    const rows = agentMetadata.flatMap((agent) => buildAgentRows(agent));
    parent.appendChild(buildSection("", rows));
  }

  parent.appendChild(buildAgentLauncherSection());
  parent.appendChild(buildHermesChatSection());
}

function buildHermesChatSection() {
  const section = document.createElement("section");
  section.className = "section";
  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = t("sectionHermesChat");
  section.appendChild(heading);
  const sub = document.createElement("p");
  sub.className = "subtitle";
  sub.textContent = t("hermesChatSubtitle");
  section.appendChild(sub);

  const wrap = document.createElement("div");
  wrap.className = "section-rows";

  // Command row
  wrap.appendChild(buildHermesTextRow({
    field: "command",
    labelKey: "rowHermesChatCommand",
    descKey: "rowHermesChatCommandDesc",
  }));

  // Args row (stored as newline-separated string for display)
  wrap.appendChild(buildHermesArgsRow());

  // Cwd row
  wrap.appendChild(buildHermesTextRow({
    field: "cwd",
    labelKey: "rowHermesChatCwd",
    descKey: "rowHermesChatCwdDesc",
  }));

  // Timeout row (displayed in seconds)
  wrap.appendChild(buildHermesTimeoutRow());

  // Action buttons row
  wrap.appendChild(buildHermesActionsRow());

  section.appendChild(wrap);
  return section;
}

function buildHermesTextRow({ field, labelKey, descKey }) {
  const row = document.createElement("div");
  row.className = "row";
  const text = document.createElement("div");
  text.className = "row-text";
  const label = document.createElement("span");
  label.className = "row-label";
  label.textContent = t(labelKey);
  text.appendChild(label);
  const desc = document.createElement("span");
  desc.className = "row-desc";
  desc.textContent = t(descKey);
  text.appendChild(desc);
  row.appendChild(text);
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "soft-input";
  input.value = String(readHermesChatPrefs()[field] || "");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.style.minWidth = "220px";
  input.addEventListener("blur", () => commitHermesChatText(field, input.value));
  ctrl.appendChild(input);
  row.appendChild(ctrl);
  return row;
}

function buildHermesArgsRow() {
  const row = document.createElement("div");
  row.className = "row";
  const text = document.createElement("div");
  text.className = "row-text";
  const label = document.createElement("span");
  label.className = "row-label";
  label.textContent = t("rowHermesChatArgs");
  text.appendChild(label);
  const desc = document.createElement("span");
  desc.className = "row-desc";
  desc.textContent = t("rowHermesChatArgsDesc");
  text.appendChild(desc);
  row.appendChild(text);
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "soft-input";
  const args = Array.isArray(readHermesChatPrefs().args) ? readHermesChatPrefs().args : [];
  input.value = args.join("\n");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.style.minWidth = "220px";
  input.addEventListener("blur", () => {
    const lines = input.value.split("\n").map((l) => l.trim()).filter(Boolean);
    commitHermesChatText("args", lines);
  });
  ctrl.appendChild(input);
  row.appendChild(ctrl);
  return row;
}

function buildHermesTimeoutRow() {
  const row = document.createElement("div");
  row.className = "row";
  const text = document.createElement("div");
  text.className = "row-text";
  const label = document.createElement("span");
  label.className = "row-label";
  label.textContent = t("rowHermesChatTimeout");
  text.appendChild(label);
  const desc = document.createElement("span");
  desc.className = "row-desc";
  desc.textContent = t("rowHermesChatTimeoutDesc");
  text.appendChild(desc);
  row.appendChild(text);
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const input = document.createElement("input");
  input.type = "number";
  input.className = "soft-input";
  input.value = Math.round((readHermesChatPrefs().timeoutMs || 180000) / 1000);
  input.min = 10;
  input.max = 600;
  input.style.width = "80px";
  input.addEventListener("blur", () => {
    const secs = parseInt(input.value, 10);
    if (!isNaN(secs) && secs >= 10 && secs <= 600) {
      commitHermesChatText("timeoutMs", secs * 1000);
    } else {
      input.value = Math.round(readHermesChatPrefs().timeoutMs / 1000);
    }
  });
  ctrl.appendChild(input);
  row.appendChild(ctrl);
  return row;
}

function buildHermesActionsRow() {
  const row = document.createElement("div");
  row.className = "row actions-row";
  // Test button
  const testBtn = document.createElement("button");
  testBtn.className = "btn-secondary";
  testBtn.textContent = t("actionTestHermesChat");
  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    testBtn.textContent = t("checkingForUpdates") || "…";
    try {
      const result = await window.settingsAPI.command("testHermesChat", {});
      if (result && result.status === "ok") {
        showToast(t("toastHermesTestOk"), { error: false });
      } else {
        const msg = (result && result.message) || "unknown";
        showToast(t("toastHermesTestFailed").replace("{msg}", msg), { error: true });
      }
    } catch (err) {
      showToast(t("toastHermesTestFailed").replace("{msg}", err && err.message), { error: true });
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = t("actionTestHermesChat");
    }
  });
  // Clear history button
  const clearBtn = document.createElement("button");
  clearBtn.className = "btn-secondary danger";
  clearBtn.textContent = t("actionClearHermesHistory");
  clearBtn.addEventListener("click", async () => {
    const result = await window.settingsAPI.command("clearHermesHistory", {});
    if (result && result.status === "ok") {
      showToast(t("toastHermesHistoryCleared"), { error: false });
    } else {
      showToast(t("toastSaveFailed") + " " + ((result && result.message) || "unknown"), { error: true });
    }
  });
  row.appendChild(testBtn);
  row.appendChild(clearBtn);
  return row;
}

function buildAgentLauncherSection() {
  const section = document.createElement("section");
  section.className = "section";
  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = t("sectionAgentLauncher");
  section.appendChild(heading);
  const sub = document.createElement("p");
  sub.className = "subtitle";
  sub.textContent = t("agentLauncherSubtitle");
  section.appendChild(sub);

  const wrap = document.createElement("div");
  wrap.className = "section-rows";
  wrap.appendChild(buildAgentLauncherEnabledRow());
  wrap.appendChild(buildAgentLauncherTextRow({
    field: "command",
    labelKey: "rowAgentLauncherCommand",
    descKey: "rowAgentLauncherCommandDesc",
  }));
  wrap.appendChild(buildAgentLauncherTextRow({
    field: "cwd",
    labelKey: "rowAgentLauncherCwd",
    descKey: "rowAgentLauncherCwdDesc",
  }));
  wrap.appendChild(buildAgentLauncherTriggerRow());
  section.appendChild(wrap);
  return section;
}

function buildAgentLauncherEnabledRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label"></span>` +
      `<span class="row-desc"></span>` +
    `</div>` +
    `<div class="row-control"><div class="switch" role="switch" tabindex="0"></div></div>`;
  row.querySelector(".row-label").textContent = t("rowAgentLauncherEnabled");
  row.querySelector(".row-desc").textContent = t("rowAgentLauncherEnabledDesc");
  const sw = row.querySelector(".switch");
  const on = readAgentLauncherPrefs().enabled;
  if (on) sw.classList.add("on");
  sw.setAttribute("aria-checked", on ? "true" : "false");
  attachActivation(sw, () =>
    commitAgentLauncher({ enabled: !readAgentLauncherPrefs().enabled })
  );
  return row;
}

function buildAgentLauncherTextRow({ field, labelKey, descKey }) {
  const row = document.createElement("div");
  row.className = "row";
  const text = document.createElement("div");
  text.className = "row-text";
  const label = document.createElement("span");
  label.className = "row-label";
  label.textContent = t(labelKey);
  text.appendChild(label);
  const desc = document.createElement("span");
  desc.className = "row-desc";
  desc.textContent = t(descKey);
  text.appendChild(desc);
  row.appendChild(text);
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "soft-input";
  input.value = String(readAgentLauncherPrefs()[field] || "");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.style.minWidth = "220px";
  input.style.flex = "1";
  input.addEventListener("blur", () => {
    const cur = readAgentLauncherPrefs();
    const raw = input.value;
    if (raw === String(cur[field] || "")) return;
    Promise.resolve(commitAgentLauncher({ [field]: raw })).then((result) => {
      if (!result || result.status !== "ok") {
        const msg = (result && result.message) || "unknown error";
        showToast(t("toastSaveFailed") + msg, { error: true });
        input.value = String(readAgentLauncherPrefs()[field] || "");
      }
    });
  });
  ctrl.appendChild(input);
  row.appendChild(ctrl);
  return row;
}

function buildAgentLauncherTriggerRow() {
  const row = document.createElement("div");
  row.className = "row";
  const text = document.createElement("div");
  text.className = "row-text";
  const label = document.createElement("span");
  label.className = "row-label";
  label.textContent = t("rowAgentLauncherTrigger");
  text.appendChild(label);
  row.appendChild(text);
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const sel = document.createElement("select");
  sel.className = "soft-input";
  const cur = readAgentLauncherPrefs().trigger;
  for (const opt of AGENT_LAUNCHER_TRIGGERS_UI) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = t(opt.labelKey);
    if (opt.value === cur) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    const v = sel.value;
    Promise.resolve(commitAgentLauncher({ trigger: v })).then((result) => {
      if (!result || result.status !== "ok") {
        const msg = (result && result.message) || "unknown error";
        showToast(t("toastSaveFailed") + msg, { error: true });
        sel.value = readAgentLauncherPrefs().trigger;
      }
    });
  });
  ctrl.appendChild(sel);
  row.appendChild(ctrl);
  return row;
}

function buildAgentRows(agent) {
  const rows = [
    buildAgentSwitchRow({
      agent,
      flag: "enabled",
      extraClass: null,
      buildText: (text) => {
        const label = document.createElement("span");
        label.className = "row-label";
        label.textContent = agent.name || agent.id;
        text.appendChild(label);
        const badges = document.createElement("span");
        badges.className = "row-desc agent-badges";
        const esKey = agent.eventSource === "log-poll" ? "eventSourceLogPoll"
          : agent.eventSource === "plugin-event" ? "eventSourcePlugin"
          : "eventSourceHook";
        const esBadge = document.createElement("span");
        esBadge.className = "agent-badge";
        esBadge.textContent = t(esKey);
        badges.appendChild(esBadge);
        if (agent.capabilities && agent.capabilities.permissionApproval) {
          const permBadge = document.createElement("span");
          permBadge.className = "agent-badge accent";
          permBadge.textContent = t("badgePermissionBubble");
          badges.appendChild(permBadge);
        }
        text.appendChild(badges);
      },
    }),
  ];
  const caps = agent.capabilities || {};
  if (caps.permissionApproval || caps.interactiveBubble) {
    rows.push(buildAgentSwitchRow({
      agent,
      flag: "permissionsEnabled",
      extraClass: "row-sub",
      buildText: (text) => {
        const label = document.createElement("span");
        label.className = "row-label";
        label.textContent = t("rowAgentPermissions");
        text.appendChild(label);
        const desc = document.createElement("span");
        desc.className = "row-desc";
        desc.textContent = t("rowAgentPermissionsDesc");
        text.appendChild(desc);
      },
    }));
  }
  return rows;
}

function buildAgentSwitchRow({ agent, flag, extraClass, buildText }) {
  const row = document.createElement("div");
  row.className = extraClass ? `row ${extraClass}` : "row";

  const text = document.createElement("div");
  text.className = "row-text";
  buildText(text);
  row.appendChild(text);

  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const sw = document.createElement("div");
  sw.className = "switch";
  sw.setAttribute("role", "switch");
  sw.setAttribute("tabindex", "0");
  const readFlag = () => {
    const entry = snapshot && snapshot.agents && snapshot.agents[agent.id];
    return entry ? entry[flag] !== false : true;
  };
  const on = readFlag();
  if (on) sw.classList.add("on");
  sw.setAttribute("aria-checked", on ? "true" : "false");
  attachActivation(sw, () =>
    window.settingsAPI.command("setAgentFlag", {
      agentId: agent.id,
      flag,
      value: !readFlag(),
    })
  );
  ctrl.appendChild(sw);
  row.appendChild(ctrl);
  return row;
}

function renderPlaceholder(parent) {
  const div = document.createElement("div");
  div.className = "placeholder";
  div.innerHTML =
    `<div class="placeholder-icon">\u{1F6E0}</div>` +
    `<div class="placeholder-title">${escapeHtml(t("placeholderTitle"))}</div>` +
    `<div class="placeholder-desc">${escapeHtml(t("placeholderDesc"))}</div>`;
  parent.appendChild(div);
}

function renderGeneralTab(parent) {
  const h1 = document.createElement("h1");
  h1.textContent = t("settingsTitle");
  parent.appendChild(h1);

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.textContent = t("settingsSubtitle");
  parent.appendChild(subtitle);

  // Section: Appearance
  parent.appendChild(buildSection(t("sectionAppearance"), [
    buildLanguageRow(),
    buildSwitchRow({
      key: "soundMuted",
      labelKey: "rowSound",
      descKey: "rowSoundDesc",
      // soundMuted is inverse: ON-switch means sound enabled.
      invert: true,
    }),
    buildMacTypingAwarenessRow(),
  ]));

  parent.appendChild(buildSection(t("sectionTranslation"), [
    buildTranslatorApiKeyRow(),
    buildTranslatorStatusRow(),
  ]));

  // Section: Startup
  const manageClaudeHooksEnabled = !!(snapshot && snapshot.manageClaudeHooksAutomatically);
  parent.appendChild(buildSection(t("sectionStartup"), [
    buildSwitchRow({
      key: "manageClaudeHooksAutomatically",
      labelKey: "rowManageClaudeHooks",
      descKey: "rowManageClaudeHooksDesc",
      descExtraKey: "rowManageClaudeHooksOffNote",
      onToggle: ({ nextRaw }) => confirmDisableClaudeHookManagement(nextRaw),
      actionButton: {
        labelKey: "actionDisconnectClaudeHooks",
        invoke: () => runDisconnectClaudeHooks(),
      },
    }),
    buildSwitchRow({
      key: "openAtLogin",
      labelKey: "rowOpenAtLogin",
      descKey: "rowOpenAtLoginDesc",
    }),
    buildSwitchRow({
      key: "autoStartWithClaude",
      labelKey: "rowStartWithClaude",
      descKey: "rowStartWithClaudeDesc",
      descExtraKey: manageClaudeHooksEnabled ? null : "rowStartWithClaudeDisabledDesc",
      disabled: !manageClaudeHooksEnabled,
    }),
  ]));

  // Section: Bubbles
  parent.appendChild(buildSection(t("sectionBubbles"), [
    buildSwitchRow({
      key: "bubbleFollowPet",
      labelKey: "rowBubbleFollow",
      descKey: "rowBubbleFollowDesc",
    }),
    buildSwitchRow({
      key: "hideBubbles",
      labelKey: "rowHideBubbles",
      descKey: "rowHideBubblesDesc",
    }),
    buildSwitchRow({
      key: "showSessionId",
      labelKey: "rowShowSessionId",
      descKey: "rowShowSessionIdDesc",
    }),
  ]));

  parent.appendChild(buildSection(t("sectionDiagnostics"), [
    buildTranslatorDiagnosticsRow(),
    buildTerminalDiagnosticsRow(),
  ]));

  parent.appendChild(buildSection(t("sectionGlobalActivity"), [
    buildGlobalActivityEnabledRow(),
    buildGlobalActivityStatusRow(),
    buildGlobalRuleRow("clipboardReaction", "rowGlobalRuleClipboard"),
    buildGlobalRuleRow("notificationReaction", "rowGlobalRuleNotification"),
    buildGlobalRuleRow("presenceWake", "rowGlobalRulePresence"),
    buildGlobalRuleRow("mediaPlaybackReaction", "rowGlobalRuleMedia"),
    buildGlobalRuleRow("browserReadingReaction", "rowGlobalRuleBrowser"),
    buildGlobalActivityDiagnosticsRow(),
  ]));

  parent.appendChild(buildSection(t("sectionTimeCheckins"), [
    buildSwitchRow({
      key: "timeCheckinEnabled",
      labelKey: "rowTimeCheckinEnabled",
      descKey: "rowTimeCheckinEnabledDesc",
    }),
    buildTimeCheckinStaticRow("rowTimeCheckinSchedule", "rowTimeCheckinScheduleDesc"),
    buildTimeCheckinTextRow({
      key: "timeCheckinPreviewClipboardWindowMinutes",
      labelKey: "rowTimeCheckinWindow",
      descKey: "rowTimeCheckinWindowDesc",
      format: (value) => String(value || 60),
      parse: (value) => Number.parseInt(value, 10),
    }),
    buildTimeCheckinGeneratorRow("cwd", "rowTimeCheckinGeneratorCwd", "rowTimeCheckinGeneratorCwdDesc"),
    buildTimeCheckinGeneratorRow("command", "rowTimeCheckinGeneratorCommand", "rowTimeCheckinGeneratorCommandDesc"),
    buildTimeCheckinGeneratorArgsRow(),
    buildTimeCheckinGeneratorRow("timeoutMs", "rowTimeCheckinGeneratorTimeout", "rowTimeCheckinGeneratorTimeoutDesc", {
      format: (value) => String(value || 30000),
      parse: (value) => Number.parseInt(value, 10),
    }),
    buildTimeCheckinStatusRow(),
    buildTimeCheckinActionsRow(),
  ]));

  parent.appendChild(buildSection(t("sectionProviderUsage"), [
    buildSwitchRow({
      key: "providerUsageHudEnabled",
      labelKey: "rowProviderUsageHudEnabled",
      descKey: "rowProviderUsageHudEnabledDesc",
    }),
    buildSwitchRow({
      key: "providerUsageRefreshEnabled",
      labelKey: "rowProviderUsageRefreshEnabled",
      descKey: "rowProviderUsageRefreshEnabledDesc",
    }),
    buildSwitchRow({
      key: "providerUsageMiniMaxEnabled",
      labelKey: "rowProviderUsageMiniMaxEnabled",
      descKey: "rowProviderUsageMiniMaxEnabledDesc",
    }),
    buildTimeCheckinTextRow({
      key: "providerUsageStaleAfterMinutes",
      labelKey: "rowProviderUsageStaleAfter",
      descKey: "rowProviderUsageStaleAfterDesc",
      format: (value) => String(value || 30),
      parse: (value) => Number.parseInt(value, 10),
    }),
    buildProviderUsageStatusRow(),
    buildProviderUsageActionsRow(),
  ]));
}

function getMacTypingStatusDescKey() {
  const status = snapshot && snapshot.macTypingPermissionStatus;
  if (status === "granted") return "rowMacTypingStatusGranted";
  if (status === "denied") return "rowMacTypingStatusDenied";
  if (status === "error") return "rowMacTypingStatusError";
  return "rowMacTypingStatusUnavailable";
}

function buildMacTypingAwarenessRow() {
  const unsupported = (snapshot && snapshot.macTypingPermissionStatus) === "unsupported";
  return buildSwitchRow({
    key: "macTypingAwarenessEnabled",
    labelKey: "rowMacTypingAwareness",
    descKey: "rowMacTypingAwarenessDesc",
    descExtraKey: unsupported ? "rowMacTypingAwarenessUnsupported" : getMacTypingStatusDescKey(),
    disabled: unsupported,
    actionButton: unsupported ? null : {
      labelKey: "actionOpenMacTypingPrivacy",
      invoke: () => window.settingsAPI.openMacTypingPrivacy(),
    },
  });
}

function buildTranslatorApiKeyRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("rowTranslateApiKey"))}</span>` +
      `<span class="row-desc">${escapeHtml(t("rowTranslateApiKeyDesc"))}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  ctrl.style.minWidth = "260px";
  const input = document.createElement("input");
  input.type = "password";
  input.className = "soft-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "sk-...";
  input.value = String((snapshot && snapshot.translateApiKey) || "");
  input.style.minWidth = "220px";
  input.style.flex = "1";
  input.addEventListener("blur", () => {
    Promise.resolve(window.settingsAPI.update("translateApiKey", input.value)).then((result) => {
      if (!result || result.status !== "ok") {
        const msg = (result && result.message) || "unknown error";
        showToast(t("toastSaveFailed") + msg, { error: true });
        input.value = String((snapshot && snapshot.translateApiKey) || "");
      }
    });
  });
  ctrl.appendChild(input);
  row.appendChild(ctrl);
  return row;
}

function getTranslatorHealthLabel() {
  const health = snapshot && snapshot.translatorStatus && snapshot.translatorStatus.health;
  if (health === "ok") return t("rowTranslatorHealthOk");
  if (health === "error") return t("rowTranslatorHealthError");
  return t("rowTranslatorHealthUnknown");
}

function buildTranslatorStatusRow() {
  const translator = snapshot && snapshot.translatorStatus;
  const row = document.createElement("div");
  row.className = "row";
  const statusLine = translator && translator.configured
    ? `${t("rowTranslatorStatusConfigured")} · ${getTranslatorHealthLabel()}`
    : `${t("rowTranslatorStatusMissing")} · ${getTranslatorHealthLabel()}`;
  const lastError = translator && translator.lastError ? translator.lastError : t("rowTranslatorLastErrorNone");
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("rowTranslatorStatus"))}</span>` +
      `<span class="row-desc">${escapeHtml(statusLine)}</span>` +
      `<span class="row-desc">${escapeHtml(lastError)}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const backend = document.createElement("span");
  backend.className = "row-desc";
  backend.textContent = `${t("rowTranslatorBackend")}: ${t("rowTranslatorBackendDesc")}`;
  ctrl.appendChild(backend);
  row.appendChild(ctrl);
  return row;
}

function runSettingsAction(invoker) {
  return Promise.resolve(invoker()).then((result) => {
    if (result && result.status === "ok" && result.message) {
      showToast(result.message || t("toastActionOk"));
    }
    return result;
  });
}

function buildActionButton(labelKey, invoke) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "soft-btn accent";
  btn.textContent = t(labelKey);
  attachActivation(btn, () => runSettingsAction(invoke));
  return btn;
}

function buildTranslatorDiagnosticsRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("rowTranslatorBackend"))}</span>` +
      `<span class="row-desc">${escapeHtml(t("rowTranslatorBackendDesc"))}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  ctrl.style.gap = "8px";
  ctrl.style.flexWrap = "wrap";
  ctrl.appendChild(buildActionButton("actionTestTranslator", () => window.settingsAPI.runTranslatorHealthCheck()));
  ctrl.appendChild(buildActionButton("actionShowBubbleLoading", () => window.settingsAPI.showTranslateBubbleTest("loading")));
  ctrl.appendChild(buildActionButton("actionShowBubbleSuccess", () => window.settingsAPI.showTranslateBubbleTest("success")));
  ctrl.appendChild(buildActionButton("actionShowBubbleError", () => window.settingsAPI.showTranslateBubbleTest("error")));
  row.appendChild(ctrl);
  return row;
}

function buildTerminalDiagnosticsRow() {
  const terminal = snapshot && snapshot.terminalDiagnosticsStatus;
  const supported = !!(terminal && terminal.supported);
  const statusText = !supported
    ? t("rowTerminalStatusUnsupported")
    : terminal && terminal.lastResult === "ok"
      ? t("rowTerminalStatusOk")
      : terminal && terminal.lastResult === "error"
        ? t("rowTerminalStatusError")
        : t("rowTerminalStatusUnknown");
  const detailText = terminal && terminal.lastError
    ? terminal.lastError
    : terminal && terminal.lastTargetLabel
      ? terminal.lastTargetLabel
      : t("rowTerminalStatusDesc");
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("rowTerminalStatus"))}</span>` +
      `<span class="row-desc">${escapeHtml(statusText)}</span>` +
      `<span class="row-desc">${escapeHtml(detailText)}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "soft-btn accent";
  btn.textContent = t("actionTestTerminalFocus");
  if (!supported) {
    btn.disabled = true;
  } else {
    attachActivation(btn, () => runSettingsAction(() => window.settingsAPI.runTerminalActionCheck()));
  }
  ctrl.appendChild(btn);
  row.appendChild(ctrl);
  return row;
}

function getGlobalActivitySnapshot() {
  return snapshot && snapshot.globalActivityStatus ? snapshot.globalActivityStatus : null;
}

function getGlobalActivityRuleState(ruleKey) {
  const rules = snapshot && snapshot.globalActivityRules;
  return !!(rules && rules[ruleKey]);
}

function buildGlobalActivityEnabledRow() {
  const supported = !!(getGlobalActivitySnapshot() && getGlobalActivitySnapshot().supported);
  return buildSwitchRow({
    key: "globalActivityEnabled",
    labelKey: "rowGlobalActivity",
    descKey: "rowGlobalActivityDesc",
    descExtraKey: supported ? null : "rowGlobalActivityUnsupported",
    disabled: !supported,
  });
}

function buildGlobalActivityStatusRow() {
  const status = getGlobalActivitySnapshot();
  const activeText = status && status.activeRuleId
    ? t("rowGlobalActivityStatusActive").replace("{rule}", status.activeRuleId)
    : t("rowGlobalActivityStatusIdle");
  const lastError = status && status.lastError ? status.lastError : t("rowGlobalActivityLastErrorNone");
  const collectors = status && status.collectorStatus
    ? [
        `${t("rowGlobalCollectorFrontmost")}: ${status.collectorStatus.frontmostApp || "unknown"}`,
        `${t("rowGlobalCollectorClipboard")}: ${status.collectorStatus.clipboard || "unknown"}`,
        `${t("rowGlobalCollectorNotification")}: ${status.collectorStatus.notifications || "unknown"}`,
        `${t("rowGlobalCollectorMedia")}: ${status.collectorStatus.media || "unknown"}`,
        `${t("rowGlobalCollectorBrowser")}: ${status.collectorStatus.browser || "unknown"}`,
      ].join(" · ")
    : "";
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("rowGlobalActivityStatus"))}</span>` +
      `<span class="row-desc">${escapeHtml(activeText)}</span>` +
      `<span class="row-desc">${escapeHtml(lastError)}</span>` +
      (collectors ? `<span class="row-desc">${escapeHtml(collectors)}</span>` : "") +
    `</div>`;
  return row;
}

function buildGlobalRuleRow(ruleKey, labelKey) {
  const supported = !!(getGlobalActivitySnapshot() && getGlobalActivitySnapshot().supported);
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t(labelKey))}</span>` +
      `<span class="row-desc">${escapeHtml(t("rowGlobalActivityDesc"))}</span>` +
    `</div>` +
    `<div class="row-control"><div class="switch" role="switch" tabindex="0"></div></div>`;
  const sw = row.querySelector(".switch");
  const visualOn = getGlobalActivityRuleState(ruleKey);
  if (visualOn) sw.classList.add("on");
  sw.setAttribute("aria-checked", visualOn ? "true" : "false");
  if (!supported) {
    sw.classList.add("disabled");
    sw.setAttribute("aria-disabled", "true");
    sw.tabIndex = -1;
    return row;
  }
  attachActivation(sw, () => {
    const current = snapshot && snapshot.globalActivityRules ? snapshot.globalActivityRules : {};
    return window.settingsAPI.update("globalActivityRules", {
      ...current,
      [ruleKey]: !getGlobalActivityRuleState(ruleKey),
    });
  });
  return row;
}

function buildGlobalActivityDiagnosticsRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("sectionGlobalActivity"))}</span>` +
      `<span class="row-desc">${escapeHtml(t("rowGlobalActivityDesc"))}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  ctrl.style.gap = "8px";
  ctrl.style.flexWrap = "wrap";
  ctrl.appendChild(buildActionButton("actionTestGlobalClipboard", () => window.settingsAPI.runGlobalActivityTest("clipboardReaction")));
  ctrl.appendChild(buildActionButton("actionTestGlobalReading", () => window.settingsAPI.runGlobalActivityTest("browserReadingReaction")));
  ctrl.appendChild(buildActionButton("actionTestGlobalListening", () => window.settingsAPI.runGlobalActivityTest("mediaPlaybackReaction")));
  row.appendChild(ctrl);
  return row;
}

function readTimeCheckinGenerator() {
  const cfg = snapshot && snapshot.timeCheckinGenerator;
  return cfg && typeof cfg === "object"
    ? cfg
    : { cwd: "", command: "", args: [], timeoutMs: 30000 };
}

function commitTimeCheckinGenerator(patch) {
  const current = readTimeCheckinGenerator();
  return window.settingsAPI.update("timeCheckinGenerator", {
    ...current,
    ...patch,
  });
}

function buildTimeCheckinStaticRow(labelKey, descKey) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t(labelKey))}</span>` +
      `<span class="row-desc">${escapeHtml(t(descKey))}</span>` +
    `</div>`;
  return row;
}

function buildTimeCheckinTextRow({ key, labelKey, descKey, format, parse }) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t(labelKey))}</span>` +
      `<span class="row-desc">${escapeHtml(t(descKey))}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "soft-input";
  input.value = format(snapshot && snapshot[key]);
  input.addEventListener("blur", () => {
    const next = parse(input.value);
    Promise.resolve(window.settingsAPI.update(key, next)).then((result) => {
      if (!result || result.status !== "ok") {
        const msg = (result && result.message) || "unknown error";
        showToast(t("toastSaveFailed") + msg, { error: true });
        input.value = format(snapshot && snapshot[key]);
      }
    });
  });
  ctrl.appendChild(input);
  row.appendChild(ctrl);
  return row;
}

function buildTimeCheckinGeneratorRow(field, labelKey, descKey, options = {}) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t(labelKey))}</span>` +
      `<span class="row-desc">${escapeHtml(t(descKey))}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  ctrl.style.minWidth = "260px";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "soft-input";
  const current = readTimeCheckinGenerator();
  input.value = options.format ? options.format(current[field]) : String(current[field] || "");
  input.addEventListener("blur", () => {
    const rawValue = options.parse ? options.parse(input.value) : input.value;
    Promise.resolve(commitTimeCheckinGenerator({ [field]: rawValue })).then((result) => {
      if (!result || result.status !== "ok") {
        const msg = (result && result.message) || "unknown error";
        showToast(t("toastSaveFailed") + msg, { error: true });
        const fresh = readTimeCheckinGenerator();
        input.value = options.format ? options.format(fresh[field]) : String(fresh[field] || "");
      }
    });
  });
  ctrl.appendChild(input);
  row.appendChild(ctrl);
  return row;
}

function buildTimeCheckinGeneratorArgsRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("rowTimeCheckinGeneratorArgs"))}</span>` +
      `<span class="row-desc">${escapeHtml(t("rowTimeCheckinGeneratorArgsDesc"))}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "soft-input";
  input.style.minWidth = "280px";
  input.value = readTimeCheckinGenerator().args.join(" ");
  input.addEventListener("blur", () => {
    const nextArgs = input.value.trim() ? input.value.trim().split(/\s+/) : [];
    Promise.resolve(commitTimeCheckinGenerator({ args: nextArgs })).then((result) => {
      if (!result || result.status !== "ok") {
        const msg = (result && result.message) || "unknown error";
        showToast(t("toastSaveFailed") + msg, { error: true });
        input.value = readTimeCheckinGenerator().args.join(" ");
      }
    });
  });
  ctrl.appendChild(input);
  row.appendChild(ctrl);
  return row;
}

function buildTimeCheckinStatusRow() {
  const status = snapshot && snapshot.timeCheckinStatus;
  let stateText = t("rowTimeCheckinStatusIdle");
  if (status && status.lastResult === "ok") stateText = t("rowTimeCheckinStatusOk");
  else if (status && status.lastResult === "cleaned") stateText = t("rowTimeCheckinStatusCleaned");
  else if (status && status.lastResult === "fallback") stateText = t("rowTimeCheckinStatusFallback");
  else if (status && status.lastResult === "error") stateText = t("rowTimeCheckinStatusError");
  const detailBits = [];
  if (status && status.nextRunAt) detailBits.push(`Next: ${new Date(status.nextRunAt).toLocaleString()}`);
  if (status && status.lastRunAt) detailBits.push(`Last: ${new Date(status.lastRunAt).toLocaleString()}`);
  if (status && status.lastError) detailBits.push(status.lastError);
  if (status && status.lastMessagePreview) detailBits.push(status.lastMessagePreview);
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("rowTimeCheckinStatus"))}</span>` +
      `<span class="row-desc">${escapeHtml(stateText)}</span>` +
      (detailBits.length ? `<span class="row-desc">${escapeHtml(detailBits.join(" · "))}</span>` : "") +
    `</div>`;
  return row;
}

function buildTimeCheckinActionsRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("sectionTimeCheckins"))}</span>` +
      `<span class="row-desc">${escapeHtml(t("rowTimeCheckinEnabledDesc"))}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  ctrl.style.gap = "8px";
  ctrl.style.flexWrap = "wrap";
  ctrl.appendChild(buildActionButton("actionRunTimeCheckinNow", () => window.settingsAPI.runTimeCheckinNow()));
  ctrl.appendChild(buildActionButton("actionPreviewTimeCheckinContext", () => window.settingsAPI.previewTimeCheckinContext()));
  row.appendChild(ctrl);
  return row;
}

function buildProviderUsageStatusRow() {
  const status = snapshot && snapshot.providerUsageStatus;
  let stateText = t("rowProviderUsageStatusIdle");
  if (status && status.lastResult === "ok") stateText = t("rowProviderUsageStatusOk");
  else if (status && status.lastResult === "partial") stateText = t("rowProviderUsageStatusPartial");
  else if (status && status.lastResult === "fallback") stateText = t("rowProviderUsageStatusFallback");
  else if (status && status.lastResult === "error") stateText = t("rowProviderUsageStatusError");
  const detailBits = [];
  if (status && status.nextRunAt) detailBits.push(`Next: ${new Date(status.nextRunAt).toLocaleString()}`);
  if (status && status.lastRunAt) detailBits.push(`Last: ${new Date(status.lastRunAt).toLocaleString()}`);
  if (status && status.lastSummary) detailBits.push(status.lastSummary);
  if (status && status.lastError) detailBits.push(status.lastError);
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("rowProviderUsageStatus"))}</span>` +
      `<span class="row-desc">${escapeHtml(stateText)}</span>` +
      (detailBits.length ? `<span class="row-desc">${escapeHtml(detailBits.join(" · "))}</span>` : "") +
    `</div>`;
  return row;
}

function buildProviderUsageActionsRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label">${escapeHtml(t("sectionProviderUsage"))}</span>` +
      `<span class="row-desc">${escapeHtml(t("rowProviderUsageRefreshEnabledDesc"))}</span>` +
    `</div>`;
  const ctrl = document.createElement("div");
  ctrl.className = "row-control";
  ctrl.style.gap = "8px";
  ctrl.style.flexWrap = "wrap";
  ctrl.appendChild(buildActionButton("actionRefreshProviderUsageNow", () => window.settingsAPI.runProviderUsageRefreshNow()));
  ctrl.appendChild(buildActionButton("actionPreviewProviderUsageHud", () => window.settingsAPI.previewProviderUsageHud()));
  row.appendChild(ctrl);
  return row;
}

function buildSection(title, rows) {
  const section = document.createElement("section");
  section.className = "section";
  if (title) {
    const heading = document.createElement("h2");
    heading.className = "section-title";
    heading.textContent = title;
    section.appendChild(heading);
  }
  const wrap = document.createElement("div");
  wrap.className = "section-rows";
  for (const row of rows) wrap.appendChild(row);
  section.appendChild(wrap);
  return section;
}

// Wire click + Space/Enter keydown on any element to an async invoker that
// returns a `Promise<{status, message?}>`. Shared by switches and cards.
function attachActivation(el, invoke) {
  const run = () => {
    if (el.classList.contains("pending")) return;
    el.classList.add("pending");
    Promise.resolve()
      .then(invoke)
      .then((result) => {
        el.classList.remove("pending");
        if (!result || result.status !== "ok") {
          const msg = (result && result.message) || "unknown error";
          showToast(t("toastSaveFailed") + msg, { error: true });
        }
      })
      .catch((err) => {
        el.classList.remove("pending");
        showToast(t("toastSaveFailed") + (err && err.message), { error: true });
      });
  };
  el.addEventListener("click", run);
  el.addEventListener("keydown", (ev) => {
    if (ev.key === " " || ev.key === "Enter") {
      ev.preventDefault();
      run();
    }
  });
}

function buildSwitchRow({
  key,
  labelKey,
  descKey,
  invert = false,
  disabled = false,
  descExtraKey = null,
  onToggle = null,
  actionButton = null,
}) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label"></span>` +
      `<span class="row-desc"></span>` +
    `</div>` +
    `<div class="row-control"><div class="switch" role="switch" tabindex="0"></div></div>`;
  row.querySelector(".row-label").textContent = t(labelKey);
  const text = row.querySelector(".row-text");
  row.querySelector(".row-desc").textContent = t(descKey);
  if (descExtraKey) {
    const extra = document.createElement("span");
    extra.className = "row-desc";
    extra.textContent = t(descExtraKey);
    text.appendChild(extra);
  }
  const sw = row.querySelector(".switch");
  const control = row.querySelector(".row-control");
  const rawValue = !!(snapshot && snapshot[key]);
  const visualOn = invert ? !rawValue : rawValue;
  if (visualOn) sw.classList.add("on");
  sw.setAttribute("aria-checked", visualOn ? "true" : "false");
  if (actionButton) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "soft-btn accent";
    btn.textContent = t(actionButton.labelKey);
    control.insertBefore(btn, sw);
    attachActivation(btn, actionButton.invoke);
  }
  if (disabled) {
    sw.classList.add("disabled");
    sw.setAttribute("aria-disabled", "true");
    sw.tabIndex = -1;
    return row;
  }
  // No optimistic update — visual state flips on broadcast, not on click.
  // If the action fails, the broadcast never fires and the switch stays.
  attachActivation(sw, () => {
    const currentRaw = !!(snapshot && snapshot[key]);
    const currentVisual = invert ? !currentRaw : currentRaw;
    const nextRaw = invert ? currentVisual : !currentVisual;
    if (typeof onToggle === "function") {
      return onToggle({ currentRaw, currentVisual, nextRaw });
    }
    return window.settingsAPI.update(key, nextRaw);
  });
  return row;
}

function confirmDisableClaudeHookManagement(nextRaw) {
  if (nextRaw) return window.settingsAPI.update("manageClaudeHooksAutomatically", true);
  if (!window.settingsAPI || typeof window.settingsAPI.confirmDisableClaudeHooks !== "function") {
    return window.settingsAPI.update("manageClaudeHooksAutomatically", false);
  }
  return window.settingsAPI.confirmDisableClaudeHooks().then((result) => {
    if (!result || result.choice === "cancel") return { status: "ok", noop: true };
    if (result.choice === "disconnect") return window.settingsAPI.command("uninstallHooks");
    return window.settingsAPI.update("manageClaudeHooksAutomatically", false);
  });
}

function runDisconnectClaudeHooks() {
  if (!window.settingsAPI || typeof window.settingsAPI.command !== "function") {
    return Promise.resolve({ status: "error", message: "settings API unavailable" });
  }
  if (typeof window.settingsAPI.confirmDisconnectClaudeHooks !== "function") {
    return window.settingsAPI.command("uninstallHooks");
  }
  return window.settingsAPI.confirmDisconnectClaudeHooks().then((result) => {
    if (!result || !result.confirmed) return { status: "ok", noop: true };
    return window.settingsAPI.command("uninstallHooks");
  });
}

function buildLanguageRow() {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<div class="row-text">` +
      `<span class="row-label"></span>` +
      `<span class="row-desc"></span>` +
    `</div>` +
      `<div class="row-control">` +
        `<div class="segmented" role="tablist">` +
          `<button data-lang="en"></button>` +
          `<button data-lang="zh"></button>` +
        `</div>` +
      `</div>`;
  row.querySelector(".row-label").textContent = t("rowLanguage");
  row.querySelector(".row-desc").textContent = t("rowLanguageDesc");
  const buttons = row.querySelectorAll(".segmented button");
  buttons[0].textContent = t("langEnglish");
  buttons[1].textContent = t("langChinese");
  const current = (snapshot && snapshot.lang) || "en";
  for (const btn of buttons) {
    if (btn.dataset.lang === current) btn.classList.add("active");
    btn.addEventListener("click", () => {
      const next = btn.dataset.lang;
      if (next === ((snapshot && snapshot.lang) || "en")) return;
      window.settingsAPI.update("lang", next).then((result) => {
        if (!result || result.status !== "ok") {
          const msg = (result && result.message) || "unknown error";
          showToast(t("toastSaveFailed") + msg, { error: true });
        }
      }).catch((err) => {
        showToast(t("toastSaveFailed") + (err && err.message), { error: true });
      });
    });
  }
  return row;
}

// ── Boot ──
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

window.settingsAPI.onChanged((payload) => {
  if (payload && payload.snapshot) {
    snapshot = payload.snapshot;
  } else if (payload && payload.changes && snapshot) {
    snapshot = { ...snapshot, ...payload.changes };
  }
  // Guard against an early broadcast that lands before `getSnapshot()`
  // resolves — rendering with a null snapshot blanks the UI and the
  // initial render later would need to re-fetch static language state.
  if (!snapshot) return;
  const changes = payload && payload.changes;
  const needsAnimOverridesRefresh = !!(changes && (
    "theme" in changes || "themeVariant" in changes || "themeOverrides" in changes
  ));
  if (needsAnimOverridesRefresh) animationOverridesData = null;
  // Patch `active` in place when only `theme` changed — cheaper than
  // a full refetch. `themeOverrides` changes (e.g. removeTheme cleanup)
  // can alter the list shape, so those still refetch.
  if (changes && "themeOverrides" in changes) {
    // 只有 theme tab 关心 list（removeTheme cleanup 可能改 list 形态）。
    // animMap tab 的开关直接从 snapshot.themeOverrides 读，不用 refetch。
    if (activeTab === "theme") {
      fetchThemes().then(() => {
        renderSidebar();
        renderContent();
      });
      return;
    }
    if (activeTab === "animOverrides" || assetPickerState) {
      fetchAnimationOverridesData().then(() => {
        normalizeAssetPickerSelection();
        renderSidebar();
        renderContent();
        renderAssetPickerModal();
      });
      return;
    }
    renderSidebar();
    renderContent();
    return;
  }
  if (needsAnimOverridesRefresh && (activeTab === "animOverrides" || assetPickerState)) {
    fetchAnimationOverridesData().then(() => {
      normalizeAssetPickerSelection();
      renderSidebar();
      renderContent();
      renderAssetPickerModal();
    });
    return;
  }
  if (changes && "theme" in changes && themeList) {
    themeList = themeList.map((t) => ({ ...t, active: t.id === changes.theme }));
  }
  renderSidebar();
  renderContent();
});

window.settingsAPI.getSnapshot().then((snap) => {
  snapshot = snap || {};
  renderSidebar();
  renderContent();
});

// Fetch static agent metadata once at boot. It's a pure lookup from
// agents/registry.js — no runtime state — so there's no refresh loop.
if (typeof window.settingsAPI.listAgents === "function") {
  window.settingsAPI
    .listAgents()
    .then((list) => {
      agentMetadata = Array.isArray(list) ? list : [];
      if (activeTab === "agents") renderContent();
    })
    .catch((err) => {
      console.warn("settings: listAgents failed", err);
      agentMetadata = [];
    });
}
