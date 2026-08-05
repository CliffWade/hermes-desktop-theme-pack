#!/usr/bin/env python3
"""Generate the Hermes theme pack.

Turns the curated seed palettes into complete Hermes skins (themes/*.yaml),
each with the full color key set and WCAG contrast guarantees, plus a
browser preview gallery (docs/preview.html) for screenshots.

Community-contributed themes (drop-in YAML files not in THEMES) are preserved
and included in the preview gallery. Keep COMMUNITY_THEMES in sync with
plugins/theme-switcher/dashboard/plugin_api.py and the README.

Usage: python3 scripts/generate_themes.py
"""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
THEMES_DIR = ROOT / "themes"
DOCS_DIR = ROOT / "docs"

# Mirrors plugins/theme-switcher/dashboard/plugin_api.py. Community themes
# have arbitrary names, so they are matched exactly rather than by prefix.
CATEGORY_PREFIXES = [
    ("dark-", "Dark"),
    ("light-", "Light"),
    ("vibrant-", "Vibrant"),
    ("nature-", "Nature"),
    ("minimal-", "Minimal"),
    ("retro-", "Retro"),
]

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

# ── Color math ────────────────────────────────────────────────────────────

def parse_hex(h):
    h = str(h).strip().lstrip("#")
    if len(h) != 6:
        raise ValueError(f"bad hex: {h!r}")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def to_hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(c)))) for c in rgb)


def mix(c1, c2, t):
    a, b = parse_hex(c1), parse_hex(c2)
    return to_hex(tuple(x + (y - x) * t for x, y in zip(a, b)))


def lighten(h, amt):
    return to_hex(tuple(c + (255 - c) * amt for c in parse_hex(h)))


def darken(h, amt):
    return to_hex(tuple(c * (1 - amt) for c in parse_hex(h)))


