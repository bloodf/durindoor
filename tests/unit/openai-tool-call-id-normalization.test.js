import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const validToolCallId = /^[a-zA-Z0-9_-]+$/;
const overlongId = `call_${"a".repeat(81)}`;

function toolCall(id, name = "lookup") {
  return { id, type: "function", function: { name, arguments: "{}" } };
}

function request(messages) {
  return { model: "gpt-5.6-luna", messages, stream: false };
}

describe("official OpenAI tool-call ID normalization", () => {
  it("normalizes an overlong ID and preserves its call/result relationship", () => {
    const shortId = "call_short_1";
    const out = new DefaultExecutor("openai").transformRequest("gpt-5.6-luna", request([
      { role: "assistant", content: null, tool_calls: [toolCall(shortId)] },
      { role: "tool", tool_call_id: shortId, content: "short result" },
      { role: "assistant", content: null, tool_calls: [toolCall(overlongId)] },
      { role: "tool", tool_call_id: overlongId, content: "long result" },
    ]), true);

    const normalized = out.messages[2].tool_calls[0].id;
    expect(normalized).toHaveLength(64);
    expect(normalized).toMatch(validToolCallId);
    expect(out.messages[3].tool_call_id).toBe(normalized);
    expect(out.messages[0].tool_calls[0].id).toBe(shortId);
    expect(out.messages[1].tool_call_id).toBe(shortId);
  });

  it("uses one normalized ID for repeated occurrences in either order", () => {
    const out = new DefaultExecutor("openai").transformRequest("gpt-5.6-luna", request([
      { role: "tool", tool_call_id: overlongId, content: "result first" },
      { role: "assistant", content: null, tool_calls: [toolCall(overlongId, "first")] },
      { role: "tool", tool_call_id: overlongId, content: "result again" },
      { role: "assistant", content: null, tool_calls: [toolCall(overlongId, "again")] },
    ]), true);

    const ids = [
      out.messages[0].tool_call_id,
      out.messages[1].tool_calls[0].id,
      out.messages[2].tool_call_id,
      out.messages[3].tool_calls[0].id,
    ];
    expect(new Set(ids)).toEqual(new Set([ids[0]]));
  });

  it("keeps long IDs distinct when their truncated prefixes collide", () => {
    const sharedPrefix = `call_${"z".repeat(80)}`;
    const firstId = `${sharedPrefix}x`;
    const secondId = `${sharedPrefix}y`;
    const out = new DefaultExecutor("openai").transformRequest("gpt-5.6-luna", request([
      { role: "assistant", content: null, tool_calls: [toolCall(firstId), toolCall(secondId)] },
      { role: "tool", tool_call_id: firstId, content: "first" },
      { role: "tool", tool_call_id: secondId, content: "second" },
    ]), true);

    const [first, second] = out.messages[0].tool_calls.map(({ id }) => id);
    expect(first).not.toBe(second);
    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(out.messages[1].tool_call_id).toBe(first);
    expect(out.messages[2].tool_call_id).toBe(second);
  });

  it.each(["openrouter", "openai-compatible-custom"])("leaves IDs untouched for %s", (provider) => {
    const out = new DefaultExecutor(provider).transformRequest("gpt-5.6-luna", request([
      { role: "assistant", content: null, tool_calls: [toolCall(overlongId)] },
      { role: "tool", tool_call_id: overlongId, content: "result" },
    ]), true);

    expect(out.messages[0].tool_calls[0].id).toBe(overlongId);
    expect(out.messages[1].tool_call_id).toBe(overlongId);
  });
});
