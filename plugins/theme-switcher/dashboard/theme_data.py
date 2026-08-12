"""theme-switcher plugin data: category mapping, community themes, twin pairs.

Pure data + tiny lookups, deliberately free of any framework import so the
test suite (which runs without fastapi) can validate the maps directly.
plugin_api.py imports from here; nothing else should define these.

Kept in sync with the README Themes table and the generator.
"""

CATEGORY_PREFIXES = [
    ("dark-", "Dark"),
    ("light-", "Light"),
    ("vibrant-", "Vibrant"),
    ("nature-", "Nature"),
    ("minimal-", "Minimal"),
    ("retro-", "Retro"),
]

# Community-contributed themes (from PRs) have arbitrary names, so they are
# mapped by exact name rather than by prefix.
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

# Light/dark twin pairs: the same vibe in both polarities. Used by the Theme
# Switcher's flip button — a card with a twin gets a one-click switch to the
# matching theme on the other side. Each entry is (dark, light); the lookup
# below exposes both directions.
THEME_PAIRS = [
    ("dark-aubergine", "light-lavender"),
    ("dark-charcoal", "light-cloud"),
    ("dark-crimson", "light-rose"),
    ("dark-dracula", "light-dracula"),
    ("dark-lcars", "light-lcars"),
    ("dark-navy", "light-sky"),
    ("dark-obsidian", "light-porcelain"),
    ("dark-plum", "light-grape"),
    ("minimal-graphite", "minimal-pearl"),
    ("warm-ash", "light-oat"),
    ("nature-autumn", "light-melon"),
    ("nature-desert", "light-sand"),
    ("nature-forest", "light-fern"),
    ("nature-nordic", "light-frost"),
    ("nature-ocean", "light-tide"),
    ("newsprint-noir", "light-paper"),
    ("peach-fuzz", "light-peach"),
    ("redwood", "light-cream"),
    ("retro-amber", "light-honey"),
    ("retro-blue", "light-denim"),
    ("retro-terminal", "light-mint"),
    ("shadow-thief", "light-lilac"),
    ("slate-mist", "light-mist"),
    ("steel-thread", "light-ash"),
    ("vaporwave-mall", "light-aqua"),
    ("vibrant-sunset", "light-blush"),
    ("dark-bone", "minimal-bone"),
    ("dark-lemon", "light-lemon"),
    ("dark-mac", "retro-mac"),
    ("dark-sage", "light-sage"),
    ("dark-vanilla", "light-vanilla"),
    ("vibrant-neon", "light-neon"),
    ("vibrant-pacific", "light-pacific"),
    ("stained-glass", "light-stained-glass"),
    ("vibrant-synthwave", "light-synthwave"),
    ("void-sunset", "light-sunset"),
    ("dark-solarized", "light-solarized"),
    ("dark-gruvbox", "light-gruvbox"),
    ("dark-tokyo-night", "light-tokyo-day"),
    ("dark-catppuccin", "light-catppuccin"),
    ("dark-nord", "light-nord"),
    ("dark-rosepine", "light-rosepine"),
    ("dark-one", "light-one"),
    ("dark-everforest", "light-everforest"),
    ("dark-kanagawa", "light-kanagawa"),
    ("dark-ayu", "light-ayu"),
    ("dark-github", "light-github"),
    ("dark-material", "light-material"),
    ("dark-vscode", "light-vscode"),
    ("dark-cozy-paper", "light-cozy-paper"),
]

_TWIN_LOOKUP = {}
for _dark, _light in THEME_PAIRS:
    _TWIN_LOOKUP[_dark] = _light
    _TWIN_LOOKUP[_light] = _dark


def twin(name: str) -> str:
    """The paired theme of the opposite polarity, or '' if none."""
    return _TWIN_LOOKUP.get(name, "")


def dashboard_theme_label(name: str) -> str:
    """Human label for a dashboard theme generated from a skin name."""
    return name.replace("-", " ").strip().title()


def build_dashboard_theme(name: str, colors: dict) -> dict:
    """Build a minimal dashboard-theme dict from a skin's preview colors.

    Maps the Hermes skin triplet onto the web dashboard's 3-layer palette:
    background -> canvas, text -> midground (primary text + accent), accent ->
    foreground (ring/highlight). Missing keys fall back to the dashboard
    normaliser's defaults so the generated theme is always valid; the
    dashboard fills typography/layout from its own defaults.
    """
    src = colors or {}
    return {
        "name": name,
        "label": dashboard_theme_label(name),
        "description": f"Auto-generated from the Hermes skin '{name}'.",
        "palette": {
            "background": src.get("background") or "#041c1c",
            "midground": src.get("text") or "#ffe6cb",
            "foreground": src.get("accent") or "#268bd2",
        },
    }
