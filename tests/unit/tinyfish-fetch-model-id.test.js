import { describe, expect, it } from "vitest";
import { normalizeFetchProviderInput } from "../../src/sse/handlers/fetch.js";

describe("normalizeFetchProviderInput", () => {
  it("strips /fetch suffix only when the stripped alias maps to a webFetch provider", () => {
    expect(normalizeFetchProviderInput("tinyfish/fetch")).toBe("tinyfish");
    expect(normalizeFetchProviderInput("firecrawl/fetch")).toBe("firecrawl");
    expect(normalizeFetchProviderInput("tinyfish")).toBe("tinyfish");
  });

  it("leaves unknown /fetch ids unchanged", () => {
    expect(normalizeFetchProviderInput("unknown/fetch")).toBe("unknown/fetch");
    expect(normalizeFetchProviderInput("provider/combo/fetch")).toBe("provider/combo/fetch");
  });
});
