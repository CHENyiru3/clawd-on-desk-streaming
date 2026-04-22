# Clawd on Desk Spec

This file is the durable project spec for AI agents and human maintainers. It should explain what the project is trying to accomplish and why those choices matter. It should avoid low-level implementation decisions unless they are constraints that protect product quality, user trust, or cross-platform behavior.

Use small, focused updates to this file when product intent changes. The goal is to reduce context decay, keep agent work aligned with the project mission, and preserve intent fidelity across many separate coding sessions.

## Mission

Clawd on Desk is a desktop companion for AI coding work. It makes agent activity visible, interruptible, and emotionally legible without forcing users to watch terminal logs.

The product vision is a lightweight screen resident that reflects the state of one or more coding agents in real time: composing, thinking, working, juggling subagents, waiting for permission, reporting errors, celebrating completion, or sleeping when activity stops. It should make agent systems feel observable and manageable while staying out of the user's way.

The next-stage vision is more specific: Clawd should become the pet-centered frontend and interaction shell for an AI backend, with Hermes as the primary agent backbone. Hermes should handle complex tasks, tools, memory, skills, and future task assignment. Clawd should handle user interaction, layout, animation, state mapping, and feedback.

The project is not just an animation toy. It is a thin desktop coordination layer for local AI developer tools, with agent hooks, session state, permission surfaces, usage/status panels, and small assistant utilities exposed through an Electron app. The pet should remain the visible center of the experience, while backend agents remain replaceable execution engines.

## Goals

- Show accurate, low-friction visual feedback for AI coding agent activity.
- Support multiple agents and simultaneous sessions without making users choose a single vendor.
- Surface permission requests in a desktop-native way while preserving each agent's fallback behavior.
- Keep the companion unobtrusive: draggable, click-through where appropriate, sleep-aware, and respectful of Do Not Disturb.
- Make themes and character assets extensible without allowing third-party assets to compromise security.
- Keep cross-platform behavior coherent on macOS, Windows, Linux, WSL, and remote SSH workflows where supported.
- Give AI contributors enough durable context to make correct small changes without rediscovering the product intent each time.
- Build Hermes integration around backend lifecycle and functional results, not model-selected UI commands.
- Keep Clawd's frontend behavior deterministic: the app maps known backend states to known animations locally.
- Keep provider budget/status visibility useful without making it part of the agent reasoning loop.

## Target Audience

- Developers using AI coding agents such as Claude Code, Codex CLI, Copilot CLI, Gemini CLI, Kiro CLI, CodeBuddy, and opencode.
- Users running multiple agent sessions who need quick ambient status rather than another terminal dashboard.
- Theme authors who want to create custom desktop companion characters.
- Maintainers and AI agents extending integrations, settings, themes, and desktop behavior.

## Current Status

The repository currently contains an Electron desktop app with a CommonJS main process, renderer pages, preload bridges, hook installers, agent registry modules, built-in themes, tests, and packaging configuration.

Supported or partially supported surfaces found in the codebase include:

- Multi-agent state ingestion through hooks, local log polling, and plugin integrations.
- Session state resolution and animation priority handling.
- Permission bubbles and per-agent permission toggles.
- Theme loading, validation, SVG sanitization, hit geometry, mini mode, and custom theme scaffolding.
- Settings persistence, tray/menu actions, i18n, startup window state, and login item helpers.
- macOS activity collectors for typing, frontmost app, clipboard, media, and related global activity rules.
- Clipboard history/sanitization, translation bubbles, time check-ins, provider usage summaries, update bubbles, and Hermes chat/check-in helpers.
    - MiniMax usage extraction surfaces the 5-hour primary window (scraped from the quota N/M count, not the CSS-rendered percentage) — fixing a longstanding wrong-percentage display caused by regex mis-matching copyright year numbers.
