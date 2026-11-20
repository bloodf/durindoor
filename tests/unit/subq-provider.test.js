import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { getProvidersByKind } from "@/shared/constants/providers.js";

describe("SubQ System One provider", () => {
  const entry = REGISTRY.find((e) => e.id === "subq");

  it("is registered as a System One apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.serviceKinds).toEqual(["systemone"]);
    expect(PROVIDER_MEDIA["subq"]?.systemoneConfig?.baseUrl).toBe("https://api.subq.ai/v1/systemone");
  });

  it("appears in getProvidersByKind('systemone')", () => {
    const list = getProvidersByKind("systemone");
    const found = list.find((p) => p.id === "subq");
    expect(found).toBeDefined();
    expect(found.alias).toBe("subq");
    expect(found.systemoneConfig?.baseUrl).toBe("https://api.subq.ai/v1/systemone");
  });

  it("exposes calibrated models", () => {
    const ids = (entry.models || []).map((m) => m.id);
    expect(ids).toContain("subq-snap-preview");
  });
});
