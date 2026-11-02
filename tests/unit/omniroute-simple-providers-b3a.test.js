import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: openference-api (#1221), openvecta (#1222), opper (#1223), poixe-ai (#1226).
const CASES = [
  {
    "id": "openference-api",
    "alias": "ofa",
    "chat": "https://api.openference.com/v1/chat/completions",
    "val": "https://api.openference.com/v1/models",
    "models": [
      "GLM-5.2",
      "Qwen3.8 27b",
      "Llama 3.2 3B"
    ],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "openvecta",
    "alias": "openvecta",
    "chat": "https://api.openvecta.com/v1/chat/completions",
    "val": "https://api.openvecta.com/v1/models",
    "models": [
      "glm-4.7-flash",
      "claude-sonnet-4.6",
      "deepseek-v4-flash",
      "gpt-oss-120b",
      "gemma-4-31b",
      "kimi-k2.6",
      "llama-3.3-70b-instruct",
      "llama-4-maverick",
      "nemotron-3-super-120b"
    ],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "opper",
    "alias": "opper",
    "chat": "https://api.opper.ai/v3/compat/chat/completions",
    "val": "https://api.opper.ai/v3/compat/models",
    "models": [],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "poixe-ai",
    "alias": "poixe-ai",
    "chat": "https://api.poixe.com/v1/chat/completions",
    "val": "https://api.poixe.com/v1/models",
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
