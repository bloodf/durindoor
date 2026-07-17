import { describe, expect, it } from "vitest";
import { getLocalEmbeddingProviders } from "../../src/app/(dashboard)/dashboard/media-providers/[kind]/localEmbeddingResolver.js";

describe("getLocalEmbeddingProviders", () => {
  it("returns ollama-local for a default connection", () => {
    const result = getLocalEmbeddingProviders(
      [{ owned_by: "ollama-local" }],
      [{ provider: "ollama-local" }]
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "ollama-local", name: "Ollama Local" });
  });

  it("maps a custom prefix back to ollama-local", () => {
    const result = getLocalEmbeddingProviders(
      [{ owned_by: "custom-prefix" }],
      [{ provider: "ollama-local", providerSpecificData: { prefix: "custom-prefix" } }]
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ollama-local");
  });

  it("ignores models whose owned_by is not a local Ollama alias or prefix", () => {
    const result = getLocalEmbeddingProviders(
      [{ owned_by: "openai" }, { owned_by: "voyage-ai" }],
      [{ provider: "ollama-local", providerSpecificData: { prefix: "localai" } }]
    );
    expect(result).toHaveLength(0);
  });

  it("deduplicates entries by provider id", () => {
    const result = getLocalEmbeddingProviders(
      [{ owned_by: "custom-prefix" }, { owned_by: "ollama-local" }],
      [{ provider: "ollama-local", providerSpecificData: { prefix: "custom-prefix" } }]
    );
    expect(result).toHaveLength(1);
  });
});
