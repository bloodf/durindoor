import { resolve } from "node:path";
import { chromiumLaunchOptions, ensureFontConfig } from "./chromiumLaunch.mjs";

/** Select exactly one Playwright engine for a V5 evidence run. */
export function selectV5Browser(name = "chromium") {
  if (!["chromium", "firefox", "webkit"].includes(name)) {
    throw new Error(`Unknown V5_BROWSER_ENGINE ${JSON.stringify(name)}; expected chromium, firefox, or webkit`);
  }
  return name;
}

export function v5BrowserLaunchOptions(engine, browserType, root) {
  if (engine === "chromium") return chromiumLaunchOptions(browserType, root);
  ensureFontConfig(root);
  const executablePath = process.env[`V5_${engine.toUpperCase()}_EXECUTABLE`];
  return executablePath ? { executablePath } : {};
}

export function v5ScreenshotDirectory(root, engine, routeSlug) {
  return engine === "chromium" ? resolve(root, routeSlug) : resolve(root, engine, routeSlug);
}
