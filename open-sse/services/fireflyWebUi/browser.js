// Ordinary browser launch for the staged Firefly web UI flow (#2034).
//
// Chromium comes straight from the installed `playwright` package through an
// injectable launcher. It deliberately does not use services/browserPool.js,
// resolvePlainBrowserLaunchOptions, cloakbrowser, obscura or any stealth
// plugin: no user-agent or client-hint override, no extra args, no init
// scripts, no cookie or storage injection and no proof or fingerprint data.
// The only options are the persistent profile directory and headed/headless.
//
// Each call owns the persistent context it launched and closes it exactly
// once. Nothing here reads cookies, storage state or tokens.

import { isFunction } from "../../../src/shared/utils/typeChecks.js";

// The complete launch options. Tests assert these exact objects.
export const GENERATION_LAUNCH_OPTIONS = Object.freeze({ headless: true, acceptDownloads: true });
export const SETUP_LAUNCH_OPTIONS = Object.freeze({ headless: false });

/** The default launcher: playwright's own chromium, imported on first use. */
export const playwrightLauncher = Object.freeze({
  async launchPersistentContext(userDataDir, options) {
    const { chromium } = await import("playwright");
    return chromium.launchPersistentContext(userDataDir, options);
  },
});

/**
 * Launch an owned persistent context. Returns `{ context, close }`, where
 * `close` closes this context once and never throws.
 */
export async function launchOwnedContext(launcher, userDataDir, options) {
  if (!isFunction(launcher?.launchPersistentContext)) throw new Error("Adobe Firefly web UI needs a browser launcher");
  const context = await launcher.launchPersistentContext(userDataDir, { ...options });
  let closing = null;
  const close = () => {
    closing ??= Promise.resolve().then(() => context.close()).catch(() => {});
    return closing;
  };
  return { context, close };
}
