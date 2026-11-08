import { beforeEach, describe, expect, it, vi } from "vitest";

const runModelAutoSync = vi.hoisted(() => vi.fn(async () => [{ providerId: "openai", status: "synced" }]));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getProviderConnections: vi.fn(async () => [{ id: "c1", provider: "openai", isActive: true }]),
  getSyncedModelCatalogs: vi.fn(async () => ({}))
}));
vi.mock("@/lib/modelAutoSync/runner.js", async (importOriginal) => ({
  ...(await importOriginal()),
  runModelAutoSync,
  getPrunedModelReferences: vi.fn(async () => ({ combos: { daily: ["openai/gpt-5"] }, aliases: {} }))
}));

vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({
  getSharedModelMetadata: vi.fn(async () => null)
}));

import { getSharedModelMetadata } from "@/lib/modelAutoSync/sharedMetadata.js";
import { getDeclaredModelCapabilities } from "../../src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js";
import * as localDb from "@/lib/localDb";
import { GET, POST } from "../../src/app/api/models/auto-sync/route.js";

const catalog = {
  syncedAt: "2026-09-23T12:00:00.000Z",
  lastAttemptAt: "2026-09-23T12:00:00.000Z",
  error: null,
  newModelIds: ["gpt-9"],
  removedModelIds: ["gpt-5"],
  models: [{ id: "gpt-9", name: "GPT 9", kind: "llm" }]
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/models/auto-sync", () => {
  it("GET reports status, the effective list and pruned combo members", async () => {
    localDb.getSyncedModelCatalogs.mockResolvedValue({ openai: catalog });
    const res = await GET(new Request("http://localhost/api/models/auto-sync?provider=openai"));
    const data = await res.json();
    expect(data.intervalHours).toBe(24);
    expect(data.providers.openai).toMatchObject({
      eligible: true,
      enabled: true,
      newModelIds: ["gpt-9"],
      removedModelIds: ["gpt-5"],
      models: [{ id: "gpt-9", name: "GPT 9", kind: "llm" }]
    });
    expect(data.prunedReferences.combos).toEqual({ daily: ["openai/gpt-5"] });
  });

  it.each([
    ["explicit false", { vision: false }],
    ["explicit true", { vision: true }],
    ["empty snapshot", {}],
    ["missing snapshot with provenance", undefined],
  ])("GET preserves declaration provenance for %s", async (_label, snapshot) => {
    const source = "https://models.dev/api.json";
    const fetchedAt = Date.parse(catalog.syncedAt);
    localDb.getSettings.mockResolvedValue({});
    getSharedModelMetadata.mockResolvedValue({
      source, fetchedAt,
      providers: { openai: { "future-model": { vision: true, tools: true } } },
    });
    localDb.getSyncedModelCatalogs.mockResolvedValue({ openai: {
      ...catalog,
      models: [{
        id: "future-model", name: "Future model", kind: "llm",
        capabilities: { vision: true, tools: true },
        ...(snapshot === undefined ? {} : { discoveredCapabilities: snapshot }),
        metadataSources: { catalog: "default", provider: false, shared: true },
      }],
    } });

    const res = await GET(new Request("http://localhost/api/models/auto-sync?provider=openai"));
    expect(res.status).toBe(200);
    const data = await res.json();
    const [row] = data.providers.openai.models;
    const declarations = snapshot ?? {};
    const hasDeclaration = Object.keys(declarations).length > 0;
    expect(row.discoveredCapabilities).toEqual(declarations);
    expect(row.capabilities).toMatchObject({ vision: true, tools: true, ...declarations });
    expect(row.metadataSources).toEqual({
      catalog: "default", catalogSource: null,
      provider: hasDeclaration, shared: true,
      sharedEntries: [{ modelId: "future-model", source, fetchedAt }],
      sharedSource: source, sharedFetchedAt: fetchedAt,
      ...(hasDeclaration ? { providerFetchedAt: catalog.syncedAt } : {}),
    });
    expect(getDeclaredModelCapabilities(row)).toEqual(declarations);
    expect(getDeclaredModelCapabilities(row)).not.toHaveProperty("tools");
  });

  it("GET returns no effective list while auto-update is off", async () => {
    localDb.getSettings.mockResolvedValue({ modelAutoSyncProviders: { openai: false } });
    localDb.getSyncedModelCatalogs.mockResolvedValue({ openai: catalog });
    const data = await (await GET(new Request("http://localhost/api/models/auto-sync?provider=openai"))).json();
    expect(data.providers.openai.enabled).toBe(false);
    expect(data.providers.openai.models).toBeNull();
  });

  it("POST syncs one provider now and rejects providers without a list API", async () => {
    const ok = await POST(new Request("http://localhost/api/models/auto-sync", { method: "POST", body: JSON.stringify({ provider: "openai" }) }));
    expect(ok.status).toBe(200);
    expect(runModelAutoSync).toHaveBeenCalledWith({ providerIds: ["openai"], force: true });
    const bad = await POST(new Request("http://localhost/api/models/auto-sync", { method: "POST", body: JSON.stringify({ provider: "openrouter" }) }));
    expect(bad.status).toBe(400);
  });
});
