// Copies the static assets the shared dashboard UI expects from the main app
// (../public) and the Monaco editor build into website/public.
import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPublic = join(siteRoot, "..", "public");
const sitePublic = join(siteRoot, "public");

const ENTRIES = [
  ["fonts", "fonts"],
  ["providers", "providers"],
  ["icons", "icons"],
  ["i18n", "i18n"],
  ["theme-bootstrap.js", "theme-bootstrap.js"],
  ["favicon.svg", "favicon.svg"],
  ["durindoor-wordmark.png", "durindoor-wordmark.png"],
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copy(from, to, label) {
  if (!(await exists(from))) {
    console.warn(`[sync-public] skipped ${label}: ${from} not found`);
    return;
  }
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, force: true });
  console.log(`[sync-public] ${label}`);
}

for (const [source, target] of ENTRIES) {
  await copy(join(appPublic, source), join(sitePublic, target), target);
}
await copy(join(siteRoot, "node_modules", "monaco-editor", "min", "vs"), join(sitePublic, "monaco", "vs"), "monaco/vs");

// Tailwind resolves `@import "tailwindcss"` relative to the CSS file, so the
// shared stylesheets must live under website/ to find website/node_modules on
// Vercel (the repo root is never installed there). Copy them and repoint
// `source()` at the repo src/ while also scanning website/src for utilities.
import { readFile, writeFile } from "node:fs/promises";

const STYLES = [
  ["src/shared/ui/tokens.css", "tokens.css"],
  ["src/app/globals.css", "globals.css"],
];
const stylesDir = join(siteRoot, "src", "styles", "shared");
await mkdir(stylesDir, { recursive: true });
for (const [source, target] of STYLES) {
  const css = await readFile(join(siteRoot, "..", source), "utf8");
  const rewritten = css.replace(
    /@import "tailwindcss" source\("[^"]*"\);/,
    '@import "tailwindcss" source("../../../../src");\n@source "../../";',
  );
  await writeFile(join(stylesDir, target), rewritten);
  console.log(`[sync-public] styles/shared/${target}`);
}
