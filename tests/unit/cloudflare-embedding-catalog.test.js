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
    const embeddingIds = (await buildModelsList(["embedding"])).map(({ id }) => id);
    const llmIds = (await buildModelsList(["llm"])).map(({ id }) => id);

    for (const id of CLOUDFLARE_EMBEDDINGS) {
      expect(embeddingIds).toContain(`cloudflare-ai/${id}`);
      expect(llmIds).not.toContain(`cloudflare-ai/${id}`);
    }
  });
});
