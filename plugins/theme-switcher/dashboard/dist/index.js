(function () {
  "use strict";
  // hermes-desktop-theme-pack · Theme Switcher web dashboard tab
  // Lists every installed Hermes skin grouped by polarity (☀ Light / ☾ Dark),
  // marks the active one, shows each theme's paired twin, and applies a new
  // one with one click. Applying a skin also repaints the web dashboard: the
  // backend writes a dashboard-theme YAML and activates it (config
  // dashboard.theme). Reuses the shared backend plugin API that also powers
  // the native Desktop page.
  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) return;

  const React = SDK.React;
  const { useState, useEffect, useCallback, useMemo } = SDK.hooks;
  const C = SDK.components;
  const cn = SDK.utils.cn;

  const API = "/api/plugins/theme-switcher";
  const NEW_MS = 3 * 24 * 60 * 60 * 1000;

  // Small fetch wrapper with host auth handling (fetchJSON). Throws
  // Error("<status>: <body>") on non-2xx — call sites surface that.
  function rest(path, options) {
    return SDK.fetchJSON(API + path, options);
  }

  // ── Polarity helpers (mirror the Desktop page: luminance of the
  //    background decides ☀ light vs ☾ dark) ────────────────────────────────
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

  function SwatchRow({ colors }) {
    if (!colors) return null;
    const swatches = [
      { key: "background", label: "background" },
      { key: "accent", label: "accent" },
      { key: "tool", label: "tool" },
      { key: "text", label: "text" },
      { key: "secondary", label: "secondary" },
      { key: "border", label: "border" },
    ].filter((s) => colors[s.key]);

    if (!swatches.length) return null;

    return React.createElement(
      "div",
      { className: "ts-swatch-row" },
      swatches.map((s) =>
        React.createElement("span", {
          key: s.key,
          title: s.label + ": " + colors[s.key],
          className: "ts-swatch",
          style: { backgroundColor: colors[s.key] },
        }),
      ),
    );
  }

  function ThemeCard({ theme, activeName, onApply, applying, isDark }) {
    const isActive = theme.name === activeName;
    const isNew = Boolean(
      theme.installed_at && Date.now() - theme.installed_at < NEW_MS,
    );
    const hasTwin = Boolean(theme.twin);
    const applyingSelf = applying === theme.name;
    const applyingTwin = hasTwin && applying === theme.twin;

    return React.createElement(
      C.Card,
      { className: cn("ts-card", isActive && "ts-card-active") },
      React.createElement(
        C.CardContent,
        { className: "ts-card-body" },
        React.createElement(SwatchRow, { colors: theme.colors }),
        React.createElement(
          "div",
          { className: "ts-card-title-row" },
          React.createElement("span", { className: "ts-card-name" }, theme.name),
          isActive &&
            React.createElement(
              C.Badge,
              { variant: "outline", className: "ts-badge ts-badge-active" },
              "Active",
            ),
        ),
        React.createElement(
          "div",
          { className: "ts-card-meta" },
          React.createElement(
            "span",
            { className: "ts-chip" },
            theme.category || "Other",
          ),
          isNew &&
            React.createElement(
              C.Badge,
              { variant: "outline", className: "ts-badge ts-badge-new" },
              "NEW",
            ),
        ),
        theme.description &&
          React.createElement(
            "p",
            { className: "ts-card-desc" },
            theme.description,
          ),
        React.createElement(
          "div",
          { className: "ts-card-actions" },
          isActive
            ? React.createElement(
                C.Button,
                { size: "sm", variant: "outline", disabled: true },
                "Active",
              )
            : React.createElement(
                C.Button,
                {
                  size: "sm",
                  onClick: () => onApply(theme.name),
                  disabled: applyingSelf || applyingTwin,
                },
                applyingSelf ? "Applying\u2026" : "Apply",
              ),
          hasTwin &&
            React.createElement(
              C.Button,
              {
                size: "sm",
                variant: "outline",
                className: "ts-flip",
                title: "Apply paired theme " + theme.twin,
                onClick: () => onApply(theme.twin),
                disabled: applyingSelf || applyingTwin,
              },
              applyingTwin ? "\u2026" : "\u21C4 " + theme.twin,
            ),
        ),
      ),
    );
  }

  function SectionGrid({ title, themes, activeName, onApply, applying, isDark }) {
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
          }),
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
    const [note, setNote] = useState(null);

    const load = useCallback(() => {
      setError(null);
      rest("/list")
        .then((d) => setData(d))
        .catch((e) => setError(String(e && e.message ? e.message : e)));
    }, []);

    useEffect(() => {
      load();
    }, [load]);

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
              setNote(
                "Applied " + name + ". Reload the dashboard to repaint it.",
              );
            }
          })
          .catch((e) => setError(String(e && e.message ? e.message : e)))
          .finally(() => setApplying(null));
      },
      [load],
    );

    const skins = useMemo(() => {
      if (!data) return [];
      const q = query.trim().toLowerCase();
      return data.skins.filter(
        (s) => !q || s.name.toLowerCase().indexOf(q) !== -1,
      );
    }, [data, query]);

    const light = useMemo(() => skins.filter((s) => isLightTheme(s.colors)), [skins]);
    const dark = useMemo(() => skins.filter((s) => !isLightTheme(s.colors)), [skins]);

    if (!data && !error) {
      return React.createElement(
        "div",
        { className: "ts-empty" },
        "Loading themes\u2026",
      );
    }

    const total = data ? data.skins.length : 0;
    const tabs = [
      { id: "all", label: "All (" + total + ")" },
      { id: "light", label: "\u2600 Light (" + light.length + ")" },
      { id: "dark", label: "\u263E Dark (" + dark.length + ")" },
    ];

    return React.createElement(
      "div",
      { className: "ts-page" },
      React.createElement(
        "div",
        { className: "ts-header" },
        React.createElement(
          "div",
          null,
          React.createElement("h2", { className: "ts-title" }, "Themes"),
          React.createElement(
            "p",
            { className: "ts-muted" },
            total + " installed skins \u00B7 applying a theme also repaints the web dashboard",
          ),
        ),
        React.createElement(
          "div",
          { className: "ts-header-actions" },
          React.createElement(C.Input, {
            type: "search",
            placeholder: "Filter themes\u2026",
            value: query,
            onChange: (e) => setQuery(e.target.value),
            className: "ts-search",
          }),
          React.createElement(
            C.Button,
            { size: "sm", variant: "outline", onClick: load },
            "Refresh",
          ),
        ),
      ),
      React.createElement(
        "div",
        { className: "ts-tabs" },
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
          title: "\u2600 Light",
          themes: light,
          activeName: data ? data.active : "",
          onApply: apply,
          applying,
          isDark: false,
        }),
      tab !== "light" &&
        React.createElement(SectionGrid, {
          title: "\u263E Dark",
          themes: dark,
          activeName: data ? data.active : "",
          onApply: apply,
          applying,
          isDark: true,
        }),
      total === 0 &&
        React.createElement(
          "div",
          { className: "ts-empty" },
          "No skins installed yet. Install the theme pack to populate this tab.",
        ),
      total > 0 && light.length + dark.length === 0 &&
        React.createElement(
          "div",
          { className: "ts-empty" },
          "No themes match \u201C" + query + "\u201D.",
        ),
    );
  }

  window.__HERMES_PLUGINS__.register("theme-switcher", ThemesPage);
})();
