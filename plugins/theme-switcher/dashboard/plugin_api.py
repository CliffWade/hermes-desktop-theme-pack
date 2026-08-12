"""theme-switcher plugin backend: list, inspect, and apply Hermes skins.

Mounted by the desktop backend under /api/plugins/theme-switcher/.
Read + a single write: applying a skin writes display.skin through the same
canonical config writer the gateway's config.set uses, so the skin watcher
announces the change and every surface (CLI, TUI, desktop) repaints live.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from fastapi import APIRouter, Body

try:
    import yaml as _yaml
except Exception:  # pragma: no cover - hermes ships pyyaml
    _yaml = None

# The plugin backend is loaded standalone via spec_from_file_location (no
# package context, dashboard dir not on sys.path), so a relative import
# would fail. Add the dashboard dir and use an absolute import instead.
import os
import sys

_DASH_DIR = os.path.dirname(os.path.abspath(__file__))
if _DASH_DIR not in sys.path:
    sys.path.insert(0, _DASH_DIR)

from theme_data import (
    CATEGORY_PREFIXES,
    COMMUNITY_THEMES,
    build_dashboard_theme,
    twin as _twin,
)

router = APIRouter()

_prev_skin: str = ""

# First-seen install times for user skins. Persisted to
# <hermes_home>/data/theme-switcher-installs.json so a reinstall (which
# rewrites the skin file and changes its mtime) does NOT reset the NEW badge:
# the badge is based on when the theme was FIRST installed, not last written.
_install_times: Dict[str, int] = {}


def _installs_path():
    from hermes_constants import get_hermes_home

    return get_hermes_home() / "data" / "theme-switcher-installs.json"


def _load_install_times() -> None:
    global _install_times
    try:
        import json

        p = _installs_path()
        if p.is_file():
            _install_times = {k: int(v) for k, v in json.loads(p.read_text()).items()}
    except Exception:
        _install_times = {}


def _save_install_times() -> None:
    try:
        import json

        p = _installs_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(_install_times), encoding="utf-8")
    except Exception:
        pass


def _first_install_time(name: str) -> int:
    """When the theme was first installed (epoch seconds), or 0 if unknown.

    Only records written by the install flow count. File mtime is deliberately
    NOT used: install.sh copies every skin file (fresh mtime) and would make
    every theme look freshly installed on every re-run.
    """
    return _install_times.get(name, 0)


def _settings_path():
    from hermes_constants import get_hermes_home

    return get_hermes_home() / "data" / "theme-switcher-settings.json"


def _load_settings() -> Dict[str, Any]:
    """Persisted UI settings (follow-system flag etc.)."""
    try:
        import json

        p = _settings_path()
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_settings(settings: Dict[str, Any]) -> None:
    try:
        import json

        p = _settings_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(settings), encoding="utf-8")
    except Exception:
        pass


def _follow_system() -> bool:
    return bool(_load_settings().get("follow_system", False))


def _skin_colors(name: str) -> Dict[str, str]:
    """Return the full color key map for a skin, or {} on failure."""
    try:
        from hermes_cli.skin_engine import load_skin

        return dict(load_skin(name).colors or {})
    except Exception:
        return {}


def _skin_preview(name: str) -> Dict[str, str]:
    """Return the representative palette colors for a skin, or {} on failure."""
    c = _skin_colors(name)
    if not c:
        return {}

    def pick(*keys: str) -> str:
        for k in keys:
            if c.get(k):
                return c[k]
        return ""

    return {
        "background": pick("background", "status_bar_bg"),
        "accent": pick("ui_accent", "banner_accent"),
        "tool": pick("ui_tool", "banner_accent"),
        "text": pick("banner_text", "ui_text"),
        "secondary": pick("banner_dim"),
        "border": pick("banner_border", "ui_border"),
    }


def _skins() -> List[Dict[str, str]]:
    from hermes_cli.skin_engine import list_skins

    # Load the persisted first-seen records so the list reflects real install
    # history; without this the in-memory dict is empty and no theme shows NEW.
    _load_install_times()

    out = []
    for s in list_skins():
        name = s["name"]
        cat = "Built-in" if s.get("source") == "builtin" else "Other"
        for prefix, label in CATEGORY_PREFIXES:
            if name.startswith(prefix):
                cat = label
                break
        if name in COMMUNITY_THEMES:
            cat = "Community"
        installed_at = None
        if s.get("source") != "builtin":
            t = _first_install_time(name)
            # Only install-flow records count. Unknown themes (installed by
            # install.sh, copied by hand, etc.) get no NEW badge until the
            # user installs them through the app, which records first-seen.
            if t:
                installed_at = t
        out.append(
            {
                "name": name,
                "description": s.get("description", ""),
                "source": s.get("source", "user"),
                "category": cat,
                "colors": _skin_preview(name),
                "full_colors": _skin_colors(name),
                "installed_at": installed_at,
                "twin": _twin(name) or None,
            }
        )
    return out


def _active() -> str:
    # Config is the source of truth: display.skin is what actually got applied.
    # get_active_skin() can report "default" in processes where the CLI skin
    # cache was never initialized (e.g. a freshly imported plugin module), so
    # prefer the raw config value and use the skin engine only as a fallback.
    try:
        from hermes_cli.config import load_config

        name = (load_config().get("display") or {}).get("skin") or ""
        if name:
            return name
    except Exception:
        pass
    try:
        from hermes_cli.skin_engine import get_active_skin

        return get_active_skin().name
    except Exception:
        return "default"


def _apply_skin(name: str) -> None:
    """Write display.skin through the canonical config writer."""
    from tui_gateway.server import _write_config_key

    _write_config_key("display.skin", name)


def _dashboard_themes_dir():
    from hermes_constants import get_hermes_home

    return get_hermes_home() / "dashboard-themes"


def _ensure_dashboard_theme(name: str, colors: Dict[str, str]) -> bool:
    """Write ~/.hermes/dashboard-themes/<name>.yaml if it does not exist.

    Returns True when the theme file is present afterwards (written now or
    already there). Never overwrites an existing user theme: a hand-authored
    YAML wins over the generated one.
    """
    if _yaml is None:
        return False
    try:
        d = _dashboard_themes_dir()
        d.mkdir(parents=True, exist_ok=True)
        target = d / f"{name}.yaml"
        if target.exists():
            return True
        target.write_text(
            _yaml.safe_dump(
                build_dashboard_theme(name, colors),
                sort_keys=False,
                default_flow_style=False,
            ),
            encoding="utf-8",
        )
        return True
    except Exception:
        return False


@router.get("/list")
def list_themes() -> Dict[str, Any]:
    return {"skins": _skins(), "active": _active()}


@router.get("/settings")
def get_settings() -> Dict[str, Any]:
    """UI settings: follow_system drives auto light/dark twin switching."""
    return {"ok": True, "follow_system": _follow_system()}


@router.post("/settings")
def set_settings(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    settings = _load_settings()
    if "follow_system" in payload:
        settings["follow_system"] = bool(payload.get("follow_system"))
    _save_settings(settings)
    return {"ok": True, "follow_system": bool(settings.get("follow_system", False))}


@router.post("/apply")
def apply_theme(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    global _prev_skin
    name = str(payload.get("name", "")).strip()
    if not name:
        return {"ok": False, "error": "name required"}
    available = {s["name"] for s in _skins()}
    if name not in available:
        return {"ok": False, "error": f"unknown skin: {name}"}
    try:
        skins = _skins()
        skin_colors = next((s.get("colors") for s in skins if s["name"] == name), None)
        if not isinstance(skin_colors, dict):
            skin_colors = {}
        _prev_skin = _active()
        _apply_skin(name)
        dashboard_ok = False
        if _ensure_dashboard_theme(name, skin_colors):
            from tui_gateway.server import _write_config_key

            _write_config_key("dashboard.theme", name)
            dashboard_ok = True
    except Exception as e:  # noqa: BLE001 - surface honest failure to the UI
        return {"ok": False, "error": f"apply failed: {e}"}
    return {
        "ok": True,
        "active": name,
        "previous": _prev_skin,
        "dashboard_theme": name if dashboard_ok else None,
    }


@router.get("/raw")
def raw_theme(name: str) -> Dict[str, Any]:
    """Return the raw YAML of an installed user skin, for copy/share.

    Built-in skins have no source file, so they 404 — only user skins can be
    exported. Used by the desktop plugin's Copy YAML button.
    """
    name = str(name or "").strip()
    if not name:
        return {"ok": False, "error": "name required"}
    from hermes_constants import get_hermes_home

    path = get_hermes_home() / "skins" / f"{name}.yaml"
    if not path.is_file():
        return {"ok": False, "error": f"no user skin file for '{name}'"}
    return {"ok": True, "name": name, "yaml": path.read_text(encoding="utf-8")}


@router.post("/install")
def install_theme(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Install a skin from raw YAML pasted in the desktop app."""
    content = str(payload.get("content", "")).strip()
    if not content:
        return {"ok": False, "error": "theme YAML required"}
    if _yaml is None:
        return {"ok": False, "error": "yaml unavailable"}
    try:
        data = _yaml.safe_load(content)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"invalid YAML: {e}"}
    if not isinstance(data, dict):
        return {"ok": False, "error": "theme YAML must be a mapping"}
    name = str(data.get("name", "")).strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
        return {"ok": False, "error": "theme name must be lowercase letters, numbers, hyphens"}
    colors = data.get("colors")
    if not isinstance(colors, dict) or not colors:
        return {"ok": False, "error": "theme must define a colors section"}
    if not colors.get("background") and not colors.get("ui_accent"):
        return {"ok": False, "error": "theme must define background or ui_accent"}
    if name in {s["name"] for s in _skins()}:
        return {"ok": False, "error": f"theme '{name}' already exists"}

    from hermes_constants import get_hermes_home

    skins_dir = get_hermes_home() / "skins"
    skins_dir.mkdir(parents=True, exist_ok=True)
    path = skins_dir / f"{name}.yaml"
    if path.exists():
        return {"ok": False, "error": f"theme '{name}' already exists"}
    path.write_text(content, encoding="utf-8")
    # Record first-seen install time. If the theme was seen before (a previous
    # install that was later removed), keep the ORIGINAL first-seen time so a
    # reinstall does not re-trigger the NEW badge.
    _load_install_times()
    if name not in _install_times:
        import time as _time

        _install_times[name] = int(_time.time())
        _save_install_times()
    return {"ok": True, "active": _active(), "name": name}
