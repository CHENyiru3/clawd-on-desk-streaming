# 状态映射

[返回 README](../README.zh-CN.md)

| 事件 | 状态 | 动画 | Clawd |
|---|---|---|---|
| 无活动 | 待机 | 眼球跟踪 | <img src="../assets/gif/clawd-idle.gif" width="160"> |
| 无活动（随机） | 待机 | 看书 / 巡逻 | <img src="../assets/gif/clawd-idle-reading.gif" width="160"> |
| UserPromptSubmit | 思考 | 思考泡泡 | <img src="../assets/gif/clawd-thinking.gif" width="160"> |
| PreToolUse / PostToolUse | 工作（打字） | 打字 | <img src="../assets/gif/clawd-typing.gif" width="160"> |
| PreToolUse（3+ 会话） | 工作（建造） | 建造 | <img src="../assets/gif/clawd-building.gif" width="160"> |
| SubagentStart（1 个） | 杂耍 | 杂耍 | <img src="../assets/gif/clawd-juggling.gif" width="160"> |
| SubagentStart（2+） | 指挥 | 指挥 | <img src="../assets/gif/clawd-conducting.gif" width="160"> |
| PostToolUseFailure | 报错 | 报错 | <img src="../assets/gif/clawd-error.gif" width="160"> |
| Stop / PostCompact | 注意 | 开心 | <img src="../assets/gif/clawd-happy.gif" width="160"> |
| PermissionRequest | 通知 | 警报 | <img src="../assets/gif/clawd-notification.gif" width="160"> |
| PreCompact | 扫地 | 扫地 | <img src="../assets/gif/clawd-sweeping.gif" width="160"> |
| WorktreeCreate | 搬运 | 搬箱子 | <img src="../assets/gif/clawd-carrying.gif" width="160"> |
| 60 秒无事件 | 睡觉 | 睡眠 | <img src="../assets/gif/clawd-sleeping.gif" width="160"> |

## 极简模式

拖到屏幕右边缘（或右键 →"极简模式"）进入——半身露出在屏幕边缘，悬停时探出来。

| 触发 | 极简反应 | Clawd |
|---|---|---|
| 默认 | 呼吸 + 眨眼 + 眼球追踪 | <img src="../assets/gif/clawd-mini-idle.gif" width="100"> |
| 鼠标悬停 | 探出身体 + 招手 | <img src="../assets/gif/clawd-mini-peek.gif" width="100"> |
| 通知 / 权限请求 | 警报弹出 | <img src="../assets/gif/clawd-mini-alert.gif" width="100"> |
| 任务完成 | 开心庆祝 | <img src="../assets/gif/clawd-mini-happy.gif" width="100"> |

## 点击反应

彩蛋——试试双击、连点 4 下、或反复戳 Clawd，会有隐藏反应。
