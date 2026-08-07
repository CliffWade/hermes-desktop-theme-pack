# Hermes Theme Pack

[![CI](https://github.com/CliffWade/hermes-desktop-theme-pack/actions/workflows/ci.yml/badge.svg)](https://github.com/CliffWade/hermes-desktop-theme-pack/actions/workflows/ci.yml)

34 curated color themes for Hermes Agent, organized into 7 categories, every one contrast-checked to WCAG AA. Drop them in and they appear across the CLI, the TUI, and the desktop app at once, because a Hermes skin themes every surface.

In the desktop app, the Theme Switcher page lists every installed skin in a single view, with its real palette, one click to apply. It follows your active skin, so the same page looks like this in light and dark mode:

Light mode (default theme):

![Theme Switcher in the desktop app, light mode](docs/themes-page.png)

Dark mode (dark-charcoal):

![Theme Switcher in the desktop app, dark mode](docs/themes-page-dark.png)

## Themes

| Category | Themes |
|---|---|
| **Dark** | dark-aubergine, dark-obsidian, dark-charcoal, dark-navy |
| **Light** | light-paper, light-frost, light-cloud, light-cream, light-mint, light-rose, light-sand, light-lavender |
| **Vibrant** | vibrant-synthwave, vibrant-neon, vibrant-sunset, vibrant-pacific |
| **Nature** | nature-forest, nature-nordic, nature-desert |
| **Minimal** | minimal-graphite, minimal-bone |
| **Retro** | retro-terminal, retro-amber, retro-blue |
| **Community** | vaporwave-mall, stained-glass, shadow-thief, void-sunset, redwood, newsprint-noir, peach-fuzz, slate-mist, steel-thread, warm-ash — ported from [BeardedChop/hermes-skins-pack](https://github.com/BeardedChop/hermes-skins-pack) |

## Install

```bash
./install.sh
```

Or manually: copy the `.yaml` files from `themes/` into your Hermes skins folder, `~/.hermes/skins/` (profile-aware: `$HERMES_HOME/skins/`).

The desktop app picks up new skins automatically via the backend skin sync. If they don't appear right away, restart the gateway or reload the desktop app.

## Activate

```bash
hermes config set display.skin dark-aubergine
```

Or in the app: `/skin` in the CLI, or Appearance → theme in the desktop app. Every surface repaints live within about a second.

## Adding your own theme

Three ways:

1. **In the app**: open **Themes**, click **+ Add theme**, paste a skin YAML, and it installs instantly. The backend validates the shape and rejects malformed input, duplicates, and unsafe names.
2. **By hand**: drop a `.yaml` file into `~/.hermes/skins/` (profile-aware: `$HERMES_HOME/skins/`) and it appears everywhere, CLI, TUI, and desktop.
3. **With the generator**: add a seed palette to the `THEMES` list at the top of `scripts/generate_themes.py` and re-run it. The generator derives the full color set and enforces the contrast gate for you.

A minimal hand-written skin:

```yaml
name: my-theme
description: My custom look
colors:
  background: "#1a1a2e"
  ui_accent: "#ffd700"
  banner_text: "#f5f5f5"
  banner_dim: "#8a8a8a"
  banner_border: "#333355"
```

Contrast is your job in the first two options and the generator's job in the third. For hand-written skins, keep primary text at 6:1 and accents at 4.5:1 against the background.

## Quality

Every theme is generated from a seed palette by `scripts/generate_themes.py`, which:

- Derives the full skin color set: background, text hierarchy, accent, borders, status colors, diff colors, syntax colors, completion menu
- Enforces WCAG AA contrast: primary text at 6:1, secondary text and accents at 4.5:1 against the background
- Keeps success, warning, and error recognizable as green, amber, and red
- Uses only `#rrggbb` hex, valid for every surface

Re-run the generator to regenerate all skins and the preview gallery, or edit any `.yaml` by hand and reload.

## Theme Switcher (desktop browser)

The pack also ships a **Theme Switcher** desktop plugin: a "Themes" entry in the app's left sidebar (like Achievements) that lists every installed skin, marks the active one, and applies a new one with one click. No terminal needed to flip themes.

Features:

- **Every skin in one view** — all installed skins in a compact grid, grouped by category, each card showing the real palette (accent line, name, swatches, description)
- **Light / dark symbols** — ☀ marks light-based themes, ☾ marks dark-based, computed from the background luminance
- **Light and dark groups** — themes are sorted into a ☀ Light group and a ☾ Dark group with counts, so the first decision is the polarity one
- **Search and filters** — type to find a theme, filter by ☀ light / ☾ dark, or by category
- **Hover preview** — hover any card to see a mockup of the app rendered in that theme's real colors before you apply it
- **One-click apply** — every surface repaints live through the canonical config writer
- **Undo** — a banner appears after every apply; click Undo to snap back to the previous theme
- **Random** — the 🎲 button applies a random theme from the current filter
- **Add a theme** — paste a skin YAML and it installs into your skins folder and appears on the page instantly (bad YAML, duplicates, and unsafe names are rejected)
- **Statusbar chip** — the bottom bar shows the active theme with its color dot; click to open the Themes page
- **Command palette** — ⌘K → "Themes: Open"

Install the backend and desktop plugin:

```bash
# backend plugin
mkdir -p ~/.hermes/plugins/theme-switcher
cp -R plugins/theme-switcher/* ~/.hermes/plugins/theme-switcher/
hermes plugins enable theme-switcher

# desktop plugin
mkdir -p ~/.hermes/desktop-plugins/theme-switcher
cp desktop-plugin/theme-switcher/plugin.js ~/.hermes/desktop-plugins/theme-switcher/
```

Restart the app once so the backend mounts, then open **Themes** from the sidebar.

## Development

```bash
python3 scripts/generate_themes.py   # regenerates themes/*.yaml + docs/preview.html
uv run pytest tests/ -q               # invariant checks: structure, WCAG gate, idempotency, installer (installs pytest + pyyaml)
open docs/preview.html               # browse the gallery
```

The seed palettes live at the top of the generator script. Add a palette, re-run, and you have a new theme.

## License

MIT.
