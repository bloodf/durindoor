"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/shared/hooks/useTheme";

export function DocsThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="dd-docs-theme-toggle"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  );
}

/** Public guides are English even when the marketing locale cookie is not. */
export function DocsReadingPreferences() {
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = "en";
    return () => { document.documentElement.lang = previous; };
  }, []);
  return <div className="dd-docs-reading-controls"><DocsThemeToggle /></div>;
}
