import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// OmniRoute ports: agnes (#1151), agnes-cn (#1152), ainative (#1153), aion (#1154).
const CASES = [
  {
    id: "agnes",
    alias: "agnes",
    base: "https://apihub.agnes-ai.com/v1",
    models: ["agnes-2.0-flash","agnes-2.5-flash","agnes-3.0-flash"],
    fetcher: true,
    extraFormats: [],
    notice: true,
  },
  {
    id: "agnes-cn",
    alias: "agnescn",
    base: "https://api.agnes-ai.cn/v1",
    models: ["agnes-2.0-flash","agnes-2.5-flash","agnes-3.0-flash"],
    fetcher: true,
    extraFormats: [],
    notice: true,
  },
  {
    id: "ainative",
    alias: "ainative",
    base: "https://api.ainative.studio/api/v1",
    models: [],
    fetcher: true,
    extraFormats: [],
    notice: true,
  },
  {
    id: "aion",
    alias: "aion",
    base: "https://api.aionlabs.ai/v1",
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
