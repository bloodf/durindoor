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
