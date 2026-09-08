import React, { useEffect } from "react";
import { loader } from "@monaco-editor/react";

import "material-symbols/outlined.css";
import "../src/shared/ui/tokens.css";
import "../src/app/globals.css";
import "./preview.css";

import { LOCALES, LOCALE_NAMES, DEFAULT_LOCALE } from "../src/i18n/config.js";
import useThemeStore from "../src/store/themeStore.js";
import { THEME_CONFIG } from "../src/shared/constants/config.js";
import { useTheme as useAppTheme } from "../src/shared/hooks/useTheme.js";
import { setupStoryScope } from "./decorators.jsx";

// Serve the real editor and workers locally; offline QA never uses a CDN.
loader.config({ paths: { vs: "/monaco/vs" } });
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

/**
 * Owns the Storybook toolbar theme for one story. Snapshots the in-memory
 * store value and the raw `localStorage[THEME_CONFIG.storageKey]` payload, then
 * calls the real `setTheme(requested)` so production state and the rendered
 * tree cannot diverge. The returned teardown restores the store first and
 * the raw storage string second, mirroring the order in which we mutated.
 */
export function setupStoryThemeScope(context) {
  const requested = context.globals.theme === "light" ? "light" : "dark";
  const storageKey = THEME_CONFIG.storageKey;
  const { getState } = useThemeStore;
  const previousTheme = getState().theme;
  const previousStorage = localStorage.getItem(storageKey);
  const previousColorScheme = document.documentElement.style.colorScheme;

  getState().setTheme(requested);
  document.documentElement.style.colorScheme = requested;

  return async () => {
    getState().setTheme(previousTheme);
    if (previousStorage === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, previousStorage);
    document.documentElement.style.colorScheme = previousColorScheme;
  };
}

/**
 * `preview.beforeEach` establishes production theme before fixtures and story
 * render. Fixture setup order delegates unchanged to `setupStoryScope`; cleanup
 * reverses every completed step when later setup fails.
 */
export async function setupStoryLifecycle(context) {
  const cleanups = [];
  try {
    const teardownTheme = setupStoryThemeScope(context);
    cleanups.push(teardownTheme);
    const teardownScope = await setupStoryScope(context);
    cleanups.push(teardownScope);
  } catch (error) {
    const rollbackErrors = [];
    for (const restore of cleanups.reverse()) {
      try { await restore(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length === 0) throw error;
    if (rollbackErrors.length === 1) throw new AggregateError([error, rollbackErrors[0]], "Storybook preview setup failed and rollback failed");
    throw new AggregateError([error, ...rollbackErrors], "Storybook preview setup failed and rollback failed");
  }

  return async () => {
    const errors = [];
    for (const restore of cleanups.reverse()) {
      try { await restore(); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Storybook preview cleanup failed");
  };
}

/**
 * Lets real `useTheme` drive the rendered tree and native color scheme.
 * Canvas colors come from preview.css tokens. Updating Storybook globals here
 * restarts rendering during play, discarding controlled state and open dialogs.
 */
function ThemeDecorator(Story) {
  const { theme } = useAppTheme();

  useEffect(() => {
    if (document.documentElement.style.colorScheme !== theme) {
      document.documentElement.style.colorScheme = theme;
    }
  }, [theme]);

  return <Story />;
}

const preview = {
  decorators: [ThemeDecorator],
  beforeEach: setupStoryLifecycle,
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
    locale: {
      name: "Locale",
      description: "Durin DS runtime locale (SB3 applies html lang/dir)",
      defaultValue: DEFAULT_LOCALE,
      toolbar: {
        icon: "globe",
        items: LOCALES.map((value) => ({ value, title: LOCALE_NAMES[value] ?? value })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "dark",
    locale: DEFAULT_LOCALE,
  },
};
export default preview;
