import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveAlias(targetPath, specifier) {
  const ext = path.extname(targetPath);
  if (ext) {
    return exists(targetPath) ? targetPath : null;
  }
  const asFile = `${targetPath}.js`;
  if (await exists(asFile)) return asFile;
  const asIndex = path.join(targetPath, "index.js");
  if (await exists(asIndex)) return asIndex;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const targetPath = path.resolve(REPO_ROOT, "src", specifier.slice(2));
    const resolved = await resolveAlias(targetPath, specifier);
    if (resolved) {
      return nextResolve(pathToFileURL(resolved).href, context);
    }
    return nextResolve(pathToFileURL(targetPath).href, context);
  }
  if (specifier.startsWith("open-sse/")) {
    const targetPath = path.resolve(REPO_ROOT, "open-sse", specifier.slice(9));
    const resolved = await resolveAlias(targetPath, specifier);
    if (resolved) {
      return nextResolve(pathToFileURL(resolved).href, context);
    }
    return nextResolve(pathToFileURL(targetPath).href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  return nextLoad(url, context);
}
