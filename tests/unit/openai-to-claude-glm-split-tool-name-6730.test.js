import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

// Regression guard for GLM 5.2 (and similar OpenAI-compatible upstreams) that
// stream a tool call's `id` and `function.name` across SEPARATE SSE delta
// chunks. The Claude SSE protocol cannot patch a `content_block_start` after
// it is emitted, so the translator must DEFER `content_block_start` until the
// tool name has arrived. Previously the block was emitted immediately on the
// id-only chunk with an empty name and the later name-only chunk was silently
// dropped — Claude Code then rejected the tool_use with an empty tool name.
// Ported from OmniRoute #6730 (decolua/9router#2077).

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function flatten(items) {
  return items.flatMap((item) => item || []);
}

function toolUseStarts(events) {
  return events.filter((e) => e?.type === "content_block_start" && e.content_block?.type === "tool_use");
}

describe("openaiToClaudeResponse split tool id/name (GLM)", () => {
  it("defers content_block_start until the name chunk and emits the real name", () => {
    const state = createState();

    // Chunk 1: id only, no function.name yet (GLM 5.2 behavior).
    const c1 = openaiToClaudeResponse({
      id: "chatcmpl-glm",
      model: "glm/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_glm_1", type: "function" }] }, finish_reason: null }],
    }, state);
    // Chunk 2: function.name only, no id, no arguments.
    const c2 = openaiToClaudeResponse({
      id: "chatcmpl-glm",
      model: "glm/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "get_weather" } }] }, finish_reason: null }],
    }, state);
    // Chunk 3: arguments.
    const c3 = openaiToClaudeResponse({
      id: "chatcmpl-glm",
      model: "glm/glm-5.2",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"SP"}' } }] },
        finish_reason: null,
      }],
    }, state);
    const cEnd = openaiToClaudeResponse({
      id: "chatcmpl-glm",
      model: "glm/glm-5.2",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);

    const events = flatten([c1, c2, c3, cEnd]);
    const starts = toolUseStarts(events);

    expect(starts).toHaveLength(1);
    expect(starts[0].content_block.name).toBe("get_weather");
    expect(starts[0].content_block.id).toBe("call_glm_1");

    // Arguments are buffered on dev and flushed as one sanitized delta at finish.
    const argDeltas = events
      .filter((e) => e?.type === "content_block_delta" && e.delta?.type === "input_json_delta")
      .map((e) => e.delta.partial_json)
      .join("");
    expect(argDeltas).toBe('{"city":"SP"}');
  });

  it("still emits a single named start when id+name+arguments arrive in one chunk", () => {
    const state = createState();
    const c1 = openaiToClaudeResponse({
      id: "chatcmpl-x",
      model: "openai/gpt-4",
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"hi"}' } },
          ],
        },
        finish_reason: null,
      }],
    }, state);
    const cEnd = openaiToClaudeResponse({
      id: "chatcmpl-x",
      model: "openai/gpt-4",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);

    const events = flatten([c1, cEnd]);
    const starts = toolUseStarts(events);

    expect(starts).toHaveLength(1);
    expect(starts[0].content_block.name).toBe("search");
    expect(starts[0].content_block.id).toBe("call_1");
  });

  it("emits a start at finish for an id-only tool call so the stop is not orphaned", () => {
    const state = createState();
    const c1 = openaiToClaudeResponse({
      id: "chatcmpl-orphan",
      model: "glm/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_lonely", type: "function" }] }, finish_reason: null }],
    }, state);
    const cEnd = openaiToClaudeResponse({
      id: "chatcmpl-orphan",
      model: "glm/glm-5.2",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);

    const events = flatten([c1, cEnd]);
    const starts = toolUseStarts(events);
    const stops = events.filter((e) => e?.type === "content_block_stop");

    expect(starts).toHaveLength(1);
    expect(starts[0].content_block.id).toBe("call_lonely");
    expect(stops.some((s) => s.index === starts[0].index)).toBe(true);
  });

  it("defers without swallowing text streamed before the tool call", () => {
    const state = createState();
    const c1 = openaiToClaudeResponse({
      id: "chatcmpl-txt",
      model: "glm/glm-5.2",
      choices: [{ delta: { content: "Checking weather. " } }],
    }, state);
    const c2 = openaiToClaudeResponse({
      id: "chatcmpl-txt",
      model: "glm/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_t", type: "function" }] }, finish_reason: null }],
    }, state);
    const c3 = openaiToClaudeResponse({
      id: "chatcmpl-txt",
      model: "glm/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "proxy_Read", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
    }, state);

    const events = flatten([c1, c2, c3]);
    const text = events.find((e) => e?.type === "content_block_delta" && e.delta?.type === "text_delta");
    const starts = toolUseStarts(events);

    expect(text?.delta.text).toBe("Checking weather. ");
    expect(starts).toHaveLength(1);
    // Late-arriving name keeps the legacy prefix strip.
    expect(starts[0].content_block.name).toBe("Read");
  });
});
