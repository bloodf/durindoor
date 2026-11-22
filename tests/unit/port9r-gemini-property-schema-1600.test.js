import { expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

it("converts shorthand property types without treating a property named properties as a schema", () => {
  const result = cleanJSONSchemaForAntigravity({
    type: "object",
    properties: { properties: { type: "object", properties: { count: "integer", label: "description" } } },
  });
  expect(result.properties.properties.properties.count).toEqual({ type: "integer" });
  expect(result.properties.properties.properties.label).toEqual({ type: "string", description: "description" });
});
