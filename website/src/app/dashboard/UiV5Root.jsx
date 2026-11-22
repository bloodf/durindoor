"use client";

import { useLayoutEffect } from "react";

/**
 * Mirrors the production root layout for the demo: while the dashboard demo is
 * mounted, `<html>` carries `data-ui="v5"` when `enabled` (the server resolved
 * DURINDOOR_UI_V5 with the same rule as the real app). The attribute is removed
 * on unmount so the homepage and login keep their own look after client navigation.
 */
export default function UiV5Root({ enabled }) {
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const root = document.documentElement;
    root.setAttribute("data-ui", "v5");
    return () => root.removeAttribute("data-ui");
  }, [enabled]);
  return null;
}
