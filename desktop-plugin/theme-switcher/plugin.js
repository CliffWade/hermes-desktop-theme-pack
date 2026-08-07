/**
 * theme-switcher — Themes browser for the Hermes desktop app.
 *
 * Adds a "Themes" entry to the left sidebar (like Achievements) opening a
 * page that lists every installed Hermes skin grouped by category, marks the
 * active one, and applies a new one with one click. The backend plugin
 * (plugins/theme-switcher) writes display.skin through the canonical config
 * writer, so the gateway announces the change and every surface repaints.
 *
 * Features: search + polarity/category filters, hover preview mockup,
 * undo on apply, random theme, install-a-theme from pasted YAML, and a
 * statusbar chip showing the active theme.
 *
 * Plain ESM loaded uncompiled: UI is jsx() calls, NOT JSX syntax; only
 * @hermes/plugin-sdk, react, react/jsx-runtime resolve.
 */

import {
  Badge,
  Button,
  cn,
  EmptyState,
  ErrorState,
  haptic,
  host,
  PALETTE_AREA,
  queryClient,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  Skeleton,
  STATUSBAR_AREAS,
  THEMES_AREA,
  useQuery
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'

const ID = 'theme-switcher'

// Assigned in register(ctx) — components can't see ctx directly.
let rest

const CATEGORY_ORDER = ['Dark', 'Light', 'Vibrant', 'Nature', 'Minimal', 'Retro', 'Community', 'Built-in', 'Other']

// ── Color helpers ───────────────────────────────────────────────────────────

function polarityOf(colors) {
  // Mirrors the desktop's own skin converter: a declared background (or the
  // skin's status_bar_bg, the closest thing to an app surface) decides light
  // vs dark by luminance. With no background at all, infer from the text
  // color: bright text means a dark theme (light-on-dark), dark text light.
  const c = colors || {}
  const isHex = h => /^#([0-9a-f]{6})$/i.test(h)
  if (c.background && isHex(c.background)) {
    return lumOf(c.background) > 0.5 ? 'light' : 'dark'
  }
  const hex = c.text || c.secondary || c.accent
  if (hex && isHex(hex)) {
    return lumOf(hex) > 0.5 ? 'dark' : 'light'
  }
  return 'dark'
}

// The desktop special-cases the `default` skin: it keeps its own (light)
// theme rather than applying the skin's dark gold palette, so it renders
// light even though the skin itself is dark-authored.
function isLightTheme(t) {
  if (t && t.name === 'default') return true
  return polarityOf(t && t.colors) === 'light'
}

function lumOf(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

// ── Palette color search ─────────────────────────────────────────────────────
// Lets the search box find themes by their actual colors: a hex like "#7b2d8e"
// or a loose color name like "purple" / "teal". Hexes match by Euclidean
// distance in RGB (within ~48 per channel is clearly the same family); names
// map to a hue bucket and match palettes containing a hex in that bucket.

const COLOR_BUCKETS = [
  ['red', 0, 15], ['orange', 15, 40], ['yellow', 40, 70], ['green', 70, 165],
  ['teal', 165, 195], ['blue', 195, 250], ['purple', 250, 300], ['pink', 300, 340],
  ['red', 340, 360]
]

function hueOf(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return -1
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (h * 60 + 360) % 360
}

function colorNameMatches(hex, name) {
  const h = hueOf(hex)
  // Near-neutral (low saturation) has no meaningful hue: match the literal
  // name against luminance buckets instead of hue buckets. Real palettes
  // rarely have perfectly equal RGB, so use the saturation spread, not ==.
  if (h < 0 || saturationOf(hex) < 0.12) {
    const l = lumOf(hex)
    if (name === 'gray' || name === 'grey') return l > 0.05 && l < 0.95
    if (name === 'black') return l <= 0.05
    if (name === 'white') return l >= 0.95
    return false
  }
  return COLOR_BUCKETS.some(([label, lo, hi]) => label === name && h >= lo && h < hi)
}

function saturationOf(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

function themeMatchesColor(theme, query) {
  const hex = /^#?([0-9a-f]{6})$/i.test(query) ? `#${query.replace('#', '').toLowerCase()}` : null
  const name = /^[a-z]+$/.test(query) ? query : null
  if (!hex && !name) return false
  // Scan the full palette when the backend sends it (42 keys) and fall back
  // to the 6-key preview — the search should match colors that actually render.
  const palettes = [theme && theme.full_colors, theme && theme.colors].filter(p => p && typeof p === 'object')
  const palette = [].concat(...palettes.map(p => Object.values(p)))
  if (hex) {
    const target = [0, 2, 4].map(i => parseInt(hex.slice(1).slice(i, i + 2), 16))
    return palette.some(c => {
      if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) return false
      const rgb = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
      return rgb.every((v, i) => Math.abs(v - target[i]) <= 48)
    })
  }
  return palette.some(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) && colorNameMatches(c, name))
}

function swatch(color, label) {
  if (!color) return null
  return jsx('span', {
    title: `${label}: ${color}`,
    className: 'h-3.5 w-3.5 rounded-[4px] ring-1 ring-black/20',
    style: { backgroundColor: color }
  })
}

// ── Skin → DesktopTheme conversion (mirror of core themes/skin.ts) ─────────
// Registers pack/user skins into THEMES_AREA so they appear in the built-in
// Appearance settings, Cmd-K palette, and /skin. Mirrors the desktop's own
// converter so the registered theme matches what applying it actually shows.

function hexToRgb(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null
  return [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16))
}

