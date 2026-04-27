from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

from .models import Credits, Identity, UsageSnapshot, UsageWindow

USAGE_URL = "https://platform.deepseek.com/usage"
DEEPSEEK_BUDGET_BASE_CNY = 100.0

DEEPSEEK_EMAIL = os.environ.get("DEEPSEEK_EMAIL", "")
DEEPSEEK_PASSWORD = os.environ.get("DEEPSEEK_PASSWORD", "")
DEEPSEEK_CREDENTIALS_FILE = os.environ.get("DEEPSEEK_CREDENTIALS_FILE", "")


def utcnow_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _debug(enabled: bool, msg: str) -> None:
    if enabled:
        print(f"[deepseek-debug] {msg}", file=sys.stderr)


def _parse_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return float(value)
    if not isinstance(value, str):
        return None
    match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?", value)
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _format_money(value: float | None, currency: str | None = None) -> str | None:
    if value is None:
        return None
    suffix = currency or ""
    return f"{value:.2f} {suffix}".strip()


def _round_percent(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 2)


def _budget_percents(left_budget: float | None) -> tuple[float | None, float | None]:
    if left_budget is None or DEEPSEEK_BUDGET_BASE_CNY <= 0:
        return None, None
    remaining_percent = _round_percent((left_budget / DEEPSEEK_BUDGET_BASE_CNY) * 100.0)
    used_percent = _round_percent(100.0 - remaining_percent)
    return used_percent, remaining_percent


def _status_from_remaining(remaining_percent: float | None) -> str:
    if remaining_percent is None:
        return "unavailable"
    if remaining_percent < 20:
        return "critical"
    if remaining_percent < 50:
        return "warning"
    return "ok"


def _credential_file_candidates() -> list[Path]:
    candidates = []
    if DEEPSEEK_CREDENTIALS_FILE.strip():
        candidates.append(Path(DEEPSEEK_CREDENTIALS_FILE.strip()).expanduser())
    candidates.extend([
        Path.home() / ".config" / "clawd" / "deepseek-credentials.json",
        Path.home() / ".clawd" / "deepseek-credentials.json",
    ])
    return candidates


def _load_deepseek_credentials() -> tuple[str, str, str]:
    email = DEEPSEEK_EMAIL.strip()
    password = DEEPSEEK_PASSWORD.strip()
    if email and password:
        return email, password, "env"

    for candidate in _credential_file_candidates():
        try:
            if not candidate.is_file():
                continue
            payload = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception:
            continue
        file_email = str(payload.get("email") or payload.get("account") or "").strip()
        file_password = str(payload.get("password") or "").strip()
        if file_email and file_password:
            return file_email, file_password, str(candidate)
    return "", "", ""


