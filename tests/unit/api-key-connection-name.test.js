import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  allocateBulkConnectionName,
  apiKeyConnectionNames,
  bulkUsedNameSet,
  buildAddApiKeyModalReset,
  defaultApiKeyConnectionName,
} from "../../src/app/(dashboard)/dashboard/providers/[id]/apiKeyConnectionName.js";

describe("API-key connection default names", () => {
  it("uses main for the first connection", () => {
    expect(defaultApiKeyConnectionName([])).toBe("main");
    expect(defaultApiKeyConnectionName(["custom"])).toBe("main");
  });

  it("increments subsequent defaults to avoid name-based overwrites", () => {
    expect(defaultApiKeyConnectionName(["main"])).toBe("main-2");
    expect(defaultApiKeyConnectionName(["main", "main-2"])).toBe("main-3");
  });

  it("uses the first unused main suffix for sparse or custom name sets", () => {
    expect(defaultApiKeyConnectionName(["main", "custom", "main-3"])).toBe("main-2");
    expect(defaultApiKeyConnectionName(["custom", "main-2", "main-3"])).toBe("main");
  });

  it("keeps count fallback for older callers", () => {
    expect(defaultApiKeyConnectionName(1)).toBe("main-2");
    expect(defaultApiKeyConnectionName(undefined)).toBe("main");
  });

  it("scopes names to one provider's apikey connections (the DB collision key is provider-local)", () => {
    // #6499 — createProviderConnection collides on (provider, authType=apikey,
    // name). Callers filter connections to the CURRENT provider before deriving
    // a default; another provider's "main" must not force "main-2" here, and
    // non-apikey rows on this provider must not either.
    const allConnections = [
      { provider: "openai", authType: "apikey", name: "main" },
      { provider: "openai", authType: "oauth", name: "main-2" },
      { provider: "openai", authType: "cookie", name: "main-3" },
      { provider: "anthropic", authType: "apikey", name: "main" },
    ];
    const providerFilter = (provider) => allConnections.filter((c) => c.provider === provider);

    // Current provider "openai": one apikey "main" → next default is "main-2".
    expect(apiKeyConnectionNames(providerFilter("openai"))).toEqual(["main"]);
    expect(defaultApiKeyConnectionName(apiKeyConnectionNames(providerFilter("openai")))).toBe("main-2");

    // A provider with no apikey connections gets "main" again even though
    // other providers already use it — the collision scope is provider-local.
    expect(defaultApiKeyConnectionName(apiKeyConnectionNames(providerFilter("groq")))).toBe("main");
  });
});

describe("bulk-add collision-free name allocation (never overwrite)", () => {
  it("assigns Key 1..N by gap-fill when nothing exists (all-new input)", () => {
    const used = bulkUsedNameSet([]);
    const names = ["Key", "Key", "Key"].map((b) => allocateBulkConnectionName(b, used));
    expect(names).toEqual(["Key 1", "Key 2", "Key 3"]);
  });

  it("never allocates a name that collides with an existing one (duplicate base)", () => {
    // Every pasted line base is "Key"; Key 1..3 already saved. The allocator
    // must skip all taken indices — a collision here would overwrite a key.
    const used = bulkUsedNameSet(["Key 1", "Key 2", "Key 3"]);
    const names = ["Key", "Key"].map((b) => allocateBulkConnectionName(b, used));
    expect(names).toEqual(["Key 4", "Key 5"]);
  });

  it("gap-fills the smallest free index around existing names", () => {
    const used = bulkUsedNameSet(["Key 3", "Key 5"]);
    const names = ["Key", "Key", "Key"].map((b) => allocateBulkConnectionName(b, used));
    expect(names).toEqual(["Key 1", "Key 2", "Key 4"]);
    expect(names).not.toContain("Key 3");
    expect(names).not.toContain("Key 5");
  });

  it("mixes existing + new bases, continuing past the highest taken index (mixed)", () => {
    const used = bulkUsedNameSet(["Key 1", "Key 2", "Prod 1"]);
    const names = ["Key", "Prod", "Key"].map((b) => allocateBulkConnectionName(b, used));
    expect(names).toEqual(["Key 3", "Prod 2", "Key 4"]);
  });

  it("keeps within-batch names unique for the same base", () => {
    const used = bulkUsedNameSet(["Key 1"]);
    const names = ["Key", "Key", "Key"].map((b) => allocateBulkConnectionName(b, used));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["Key 2", "Key 3", "Key 4"]);
  });

  it("matches case-insensitively and tolerates malformed existingNames", () => {
    const used = bulkUsedNameSet(null);
    expect(allocateBulkConnectionName("Key", used)).toBe("Key 1");
    const used2 = bulkUsedNameSet(["key 1"]);
    expect(allocateBulkConnectionName("Key", used2)).toBe("Key 2");
  });
});

