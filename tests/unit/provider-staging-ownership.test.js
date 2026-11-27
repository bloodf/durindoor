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
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { getVideoConfig } from "../../open-sse/handlers/videoCore.js";

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

/** Owner implied by a module path alone: an executor file or its helper directory. */
const pathOwner = (module) => (module.match(EXECUTOR) ?? module.match(HELPER))?.[1];

function helperOwners(modules) {
  const owners = new Map();
  for (const { module, provider } of modules.filter(({ module }) => HELPER.test(module))) {
    const name = path.basename(module);
    expect(pathOwner(module), module).toBe(provider);
    owners.set(name, [...(owners.get(name) || []), provider]);
  }
  return owners;
}

// The four web sessions promoted from staging for #2034 (1127). Their former
// manifest rows stay here as a stable fixture, so the duplicate-helper and
// shared-owner invariants keep exact coverage after promotion.
const PROMOTED_1127 = Object.freeze(["inner-ai-web", "venice-web", "poe-web", "v0-vercel-web"]);
const PROMOTED_1127_FIXTURE = Object.freeze([
  ["open-sse/executors/inner-ai-web.js", "inner-ai-web"],
  ["open-sse/executors/inner-ai-web/credential.js", "inner-ai-web"],
  ["open-sse/executors/inner-ai-web/discovery.js", "inner-ai-web"],
  ["open-sse/executors/inner-ai-web/errors.js", "inner-ai-web"],
  ["open-sse/executors/inner-ai-web/events.js", "inner-ai-web"],
  ["open-sse/executors/poe-web.js", "poe-web"],
  ["open-sse/executors/v0-vercel-web.js", "v0-vercel-web"],
  ["open-sse/executors/venice-web.js", "venice-web"],
  ["open-sse/executors/venice-web/credential.js", "venice-web"],
  ["open-sse/executors/venice-web/errors.js", "venice-web"],
  ["open-sse/executors/venice-web/events.js", "venice-web"],
  ["open-sse/executors/venice-web/session.js", "venice-web"],
  ["open-sse/providers/private/inner-ai-web.js", "inner-ai-web"],
  ["open-sse/providers/private/poe-web.js", "poe-web"],
  ["open-sse/providers/private/v0-vercel-web.js", "v0-vercel-web"],
  ["open-sse/providers/private/venice-web.js", "venice-web"],
].map(([module, provider]) => Object.freeze({ module, provider })));

