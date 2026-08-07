# Changelog

All notable changes to the Hermes Theme Pack. This project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-07

First stable release. 34 themes (24 curated + 10 community) across 7
categories, every one passing the WCAG AA contrast gate, with the Theme
Switcher desktop plugin and CI-enforced quality.

### Added

- **34 themes across 7 categories** — Dark, Light, Vibrant, Nature, Minimal,
  Retro, and Community
- **10 community themes** ported from
  [BeardedChop/hermes-skins-pack](https://github.com/BeardedChop/hermes-skins-pack):
  vaporwave-mall, stained-glass, shadow-thief, void-sunset, redwood,
  newsprint-noir, peach-fuzz, slate-mist, steel-thread, warm-ash
- **Theme Switcher desktop plugin** — sidebar page listing every installed
  skin with its real palette, one click to apply, search, filters, hover
  preview, undo, random, install-from-YAML, statusbar chip, command palette
  entry
- **Built-in Appearance integration** — pack themes register into the desktop
  Appearance grid, Cmd-K palette, and /skin (via THEMES_AREA)
- **Palette-color search** — search themes by hex (#7b2d8e) or color word
  (purple, teal, gray), not just name and description
- **Copy YAML button** — export any user theme's raw YAML from the Theme
  Switcher card for sharing
- **CI pipeline** — GitHub Actions runs YAML validation, the full test suite
  (including the WCAG gate), and plugin syntax checks on every PR
- **CONTRIBUTING.md** — community contribution guide with the format, the
  contrast contract, and verification steps
- **Test suite** — structure, WCAG contrast, light-background luminance,
  safe slugs, idempotent regeneration, installer coverage, and a README
  count-invariant check

### Changed

- Community themes grouped under their own **Community** category in the
  backend and the Theme Switcher
- README screenshots refreshed to show the full skin list
- GitHub repo description synced to 34 themes / 7 categories

### Fixed

- Generator count drift: seed-palette comment now distinguishes the 24
  curated seeds from community drop-in themes
- CI YAML validation runs through the uv venv (ModuleNotFoundError)
- Pytest `__pycache__` artifacts no longer tracked in git
