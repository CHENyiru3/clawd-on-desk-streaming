#!/usr/bin/env python3
"""
Hermes CLI Permission Bridge

hooks/clawd-on-desk-streaming

Injected via PYTHONPATH when Clawd spawns `hermes chat -q`.
Patches subprocess.Popen to intercept dangerous commands, forward
them to Clawd's /permission HTTP endpoint, and poll a tempfile
for the user's decision before returning.

Env vars required:
  CLAWD_PERMISSION_URL       — e.g. "http://127.0.0.1:23333/permission"
  HERMES_BRIDGE_SESSION_ID   — session identifier for this Hermes session
  HERMES_PERMISSION_ENABLED  — "1" or "true" to activate; absent/0 = no-op stub

Poll file shape (Clawd writes this on user decision):
  {"choice": "once" | "session" | "always" | "deny"}

The bridge polls every 100ms, timeout 300s (5 minutes).
"""

import sys
import os
import json
import time
import tempfile
import threading
import urllib.request
import urllib.error
import builtins
import subprocess

POLL_INTERVAL_SEC = 0.1
POLL_TIMEOUT_SEC = 300
VALID_CHOICES = ("once", "session", "always", "deny")

# Commands considered dangerous enough to warrant a Clawd bubble.
# Matches patterns Hermes itself would prompt for.
DANGEROUS_PATTERNS = (
    "rm -rf",
    "rm -fr",
    "dd if=",
    "mkfs",
    "sfdisk",
    "fdisk",
    "parted",
    "> /dev/sd",
    "chattr -i",
    "wipefs",
    "shred -f",
)


def _is_dangerous_command(cmd_str):
    """Return True if cmd_str matches any dangerous pattern."""
    if not cmd_str:
        return False
    return any(pattern in cmd_str for pattern in DANGEROUS_PATTERNS)


