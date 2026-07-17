import { describe, expect, it } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

/**
 * Guards fix for issue #2306:
 * When routing Claude Code (Anthropic format) to the Kiro provider, system
 * messages were being converted to plain user messages with no wrapper. This
 * caused the full system prompt to appear as raw user text in the Kiro
 * conversation, leaking context and making the model behave unpredictably.
 *
 * Fix: wrap system message content in <instructions>…</instructions> (Claude
 * models treat these as authoritative directives — upstream PR #2366
 * intentionally changed the wrapper tag from <system-reminder> to
 * <instructions> for this reason) before converting the role to user, so the
 * model can distinguish injected instructions from real user input.
 */
describe("openai-to-kiro: system messages are wrapped in <instructions>", () => {
  const makeRequest = (messages) =>
    openaiToKiroRequest("claude-sonnet-4-5", { messages, stream: false }, false, {
      accessToken: "token",
    });

  it("wraps a string system message in <instructions> tags", () => {
    const req = makeRequest([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ]);
    const allText = JSON.stringify(req);
    expect(allText).toContain("<instructions>");
    expect(allText).toContain("You are a helpful assistant.");
    expect(allText).toContain("</instructions>");
  });

  it("wraps an array-content system message in <instructions> tags", () => {
    const req = makeRequest([
      {
        role: "system",
        content: [{ type: "text", text: "System instructions here." }],
      },
      { role: "user", content: "Hello" },
    ]);
    const allText = JSON.stringify(req);
    expect(allText).toContain("<instructions>");
    expect(allText).toContain("System instructions here.");
    expect(allText).toContain("</instructions>");
  });

  it("does NOT wrap tool messages in <instructions> tags", () => {
    const req = makeRequest([
      { role: "user", content: "call tool" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "tc_1",
            type: "function",
            function: { name: "readFile", arguments: '{"path":"x.txt"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "tc_1", content: "file contents here" },
    ]);
    const allText = JSON.stringify(req);
    expect(allText).toContain("file contents here");
    const instrIdx = allText.indexOf("<instructions>");
    const toolContentIdx = allText.indexOf("file contents here");
    if (instrIdx !== -1) {
      const between = allText.slice(instrIdx, toolContentIdx);
      expect(between).not.toContain("file contents here");
    }
    expect(allText).toContain("file contents here");
  });

  it("user messages are unchanged (no <instructions> wrapping)", () => {
    const req = makeRequest([{ role: "user", content: "regular user message" }]);
    const allText = JSON.stringify(req);
    expect(allText).toContain("regular user message");
    expect(allText).not.toContain("<instructions>");
  });

  it("empty system content does not produce empty <instructions> block", () => {
    const req = makeRequest([
      { role: "system", content: "" },
      { role: "user", content: "Hello" },
    ]);
    const allText = JSON.stringify(req);
    expect(allText).not.toMatch(/<instructions>\s*<\/instructions>/);
  });
});
