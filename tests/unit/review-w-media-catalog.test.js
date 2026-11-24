import { describe, expect, it } from "vitest";
import { prepareStabilityOutputOptions } from "../../open-sse/handlers/imageProviders/outputFormat.js";
import { CAPABILITY_ENDPOINTS } from "@/sse/services/autoModel.js";

describe("review #2432 Stability output format", () => {
  it("defaults only an absent format to png and rejects unknown formats", () => {
    expect(prepareStabilityOutputOptions({})).toEqual({ output_format: "png" });
    expect(prepareStabilityOutputOptions({ output_format: "WEBP" })).toEqual({ output_format: "webp" });
    expect(() => prepareStabilityOutputOptions({ output_format: "bogus" })).toThrow(/png, jpeg, webp/);
    try {
      prepareStabilityOutputOptions({ output_format: "bogus" });
    } catch (error) {
      expect(error.status).toBe(400);
    }
  });
});

describe("review #2433 web fetch catalog endpoints", () => {
  it("advertises the implemented web fetch route in both catalogs", async () => {
    expect(CAPABILITY_ENDPOINTS.webFetch).toBe("/v1/web/fetch");
    const { GET } = await import("@/app/api/v1/models/info/route.js");
    const response = await GET(new Request("http://local.test/v1/models/info?id=exa/fetch"));
    expect(response.status).toBe(200);
    expect((await response.json()).endpoint).toBe("/v1/web/fetch");
  });
});
