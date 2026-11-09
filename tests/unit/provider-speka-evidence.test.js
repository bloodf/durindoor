import { describe, expect, it } from "vitest";

import speka from "../../open-sse/providers/registry/speka.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { resolveProvider } from "../../open-sse/providers/schema.js";

describe("speka provider candidate evidence (Issue #1233)", () => {
  it("exports valid candidate registry module matching OmniRoute 61e07fb contract", () => {
    expect(speka).toBeDefined();
    expect(speka.id).toBe("speka");
    expect(speka.alias).toBe("speka");
    expect(speka.category).toBe("apikey");
    expect(speka.authType).toBe("apikey");
    expect(speka.transport).toMatchObject({
      baseUrl: "https://speka.me/v1/chat/completions",
      validateUrl: "https://speka.me/v1/models",
    });
    expect(speka.modelsFetcher).toEqual({
      url: "https://speka.me/v1/models",
      type: "openai",
    });
    expect(speka.passthroughModels).toBe(true);
    expect(speka.models).toEqual([]);
    expect(speka.serviceKinds).toEqual(["llm"]);
  });

  it("uses neutral presentation metadata and unverified disclaimer", () => {
    expect(speka.display).toBeDefined();
    expect(speka.display.name).toBe("Speka AI");
    expect(speka.display.icon).toBe("route");
    expect(speka.display.textIcon).toBe("SP");
    expect(speka.display.color).toBe("#DB2777");
    expect(speka.display.website).toBe("https://speka.me");
    expect(speka.display.notice?.text).toContain("Confirm current quota, price and terms before use.");
    expect(speka.hasFree).toBeUndefined();
    expect(speka.freeNote).toBeUndefined();
  });

  it("proves namespace isolation: currently absent from shared REGISTRY before integration", () => {
    const existing = REGISTRY.find((entry) => entry.id === "speka");
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

    expect(existingIds.has("speka")).toBe(false);
    expect(existingAliases.has("speka")).toBe(false);
  });

  it("enforces fail-closed authentication and egress security boundaries", () => {
    expect(speka.noAuth).toBeUndefined();
    expect(speka.autoComboNoAuth).toBeUndefined();
    expect(speka.authType).toBe("apikey");
    expect(speka.transport.baseUrl.startsWith("https://speka.me/")).toBe(true);
    expect(speka.transport.validateUrl.startsWith("https://speka.me/")).toBe(true);
  });

  it("resolves to standard OpenAI-compatible transport with PROVIDER_DEFAULTS", () => {
    const resolved = resolveProvider(speka);
    expect(resolved.format).toBe("openai");
    expect(resolved.executor).toBe("default");
    expect(resolved.baseUrl).toBe("https://speka.me/v1/chat/completions");
    expect(resolved.validateUrl).toBe("https://speka.me/v1/models");
    expect(resolved.auth).toMatchObject({
      header: "Authorization",
      scheme: "bearer",
    });
  });
});
