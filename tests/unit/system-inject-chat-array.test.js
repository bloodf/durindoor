// decolua/9router#3204 (issue #3202) — the system-prompt injector always pushed
// a Responses-API `{type:"input_text"}` part, even into a chat `messages[]`
// array. Strict chat providers (StepFun) reject that with
// `400 Unrecognized chat message`, so a CAVEMAN-enabled request against such a
// provider failed outright whenever the client sent array-shaped system content.
import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";

const PROMPT = "BE TERSE";

describe("system inject: chat vs responses content parts", () => {
  it("appends a chat-compatible text part to an array system message", () => {
    const body = {
      messages: [
        { role: "system", content: [{ type: "text", text: "original" }] },
        { role: "user", content: "hi" },
      ],
    };

    injectSystemPrompt(body, "openai", PROMPT);

    const parts = body.messages[0].content;
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({ type: "text", text: PROMPT });
    expect(parts.some((p) => p.type === "input_text")).toBe(false);
  });

  // Plain Responses routes to top-level `instructions` (Codex rejects system
  // messages inside input[]). Only the Responses Lite shape — recognised by the
  // additional_tools envelope — appends into input[], and that path must keep
  // the Responses-only input_text part.
  it("keeps the Responses input_text part for a Lite input[] array", () => {
    const body = {
      input: [
        { type: "additional_tools", tools: [] },
        { type: "message", role: "developer", content: [{ type: "input_text", text: "original" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };

    injectSystemPrompt(body, "openai-responses", PROMPT);

    const parts = body.input[1].content;
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({ type: "input_text", text: PROMPT });
  });

  it("appends to top-level instructions for plain Responses", () => {
    const body = { instructions: "original", input: [{ type: "message", role: "user", content: [] }] };

    injectSystemPrompt(body, "openai-responses", PROMPT);

    expect(body.instructions).toContain("original");
    expect(body.instructions).toContain(PROMPT);
  });

  it("still appends to a string system message with the separator", () => {
    const body = { messages: [{ role: "system", content: "original" }] };

    injectSystemPrompt(body, "openai", PROMPT);

    expect(typeof body.messages[0].content).toBe("string");
    expect(body.messages[0].content).toContain("original");
    expect(body.messages[0].content).toContain(PROMPT);
  });

  it("unshifts a bare system message when chat has none", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };

    injectSystemPrompt(body, "openai", PROMPT);

    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT });
  });

  it("inserts a typed developer message when a Lite input[] has none", () => {
    const body = {
      input: [
        { type: "additional_tools", tools: [] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };

    injectSystemPrompt(body, "openai-responses", PROMPT);

    expect(body.input[1]).toMatchObject({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: PROMPT }],
    });
  });

  // Responses Lite puts an additional_tools envelope first; the injected
  // developer message must land after it, never inside it.
  it("keeps the injected developer message after an additional_tools envelope", () => {
    const body = {
      input: [
        { type: "additional_tools", tools: [] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };

    injectSystemPrompt(body, "openai-responses", PROMPT);

    expect(body.input[0].type).toBe("additional_tools");
    expect(body.input[1]).toMatchObject({ type: "message", role: "developer" });
  });

  it("does not inject the same prompt twice", () => {
    const body = { messages: [{ role: "system", content: [{ type: "text", text: "original" }] }] };

    injectSystemPrompt(body, "openai", PROMPT);
    injectSystemPrompt(body, "openai", PROMPT);

    expect(body.messages[0].content).toHaveLength(2);
  });
});
