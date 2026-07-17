/**
 * #2328 Qoder CN provider registry wiring.
 *
 * Asserts the generated registry resolves the `qoder-cn` entry with the
 * expected endpoint, OAuth region, and category — i.e. that dropping the file
 * in and regenerating the index actually wires the provider.
 */
import { describe, it, expect } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("qoder-cn registry (#2328)", () => {
  const entry = REGISTRY.find((p) => p.id === "qoder-cn");

  it("is present in the generated registry", () => {
    expect(entry, "qoder-cn missing from registry/index.js").toBeTruthy();
  });

  it("targets the Qoder CN gateway over SSE", () => {
    expect(entry.transport.baseUrl).toContain("gateway.qoder.com.cn");
    expect(entry.transport.baseUrl).toContain("sse");
  });

  it("is a free-category CN-region OAuth provider", () => {
    expect(entry.category).toBe("free");
    expect(entry.oauth?.region).toBe("cn");
    expect(entry.oauth?.openApiBaseUrl).toContain("openapi.qoder.com.cn");
  });

  it("declares at least one model", () => {
    expect(Array.isArray(entry.models)).toBe(true);
    expect(entry.models.length).toBeGreaterThan(0);
    expect(entry.models[0].id).toBeTruthy();
  });
});
