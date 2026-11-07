import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: publicai (#1229), regolo (#1230), routeway (#1231), token-kiosk (#1238).
const CASES = [
  {
    "id": "publicai",
    "alias": "publicai",
    "chat": "https://api.publicai.co/v1/chat/completions",
    "val": "https://api.publicai.co/v1/models",
    "models": [
      "swiss-ai/apertus-70b-instruct",
      "swiss-ai/Apertus-8B-Instruct-2509",
      "aisingapore/Qwen-SEA-LION-v4-32B-IT",
      "aisingapore/Gemma-SEA-LION-v4-27B-IT",
      "allenai/Olmo-3-32B-Think",
      "allenai/Olmo-3-7B-Instruct",
      "utter-project/EuroLLM-22B-Instruct-2512"
    ],
    "fetcher": false,
    "xkey": false
  },
  {
    "id": "regolo",
    "alias": "regolo",
    "chat": "https://api.regolo.ai/v1/chat/completions",
    "val": "https://api.regolo.ai/v1/models",
    "models": [],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "routeway",
    "alias": "routeway",
    "chat": "https://api.routeway.ai/v1/chat/completions",
    "val": "https://api.routeway.ai/v1/models",
    "models": [
      "llama-3.3-70b-instruct:free",
      "nemotron-3-nano-30b-a3b:free",
      "nemotron-nano-9b-v2:free",
      "step-3.7-flash:free",
      "step-3.5-flash:free",
      "laguna-m.1:free",
      "laguna-xs.2:free",
      "llama-3.2-3b-instruct:free"
    ],
    "fetcher": true,
    "ua": "Mozilla/5.0 DurinDoor/1.0",
    "xkey": false
  },
  {
    "id": "token-kiosk",
    "alias": "tk",
    "chat": "https://agent-router.gaib.ai/v1/chat/completions",
    "val": "https://agent-router.gaib.ai/v1/models",
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
