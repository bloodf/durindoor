import { describe, expect, it } from "vitest";

const {
  convertGeminiToInternal,
  convertOpenAIResponseToGemini,
  openAIChunkToGeminiChunk,
  transformOpenAISSEToGeminiSSE,
} = await import("../../src/app/api/v1beta/models/[...path]/geminiBridge.js");

describe("Gemini native v1beta tool calling", () => {
  it("maps functionDeclarations, functionCall, and functionResponse into OpenAI chat shape", () => {
    const out = convertGeminiToInternal(
      {
        contents: [
          { role: "user", parts: [{ text: "Weather?" }] },
          { role: "model", parts: [{ functionCall: { name: "weather", args: { city: "Paris" } } }] },
          { role: "user", parts: [{ functionResponse: { name: "weather", response: { result: { temp: 18 } } } }] },
        ],
        tools: [{ functionDeclarations: [{ name: "weather", description: "Weather", parameters: { type: "object" } }] }],
      },
      "gemini-pro",
      false,
    );

    expect(out.tools[0].function.name).toBe("weather");
    expect(out.messages.find((m) => m.role === "assistant").tool_calls[0].function.name).toBe("weather");
    expect(JSON.parse(out.messages.find((m) => m.role === "tool").content)).toEqual({ temp: 18 });
  });

  it("maps non-stream OpenAI tool_calls into Gemini functionCall parts", async () => {
    const response = Response.json({
      model: "gemini-pro",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ type: "function", function: { name: "weather", arguments: "{\"city\":\"Paris\"}" } }],
        },
        finish_reason: "tool_calls",
      }],
    });

    const geminiResponse = await convertOpenAIResponseToGemini(response, "gemini-pro");
    const body = await geminiResponse.json();
    expect(body.candidates[0].content.parts).toEqual([
      { functionCall: { name: "weather", args: { city: "Paris" } } },
    ]);
  });

  it("accumulates fragmented streaming OpenAI tool_calls into one Gemini functionCall", () => {
    const state = {};
    expect(openAIChunkToGeminiChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "weather", arguments: "{\"ci" } }] }, finish_reason: null }],
    }, "gemini-pro", state)).toBeNull();
    expect(openAIChunkToGeminiChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "ty\":\"Paris\"}" } }] }, finish_reason: null }],
    }, "gemini-pro", state)).toBeNull();

    const final = openAIChunkToGeminiChunk({
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, "gemini-pro", state);

    expect(final.candidates[0].content.parts[0]).toEqual({
      functionCall: { name: "weather", args: { city: "Paris" } },
    });
  });

  it("streams fragmented tool_calls through the SSE transformer", async () => {
    const body = [
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"weather\",\"arguments\":\"{\\\"ci\"}}]},\"finish_reason\":null}]}",
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"ty\\\":\\\"Paris\\\"}\"}}]},\"finish_reason\":null}]}",
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}",
      "data: [DONE]",
    ].join("\n\n");
    const response = transformOpenAISSEToGeminiSSE(new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }), "gemini-pro");

    const raw = await response.text();
    const chunks = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5).trim()));
    const functionCall = chunks.flatMap((chunk) => chunk.candidates[0].content.parts)
      .find((part) => part.functionCall)
      .functionCall;

    expect(functionCall).toEqual({ name: "weather", args: { city: "Paris" } });
  });
});
