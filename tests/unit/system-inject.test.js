import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("injectSystemPrompt", () => {
  it("uses top-level instructions for openai-responses when instructions is absent (#2508)", () => {
    const body = {
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "respond tersely");

    expect(body.instructions).toBe("respond tersely");
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      },
    ]);
  });

  it("appends top-level instructions for openai-responses", () => {
    const body = {
      instructions: "be helpful",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "respond tersely");

    expect(body.instructions).toBe("be helpful\n\nrespond tersely");
  });

  it("routes codex token-saver prompt to top-level instructions, not input[]", () => {
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };

    injectSystemPrompt(body, FORMATS.CODEX, "be concise");

    expect(body.instructions).toBe("be concise");
    expect(body.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
    ]);
  });

  it("keeps chat completions system injection in messages", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };

    injectSystemPrompt(body, FORMATS.OPENAI, "respond tersely");

    expect(body.messages[0]).toEqual({ role: "system", content: "respond tersely" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("keeps Responses Lite additional_tools schema intact", () => {
    const body = {
      input: [
        { type: "additional_tools", role: "developer", tools: [] },
        { type: "message", role: "developer", content: [{ type: "input_text", text: "base" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "injected");

    expect(body.input[0]).toEqual({ type: "additional_tools", role: "developer", tools: [] });
    expect(body.input[1].content).toEqual([
      { type: "input_text", text: "base" },
      { type: "input_text", text: "injected" },
    ]);
  });

  it("inserts a Lite developer message after additional_tools when missing", () => {
    const body = {
      input: [
        { type: "additional_tools", role: "developer", tools: [] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "injected");

    expect(body.input).toEqual([
      { type: "additional_tools", role: "developer", tools: [] },
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "injected" }],
      },
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]);
  });
});
