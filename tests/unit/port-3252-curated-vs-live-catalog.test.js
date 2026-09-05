import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

// Port of 9router PR #3252 (fix(models): curated custom-provider model list
// suppresses live catalog). Port #3623 supersedes this contract for
// `openai-compatible-*` and `anthropic-compatible-*` ids: compatible nodes no
// longer perform public live discovery. Port #766 supersedes the remaining
// case for registry OpenAI-style `modelsFetcher` providers (hcnsec): a saved
// curated custom model no longer suppresses credential-scoped live discovery
// — the live catalog is unioned instead, same as any other modelsFetcher
// provider without an explicit `enabledModels` allowlist.

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

import * as localDb from "@/lib/localDb";
import * as disabledModelsDb from "@/lib/disabledModelsDb";

function stubConnections(connections) {
  localDb.getProviderConnections.mockResolvedValue(connections);
  localDb.getCombos.mockResolvedValue([]);
  localDb.getCustomModels.mockResolvedValue([]);
  localDb.getModelAliases.mockResolvedValue([]);
  disabledModelsDb.getDisabledModels.mockResolvedValue({});
}

const providerId = "hcnsec";

function stubbedConn(prefix, port) {
  return {
    id: "conn-hn",
    provider: providerId,
    apiKey: `sk-local-${port}`,
    isActive: true,
    providerSpecificData: { baseUrl: `http://127.0.0.1:${port}`, prefix },
  };
}

describe("port #3252 — curated custom-provider models must not permanently suppress live catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("still fetches the live catalog when no custom models are configured", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "keep-me" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    stubConnections([stubbedConn("hn", 11434)]);

    const models = await buildModelsList([LLM_KIND]);

    expect(fetchSpy).toHaveBeenCalled();
    expect(models.some((m) => m.id === "hn/keep-me")).toBe(true);
  });

  it("does NOT suppress the live catalog when the only custom-model row is of a different kind", async () => {
    // Regression for the upstream bug: a bare alias match (regardless of
    // kind) used to set hasConfiguredCustomModels=true and permanently
    // block live discovery, even though no LLM-kind custom model exists.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "keep-me" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    stubConnections([stubbedConn("hn", 11435)]);
    localDb.getCustomModels.mockResolvedValue([
      { id: "embed-only", providerAlias: "hn", kind: "embedding" },
    ]);

    const models = await buildModelsList([LLM_KIND]);

    expect(fetchSpy).toHaveBeenCalled();
    expect(models.some((m) => m.id === "hn/keep-me")).toBe(true);
  });

  it("unions the live catalog when a matching-kind curated model list is configured", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "upstream-model" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    stubConnections([stubbedConn("hn", 11436)]);
    localDb.getCustomModels.mockResolvedValue([
      { id: "curated-one", providerAlias: "hn", kind: "llm" },
    ]);

    const models = await buildModelsList([LLM_KIND]);

    expect(fetchSpy).toHaveBeenCalled();
    const hnIds = models.map((m) => m.id).filter((id) => id.startsWith("hn/"));
    expect(hnIds).toEqual(expect.arrayContaining(["hn/curated-one", "hn/upstream-model"]));
  });
});
