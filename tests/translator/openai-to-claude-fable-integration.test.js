import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const T = (model, body, provider = "claude") =>
  translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, model, body, true, null, provider, null, [], null, null, null);

describe("OpenAI → Claude Fable/Mythos integration", () => {
  it("cc/claude-fable-5 sanitized capture-equivalent stays adaptive with no thinking blocks", () => {
    const body = {
      model: "cc/claude-fable-5",
      max_completion_tokens: 64000,
      reasoning_effort: "high",
      system: "You are a helpful assistant.",
      messages: [
        { role: "user", content: [{ type: "text", text: "User first message" }] },
        {
          role: "assistant",
          content: "I will use the tools.",
          tool_calls: [
            { id: "call_1", function: { name: "tool_a", arguments: "{}" } },
            { id: "call_2", function: { name: "tool_b", arguments: "{}" } },
            { id: "call_3", function: { name: "tool_c", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "result a" },
        { role: "tool", tool_call_id: "call_2", content: "result b" },
        { role: "tool", tool_call_id: "call_3", content: "result c" },
        { role: "user", content: [{ type: "text", text: "Final user message" }] },
      ],
      tools: [
        { type: "function", function: { name: "tool_a", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "tool_b", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "tool_c", parameters: { type: "object", properties: {} } } },
      ],
    };

    const out = T("cc/claude-fable-5", body, "claude");

    expect(out.model).toMatch(/claude-fable-5$/);
    expect(out.thinking).toEqual(expect.objectContaining({ type: "adaptive" }));

    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants.length).toBeGreaterThan(0);
    for (const assistant of assistants) {
      if (Array.isArray(assistant.content)) {
        expect(assistant.content.some((c) => c.type === "thinking")).toBe(false);
      }
    }

    // All assistant tool_use blocks must correspond to the original tool calls with exact names and empty inputs.
    const toolUses = assistants
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c) => c.type === "tool_use")
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(toolUses).toEqual([
      expect.objectContaining({ type: "tool_use", id: "call_1", name: "tool_a", input: {} }),
      expect.objectContaining({ type: "tool_use", id: "call_2", name: "tool_b", input: {} }),
      expect.objectContaining({ type: "tool_use", id: "call_3", name: "tool_c", input: {} }),
    ]);
  });

  it("claude-fable-5 clean string-content assistant with tool_calls stays adaptive and adds no thinking blocks", () => {
    const body = {
      model: "claude-fable-5",
      reasoning_effort: "high",
      messages: [
        { role: "user", content: "Search for x" },
        {
          role: "assistant",
          content: "ok",
          tool_calls: [{ id: "call_1", function: { name: "search", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "result" },
        { role: "user", content: "next" },
      ],
      tools: [{ type: "function", function: { name: "search", parameters: { type: "object", properties: {} } } }],
    };

    const out = T("claude-fable-5", body, "claude");

    expect(out.model).toBe("claude-fable-5");
    expect(out.thinking).toEqual(expect.objectContaining({ type: "adaptive" }));

    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "ok" }),
        expect.objectContaining({ type: "tool_use", id: "call_1", name: "search", input: {} }),
      ]),
    );
    expect(assistant.content.some((c) => c.type === "thinking")).toBe(false);
  });

  it("claude-fable-5 uses adaptive thinking and removes unsigned synthetic thinking from assistant history", () => {
    const body = {
      model: "claude-fable-5",
      reasoning_effort: "high",
      messages: [
        { role: "user", content: "Search for x" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "I will search now", signature: "invalid-signature" },
            { type: "text", text: "ok" },
          ],
          tool_calls: [{ id: "call_1", function: { name: "search", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "result" },
        { role: "user", content: "next" },
      ],
      tools: [{ type: "function", function: { name: "search", parameters: { type: "object", properties: {} } } }],
    };

    const out = T("claude-fable-5", body, "claude");

    expect(out.model).toBe("claude-fable-5");
    expect(out.thinking).toEqual(expect.objectContaining({ type: "adaptive" }));

    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "ok" }),
        expect.objectContaining({ type: "tool_use", id: "call_1", name: "search", input: {} }),
      ]),
    );
    expect(assistant.content.some((c) => c.type === "thinking")).toBe(false);
  });

  it("claude-mythos-5 uses adaptive thinking and drops default-signature thinking blocks", () => {
    const body = {
      model: "claude-mythos-5",
      reasoning_effort: "high",
      messages: [
        { role: "user", content: "y" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "placeholder", signature: "DEFAULT_THINKING_CLAUDE_SIGNATURE" },
            { type: "text", text: "done" },
          ],
        },
        { role: "user", content: "z" },
      ],
    };

    const out = T("claude-mythos-5", body, "claude");
    expect(out.thinking).toEqual(expect.objectContaining({ type: "adaptive" }));

    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toEqual([expect.objectContaining({ type: "text", text: "done" })]);
    expect(assistant.content.some((c) => c.type === "thinking")).toBe(false);
  });

  it("claude-opus-4 preserves valid signed thinking history and uses enabled thinking", () => {
    // E-form signature: base64 of a buffer whose first byte is 0x12 (Claude marker).
    const validSignature = Buffer.from([0x12, 0x41, 0x42]).toString("base64");
    const body = {
      model: "claude-opus-4",
      reasoning_effort: "high",
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "signed reasoning", signature: validSignature },
            { type: "text", text: "a" },
          ],
        },
        { role: "user", content: "next" },
      ],
    };

    const out = T("claude-opus-4", body, "claude");
    expect(out.thinking).toEqual(expect.objectContaining({ type: "enabled", budget_tokens: expect.any(Number) }));

    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toContainEqual(
      expect.objectContaining({ type: "thinking", thinking: "signed reasoning", signature: validSignature }),
    );
  });
});
