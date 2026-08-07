# Contributing to the Hermes Theme Pack

Thanks for wanting to add a theme. The pack is open to anyone: your theme gets
its own **Community** row in the README and its own category in the Theme
Switcher, with a link back to your repo. CI enforces quality, so you never have
to guess whether your theme will pass.

## Quick start

1. **Fork** this repo (or open a PR straight from a branch).
2. Add one `.yaml` file to `themes/`.
3. Run the checks below.
4. Open a PR against `main`.

That's it. The CI workflow runs the same checks automatically on your PR, so a
green CI means your theme is structurally valid and passes the WCAG gate.

## The theme file

A theme is one YAML file in `themes/` named after the theme (`my-theme.yaml`).
See `themes/vaporwave-mall.yaml` for a complete example.

Required fields:

```yaml
name: my-theme          # lowercase letters, numbers, hyphens; must match the filename
description: One-line pitch for your theme
colors:
  background: "#1a1a2e" # every color is #rrggbb hex
  ui_accent: "#ffd700"
  banner_accent: "#ffd700"
  banner_title: "#f5f5f5"
  banner_text: "#f5f5f5"
  ui_text: "#f5f5f5"
  banner_dim: "#8a8a8a"
  banner_border: "#333355"
  ui_border: "#333355"
```

The full key set (status colors, diff colors, syntax colors, completion menu,
prompt) is in the existing themes — mirror it. Optional `branding` and
`tool_prefix` keys add flavor (agent name, prompt symbol, help header).

## The WCAG gate (this is the contract)

Every theme must pass these contrast ratios against its own `background`:

| Element | Key | Minimum ratio |
|---|---|---|
| Primary text | `banner_text` | 6.0:1 |
| Accent | `ui_accent` | 4.5:1 |
| Secondary text | `banner_dim` | 4.5:1 |

`ui_ok` / `ui_warn` / `ui_error` should stay recognizably green / amber / red.

The test suite recomputes this independently (it doesn't trust the generator),
so a theme that sneaks through generation still fails CI if the contrast is
off.

## Verifying locally

```bash
uv sync --group dev                        # installs pytest + pyyaml
uv run pytest tests/ -q                    # all invariant checks
```

If you don't use `uv`, plain `pip install pytest pyyaml` and `pytest tests/ -q`
works too.

## What CI runs on every PR

The `.github/workflows/ci.yml` workflow:

1. Validates every theme's YAML structure (name, description, colors, hex format, safe slug)
2. Runs the full pytest suite — including the WCAG contrast gate and the README count invariant
3. Syntax-checks the desktop plugin

A red CI means something concrete is broken; the logs name the file and the
failure.

## The Community category

Your theme appears under **Community** in the Theme Switcher and in the README's
Community row. The backend maps community themes by exact name (they don't use
the `dark-` / `light-` / `vibrant-` / `nature-` / `minimal-` / `retro-` filename
prefixes). If you'd rather your theme sort into one of the named categories,
name it with the matching prefix and it lands there instead.

When you open the PR, also add a row or update the **Community** row in the
README's Themes table — the count-invariant test fails if the README claims a
number of themes that doesn't match `themes/`.

## Keep it focused

- One theme per PR makes review fast. A few themes in one PR is fine if they're
  related (a cohesive family).
- Reuse the exact file structure of the existing themes; don't introduce new
  color keys unless every surface supports them.
- If you ported a theme from elsewhere (like BeardedChop's pack), credit the
  source in the file header comment.

Questions? Open an issue, or find the maintainer in the AI Makers Discord.
