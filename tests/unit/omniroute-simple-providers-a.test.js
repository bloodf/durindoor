import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: meganova-ai (#1203), mixlayer (#1204), naga-ac (#1209), nara (#1211).
const CASES = [
  { id: "meganova-ai", alias: "meganova-ai", base: "https://api.meganova.ai/v1", authType: "apikey", models: [], fetcher: true },
  { id: "mixlayer", alias: "mixlayer", base: "https://models.mixlayer.ai/v1", authType: "apikey", models: ["qwen/qwen3.5-4b-free"], fetcher: true },
  { id: "naga-ac", alias: "naga", base: "https://api.naga.ac/v1", authType: "optional", models: [], fetcher: true },
  {
    id: "nara",
    alias: "nara",
    base: "https://router.bynara.id/v1",
    authType: "apikey",
    models: [
      "agnes-2.0-flash",
      "agnes-2.5-flash",
      "laguna-s-2.1",
      "minimax-m3-free",
      "mistral-large",
      "mistral-medium-3-5",
      "qwen3.8-27b",
      "stepfun-3.7-flash",
    ],
    fetcher: false,
  },
];

describe.each(CASES)("$id provider", ({ id, alias, base, authType, models, fetcher }) => {
  const entry = REGISTRY.find((e) => e.id === id);

  it("registers an OpenAI-compatible transport", () => {
    expect(entry).toBeDefined();
    expect(entry.authType).toBe(authType);
    expect(PROVIDERS[id]).toMatchObject({
      baseUrl: `${base}/chat/completions`,
      validateUrl: `${base}/models`,
      format: "openai",
      authType,
    });
  });

  it("seeds only sourced models", () => {
    expect((PROVIDER_MODELS[id] ?? []).map((m) => m.id)).toEqual(models);
    expect(PROVIDER_MEDIA[id].serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MEDIA[id].modelsFetcher ?? null).toEqual(
      fetcher ? { url: `${base}/models`, type: "openai" } : null,
    );
  });

  it("resolves its alias", () => {
    expect(resolveProviderAlias(alias)).toBe(id);
  });
});

it("keeps every registry id unique", () => {
  const ids = REGISTRY.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
});
