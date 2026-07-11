import { describe, expect, it } from "vitest";
import { normalizeSearchProviderInput } from "../../src/sse/handlers/search.js";

describe("normalizeSearchProviderInput", () => {
  it("strips /search only for providers that advertise web search", () => {
    expect(normalizeSearchProviderInput("searxng/search")).toBe("searxng");
    expect(normalizeSearchProviderInput("tavily/search")).toBe("tavily");
    expect(normalizeSearchProviderInput("searxng")).toBe("searxng");
  });

  it("leaves unknown or nested model IDs unchanged", () => {
    expect(normalizeSearchProviderInput("unknown/search")).toBe("unknown/search");
    expect(normalizeSearchProviderInput("provider/combo/search")).toBe("provider/combo/search");
  });
});