def _iter_dicts(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _iter_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_dicts(child)


def _normalized_key(key: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", str(key).lower())


def _find_number_by_key(obj: dict, needles: tuple[str, ...], reject: tuple[str, ...] = ()) -> float | None:
    for key, value in obj.items():
        normalized = _normalized_key(key)
        if any(bad in normalized for bad in reject):
            continue
        if any(needle in normalized for needle in needles):
            parsed = _parse_number(value)
            if parsed is not None:
                return parsed
    return None


def _extract_from_json_payloads(payloads: list[Any]) -> tuple[UsageWindow | None, Credits, dict]:
    best: tuple[int, UsageWindow, Credits, dict] | None = None
    for obj in (item for payload in payloads for item in _iter_dicts(payload)):
        keys_text = " ".join(str(key) for key in obj.keys()).lower()
        score = 0
        for needle in ("balance", "usage", "amount", "cost", "billing", "token", "request", "quota"):
            if needle in keys_text:
                score += 1
        for needle in ("余额", "用量", "账单", "消费", "金额", "请求", "调用"):
            if needle in keys_text:
                score += 1

        balance = _find_number_by_key(obj, ("balance", "remainingbalance", "remainbalance", "余额", "可用余额"))
        spend = _find_number_by_key(obj, ("amount", "cost", "expense", "spend", "spent", "usage", "用量", "消费", "费用"), ("token", "count", "num"))
        tokens = _find_number_by_key(obj, ("tokens", "tokencount", "total_tokens", "totalusage", "tokenusage", "token用量"), ())
        request_count = _find_number_by_key(obj, ("requests", "requestcount", "calls", "callcount", "调用", "请求"), ())
        if balance is None:
            continue

        used_percent, remaining_percent = _budget_percents(balance)
        display_text = _format_money(balance, "CNY")
        score += 3
        window = UsageWindow(
            name="Left Budget",
            used_percent=used_percent,
            remaining_percent=remaining_percent,
            status=_status_from_remaining(remaining_percent),
            display_text=display_text,
            detail_text=None,
            reset_description=None,
        )
        credits = Credits(remaining=balance)
        extras = {
            "balance": balance,
            "budget_base": DEEPSEEK_BUDGET_BASE_CNY,
            "currency": "CNY",
            "spent": spend,
            "tokens": tokens,
            "requests": request_count,
        }
        candidate = (score, window, credits, extras)
        if best is None or candidate[0] > best[0]:
            best = candidate
    if best is None:
        return None, Credits(), {}
    return best[1], best[2], best[3]


def _extract_from_page_text(page_text: str) -> tuple[UsageWindow | None, Credits, dict]:
    compact = " ".join(page_text.split())
    balance = None
    spend = None
    for pattern in (
        r"(?:Topped-up balance|Balance|余额|可用余额)[^\d$¥￥-]{0,100}([$¥￥]?\s*-?\d+(?:,\d{3})*(?:\.\d+)?)",
        r"([$¥￥]\s*-?\d+(?:,\d{3})*(?:\.\d+)?)[^\n]{0,20}(?:Topped-up balance|Balance|余额)",
    ):
        match = re.search(pattern, compact, re.I)
        if match:
            balance = _parse_number(match.group(1))
            break
    for pattern in (
        r"(?:Monthly expenses|Expenses|Amount|Cost|Spent|消费|费用|金额)[^\d$¥￥-]{0,100}([$¥￥]?\s*-?\d+(?:,\d{3})*(?:\.\d+)?)",
        r"([$¥￥]\s*-?\d+(?:,\d{3})*(?:\.\d+)?)[^\n]{0,20}(?:Monthly expenses|Expenses|消费|费用)",
    ):
        match = re.search(pattern, compact, re.I)
        if match:
            spend = _parse_number(match.group(1))
            break
    if balance is None:
        return None, Credits(), {}
    used_percent, remaining_percent = _budget_percents(balance)
    return UsageWindow(
        name="Left Budget",
        used_percent=used_percent,
        remaining_percent=remaining_percent,
        status=_status_from_remaining(remaining_percent),
        display_text=_format_money(balance, "CNY") if balance is not None else None,
        detail_text=None,
        reset_description=None,
    ), Credits(remaining=balance), {
        "left_budget": balance,
        "budget_base": DEEPSEEK_BUDGET_BASE_CNY,
        "currency": "CNY",
        "spent": spend,
    }


def _page_body_text(page) -> str:
    try:
        return page.inner_text("body")
    except Exception:
        return ""


def _looks_like_usage_text(page_text: str) -> bool:
    if not page_text or not page_text.strip():
        return False
    lowered = page_text.lower()
    if "topped-up balance" in lowered or "monthly expenses" in lowered:
        return True
    return ("usage" in lowered or "balance" in lowered) and "cny" in lowered


def _wait_for_usage_text(page, timeout: float, debug: bool) -> str:
    deadline = time.monotonic() + min(max(8.0, timeout * 0.5), 35.0)
    best_text = ""
    while time.monotonic() < deadline:
        text = _page_body_text(page)
        if len(text) > len(best_text):
            best_text = text
        if _looks_like_usage_text(text):
            return text
        time.sleep(1.0)

    if not best_text.strip():
        _debug(debug, "Usage page body was empty; reloading once.")
        try:
            page.reload(wait_until="domcontentloaded", timeout=int(timeout * 1000))
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
        except Exception as exc:
            _debug(debug, f"Usage page reload failed: {exc}")

        reload_deadline = time.monotonic() + min(max(6.0, timeout * 0.25), 20.0)
        while time.monotonic() < reload_deadline:
            text = _page_body_text(page)
            if len(text) > len(best_text):
                best_text = text
            if _looks_like_usage_text(text):
                return text
            time.sleep(1.0)
    return best_text


def _fill_first_visible(locator, value: str) -> bool:
    try:
        count = locator.count()
    except Exception:
        count = 0
    for index in range(count):
        item = locator.nth(index)
        try:
            if item.is_visible(timeout=800):
                item.fill(value)
                return True
        except Exception:
            continue
    return False


def _login_failure_message(page) -> str:
    try:
        text = " ".join(page.inner_text("body").split())
    except Exception:
        return "DeepSeek login did not complete."
    for needle in (
        "password is incorrect",
        "account doesn't exist",
        "verification",
        "captcha",
        "验证码",
        "密码错误",
        "账号不存在",
    ):
        idx = text.lower().find(needle.lower())
        if idx >= 0:
            start = max(0, idx - 80)
            end = min(len(text), idx + 180)
            return text[start:end]
    return "DeepSeek login did not complete; still on the sign-in page."


def _is_deepseek_sign_in_url(url: str) -> bool:
    lowered = (url or "").lower()
    return "sign_in" in lowered or "login" in lowered or "sign-in" in lowered


def fetch_deepseek_usage(timeout: float = 60.0, debug: bool = False) -> UsageSnapshot:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright is not installed. Run: pip install playwright && playwright install chromium") from exc

    email, password, credential_source = _load_deepseek_credentials()
    if not email or not password:
        raise RuntimeError(
            "DeepSeek credentials not configured. Set DEEPSEEK_EMAIL/DEEPSEEK_PASSWORD "
            "or create ~/.config/clawd/deepseek-credentials.json."
        )

    snapshot = UsageSnapshot(
        provider="deepseek",
        source="playwright",
        fetched_at=utcnow_iso(),
        identity=Identity(email=email, login_method="password"),
        windows={"primary": UsageWindow(name="Left Budget", status="unavailable", detail_text="Not connected")},
        credits=Credits(),
        extras={},
        warnings=[],
        raw={},
    )

    json_payloads: list[Any] = []
    with sync_playwright() as p:
        _debug(debug, f"Launching browser for DeepSeek account from {credential_source}...")
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            locale="en-US",
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.set_default_timeout(int(max(10.0, timeout) * 1000))

        def handle_response(response):
            url = response.url.lower()
            if "deepseek" not in url:
                return
            try:
                content_type = response.headers.get("content-type", "")
                if "json" not in content_type and not re.search(r"/api/|/v\d+/", url):
                    return
                json_payloads.append(response.json())
            except Exception:
                return

        page.on("response", handle_response)
        try:
            page.goto(USAGE_URL, wait_until="domcontentloaded", timeout=int(timeout * 1000))
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            time.sleep(1.5)

            if _is_deepseek_sign_in_url(page.url) or page.locator('input[type="password"]').count() > 0:
                _debug(debug, "Login form detected.")
                for text in ("Password Login", "密码登录", "Log in with password", "账号密码登录"):
                    try:
                        tab = page.get_by_text(text).first
                        if tab.is_visible(timeout=1200):
                            tab.click()
                            time.sleep(0.7)
                            break
                    except Exception:
                        continue

                account_ok = _fill_first_visible(
                    page.locator('input[type="email"], input[type="tel"], input[name*="account"], input[name*="email"], input[name*="phone"], input[placeholder*="email" i], input[placeholder*="phone" i], input[placeholder*="邮箱"], input[placeholder*="手机"], input[type="text"]'),
                    email,
                )
                password_ok = _fill_first_visible(page.locator('input[type="password"], input[name*="password"], input[placeholder*="密码"]'), password)
                if not account_ok or not password_ok:
                    raise RuntimeError("Could not fill DeepSeek login form.")

                clicked = False
                for selector in ('button[type="submit"]', 'button:has-text("Log in")', 'button:has-text("Login")', 'button:has-text("登录")'):
                    try:
                        button = page.locator(selector).first
                        if button.is_visible(timeout=1200):
                            button.click()
                            clicked = True
                            break
                    except Exception:
                        continue
                if not clicked:
                    page.locator('input[type="password"]').first.press("Enter")
                try:
                    page.wait_for_url(lambda url: not _is_deepseek_sign_in_url(url), timeout=int(timeout * 1000))
                except Exception:
                    _debug(debug, "Login redirect timeout; checking sign-in page state.")
                    if _is_deepseek_sign_in_url(page.url):
                        raise RuntimeError(_login_failure_message(page))
                page.goto(USAGE_URL, wait_until="domcontentloaded", timeout=int(timeout * 1000))
                try:
                    page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    pass
                time.sleep(2)
                if _is_deepseek_sign_in_url(page.url):
                    raise RuntimeError(_login_failure_message(page))

            page_text = _wait_for_usage_text(page, timeout, debug)
            window, credits, extras = _extract_from_page_text(page_text)
            if window is None:
                window, credits, extras = _extract_from_json_payloads(json_payloads)
            if window is not None:
                snapshot.windows["primary"] = window
                snapshot.credits = credits
                snapshot.extras = {key: value for key, value in extras.items() if value is not None}
            else:
                snapshot.warnings.append("DeepSeek usage page loaded, but no balance or usage data was found.")

            snapshot.raw = {
                "page_title": page.title(),
                "url": page.url,
                "text_sample": page_text[:500],
                "json_payload_count": len(json_payloads),
            }
        finally:
            browser.close()
    return snapshot