- Translation bubble positioning: the translate bubble is always pet-attached — it uses hitbox-center alignment (independent of the global `bubbleFollowPet` setting) with a three-tier placement model (above-pet → below-pet → side). It uses `showInactive()` instead of `show()` to avoid focus stealing, calls `guardAlwaysOnTop` on creation and after height changes, and re-applies macOS floating visibility after showing. Bounds are computed by the pure helper `src/translate-bubble-position.js` and repositioned whenever the pet moves, the bubble reports measured height, or display metrics change.
- Settings window AI Work tab: AI-related controls are consolidated into a single "AI Work" tab replacing the old "Agents" tab. The tab contains Hermes status and chat config (with Advanced section for extra args textarea), Agents & Permissions, Translation & MiniMax (with visible hotkey text "Ctrl+Shift+T"), Provider Usage (with Advanced section exposing Python executable, checker script path, browser selection, and timeout ms), Time Check-ins, and a collapsed Diagnostics area. The General tab retains Appearance, Startup, Bubbles, and Global Activity. Disabled Shortcuts and About placeholder tabs are removed. The `hermesChat` field is now validated in `updateRegistry` (command non-empty string, args string array, cwd string, timeoutMs bounded 10000–600000). Time check-in timeout validation max is corrected to 120000ms. Hermes settings buttons use `soft-btn` styling and the loading text uses a proper i18n key.
- A pet-adjacent Hermes chat surface that opens on the left side of the pet, plus a right-side provider/status HUD.
- Hermes chat panel improvements: draggable titlebar (CSS `-webkit-app-region`), session-persistent manual drag position, file/folder drag-and-drop with `@"path"` context insertion and multi-item handover guidance, and visually distinct Clear/Close titlebar buttons.
- Hermes permission bridge: dangerous commands in `hermes chat` sessions are routed through Clawd's permission bubble UI via a Python stdlib bridge (injected via `PYTHONPATH`), filesystem poll-file reverse channel, and the existing `POST /permission` Hermes branch — no modification to the installed Hermes package.
- Unit tests under `test/` for many non-Electron and extracted logic modules, including `chat-drop-paths.js` and `chat-panel-layout.js`.

Next-stage status:

- Achieved: Clawd already has the core frontend foundation: theme-driven pet rendering, hit-window input handling, deterministic state mapping, click/drag reactions, mini mode, permission/status bubbles, a right-side provider usage HUD, and initial Hermes chat/check-in helpers.
- Achieved: The Hermes chat surface is oriented as a left-side pet companion board, and Hermes availability/activity can be reflected in the desktop UI without asking Hermes to choose animations.
- Achieved: Hermes permission bridge routes dangerous-command approval through Clawd's permission bubble UI. The Python stdlib bridge (`hooks/hermes-permission-bridge.py`) is injected via `PYTHONPATH` into the spawned Hermes child process; a tempfile-based poll channel (`POST /permission` → bubble → poll file) provides the reverse channel without modifying the Hermes package.
- Partially achieved: Hermes exists as a backend path, but it is not yet the central durable task backbone for longer-running workflows.
- Left to build: Hermes API Server/Gateway integration and richer lifecycle-to-state mapping for task-level workflows.
- Main optimization target: remove any need for Hermes or another LLM to decide animations. The model should solve functional tasks; Clawd should translate request lifecycle into UI state.

Known constraints remain:

- Electron window, tray, and full end-to-end desktop behavior are not comprehensively automated.
- Some agent integrations have inherent limitations because their upstream tools expose different hook, permission, and process metadata.
- Platform support must be treated as a product surface, not an afterthought; a feature that works only on one OS needs clear fallback behavior.

## Codebase Hygiene

There is no confirmed massive tracked runtime dead code at the current baseline. Some directories and files are intentionally non-core and should not be confused with product runtime:

- Core runtime: `src/`, `agents/`, `hooks/`, `themes/`, and shipped `assets/`.
- Tests: `test/` and focused manual smoke scripts such as root `test-*.sh`.
- Documentation/specs: `AGENTS.md`, `README*`, and tracked files under `docs/`.
- Non-core support: `perf/`, resource/stress scripts, and `tools/` artwork or pipeline helpers.
- Experimental path: study-supervisor assets and scripts, including `scripts/supervisor.py`, `requirements-study-supervisor.txt`, `themes/study-supervisor/`, and the `/supervisor` state endpoint.
- Generated output: `dist/` is ignored build output and must not be treated as source or roadmap material.

