"""Clawd Python startup hooks.

Python imports this module automatically when the hooks directory is present on
PYTHONPATH. Keep this file tiny: it should only activate opt-in bridges.
"""

import importlib.util
import os
from pathlib import Path
import sys


def _load_hermes_permission_bridge():
    enabled = os.environ.get("HERMES_PERMISSION_ENABLED", "0")
    if enabled not in ("1", "true", "True"):
        return

    bridge_path = Path(__file__).with_name("hermes-permission-bridge.py")
    if not bridge_path.exists():
        return

    spec = importlib.util.spec_from_file_location(
        "clawd_hermes_permission_bridge",
        str(bridge_path),
    )
    if spec is None or spec.loader is None:
        return
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("clawd_hermes_permission_bridge", module)
    spec.loader.exec_module(module)


_load_hermes_permission_bridge()
