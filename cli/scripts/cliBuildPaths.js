"use strict";

const path = require("path");

/**
 * Resolve the directory the staged CLI app bundle is written to / read from.
 *
 * Default is `<cliDir>/app`. Setting `DURINDOOR_CLI_APP_DIR` lets callers
 * (CI, packagers, staged-bundle builders) redirect that location so the
 * in-place `cli/app` tree is never touched. Mirrors the upstream contract
 * verbatim — the override is used as-is, no trimming or relative resolution,
 * so a packager-selected path keeps process-relative semantics.
 *
 * @param {string} cliDir Absolute path to the `cli/` package directory.
 * @param {NodeJS.ProcessEnv} [env=process.env] Environment source (injectable for tests).
 * @returns {string} Path to the CLI app bundle directory.
 */
function resolveCliAppDir(cliDir, env = process.env) {
  return (env && env.DURINDOOR_CLI_APP_DIR) || path.join(cliDir, "app");
}

module.exports = { resolveCliAppDir };
