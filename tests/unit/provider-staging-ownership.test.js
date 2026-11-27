/**
 * #2311 ownership: every staged module in open-sse/executors/staged.json names
 * the canonical provider that owns it. A module basename is not an owner:
 * several providers ship nested helpers with the same file name, and one
 * provider can own both an executor and a private definition.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../../open-sse/executors/staged.json";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { REGISTERED_EXECUTOR_IDS, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { STAGED_PROVIDERS } from "../../open-sse/providers/staged.js";
import { STAGED_PROVIDERS as EXPORTED } from "../../open-sse/providers/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXECUTOR = /^open-sse\/executors\/([^/]+)\.js$/;
const HELPER = /^open-sse\/executors\/([^/]+)\/[^/]+\.js$/;
const PRIVATE = /^open-sse\/providers\/private\/[^/]+\.js$/;

/** The owner implied by a module's location, or by its default export's id. */
async function derivedOwner(module) {
  const executor = module.match(EXECUTOR) ?? module.match(HELPER);
  if (executor) return executor[1];
  if (PRIVATE.test(module)) return (await import(path.join(root, module))).default?.id;
  return undefined;
}

const byProvider = Object.groupBy(manifest.modules, ({ provider }) => provider);

describe("provider staging ownership", () => {
  it("lists each module once and assigns it the owner its location or definition implies", async () => {
    const modules = manifest.modules.map(({ module }) => module);
    expect(new Set(modules).size).toBe(modules.length);
    for (const { module, provider } of manifest.modules) {
      expect(fs.existsSync(path.join(root, module)), module).toBe(true);
      expect(provider, module).toBe(await derivedOwner(module));
    }
  });

  it("keeps same-named helpers apart under their own providers", () => {
    const owners = new Map();
    for (const { module, provider } of manifest.modules.filter(({ module }) => HELPER.test(module))) {
      const name = path.basename(module);
      owners.set(name, [...(owners.get(name) || []), provider]);
    }
    for (const name of ["credential.js", "errors.js", "events.js"]) {
      expect(owners.get(name), name).toEqual(["inner-ai-web", "venice-web"]);
    }
    // No basename resolves to an owner: none of the helper names is a provider.
    for (const name of owners.keys()) expect(STAGED_PROVIDERS[path.basename(name, ".js")], name).toBeUndefined();
  });

  it("gives an executor and its private definition one shared owner entry", () => {
    for (const id of ["inner-ai-web", "venice-web", "poe-web", "v0-vercel-web"]) {
      const modules = byProvider[id].map(({ module }) => module);
      expect(modules, id).toContain(`open-sse/executors/${id}.js`);
      expect(modules, id).toContain(`open-sse/providers/private/${id}.js`);
    }
    expect(Object.keys(byProvider).sort()).toEqual(Object.keys(STAGED_PROVIDERS).sort());
  });

  it("covers every private provider definition and every staged module of it", async () => {
    const dir = path.join(root, "open-sse/providers/private");
    for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(".js"))) {
      const module = `open-sse/providers/private/${name}`;
      const { default: definition } = await import(path.join(dir, name));
      if (!definition?.id) continue;
      expect(STAGED_PROVIDERS[definition.id]?.staged, module).toBe(true);
      expect(byProvider[definition.id].map((entry) => entry.module), module).toContain(module);
    }
  });

  it("keeps every staged provider unavailable until its registration change", () => {
    const catalog = new Set(REGISTRY.flatMap(({ id, alias, aliases }) => [id, alias, ...(aliases || [])]).filter(Boolean));
    expect(EXPORTED).toBe(STAGED_PROVIDERS);
    for (const [id, entry] of Object.entries(STAGED_PROVIDERS)) {
      expect(hasSpecializedExecutor(id), id).toBe(false);
      const listed = byProvider[id].some(({ catalogProvider }) => catalogProvider === id);
      // Only providers whose catalog entry predates the staged executor may be listed.
      expect(catalog.has(id), id).toBe(listed);
      if (!listed) expect(REGISTERED_EXECUTOR_IDS, id).not.toContain(id);
      if (entry.docs) {
        const doc = fs.readFileSync(path.join(root, entry.docs), "utf8");
        expect(doc, entry.docs).toMatch(/staged/i);
        expect(doc, entry.docs).toMatch(/unavailable/i);
      }
    }
  });
});
