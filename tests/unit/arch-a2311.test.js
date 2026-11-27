import { describe, expect, it, vi } from "vitest";
import { UnsupportedOmniRouteWebSessionExecutor } from "../../open-sse/executors/unsupported-websession.js";
import { HuggingChatExecutor } from "../../open-sse/executors/huggingchat.js";

describe("staged web session stub", () => {
  it("fails closed even when session dispatch is enabled", async () => {
    const dispatch = vi.spyOn(HuggingChatExecutor.prototype, "execute");
    try {
      const executor = new UnsupportedOmniRouteWebSessionExecutor("huggingchat");
      const result = await executor.execute({ credentials: { providerSpecificData: { enableSessionDispatch: true } } });
      expect(result.response.status).toBe(501);
      expect((await result.response.json()).error.type).toBe("provider_port_pending");
      expect(() => executor.buildUrl()).toThrow();
      expect(() => executor.buildHeaders()).toThrow();
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      dispatch.mockRestore();
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { REGISTERED_EXECUTOR_IDS, getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import executorManifest from "../../open-sse/executors/staged.json";
import { STAGED_PROVIDERS } from "../../open-sse/providers/staged.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("provider staging", () => {
  it("covers every unreachable executor in the existing module inventory", () => {
    // Owners, not basenames: nested helpers (credential.js, errors.js, events.js)
    // and a private definition share their provider's canonical ID.
    const owners = [...new Set(executorManifest.modules.map(({ module, provider }) => {
      expect(provider, module).toBeTruthy();
      return provider;
    }))].sort();
    expect(Object.keys(STAGED_PROVIDERS).sort()).toEqual(owners);
    for (const [id, entry] of Object.entries(STAGED_PROVIDERS)) {
      expect(entry.staged, id).toBe(true);
      expect(entry.reason, id).toBeTruthy();
      expect(hasSpecializedExecutor(id), id).toBe(false);
      expect(executorManifest.modules.some(({ provider }) => provider === id), id).toBe(true);
    }
  });

  // Provider definitions under `dir`: modules with a default export.
  const definitionFiles = (dir) => fs.readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
    .filter((entry) => /export\s+default\b/.test(fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8")))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));

  // The last private definitions, promoted to the registry for #2034 (1127). A
  // stable fixture: the same scan must find each one in the registry, so an
  // empty private directory is proven by a scan that does find definitions.
  const PROMOTED_PRIVATE_1127 = Object.freeze({
    "open-sse/providers/private/renderhour.js": "renderhour",
    "open-sse/providers/private/adobe-firefly-api.js": "adobe-firefly-api",
  });

  it("promotes the 1127 media definitions to the registry and leaves no stale private copy", () => {
    const registryFiles = definitionFiles("open-sse/providers/registry");
    const catalog = new Set(REGISTRY.map(({ id }) => id));
    for (const [file, id] of Object.entries(PROMOTED_PRIVATE_1127)) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(false);
      expect(registryFiles, file).toContain(file.replace("/private/", "/registry/"));
      expect(catalog.has(id), id).toBe(true);
      expect(STAGED_PROVIDERS[id], id).toBeUndefined();
      expect(executorManifest.modules.some(({ provider }) => provider === id), id).toBe(false);
    }
  });

  it("covers private provider definitions and rejects staged registry entries", async () => {
    const files = definitionFiles("open-sse/providers/private");
    // Each staged private definition left must be declared; none remain after 1127.
    expect(files).toEqual(executorManifest.modules.map(({ module }) => module).filter((module) => module.startsWith("open-sse/providers/private/")));
    const catalog = new Set(REGISTRY.flatMap(({ id, alias, aliases }) => [id, alias, ...(aliases || [])]).filter(Boolean));
    for (const file of files) {
      const { default: definition } = await import(path.join(root, file));
      const id = definition?.id;
      expect(id, file).toBeTruthy();
      expect(STAGED_PROVIDERS[id]?.staged, file).toBe(true);
      expect(executorManifest.modules.find(({ module }) => module === file)?.provider, file).toBe(id);
      expect(catalog.has(id), file).toBe(false);
    }
    for (const entry of REGISTRY) expect(entry.staged, entry.id).not.toBe(true);
  });

  it("registers executor ids in the provider catalog", () => {
    const catalog = new Set(REGISTRY.flatMap(({ id, alias, aliases }) => [id, alias, ...(aliases || [])]).filter(Boolean));
    const canonicalExecutors = new Set(REGISTERED_EXECUTOR_IDS.filter((id) => catalog.has(id)).map(getExecutor));
    // This legacy alias has a separate instance of the catalog provider executor.
    expect(getExecutor("copilot").constructor).toBe(getExecutor("copilot-web").constructor);
    const missing = REGISTERED_EXECUTOR_IDS.filter((id) => id !== "copilot" && !catalog.has(id) && !canonicalExecutors.has(getExecutor(id)));
    expect(missing).toEqual([]);
  });
});
