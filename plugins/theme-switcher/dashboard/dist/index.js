(function () {
  "use strict";
  // hermes-desktop-theme-pack · Theme Switcher web dashboard tab
  // Lists every installed Hermes skin grouped by polarity (☀ Light / ☾ Dark),
  // with the full Desktop toolbar: search, All/Light/Dark, Follow system,
  // category filter, Random, and Add theme. Cards mirror the native Desktop
  // page (compact, wide, accent bar, floating actions). Applying a skin also
  // repaints the web dashboard (host SDK theme.apply where available).
  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) return;

  const React = SDK.React;
  const { useState, useEffect, useCallback, useMemo } = SDK.hooks;
  const C = SDK.components;
  const cn = SDK.utils.cn;

  const API = "/api/plugins/theme-switcher";
  const NEW_MS = 3 * 24 * 60 * 60 * 1000;
  const CATEGORY_ORDER = [
    "Dark", "Light", "Vibrant", "Nature", "Minimal", "Retro", "Community",
    "Built-in", "Other",
  ];

  function rest(path, options) {
    return SDK.fetchJSON(API + path, options);
  }

  // ── Polarity helpers (mirror the Desktop page) ─────────────────────────────
  function lum(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return 0;
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const r = f(parseInt(m[1].slice(0, 2), 16));
    const g = f(parseInt(m[1].slice(2, 4), 16));
    const b = f(parseInt(m[1].slice(4, 6), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function isLightTheme(colors) {
    if (!colors || !colors.background) return false;
    return lum(colors.background) >= 0.5;
  }

  // ── Theme card (Desktop-style) ─────────────────────────────────────────────
  function ThemeCard({ theme, activeName, onApply, applying, isDark, onHover, onLeave }) {
    const isActive = theme.name === activeName;
    const isNew = Boolean(
      theme.installed_at && Date.now() - theme.installed_at < NEW_MS,
    );
    const c = theme.colors || {};
    const accent = c.accent || c.tool || c.background || "";
    const hasTwin = Boolean(theme.twin);
    const busy = applying === theme.name || (hasTwin && applying === theme.twin);
    const swatches = ["background", "accent", "tool", "text", "secondary", "border"].filter(
      (k) => c[k],
    );

    return React.createElement(
      "div",
      {
        className: cn("ts-card-wrap", isActive && "ts-card-active"),
        onMouseEnter: onHover ? () => onHover(theme) : undefined,
        onMouseLeave: onLeave ? onLeave : undefined,
      },
      React.createElement(
        "button",
        {
          type: "button",
          className: cn("ts-card", isActive && "ts-card-disabled"),
          onClick: () => onApply(theme.name),
          disabled: isActive || busy,
          title: (theme.description || theme.name) + " (" + (isDark ? "dark" : "light") + ")",
        },
        accent
          ? React.createElement("span", {
              className: "ts-accent-bar",
              style: { backgroundColor: accent },
            })
          : null,
        React.createElement(
          "div",
          { className: "ts-card-title-row" },
          React.createElement(
            "span",
            { className: "ts-card-name" },
            React.createElement(
              "span",
              { className: "ts-polarity" },
              isDark ? "\u263E" : "\u2600",
            ),
            React.createElement("span", { className: "ts-name-text" }, theme.name),
          ),
          isActive
            ? React.createElement(
                C.Badge,
                { variant: "outline", className: "ts-badge ts-badge-active" },
                "Active",
              )
            : isNew
              ? React.createElement(
                  C.Badge,
                  { variant: "outline", className: "ts-badge ts-badge-new" },
                  "NEW",
                )
              : theme.category
                ? React.createElement(
                    "span",
                    { className: "ts-category" },
                    theme.category,
                  )
                : null,
        ),
        React.createElement(
          "div",
          { className: "ts-swatch-row" },
          swatches.map((k) =>
            React.createElement("span", {
              key: k,
              className: "ts-swatch",
              style: { backgroundColor: c[k] },
              title: k + ": " + c[k],
            }),
          ),
        ),
        React.createElement(
          "div",
          { className: "ts-card-meta-block" },
          React.createElement(
            "span",
            { className: "ts-card-desc" },
            theme.description || "",
          ),
          React.createElement(
            "span",
            {
              className: "ts-card-twin",
              style: theme.twin ? undefined : { color: "transparent" },
            },
            theme.twin ? "\u21C4 paired with " + theme.twin : "\u21C4",
          ),
        ),
      ),
      hasTwin
        ? React.createElement(
            "button",
            {
              type: "button",
              className: "ts-flip",
              title: "Switch to paired theme: " + theme.twin,
              onClick: () => onApply(theme.twin),
              disabled: busy,
            },
            applying === theme.twin ? "\u2026" : "\u21C4",
          )
        : null,
    );
  }

  function SectionGrid({ title, themes, activeName, onApply, applying, isDark, onHover, onLeave }) {
    if (!themes.length) return null;
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "h3",
        { className: "ts-section-title" },
        title,
      ),
      React.createElement(
        "div",
        { className: "ts-grid" },
        themes.map((theme) =>
          React.createElement(ThemeCard, {
            key: theme.name,
            theme,
            activeName,
            onApply,
            applying,
            isDark,
            onHover,
            onLeave,
          }),
        ),
      ),
    );
  }

  // ── Hover detail panel ─────────────────────────────────────────────────────
  // Docked to the right edge (mirrors the Desktop plugin's preview panel) so
  // hover details never cover the grid. Renders from full_colors when present
  // so every swatch is labeled with its hex value.
  function HoverPanel({ theme }) {
    if (!theme) return null;
    const c = theme.full_colors || theme.colors || {};
    const accent = c.accent || c.tool || c.ui_accent || c.banner_accent || c.background || "#888";
    // Key palette entries first, capped so the panel stays compact (2-col grid).
    const order = ["background", "accent", "tool", "text", "secondary", "border", "ui_accent", "banner_accent", "banner_title", "banner_text", "ui_text", "banner_dim", "banner_border", "ui_ok", "ui_warn", "ui_error"];
    const entries = [];
    for (const k of order) {
      if (c[k] !== undefined && entries.length < 12) entries.push([k, c[k]]);
    }
    for (const [k, v] of Object.entries(c)) {
      if (entries.length >= 12) break;
      if (!entries.some(([ek]) => ek === k)) entries.push([k, v]);
    }

    return React.createElement(
      "div",
      { className: "ts-hover-panel" },
      React.createElement("h3", { className: "ts-hover-name" }, theme.name),
      theme.description
        ? React.createElement("div", { className: "ts-hover-desc" }, theme.description)
        : null,
      React.createElement("div", {
        className: "ts-hover-bar",
        style: { backgroundColor: accent },
      }),
      React.createElement(
        "div",
        { className: "ts-hover-swatches" },
        entries.map(([k, v]) =>
          React.createElement(
            "div",
            { key: k, className: "ts-hover-swatch" },
            React.createElement("span", { className: "ts-hover-swatch-k" }, k),
            React.createElement(
              "span",
              { className: "ts-hover-swatch-v" },
              String(v),
              React.createElement("span", {
                className: "ts-hover-chip",
                style: { backgroundColor: v },
              }),
            ),
          ),
        ),
      ),
    );
  }

  // ── Add-theme modal (mirrors the Desktop flow: paste YAML → install) ──────
  function AddThemeModal({ onClose, onInstalled }) {
    const [yaml, setYaml] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);

    const install = () => {
      setBusy(true);
      setErr(null);
      rest("/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: yaml }),
      })
        .then((res) => {
          if (!res || !res.ok) {
            setErr((res && res.error) || "install failed");
            return;
          }
          onInstalled(res.name);
        })
        .catch((e) => setErr(String(e && e.message ? e.message : e)))
        .finally(() => setBusy(false));
    };

    return React.createElement(
      "div",
      { className: "ts-overlay", onClick: onClose },
      React.createElement(
        "div",
        { className: "ts-modal", onClick: (e) => e.stopPropagation() },
        React.createElement("div", { className: "ts-modal-title" }, "Add theme"),
        React.createElement(
          "textarea",
          {
            className: "ts-modal-textarea",
            placeholder: "Paste a skin YAML here\u2026",
            value: yaml,
            onChange: (e) => setYaml(e.target.value),
            spellCheck: false,
          },
        ),
        err &&
          React.createElement("div", { className: "ts-error" }, err),
        React.createElement(
          "div",
          { className: "ts-modal-actions" },
          React.createElement(
            C.Button,
            { size: "sm", variant: "outline", onClick: onClose },
            "Cancel",
          ),
          React.createElement(
            C.Button,
            {
              size: "sm",
              onClick: install,
              disabled: busy || !yaml.trim(),
            },
            busy ? "Installing\u2026" : "Install",
          ),
        ),
      ),
    );
  }

  function ThemesPage() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [applying, setApplying] = useState(null);
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState("all");
    const [category, setCategory] = useState("All");
    const [followSystem, setFollowSystem] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [note, setNote] = useState(null);
    const [hoverTheme, setHoverTheme] = useState(null);
    const [systemDark, setSystemDark] = useState(
      typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches,
    );

    const load = useCallback(() => {
      setError(null);
      rest("/list")
        .then((d) => setData(d))
        .catch((e) => setError(String(e && e.message ? e.message : e)));
    }, []);

    useEffect(() => {
      load();
      rest("/settings")
        .then((s) => {
          if (s && typeof s.follow_system === "boolean") {
            setFollowSystem(s.follow_system);
          }
        })
        .catch(() => {});
    }, [load]);

    // Track the OS color scheme while following.
    useEffect(() => {
      if (!window.matchMedia) return;
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = (e) => setSystemDark(e.matches);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }, []);

    const apply = useCallback(
      (name) => {
        setApplying(name);
        setError(null);
        rest("/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        })
          .then((res) => {
            load();
            if (res && res.dashboard_theme) {
              const applied =
                SDK.theme && SDK.theme.apply ? SDK.theme.apply(name) : false;
              setNote(
                applied
                  ? "Applied " + name + "."
                  : "Applied " + name + ". Reload the dashboard to repaint it.",
              );
            }
          })
          .catch((e) => setError(String(e && e.message ? e.message : e)))
          .finally(() => setApplying(null));
      },
      [load],
    );

    // Follow system: when the OS scheme flips, switch the active theme to its
    // paired twin if the current polarity no longer matches.
    useEffect(() => {
      if (!followSystem || !data || !data.active) return;
      const active = data.skins.find((s) => s.name === data.active);
      if (!active || !active.twin) return;
      const activeIsLight = isLightTheme(active.colors);
      const systemWantsLight = !systemDark;
      if (systemWantsLight !== activeIsLight) {
        apply(active.twin);
      }
    }, [systemDark, followSystem, data, apply]);

    const setFollow = (on) => {
      setFollowSystem(on);
      rest("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ follow_system: on }),
      }).catch(() => {});
    };

    const randomApply = () => {
      if (!visible.length) return;
      const pool = visible.length > 1 && data
        ? visible.filter((s) => s.name !== data.active)
        : visible;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick) apply(pick.name);
    };

    const onInstalled = (name) => {
      setShowAdd(false);
      load();
      setNote("Installed " + name + ".");
    };

    const skins = useMemo(() => {
      if (!data) return [];
      const q = query.trim().toLowerCase();
      return data.skins.filter((s) => {
        if (q && s.name.toLowerCase().indexOf(q) === -1) return false;
        if (category !== "All" && s.category !== category) return false;
        return true;
      });
    }, [data, query, category]);

    const categories = useMemo(() => {
      if (!data) return ["All"];
      const present = new Set(data.skins.map((s) => s.category).filter(Boolean));
      const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
      for (const c of present) {
        if (!ordered.includes(c)) ordered.push(c);
      }
      return ["All", ...ordered];
    }, [data]);

    const light = useMemo(() => skins.filter((s) => isLightTheme(s.colors)), [skins]);
    const dark = useMemo(() => skins.filter((s) => !isLightTheme(s.colors)), [skins]);
    const visible = tab === "light" ? light : tab === "dark" ? dark : skins;

    if (!data && !error) {
      return React.createElement(
        "div",
        { className: "ts-empty" },
        "Loading themes\u2026",
      );
    }

    const total = data ? data.skins.length : 0;
    const tabs = [
      { id: "all", label: "All" },
      { id: "light", label: "\u2600 Light" },
      { id: "dark", label: "\u263E Dark" },
    ];

    return React.createElement(
      "div",
      { className: "ts-page" },
      React.createElement(
        "div",
        { className: "ts-toolbar" },
        React.createElement(C.Input, {
          type: "search",
          placeholder: "Search themes\u2026",
          value: query,
          onChange: (e) => setQuery(e.target.value),
          className: "ts-search",
        }),
        React.createElement(
          "div",
          { className: "ts-tab-group" },
          tabs.map((t) =>
            React.createElement(
              "button",
              {
                key: t.id,
                type: "button",
                className: cn("ts-tab", tab === t.id && "ts-tab-active"),
                onClick: () => setTab(t.id),
              },
              t.label,
            ),
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: cn("ts-tab", followSystem && "ts-tab-follow"),
              onClick: () => setFollow(!followSystem),
              title: "Auto-switch to the paired theme when the OS light/dark scheme changes",
            },
            "\u21C5 Follow system",
          ),
        ),
        React.createElement(
          "select",
          {
            className: "ts-select",
            value: category,
            onChange: (e) => setCategory(e.target.value),
            title: "Filter by category",
          },
          categories.map((c) =>
            React.createElement("option", { key: c, value: c }, c),
          ),
        ),
        React.createElement(
          "div",
          { className: "ts-action-group" },
          React.createElement(
            C.Button,
            {
              size: "sm",
              variant: "outline",
              onClick: randomApply,
              disabled: !visible.length,
              title: "Apply a random theme from the current filter",
            },
            "\uD83C\uDFB2 Random",
          ),
          React.createElement(
            C.Button,
            {
              size: "sm",
              variant: "outline",
              onClick: () => setShowAdd(true),
              title: "Install a theme from pasted YAML",
            },
            "+ Add theme",
          ),
          React.createElement(
            C.Button,
            { size: "sm", variant: "outline", onClick: load, title: "Reload the list" },
            "Refresh",
          ),
        ),
      ),
      React.createElement(
        "div",
        { className: "ts-muted" },
        total + " installed skins \u00B7 applying a theme also repaints the web dashboard",
      ),
      note &&
        React.createElement("div", { className: "ts-note" }, note),
      error &&
        React.createElement(
          "div",
          { className: "ts-error" },
          "Error: " + error,
        ),
      tab !== "dark" &&
        React.createElement(SectionGrid, {
          title: "\u2600 Light (" + light.length + ")",
          themes: light,
          activeName: data ? data.active : "",
          onApply: apply,
          applying,
          isDark: false,
          onHover: setHoverTheme,
          onLeave: () => setHoverTheme(null),
        }),
      tab !== "light" &&
        React.createElement(SectionGrid, {
          title: "\u263E Dark (" + dark.length + ")",
          themes: dark,
          activeName: data ? data.active : "",
          onApply: apply,
          applying,
          isDark: true,
          onHover: setHoverTheme,
          onLeave: () => setHoverTheme(null),
        }),
      total === 0 &&
        React.createElement(
          "div",
          { className: "ts-empty" },
          "No skins installed yet. Install the theme pack to populate this tab.",
        ),
      total > 0 && visible.length === 0 &&
        React.createElement(
          "div",
          { className: "ts-empty" },
          "No themes match the current filter.",
        ),
      showAdd &&
        React.createElement(AddThemeModal, { onClose: () => setShowAdd(false), onInstalled }),
      React.createElement(HoverPanel, { theme: hoverTheme }),
    );
  }

  window.__HERMES_PLUGINS__.register("theme-switcher", ThemesPage);
})();
