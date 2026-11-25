import { describe, expect, it, vi } from "vitest";
import { initState } from "../../open-sse/translator/index.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(), saveRequestDetail: vi.fn() }));

const chunk = (delta, finish_reason = null) => ({ id: "chatcmpl-perftest", model: "m", choices: [{ index: 0, delta, finish_reason }] });

describe("tool call lookup and argument buffering", () => {
  it("preserves 500 calls across 5000 interleaved fragments within a bounded time", () => {
    const frames = [];
    for (let round = 0; round < 10; round++) {
      for (let index = 0; index < 500; index++) {
        frames.push(chunk({ tool_calls: [{ index, id: `call_${index}`, function: { ...(round === 0 ? { name: "test" } : {}), arguments: round === 0 ? '{"v":"' : round === 9 ? 'x"}' : "x" } }] }));
      }
    }
    frames.push(chunk({}, "tool_calls"));
    const sse = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
    const start = performance.now();
    const result = parseSSEToOpenAIResponse(sse, "m");
    const state = initState("claude");
    const events = frames.flatMap((frame) => openaiToClaudeResponse(frame, state) || []);
    expect(performance.now() - start).toBeLessThan(5000);
    const calls = result.choices[0].message.tool_calls;
    expect(calls).toHaveLength(500);
    expect(calls.map((call) => [call.id, call.function.name, call.function.arguments])).toEqual(
      Array.from({ length: 500 }, (_, index) => [`call_${index}`, "test", '{"v":"xxxxxxxxx"}'])
    );
    const starts = events.filter((event) => event.content_block?.type === "tool_use");
    const args = events.filter((event) => event.delta?.type === "input_json_delta");
    expect(starts.map((event) => event.content_block.id)).toEqual(calls.map((call) => call.id));
    expect(args.map((event) => event.delta.partial_json)).toEqual(calls.map((call) => call.function.arguments));
  });

  it("does not reparse an unchanged partial buffer on text and thinking switches", () => {
    const state = initState("claude");
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "one", function: { name: "test", arguments: '{"v":' } }] }), state);
    const parse = vi.spyOn(JSON, "parse");
    try {
      for (let i = 0; i < 100; i++) {
        openaiToClaudeResponse(chunk({ content: "text" }), state);
        openaiToClaudeResponse(chunk({ reasoning_content: "think" }), state);
      }
      openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: "1}" } }] }), state);
      const events = openaiToClaudeResponse(chunk({ content: "done" }), state);
      expect(events.find((event) => event.delta?.partial_json)?.delta.partial_json).toBe('{"v":1}');
      expect(parse.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      parse.mockRestore();
    }
  });
});
