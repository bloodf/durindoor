import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { INLINE_THINKING_FORMATS } from "../../open-sse/providers/schema.js";
import {
  normalizeInlineThinkingResponse,
  resolveInlineThinkingFormat,
} from "../../open-sse/handlers/chatCore/inlineThinking.js";
import { appendReasoningText } from "../../open-sse/translator/concerns/reasoning.js";
import {
  handleForcedSSEToJson,
  parseSSEToOpenAIResponse,
} from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

describe("MiniMax inline-thinking response policy", () => {
  it.each(["minimax", "minimax-cn"])("enables only the %s M3 OpenAI transport", (provider) => {
    expect(resolveInlineThinkingFormat(provider, "MiniMax-M3", FORMATS.OPENAI))
      .toBe(INLINE_THINKING_FORMATS.THINK_TAGS);
    expect(resolveInlineThinkingFormat(provider, "MiniMax-M2.7", FORMATS.OPENAI)).toBeNull();
    expect(resolveInlineThinkingFormat(provider, "MiniMax-M3", FORMATS.CLAUDE)).toBeNull();
  });

  it.each(["nvidia", "galadriel", "openrouter"])("does not infer the quirk for %s", (provider) => {
    expect(resolveInlineThinkingFormat(provider, "MiniMax-M3", FORMATS.OPENAI)).toBeNull();
    expect(resolveInlineThinkingFormat(provider, "minimax-m3", FORMATS.OPENAI)).toBeNull();
  });
});

