import { describe, expect, it } from "vitest";
import { anchorClaudeCache, normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

describe("Claude passthrough cache-control anchoring", () => {
  it("re-anchors markers after preparation reshapes messages", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "old", cache_control: { type: "ephemeral" } },
            { type: "thinking", thinking: "hidden", cache_control: { type: "ephemeral" } },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "final", cache_control: { type: "ephemeral" } },
            { type: "redacted_thinking", data: "hidden", cache_control: { type: "ephemeral" } },
          ],
        },
        { role: "user", content: [{ type: "text", text: "next", cache_control: { type: "ephemeral" } }] },
      ],
    };

    anchorClaudeCache(body);

    expect(body.messages[0].content[0].cache_control).toBeUndefined();
    expect(body.messages[0].content[1].cache_control).toBeUndefined();
    expect(body.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[1].content[1].cache_control).toBeUndefined();
    expect(body.messages[2].content[0].cache_control).toBeUndefined();
  });

  it("keeps only final system and tool cache breakpoints at one hour", () => {
    const body = {
      system: [
        { type: "text", text: "base", cache_control: { type: "ephemeral" } },
        { type: "text", text: "final", cache_control: { type: "ephemeral" } },
      ],
      tools: [
        { name: "first", cache_control: { type: "ephemeral" } },
        { name: "last", cache_control: { type: "ephemeral" } },
      ],
    };

    anchorClaudeCache(body);

    expect(body.system[0].cache_control).toBeUndefined();
    expect(body.system[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("folds mid-conversation system text into the preceding user turn", () => {
    const body = {
      system: [{ type: "text", text: "stable" }],
      messages: [
        { role: "user", content: "first" },
        { role: "system", content: "volatile reminder" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
    };

    normalizeClaudePassthrough(body);

    expect(body.system).toEqual([{ type: "text", text: "stable" }]);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "volatile reminder" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ]);
  });
});