function rgbToHex(rgb) {
  return '#' + rgb.map(n => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')).join('')
}

function mix(a, b, amount) {
  const ar = hexToRgb(a)
  const br = hexToRgb(b)
  return ar && br
    ? rgbToHex([ar[0] + (br[0] - ar[0]) * amount, ar[1] + (br[1] - ar[1]) * amount, ar[2] + (br[2] - ar[2]) * amount])
    : a
}

const linearize = channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)

function relativeLuminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => linearize(v / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return la >= lb ? (la + 0.05) / (lb + 0.05) : (lb + 0.05) / (la + 0.05)
}

function readableOn(hex) {
  return relativeLuminance(hex) > 0.58 ? '#161616' : '#ffffff'
}

function ensureContrast(color, bg, min) {
  if (contrastRatio(color, bg) >= min) return color
  const towards = relativeLuminance(bg) < 0.5 ? '#ffffff' : '#000000'
  let best = color
  for (let amount = 0.2; amount <= 1.0001; amount += 0.2) {
    best = mix(color, towards, Math.min(amount, 1))
    if (contrastRatio(best, bg) >= min) return best
  }
  return best
}

const ACCENT_MIN_CONTRAST = 4.5

function pickFirst(colors, keys, backdrop) {
  for (const key of keys) {
    const value = String(colors[key] || '').trim().replace(/^#/, '')
    if (/^[0-9a-f]{6}$/i.test(value)) return `#${value.toLowerCase()}`
  }
  return null
}

function titleCase(name) {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function skinToDesktopTheme(skin) {
  const name = (skin.name || '').trim()
  const colors = skin.colors || {}
  if (!name || typeof colors !== 'object') return null

  const seededBg = pickFirst(colors, ['background', 'status_bar_bg'], '#000000')
  const foregroundSeed = pickFirst(colors, ['ui_text', 'banner_text', 'status_bar_text'], seededBg || '#000000')
  const background = seededBg || (foregroundSeed && relativeLuminance(foregroundSeed) > 0.5 ? '#141414' : '#f7f7f8')
  const dark = lumOf(background) < 0.4
  const foreground = foregroundSeed || (dark ? '#e6e6e6' : '#161616')

  const accentSeed = pickFirst(colors, ['ui_accent', 'banner_accent', 'banner_title'], background) || mix(foreground, background, 0.55)
  const sidebar = mix(background, foreground, dark ? 0.02 : 0.012)
  const accent = ensureContrast(accentSeed, sidebar, ACCENT_MIN_CONTRAST)
  const border = pickFirst(colors, ['ui_border', 'banner_border'], background) || mix(background, foreground, dark ? 0.16 : 0.14)
  const mutedForeground = pickFirst(colors, ['banner_dim', 'session_border'], background) || mix(foreground, background, 0.45)
  const destructive = pickFirst(colors, ['ui_error'], background) || '#e25563'

  const palette = {
    background,
    foreground,
    card: mix(background, foreground, dark ? 0.04 : 0.025),
    cardForeground: foreground,
    muted: mix(background, foreground, dark ? 0.06 : 0.04),
    mutedForeground,
    popover: mix(background, foreground, dark ? 0.08 : 0.05),
    popoverForeground: foreground,
    primary: accent,
    primaryForeground: readableOn(accent),
    secondary: mix(accent, background, dark ? 0.72 : 0.86),
    secondaryForeground: foreground,
    accent: mix(accent, background, dark ? 0.82 : 0.88),
    accentForeground: foreground,
    border,
    input: pickFirst(colors, ['completion_menu_bg'], background) || mix(background, foreground, dark ? 0.1 : 0.06),
    ring: accent,
    midground: accent,
    midgroundForeground: readableOn(accent),
    composerRing: accent,
    destructive,
    destructiveForeground: readableOn(destructive),
    sidebarBackground: sidebar,
    sidebarBorder: border,
    userBubble: mix(background, accent, dark ? 0.18 : 0.12),
    userBubbleBorder: border
  }

  return {
    name,
    label: titleCase(name),
    description: 'Hermes skin',
    colors: palette,
    darkColors: palette
  }
}

// ── THEMES_AREA registration ────────────────────────────────────────────────
// Fetches the backend list once and registers every non-built-in skin as a
// DesktopTheme contribution, so the built-in Appearance settings / Cmd-K /
// /skin see them. The registry supports late registration: this can fire after
// register() returns and the Appearance grid re-renders (area-scoped invalidation).
let themesRegistered = false

async function registerPackThemes() {
  if (themesRegistered) return
  try {
    const data = await rest('/list')
    const skins = (data && data.skins) || []
    const contribs = []
    for (const s of skins) {
      if (!s || s.source === 'builtin' || !s.full_colors || typeof s.full_colors !== 'object') continue
      const theme = skinToDesktopTheme({ name: s.name, colors: s.full_colors })
      if (theme) contribs.push({ id: `theme:${s.name}`, area: THEMES_AREA, data: theme })
    }
    if (contribs.length) {
      // registerMany is available on ctx; this module holds it via register().
      registerManyThemes(contribs)
      themesRegistered = true
    }
  } catch (e) {
    // Backend not mounted yet or fetch failed; retry on next reload. Non-fatal.
    console.warn('[theme-switcher] THEMES_AREA registration failed:', e)
  }
}

// Assigned in register(ctx) — kept separate from `rest` so the async
// registration uses the same transport.
let registerManyThemes

// ── Hover preview mockup ────────────────────────────────────────────────────

function mockupPalette(theme) {
  const c = (theme && theme.colors) || {}
  const isLight = isLightTheme(theme)
  const bg = c.background || (isLight ? '#f7f7f8' : '#111114')
  const darkBg = !/^#([0-9a-f]{6})$/i.test(bg) || lumOf(bg) <= 0.5
  if (isLight && darkBg) {
    // Marked light but declared a dark background (the `default` skin keeps
    // the desktop's own light theme): render the mockup light to match what
    // applying it actually shows.
    return {
      background: '#f7f7f8',
      text: '#161616',
      secondary: '#6b7280',
      accent: c.accent || c.tool || '#d4a017',
      border: '#d4d4d8'
    }
  }
  return {
    background: bg,
    text: c.text || (isLight ? '#161616' : '#e8e8e8'),
    secondary: c.secondary || (isLight ? '#6b7280' : '#9a9a9a'),
    accent: c.accent || c.tool || '#8888aa',
    border: c.border || (isLight ? '#d4d4d8' : '#333338')
  }
}

function ThemeMockup({ theme }) {
  const p = mockupPalette(theme)
  const bg = p.background
  const text = p.text
  const secondary = p.secondary
  const accent = p.accent
  const border = p.border
  const isLight = lumOf(bg) > 0.5
  const overlay = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'
  const overlayStrong = isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'

  return jsxs('div', {
    className: 'flex h-full w-full flex-col overflow-hidden rounded-lg border text-left',
    style: { backgroundColor: bg, borderColor: border, color: text },
    children: [
      jsx('div', { className: 'h-1.5 w-full shrink-0', style: { backgroundColor: accent } }),
      jsxs('div', { className: 'flex min-h-0 flex-1 gap-2 p-2.5', children: [
        jsxs('div', { className: 'flex w-1/4 shrink-0 flex-col gap-1 pt-1', children: [
          jsx('div', { className: 'h-1.5 w-full rounded', style: { backgroundColor: border } }),
          jsx('div', { className: 'h-1.5 w-3/4 rounded', style: { backgroundColor: secondary } }),
          jsx('div', { className: 'h-1.5 w-2/3 rounded', style: { backgroundColor: accent } })
        ]}),
        jsxs('div', { className: 'flex min-w-0 flex-1 flex-col gap-1.5', children: [
          jsx('div', {
            className: 'self-start max-w-[80%] rounded-md rounded-tl-none border px-2 py-1',
            style: { borderColor: border, backgroundColor: overlay },
            children: jsx('span', { className: 'block truncate text-[0.5625rem]', style: { color: text }, children: 'User message' })
          }),
          jsx('div', {
            className: 'self-end max-w-[80%] rounded-md rounded-tr-none border px-2 py-1',
            style: { borderColor: accent, backgroundColor: overlayStrong },
            children: jsx('span', { className: 'block truncate text-[0.5625rem]', style: { color: accent }, children: 'Assistant reply' })
          }),
          jsxs('div', { className: 'mt-0.5 flex items-center gap-1.5', style: { color: secondary }, children: [
            jsx('span', { className: 'h-1.5 w-1.5 shrink-0 rounded-full', style: { backgroundColor: accent } }),
            jsx('span', { className: 'text-[0.5rem]', children: 'tool call in progress' })
          ]})
        ]})
      ]}),
      jsxs('div', {
        className: 'flex shrink-0 items-center justify-between px-2.5 py-1.5',
        style: { backgroundColor: border, color: text },
        children: [
          jsx('span', { className: 'text-[0.5rem]', children: 'status bar' }),
          jsx('span', { className: 'text-[0.5rem]', style: { color: accent }, children: 'tokens' })
        ]
      })
    ]
  })
}

function PreviewPanel({ theme, skins }) {
  if (!theme) return null
  const isLight = isLightTheme(theme)
  const twinName = theme.twin
  const twin = twinName && skins ? skins.find(s => s.name === twinName) : null
  return jsxs('div', {
    className: 'pointer-events-none fixed right-6 top-24 z-30 w-72 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3 shadow-2xl',
    children: [
      jsxs('div', { className: 'flex items-baseline justify-between gap-2', children: [
        jsx('span', { className: 'truncate text-xs font-semibold', children: theme.name }),
        jsx('span', { className: 'shrink-0 text-[0.625rem] text-(--ui-text-tertiary)', children: `${theme.category || ''} ${isLight ? '☀ light' : '☾ dark'}` })
      ]}),
      jsx('div', { className: 'mt-2 h-40', children: jsx(ThemeMockup, { theme }) }),
      twin
        ? jsxs('div', {
            className: 'mt-3 border-t border-(--ui-stroke-secondary) pt-2',
            children: [
              jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                jsx('span', { className: 'text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)', children: isLight ? '☾ Dark twin' : '☀ Light twin' }),
                jsx('span', { className: 'shrink-0 text-[0.625rem] text-(--ui-text-tertiary)', children: `⇄ ${twin.name}` })
              ]}),
              jsx('div', { className: 'mt-1 h-24', children: jsx(ThemeMockup, { theme: twin }) }),
              twin.description
                ? jsx('div', { className: 'mt-1 truncate text-[0.625rem] text-(--ui-text-tertiary)', children: twin.description })
                : null
            ]
          })
        : null
    ]
  })
}