Before deleting code, classify it as runtime path, packaged asset, test-only helper, manual/dev tool, experimental prototype, or generated output. Non-core does not automatically mean dead. Prefer documenting ownership and intent before removal.

## Tech Stack

- Runtime: Node.js 20 and Electron.
- Module style: CommonJS.
- UI surfaces: Electron `BrowserWindow` pages under `src/`, with preload bridges for renderer-safe APIs.
- State and settings: small CommonJS modules such as `state.js`, `prefs.js`, `settings-controller.js`, `theme-loader.js`, and related helpers.
- Agent integration: modules under `agents/`, hook installers and hook scripts under `hooks/`, and plugin/editor glue under `extensions/`.
- Themes and assets: built-in theme packages under `themes/`, shipped icons/SVG/GIF/sound assets under `assets/`.
- Tests: Node's built-in test runner with `node:test` and `node:assert`.
- Packaging: `electron-builder`.

Useful commands:

- `npm install` installs dependencies.
- `npm start` launches the desktop app through `launch.js`.
- `npm test` runs all unit tests.
- `npm run build` creates the default packaged build.
- `npm run build:mac` creates a macOS build.
- `npm run build:linux` creates a Linux build.
- `npm run create-theme -- my-theme` scaffolds a custom theme.
- `npm run install:claude-hooks` and related `install:*` scripts register local agent hooks for manual testing.

## Constraints

- Preserve user trust. Never commit local hook configs, API keys, private logs, generated package output, or user-specific state.
- Prefer small, reversible changes that match the existing code shape.
- Keep implementation details out of this spec unless they represent stable constraints or product intent.
- Do not add new vendor lock-in unless the integration has clear fallback behavior and does not degrade existing agents.
- Treat permission flows as high-trust UX. If a desktop prompt cannot safely answer a request, the underlying agent's native prompt must remain usable.
- Keep DND, sleep, click-through, drag behavior, and startup recovery coherent when adding new activity signals.
- Keep the left Hermes board spatially subordinate to the pet; it should open beside the pet and avoid becoming a detached primary workspace.
- Keep the right provider/status HUD compact. Provider usage checks should be deterministic utility calls, optional where a provider is disabled, and tolerant of slower browser-backed checks.
- Validate and sanitize third-party theme assets through the existing theme flow.
- Avoid large rewrites of `src/main.js`; prefer extracting focused modules when changing shared behavior.
- Maintain backward compatibility for hook registration, auto-start behavior, and settings migrations across macOS, Windows, and Linux.
- Add or update tests in `test/` for behavior changes whenever the logic can be exercised outside a live Electron window.
- Do not ask Hermes or any LLM to choose a Clawd animation such as `juggling`, `sweeping`, or `error`. Animation choice is a Clawd frontend responsibility.
- Prefer Hermes API Server/Gateway for the next-stage backbone. If Hermes is offline, Clawd should show setup/status information rather than silently falling back to a different execution path.
- Keep frontend boards simple and transparent. The pet is the primary visual object; boards should support the pet, not become the product's center of gravity.
- Do not remove non-core support code as "dead" without a dedicated cleanup pass that proves it is unused and records the decision in this spec or an adjacent doc.
- Hermes integration must remain self-contained within the Clawd repo. Do not modify the installed Hermes package; use `PYTHONPATH` injection and environment variables for any in-process hooks.

## Not In Scope For This Spec

This spec should not decide low-level implementation details such as exact function names, internal class boundaries, IPC channel names, CSS selectors, animation file names, or individual hook payload schemas. Those belong in feature specs, code comments where necessary, tests, and implementation PRs.

This spec also should not become the changelog. Keep detailed release notes, issue lists, and one-off bug investigations in docs or PRs.

## Roadmap

Roadmap is a living section. It should record sequence and intent, not implementation. Each phase should be expanded through its own feature spec before code is changed.

