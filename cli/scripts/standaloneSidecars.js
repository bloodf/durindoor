"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Standalone sidecars (OmniRoute #6908).
 *
 * `custom-server.js` sits OUTSIDE the Next.js standalone tracing root, so the
 * files it `require()`s at the app root are never traced into
 * `.next/standalone` by Next. The CLI build copies `custom-server.js` into the
 * bundle by hand (build-cli.js step 3a) — and must copy each of its root-level
 * sidecars too, or the shipped CLI crashes at boot with MODULE_NOT_FOUND (the
 * exact failure OmniRoute #6908 fixed upstream for `head-response-guard.cjs`).
 *
 * Keep this list in sync with the root-level `./…` requires at the top of
 * `custom-server.js`. `src/mitm`, `src/shared`, and `open-sse` are covered by
 * their own copy steps in build-cli.js; only app-root files belong here.
 */
const STANDALONE_SIDECARS = [
  "custom-server.js",
  "head-response-guard.cjs",
];

/**
 * Copy every standalone sidecar from the app root into the CLI app bundle.
 * Fails hard when a sidecar is missing — a silent skip ships a bundle that
 * crashes on first boot.
 *
 * @param {string} appDir Absolute path to the repo app root.
 * @param {string} cliAppDir Absolute path to the staged CLI app bundle dir.
 * @param {{ copyFileSync?: Function, mkdirSync?: Function, existsSync?: Function }} [fsImpl]
 *        Injectable fs subset for tests.
 * @returns {string[]} Absolute destination paths written, in order.
 */
function copyRequiredStandaloneSidecars(appDir, cliAppDir, fsImpl = fs) {
  // Preflight ALL sources before copying anything: a half-staged bundle that
  // has custom-server.js but not its guard is exactly the boot-crashing
  // artifact OmniRoute #6908 shipped — fail before writing a single file.
  for (const name of STANDALONE_SIDECARS) {
    const src = path.join(appDir, name);
    if (!fsImpl.existsSync(src)) {
      throw new Error(
        `Required standalone sidecar ${src} is missing — the CLI bundle would crash at boot (MODULE_NOT_FOUND)`
      );
    }
  }
  const written = [];
  for (const name of STANDALONE_SIDECARS) {
    const dest = path.join(cliAppDir, name);
    fsImpl.mkdirSync(path.dirname(dest), { recursive: true });
    fsImpl.copyFileSync(path.join(appDir, name), dest);
    written.push(dest);
  }
  return written;
}

module.exports = { STANDALONE_SIDECARS, copyRequiredStandaloneSidecars };