// ── Theme card ──────────────────────────────────────────────────────────────

function ThemeCard({ theme, active, onApply, applying, onHover }) {
  const isActive = theme.name === active
  const c = theme.colors || {}
  const accent = c.accent || c.tool || c.background
  const isLight = isLightTheme(theme)
  const isNew = theme.installed_at && Date.now() / 1000 - theme.installed_at < 3 * 24 * 3600
  const [copied, setCopied] = useState(false)

  const copyYaml = async e => {
    e.stopPropagation()
    e.preventDefault()
    try {
      const res = await rest(`/raw?name=${encodeURIComponent(theme.name)}`, { timeoutMs: 8000 })
      if (!res || !res.ok) throw new Error((res && res.error) || 'could not fetch theme YAML')
      await navigator.clipboard.writeText(res.yaml)
      haptic('tap')
      setCopied(true)
      host.notify({ kind: 'success', message: `Copied ${theme.name} YAML` })
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      host.notify({ kind: 'error', message: `Copy failed: ${err?.message ?? err}` })
    }
  }

  return jsxs('div', {
    className: 'relative flex',
    // Inline width (7 per row at 8px gap) because the app's Tailwind build
    // only ships grid-cols-1/2/4/6 — plugin grid classes get purged.
    style: { width: 'calc((100% - 48px) / 7)' },
    children: [
      jsxs('button', {
        type: 'button',
        onClick: () => onApply(theme.name),
        disabled: applying,
        onMouseEnter: () => onHover(theme),
        onMouseLeave: () => onHover(null),
        onFocus: () => onHover(theme),
        onBlur: () => onHover(null),
        title: `${theme.description || theme.name} (${isLight ? 'light' : 'dark'})`,
        className: cn(
          'flex h-full w-full flex-col gap-1 rounded-lg border p-2 text-left transition-colors',
          isActive
            ? 'border-(--ui-accent) bg-(--ui-bg-tertiary)'
            : 'border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) hover:border-(--ui-stroke-strong)'
        ),
        children: [
          accent ? jsx('div', { className: 'h-1 w-full rounded-full', style: { backgroundColor: accent } }) : null,
          jsxs('div', {
            className: 'flex w-full items-center justify-between gap-1',
            children: [
              jsxs('span', {
                className: 'flex min-w-0 items-center gap-1',
                children: [
                  jsx('span', {
                    title: isLight ? 'Light theme' : 'Dark theme',
                    className: isLight ? 'shrink-0 text-[0.75rem] leading-none text-(--ui-warn)' : 'shrink-0 text-[0.75rem] leading-none text-(--ui-accent)',
                    children: isLight ? '☀' : '☾'
                  }),
                  jsx('span', { className: 'truncate text-xs font-medium', children: theme.name })
                ]
              }),
              isActive
                ? jsx(Badge, {
                    variant: 'outline',
                    className: 'shrink-0 text-[0.5625rem] text-(--ui-accent)',
                    children: 'Active'
                  })
                : isNew
                  ? jsx(Badge, {
                      variant: 'outline',
                      className: 'shrink-0 text-[0.5625rem] text-(--ui-ok)',
                      children: 'NEW'
                    })
                  : theme.category
                    ? jsx('span', {
                        className: 'shrink-0 text-[0.5625rem] uppercase tracking-wide text-(--ui-text-tertiary)',
                        children: theme.category
                      })
                    : null
            ]
          }),
          jsxs('div', {
            className: 'flex items-center gap-1',
            children: [
              swatch(c.background, 'background'),
              swatch(accent, 'accent'),
              swatch(c.tool, 'tool'),
              swatch(c.text, 'text'),
              swatch(c.secondary, 'secondary'),
              swatch(c.border, 'border')
            ]
          }),
          jsxs('div', {
            className: 'flex w-full flex-1 flex-col px-6',
            // Reserve two lines (description + pairing) so every card is the
            // same height whether or not it has a twin.
            style: { minHeight: '1.9rem' },
            children: [
              jsx('span', {
                className: 'truncate text-[0.625rem] leading-tight text-(--ui-text-tertiary)',
                children: theme.description || ''
              }),
              jsx('span', {
                className: 'mt-auto truncate text-[0.6875rem] font-medium leading-tight',
                style: { color: theme.twin ? 'var(--ui-accent)' : 'transparent' },
                children: theme.twin ? `⇄ paired with ${theme.twin}` : '⇄'
              })
            ]
          })
        ]
      }),
      theme.source !== 'builtin'
        ? jsx('button', {
            type: 'button',
            onClick: copyYaml,
            title: copied ? 'Copied!' : 'Copy theme YAML',
            className: cn(
              'absolute bottom-1.5 right-1.5 rounded border px-1 py-0.5 text-[0.5625rem] transition-colors',
              'bg-(--ui-bg-primary)',
              copied
                ? 'border-(--ui-ok) text-(--ui-ok)'
                : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary) hover:border-(--ui-accent) hover:text-(--ui-accent)'
            ),
            children: copied ? '✓' : '⧉'
          })
        : null,
      theme.twin
        ? jsx('button', {
            type: 'button',
            onClick: () => onApply(theme.twin),
            title: `Switch to paired theme: ${theme.twin}`,
            className: cn(
              'absolute bottom-1.5 left-1.5 rounded border px-1 py-0.5 text-[0.5625rem] transition-colors',
              'bg-(--ui-bg-primary) border-(--ui-stroke-secondary) text-(--ui-text-tertiary) hover:border-(--ui-accent) hover:text-(--ui-accent)'
            ),
            children: '⇄'
          })
        : null
    ]
  })
}

