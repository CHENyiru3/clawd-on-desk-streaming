# State Mapping

[Back to README](../README.md)

Events from all agents (Claude Code hooks, Codex JSONL, Copilot hooks) map to the same animation states:

`composing` is the exception: it is a macOS-only system signal based on keyboard activity, not an agent hook. It stays below all agent-active states and requires Input Monitoring permission.

| Agent Event | State | Animation | Clawd |
|---|---|---|---|
| Idle (no activity) | idle | Eye-tracking follow | <img src="../assets/gif/clawd-idle.gif" width="160"> |
| Idle (random) | idle | Reading / patrol | <img src="../assets/gif/clawd-idle-reading.gif" width="160"> |
| macOS keyboard activity | composing | Light pre-submit cue | Falls back to thinking if the theme has no `composing` asset |
| UserPromptSubmit | thinking | Thought bubble | <img src="../assets/gif/clawd-thinking.gif" width="160"> |
| PreToolUse / PostToolUse | working (typing) | Typing | <img src="../assets/gif/clawd-typing.gif" width="160"> |
| PreToolUse (3+ sessions) | working (building) | Building | <img src="../assets/gif/clawd-building.gif" width="160"> |
| SubagentStart (1) | juggling | Juggling | <img src="../assets/gif/clawd-juggling.gif" width="160"> |
| SubagentStart (2+) | conducting | Conducting | <img src="../assets/gif/clawd-conducting.gif" width="160"> |
| PostToolUseFailure | error | Error | <img src="../assets/gif/clawd-error.gif" width="160"> |
| Stop / PostCompact | attention | Happy | <img src="../assets/gif/clawd-happy.gif" width="160"> |
| PermissionRequest | notification | Alert | <img src="../assets/gif/clawd-notification.gif" width="160"> |
| PreCompact | sweeping | Sweeping | <img src="../assets/gif/clawd-sweeping.gif" width="160"> |
| WorktreeCreate | carrying | Carrying | <img src="../assets/gif/clawd-carrying.gif" width="160"> |
| 60s no events | sleeping | Sleep | <img src="../assets/gif/clawd-sleeping.gif" width="160"> |

## Mini Mode

Drag to the right screen edge (or right-click → "Mini Mode") to enter mini mode — half-body visible at screen edge, peeking out on hover.

| Trigger | Mini Reaction | Clawd |
|---|---|---|
| Default | Breathing + blinking + eye tracking | <img src="../assets/gif/clawd-mini-idle.gif" width="100"> |
| Hover | Peek out + wave | <img src="../assets/gif/clawd-mini-peek.gif" width="100"> |
| Notification | Alert pop | <img src="../assets/gif/clawd-mini-alert.gif" width="100"> |
| Task complete | Happy celebration | <img src="../assets/gif/clawd-mini-happy.gif" width="100"> |

## Click Reactions

Easter eggs — try double-clicking, rapid 4-clicks, or poking Clawd repeatedly to discover hidden reactions.