// Bulk-add never-overwrite guarantee lives in the repo guard: a name collision
// under requireNewName must reject BEFORE any upsert, leaving the saved key
// untouched. Uses a real temp SQLite DB (same pattern as
// connections-repo-encryption.test.js) so encryption/row-mapping/transaction
// behave exactly as production.
describe("bulk-add repo guard: requireNewName rejects name collision without overwrite", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-bulk-guard-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    vi.resetModules();
  });

  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  async function freshRepo() {
    return import("../../src/lib/db/repos/connectionsRepo.js");
  }

  it("rejects a colliding apikey name and leaves the existing key unchanged", async () => {
    const repo = await freshRepo();
    await repo.createProviderConnection({ provider: "openai", authType: "apikey", name: "Key 1", apiKey: "sk-ORIGINAL" });

    await expect(
      repo.createProviderConnection(
        { provider: "openai", authType: "apikey", name: "Key 1", apiKey: "sk-REPLACEMENT" },
        { requireNewName: true }
      )
    ).rejects.toMatchObject({ code: "PROVIDER_CONNECTION_NAME_CONFLICT" });

    // Never-overwrite: the saved connection still returns the original key.
    const all = await repo.getProviderConnections({ provider: "openai" });
    const saved = all.filter((c) => c.authType === "apikey");
    expect(saved).toHaveLength(1);
    expect(saved[0].apiKey).toBe("sk-ORIGINAL");
  });

  it("inserts when requireNewName and the name is free", async () => {
    const repo = await freshRepo();
    const conn = await repo.createProviderConnection(
      { provider: "openai", authType: "apikey", name: "Key 2", apiKey: "sk-NEW" },
      { requireNewName: true }
    );
    expect(conn.name).toBe("Key 2");
    const all = await repo.getProviderConnections({ provider: "openai" });
    expect(all.filter((c) => c.authType === "apikey")).toHaveLength(1);
  });
});

// Route-level: POST /api/providers forwards bulk createOnly -> requireNewName
// and single dashboard adds -> createOnly, mapping both repo conflict codes
// (PROVIDER_CONNECTION_NAME_CONFLICT / PROVIDER_CONNECTION_ALREADY_EXISTS) to
// 409. @/models is mocked (isolated via resetModules + doUnmock) so no broad
// provider setup is needed; the mock records the create options for the
// forwarding assertion.
describe("POST /api/providers createOnly plumbing", () => {
  function makeRequest(body) {
    return { json: async () => body };
  }

  async function importRouteWithModels(createImpl, captured) {
    vi.resetModules();
    vi.doMock("@/models", () => ({
      getProviderConnections: async () => [],
      getProviderNodeById: async () => null,
      getProviderNodes: async () => [],
      getProxyPoolById: async () => null,
      createProviderConnection: async (data, opts) => {
        captured.data = data;
        captured.opts = opts;
        return createImpl(data, opts);
      },
    }));
    return import("../../src/app/api/providers/route.js");
  }

  afterEach(() => {
    vi.doUnmock("@/models");
    vi.resetModules();
  });

  it("maps a repo name conflict to 409 without overwriting", async () => {
    const captured = {};
    const route = await importRouteWithModels(() => {
      const err = new Error('An API key named "Key 1" already exists for this provider');
      err.code = "PROVIDER_CONNECTION_NAME_CONFLICT";
      throw err;
    }, captured);

    const res = await route.POST(makeRequest({
      provider: "openai", apiKey: "sk-REPLACEMENT", name: "Key 1", createOnly: true,
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("PROVIDER_CONNECTION_NAME_CONFLICT");
    // Forwarding: createOnly:true reached the repo as requireNewName:true.
    expect(captured.opts).toEqual({ requireNewName: true });
  });

  it("forwards createOnly:true (dashboard single add) to the repo", async () => {
    const captured = {};
    const route = await importRouteWithModels((data) => ({ ...data, id: "c1" }), captured);

    const res = await route.POST(makeRequest({
      provider: "openai", apiKey: "sk-NEW", name: "Key 2",
    }));
    expect(res.status).toBe(201);
    expect(captured.opts).toEqual({ createOnly: true });
  });

  it("maps a dashboard duplicate (PROVIDER_CONNECTION_ALREADY_EXISTS) to 409", async () => {
    const route = await importRouteWithModels(() => {
      const err = new Error('A connection named "Key 1" already exists for this provider');
      err.code = "PROVIDER_CONNECTION_ALREADY_EXISTS";
      throw err;
    }, {});

    const res = await route.POST(makeRequest({
      provider: "openai", apiKey: "sk-DUP", name: "Key 1",
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("PROVIDER_CONNECTION_ALREADY_EXISTS");
  });
});

describe("Add API-key modal reset guard", () => {
  it("returns fresh default state only on closed→open transition", () => {
    expect(buildAddApiKeyModalReset(false, true, ["main"], "us-east-1")).toMatchObject({
      formData: {
        name: "main-2",
        apiKey: "",
        defaultModel: "",
        priority: 1,
        proxyPoolId: "__none__",
        ollamaHostUrl: "",
      },
      azureData: {
        azureEndpoint: "",
        apiVersion: "2024-10-01-preview",
        deployment: "",
        organization: "",
      },
      accountIdData: { accountId: "" },
      region: "us-east-1",
    });
  });

  it("does not reset when not transitioning from closed to open", () => {
    expect(buildAddApiKeyModalReset(true, true, ["main"], "us-east-1")).toBeNull();
    expect(buildAddApiKeyModalReset(true, false, ["main"], "us-east-1")).toBeNull();
    expect(buildAddApiKeyModalReset(false, false, ["main"], "us-east-1")).toBeNull();
  });
});
