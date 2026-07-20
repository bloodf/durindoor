// Claude → Kiro (direct route) request translation + Kiro → Claude response.
// Verifies the direct claude:kiro / kiro:claude routes added to bypass the
// OpenAI pivot, and that the "Improperly formed request" 400-guards survive.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const C2K = (body, credentials = null) =>
  translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4.5", body, true, credentials, "kiro");

describe("public translateRequest suffix fallback", () => {
  it("cleans same-format body.model while applying the suffix intent", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-5(high)",
      {
        model: "gpt-5(high)",
        messages: [{ role: "user", content: "hello" }],
      },
      true,
      null,
      "openai",
    );

    expect(out.model).toBe("gpt-5");
    expect(out.reasoning_effort).toBe("high");
  });
});

describe("Claude → Kiro (direct route)", () => {
  it("produces a Kiro conversationState payload", () => {
    const out = C2K({ messages: [{ role: "user", content: "hello" }] });
    expect(out.conversationState).toBeTruthy();
    expect(out.conversationState.currentMessage.userInputMessage.content).toContain("hello");
  });

  it("keeps the same conversationId for the same client session header", () => {
    const credentials = {
      rawHeaders: { "x-session-id": "client-session-123" },
      connectionId: "conn-a",
    };
    const body = { messages: [{ role: "user", content: "hello" }] };

    const first = C2K(body, credentials);
    const second = C2K(body, credentials);

    expect(first.conversationState.conversationId).toBe("client-session-123");
    expect(second.conversationState.conversationId).toBe("client-session-123");
  });

  it("uses different conversationIds for different client session headers", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };

    const first = C2K(body, {
      rawHeaders: { "x-session-id": "client-session-a" },
      connectionId: "conn-a",
    });
    const second = C2K(body, {
      rawHeaders: { "x-session-id": "client-session-b" },
      connectionId: "conn-a",
    });

    expect(first.conversationState.conversationId).toBe("client-session-a");
    expect(second.conversationState.conversationId).toBe("client-session-b");
  });

  it("guard 1: with no tools, a dangling tool_result is flattened to text (no structured ref)", () => {
    // Client omitted `tools` but kept a tool_result after compaction.
    const out = C2K({
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "f", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "result" }] },
      ],
    });
    // No userInputMessageContext.tools/toolResults anywhere → won't trip the
    // "tools required" validator.
    const cur = out.conversationState.currentMessage.userInputMessage;
    expect(cur.userInputMessageContext?.toolResults).toBeFalsy();
    const everyHistoryClean = out.conversationState.history.every(
      (h) => !h.userInputMessage?.userInputMessageContext?.toolResults
    );
    expect(everyHistoryClean).toBe(true);
  });

  it("guard 2: with tools, an orphaned tool_result is folded into user text", () => {
    const out = C2K({
      tools: [{ name: "f", description: "fn", input_schema: { type: "object", properties: {} } }],
      messages: [
        { role: "user", content: "go" },
        // tool_result references a tool_use that never appears → orphan
        { role: "user", content: [{ type: "tool_result", tool_use_id: "ghost", content: "salvage me" }] },
      ],
    });
    const cur = out.conversationState.currentMessage.userInputMessage;
    // The orphan content survives as text, not as a dangling structured ref.
    expect(cur.content).toContain("salvage me");
    expect(cur.userInputMessageContext?.toolResults?.length ?? 0).toBe(0);
  });

  it("injects thinking_mode tag when model implies thinking", () => {
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.KIRO,
      "claude-sonnet-4.5-thinking",
      { messages: [{ role: "user", content: "hi" }] },
      true,
      null,
      "kiro"
    );
    expect(out.conversationState.currentMessage.userInputMessage.content).toContain(
      "<thinking_mode>enabled</thinking_mode>"
    );
  });

  it("maps output_config.effort high to Kiro max_thinking_length 24576", () => {
    const out = C2K({
      output_config: { effort: "high" },
      messages: [{ role: "user", content: "think with adaptive effort" }],
    });

    expect(out.conversationState.currentMessage.userInputMessage.content).toContain(
      "<max_thinking_length>24576</max_thinking_length>"
    );
  });

  it("threads a parsed suffix intent without leaking it into nested model IDs", () => {
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.KIRO,
      "claude-sonnet-4.5",
      {
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "answer" },
          { role: "user", content: "next" },
        ],
      },
      true,
      { rawHeaders: { "x-session-id": "kiro-session-144" } },
      "kiro",
      null,
      [],
      "connection-144",
      null,
      { thinkingIntent: { mode: "level", level: "high" }, capabilityModel: "claude-sonnet-4.5" },
    );

    expect(out.conversationState.conversationId).toBe("kiro-session-144");
    expect(out.conversationState.currentMessage.userInputMessage.content).toContain(
      "<max_thinking_length>24576</max_thinking_length>",
    );
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("(high)");
    expect(serialized).not.toContain("_kiro");
  });

  it("keeps the public translateRequest entry point safe without explicit context", () => {
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.KIRO,
      "claude-sonnet-4.5(high)",
      { messages: [{ role: "user", content: "hello" }] },
      true,
      null,
      "kiro",
    );

    expect(out.conversationState.currentMessage.userInputMessage.modelId).toBe(
      "claude-sonnet-4.5",
    );
    expect(out.conversationState.currentMessage.userInputMessage.content).toContain(
      "<max_thinking_length>24576</max_thinking_length>",
    );
  });

  it("lets an explicit none suffix suppress body/header/model thinking fallbacks", () => {
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.KIRO,
      "claude-sonnet-4.5-thinking",
      {
        thinking: { type: "enabled", budget_tokens: 8192 },
        messages: [{ role: "user", content: "do not think" }],
      },
      true,
      { rawHeaders: { "anthropic-beta": "interleaved-thinking-2025-05-14" } },
      "kiro",
      null,
      [],
      null,
      null,
      { thinkingIntent: { mode: "none" }, capabilityModel: "claude-sonnet-4.5-thinking" },
    );

    const content = out.conversationState.currentMessage.userInputMessage.content;
    expect(content).not.toContain("<thinking_mode>");
    expect(content).not.toContain("<max_thinking_length>");
  });
});

