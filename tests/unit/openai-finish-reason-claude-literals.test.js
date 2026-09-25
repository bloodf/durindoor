// OpenAI-shaped providers sometimes put Claude stop_reason literals in finish_reason.
// OpenAI clients must receive the OpenAI value instead.
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { normalizeOpenAIFinish } from "../../open-sse/translator/concerns/finishReason.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

describe("normalizeOpenAIFinish", () => {
  it.each([
    ["end_turn", "stop"],
    ["END_TURN", "stop"],
    ["stop_sequence", "stop"],
    ["tool_use", "tool_calls"],
    ["max_tokens", "length"],
    ["refusal", "content_filter"],
    ["model_context_window_exceeded", "length"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeOpenAIFinish(input)).toBe(expected);
  });

  it.each(["stop", "length", "tool_calls", "error", "malformed_function_call", null, undefined])(
    "leaves %s unchanged",
    (value) => expect(normalizeOpenAIFinish(value)).toBe(value),
  );
});

describe("OpenAI passthrough finish_reason", () => {
  it("streams end_turn as stop", async () => {
    const stream = createSSEStream({ mode: "passthrough", targetFormat: FORMATS.OPENAI, sourceFormat: FORMATS.OPENAI });
    const output = new Response(stream.readable).text();
    const writer = stream.writable.getWriter();
    const chunk = (delta, finish) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    await writer.write(new TextEncoder().encode(`${chunk({ content: "pong" }, null)}${chunk({}, "end_turn")}data: [DONE]\n\n`));
    await writer.close();
    const text = await output;
    expect(text).toContain("\"finish_reason\":\"stop\"");
    expect(text).not.toContain("end_turn");
  });

  it("returns end_turn as stop on a non-streaming OpenAI response", async () => {
    const body = {
      id: "c1", object: "chat.completion", created: 1, model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "end_turn" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const result = await handleNonStreamingResponse({
      providerResponse: {
        headers: new Map([["content-type", "application/json"]]),
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(structuredClone(body)),
        status: 200,
        statusText: "OK",
      },
      provider: "galadriel",
      model: "galadriel-latest",
      body: { model: "galadriel-latest", messages: [] },
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      stream: false,
      streamToClient: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      toolNameMap: null,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });
    const json = await result.response.json();
    expect(json.choices[0].finish_reason).toBe("stop");
  });
});
