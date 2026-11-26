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
    const ids = executorManifest.modules.map(({ module }) => path.basename(module, ".js")).sort();
    expect(Object.keys(STAGED_PROVIDERS).sort()).toEqual(ids);
    for (const [id, entry] of Object.entries(STAGED_PROVIDERS)) {
      expect(entry.staged, id).toBe(true);
      expect(entry.reason, id).toBeTruthy();
      expect(hasSpecializedExecutor(id), id).toBe(false);
    }
  });

  it("covers private provider definitions and rejects staged registry entries", () => {
    const privateDir = path.join(root, "open-sse/providers/private");
    const definitions = fs.readdirSync(privateDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
      .filter((entry) => /export\s+default\b/.test(fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8")))
      .map((entry) => path.basename(entry.name).replace(/\.[cm]?js$/, ""));
    for (const id of definitions) expect(STAGED_PROVIDERS[id]?.staged, id).toBe(true);
    for (const entry of REGISTRY) expect(entry.staged, entry.id).not.toBe(true);
  });
});

  it("registers executor ids in the provider catalog", () => {
    const catalog = new Set(REGISTRY.flatMap(({ id, alias, aliases }) => [id, alias, ...(aliases || [])]).filter(Boolean));
    const canonicalExecutors = new Set(REGISTERED_EXECUTOR_IDS.filter((id) => catalog.has(id)).map(getExecutor));
    // This legacy alias has a separate instance of the catalog provider executor.
    expect(getExecutor("copilot").constructor).toBe(getExecutor("copilot-web").constructor);
    const missing = REGISTERED_EXECUTOR_IDS.filter((id) => id !== "copilot" && !catalog.has(id) && !canonicalExecutors.has(getExecutor(id)));
    expect(missing).toEqual([]);
  });