// ── Install modal ───────────────────────────────────────────────────────────

function InstallModal({ onClose, onInstalled }) {
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      const res = await rest('/install', { method: 'POST', body: { content }, timeoutMs: 8000 })
      if (res && res.ok) {
        haptic('tap')
        host.notify({ kind: 'success', message: `Theme installed: ${res.name}` })
        onInstalled(res.name)
      } else {
        setErr((res && res.error) || 'install failed')
      }
    } catch (e) {
      setErr(e?.message ?? String(e))
    }
    setBusy(false)
  }

  return jsxs('div', {
    className: 'fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6',
    onClick: onClose,
    children: [
      jsxs('div', {
        className: 'w-full max-w-lg rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-5 shadow-2xl',
        onClick: e => e.stopPropagation(),
        children: [
          jsx('div', { className: 'text-sm font-semibold', children: 'Add a theme' }),
          jsx('div', { className: 'mt-1 text-xs text-(--ui-text-tertiary)', children: 'Paste a Hermes skin YAML. It lands in your skins folder and appears on this page immediately.' }),
          jsx('textarea', {
            value: content,
            onChange: e => setContent(e.target.value),
            rows: 10,
            spellCheck: false,
            placeholder: 'name: my-theme\ndescription: My custom look\ncolors:\n  background: "#111114"\n  ui_accent: "#7dd3fc"\n',
            className: 'mt-3 w-full resize-y rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-2 font-mono text-xs outline-none focus:border-(--ui-accent)'
          }),
          err ? jsx('div', { className: 'mt-2 text-xs text-(--ui-error)', children: err }) : null,
          jsxs('div', { className: 'mt-3 flex justify-end gap-2', children: [
            jsx(Button, { variant: 'secondary', size: 'sm', onClick: onClose, children: 'Cancel' }),
            jsx(Button, { variant: 'primary', size: 'sm', onClick: submit, disabled: busy || !content.trim(), children: busy ? 'Installing…' : 'Install' })
          ]})
        ]
      })
    ]
  })
}

