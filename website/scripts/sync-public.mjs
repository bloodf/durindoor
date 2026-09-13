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