def _hermes_approval_callback(command, description="", allow_permanent=False):
    """
    Called by the patched subprocess when a dangerous command is detected.
    Returns one of: "once", "session", "always", "deny"
    """
    url = os.environ.get("CLAWD_PERMISSION_URL")
    session_id = os.environ.get("HERMES_BRIDGE_SESSION_ID", "default")

    if not url:
        sys.stderr.write(
            "[hermes-perm-bridge] CLAWD_PERMISSION_URL not set — "
            "defaulting to deny (Hermes fallback)\n"
        )
        return "deny"

    # Create a temp file path for the decision channel. The file must not
    # contain request JSON; Clawd writes only {"choice": "..."} when the user
    # decides. Leaving it empty/nonexistent avoids reading our own request as a
    # denial before the UI can respond.
    try:
        fd, poll_path = tempfile.mkstemp(prefix="hermes-perm-", suffix=".json")
        os.close(fd)
        os.unlink(poll_path)
    except OSError as exc:
        sys.stderr.write(
            f"[hermes-perm-bridge] mkstemp failed: {exc} — defaulting to deny\n"
        )
        return "deny"

    try:
        request_payload = {
            "agent_id": "hermes",
            "session_id": session_id,
            "tool_name": "HermesExec",
            "tool_input": {
                "command": command,
                "description": description,
                "allow_permanent": bool(allow_permanent),
            },
            "bridge_poll_file": poll_path,
        }

        # HTTP POST to Clawd (fire-and-forget; we wait for the poll, not the POST).
        body_bytes = json.dumps(request_payload).encode("utf-8")
        try:
            req = urllib.request.Request(
                url,
                data=body_bytes,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                # Drain response to release the connection.
                resp.read()
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            sys.stderr.write(
                f"[hermes-perm-bridge] POST to Clawd failed: {exc} — "
                "defaulting to deny\n"
            )
            return "deny"

        # Poll for the decision.
        deadline = time.time() + POLL_TIMEOUT_SEC
        while time.time() < deadline:
            time.sleep(POLL_INTERVAL_SEC)
            try:
                with open(poll_path, "r", encoding="utf-8") as fh:
                    decision = json.load(fh)
                choice = decision.get("choice")
                if choice in VALID_CHOICES:
                    return choice
            except (FileNotFoundError, json.JSONDecodeError, OSError):
                # File not yet written or being written — keep polling.
                continue

        # Timeout — deny by default.
        sys.stderr.write(
            f"[hermes-perm-bridge] poll timeout after {POLL_TIMEOUT_SEC}s "
            f"for command: {command[:60]}\n"
        )
        return "deny"
    finally:
        # Clean up the poll file if it still exists.
        try:
            os.unlink(poll_path)
        except OSError:
            pass


class _PatchedPopen:
    """
    Thread-safe wrapper that delegates to the real Popen after checking for
    dangerous commands.  _real_popen is a class attribute set once so that
    re-patching inside a recursive call does not change behavior.
    """

    _real_popen = subprocess.Popen

    def __new__(cls, args, **kwargs):
        # Reconstruct command string for pattern matching.
        if isinstance(args, (list, tuple)):
            cmd_str = " ".join(str(a) for a in args)
        else:
            cmd_str = str(args)

        if _is_dangerous_command(cmd_str):
            decision = _hermes_approval_callback(
                command=cmd_str,
                description="dangerous command intercepted by Hermes permission bridge",
                allow_permanent=True,
            )
            if decision == "deny":
                raise PermissionError(
                    f"[hermes-perm-bridge] Denied dangerous command: {cmd_str[:80]}"
                )
            # If allowed (once/session/always), fall through to the real Popen.

        return cls._real_popen(args, **kwargs)


_patched_modules = set()
_real_import = builtins.__import__


def _bridge_callback(command, description="", *, allow_permanent=True):
    return _hermes_approval_callback(
        command=command,
        description=description or "",
        allow_permanent=allow_permanent,
    )


def _patch_terminal_tool(module):
    if module in _patched_modules:
        return
    original = getattr(module, "set_approval_callback", None)
    if not callable(original):
        return

    def set_approval_callback(cb):
        if cb is None:
            return original(None)
        return original(_bridge_callback)

    module.set_approval_callback = set_approval_callback
    _patched_modules.add(module)
    sys.stderr.write("[hermes-perm-bridge] patched tools.terminal_tool approval callback\n")


def _patch_approval_module(module):
    if module in _patched_modules:
        return
    original = getattr(module, "prompt_dangerous_approval", None)
    if not callable(original):
        return

    def prompt_dangerous_approval(command, description, timeout_seconds=None,
                                  allow_permanent=True, approval_callback=None):
        return _bridge_callback(
            command,
            description,
            allow_permanent=allow_permanent,
        )

    module.prompt_dangerous_approval = prompt_dangerous_approval
    _patched_modules.add(module)
    sys.stderr.write("[hermes-perm-bridge] patched tools.approval prompt\n")


def _patch_loaded_module(name, module):
    if name == "tools.terminal_tool":
        _patch_terminal_tool(module)
    elif name == "tools.approval":
        _patch_approval_module(module)


def _install_import_hook():
    def importing(name, globals=None, locals=None, fromlist=(), level=0):
        module = _real_import(name, globals, locals, fromlist, level)
        for mod_name in ("tools.terminal_tool", "tools.approval"):
            loaded = sys.modules.get(mod_name)
            if loaded is not None:
                _patch_loaded_module(mod_name, loaded)
        return module

    if builtins.__import__ is not importing:
        builtins.__import__ = importing


def install():
    """Replace subprocess.Popen if HERMES_PERMISSION_ENABLED is set."""
    enabled = os.environ.get("HERMES_PERMISSION_ENABLED", "0")
    if enabled not in ("1", "true", "True"):
        return

    _install_import_hook()
    for mod_name in ("tools.terminal_tool", "tools.approval"):
        loaded = sys.modules.get(mod_name)
        if loaded is not None:
            _patch_loaded_module(mod_name, loaded)

    subprocess.Popen = _PatchedPopen  # noqa: WPS442
    sys.stderr.write("[hermes-perm-bridge] installed — approval hooks active\n")


install()
