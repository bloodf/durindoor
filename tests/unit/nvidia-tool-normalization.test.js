// decolua/9router#3116 — NVIDIA rejects both overlong/invalid tool NAMES and the
// long opaque tool-call IDs other providers mint. Names are normalized for every
// OpenAI-format upstream (with the original restored on the way back); IDs are
// collapsed only for NVIDIA.
import { describe, expect, it } from "vitest";
import {
  normalizeOpenAIToolNames,
  restoreOpenAIToolNames,
  normalizeNvidiaToolCallIds,
  nvidiaToolCallId,
} from "../../open-sse/translator/concerns/toolCall.js";

describe("normalizeOpenAIToolNames", () => {
  it("replaces characters OpenAI's tool-name pattern rejects", () => {
    const body = { tools: [{ function: { name: "mcp.server/read file" } }] };

    const aliases = normalizeOpenAIToolNames(body);

    expect(body.tools[0].function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(aliases.get(body.tools[0].function.name)).toBe("mcp.server/read file");
  });

  it("truncates an overlong name to the limit and keeps it reversible", () => {
    const original = "a".repeat(200);
    const body = { tools: [{ function: { name: original } }] };

    const aliases = normalizeOpenAIToolNames(body);
    const normalized = body.tools[0].function.name;

    expect(normalized.length).toBeLessThanOrEqual(64);
    expect(aliases.get(normalized)).toBe(original);
  });

  // Truncation alone would map both of these to the same name, silently merging
  // two different tools; the hash suffix is what prevents that.
  it("keeps two names that share a long prefix distinct", () => {
    const prefix = "b".repeat(80);
    const body = {
      tools: [
        { function: { name: `${prefix}_alpha` } },
        { function: { name: `${prefix}_beta` } },
      ],
    };

    normalizeOpenAIToolNames(body);

    expect(body.tools[0].function.name).not.toBe(body.tools[1].function.name);
  });

  it("leaves an already-valid name untouched and records no alias", () => {
    const body = { tools: [{ function: { name: "read_file" } }] };

    const aliases = normalizeOpenAIToolNames(body);

    expect(body.tools[0].function.name).toBe("read_file");
    expect(aliases.size).toBe(0);
  });

  it("rewrites the same name consistently across definitions, history, and tool choice", () => {
    const name = "mcp.server/read file";
    const body = {
      tools: [{ function: { name } }, { name }],
      tool_choice: { function: { name } },
      messages: [
        { role: "assistant", tool_calls: [{ function: { name } }] },
        { role: "user", content: [{ type: "tool_use", name }] },
        { role: "tool", name },
      ],
    };

    normalizeOpenAIToolNames(body);
    const normalized = body.tools[0].function.name;

    expect(body.tools[1].name).toBe(normalized);
    expect(body.tool_choice.function.name).toBe(normalized);
    expect(body.messages[0].tool_calls[0].function.name).toBe(normalized);
    expect(body.messages[1].content[0].name).toBe(normalized);
    expect(body.messages[2].name).toBe(normalized);
  });

  it("honors a provider-specific shorter ceiling", () => {
    const body = { tools: [{ function: { name: "c".repeat(40) } }] };

    normalizeOpenAIToolNames(body, 32);

    expect(body.tools[0].function.name.length).toBeLessThanOrEqual(32);
  });
});

describe("restoreOpenAIToolNames", () => {
  it("returns the client's original name in message and delta tool calls", () => {
    const body = { tools: [{ function: { name: "mcp.server/read file" } }] };
    const aliases = normalizeOpenAIToolNames(body);
    const normalized = body.tools[0].function.name;

    const response = {
      choices: [
        { message: { tool_calls: [{ function: { name: normalized } }] } },
        { delta: { tool_calls: [{ function: { name: normalized } }] } },
      ],
    };

    expect(restoreOpenAIToolNames(response, aliases)).toBe(true);
    expect(response.choices[0].message.tool_calls[0].function.name).toBe("mcp.server/read file");
    expect(response.choices[1].delta.tool_calls[0].function.name).toBe("mcp.server/read file");
  });

  it("is a no-op without aliases", () => {
    const response = { choices: [{ message: { tool_calls: [{ function: { name: "read_file" } }] } }] };

    expect(restoreOpenAIToolNames(response, new Map())).toBe(false);
    expect(response.choices[0].message.tool_calls[0].function.name).toBe("read_file");
  });
});

describe("normalizeNvidiaToolCallIds", () => {
  it("collapses long ids to a compact deterministic identifier", () => {
    const id = "call_0123456789abcdef0123456789abcdef";

    expect(nvidiaToolCallId(id)).toMatch(/^[a-f0-9]{9}$/);
    expect(nvidiaToolCallId(id)).toBe(nvidiaToolCallId(id));
  });

  it("leaves an already-compact id alone so repeated passes are stable", () => {
    expect(nvidiaToolCallId("abc123def")).toBe("abc123def");
  });

  // The pairing is the point: a rewritten assistant call and its tool result
  // must still reference each other, or the upstream rejects the conversation.
  it("keeps an assistant call and its tool result pointing at each other", () => {
    const id = "call_0123456789abcdef0123456789abcdef";
    const body = {
      messages: [
        { role: "assistant", tool_calls: [{ id, type: "function", function: { name: "read", arguments: "{}" } }] },
        { role: "tool", tool_call_id: id, content: "ok" },
      ],
    };

    normalizeNvidiaToolCallIds(body);

    expect(body.messages[0].tool_calls[0].id).toMatch(/^[a-f0-9]{9}$/);
    expect(body.messages[1].tool_call_id).toBe(body.messages[0].tool_calls[0].id);
  });

  it("rewrites Claude-shaped tool_use and tool_result blocks together", () => {
    const id = "toolu_0123456789abcdef0123456789abcdef";
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id, name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
      ],
    };

    normalizeNvidiaToolCallIds(body);

    expect(body.messages[0].content[0].id).toMatch(/^[a-f0-9]{9}$/);
    expect(body.messages[1].content[0].tool_use_id).toBe(body.messages[0].content[0].id);
  });
});
