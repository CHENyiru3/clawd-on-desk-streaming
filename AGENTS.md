# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Electron app: `main.js` manages windows and app lifecycle, renderer-facing HTML lives beside preload scripts, and shared logic sits in small CommonJS modules such as `state.js`, `theme-loader.js`, and `settings-controller.js`. `test/` holds Node test runner suites named `*.test.js`. `themes/` stores built-in theme packages, `assets/` contains shipped icons, SVGs, GIFs, and sounds, and `hooks/`, `agents/`, and `extensions/` contain agent integrations and editor/plugin glue. Treat `dist/` as build output, not source.

## Build, Test, and Development Commands
Use Node 20 and install once with `npm install`.

- `npm start` launches the desktop app through `launch.js`.
- `npm test` runs all unit tests with Node's built-in test runner.
- `npm run build`, `npm run build:mac`, `npm run build:linux` create packaged Electron builds.
- `npm run create-theme -- my-theme` scaffolds a new custom theme.
- `npm run install:claude-hooks` and related `install:*` scripts register local agent hooks for manual testing.

## Coding Style & Naming Conventions
Follow the existing style: CommonJS modules, double quotes, semicolons, and 2-space indentation in JSON, 2-space or 4-space indentation matching the file you are editing. Prefer small focused modules over large abstractions. Use `camelCase` for variables and functions, `UPPER_SNAKE_CASE` for shared constants, and kebab-case filenames such as `theme-loader.js`. Keep renderer markup and preload bridges close to the feature they support.

## Testing Guidelines
Add or update tests in `test/` for any behavior change. Name files `feature-name.test.js` and keep assertions deterministic with `node:test` and `node:assert`. Run `npm test` before opening a PR; for targeted work, use `node --test test/theme-loader.test.js`.

## Commit & Pull Request Guidelines
Recent history favors short conventional messages like `feat: ...`, `fix: ...`, `refactor: ...`, and `docs: ...`. Keep commits scoped to one change. PRs should explain user-visible impact, mention affected platforms or agents, link issues when relevant, and include screenshots or GIFs for UI, animation, theme, or permission-bubble changes.

## Security & Configuration Tips
Do not commit local hook configs, API keys, or generated packaging artifacts. Test third-party theme assets through the existing validation flow, and keep auto-start, hook registration, and permission-bubble changes backward compatible across macOS, Windows, and Linux.
