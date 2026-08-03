"""theme-switcher plugin backend: list, inspect, and apply Hermes skins.

Mounted by the desktop backend under /api/plugins/theme-switcher/.
Read + a single write: applying a skin writes display.skin through the same
canonical config writer the gateway's config.set uses, so the skin watcher
announces the change and every surface (CLI, TUI, desktop) repaints live.
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Body

router = APIRouter()

CATEGORY_PREFIXES = [
    ("dark-", "Dark"),
    ("light-", "Light"),
    ("vibrant-", "Vibrant"),
    ("nature-", "Nature"),
    ("minimal-", "Minimal"),
    ("retro-", "Retro"),
]


def _skin_preview(name: str) -> Dict[str, str]:
    """Return the representative palette colors for a skin, or {} on failure."""
    try:
        from hermes_cli.skin_engine import load_skin

        c = load_skin(name).colors
    except Exception:
        return {}

    def pick(*keys: str) -> str:
        for k in keys:
            if c.get(k):
                return c[k]
        return ""

    return {
        "background": pick("background"),
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
        out.append(
            {
                "name": name,
                "description": s.get("description", ""),
                "source": s.get("source", "user"),
                "category": cat,
                "colors": _skin_preview(name),
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
    name = str(payload.get("name", "")).strip()
    if not name:
        return {"ok": False, "error": "name required"}
    available = {s["name"] for s in _skins()}
    if name not in available:
        return {"ok": False, "error": f"unknown skin: {name}"}
    try:
        _apply_skin(name)
    except Exception as e:  # noqa: BLE001 - surface honest failure to the UI
        return {"ok": False, "error": f"apply failed: {e}"}
    return {"ok": True, "active": name}
