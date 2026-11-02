import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: tokenreply (#1239), uc-direct (#1242), unifically (#1243), unorouter (#1244).
const CASES = [
  {
    "id": "tokenreply",
    "alias": "tokenreply",
    "chat": "https://api.tokenreply.com/v1/chat/completions",
    "val": "https://api.tokenreply.com/v1/models",
    "models": [],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "uc-direct",
    "alias": "ucd",
    "chat": "https://api.uncensored.com/api/v1/chat/completions",
    "val": "https://api.uncensored.com/api/v1/models",
    "models": [],
    "fetcher": true,
    "xkey": true
  },
  {
    "id": "unifically",
    "alias": "unifically",
    "chat": "https://api.unifically.com/v1/chat/completions",
    "val": "https://api.unifically.com/v1/models?category=llm",
    "models": [],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "unorouter",
    "alias": "unorouter",
    "chat": "https://api.unorouter.com/v1/chat/completions",
    "val": "https://api.unorouter.com/v1/models",
    "models": [],
    "fetcher": true,
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