describe("normalizeInlineThinkingResponse", () => {
  it("normalizes every choice independently and preserves response metadata", () => {
    const original = {
      id: "chatcmpl-multi",
      object: "chat.completion",
      model: "MiniMax-M3",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "before <think>first</think> middle <think>second</think> after",
            reasoning_content: "native",
            reasoning_details: [{ text: "structured" }],
            tool_calls: [{ id: "call_0", type: "function", function: { name: "lookup", arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
          logprobs: { content: [] },
        },
        {
          index: 1,
          message: { role: "assistant", content: "<think>choice one</think>answer one" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 5, total_tokens: 7 },
    };
    const snapshot = structuredClone(original);

    const result = normalizeInlineThinkingResponse(original, {
      provider: "minimax-cn",
      model: "MiniMax-M3",
      targetFormat: FORMATS.OPENAI,
    });

    expect(original).toEqual(snapshot);
    expect(result.configured).toBe(true);
    expect([...result.extractedChoicePositions]).toEqual([0, 1]);
    expect(result.responseBody.choices[0]).toEqual({
      ...snapshot.choices[0],
      message: {
        ...snapshot.choices[0].message,
        content: "before  middle  after",
        reasoning_content: "native\nfirst\nsecond",
      },
    });
    expect(result.responseBody.choices[1].message).toEqual({
      role: "assistant",
      content: "answer one",
      reasoning_content: "choice one",
    });
    expect(result.responseBody.usage).toEqual(snapshot.usage);
  });

  it("preserves native reasoning and structured content when there are no textual tags", () => {
    const body = {
      choices: [
        { index: 0, message: { content: "answer", reasoning_content: "native" }, finish_reason: "stop" },
        { index: 1, message: { content: [{ type: "text", text: "<think>literal</think>" }] }, finish_reason: "stop" },
      ],
    };
    const result = normalizeInlineThinkingResponse(body, {
      provider: "minimax",
      model: "MiniMax-M3",
      targetFormat: FORMATS.OPENAI,
    });
    expect(result.configured).toBe(true);
    expect(result.responseBody).toBe(body);
    expect(result.responseBody).toEqual(body);
  });

  it("fails open for malformed tags and leaves unrelated providers byte-identical", () => {
    const malformed = { choices: [{ index: 0, message: { content: "<think>broken" } }] };
    const malformedResult = normalizeInlineThinkingResponse(malformed, {
      provider: "minimax",
      model: "MiniMax-M3",
      targetFormat: FORMATS.OPENAI,
    });
    expect(malformedResult.responseBody).toBe(malformed);

    const literal = { choices: [{ index: 0, message: { content: "<think>visible</think>" } }] };
    const unrelated = normalizeInlineThinkingResponse(literal, {
      provider: "galadriel",
      model: "MiniMax-M3",
      targetFormat: FORMATS.OPENAI,
    });
    expect(unrelated.configured).toBe(false);
    expect(unrelated.responseBody).toBe(literal);
  });
});

describe("shared reasoning append", () => {
  it("appends strings without replacing native reasoning", () => {
    expect(appendReasoningText("native", "tagged")).toBe("native\ntagged");
    expect(appendReasoningText("native\n", "tagged")).toBe("native\ntagged");
    expect(appendReasoningText(undefined, "tagged")).toBe("tagged");
  });

  it("preserves non-string native fields", () => {
    const native = { blocks: ["structured"] };
    expect(appendReasoningText(native, "tagged")).toBe(native);
  });
});

describe("forced SSE accumulation", () => {
  it("keeps interleaved choices separate before one normalization pass", () => {
    const frames = [
      { id: "chatcmpl-sse", model: "MiniMax-M3", choices: [
        { index: 1, delta: { role: "assistant", content: "<think>choice " }, finish_reason: null },
        { index: 0, delta: { role: "assistant", content: "<think>first" }, finish_reason: null },
      ] },
      { id: "chatcmpl-sse", model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: " reason</think>answer", tool_calls: [{ index: 0, id: "call_0", type: "function", function: { name: "look", arguments: "{" } }] }, finish_reason: null },
        { index: 1, delta: { content: "one</think>reply" }, finish_reason: "stop" },
      ] },
      { id: "chatcmpl-sse", model: "MiniMax-M3", choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { name: "up", arguments: "}" } }] }, finish_reason: "tool_calls" },
      ], usage: { prompt_tokens: 1, completion_tokens: 4, total_tokens: 5 } },
    ];
    const raw = `${frames.map(frame => `data: ${JSON.stringify(frame)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
    const parsed = parseSSEToOpenAIResponse(raw, "fallback");
    const normalized = normalizeInlineThinkingResponse(parsed, {
      provider: "minimax-cn",
      model: "MiniMax-M3",
      targetFormat: FORMATS.OPENAI,
    }).responseBody;

    expect(normalized.choices.map(choice => choice.index)).toEqual([0, 1]);
    expect(normalized.choices[0]).toMatchObject({
      index: 0,
      message: {
        content: "answer",
        reasoning_content: "first reason",
        tool_calls: [{ id: "call_0", function: { name: "lookup", arguments: "{}" } }],
      },
      finish_reason: "tool_calls",
    });
    expect(normalized.choices[1]).toMatchObject({
      index: 1,
      message: { content: "reply", reasoning_content: "choice one" },
      finish_reason: "stop",
    });
    expect(normalized.usage).toEqual({ prompt_tokens: 1, completion_tokens: 4, total_tokens: 5 });
  });

  it("normalizes a forced MiniMax SSE-to-JSON response exactly once", async () => {
    const frames = [
      { id: "chatcmpl-forced", model: "MiniMax-M3", choices: [
        { index: 0, delta: { role: "assistant", content: "<think>forced ", reasoning_content: "native" }, finish_reason: null },
      ] },
      { id: "chatcmpl-forced", model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "reason</think>visible" }, finish_reason: "stop" },
      ], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
    ];
    const raw = `${frames.map(frame => `data: ${JSON.stringify(frame)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
    const providerResponse = {
      headers: new Map([["content-type", "text/event-stream"]]),
      text: vi.fn(async () => raw),
    };
    const result = await handleForcedSSEToJson({
      providerResponse,
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      provider: "minimax-cn",
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [], stream: false },
      stream: true,
      translatedBody: null,
      finalBody: null,
      requestStartTime: Date.now(),
      connectionId: "connection-test",
      apiKey: "sk-test",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      onRequestSuccess: vi.fn(),
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      log: { debug: vi.fn() },
    });

    const body = await result.response.json();
    expect(body.choices[0].message).toEqual({
      role: "assistant",
      content: "visible",
      reasoning_content: "native\nforced reason",
    });
    expect(JSON.stringify(body).match(/forced reason/g)).toHaveLength(1);
    expect(JSON.stringify(body).match(/native/g)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("<think>");
  });
});