// The two media providers promoted from staging for #2034 (1127). Their former
// manifest rows stay here as a stable fixture: each was a private definition
// owned by its own id, with no executor, and now lives in the registry and the
// media adapter maps it declares.
const PROMOTED_MEDIA_1127 = Object.freeze({
  renderhour: Object.freeze({ image: true, video: true, tts: true }),
  "adobe-firefly-api": Object.freeze({ image: true, video: true, tts: false }),
  "adobe-firefly-web": Object.freeze({ image: true, video: true, tts: false }),
});
const PROMOTED_MEDIA_1127_FIXTURE = Object.freeze([
  ["open-sse/providers/private/adobe-firefly-api.js", "adobe-firefly-api"],
  ["open-sse/providers/private/adobe-firefly-web.js", "adobe-firefly-web"],
  ["open-sse/providers/private/renderhour.js", "renderhour"],
].map(([module, provider]) => Object.freeze({ module, provider })));

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
    for (const modules of [manifest.modules, PROMOTED_1127_FIXTURE]) {
      const owners = helperOwners(modules);
      // No basename resolves to an owner: none of the helper names is a provider.
      for (const name of owners.keys()) expect(STAGED_PROVIDERS[path.basename(name, ".js")], name).toBeUndefined();
    }
    // Stable fixture of the last staged state with duplicate helper names (#2034, 1127).
    const owners = helperOwners(PROMOTED_1127_FIXTURE);
    for (const name of ["credential.js", "errors.js", "events.js"]) {
      expect(owners.get(name), name).toEqual(["inner-ai-web", "venice-web"]);
    }
    for (const { module, provider } of PROMOTED_1127_FIXTURE) expect(pathOwner(module) ?? provider, module).toBe(provider);
  });

  it("gives an executor and its private definition one shared owner entry", () => {
    const fixture = Object.groupBy(PROMOTED_1127_FIXTURE, ({ provider }) => provider);
    for (const id of PROMOTED_1127) {
      const modules = fixture[id].map(({ module }) => module);
      expect(modules, id).toContain(`open-sse/executors/${id}.js`);
      expect(modules, id).toContain(`open-sse/providers/private/${id}.js`);
    }
    // Live manifest: an owner with both an executor and a private definition lists both under one entry.
    for (const [id, entries] of Object.entries(byProvider)) {
      const modules = entries.map(({ module }) => module);
      if (fs.existsSync(path.join(root, `open-sse/executors/${id}.js`)) && fs.existsSync(path.join(root, `open-sse/providers/private/${id}.js`))) {
        expect(modules, id).toEqual(expect.arrayContaining([`open-sse/executors/${id}.js`, `open-sse/providers/private/${id}.js`]));
      }
    }
    expect(Object.keys(byProvider).sort()).toEqual(Object.keys(STAGED_PROVIDERS).sort());
  });

  it("registers the promoted 1127 web sessions and leaves none of their modules staged", () => {
    const catalog = new Set(REGISTRY.map(({ id }) => id));
    const staged = new Set(manifest.modules.map(({ module }) => module));
    for (const { module, provider } of PROMOTED_1127_FIXTURE) {
      const live = module.replace("open-sse/providers/private/", "open-sse/providers/registry/");
      expect(fs.existsSync(path.join(root, live)), live).toBe(true);
      expect(staged.has(module), module).toBe(false);
      expect(staged.has(live), live).toBe(false);
      expect(byProvider[provider], provider).toBeUndefined();
    }
    for (const id of PROMOTED_1127) {
      expect(fs.existsSync(path.join(root, `open-sse/providers/private/${id}.js`)), id).toBe(false);
      expect(STAGED_PROVIDERS[id], id).toBeUndefined();
      expect(catalog.has(id), id).toBe(true);
      expect(hasSpecializedExecutor(id), id).toBe(true);
      expect(REGISTERED_EXECUTOR_IDS, id).toContain(id);
      expect(REGISTRY.find((entry) => entry.id === id)?.transport?.executor, id).toBe(id);
    }
  });

  it("registers the promoted 1127 media providers on their declared routes and leaves none of their modules staged", async () => {
    const staged = new Set(manifest.modules.map(({ module }) => module));
    for (const { module, provider } of PROMOTED_MEDIA_1127_FIXTURE) {
      // The fixture row keeps the private-definition ownership rule exact.
      expect(PRIVATE.test(module), module).toBe(true);
      expect(path.basename(module, ".js"), module).toBe(provider);
      const live = module.replace("open-sse/providers/private/", "open-sse/providers/registry/");
      expect(fs.existsSync(path.join(root, module)), module).toBe(false);
      expect((await import(path.join(root, live))).default.id, live).toBe(provider);
      expect(staged.has(module), module).toBe(false);
      expect(staged.has(live), live).toBe(false);
      expect(byProvider[provider], provider).toBeUndefined();
      expect(STAGED_PROVIDERS[provider], provider).toBeUndefined();
    }
    for (const [id, routes] of Object.entries(PROMOTED_MEDIA_1127)) {
      const entry = REGISTRY.find((candidate) => candidate.id === id);
      expect(entry?.transport, id).toBeNull();
      expect(hasSpecializedExecutor(id), id).toBe(false);
      expect(REGISTERED_EXECUTOR_IDS, id).not.toContain(id);
      expect(getImageAdapter(id) !== null, `${id} image`).toBe(routes.image);
      expect(getVideoGenerationAdapter(id) !== null, `${id} video`).toBe(routes.video);
      expect(getTtsAdapter(id) !== null, `${id} tts`).toBe(routes.tts);
      // Neither goes through the /v1/videos job proxy.
      expect(getVideoConfig(id), id).toBeNull();
      expect(entry.serviceKinds, id).toEqual(Object.entries(routes).filter(([, on]) => on).map(([kind]) => kind));
    }
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
