"""
MiniMax token usage fetcher using Playwright.
Scrapes https://platform.minimaxi.com/user-center/payment/token-plan
Reads credentials from MINIMAX_EMAIL/MINIMAX_PASSWORD or a local credentials file.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

MINIMAX_EMAIL = os.environ.get("MINIMAX_EMAIL", "")
MINIMAX_PASSWORD = os.environ.get("MINIMAX_PASSWORD", "")
MINIMAX_CREDENTIALS_FILE = os.environ.get("MINIMAX_CREDENTIALS_FILE", "")

LOGIN_URL = "https://platform.minimaxi.com/user-center/basic-information/inner"
TOKEN_PLAN_URL = "https://platform.minimaxi.com/user-center/payment/token-plan"

DEBUG = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")


# ─── Data model (matches providers/models.py) ──────────────────────────────────

@dataclass
class Identity:
    email: str | None = None
    organization: str | None = None
    login_method: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class UsageWindow:
    name: str = ""
    used_percent: float | None = None
    remaining_percent: float | None = None
    display_text: str | None = None
    resets_at: str | None = None
    reset_description: str | None = None
    detail_text: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Credits:
    remaining: float | None = None
    purchase_url: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class UsageSnapshot:
    provider: str = "minimax"
    source: str = "playwright"
    fetched_at: str = ""
    identity: Identity = field(default_factory=Identity)
    windows: dict = field(default_factory=dict)
    credits: Credits = field(default_factory=Credits)
    extras: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)
    raw: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        # Flatten nested dataclasses for normalizeUsageSnapshot compatibility
        d["windows"] = {k: (_w.to_dict() if hasattr(_w, "to_dict") else _w) for k, _w in self.windows.items()}
        d["identity"] = self.identity.to_dict()
        d["credits"] = self.credits.to_dict()
        return d


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _debug(msg: str) -> None:
    if DEBUG:
        print(f"[minimax-debug] {msg}", file=sys.stderr)


def utcnow_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _error(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def _parse_number(text: str | None) -> float | None:
    """Extract the first valid integer/float from a string."""
    if text is None:
        return None
    m = re.search(r"[\d.]+", text.replace(",", ""))
    if m:
        try:
            return float(m.group())
        except ValueError:
            return None
    return None


def _coerce_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return float(value)
    if isinstance(value, str):
        return _parse_number(value)
    return None


def _normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", str(key).lower())


def _find_number_by_key(obj: dict, needles: tuple[str, ...], *, reject: tuple[str, ...] = ()) -> float | None:
    for key, value in obj.items():
        normalized = _normalize_key(key)
        if any(bad in normalized for bad in reject):
            continue
        if any(needle in normalized for needle in needles):
            number = _coerce_number(value)
            if number is not None:
                return number
    return None


def _find_text_by_key(obj: dict, needles: tuple[str, ...]) -> str | None:
    for key, value in obj.items():
        normalized = _normalize_key(key)
        if any(needle in normalized for needle in needles) and isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _iter_dicts(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _iter_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_dicts(child)


def _score_quota_object(obj: dict, path_hint: str = "") -> int:
    text = " ".join(str(key) for key in obj.keys()).lower() + " " + path_hint.lower()
    score = 0
    for needle in ("token", "plan", "quota", "limit", "usage", "used", "remain", "available", "request", "call"):
        if needle in text:
            score += 1
    for needle in ("套餐", "额度", "剩余", "调用", "次数", "请求", "用量"):
        if needle in text:
            score += 1
    return score


def _window_from_quota_object(obj: dict, path_hint: str = "") -> tuple[int, UsageWindow] | None:
    used_pct = _find_number_by_key(obj, ("usedpercent", "usagepercent", "usedrate", "userate", "progress"), reject=("time", "date"))
    remaining_pct = _find_number_by_key(obj, ("remainingpercent", "remainpercent", "availablepercent", "leftpercent"), reject=("time", "date"))
    used_count = _find_number_by_key(obj, ("usedcount", "usecount", "usednum", "usenum", "consumed", "used", "usage"), reject=("percent", "rate", "time", "date"))
    remaining_count = _find_number_by_key(obj, ("remainingcount", "remaincount", "availablenum", "availablecount", "leftcount", "remaining", "remain", "available", "left"), reject=("percent", "rate", "time", "date"))
    limit_count = _find_number_by_key(obj, ("totalcount", "totalnum", "limitcount", "limitnum", "quota", "quantity", "total", "limit", "max"), reject=("percent", "rate", "time", "date"))

    if used_pct is None and remaining_pct is None:
        if used_count is not None and limit_count and limit_count > 0:
            used_pct = round((used_count / limit_count) * 100.0, 2)
            remaining_pct = round(max(0.0, 100.0 - used_pct), 2)
        elif remaining_count is not None and limit_count and limit_count > 0:
            remaining_pct = round((remaining_count / limit_count) * 100.0, 2)
            used_pct = round(max(0.0, 100.0 - remaining_pct), 2)

    if used_pct is None and remaining_pct is None:
        return None
    if used_pct is None:
        used_pct = round(max(0.0, 100.0 - remaining_pct), 2)
    if remaining_pct is None:
        remaining_pct = round(max(0.0, 100.0 - used_pct), 2)
    if not (0 <= used_pct <= 100 and 0 <= remaining_pct <= 100):
        return None

    name = (
        _find_text_by_key(obj, ("name", "title", "plan", "package", "resource", "model", "资源", "套餐", "名称"))
        or "5h"
    )
    reset_description = _find_text_by_key(obj, ("reset", "expire", "expiration", "endtime", "deadline", "valid", "截止", "过期", "有效"))
    score = _score_quota_object(obj, path_hint)
    if limit_count is not None:
        score += 2
    return score, UsageWindow(
        name=name[:40] if name else "5h",
        used_percent=round(used_pct, 2),
        remaining_percent=round(remaining_pct, 2),
        display_text=_format_remaining_display(remaining_pct),
        resets_at=None,
        reset_description=reset_description,
    )


def _extract_primary_window_from_json_payloads(payloads: list[Any]) -> UsageWindow | None:
    candidates: list[tuple[int, UsageWindow]] = []
    for payload in payloads:
        for obj in _iter_dicts(payload):
            candidate = _window_from_quota_object(obj)
            if candidate:
                candidates.append(candidate)
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _parse_pct(text: str) -> tuple[float | None, float | None]:
    """Parse MiniMax page percentages as checked usage plus leftover quota.

    The token-plan page percentage is treated as checked usage/progress. Clawd
    presents leftover quota, so a checked "2%" becomes 98% remaining.
    """
    m = _find_usage_percent(text)
    if m is None:
        return None, None
    val = float(m)
    return val, round(max(0.0, 100.0 - val), 2)


def _format_remaining_display(remaining_pct: float | None) -> str | None:
    if remaining_pct is None:
        return None
    rounded = round(max(0.0, min(100.0, remaining_pct)))
    return f"{rounded}%"


def _line_has_usage_context(line: str) -> bool:
    lowered = line.lower()
    return any(
        kw in lowered
        for kw in (
            "token",
            "quota",
            "usage",
            "used",
            "available",
            "remain",
            "call",
            "request",
            "limit",
            "额度",
            "用量",
            "已用",
            "使用",
            "剩余",
            "可用",
            "调用",
            "请求",
            "次数",
            "套餐",
        )
    )


def _ratio_has_usage_context(text: str) -> bool:
    lowered = text.lower()
    return any(
        kw in lowered
        for kw in (
            "calls",
            "requests",
            "used",
            "usage",
            "quota",
            "limit",
            "调用",
            "请求",
            "次数",
            "已用",
            "使用",
            "用量",
            "额度",
            "可用",
            "剩余",
        )
    )


def _find_usage_percent(text: str) -> float | None:
    """Find the MiniMax usage/progress percent without grabbing unrelated page percentages."""
    matches = list(re.finditer(r"(\d+(?:\.\d+)?)\s*%", text))
    if not matches:
        return None

    for line in text.splitlines():
        if not _line_has_usage_context(line):
            continue
        line_match = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
        if line_match:
            return float(line_match.group(1))

    return float(matches[0].group(1))


def _extract_hot_item(page_text: str) -> dict | None:
    """Extract model-specific row (e.g. coding-plan-search, music-2.6)."""
    lines = page_text.splitlines()
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if any(
            kw in stripped.lower()
            for kw in ["music", "speech", "hailuo", "video", "image", "coding-plan", "sharegpt"]
        ):
            used_pct, remaining_pct = _parse_pct(stripped)
            if used_pct is not None or remaining_pct is not None:
                # Strip numbers and percentages to get the name
                name = re.sub(r"[\d.\s%剩余可用剩余]+$", "", stripped).strip()
                name = re.sub(r"^\d+", "", name).strip()
                name = re.sub(r"^[\-–]\s*", "", name).strip()
                if name:
                    return {"name": name, "used_percent": used_pct, "remaining_percent": remaining_pct}
    return None


def _extract_reset(page_text: str) -> tuple[str | None, str | None]:
    """Extract reset/expiry description and ISO timestamp."""
    for kw in ("截止日期", "截止", "重置", "reset", "过期", "expir", "有效期", "valid until"):
        idx = page_text.find(kw)
        if idx >= 0:
            # Search AFTER the keyword for the date (keyword comes first, then date)
            after_keyword = page_text[idx:idx+80]
            m = re.search(r"(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})", after_keyword)
            if m:
                desc = m.group(1).strip()
                # Try to parse as datetime
                resets_at = None
                for fmt in (
                    "%m/%d/%Y", "%m-%d-%Y",
                    "%Y-%m-%d", "%Y/%m/%d",
                ):
                    try:
                        parsed = dt.datetime.strptime(desc, fmt)
                        if parsed.year < 100:
                            parsed = parsed.replace(year=dt.datetime.now().year + (1 if parsed.month < dt.datetime.now().month else 0))
                        resets_at = parsed.replace(tzinfo=dt.timezone.utc).isoformat()
                        break
                    except ValueError:
                        continue
                return desc, resets_at
    return None, None


def _extract_plan_name(page_text: str) -> str | None:
    """Extract the plan name from the page."""
    # Try to find "Starter月度套餐" style plan names near "Token Plan" or "可用额度"
    for kw in ("Token Plan", "可用额度", "Starter", "月度套餐"):
        idx = page_text.find(kw)
        if idx >= 0:
            snippet = page_text[idx : idx + 200]
            # Pattern: word characters or Chinese chars followed by "月度套餐" or "套餐"
            m = re.search(r"([A-Za-z0-9\u4e00-\u9fff]{2,20}(?:月度)?套餐)", snippet)
            if m:
                name = m.group(1).strip()
                if name and len(name) <= 30 and name not in ("Token Plan", "Token Plan Key"):
                    return name
            # Fallback: just grab text containing "月度套餐"
            m2 = re.search(r"(.{0,20}月度套餐)", snippet)
            if m2:
                return m2.group(1).strip()
    return None


def _looks_like_date_ratio(page_text: str, start: int, end: int) -> bool:
    before = page_text[max(0, start - 8) : start]
    after = page_text[end : min(len(page_text), end + 8)]
    fragment = f"{before}{page_text[start:end]}{after}"
    return bool(
        re.search(r"\d{4}\s*/\s*\d{1,2}\s*/\s*\d{1,2}", fragment)
        or re.search(r"\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{2,4}", fragment)
    )


def _looks_like_short_date_ratio(page_text: str, match: re.Match) -> bool:
    left = int(match.group(1))
    right = int(match.group(2))
    if not (1 <= left <= 12 and 1 <= right <= 31):
        return False
    nearby = page_text[max(0, match.start() - 10) : min(len(page_text), match.end() + 10)]
    return not _ratio_has_usage_context(nearby)


def _extract_quota_counts(page_text: str) -> tuple[float | None, float | None]:
    """Extract used/limit call counts like '599 / 600' from quota-like context only."""
    for m in re.finditer(r"(\d+)\s*/\s*(\d+)\s*(?:次|调用|calls?|requests?|可用)?", page_text, re.I):
        if _looks_like_date_ratio(page_text, m.start(), m.end()) or _looks_like_short_date_ratio(page_text, m):
            continue
        used = float(m.group(1))
        limit = float(m.group(2))
        if limit <= 0 or used > limit:
            continue
        context = page_text[max(0, m.start() - 24) : min(len(page_text), m.end() + 16)]
        if not _ratio_has_usage_context(context):
            continue
        return used, limit
    return None, None


def _extract_primary_window(page_text: str) -> UsageWindow:
    """Extract the main 5h plan window from the page."""
    # Try call-count extraction first
    used_calls, limit_calls = _extract_quota_counts(page_text)
    used_pct, remaining_pct = _parse_pct(page_text)

    if used_calls is not None and limit_calls is not None and limit_calls > 0:
        used_pct = round((used_calls / limit_calls) * 100.0, 2)
        remaining_pct = round(max(0.0, 100.0 - used_pct), 2)

    reset_desc, resets_at = _extract_reset(page_text)
    plan_name = _extract_plan_name(page_text)

    return UsageWindow(
        name=plan_name or "5h",
        used_percent=used_pct,
        remaining_percent=remaining_pct,
        display_text=_format_remaining_display(remaining_pct),
        resets_at=resets_at,
        reset_description=reset_desc,
        detail_text=None if used_pct is not None or remaining_pct is not None else "MiniMax usage was not found on the token-plan page.",
    )


def _extract_status_text(page_text: str) -> str | None:
    for kw in ("正常", "额度不足", "即将用尽", "exhausted", "normal", "low quota"):
        if kw in page_text:
            return kw
    return None


def _credential_file_candidates() -> list[Path]:
    candidates = []
    if MINIMAX_CREDENTIALS_FILE.strip():
        candidates.append(Path(MINIMAX_CREDENTIALS_FILE.strip()).expanduser())
    candidates.extend([
        Path.home() / ".config" / "clawd" / "minimax-credentials.json",
        Path.home() / ".clawd" / "minimax-credentials.json",
    ])
    return candidates


def _load_minimax_credentials() -> tuple[str, str, str]:
    email = MINIMAX_EMAIL.strip()
    password = MINIMAX_PASSWORD.strip()
    if email and password:
        return email, password, "env"

    for candidate in _credential_file_candidates():
        try:
            if not candidate.is_file():
                continue
            payload = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception as exc:
            _debug(f"Could not read MiniMax credentials file {candidate}: {exc}")
            continue
        file_email = str(payload.get("email") or payload.get("account") or "").strip()
        file_password = str(payload.get("password") or "").strip()
        if file_email and file_password:
            return file_email, file_password, str(candidate)
    return "", "", ""


def run_headless() -> UsageSnapshot:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        _error("Playwright is not installed. Run: pip install playwright && playwright install chromium")

    email, password, credential_source = _load_minimax_credentials()
    if not email or not password:
        _error(
            "MiniMax credentials not configured. "
            "Set MINIMAX_EMAIL/MINIMAX_PASSWORD or create ~/.config/clawd/minimax-credentials.json."
        )

    _debug(f"Launching browser for MiniMax account from {credential_source}...")

    snapshot = UsageSnapshot(
        provider="minimax",
        source="playwright",
        fetched_at=utcnow_iso(),
        identity=Identity(email=email, login_method="password"),
        windows={"primary": UsageWindow(name="5h")},
        credits=Credits(),
        extras={},
        warnings=[],
        raw={},
    )

    try:
        with sync_playwright() as p:
            json_payloads: list[Any] = []
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                locale="zh-CN",
                viewport={"width": 1280, "height": 800},
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            page = context.new_page()
            page.set_default_timeout(30000)

            def handle_response(response):
                url = response.url.lower()
                if "minimax" not in url and "minimaxi" not in url:
                    return
                try:
                    content_type = response.headers.get("content-type", "")
                    if "json" not in content_type and not re.search(r"/api/|/v\d+/", url):
                        return
                    payload = response.json()
                    json_payloads.append(payload)
                except Exception:
                    return

            page.on("response", handle_response)

            # ── Login ────────────────────────────────────────────────────────
            _debug(f"Navigating to {TOKEN_PLAN_URL} first (will redirect to login if needed)...")
            page.goto(TOKEN_PLAN_URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_load_state("networkidle", timeout=15000)
            time.sleep(2)
            _debug(f"After initial navigation, URL = {page.url}")

            if "/login" in page.url.lower():
                _debug("Redirected to login page, filling credentials...")

                # Click "密码登录" tab first (default tab is phone verification)
                password_tab = (
                    page.get_by_text("密码登录")
                    or page.locator('text="密码登录"').first
                    or page.locator('[class*="tab"]:has-text("密码登录")').first
                    or page.locator('[class*="mode"]:has-text("密码登录")').first
                )
                if password_tab.is_visible(timeout=5000):
                    _debug("Clicking 密码登录 tab...")
                    password_tab.click()
                    time.sleep(2)
                else:
                    _debug("Password tab not visible, checking page state...")

                # Wait for input fields to appear after tab switch
                time.sleep(2)  # Allow JS to render the form after tab click
                page.wait_for_load_state("domcontentloaded")
                time.sleep(0.5)

                # ── Check "I agree to policy" checkbox if present ──────────────
                try:
                    policy_checkbox = (
                        page.query_selector('input[type="checkbox"]')
                        or page.query_selector('[class*="agree"] input')
                        or page.query_selector('[class*="policy"] input')
                    )
                    if policy_checkbox:
                        _debug("Ticking policy agreement checkbox...")
                        policy_checkbox.check()
                        time.sleep(0.5)
                except Exception:
                    pass

                # Find phone/email field — MiniMax uses phone number as "邮箱"
                phone_input = (
                    page.query_selector('input[name="account"]')
                    or page.query_selector('input[name="email"]')
                    or page.get_by_placeholder(re.compile(r"手机号|邮箱|account", re.I))
                    or page.query_selector('input[placeholder*="手机"]')
                    or page.query_selector('input[placeholder*="邮箱"]')
                    or page.locator('input[type="text"]').first
                )
                password_input = (
                    page.query_selector('input[name="password"]')
                    or page.query_selector('input[type="password"]')
                    or page.query_selector('input[placeholder*="密码"]')
                    or page.locator('input[type="password"]').first
                )
                if not phone_input or not password_input:
                    _debug(f"All inputs found: {[el.get_attribute('name') + '/' + el.get_attribute('type') + '/' + el.get_attribute('placeholder') for el in page.query_selector_all('input')]}")
                    snapshot.warnings.append("Could not find login form on page.")
                else:
                    phone_input.fill(email)
                    time.sleep(0.5)
                    password_input.fill(password)
                    time.sleep(0.5)
                    submit = (
                        page.query_selector('button[type="submit"]')
                        or page.query_selector('button:has-text("登录")')
                        or page.query_selector('button:has-text("Sign in")')
                        or page.query_selector('button:has-text("立即登录")')
                    )
                    if submit:
                        submit.click()
                    else:
                        password_input.press("Enter")
                    time.sleep(5)  # Allow login to process before checking URL
                    try:
                        page.wait_for_url(lambda url: "/login" not in url.lower(), timeout=30000)
                    except Exception:
                        _debug("Login redirect timeout, continuing...")
                        time.sleep(5)
            else:
                _debug(f"Not on login page, URL = {page.url}")

            # ── Token-plan page ─────────────────────────────────────────────
            # Already navigated to TOKEN_PLAN_URL above; after login, reload to
            # ensure we're on the actual token-plan page (not a cached login state)
            if "/login" in page.url.lower():
                _debug("Reloading token-plan after login...")
                time.sleep(2)
                page.goto(TOKEN_PLAN_URL, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_load_state("networkidle", timeout=15000)
                time.sleep(2)

            page_text = page.inner_text("body")
            _debug(f"Page title: {page.title()}")

            # ── Extract data ─────────────────────────────────────────────────
            primary_window = _extract_primary_window_from_json_payloads(json_payloads) or _extract_primary_window(page_text)
            snapshot.windows["primary"] = primary_window
            if primary_window.used_percent is None and primary_window.remaining_percent is None:
                snapshot.warnings.append("MiniMax usage was not found on the token-plan page.")

            hot_item = _extract_hot_item(page_text)
            if hot_item:
                snapshot.extras["hotItem"] = hot_item

            status_text = _extract_status_text(page_text)
            if status_text:
                snapshot.extras["statusText"] = status_text

            plan_name = _extract_plan_name(page_text)
            if plan_name:
                snapshot.extras["planName"] = plan_name

            snapshot.raw = {
                "page_title": page.title(),
                "url": page.url,
                "text_sample": page_text[:500],
                "json_payload_count": len(json_payloads),
            }

            browser.close()

    except Exception as exc:
        _debug(f"Browser error: {exc}")
        snapshot.warnings.append(f"Browser error: {exc}")

    return snapshot


def main() -> int:
    try:
        snapshot = run_headless()
        print(json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2))
        return 0
    except SystemExit:
        raise
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
