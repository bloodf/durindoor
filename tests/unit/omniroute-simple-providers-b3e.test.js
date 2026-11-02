import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: zylo-api (#1254).
const CASES = [
  {
    "id": "zylo-api",
    "alias": "zylo",
    "chat": "https://api.zyloai.net/v1/chat/completions",
    "val": "https://api.zyloai.net/v1/models",
    "models": [],
    "fetcher": false,
    "xkey": false
  }
];

describe.each(CASES)("$id provider", ({ id, alias, chat, val, models, fetcher, ua, xkey }) => {
  const entry = REGISTRY.find((e) => e.id === id);

  it("registers an API-key OpenAI-compatible transport", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(PROVIDERS[id]).toMatchObject({ baseUrl: chat, validateUrl: val, format: "openai", authType: "apikey" });
    if (ua) expect(PROVIDERS[id].headers["User-Agent"]).toBe(ua);
    if (xkey) expect(PROVIDERS[id].auth).toMatchObject({ header: "x-api-key", scheme: "raw" });
  });

  it("seeds only sourced models", () => {
    expect((PROVIDER_MODELS[alias] ?? []).map((m) => m.id)).toEqual(models);
    expect(PROVIDER_MEDIA[id].serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MEDIA[id].modelsFetcher ?? null).toEqual(fetcher ? { url: val, type: "openai" } : null);
  });

  it("resolves its alias", () => {
    expect(resolveProviderAlias(alias)).toBe(id);
  });
});

it("keeps every registry id unique", () => {
  const ids = REGISTRY.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
});
