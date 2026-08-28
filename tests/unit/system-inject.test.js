import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

describe("injectSystemPrompt", () => {
  it("injects openai-responses input[] by its Responses wire shape", () => {
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

    expect(body.instructions).toBeUndefined();
    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "respond tersely" }],
    });
    expect(body.input[1].role).toBe("user");
  });

  it("appends top-level instructions for openai-responses", () => {
    const body = {
      instructions: "be helpful",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "respond tersely");

    expect(body.instructions).toBe("be helpful\n\nrespond tersely");
  });

  it("injects Codex input[] by its Responses wire shape", () => {
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };

    injectSystemPrompt(body, FORMATS.CODEX, "be concise");

    expect(body.instructions).toBeUndefined();
    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "be concise" }],
    });
    expect(body.input[1].role).toBe("user");
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

  it.each([
    ["nonempty", "codex preamble"],
    ["empty", ""],
  ])("keeps %s Responses Lite instructions unchanged", (_label, instructions) => {
    const body = {
      instructions,
      input: [
        { type: "additional_tools", role: "developer", tools: [] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "injected");
    const afterFirst = structuredClone(body);
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "injected");

    expect(body.instructions).toBe(instructions);
    expect(body.input).toEqual([
      { type: "additional_tools", role: "developer", tools: [] },
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "injected" }],
      },
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]);
    expect(body).toEqual(afterFirst);
  });
});

