import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: electronhub (#1178), eurouter (#1179), fastrouter (#1180), freeinference (#1183).
const CASES = [
  {
    id: "electronhub",
    alias: "electronhub",
    base: "https://api.electronhub.ai/v1",
    models: [],
    fetcher: true,
    extraFormats: [],
    notice: false,
  },
  {
    id: "eurouter",
    alias: "eurouter",
    base: "https://api.eurouter.ai/v1",
    models: [],
    fetcher: true,
    extraFormats: [],
    notice: true,
  },
  {
    id: "fastrouter",
    alias: "fastrouter",
    base: "https://api.fastrouter.ai/api/v1",
    models: [],
    fetcher: true,
    extraFormats: [],
    notice: false,
  },
  {
    id: "freeinference",
    alias: "freeinference",
    base: "https://freeinference.org/v1",
    models: [],
    fetcher: true,
    extraFormats: [],
    notice: false,
  },
];

describe.each(CASES)("$id provider", ({ id, alias, base, models, fetcher, extraFormats, notice }) => {
  const entry = REGISTRY.find((e) => e.id === id);

  it("registers an OpenAI-compatible transport", () => {
    expect(entry).toBeDefined();
    expect(entry.authType).toBe("apikey");
    expect(PROVIDERS[id]).toMatchObject({
      baseUrl: `${base}/chat/completions`,
      validateUrl: `${base}/models`,
      format: "openai",
      authType: "apikey",
    });
    expect((entry.transports ?? []).map((t) => t.format).filter((f) => f !== "openai")).toEqual(extraFormats);
    expect(Boolean(entry.display.notice)).toBe(notice);
  });

  it("seeds only sourced models", () => {
    expect((PROVIDER_MODELS[alias] ?? []).map((m) => m.id)).toEqual(models);
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
