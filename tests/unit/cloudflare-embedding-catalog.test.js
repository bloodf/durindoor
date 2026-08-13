import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

import * as localDb from "@/lib/localDb";

import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";

const CLOUDFLARE_EMBEDDINGS = [
  "@cf/baai/bge-m3",
  "@cf/qwen/qwen3-embedding-0.6b",
  "@cf/pfnet/plamo-embedding-1b",
  "@cf/baai/bge-small-en-v1.5",
  "@cf/baai/bge-base-en-v1.5",
  "@cf/google/embeddinggemma-300m",
  "@cf/baai/bge-large-en-v1.5",
];

describe("Cloudflare embedding catalog", () => {
  it("advertises embedding models through /v1/models/embedding, not the LLM catalog", async () => {
    // Upstream #3267: healthy empty DBs expose no credentialed built-ins, so
    // exercise kind filtering through an explicitly saved Cloudflare route.
    localDb.getProviderConnections.mockResolvedValue([{
      id: "conn-cloudflare",
      provider: "cloudflare-ai",
      isActive: true,
      providerSpecificData: { enabledModels: CLOUDFLARE_EMBEDDINGS },
    }]);
    const embeddingIds = (await buildModelsList(["embedding"])).map(({ id }) => id);
    const llmIds = (await buildModelsList(["llm"])).map(({ id }) => id);

    for (const id of CLOUDFLARE_EMBEDDINGS) {
      // Saved Cloudflare routes expose registry uiAlias `cf`; provider routing
      // still resolves that alias to the `cloudflare-ai` embedding adapter.
      expect(embeddingIds).toContain(`cf/${id}`);
      expect(llmIds).not.toContain(`cf/${id}`);
    }
  });
});
