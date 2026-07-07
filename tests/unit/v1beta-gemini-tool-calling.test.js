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

  it("synthesizes unique per-call tool_call_id when Gemini has multiple same-name functionCalls", () => {
    const out = convertGeminiToInternal(
      {
        contents: [
          {
            role: "model",
            parts: [
              { functionCall: { name: "weather", args: { city: "Paris" } } },
              { functionCall: { name: "weather", args: { city: "London" } } },
            ],
          },
          {
            role: "user",
            parts: [
              { functionResponse: { name: "weather", response: { result: { temp: 18 } } } },
              { functionResponse: { name: "weather", response: { result: { temp: 12 } } } },
            ],
          },
        ],
      },
      "gemini-pro",
      false,
    );

    const toolMessages = out.messages.filter((m) => m.role === "tool");
    const ids = toolMessages.map((m) => m.tool_call_id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toMatch(/^call_weather_\d+$/);
    expect(ids[1]).toMatch(/^call_weather_\d+$/);
  });

  it("uses explicit functionCall id for idless functionResponse", () => {
    const out = convertGeminiToInternal(
      {
        contents: [
          {
            role: "model",
            parts: [
              { functionCall: { id: "call_explicit", name: "weather", args: { city: "Paris" } } },
            ],
          },
          {
            role: "user",
            parts: [
              { functionResponse: { name: "weather", response: { result: { temp: 18 } } } },
            ],
          },
        ],
      },
      "gemini-pro",
      false,
    );

    const toolMessage = out.messages.find((m) => m.role === "tool");
    expect(toolMessage.tool_call_id).toBe("call_explicit");
  });

  it("normalizes nested uppercase Gemini functionDeclaration schema types for OpenAI tools", () => {
    const out = convertGeminiToInternal(
      {
        contents: [{ role: "user", parts: [{ text: "Search docs" }] }],
        tools: [{
          functionDeclarations: [{
            name: "search",
            parameters: {
              type: "OBJECT",
              properties: {
                query: { type: "STRING" },
                filters: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      exact: { type: "BOOLEAN" },
                      score: { type: ["NUMBER", "NULL"] },
                    },
                  },
                },
              },
              anyOf: [{ type: "OBJECT" }, { type: "NULL" }],
            },
          }],
        }],
      },
      "gemini-pro",
      false,
    );

    expect(out.tools[0].function.parameters).toEqual({
      type: "object",
      properties: {
        query: { type: "string" },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              exact: { type: "boolean" },
              score: { type: ["number", "null"] },
            },
          },
        },
      },
      anyOf: [{ type: "object" }, { type: "null" }],
    });
  });

  it("translates Gemini toolConfig.functionCallingConfig modes into OpenAI tool_choice", () => {
    const none = convertGeminiToInternal(
      {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{ functionDeclarations: [{ name: "weather", description: "Weather", parameters: { type: "object" } }] }],
        toolConfig: { functionCallingConfig: { mode: "NONE" } },
      },
      "gemini-pro",
      false,
    );
    expect(none.tool_choice).toBe("none");
    expect(none.tools).toBeDefined();

    const anyAllowed = convertGeminiToInternal(
      {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [
          { functionDeclarations: [{ name: "weather", parameters: { type: "object" } }] },
          { functionDeclarations: [{ name: "news", parameters: { type: "object" } }] },
        ],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["weather"] } },
      },
      "gemini-pro",
      false,
    );
    expect(anyAllowed.tool_choice).toEqual({ type: "function", function: { name: "weather" } });
    expect(anyAllowed.tools.map((t) => t.function.name)).toEqual(["weather"]);

    const anyAll = convertGeminiToInternal(
      {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [
          { functionDeclarations: [{ name: "weather", parameters: { type: "object" } }] },
          { functionDeclarations: [{ name: "news", parameters: { type: "object" } }] },
        ],
        toolConfig: { functionCallingConfig: { mode: "ANY" } },
      },
      "gemini-pro",
      false,
    );
    expect(anyAll.tool_choice).toBe("required");
    expect(anyAll.tools.map((t) => t.function.name)).toEqual(["weather", "news"]);

    const auto = convertGeminiToInternal(
      {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{ functionDeclarations: [{ name: "weather", parameters: { type: "object" } }] }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      },
      "gemini-pro",
      false,
    );
    expect(auto.tool_choice).toBe("auto");
    expect(auto.tools).toBeDefined();
  });;

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
