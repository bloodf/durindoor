import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest, openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse, openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const toChat = (body) => openaiResponsesToOpenAIRequest("m", body, false);
const toResponses = (body) => openaiToOpenAIResponsesRequest("m", body, false);

describe("OmniRoute #747 conversion disposition", () => {
  it("converts file fields in both directions without losing adjacent text or image detail", () => {
    const file = { file_id: "file-1", file_data: "data:application/pdf;base64,AA==", file_url: "https://example.invalid/f", filename: "a.pdf" };
    const chat = toChat({ input: [{ role: "user", content: [
      { type: "input_text", text: "read" }, { type: "input_file", ...file },
      { type: "input_image", image_url: "https://example.invalid/i", detail: "high" },
    ] }] });
    expect(chat.messages[0].content).toEqual([
      { type: "text", text: "read" }, { type: "file", file },
      { type: "image_url", image_url: { url: "https://example.invalid/i", detail: "high" } },
    ]);
    expect(toResponses({ messages: chat.messages }).input[0].content).toEqual([
      { type: "input_text", text: "read" }, { type: "input_file", ...file },
      { type: "input_image", image_url: "https://example.invalid/i", detail: "high" },
    ]);
    expect(toResponses({ messages: [{ role: "user", content: [{ type: "file", file: { file_id: "f" } }] }] }).input[0].content)
      .toEqual([{ type: "input_file", file_id: "f" }]);
  });

  it("converts calls, arguments, results and forced tool choice", () => {
    const result = toChat({ input: [
      { type: "function_call", call_id: "c1", name: "lookup", arguments: { q: 1 } },
      { type: "function_call_output", call_id: "c1", output: "ok" },
    ], tool_choice: { type: "function", name: "lookup" } });
    expect(result.messages[0].tool_calls[0]).toMatchObject({ id: "c1", function: { name: "lookup", arguments: '{"q":1}' } });
    expect(result.messages[1]).toMatchObject({ role: "tool", tool_call_id: "c1", content: "ok" });
    expect(result.tool_choice).toEqual({ type: "function", function: { name: "lookup" } });
    expect(toResponses({ messages: result.messages, tool_choice: result.tool_choice, tools: [{ type: "function", function: { name: "lookup", parameters: {} } }] }).tool_choice).toEqual({ type: "function", name: "lookup" });
  });

  it("retains terminal text and normalized trailing usage", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const convert = (chunk) => openaiToOpenAIResponsesResponse(chunk, state);
    convert({ id: "c", choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] });
    convert({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    const events = convert({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    const completed = events.find((e) => e.event === "response.completed").data.response;
    expect(completed.output.find((item) => item.type === "message").content[0].text).toBe("hello");
    expect(completed.usage).toMatchObject({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  });

  it("emits Responses reasoning as Chat reasoning", () => {
    const state = initState(FORMATS.OPENAI);
    const result = openaiResponsesToOpenAIResponse({ type: "response.reasoning_summary_text.delta", delta: "plan" }, state);
    const chunks = Array.isArray(result) ? result : [result];
    expect(chunks.some((chunk) => chunk?.choices?.[0]?.delta?.reasoning_content === "plan")).toBe(true);
  });
});
