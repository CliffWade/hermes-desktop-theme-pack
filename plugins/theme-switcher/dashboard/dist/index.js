(function () {
  "use strict";
  // hermes-desktop-theme-pack · Theme Switcher web dashboard tab
  // Lists every installed Hermes skin, marks the active one, applies a new
  // one with one click. Reuses the shared backend plugin API
  // (/api/plugins/theme-switcher/*) that also powers the native Desktop page.
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

  function ThemeCard({ theme, activeName, onApply, applying }) {
    const isActive = theme.name === activeName;
    const isNew = Boolean(
      theme.installed_at && Date.now() - theme.installed_at < NEW_MS,
    );

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
        theme.twin &&
          React.createElement(
            "p",
            { className: "ts-card-twin" },
            "\u21C4 paired with " + theme.twin,
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
                  disabled: applying === theme.name,
                },
                applying === theme.name ? "Applying\u2026" : "Apply",
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
          .then(() => load())
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

    if (!data && !error) {
      return React.createElement(
        "div",
        { className: "ts-empty" },
        "Loading themes\u2026",
      );
    }

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
            data ? data.skins.length + " installed skins" : "",
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
      error &&
        React.createElement(
          "div",
          { className: "ts-error" },
          "Error: " + error,
        ),
      skins.length === 0
        ? React.createElement(
            "div",
            { className: "ts-empty" },
            data && data.skins.length === 0
              ? "No skins installed yet. Install the theme pack to populate this tab."
              : "No themes match \u201C" + query + "\u201D.",
          )
        : React.createElement(
            "div",
            { className: "ts-grid" },
            skins.map((theme) =>
              React.createElement(ThemeCard, {
                key: theme.name,
                theme,
                activeName: data ? data.active : "",
                onApply: apply,
                applying,
              }),
            ),
          ),
    );
  }

  window.__HERMES_PLUGINS__.register("theme-switcher", ThemesPage);
})();
