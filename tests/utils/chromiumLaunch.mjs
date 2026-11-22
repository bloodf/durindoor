import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const revision = (name) => Number(name.match(/-(\d+)$/)?.[1] || 0);

/**
 * Chromium launch options for the browser tests.
 *
 * Order: V5_CHROMIUM_EXECUTABLE, then Playwright's own revision when installed, then a
 * Chrome or Chromium on PATH, then the newest chromium or chrome-headless-shell revision
 * in the Playwright browser cache. The fallbacks keep the test usable when the cache
 * holds a different revision than the pinned playwright package expects.
 */
export function chromiumLaunchOptions(chromium, repoRoot) {
  return { ...executableOptions(chromium), ...fontEnvironment(repoRoot) };
}

/**
 * Chrome aborts (SIGABRT in SkFontMgr) when the host has neither fontconfig data nor a
 * single font. Point it at a generated config that serves the repository's own tracked
 * fonts; hosts with a normal fontconfig setup are left alone.
 */
function fontEnvironment(repoRoot) {
  if (process.env.FONTCONFIG_FILE || process.env.FONTCONFIG_PATH || existsSync("/etc/fonts/fonts.conf")) return {};
  const fonts = repoRoot ? join(repoRoot, "website/public/home/fonts") : "";
  if (!fonts || !existsSync(fonts)) return {};
  const dir = join(tmpdir(), "durindoor-v5-fontconfig");
  mkdirSync(join(dir, "cache"), { recursive: true });
  const file = join(dir, "fonts.conf");
  writeFileSync(file, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><dir>${fonts}</dir><cachedir>${join(dir, "cache")}</cachedir></fontconfig>\n`);
  return { env: { ...process.env, FONTCONFIG_FILE: file } };
}

function executableOptions(chromium) {
  const override = process.env.V5_CHROMIUM_EXECUTABLE;
  if (override) return { executablePath: override };
  let bundled;
  try { bundled = chromium.executablePath(); } catch { bundled = undefined; }
  if (bundled && existsSync(bundled)) return {};
  // A system Chrome on PATH works with any pinned Playwright, and (unlike a cached
  // revision) its shared libraries are known to be present.
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    for (const dir of (process.env.PATH || "").split(delimiter)) {
      const path = join(dir, name);
      if (dir && existsSync(path)) return { executablePath: path };
    }
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0"
    ? process.env.PLAYWRIGHT_BROWSERS_PATH
    : join(homedir(), ".cache", "ms-playwright");
  const candidates = existsSync(cache) ? readdirSync(cache) : [];
  const layouts = [
    ["chromium_headless_shell-", "chrome-headless-shell-linux64/chrome-headless-shell"],
    ["chromium-", "chrome-linux64/chrome"],
  ];
  for (const [prefix, binary] of layouts) {
    const found = candidates
      .filter((name) => name.startsWith(prefix) && /-\d+$/.test(name))
      .sort((a, b) => revision(b) - revision(a))
      .map((name) => join(cache, name, binary))
      .find((path) => existsSync(path));
    if (found) return { executablePath: found };
  }
  return {};
}

/** Applies the generated fontconfig (see fontEnvironment) to this process so every browser launched by it inherits it. */
export function ensureFontConfig(repoRoot) {
  const { env } = fontEnvironment(repoRoot);
  if (env) process.env.FONTCONFIG_FILE = env.FONTCONFIG_FILE;
}
