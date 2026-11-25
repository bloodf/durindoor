import { describe, expect, it } from "vitest";
import { filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";

const schema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
const parametersFor = (declaration) => filterToOpenAIFormat({
  messages: [{ role: "user", content: "hi" }],
  tools: [{ functionDeclarations: [{ name: "read", ...declaration }] }],
}).tools[0].function.parameters;

describe("OmniRoute 2608d75c (#19048) Gemini declarations in the OpenAI filter", () => {
  it("keeps a parametersJsonSchema-only declaration", () => {
    expect(parametersFor({ parametersJsonSchema: schema })).toEqual(schema);
  });

  it("prefers parameters when both fields are present", () => {
    const parameters = { type: "object", properties: { id: { type: "integer" } } };
    expect(parametersFor({ parameters, parametersJsonSchema: schema })).toEqual(parameters);
  });

  it("still defaults to an empty object schema", () => {
    expect(parametersFor({})).toEqual({ type: "object", properties: {} });
  });
});