describe("upstream #3491 wire-safe injection", () => {
  it("retains distinct same-prefix prompts exactly once", () => {
    const shared = "x".repeat(150);
    const first = `${shared}-caveman`;
    const second = `${shared}-ponytail`;
    const body = { messages: [{ role: "system", content: "base" }] };

    injectSystemPrompt(body, FORMATS.OPENAI, first);
    injectSystemPrompt(body, FORMATS.OPENAI, second);
    injectSystemPrompt(body, FORMATS.OPENAI, first);
    injectSystemPrompt(body, FORMATS.OPENAI, second);

    expect(body.messages[0].content).toBe(`base\n\n${first}\n\n${second}`);
  });

  it("injects Kiro into current user content without inventing systemPrompt", () => {
    const body = {
      conversationState: {
        currentMessage: { userInputMessage: { content: "existing Kiro content", modelId: "model" } },
        history: [],
      },
    };

    injectSystemPrompt(body, FORMATS.KIRO, "respond tersely");
    injectSystemPrompt(body, FORMATS.KIRO, "respond tersely");

    expect(body.conversationState.currentMessage.userInputMessage.content).toBe(
      "respond tersely\n\nexisting Kiro content",
    );
    expect(body).not.toHaveProperty("systemPrompt");
  });

  it("injects into a translated Kiro current message exactly once", () => {
    const body = openaiToKiroRequest(
      "claude-sonnet-4.5",
      { messages: [{ role: "user", content: "hi" }] },
      false,
      { profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/test" },
    );

    injectSystemPrompt(body, FORMATS.KIRO, "respond tersely");
    const afterFirst = structuredClone(body);
    injectSystemPrompt(body, FORMATS.KIRO, "respond tersely");

    const content = body.conversationState.currentMessage.userInputMessage.content;
    expect(content).toMatch(/^respond tersely\n\n\[Context: Current time/);
    expect(body).not.toHaveProperty("systemPrompt");
    expect(body).toEqual(afterFirst);
  });

  it("creates systemInstruction on a translated Gemini body without a system message", () => {
    const body = openaiToGeminiRequest(
      "gemini-2.5-pro",
      { messages: [{ role: "user", content: "hi" }] },
      false,
    );

    injectSystemPrompt(body, FORMATS.GEMINI, "respond tersely");

    expect(body.systemInstruction?.parts).toEqual([{ text: "respond tersely" }]);
  });

  it("injects once before the translated Claude cache-control block", () => {
    const body = openaiToClaudeRequest(
      "claude-sonnet-4.5",
      {
        messages: [
          { role: "system", content: "base" },
          { role: "user", content: "hi" },
        ],
      },
      false,
    );

    injectSystemPrompt(body, FORMATS.CLAUDE, "respond tersely");
    injectSystemPrompt(body, FORMATS.CLAUDE, "respond tersely");

    expect(body.system.at(-2)).toEqual({ type: "text", text: "respond tersely" });
    expect(body.system.at(-1).cache_control).toBeDefined();
    expect(body.system.filter((block) => block.text === "respond tersely")).toHaveLength(1);
    expect(body.messages.some((message) => message.role === "system")).toBe(false);
  });

  it("preserves non-message Responses items while injecting by wire shape", () => {
    const functionCall = { type: "function_call", call_id: "call-1", name: "lookup" };
    const reasoning = { type: "reasoning", summary: [{ type: "summary_text", text: "work" }] };
    const body = {
      input: [
        functionCall,
        { type: "message", role: "developer", content: [{ type: "input_text", text: "base" }] },
        reasoning,
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI, "respond tersely");

    expect(body.input).toEqual([
      functionCall,
      {
        type: "message",
        role: "developer",
        content: [
          { type: "input_text", text: "base" },
          { type: "input_text", text: "respond tersely" },
        ],
      },
      reasoning,
    ]);
  });

  it("deduplicates against every eligible system or developer message", () => {
    const body = {
      messages: [
        { role: "system", content: "base" },
        { role: "developer", content: "respond tersely" },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI, "respond tersely");

    expect(body.messages).toEqual([
      { role: "system", content: "base" },
      { role: "developer", content: "respond tersely" },
    ]);
  });

  it("creates Claude system content when its labeled body has no wire block", () => {
    const body = { metadata: { request: "Claude passthrough" } };

    injectSystemPrompt(body, FORMATS.CLAUDE, "respond tersely");

    expect(body).toEqual({
      metadata: { request: "Claude passthrough" },
      system: "respond tersely",
    });
  });

  it("leaves an unlabeled body without an injectable wire shape untouched", () => {
    const body = { metadata: { request: "unknown" } };

    injectSystemPrompt(body, "unknown", "respond tersely");

    expect(body).toEqual({ metadata: { request: "unknown" } });
  });

  it("treats a Claude label as the final wire format before generic messages", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
    };

    injectSystemPrompt(body, FORMATS.CLAUDE, "respond tersely");

    expect(body.system).toBe("respond tersely");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("prefers Responses input over a stray Gemini system field", () => {
    const body = {
      systemInstruction: { parts: [{ text: "stray Gemini field" }] },
      input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: "base" }] }],
    };

    injectSystemPrompt(body, FORMATS.GEMINI, "respond tersely");

    expect(body.systemInstruction.parts).toEqual([{ text: "stray Gemini field" }]);
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "base" },
      { type: "input_text", text: "respond tersely" },
    ]);
  });

  it("executes Chat and Responses wire paths without hidden helper failures", () => {
    const chat = { messages: [{ role: "user", content: "hello" }] };
    const responses = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] };

    expect(() => injectSystemPrompt(chat, FORMATS.OPENAI, "respond tersely")).not.toThrow();
    expect(() => injectSystemPrompt(responses, FORMATS.OPENAI_RESPONSES, "respond tersely")).not.toThrow();
    expect(chat.messages[0]).toEqual({ role: "system", content: "respond tersely" });
    expect(responses.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "respond tersely" }],
    });
  });

  it("fails open for frozen and hostile wire-shape mutations", () => {
    const instructions = Object.freeze({ instructions: "base" });
    const chat = { messages: Object.freeze([]) };
    const responses = { input: Object.freeze([]) };
    const claude = { system: Object.freeze([{ type: "text", text: "base" }]) };
    const gemini = { systemInstruction: { parts: Object.freeze([{ text: "base" }]) } };
    const kiroMessage = Object.freeze({ content: "base", modelId: "model" });
    const kiro = { conversationState: { currentMessage: { userInputMessage: kiroMessage } } };
    const hostile = new Proxy({ instructions: "base" }, {
      set() { throw new Error("blocked"); },
    });

    for (const [body, format] of [
      [instructions, FORMATS.OPENAI],
      [chat, FORMATS.OPENAI],
      [responses, FORMATS.OPENAI_RESPONSES],
      [claude, FORMATS.CLAUDE],
      [gemini, FORMATS.GEMINI],
      [kiro, FORMATS.KIRO],
      [hostile, FORMATS.OPENAI],
    ]) {
      expect(() => injectSystemPrompt(body, format, "respond tersely")).not.toThrow();
    }

    expect(instructions.instructions).toBe("base");
    expect(chat.messages).toHaveLength(0);
    expect(responses.input).toHaveLength(0);
    expect(claude.system).toHaveLength(1);
    expect(gemini.systemInstruction.parts).toHaveLength(1);
    expect(kiroMessage.content).toBe("base");
    expect(hostile.instructions).toBe("base");
  });

  it("fails open for null and malformed bodies", () => {
    expect(() => injectSystemPrompt(null, FORMATS.OPENAI, "respond tersely")).not.toThrow();
    expect(() => injectSystemPrompt("malformed", FORMATS.OPENAI, "respond tersely")).not.toThrow();
  });
});
