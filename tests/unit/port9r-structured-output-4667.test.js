import { describe, expect, it } from "vitest";
import { openaiToOpenAIResponsesRequest, openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("structured output conversion (#4667)", () => {
  it("round trips a Chat JSON schema through Responses", () => {
    const json_schema = { name: "answer", schema: { type: "object", properties: { value: { type: "string" } } }, strict: true };
    const response = openaiToOpenAIResponsesRequest("model", { messages: [{ role: "user", content: "hi" }], response_format: { type: "json_schema", json_schema } }, false);
    expect(response.text.format).toEqual({ type: "json_schema", ...json_schema, description: undefined });
    const chat = openaiResponsesToOpenAIRequest("model", response, false);
    expect(chat.response_format).toEqual({ type: "json_schema", json_schema: { ...json_schema, description: undefined } });
    expect(chat).not.toHaveProperty("text");
  });
  it("preserves explicit Responses text and converts JSON object mode", () => {
    const text = { format: { type: "json_object" }, verbosity: "low" };
    expect(openaiToOpenAIResponsesRequest("model", { messages: [], text, response_format: { type: "json_schema" } }, false).text).toEqual(text);
    const response = openaiToOpenAIResponsesRequest("model", { messages: [], response_format: { type: "json_object" } }, false);
    expect(response.text).toEqual({ format: { type: "json_object" } });
    expect(openaiResponsesToOpenAIRequest("model", response, false).response_format).toEqual({ type: "json_object" });
  });
});
