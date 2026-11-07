import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: navy (#1212), ofoxai (#1216), onomeo (#1218), openadapter (#1219).
const CASES = [
  {
    "id": "navy",
    "alias": "navy",
    "chat": "https://api.navy/v1/chat/completions",
    "val": "https://api.navy/v1/models",
    "models": [
      "llama-3.3-70b-instruct",
      "gemma-4-31b-it",
      "deepseek-v4-flash",
      "deepseek-chat",
      "mistral-small-latest",
      "llama-4-scout"
    ],
    "fetcher": true,
    "ua": "DurinDoor/1.0",
    "xkey": false
  },
  {
    "id": "ofoxai",
    "alias": "ofoxai",
    "chat": "https://api.ofox.ai/v1/chat/completions",
    "val": "https://api.ofox.ai/v1/models",
    "models": [],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "onomeo",
    "alias": "onomeo",
    "chat": "https://onomeo.com/v1/chat/completions",
    "val": "https://onomeo.com/v1/models",
    "models": [],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "openadapter",
    "alias": "oad",
    "chat": "https://api.openadapter.in/v1/chat/completions",
    "val": "https://api.openadapter.in/v1/models",
    "models": [
      "glm-4.7"
    ],
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
