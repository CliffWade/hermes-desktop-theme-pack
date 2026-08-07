"""Invariant tests for the Hermes theme pack.

Run from the repo root:  python3 -m pytest tests/ -q

These assert contracts between the themes and the WCAG gate, not snapshots
of current values, so adding or removing themes never breaks the suite.
"""
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
    table = readme.split("| Category | Themes |")[1].split("## Install")[0] if "| Category | Themes |" in readme else ""
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
