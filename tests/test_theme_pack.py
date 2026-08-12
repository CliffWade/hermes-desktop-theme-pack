"""Invariant tests for the Hermes theme pack.

Run from the repo root:  python3 -m pytest tests/ -q

These assert contracts between the themes and the WCAG gate, not snapshots
of current values, so adding or removing themes never breaks the suite.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
THEMES_DIR = REPO / "themes"


def _lum(h):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (f(int(h[i : i + 2], 16)) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a, b):
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _parse_hex(v):
    v = str(v).strip().lstrip("#")
    return v if re.fullmatch(r"[0-9a-fA-F]{6}", v) else None


def _load_themes():
    docs = []
    for p in sorted(THEMES_DIR.glob("*.yaml")):
        doc = yaml.safe_load(p.read_text())
        docs.append((p.stem, doc))
    return docs


def test_every_theme_has_valid_structure():
    assert THEMES_DIR.glob("*.yaml"), "themes/ is empty"
    for name, doc in _load_themes():
        assert isinstance(doc, dict), name
        assert doc.get("name") == name, name
        assert doc.get("description"), name
        colors = doc.get("colors")
        assert isinstance(colors, dict), name
        assert _parse_hex(colors.get("background")), f"{name}: background"


def test_every_theme_passes_wcag_contrast_gate():
    # Contract: primary text >= 6:1, accent and secondary >= 4.5:1 against
    # the theme's own background. Recomputed here, not borrowed from the
    # generator, so the gate is verified independently.
    for name, doc in _load_themes():
        bg = _parse_hex(doc["colors"]["background"])
        for key, target in (("banner_text", 6.0), ("ui_accent", 4.5), ("banner_dim", 4.5)):
            fg = _parse_hex(doc["colors"].get(key))
            assert fg is not None, f"{name}: {key} missing"
            ratio = _contrast(fg, bg)
            assert ratio >= target, f"{name}: {key} {ratio:.2f} < {target}"


def test_light_themes_have_light_backgrounds():
    for name, doc in _load_themes():
        if name.startswith("light-"):
            bg = _parse_hex(doc["colors"]["background"])
            assert _lum(bg) >= 0.7, f"{name}: light theme with dark bg {bg}"


def test_theme_names_are_safe_slugs():
    for name, _doc in _load_themes():
        assert re.fullmatch(r"[a-z0-9][a-z0-9-]*", name), name


def test_regeneration_is_idempotent():
    before = {p.name: p.read_bytes() for p in THEMES_DIR.glob("*.yaml")}
    subprocess.run(
        [sys.executable, "scripts/generate_themes.py"],
        cwd=REPO, check=True, capture_output=True,
    )
    after = {p.name: p.read_bytes() for p in THEMES_DIR.glob("*.yaml")}
    assert before == after


def test_installer_installs_every_theme():
    with tempfile.TemporaryDirectory() as td:
        env = dict(os.environ, HERMES_HOME=td)
        subprocess.run(["bash", "install.sh"], cwd=REPO, check=True, capture_output=True, env=env)
        installed = {p.name for p in Path(td, "skins").glob("*.yaml")}
        expected = {p.name for p in THEMES_DIR.glob("*.yaml")}
        assert installed == expected


def test_readme_claims_match_actual_themes():
    """README count/category claims must track the themes directory.

    Contract between the two sources of truth (docs vs files), not a snapshot
    of current values: the README's lead line must name the real number of
    themes and categories, and every theme file must appear in exactly one
    category row of the Themes table. Adding a theme without updating the
    README (or vice versa) fails here — the same drift class that previously
    shipped a stale "24 themes" GitHub description.
    """
    readme = (REPO / "README.md").read_text()

    themes = _load_themes()
    names = {doc["name"] for _stem, doc in themes}

    # Categories are derived from filenames, exactly like the backend
    # (plugins/theme-switcher/dashboard/plugin_api.py): prefix map first,
    # then the community set for arbitrary names.
    prefix_cats = [
        ("dark-", "Dark"), ("light-", "Light"), ("vibrant-", "Vibrant"),
        ("nature-", "Nature"), ("minimal-", "Minimal"), ("retro-", "Retro"),
    ]
    community = {
        "vaporwave-mall", "stained-glass", "shadow-thief", "void-sunset",
        "redwood", "newsprint-noir", "peach-fuzz", "slate-mist",
        "steel-thread", "warm-ash",
    }

    def category_of(name):
        for prefix, label in prefix_cats:
            if name.startswith(prefix):
                return label
        if name in community:
            return "Community"
        return "Other"

    cats = {category_of(n) for n in names}

    # Lead line: "34 curated color themes ... 7 categories" must match files.
    m = re.search(r"(\d+) curated color themes[\s\S]*?(\d+) categories", readme)
    assert m, "README lead line missing 'N curated color themes ... M categories'"
    assert int(m.group(1)) == len(themes), f"README says {m.group(1)} themes, themes/ has {len(themes)}"
    assert int(m.group(2)) == len(cats), f"README says {m.group(2)} categories, themes define {len(cats)}"

    # Themes table: every theme appears in exactly one category row.
    # The table ends at the next heading (the Theme pairs section etc.),
    # so a second table later in the README can't be mistaken for rows.
    table = ""
    if "| Category | Themes |" in readme:
        after = readme.split("| Category | Themes |", 1)[1]
        table = after.split("\n## ", 1)[0]
    assert table, "README missing the Themes table"
    mentioned = set()
    for row in table.splitlines():
        if not row.strip().startswith("|") or row.strip().startswith("| Category") or set(row.strip()) <= {"|", "-", " "}:
            continue
        for theme in names:
            if f" {theme}," in row or row.strip().endswith(theme) or f" {theme} " in row:
                assert theme not in mentioned, f"{theme} appears in multiple category rows"
                mentioned.add(theme)
    assert mentioned == names, f"README table missing themes: {sorted(names - mentioned)}"


def test_readme_distinguishes_desktop_ui_from_web_dashboard_and_remote_backend():
    """Install guidance must name both plugin systems and both SSH hosts."""
    readme = (REPO / "README.md").read_text()
    section_match = re.search(
        r"^## Theme Switcher [^\n]*\n(?P<body>.*?)(?=^## )",
        readme,
        re.MULTILINE | re.DOTALL,
    )

    assert section_match, "README must identify both plugin surfaces in its heading"
    section = section_match.group("body")
    assert "Themes tab in the web dashboard" in section
    assert "remote backend host" in section
    assert "local Desktop computer" in section
    assert "$env:LOCALAPPDATA" in section
    assert "nonce-aware stale Desktop SSH backend recovery" in section
    assert "Do not kill the backend PID directly" in section


def test_dashboard_manifest_ships_a_real_tab_and_entry_bundle():
    """The web dashboard must get a real tab + JS bundle, not just the API.

    Mirrors the reported gap in #2: the dashboard manifest used to carry only
    the backend API, so `hermes dashboard` had no Themes UI. Now it declares a
    tab and an entry bundle that registers the component.
    """
    manifest = json.loads(
        (REPO / "plugins/theme-switcher/dashboard/manifest.json").read_text()
    )
    assert manifest["name"] == "theme-switcher"
    assert manifest["tab"]["path"] == "/themes"
    assert manifest["entry"], "manifest must point at a JS bundle"

    entry = REPO / "plugins/theme-switcher/dashboard" / manifest["entry"]
    assert entry.exists(), f"entry bundle missing: {entry}"
    assert entry.stat().st_size > 500, "entry bundle looks empty"
    source = entry.read_text()
    assert 'register("theme-switcher"' in source, "bundle must register the tab"
    assert "__HERMES_PLUGIN_SDK__" in source, "bundle must use the dashboard SDK"

    if manifest.get("css"):
        css = REPO / "plugins/theme-switcher/dashboard" / manifest["css"]
        assert css.exists(), f"declared css missing: {css}"


def test_dashboard_theme_builder_maps_skin_palette():
    """Generated dashboard themes map bg/text/accent and stay valid.

    The backend writes these to ~/.hermes/dashboard-themes/ on apply so the
    web dashboard repaints in the chosen skin. The mapping must be exact and
    the fallbacks must never produce an invalid theme.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "theme_data",
        REPO / "plugins/theme-switcher/dashboard/theme_data.py",
    )
    assert spec and spec.loader, "could not load theme_data.py"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    colors = {
        "background": "#002b36",
        "text": "#839496",
        "accent": "#268bd2",
    }
    t = mod.build_dashboard_theme("dark-solarized", colors)
    assert t["name"] == "dark-solarized"
    assert t["label"] == "Dark Solarized"
    assert t["palette"]["background"] == "#002b36"
    assert t["palette"]["midground"] == "#839496"
    assert t["palette"]["foreground"] == "#268bd2"

    # Missing colors must fall back to valid hex values, never None/empty.
    t2 = mod.build_dashboard_theme("minimal-bone", {})
    for key in ("background", "midground", "foreground"):
        assert t2["palette"][key] and t2["palette"][key].startswith("#")
    assert t2["label"] == "Minimal Bone"