describe("Kiro → Claude (direct route, OpenAI-shaped chunks from executor)", () => {
  // KiroExecutor emits chat.completion.chunk objects; translateResponse must
  // convert them to Claude SSE events.
  const R = (chunk, state) => translateResponse(FORMATS.KIRO, FORMATS.CLAUDE, chunk, state);

  it("first text chunk emits message_start + content_block_start + text_delta", () => {
    const state = {};
    const events = R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "claude-sonnet-4.5",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }],
      },
      state
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("message_start");
    expect(types).toContain("content_block_start");
    expect(types).toContain("content_block_delta");
    const delta = events.find((e) => e.type === "content_block_delta");
    expect(delta.delta).toEqual({ type: "text_delta", text: "Hi" });
  });

  it("finish chunk emits message_delta + message_stop with stop_reason", () => {
    const state = {};
    R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }],
      },
      state
    );
    const events = R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      },
      state
    );
    const md = events.find((e) => e.type === "message_delta");
    expect(md.delta.stop_reason).toBe("end_turn");
    expect(md.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
    expect(events.some((e) => e.type === "message_stop")).toBe(true);
  });

  it("preserves kiro_credits through the final-chunk usage remap", () => {
    const state = {};
    R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }],
      },
      state
    );
    const events = R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, kiro_credits: 0.0123, kiro_credit_unit: "credit" },
      },
      state
    );
    // Credits must survive the { input_tokens, output_tokens } remap so
    // onStreamComplete persists Kiro credit metering on the Claude route.
    expect(state.usage.kiro_credits).toBe(0.0123);
    expect(state.usage.kiro_credit_unit).toBe("credit");
    expect(state.usage.input_tokens).toBe(5);
    expect(state.usage.output_tokens).toBe(3);
    const md = events.find((e) => e.type === "message_delta");
    expect(md.usage.kiro_credits).toBe(0.0123);
    expect(md.usage.kiro_credit_unit).toBe("credit");
  });

  it("preserves estimated marker through the final-chunk usage remap", () => {
    const state = {};
    R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }],
      },
      state
    );
    const events = R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          kiro_credits: 0.0123,
          kiro_credit_unit: "credit",
          estimated: true,
        },
      },
      state
    );
    // Estimated marker must survive the final remap so onStreamComplete does
    // not persist fallback token counts as authoritative on the Claude route.
    expect(state.usage.estimated).toBe(true);
    expect(state.usage.kiro_credits).toBe(0.0123);
    const md = events.find((e) => e.type === "message_delta");
    expect(md.usage.estimated).toBe(true);
    expect(md.usage.kiro_credits).toBe(0.0123);
    expect(md.usage.kiro_credit_unit).toBe("credit");
    // Truthy strings like "true" must not be treated as an estimate marker.
    const stringState = {};
    R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }],
      },
      stringState
    );
    const stringEvents = R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, estimated: "true" },
      },
      stringState
    );
    const stringMd = stringEvents.find((e) => e.type === "message_delta");
    expect(stringMd.usage.estimated).toBeUndefined();
  });

  it("drops malformed null kiro_credits on the final-chunk remap", () => {
    const state = {};
    R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, kiro_credits: null },
      },
      state
    );
    expect(state.usage.kiro_credits).toBeUndefined();
    expect(state.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
  });

  it("reasoning_content maps to a thinking block", () => {
    const state = {};
    const events = R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: { reasoning_content: "pondering" }, finish_reason: null }],
      },
      state
    );
    const start = events.find((e) => e.type === "content_block_start");
    expect(start.content_block.type).toBe("thinking");
    const delta = events.find((e) => e.type === "content_block_delta");
    expect(delta.delta).toEqual({ type: "thinking_delta", thinking: "pondering" });
  });

  it("tool_calls map to a tool_use block with buffered input_json_delta", () => {
    const state = {};
    R(
      {
        id: "c", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "tu1", type: "function", function: { name: "search", arguments: "" } }] }, finish_reason: null }],
      },
      state
    );
    R(
      {
        id: "c", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"x"}' } }] }, finish_reason: null }],
      },
      state
    );
    const events = R(
      {
        id: "c", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
      state
    );
    const jsonDelta = events.find(
      (e) => e.type === "content_block_delta" && e.delta.type === "input_json_delta"
    );
    expect(jsonDelta.index).toBeDefined();
    expect(jsonDelta.delta.partial_json).toBe('{"q":"x"}');
    const md = events.find((e) => e.type === "message_delta");
    expect(md.delta.stop_reason).toBe("tool_use");
  });
});