### Phase 0: Stabilize The Spec And Baseline

Intent: make the repository easier for AI agents and maintainers to reason about.

Status: complete / maintenance.

Expected outcomes:

- Keep this file aligned with the actual codebase and documented commands.
- Clarify current product scope and constraints before deciding future roadmap items.
- Fix small technical mismatches discovered during repository scans.
- Continue making small high-level spec updates when product intent changes.

### Phase 1: Clawd As Hermes Frontend Shell

Intent: make Clawd the pet-centered frontend for Hermes-backed AI work while preserving a deterministic, low-latency UI state machine.

Status: in progress.

Product shape:

- Center: Clawd pet remains the core visual actor and activity indicator.
- Right: a compact status board shows existing provider budgets and future Hermes health/activity status.
- Left: a simple transparent board sits beside the pet and expands into Hermes chat/input when opened.
- Interaction: single click remains non-invasive and keeps current focus behavior; double click opens the left Hermes board.
- Backend: Hermes is the primary backbone for complex tasks, skills, memory, and future delegation.
- Frontend: Clawd owns animation, layout, state mapping, and user feedback.

Completed so far:

- Clawd can open a Hermes-backed chat interaction from the pet-centered UI.
- The Hermes chat panel sits on the left side of the pet.
- The Hermes chat panel supports a draggable titlebar, session-persistent manual position, file/folder drop context insertion, and visually distinct Clear and Close controls.
- Hermes dangerous-command permission requests can route through Clawd's permission bubble UI while preserving the underlying agent fallback path.
- The right-side provider usage HUD exists and includes MiniMax-aware refresh behavior.
- The translation bubble is pet-attached and aligned above the pet with desktop-safe fallback positioning.

Currently in progress:

- Clean up Settings into an AI-work-oriented surface that groups Hermes, agent permissions, translation, provider usage, and related diagnostics.
- Improve Hermes setup, offline, health, and activity visibility in the desktop UI.
- Keep advanced AI command, path, timeout, and diagnostic controls available without making them the default user-facing settings experience.

Still pending:

- Prefer Hermes API Server/Gateway as the primary backend path once it is stable enough for desktop integration.
- Expand Hermes lifecycle mapping beyond one-shot chat into durable task/workflow states.
- Add Hermes health/activity status into the compact provider/status board.

Expected outcomes:

- Clawd maps Hermes lifecycle locally: request start means thinking/working, success means attention/idle, failure means error or offline/setup state.
- Hermes returns functional results only; it does not send animation commands.
- If Hermes API Server/Gateway is unavailable, Clawd shows clear setup/offline status.
- Existing agent-session awareness and provider HUD behavior remain intact.

Non-goals:

- Do not replace the current multi-agent integrations with Hermes.
- Do not build custom middleware only to animate the pet.
- Do not make Hermes responsible for frontend state, layout, or animation naming.
- Do not auto-start or reconfigure Hermes without explicit user action.

### Phase 2: Hermes Backbone Expansion

Intent: grow Hermes from a chat backend into the durable task backbone behind Clawd.

Status: future — begins after Phase 1 settings cleanup and Hermes Gateway/API integration stabilize.

Expected outcomes:

- Support longer-running task workflows while preserving immediate Clawd feedback.
- Surface Hermes skills, memory, and task assignment through simple frontend affordances.
- Keep backend capability expansion behind stable Clawd lifecycle events.
- Evaluate Gateway/API features before adding new CLI-only behavior.

## Engineering Guidelines

Follow the existing style: CommonJS modules, double quotes, semicolons, and indentation matching the edited file. Use `camelCase` for variables and functions, `UPPER_SNAKE_CASE` for shared constants, and kebab-case filenames such as `theme-loader.js`.

Keep renderer markup and preload bridges close to the feature they support. Prefer existing helper APIs and local patterns over new abstractions. Add abstractions only when they remove real complexity or match an established module boundary.

When reviewing or changing code, protect unrelated user work in the git tree. Do not revert changes you did not make.
