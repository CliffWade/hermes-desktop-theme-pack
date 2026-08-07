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

router = APIRouter()

_prev_skin: str = ""

CATEGORY_PREFIXES = [
    ("dark-", "Dark"),
    ("light-", "Light"),
    ("vibrant-", "Vibrant"),
    ("nature-", "Nature"),
    ("minimal-", "Minimal"),
    ("retro-", "Retro"),
]

# Community-contributed themes (from PRs) have arbitrary names, so they are
# mapped by exact name rather than by prefix. Kept in sync with the README.
COMMUNITY_THEMES = {
    "vaporwave-mall",
    "stained-glass",
    "shadow-thief",
    "void-sunset",
    "redwood",
    "newsprint-noir",
    "peach-fuzz",
    "slate-mist",
    "steel-thread",
    "warm-ash",
}


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
            try:
                from hermes_constants import get_hermes_home

                p = get_hermes_home() / "skins" / f"{name}.yaml"
                installed_at = int(p.stat().st_mtime)
            except Exception:
                installed_at = None
        out.append(
            {
                "name": name,
                "description": s.get("description", ""),
                "source": s.get("source", "user"),
                "category": cat,
                "colors": _skin_preview(name),
                "full_colors": _skin_colors(name),
                "installed_at": installed_at,
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


@router.get("/list")
def list_themes() -> Dict[str, Any]:
    return {"skins": _skins(), "active": _active()}


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
        _prev_skin = _active()
        _apply_skin(name)
    except Exception as e:  # noqa: BLE001 - surface honest failure to the UI
        return {"ok": False, "error": f"apply failed: {e}"}
    return {"ok": True, "active": name, "previous": _prev_skin}


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
    return {"ok": True, "active": _active(), "name": name}
