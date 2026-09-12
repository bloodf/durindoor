import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { anchorClaudeCache, normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const cache = { type: "ephemeral" };
const text = (value, extra = {}) => ({ type: "text", text: value, ...extra });
const tool = (name, extra = {}) => ({
  name,
  description: name,
  input_schema: { type: "object", properties: {} },
  ...extra,
});

function markedBlocks(body) {
  return [
    ...(body.system || []),
    ...(body.tools || []),
    ...(body.messages || []).flatMap((message) => Array.isArray(message.content) ? message.content : [message.content]),
  ].filter((block) => block?.cache_control);
}

describe("Claude cache budget and single-object content", () => {
  it("re-anchors head blocks and trims only excess mixed markers to four", () => {
    const body = {
      system: [text("system-old", { cache_control: cache }), text("system-head")],
      tools: [tool("old", { cache_control: cache }), tool("head"), tool("deferred", { defer_loading: true, cache_control: cache })],
      messages: [
        { role: "user", content: text("early", { cache_control: cache }) },
        {
          role: "assistant",
          content: [
            text("answer-1", { cache_control: cache }),
            { type: "thinking", thinking: "hidden", cache_control: cache },
          ],
        },
        { role: "user", content: [text("later", { cache_control: cache })] },
        {
          role: "assistant",
          content: [
            text("answer-2", { cache_control: cache }),
            { type: "redacted_thinking", data: "hidden", cache_control: cache },
          ],
        },
        { role: "user", content: "next", cache_control: cache },
      ],
    };

    anchorClaudeCache(body);

    expect(markedBlocks(body)).toHaveLength(4);
    expect(body.system.at(-1).cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(body.tools[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(body.tools[2].cache_control).toBeUndefined();
    expect(body.messages[0].content).toEqual([text("early")]);
    expect(body.messages[2].content[0].cache_control).toEqual(cache);
    expect(body.messages[3].content[0].cache_control).toEqual(cache);
    expect(body.messages[1].content[1].cache_control).toBeUndefined();
    expect(body.messages[3].content[1].cache_control).toBeUndefined();
    expect(body.messages[4].cache_control).toBeUndefined();
    expect(body.messages[4].content).toEqual([text("next")]);
  });

  it("keeps exactly four valid markers with the newest message tail anchors", () => {
    const body = {
      system: [text("system")],
      tools: [tool("head")],
      messages: [
        { role: "assistant", content: [text("older", { cache_control: cache })] },
        { role: "user", content: text("newer", { cache_control: cache }) },
        { role: "user", content: [text("next")] },
      ],
    };

    anchorClaudeCache(body);

    expect(markedBlocks(body)).toHaveLength(4);
    expect(body.messages[0].content[0].cache_control).toEqual(cache);
    expect(body.messages[1].content[0].cache_control).toEqual(cache);
  });

  it("preserves bare-object content while passthrough normalization folds system turns", () => {
    const body = {
      messages: [
        { role: "user", content: text("question") },
        { role: "system", content: text("be brief") },
        { role: "user", content: text("continue") },
      ],
    };

    normalizeClaudePassthrough(body, "claude-sonnet-5", "claude", null, { foldSystemTurns: true });

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toEqual([text("question")]);
    expect(body.messages[1].content).toEqual([text("continue"), text("be brief")]);
  });

  it("preserves object text and tool turns through the registered Claude translator", () => {
    const body = {
      tools: [tool("read")],
      messages: [
        { role: "user", content: text("inspect") },
        { role: "assistant", content: { type: "tool_use", id: "call_read", name: "read", input: { path: "a.txt" } } },
        { role: "user", content: { type: "tool_result", tool_use_id: "call_read", content: "contents" } },
      ],
    };

    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "model", structuredClone(body), false);

    expect(out.messages[0]).toEqual({ role: "user", content: "inspect" });
    expect(out.messages[1].tool_calls[0]).toMatchObject({
      id: "call_read",
      function: { name: "read", arguments: JSON.stringify({ path: "a.txt" }) },
    });
    expect(out.messages[2]).toEqual({ role: "tool", tool_call_id: "call_read", content: "contents" });
    expect(out.tools[0].function.name).toBe("read");
  });

  it("preserves a bare-object system reminder through the registered translator", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "model", {
      messages: [
        { role: "user", content: "question" },
        { role: "system", content: text("be brief") },
      ],
    }, false);

    expect(out.messages).toContainEqual({
      role: "user",
      content: "<instructions>\nbe brief\n</instructions>",
    });
  });
});
