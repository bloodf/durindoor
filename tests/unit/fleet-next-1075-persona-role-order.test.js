import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE, CLAUDE_BLOCK } from "../../open-sse/translator/schema/index.js";
import { CLAUDE_SYSTEM_PROMPT } from "../../open-sse/config/appConstants.js";

// Developer is a supported OpenAI instruction role, not an assistant turn.
// Existing persona cases cover multiple system messages but not mixed roles.
describe.each(["claude", "anthropic-compatible-x"])("registered instruction role ordering (%s)", (provider) => {
  it.each([false, true])("preserves mixed system/developer instructions without mutating the caller (stream=%s)", (stream) => {
    const body = {
      messages: [
        { role: ROLE.SYSTEM, content: "You are a translation assistant." },
        { role: ROLE.DEVELOPER, content: "Reply only in French." },
        { role: ROLE.SYSTEM, content: [{ type: CLAUDE_BLOCK.TEXT, text: "Keep proper names unchanged." }] },
        { role: ROLE.DEVELOPER, content: [{ type: CLAUDE_BLOCK.TEXT, text: "Do not add commentary." }] },
        { role: ROLE.USER, content: "Hello" },
      ],
    };
    const before = structuredClone(body);
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4", body, stream, null, provider);
    expect(body).toEqual(before);
    const instructions = "You are a translation assistant.\nReply only in French.\nKeep proper names unchanged.\nDo not add commentary.";
    expect(out.system.map((block) => block.text)).toEqual(
      provider === "claude" ? [CLAUDE_SYSTEM_PROMPT, instructions] : [instructions],
    );
    expect(out.messages).toEqual([{ role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TEXT, text: "Hello" }] }]);
    expect(out.stream).toBe(stream);
  });

  it.each([false, true])("keeps native system blocks ordered without persona duplication (stream=%s)", (stream) => {
    const body = {
      model: "claude-sonnet-4",
      stream,
      system: [
        { type: CLAUDE_BLOCK.TEXT, text: CLAUDE_SYSTEM_PROMPT },
        { type: CLAUDE_BLOCK.TEXT, text: "Keep client instructions last." },
      ],
      messages: [{ role: ROLE.USER, content: "Hello" }],
    };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, body.model, structuredClone(body), stream, null, provider);
    expect(out.system.map((block) => block.text)).toEqual(body.system.map((block) => block.text));
    expect(out.messages).toEqual(body.messages);
    expect(out.stream).toBe(stream);
  });
});
