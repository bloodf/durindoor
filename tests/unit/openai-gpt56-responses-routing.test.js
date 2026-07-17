// Regression for upstream 9router#2547: GPT-5.6 tool calls with reasoning
// must use the OpenAI Responses API, even when the client sends Chat
// Completions format. Routes `gpt-5.6` / `gpt-5.6-sol` to the Responses
// transport while keeping older GPT-5.x models on Chat Completions.
import { describe, expect, it } from "vitest";

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

describe("OpenAI GPT-5.6 Responses routing", () => {
  it("routes GPT-5.6 models Responses while GPT-5.4 stays on Chat Completions", () => {
    const responsesFormat = getModelTargetFormat("openai", "gpt-5.6-sol");
    expect(responsesFormat).toBe(FORMATS.OPENAI_RESPONSES);
    expect(getModelTargetFormat("openai", "gpt-5.4")).toBeNull();

    const responsesTransport = resolveTransport("openai", FORMATS.OPENAI_RESPONSES);
    expect(responsesTransport?.baseUrl).toBe("https://api.openai.com/v1/responses");
    expect(resolveTransport("openai", FORMATS.OPENAI)?.baseUrl)
      .toBe("https://api.openai.com/v1/chat/completions");

    const executor = new DefaultExecutor("openai");
    expect(
      executor.buildUrl("gpt-5.6-sol", true, 0, { runtimeTransport: responsesTransport }),
    ).toBe("https://api.openai.com/v1/responses");
    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.6-sol",
      {
        model: "openai/gpt-5.6-sol",
        messages: [
          { role: "user", content: "Check weather in Manado." },
        ],
        tools: [
          {
            type: "function",
            function: { name: "weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } },
          },
        ],
        tool_choice: "auto",
        reasoning_effort: "high",
      },
      true,
      null,
      "openai",
    );
    expect(result.input).toEqual([
      expect.objectContaining({
        role: "user",
        content: expect.arrayContaining([
          expect.objectContaining({ type: "input_text", text: "Check weather in Manado." }),
        ]),
      }),
    ]);
    expect(result.reasoning_effort).toBe("high");
    expect(result.tools).toEqual([
      expect.objectContaining({ type: "function", name: "weather" }),
    ]);
  });

  it("converts tool calls results as a Responses follow-up", () => {
    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.6-sol",
      {
        model: "openai/gpt-5.6-sol",
        messages: [
          { role: "user", content: "Check weather in Manado." },
          {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_weather",
              type: "function",
              function: { name: "weather", arguments: "{\"city\":\"Manado\"}" },
            }],
          },
          { role: "tool", tool_call_id: "call_weather", content: "Rain, 28°C" },
        ],
      },
      true,
      null,
      "openai",
    );
    expect(result.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call", call_id: "call_weather", name: "weather" }),
      expect.objectContaining({ type: "function_call_output", call_id: "call_weather", output: "Rain, 28°C" }),
    ]));
  });
});