// ── Statusbar chip ──────────────────────────────────────────────────────────

function ThemeChip() {
  const { data } = useQuery({
    queryKey: ['theme-switcher', 'list'],
    queryFn: () => rest('/list'),
    refetchInterval: 30_000
  })
  const skins = (data && data.skins) || []
  const active = (data && data.active) || ''
  const t = skins.find(s => s.name === active)
  const c = (t && t.colors) || {}
  const dot = c.accent || c.tool || c.background

  return jsx('button', {
    type: 'button',
    onClick: () => {
      haptic('tap')
      host.navigate('/themes')
    },
    title: 'Open Theme Switcher',
    className: 'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6875rem] text-(--ui-text-secondary) hover:bg-(--ui-bg-tertiary) hover:text-(--ui-text-primary)',
    children: [
      dot ? jsx('span', { className: 'h-2 w-2 shrink-0 rounded-full', style: { backgroundColor: dot } }) : null,
      jsx('span', { className: 'truncate', children: active || 'default' })
    ]
  })
}

// ── Page ────────────────────────────────────────────────────────────────────

function ThemesPage() {
  const [applying, setApplying] = useState(null)
  const [hoverTheme, setHoverTheme] = useState(null)
  const [last, setLast] = useState(null)
  const [q, setQ] = useState('')
  const [pol, setPol] = useState('all')
  const [cat, setCat] = useState('All')
  const [installOpen, setInstallOpen] = useState(false)

  useEffect(() => {
    if (!last) return
    const t = setTimeout(() => setLast(null), 6000)
    return () => clearTimeout(t)
  }, [last])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['theme-switcher', 'list'],
    queryFn: () => rest('/list'),
    refetchInterval: 30_000
  })

  const apply = async (name, opts = {}) => {
    setApplying(name)
    try {
      const res = await rest('/apply', { method: 'POST', body: { name }, timeoutMs: 8000 })
      if (res && res.ok) {
        haptic('tap')
        host.notify({ kind: 'success', message: `Theme applied: ${name}` })
        if (!opts.silent && res.previous && res.previous !== name) setLast({ name, previous: res.previous })
        await queryClient.invalidateQueries({ queryKey: ['theme-switcher'] })
      } else {
        host.notify({ kind: 'error', message: (res && res.error) || `Could not apply ${name}` })
      }
    } catch (e) {
      host.notify({ kind: 'error', message: `Could not apply ${name}: ${e?.message ?? e}` })
    } finally {
      setApplying(null)
    }
  }

  if (isLoading) {
    return jsx('div', {
      className: 'grid h-full grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2 lg:grid-cols-3',
      children: Array.from({ length: 9 }, () => jsx(Skeleton, { className: 'h-24 w-full rounded-lg' }))
    })
  }

  if (isError || !data) {
    return jsx(ErrorState, {
      title: 'Themes unavailable',
      description: `${error?.message ?? 'Unknown error'} — the theme-switcher backend mounts when the app starts. Restart the app if this persists.`,
      children: jsx(Button, { variant: 'secondary', onClick: () => refetch(), children: 'Retry' })
    })
  }

  const skins = data.skins || []
  const active = data.active || ''
  const ordered = [...skins].sort((a, b) => {
    const la = isLightTheme(a) ? 0 : 1
    const lb = isLightTheme(b) ? 0 : 1
    if (la !== lb) return la - lb
    const ia = CATEGORY_ORDER.indexOf(a.category)
    const ib = CATEGORY_ORDER.indexOf(b.category)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name)
  })

  const cats = ['All', ...CATEGORY_ORDER.filter(c => skins.some(s => s.category === c))]
  const ql = q.trim().toLowerCase()
  const filtered = ordered.filter(t => {
    if (pol !== 'all') {
      const isLight = isLightTheme(t)
      if (pol === 'light' ? !isLight : isLight) return false
    }
    if (cat !== 'All' && (t.category || 'Other') !== cat) return false
    if (ql && !`${t.name} ${t.description || ''}`.toLowerCase().includes(ql)) {
      // Fall back to palette-color search: a hex (#7b2d8e) or a color word
      // (purple, teal, gray) matches themes whose palette contains that color.
      if (!themeMatchesColor(t, ql)) return false
    }
    return true
  })

  const applyRandom = () => {
    const pool = filtered.length ? filtered : ordered
    if (!pool.length) return
    const pick = pool[(Math.random() * pool.length) | 0]
    apply(pick.name)
  }

  const chipCls = cn(
    'rounded-md border border-(--ui-stroke-secondary) px-2 py-1 text-xs',
    'bg-(--ui-bg-secondary) text-(--ui-text-secondary) hover:border-(--ui-stroke-strong) hover:text-(--ui-text-primary)'
  )

  return jsxs('div', {
    className: 'relative flex h-full min-h-0 flex-col overflow-y-auto',
    children: [
      jsxs('div', {
        className: 'border-b border-(--ui-stroke-secondary) px-4 py-3',
        children: [
          jsx('div', { className: 'text-sm font-semibold', children: 'Theme Switcher' }),
          jsx('div', {
            className: 'mt-0.5 text-xs text-(--ui-text-tertiary)',
            children:
              q.trim() || pol !== 'all' || cat !== 'All'
                ? `Active: ${active} · showing ${filtered.length} of ${skins.length} · ☀ light ☾ dark`
                : `Active: ${active} · ${skins.length} skins installed · click any card to apply · ☀ light ☾ dark`
          })
        ]
      }),
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2 border-b border-(--ui-stroke-secondary) px-4 py-2',
        children: [
          jsx('input', {
            type: 'search',
            value: q,
            onChange: e => setQ(e.target.value),
            placeholder: 'Search themes…',
            className: 'w-44 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 py-1 text-xs outline-none focus:border-(--ui-accent)'
          }),
          [['all', 'All'], ['light', '☀ Light'], ['dark', '☾ Dark']].map(([k, label]) =>
            jsx('button', {
              key: k,
              type: 'button',
              onClick: () => setPol(k),
              className: cn(chipCls, pol === k && 'border-(--ui-accent) bg-(--ui-bg-tertiary) text-(--ui-accent)'),
              children: label
            })
          ),
          jsx('select', {
            value: cat,
            onChange: e => setCat(e.target.value),
            className: 'rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 py-1 text-xs outline-none focus:border-(--ui-accent)',
            children: cats.map(c => jsx('option', { key: c, value: c, children: c }))
          }),
          jsx('button', { type: 'button', onClick: applyRandom, className: chipCls, children: '🎲 Random' }),
          jsx('button', { type: 'button', onClick: () => setInstallOpen(true), className: chipCls, children: '＋ Add theme' }),
          last
            ? jsxs('div', {
                className: 'ml-auto flex items-center gap-2 rounded-md border border-(--ui-accent) bg-(--ui-bg-tertiary) px-2 py-1 text-xs',
                children: [
                  jsx('span', { className: 'text-(--ui-text-secondary)', children: `Applied ${last.name}` }),
                  jsx('button', {
                    type: 'button',
                    onClick: () => {
                      const prev = last.previous
                      setLast(null)
                      apply(prev, { silent: true })
                    },
                    className: 'font-medium text-(--ui-accent) hover:underline',
                    children: 'Undo'
                  })
                ]
              })
            : null
        ]
      }),
      skins.length === 0
        ? jsx(EmptyState, {
            title: 'No skins found',
            description: 'Drop YAML skins into your Hermes skins folder and they will appear here, or use Add theme.'
          })
        : filtered.length === 0
          ? jsx(EmptyState, { title: 'No themes match', description: 'Try a different search or filter.' })
          : jsxs('div', {
              className: 'px-4 py-3',
              children: [
                filtered.some(t => isLightTheme(t))
                  ? jsxs('div', { className: 'mb-2', children: [
                      jsx('div', {
                        className: 'mb-1 text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
                        children: `☀ Light (${filtered.filter(t => isLightTheme(t)).length})`
                      }),
                      jsx('div', {
                        className: 'flex flex-wrap gap-2',
                        children: filtered
                          .filter(t => isLightTheme(t))
                          .map(t =>
                            jsx(ThemeCard, {
                              key: t.name,
                              theme: t,
                              active,
                              onApply: apply,
                              applying: applying === t.name,
                              onHover: setHoverTheme
                            })
                          )
                      })
                    ]})
                  : null,
                filtered.some(t => !isLightTheme(t))
                  ? jsxs('div', {
                      className: 'mb-2 mt-3 border-t pt-4',
                      style: { borderTopWidth: 2, borderTopColor: 'var(--ui-stroke-strong)' },
                      children: [
                      jsx('div', {
                        className: 'mb-1 text-[0.625rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
                        children: `☾ Dark (${filtered.filter(t => !isLightTheme(t)).length})`
                      }),
                      jsx('div', {
                        className: 'flex flex-wrap gap-2',
                        children: filtered
                          .filter(t => !isLightTheme(t))
                          .map(t =>
                            jsx(ThemeCard, {
                              key: t.name,
                              theme: t,
                              active,
                              onApply: apply,
                              applying: applying === t.name,
                              onHover: setHoverTheme
                            })
                          )
                      })
                    ]})
                  : null
              ]
            }),
      jsx(PreviewPanel, { theme: hoverTheme, skins }),
      installOpen ? jsx(InstallModal, { onClose: () => setInstallOpen(false), onInstalled: () => setInstallOpen(false) }) : null
    ]
  })
}

// ── Plugin export ───────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Themes',
  description:
    'Browse and apply every installed Hermes skin from the desktop app — search, preview, one click to repaint every surface.',
  defaultEnabled: true,
  register(ctx) {
    rest = ctx.rest
    registerManyThemes = ctx.registerMany

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/themes' },
        title: 'Themes',
        render: () => jsx(ThemesPage, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 56,
        data: { path: '/themes', label: 'Themes', codicon: 'paintcan' }
      },
      {
        id: 'chip',
        area: STATUSBAR_AREAS.right,
        order: 91,
        render: () => jsx(ThemeChip, {})
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'theme-switcher.open',
          label: 'Themes: Open',
          keywords: ['themes', 'skins', 'colors', 'appearance'],
          run: () => {
            haptic('tap')
            host.navigate('/themes')
          }
        }
      }
    ])

    // Register pack/user skins into the built-in Appearance theme grid.
    // Async on purpose: the backend may not be reachable at register() time,
    // and the registry accepts late contributions (area-scoped invalidation
    // re-renders Appearance when they land).
    registerPackThemes()
  }
}
