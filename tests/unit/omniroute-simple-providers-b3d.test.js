import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: void-ai (#1245), xkiro (#1248), yolo-auto (#1250), zerolimitai (#1253).
const CASES = [
  {
    "id": "void-ai",
    "alias": "void-ai",
    "chat": "https://api.voidai.app/v1/chat/completions",
    "val": "https://api.voidai.app/v1/models",
    "models": [],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "xkiro",
    "alias": "xkiro",
    "chat": "https://api.xkiro.com/v1/chat/completions",
    "val": "https://api.xkiro.com/v1/models",
    "models": [
      "qwen/qwen3-vl-plus:free",
      "sensenova/sensenova-6.8-flash-lite",
      "minimax/minimax-m2.7:free",
      "minimax/minimax-m2.7-highspeed:free",
      "minimax/minimax-m2.5:free",
      "minimax/minimax-m3:free",
      "minimax/minimax-m2.1-highspeed:free",
      "minimax/minimax-m2.5-highspeed:free",
      "minimax/minimax-m2.1:free",
      "minimax/minimax-m2:free",
      "qwen/qwen3.5-flash:free",
      "qwen/qwen3.6-plus:free",
      "qwen/qwen3.5-397b-a17b:free",
      "qwen/qwen3.5-omni-flash:free",
      "mistralai/mistral-large-2512",
      "mistralai/mistral-medium-3.5",
      "mistralai/mistral-small-2603",
      "mistralai/codestral-2508",
      "mistralai/devstral-medium",
      "mistralai/ministral-8b",
      "mistralai/ministral-3b",
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v3.2",
      "deepseek/deepseek-chat-v3.1",
      "qwen/qwen3.7-plus:free",
      "mistralai/ministral-14b",
      "qwen/qwen3.6-max-preview:free",
      "qwen/qwen3.5-plus:free",
      "qwen/qwen3.5-omni-plus:free",
      "deepseek/deepseek-v4-flash",
      "sensenova/sensenova-6.7-flash-lite",
      "qwen/qwen3.8-max:free",
      "qwen/qwen3.7-max:free",
      "qwen/qwen3.6-27b:free",
      "qwen/qwen3.6-35b-a3b:free",
      "qwen/qwen3-max:free",
      "qwen/qwen3-coder-plus:free",
      "qwen/qwen-plus-2025-07-28:free",
      "qwen/qwen3-omni-flash:free"
    ],
    "fetcher": false,
    "xkey": false
  },
  {
    "id": "yolo-auto",
    "alias": "yolo-auto",
    "chat": "https://yolo-auto.com/v1/chat/completions",
    "val": "https://yolo-auto.com/v1/models",
    "models": [
      "qwen3.6-35b-a3b"
    ],
    "fetcher": true,
    "xkey": false
  },
  {
    "id": "zerolimitai",
    "alias": "zerolimitai",
    "chat": "https://www.zerolimitai.com/api/v1/chat/completions",
    "val": "https://www.zerolimitai.com/api/v1/models",
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
