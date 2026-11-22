import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

/**
 * V5 evidence coverage guard.
 *
 * Every production page, dialog (*Modal.js) and error boundary (error.js) must have a browser-evidence
 * registry entry in tests/e2e/v5-evidence/*.json ({ route, stories[] }), so no surface can reach the V5
 * default without evidence. Conventions:
 *   - pages:   the URL route (route groups stripped, dynamic segments kept as [id])
 *   - dialogs: dialog/<ComponentName>
 *   - errors:  error/<route without leading slash>
 * Out of scope (internal/docs/v5-production-integration.md section 6): `/`, /dashboard, /landing,
 * /dashboard/workspaces.
 */
const root = resolve(import.meta.dirname, "../..");
const srcDir = join(root, "src");
const appDir = join(srcDir, "app");
const registryDir = join(root, "tests/e2e/v5-evidence");
const OUT_OF_SCOPE = new Set(["/", "/dashboard", "/landing", "/dashboard/workspaces"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function routeOf(file) {
  const segments = relative(appDir, file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return "/" + segments.join("/");
}

const registry = readdirSync(registryDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(registryDir, f), "utf8")) }));
const byRoute = new Map();
for (const entry of registry) {
  if (!byRoute.has(entry.route)) byRoute.set(entry.route, []);
  byRoute.get(entry.route).push(...(entry.stories || []));
}

const srcFiles = walk(srcDir);
const appFiles = srcFiles.filter((f) => f.startsWith(appDir + sep));
const pages = appFiles.filter((f) => basename(f) === "page.js").map(routeOf).filter((r) => !OUT_OF_SCOPE.has(r)).sort();
const modals = [...new Set(
  srcFiles
    .filter((f) => /Modal\.js$/.test(f) && !f.startsWith(join(srcDir, "shared/ui/v5") + sep))
    .map((f) => basename(f, ".js")),
)].sort();
const errors = appFiles.filter((f) => basename(f) === "error.js").map((f) => "error" + routeOf(f)).sort();

describe("V5 evidence registry coverage", () => {
  it("finds production surfaces to check", () => {
    expect(pages.length).toBeGreaterThan(0);
    expect(modals.length).toBeGreaterThan(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(registry.length).toBeGreaterThan(0);
  });

  it("registry files are well formed", () => {
    for (const entry of registry) {
      expect(typeof entry.route, entry.file).toBe("string");
      expect(Array.isArray(entry.stories), entry.file).toBe(true);
    }
  });

  it.each(pages)("page %s has registry evidence with at least one story", (route) => {
    expect(byRoute.has(route), `no registry entry for page ${route}`).toBe(true);
    expect(byRoute.get(route).length, `${route} has no story id`).toBeGreaterThan(0);
  });

  it.each(modals)("dialog %s has registry evidence", (name) => {
    const route = `dialog/${name}`;
    expect(byRoute.has(route), `no registry entry for ${route}`).toBe(true);
    expect(byRoute.get(route).length, `${route} has no story id`).toBeGreaterThan(0);
  });

  it.each(errors)("error boundary %s has registry evidence", (route) => {
    expect(byRoute.has(route), `no registry entry for ${route}`).toBe(true);
    expect(byRoute.get(route).length, `${route} has no story id`).toBeGreaterThan(0);
  });

  it("every registry story id maps to a production stories file (static check)", () => {
    const sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const exportId = (name) =>
      sanitize(name.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"));
    const known = new Set();
    for (const file of srcFiles.filter((f) => /\.stories\.(js|jsx|ts|tsx)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      // Story titles are slash-separated ("Production/area/Name"); fixture titles inside stories are not.
      const title = text.match(/(?:^|[{,])\s*title:\s*["'`]([^"'`\n]+\/[^"'`\n]+)["'`]/m)?.[1];
      if (!title) continue;
      const base = title.split("/").map(sanitize).join("-");
      for (const m of text.matchAll(/export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/g)) known.add(`${base}--${exportId(m[1])}`);
      for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(",")) {
          const name = part.split(/\s+as\s+/).pop().trim();
          if (name && name !== "default") known.add(`${base}--${exportId(name)}`);
        }
      }
    }
    const missing = [];
    for (const entry of registry) for (const id of entry.stories || []) if (!known.has(id)) missing.push(`${entry.file}: ${id}`);
    expect(missing, `story ids with no matching stories file export:\n${missing.join("\n")}`).toEqual([]);
  });
});