def test_theme_cards_use_a_readable_responsive_grid():
    """Theme cards must wrap by minimum width instead of forcing seven columns."""
    source = (REPO / "desktop-plugin/theme-switcher/plugin.js").read_text()

    assert "calc((100% - 48px) / 7)" not in source
    assert "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" in source
    assert source.count("style: THEME_GRID_STYLE") == 3


def test_hover_tooltips_use_the_themed_tip_component():
    """Hover tooltips must use the app's themed Tip (SDK export), never native
    title= attributes — native titles render unreadable (white on pale) on
    some hosts. Every interactive tooltip on the Themes page is themed."""
    source = (REPO / "desktop-plugin/theme-switcher/plugin.js").read_text()

    # The themed tooltip component is imported from the SDK and used.
    assert "Tip," in source
    assert "from '@hermes/plugin-sdk'" in source

    # Card description tooltip (the hover card) is themed.
    assert "title: `${theme.description" not in source
    assert "jsx(Tip, {" in source
    assert "label: `${theme.description || theme.name}" in source

    # Swatch, polarity glyph, copy/flip buttons, follow button, statusbar chip.
    assert "title: `${label}: ${color}`" not in source
    assert "title: isLight ? 'Light theme' : 'Dark theme'" not in source
    assert "title: copied ? 'Copied!'" not in source
    assert "title: `Switch to paired theme:" not in source
    assert "title: follow" not in source
    assert "title: follow ?" not in source


