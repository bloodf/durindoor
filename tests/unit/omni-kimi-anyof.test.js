import { expect, it } from "vitest";
import { normalizeToolSchemaRoots } from "../../open-sse/translator/validate.js";

it("preserves Kimi object union properties and only common required keys", () => {
  const parameters = { anyOf: [
    { type: "object", properties: { shared: { type: "string" }, a: { type: "string" } }, required: ["shared", "a"] },
    { type: "object", properties: { shared: { type: "integer" }, b: { type: "boolean" } }, required: ["shared", "b"] }
  ] };
  normalizeToolSchemaRoots({ tools: [{ function: { parameters } }] }, { provider: "kimi", transportFormat: "openai" });
  expect(parameters).toEqual({ type: "object", properties: { shared: { type: "string" }, a: { type: "string" }, b: { type: "boolean" } }, required: ["shared"] });
});

it("leaves incompatible union branches intact", () => {
  const parameters = { anyOf: [{ type: "object" }, { type: "string" }] };
  normalizeToolSchemaRoots({ tools: [{ function: { parameters } }] }, { provider: "kimi", transportFormat: "openai" });
  expect(parameters.anyOf).toHaveLength(2);
});
