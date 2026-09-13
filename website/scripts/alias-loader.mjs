// Node module hooks that mirror the website webpack aliases so mock handlers
// can be exercised from plain Node (see mock-smoke.mjs).
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(siteRoot, "..");
const ALIASES = [
  ["@site/", join(siteRoot, "src") + "/"],
  ["@/", join(repoRoot, "src") + "/"],
  ["open-sse/", join(repoRoot, "open-sse") + "/"],
];

function withExtension(path) {
  if (existsSync(path) && statSync(path).isFile()) return path;
  for (const ext of [".js", ".mjs", ".jsx", "/index.js"]) if (existsSync(path + ext)) return path + ext;
  return path;
}

export async function resolve(specifier, context, next) {
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
  if (alias) return next(pathToFileURL(withExtension(alias[1] + specifier.slice(alias[0].length))).href, context);
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const target = join(dirname(fileURLToPath(context.parentURL)), specifier);
    return next(pathToFileURL(withExtension(target)).href, context);
  }
  return next(specifier, context);
}