def lum(h):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (f(v) for v in parse_hex(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def ensure_contrast(fg, bg, target):
    if contrast(fg, bg) >= target:
        return fg
    dark_bg = lum(bg) < 0.5
    for i in range(1, 25):
        cand = lighten(fg, 0.04 * i) if dark_bg else darken(fg, 0.04 * i)
        if contrast(cand, bg) >= target:
            return cand
    for i in range(1, 25):
        cand = darken(fg, 0.04 * i) if dark_bg else lighten(fg, 0.04 * i)
        if contrast(cand, bg) >= target:
            return cand
    return fg


# ── Seed palettes: 24 themes across 6 categories ─────────────────────────

# Each entry: name, category, description, bg, accent, accent_text (optional
# readable accent), text, secondary, border, plus optional ok/warn/error.
THEMES = [
    # Dark
    dict(name="dark-aubergine", category="Dark", description="Deep aubergine with violet accents",
         bg="#150d22", accent="#7B2D8E", accent_text="#c084fc", text="#f3e8ff", secondary="#8f7ab0", border="#3c2a55"),
    dict(name="dark-obsidian", category="Dark", description="Near-black with violet-gray light",
         bg="#0d0d12", accent="#6e5ce6", accent_text="#b3a6ff", text="#e8e6f2", secondary="#8a8699", border="#232330"),
    dict(name="dark-charcoal", category="Dark", description="Steel gray-blue, calm and neutral",
         bg="#16181d", accent="#4f9cf0", accent_text="#8ec5ff", text="#e6e9ef", secondary="#8b919c", border="#262a33"),
    dict(name="dark-navy", category="Dark", description="Deep ocean navy with clear blue accents",
         bg="#0b1220", accent="#3b82f6", accent_text="#93c5fd", text="#e2e8f0", secondary="#7c8aa5", border="#1c2942"),
    # Light
    dict(name="light-paper", category="Light", description="Warm paper with soft leather brown",
         bg="#f7f4ec", accent="#9a6b3f", text="#2b2620", secondary="#6f675c", border="#ded7c9"),
    dict(name="light-frost", category="Light", description="Cool frost white with slate blue",
         bg="#eef4f8", accent="#2f6f9f", text="#22303b", secondary="#5f7485", border="#d3e0ea"),
    dict(name="light-cloud", category="Light", description="Bright neutral white with steel blue",
         bg="#f5f7fa", accent="#3b6ea8", text="#1c2430", secondary="#5c6b7d", border="#d9e0e8"),
    dict(name="light-cream", category="Light", description="Warm cream with terracotta",
         bg="#faf6ef", accent="#c05b3a", text="#33291f", secondary="#7d6f5e", border="#e5dccb"),
    dict(name="light-mint", category="Light", description="Fresh white with soft mint green",
         bg="#f2faf5", accent="#2f9e6e", text="#1e2b25", secondary="#5f7a6d", border="#d3e8dd"),
    dict(name="light-rose", category="Light", description="Blush white with dusty rose",
         bg="#faf4f5", accent="#b05c77", text="#33262b", secondary="#7d646d", border="#ead7dc"),
    dict(name="light-sand", category="Light", description="Warm sand with olive green",
         bg="#f6f1e4", accent="#7a8a3d", text="#2e2a1e", secondary="#766f58", border="#e0d8bf"),
    dict(name="light-lavender", category="Light", description="Pale lavender with violet",
         bg="#f6f3fb", accent="#7a5fc0", text="#2a2438", secondary="#6f6590", border="#ddd5ec"),
    # Vibrant
    dict(name="vibrant-synthwave", category="Vibrant", description="Retro synthwave, hot pink on violet",
         bg="#1a0b2e", accent="#ff2e88", accent_text="#ff8ac0", text="#f5e9ff", secondary="#b78fd4", border="#3c1f5c"),
    dict(name="vibrant-neon", category="Vibrant", description="Electric green on deep teal-black",
         bg="#081420", accent="#00e5a0", accent_text="#6dffce", text="#e0f7ef", secondary="#7fa3c9", border="#123044"),
    dict(name="vibrant-sunset", category="Vibrant", description="Burnt orange and rose dusk",
         bg="#1e0f1f", accent="#ff6b35", accent_text="#ffb37d", text="#ffe9e0", secondary="#c08a8a", border="#43283a"),
    dict(name="vibrant-pacific", category="Vibrant", description="Tropical lagoon cyan on deep sea",
         bg="#06202b", accent="#00b4d8", accent_text="#66e0ff", text="#d9f4ff", secondary="#7fb4c4", border="#0f3a4a"),
    # Nature
    dict(name="nature-forest", category="Nature", description="Moss and pine, deep green calm",
         bg="#0f1a12", accent="#4caf50", accent_text="#8fe08f", text="#d9ead9", secondary="#86a086", border="#24382a"),
    dict(name="nature-nordic", category="Nature", description="Frosted fjord blue-gray",
         bg="#121a20", accent="#7fb2c5", accent_text="#b7dbe8", text="#dfe8ee", secondary="#8ba0ad", border="#26343e"),
    dict(name="nature-desert", category="Nature", description="Sand dune amber on warm dark",
         bg="#1d1710", accent="#d99a3d", accent_text="#f0c07a", text="#f0e6d8", secondary="#a89072", border="#3a2c1c"),
    # Minimal
    dict(name="minimal-graphite", category="Minimal", description="Gray monochrome, quiet and precise",
         bg="#17181a", accent="#9aa3ad", accent_text="#c3cad2", text="#e8eaec", secondary="#8f959c", border="#26272b"),
    dict(name="minimal-bone", category="Minimal", description="Warm bone white with stone gray",
         bg="#eae6dc", accent="#8a8374", text="#2e2b24", secondary="#7a7468", border="#d4cebf"),
    # Retro
    dict(name="retro-terminal", category="Retro", description="Classic green phosphor terminal",
         bg="#0a1208", accent="#33ff66", accent_text="#7dffa8", text="#c8ffd5", secondary="#5f8f6a", border="#17331c"),
    dict(name="retro-amber", category="Retro", description="Amber CRT glow on near-black",
         bg="#150d04", accent="#ff9d2e", accent_text="#ffc37d", text="#ffe8c8", secondary="#a07c45", border="#3a2810"),
    dict(name="retro-blue", category="Retro", description="Commodore-style bright blue",
         bg="#04081a", accent="#44aaff", accent_text="#8ccaff", text="#d6e6ff", secondary="#6a86b0", border="#122452"),
]

BRANDING = dict(agent_name="Hermes Agent", prompt_symbol="❯", help_header="(^_^)? Commands")


def build_skin(t):
    bg, accent = t["bg"], t["accent"]
    text, secondary, border = t["text"], t["secondary"], t["border"]
    accent_text = ensure_contrast(t.get("accent_text", accent), bg, 4.5)
    ui_text = ensure_contrast(text, bg, 6.0)
    secondary_c = ensure_contrast(secondary, bg, 4.5)
    ok = ensure_contrast(t.get("ok", "#4ade80"), bg, 3.5)
    warn = ensure_contrast(t.get("warn", "#fbbf24"), bg, 3.5)
    error = ensure_contrast(t.get("error", "#f87171"), bg, 3.5)
    surface = mix(bg, accent, 0.09)
    status_bg = darken(bg, 0.10) if lum(bg) < 0.5 else lighten(bg, 0.08)
    return {
        "name": t["name"],
        "description": t["description"],
        "colors": {
            "background": bg,
            "ui_accent": accent_text,
            "banner_accent": accent_text,
            "banner_title": ui_text,
            "banner_text": ui_text,
            "ui_text": ui_text,
            "banner_dim": secondary_c,
            "banner_border": border,
            "ui_border": border,
            "ui_ok": ok,
            "ui_warn": warn,
            "ui_error": error,
            "prompt": ui_text,
            "input_rule": accent_text,
            "response_border": accent,
            "status_bar_bg": status_bg,
            "status_bar_text": ui_text,
            "status_bar_good": ok,
            "status_bar_warn": warn,
            "status_bar_critical": error,
            "session_label": accent_text,
            "session_border": border,
            "ui_tool": accent,
            "ui_thinking": secondary_c,
            "diff_added": ok,
            "diff_removed": error,
            "diff_added_word": ensure_contrast(lighten(ok, 0.25), bg, 4.0),
            "diff_removed_word": ensure_contrast(lighten(error, 0.25), bg, 4.0),
            "syntax_string": ensure_contrast(lighten(ok, 0.15), bg, 4.0),
            "syntax_number": ensure_contrast(lighten(warn, 0.10), bg, 4.0),
            "syntax_keyword": ensure_contrast(lighten(accent_text, 0.08), bg, 4.0),
            "syntax_comment": secondary_c,
            "completion_menu_bg": mix(bg, text, 0.06),
            "completion_menu_current_bg": mix(bg, accent, 0.22),
            "completion_menu_meta_bg": mix(bg, text, 0.10),
        },
        "branding": BRANDING,
        "tool_prefix": "┊",
    }


def emit_yaml(skin):
    out = [f"# Hermes skin — {skin['name']}.", f"# {skin['description']}.", f"name: {skin['name']}", f"description: {skin['description']}", "", "colors:"]
    for k, v in skin["colors"].items():
        out.append(f'  {k}: "{v}"')
    out.append("")
    out.append("branding:")
    for k, v in skin["branding"].items():
        out.append(f"  {k}: {v}")
    out.append("")
    out.append(f'tool_prefix: "{skin["tool_prefix"]}"')
    return "\n".join(out) + "\n"


def main():
    THEMES_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)

    report = []
    for t in THEMES:
        skin = build_skin(t)
        path = THEMES_DIR / f"{t['name']}.yaml"
        path.write_text(emit_yaml(skin), encoding="utf-8")

        bg = t["bg"]
        min_contrast = min(
            contrast(skin["colors"]["banner_text"], bg),
            contrast(skin["colors"]["banner_dim"], bg),
            contrast(skin["colors"]["ui_accent"], bg),
        )
        report.append(f"{t['name']:<20} {t['category']:<8} min contrast {min_contrast:.2f}:1")

    # Preview gallery shows every theme on disk — the curated seeds plus any
    # community drop-in YAML files (which are never rewritten here).
    cards = []
    categories = set()
    for path in sorted(THEMES_DIR.glob("*.yaml")):
        t = yaml.safe_load(path.read_text(encoding="utf-8"))
        if t is None:
            continue
        skin = {"colors": t.get("colors", {}), "branding": t.get("branding", {}),
                "tool_prefix": t.get("tool_prefix", "")}
        t["category"] = _category_of(t["name"])
        categories.add(t["category"])
        cards.append(_card_html(t, skin))

    _write_preview(cards, len(cards), len(categories))
    print("\n".join(report))
    print(f"\nGenerated {len(THEMES)} curated skins + {len(cards) - len(THEMES)} community skins → {THEMES_DIR}")
    print(f"Preview gallery → {DOCS_DIR / 'preview.html'}")


def _category_of(name: str) -> str:
    for prefix, label in CATEGORY_PREFIXES:
        if name.startswith(prefix):
            return label
    if name in COMMUNITY_THEMES:
        return "Community"
    return "Other"


def _card_html(t, skin):
    c = skin["colors"]
    accent_bar = "".join(
        f'<span style="display:inline-block;width:34px;height:34px;border-radius:8px;background:{v};margin-right:6px" title="{k}"></span>'
        for k, v in list(c.items())[:8]
    )
    return f"""
    <div style="background:{c['background']};border:1px solid {c['banner_border']};border-radius:12px;padding:16px;min-width:300px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
        <span style="color:{c['banner_title']};font-weight:700;font-size:14px">{t['name']}</span>
        <span style="color:{c['banner_dim']};font-size:11px">{t['category']}</span>
      </div>
      <div style="color:{c['banner_dim']};font-size:11px;margin-top:2px">{t['description']}</div>
      <div style="height:26px;border-radius:6px;background:{c['ui_accent']};margin:12px 0 8px"></div>
      <div style="color:{c['banner_text']};font-size:12px">Aa — primary text</div>
      <div style="color:{c['banner_dim']};font-size:12px">Aa — muted / secondary</div>
      <div style="color:{c['ui_accent']};font-size:12px;margin-bottom:10px">Aa — accent</div>
      <div>{accent_bar}</div>
    </div>"""


def _write_preview(cards, total=None, cat_count=None):
    total = len(cards) if total is None else total
    cat_count = len({_category_of(getattr(c, "name", "")) for c in cards}) if cat_count is None else cat_count
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Hermes Theme Pack</title></head>
<body style="margin:0;background:#0e0e12;color:#eee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="padding:28px 32px 8px">
  <div style="font-size:24px;font-weight:800">Hermes Theme Pack</div>
  <div style="color:#9aa;font-size:13px;margin-top:4px">{total} skins · {cat_count} categories · WCAG contrast checked</div>
</div>
<div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;padding:20px 32px 32px">
{''.join(cards)}
</div>
</body></html>"""
    (DOCS_DIR / "preview.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
