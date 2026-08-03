/**
 * theme-switcher — Themes browser for the Hermes desktop app.
 *
 * Adds a "Themes" entry to the left sidebar (like Achievements) opening a
 * page that lists every installed Hermes skin grouped by category, marks the
 * active one, and applies a new one with one click. The backend plugin
 * (plugins/theme-switcher) writes display.skin through the canonical config
 * writer, so the gateway announces the change and every surface repaints.
 *
 * Plain ESM loaded uncompiled: UI is jsx() calls, NOT JSX syntax; only
 * @hermes/plugin-sdk, react, react/jsx-runtime resolve.
 */

import {
  Badge,
  Button,
  cn,
  Codicon,
  EmptyState,
  ErrorState,
  haptic,
  host,
  PALETTE_AREA,
  queryClient,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  Skeleton,
  useQuery
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'theme-switcher'

// Assigned in register(ctx) — components can't see ctx directly.
let rest

// ── Theme card ──────────────────────────────────────────────────────────────

function swatch(color, label) {
  if (!color) return null
  return jsx('span', {
    title: `${label}: ${color}`,
    className: 'h-3.5 w-3.5 rounded-[4px] ring-1 ring-black/20',
    style: { backgroundColor: color }
  })
}

function ThemeCard({ theme, active, onApply, applying }) {
  const isActive = theme.name === active
  const c = theme.colors || {}
  const accent = c.accent || c.tool || c.background

  return jsxs('button', {
    type: 'button',
    onClick: () => onApply(theme.name),
    disabled: applying,
    title: theme.description || theme.name,
    className: cn(
      'flex flex-col gap-1 rounded-lg border p-2 text-left transition-colors',
      isActive
        ? 'border-(--ui-accent) bg-(--ui-bg-tertiary)'
        : 'border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) hover:border-(--ui-stroke-strong)'
    ),
    children: [
      accent ? jsx('div', { className: 'h-1 w-full rounded-full', style: { backgroundColor: accent } }) : null,
      jsxs('div', {
        className: 'flex w-full items-center justify-between gap-1',
        children: [
          jsx('span', { className: 'truncate text-xs font-medium', children: theme.name }),
          isActive
            ? jsx(Badge, {
                variant: 'outline',
                className: 'shrink-0 text-[0.5625rem] text-(--ui-accent)',
                children: 'Active'
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
      jsx('span', {
        className: 'truncate text-[0.625rem] text-(--ui-text-tertiary)',
        children: theme.description || ''
      })
    ]
  })
}

// ── Page ────────────────────────────────────────────────────────────────────

function ThemesPage() {
  const [applying, setApplying] = useState(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['theme-switcher', 'list'],
    queryFn: () => rest('/list'),
    refetchInterval: 30_000
  })

  const apply = async name => {
    setApplying(name)
    try {
      await rest('/apply', { method: 'POST', body: { name }, timeoutMs: 8000 })
      haptic('tap')
      host.notify({ kind: 'success', message: `Theme applied: ${name}` })
      await queryClient.invalidateQueries({ queryKey: ['theme-switcher'] })
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
  const CATEGORY_ORDER = ['Dark', 'Light', 'Vibrant', 'Nature', 'Minimal', 'Retro', 'Built-in', 'Other']
  const ordered = [...skins].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a.category)
    const ib = CATEGORY_ORDER.indexOf(b.category)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name)
  })

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col overflow-y-auto',
    children: [
      jsxs('div', {
        className: 'border-b border-(--ui-stroke-secondary) px-4 py-3',
        children: [
          jsx('div', {
            className: 'text-sm font-semibold',
            children: 'Theme Switcher'
          }),
          jsx('div', {
            className: 'mt-0.5 text-xs text-(--ui-text-tertiary)',
            children: `Active: ${active} · ${skins.length} skins installed · click any card to apply, every surface repaints live`
          })
        ]
      }),
      skins.length === 0
        ? jsx(EmptyState, {
            title: 'No skins found',
            description: 'Drop YAML skins into your Hermes skins folder and they will appear here.'
          })
        : jsx('div', {
            className: 'grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7',
            children: ordered.map(t =>
              jsx(ThemeCard, {
                key: t.name,
                theme: t,
                active,
                onApply: apply,
                applying: applying === t.name
              })
            )
          })
    ]
  })
}

// ── Plugin export ───────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Themes',
  description:
    'Browse and apply every installed Hermes skin from the desktop app — grouped by category, one click to repaint every surface.',
  defaultEnabled: true,
  register(ctx) {
    rest = ctx.rest

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
  }
}
