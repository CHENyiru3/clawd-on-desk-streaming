# Provider Usage Checker

Repo-local support tool used by Clawd's provider usage HUD.

## Codex

Codex usage is checked from local Codex auth, dashboard cookies, CLI RPC, or CLI PTY fallback:

```bash
python3 scripts/provider-usage-checker/scripts/check_usage.py --provider codex --json
```

## MiniMax

MiniMax usage requires account credentials for the MiniMax web console. Do not commit credentials.

Use environment variables:

```bash
MINIMAX_EMAIL="..." MINIMAX_PASSWORD="..." \
  python3 scripts/provider-usage-checker/scripts/check_usage.py --provider minimax --json
```

Or create a local credentials file outside the repo:

```json
{
  "email": "...",
  "password": "..."
}
```

Default locations:

- `~/.config/clawd/minimax-credentials.json`
- `~/.clawd/minimax-credentials.json`

You can also set `MINIMAX_CREDENTIALS_FILE` to an explicit JSON file path.

## DeepSeek

DeepSeek usage is checked from `https://platform.deepseek.com/usage`.
The HUD treats `100 CNY` as the baseline budget, so the visible left budget can render as a remaining-balance bar.

Use environment variables:

```bash
DEEPSEEK_EMAIL="..." DEEPSEEK_PASSWORD="..." \
  python3 scripts/provider-usage-checker/scripts/check_usage.py --provider deepseek --json
```

Or create a local credentials file outside the repo:

```json
{
  "email": "...",
  "password": "..."
}
```

Default locations:

- `~/.config/clawd/deepseek-credentials.json`
- `~/.clawd/deepseek-credentials.json`

You can also set `DEEPSEEK_CREDENTIALS_FILE` to an explicit JSON file path.
