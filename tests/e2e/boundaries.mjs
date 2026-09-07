// Pure helpers shared by Playwright fixtures and unit tests.
// This module MUST NOT import @playwright/test, runtime.mjs, or any Node child
// process so Vitest can load it cheaply in tests/unit/*.test.js. H1 fixture
// code consumes these; unit tests pin their edge-case behavior here.

import path from "node:path";

const INERT_SCHEMES = new Set(["data:"]);
const BROWSERS = new Set(["chromium", "firefox", "webkit"]);
const THEMES = new Set(["dark", "light"]);
const VIEWPORTS = new Set(["desktop", "mobile"]);

/**
 * Allow only the exact base origin (http/https) plus the inert browser-local
 * schemes data: and bare about:blank. Rejects javascript:, external blob:,
 * any about:* target other than `about:blank`, and any other origin —
 * including IMDS, link-local, host-gateway IPs, and public hosts. Malformed
 * inputs return false rather than throwing so the guard stays cheap in a hot
 * request handler.
 */
export function isAllowedDestination(value, base) {
  if (typeof value !== "string" || typeof base !== "string") return false;
  if (value.length === 0 || base.length === 0) return false;

  let target;
  try {
    target = new URL(value);
  } catch {
    return false;
  }

  if (INERT_SCHEMES.has(target.protocol)) return true;
  if (target.protocol === "about:") return value === "about:blank";
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;

  let baseUrl;
  try {
    baseUrl = new URL(base);
  } catch {
    return false;
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") return false;

  return target.origin === baseUrl.origin;
}

/**
 * Resolve an artifact path under artifactDir. Refuses any name that resolves
 * outside the directory (via `..`, absolute paths, or symlink-like hops). The
 * thrown error messages are a stable contract — unit tests assert on them.
 */
export function safeArtifactPath(artifactDir, name) {
  if (typeof artifactDir !== "string" || typeof name !== "string") {
    throw new Error("artifactPath requires string artifactDir and name");
  }
  const base = path.resolve(artifactDir);
  const target = path.resolve(base, name);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error("artifactPath escapes artifactDir");
  }
  return target;
}

/**
 * Resolve the launcher-provided invocation directory. It must be a child of
 * `<root>/qa/runs`; accepting the runs root itself would reintroduce shared
 * Playwright reports and browser state between invocations.
 */
export function validatedQaHardDir(root, hardDir) {
  if (typeof root !== "string" || root.length === 0 || typeof hardDir !== "string" || hardDir.length === 0) {
    throw new Error("DURIN_QA_HARD_DIR must name an invocation directory under qa/runs");
  }
  if (!path.isAbsolute(hardDir)) {
    throw new Error("DURIN_QA_HARD_DIR must be an absolute path");
  }
  const runsRoot = path.resolve(root, "qa", "runs");
  const resolved = path.resolve(hardDir);
  if (!resolved.startsWith(`${runsRoot}${path.sep}`)) {
    throw new Error("DURIN_QA_HARD_DIR must be contained under qa/runs");
  }
  return resolved;
}

/**
 * Parse a Playwright project name like "chromium-dark-mobile" into
 * {id, browser, theme, viewport}. Validates the canonical
 * `<browser>-<theme>-<viewport>` shape with the closed sets
 * browser ∈ {chromium, firefox, webkit}, theme ∈ {dark, light},
 * viewport ∈ {desktop, mobile}. Any miss falls back to `"unknown"`
 * fields so downstream consumers never crash on a misconfigured project.
 */
export function parseProjectName(name) {
  const unknown = { id: "unknown", browser: "unknown", theme: "unknown", viewport: "unknown" };
  if (typeof name !== "string" || name.length === 0) return unknown;
  const parts = name.split("-");
  if (parts.length !== 3) return { id: name, browser: "unknown", theme: "unknown", viewport: "unknown" };
  const [browser, theme, viewport] = parts;
  if (!BROWSERS.has(browser) || !THEMES.has(theme) || !VIEWPORTS.has(viewport)) {
    return { id: name, browser: "unknown", theme: "unknown", viewport: "unknown" };
  }
  return { id: name, browser, theme, viewport };
}
