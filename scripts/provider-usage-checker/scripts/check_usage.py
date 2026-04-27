#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys

from providers.codex import CodexFetcher
from providers.deepseek import fetch_deepseek_usage
from providers.output import snapshot_to_json, snapshot_to_text


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check Codex, MiniMax, or DeepSeek usage from local auth, browser cookies, and CLI state."
    )
    parser.add_argument("--provider", required=True, choices=["codex", "minimax", "deepseek"])
    parser.add_argument("--source", default="auto", choices=["auto", "oauth", "dashboard", "cli-rpc", "cli-pty"])
    parser.add_argument("--json", action="store_true", help="Print normalized JSON output.")
    parser.add_argument("--pretty", action="store_true", help="Print the human-readable format.")
    parser.add_argument("--cookie-header", help="Manual Cookie header value.")
    parser.add_argument("--cookie-header-file", help="File containing a Cookie header value.")
    parser.add_argument("--browser", default="auto", choices=["auto", "firefox", "chrome", "safari"])
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--account-email", help="Expected account email for account-scoped Codex dashboard checks.")
    parser.add_argument("--cache-dir", help="Cache directory for imported cookie headers.")
    parser.add_argument("--no-cache", action="store_true", help="Disable durable cookie cache by using a temporary-less mode.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    cache_dir = None if args.no_cache else args.cache_dir

    # MiniMax uses Playwright and reads credentials from environment variables;
    # call minimax.main() directly so it owns print/error handling.
    if args.provider == "minimax":
        import os as _os
        import providers.minimax as _minimax_module
        _os.environ["DEBUG"] = "1" if args.debug else ""
        return _minimax_module.main()

    try:
        if args.provider == "codex":
            fetcher = CodexFetcher(browser=args.browser, timeout=args.timeout, cache_dir=cache_dir, debug=args.debug)
            snapshot = fetcher.fetch(
                source=args.source,
                cookie_header=args.cookie_header,
                cookie_header_file=args.cookie_header_file,
                expected_email=args.account_email,
            )
        elif args.provider == "deepseek":
            snapshot = fetch_deepseek_usage(timeout=args.timeout, debug=args.debug)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json or not args.pretty:
        print(snapshot_to_json(snapshot))
    else:
        print(snapshot_to_text(snapshot))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
