import { describe, it, expect } from "vitest";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const schema = { type: "object", properties: {
  properties: { type: "string" }, properties_: { type: "string" },
  nested: { type: "array", items: { type: "object", properties: { properties: { type: "string" }, keep: { type: "string" } }, required: ["properties"] } },
}, required: ["properties", "properties_"] };
const tool = (name, parameters) => ({ type: "function", function: { name, parameters } });
function request(tools) {
  const body = { messages: [{ role: "user", content: "hello" }], tools };
  const translated = openaiToAntigravityRequest("gemini-3-pro", body, true, { projectId: "p" });
  const providerBody = new AntigravityExecutor().transformRequest("gemini-3-pro", translated, true, { projectId: "p" });
  return { body, providerBody };
}
const response = (name, args) => ({ response: { candidates: [{ content: { parts: [{ functionCall: { name, args } }] }, finishReason: "STOP" }] } });

describe("Antigravity properties parameter", () => {
  it("renames collisions and restores streaming and non-streaming calls per request and tool", () => {
    const a = request([tool("first", schema), tool("second", { type: "object", properties: { properties_: { type: "string" } } })]);
    const b = request([tool("first", { type: "object", properties: { properties_: { type: "string" } } })]);
    const params = a.providerBody.request.tools[0].functionDeclarations[0].parameters;
    expect(Object.keys(params.properties)).toContain("properties__");
    expect(params.required).toEqual(expect.arrayContaining(["properties__", "properties_"]));
    expect(params.properties.nested.items.required).toContain("properties_");
    const args = { properties__: "one", properties_: "two", nested: [{ properties_: "three", keep: "four" }] };
    const expected = { properties: "one", properties_: "two", nested: [{ properties: "three", keep: "four" }] };
    const chunks = geminiToOpenAIResponse(response("first", args), { clientTools: a.body.tools, providerBody: a.providerBody });
    expect(JSON.parse(chunks.find((c) => c.choices[0].delta.tool_calls).choices[0].delta.tool_calls[0].function.arguments)).toEqual(expected);
    const convert = (req, name, callArgs) => translateNonStreamingResponse(response(name, callArgs), FORMATS.ANTIGRAVITY, FORMATS.OPENAI, { requestBody: req.body, providerBody: req.providerBody });
    expect(JSON.parse(convert(a, "first", args).choices[0].message.tool_calls[0].function.arguments)).toEqual(expected);
    expect(JSON.parse(convert(b, "first", { properties_: "kept" }).choices[0].message.tool_calls[0].function.arguments)).toEqual({ properties_: "kept" });
    expect(JSON.parse(convert(a, "second", { properties_: "kept" }).choices[0].message.tool_calls[0].function.arguments)).toEqual({ properties_: "kept" });
  });
});