def test_dashboard_cards_share_the_desktop_responsive_grid():
    """The dashboard tab's grid must use the same fluid formula as the Desktop
    page: auto-fit (fills the last row), min(100%, ...) guard (sub-240px
    containers collapse to one column instead of overflowing), and container
    queries so cards adapt to the resizable panel, not just the viewport."""
    css = (REPO / "plugins/theme-switcher/dashboard/dist/style.css").read_text()

    assert "grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr))" in css
    assert "grid-template-columns: repeat(auto-fill" not in css
    assert "calc((100% - 48px) / 7)" not in css
    assert "container-type: inline-size" in css
    assert "@container (max-width: 560px)" in css
    assert "@media (max-width: 640px)" in css


def test_twin_pairs_resolve_to_real_opposite_polarity_themes():
    """Every light/dark twin pair names existing themes of opposite polarity.

    The backend plugin (plugins/theme-switcher/dashboard/theme_data.py) exposes
    THEME_PAIRS to drive the Theme Switcher's flip button. This test keeps that
    map honest: each entry must be (dark, light), both names must exist on
    disk, no theme may appear in more than one pair.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "theme_data",
        REPO / "plugins/theme-switcher/dashboard/theme_data.py",
    )
    assert spec and spec.loader, "could not load theme_data.py"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    pairs = mod.THEME_PAIRS
    assert pairs, "no twin pairs defined"
    assert isinstance(pairs, list)

    by_name = {}
    for p in THEMES_DIR.glob("*.yaml"):
        doc = yaml.safe_load(p.read_text())
        by_name[doc["name"]] = doc

    seen = set()
    for dark, light in pairs:
        assert dark in by_name, f"pair names unknown dark theme: {dark}"
        assert light in by_name, f"pair names unknown light theme: {light}"
        assert _lum(by_name[dark]["colors"]["background"].lstrip("#")) <= 0.5, f"{dark} is not dark"
        assert _lum(by_name[light]["colors"]["background"].lstrip("#")) > 0.5, f"{light} is not light"
        assert dark not in seen, f"{dark} appears in multiple pairs"
        assert light not in seen, f"{light} appears in multiple pairs"
        seen.add(dark)
        seen.add(light)

    # Bidirectional lookup must agree.
    for dark, light in pairs:
        assert mod.twin(dark) == light, f"twin({dark}) != {light}"
        assert mod.twin(light) == dark, f"twin({light}) != {dark}"
    # Unpaired themes must return '' (and may be zero — every theme paired).
    unpaired = [n for n in by_name if n not in seen]
    for name in unpaired:
        assert mod.twin(name) == "", f"twin({name}) should be empty"


def test_every_theme_ships_opposite_polarity_colors():
    """Every curated + community theme carries a light_colors or dark_colors
    block, so the CLI/TUI can repaint coherently when the terminal polarity
    differs from the theme's canvas.

    Light themes must ship dark_colors (a dark fallback); dark themes must
    ship light_colors. The block must be a mapping whose background has the
    OPPOSITE polarity and whose banner_text passes the 4.5:1 contrast gate
    against that background.
    """
    for p in THEMES_DIR.glob("*.yaml"):
        doc = yaml.safe_load(p.read_text())
        assert doc and isinstance(doc, dict), f"{p.name}: not a mapping"
        name = doc.get("name", "")
        colors = doc.get("colors") or {}
        is_light = _lum(colors.get("background", "").lstrip("#")) > 0.5

        if is_light:
            block = doc.get("dark_colors")
            assert block, f"{name}: light theme missing dark_colors fallback"
        else:
            block = doc.get("light_colors")
            assert block, f"{name}: dark theme missing light_colors fallback"

        assert isinstance(block, dict) and block.get("background"), f"{name}: empty pairing block"
        opp_lum = _lum(block["background"].lstrip("#"))
        assert (opp_lum > 0.5) != is_light, f"{name}: pairing block not opposite polarity"

        ratio = _contrast(str(block.get("banner_text", "")).lstrip("#"), str(block["background"]).lstrip("#"))
        assert ratio >= 4.5, f"{name}: pairing banner_text contrast {ratio:.2f} < 4.5"

