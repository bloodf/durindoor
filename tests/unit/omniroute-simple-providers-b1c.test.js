import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: chatanywhere (#1161), cloudcode-one (#1166), dahl (#1171), dxnt (#1177).
const CASES = [
  {
    id: "chatanywhere",
    alias: "chatanywhere",
    base: "https://api.chatanywhere.org/v1",
    models: [],
    fetcher: true,
    extraFormats: [],
    notice: true,
  },
  {
    id: "cloudcode-one",
    alias: "cloudcode-one",
    base: "https://api.cloudcode.one/v1",
    models: ["glm-4.7-flash","glm-4.6v-flash"],
    fetcher: true,
    extraFormats: [],
    notice: true,
  },
  {
    id: "dahl",
    alias: "dahl",
    base: "https://inference.dahl.global/v1",
    models: [],
    fetcher: true,
    extraFormats: [],
    notice: true,
  },
  {
    id: "dxnt",
    alias: "dxnt",
    base: "https://www.dxnt.com/v1",
    models: [],
    fetcher: true,
    extraFormats: [],
    notice: true,
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
