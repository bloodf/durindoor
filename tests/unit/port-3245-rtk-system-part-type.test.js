// decolua/9router#3245 (issue #3202) — appendToOpenAIMessage was parameterized
// by an `isResponses` boolean; the injector now derives the content-part `type`
// ("text" for chat messages[], "input_text" for Responses input[]) via a shared
// `partType` computed once, so a Cursor-CLI body sent to /v1/chat/completions
// but shaped as Responses input[] (format labelled FORMATS.OPENAI per
// detectFormatByEndpoint) still gets Responses-shaped input_text parts, not
// chat-shaped text parts.
import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const PROMPT = "BE TERSE";

describe("system inject: Cursor-CLI input[] body labelled FORMATS.OPENAI", () => {
  it("prepends a Responses-shaped system item with input_text parts", () => {
    const body = {
      model: "gpt-4o-mini",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    };

    injectSystemPrompt(body, "openai", PROMPT);

    expect(body.input).toHaveLength(2);
    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: PROMPT }],
    });
    expect(body.input[1].role).toBe("user");
    // Regression guard: must never leak the chat-only "text" part type here.
    expect(body.input[0].content.some((p) => p.type === "text")).toBe(false);
  });

  it.each([
    FORMATS.OPENAI_RESPONSES,
    FORMATS.OPENAI_RESPONSE,
    FORMATS.CODEX,
  ])("injects bare string input through %s instructions exactly once", (format) => {
    const body = { model: "gpt-4o-mini", input: "hello" };

    injectSystemPrompt(body, format, PROMPT);
    const afterFirst = structuredClone(body);
    injectSystemPrompt(body, format, PROMPT);

    expect(body.instructions).toBe(PROMPT);
    expect(body.input).toBe("hello");
    expect(body).toEqual(afterFirst);
  });

  it.each([
    FORMATS.OPENAI,
    FORMATS.CURSOR,
    FORMATS.OLLAMA,
  ])("leaves bare string input unchanged for non-Responses format %s", (format) => {
    const body = { model: "gpt-4o-mini", input: "hello" };

    injectSystemPrompt(body, format, PROMPT);

    expect(body).toEqual({ model: "gpt-4o-mini", input: "hello" });
  });
});
