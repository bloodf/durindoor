import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const siteRoot = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(siteRoot, "..");

// Keep webpack, Node's test loader and jsconfig.json aligned with this table.
export const ALIASES = {
  "@": "../src",
  "open-sse": "../open-sse",
  "@site": "./src",
  "@source": "./.source",
  three128: "./node_modules/three",
};

export function resolveAliases() {
  return Object.fromEntries(Object.entries(ALIASES).map(([name, path]) => [name, join(siteRoot, path)]));
}
