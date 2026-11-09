import { describe, expect, it } from "vitest";

import zerolimitai from "../../open-sse/providers/registry/zerolimitai.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_DEFAULTS } from "../../open-sse/providers/schema.js";

describe("zerolimitai provider evidence (Issue #1253)", () => {
  it("exports valid candidate registry module matching OmniRoute 61e07fb contract", () => {
    expect(zerolimitai).toBeDefined();
    expect(zerolimitai.id).toBe("zerolimitai");
    expect(zerolimitai.alias).toBe("zerolimitai");
    expect(zerolimitai.category).toBe("apikey");
    expect(zerolimitai.authType).toBe("apikey");
    expect(zerolimitai.transport).toMatchObject({
      baseUrl: "https://www.zerolimitai.com/api/v1/chat/completions",
      validateUrl: "https://www.zerolimitai.com/api/v1/models",
    });
    expect(zerolimitai.modelsFetcher).toEqual({
      url: "https://www.zerolimitai.com/api/v1/models",
      type: "openai",
    });
    expect(zerolimitai.passthroughModels).toBe(true);
    expect(zerolimitai.models).toEqual([]);
    expect(zerolimitai.serviceKinds).toEqual(["llm"]);
  });

  it("uses neutral brand assets and valid presentation metadata", () => {
    expect(zerolimitai.display).toBeDefined();
    expect(zerolimitai.display.name).toBe("ZeroLimit AI");
    expect(zerolimitai.display.icon).toBe("route");
    expect(zerolimitai.display.textIcon).toBe("ZL");
    expect(zerolimitai.display.website).toBe("https://www.zerolimitai.com");
  });

  it("proves namespace isolation: currently absent from shared REGISTRY before integration", () => {
    const existing = REGISTRY.find((entry) => entry.id === "zerolimitai");
    expect(existing).toBeUndefined();
  });

  it("proves no alias or id collision with any existing registered provider", () => {
    const existingIds = new Set(REGISTRY.map((entry) => entry.id));
    const existingAliases = new Set(
      REGISTRY.flatMap((entry) => [
        entry.alias,
        ...(Array.isArray(entry.aliases) ? entry.aliases : []),
      ]).filter(Boolean),
    );

    expect(existingIds.has("zerolimitai")).toBe(false);
    expect(existingAliases.has("zerolimitai")).toBe(false);
  });

  it("enforces fail-closed authentication and security boundaries", () => {
    expect(zerolimitai.noAuth).toBeUndefined();
    expect(zerolimitai.autoComboNoAuth).toBeUndefined();
    expect(zerolimitai.authType).toBe("apikey");
    expect(zerolimitai.transport.baseUrl.startsWith("https://www.zerolimitai.com/")).toBe(true);
    expect(zerolimitai.transport.validateUrl.startsWith("https://www.zerolimitai.com/")).toBe(true);
  });

  it("builds standard OpenAI transport when merged with shared provider defaults", () => {
    const transport = {
      ...PROVIDER_DEFAULTS,
      ...zerolimitai.transport,
    };
    expect(transport.format).toBe("openai");
    expect(transport.executor).toBe("default");
    expect(transport.baseUrl).toBe("https://www.zerolimitai.com/api/v1/chat/completions");
    expect(transport.validateUrl).toBe("https://www.zerolimitai.com/api/v1/models");
    expect(transport.auth).toMatchObject({
      header: "Authorization",
      scheme: "bearer",
    });
  });
});
