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

function ThemeCard({ theme, active, onApply, applying }) {
  const isActive = theme.name === active

  return jsxs('button', {
    type: 'button',
    onClick: () => onApply(theme.name),
    disabled: applying,
    className: cn(
      'flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors',
      isActive
        ? 'border-(--ui-accent) bg-(--ui-bg-tertiary)'
        : 'border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) hover:border-(--ui-stroke-strong)'
    ),
    children: [
      jsxs('div', {
        className: 'flex w-full items-center justify-between gap-2',
        children: [
          jsx('span', { className: 'truncate text-sm font-medium', children: theme.name }),
          isActive
            ? jsx(Badge, {
                variant: 'outline',
                className: 'shrink-0 text-[0.6875rem] text-(--ui-accent)',
                children: 'Active'
              })
            : null
        ]
      }),
      jsx('span', {
        className: 'line-clamp-2 text-xs leading-relaxed text-(--ui-text-tertiary)',
        children: theme.description || 'No description'
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
  const groups = {}
  for (const s of skins) {
    const key = s.category || 'Other'
    ;(groups[key] = groups[key] || []).push(s)
  }

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col overflow-y-auto',
    children: [
      jsxs('div', {
        className: 'border-b border-(--ui-stroke-secondary) px-6 py-5',
        children: [
          jsx('div', {
            className: 'text-base font-semibold',
            children: 'Theme Switcher'
          }),
          jsx('div', {
            className: 'mt-1 text-xs text-(--ui-text-tertiary)',
            children: `Active: ${active} · ${skins.length} skins installed. Click any card to apply it, every surface repaints live.`
          })
        ]
      }),
      skins.length === 0
        ? jsx(EmptyState, {
            title: 'No skins found',
            description: 'Drop YAML skins into your Hermes skins folder and they will appear here.'
          })
        : Object.entries(groups).map(([cat, items]) =>
            jsxs('section', {
              key: cat,
              children: [
                jsx('h2', {
                  className: 'px-6 pb-2 pt-5 text-[0.6875rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
                  children: `${cat} (${items.length})`
                }),
                jsx('div', {
                  className: 'grid grid-cols-1 gap-3 px-6 pb-4 sm:grid-cols-2 lg:grid-cols-3',
                  children: items.map(t =>
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
          )
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
