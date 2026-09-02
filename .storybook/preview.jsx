import React, { useEffect } from "react";
import { useGlobals } from "storybook/preview-api";

import "material-symbols/outlined.css";
import "../src/shared/ui/tokens.css";
import "../src/app/globals.css";
import "./preview.css";

/**
 * Reveal Material Symbols ligatures once icon fonts are ready, mirroring the
 * app's inline script in src/app/layout.js (globals.css hides the ligature
 * text until `.fonts-loaded` is present on <html>).
 */
const markFontsLoaded = () => document.documentElement.classList.add("fonts-loaded");
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(markFontsLoaded);
} else {
  markFontsLoaded();
}

const DARK_BG = "#0E0D0B";
const LIGHT_BG = "#FAF6EC";

/**
 * Applies the "Theme" toolbar global: toggles `.dark` on
 * document.documentElement (the same mechanism as the app's ThemeProvider)
 * and keeps the canvas background (`backgrounds` global) in sync so the
 * preview always matches the active Durin DS palette. Default: dark.
 */
function ThemeDecorator(Story, context) {
  const theme = context.globals.theme === "light" ? "light" : "dark";
  const [, updateGlobals] = useGlobals();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    updateGlobals({ backgrounds: { value: theme, grid: false } });
  }, [theme, updateGlobals]);

  return <Story />;
}

/** @type {import("@storybook/react-vite").Preview} */
const preview = {
  decorators: [ThemeDecorator],
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Durin DS color theme",
      defaultValue: "dark",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "dark", icon: "moon", title: "Dark — Moria stone" },
          { value: "light", icon: "sun", title: "Light — Parchment" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "dark",
    backgrounds: { value: "dark", grid: false },
  },
  parameters: {
    backgrounds: {
      options: {
        dark: { name: "Dark — Moria stone", value: DARK_BG },
        light: { name: "Light — Parchment", value: LIGHT_BG },
      },
    },
  },
};

export default preview;
