import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("OmniRoute #20205: unsupported Gemini schema keys", () => {
  it("strips OpenAPI annotations but keeps parameters with those names", () => {
    const annotations = { discriminator: { propertyName: "k" }, xml: {}, externalDocs: {}, errorMessages: {}, doNotSuggest: true, suggestSortText: "a" };
    const result = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { xml: { type: "string" }, u: { type: "object", ...annotations, properties: { k: { type: "string" } } } }
    });
    for (const key of Object.keys(annotations)) expect(result.properties.u).not.toHaveProperty(key);
    expect(result.properties.xml).toEqual({ type: "string" });
  });
});
