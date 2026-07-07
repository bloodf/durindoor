import { describe, it, expect } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const P = "You are a helpful assistant.";
const LONG = `${P} `.repeat(50).trim();

function countOccurrences(text, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

describe("injectSystemPrompt deduplication", () => {
  it("injects into a claude string system once", () => {
    const body = { system: "Existing." };
    injectSystemPrompt(body, FORMATS.CLAUDE, P);
    expect(body.system).toContain(P);
    expect(countOccurrences(body.system, P)).toBe(1);
    injectSystemPrompt(body, FORMATS.CLAUDE, P);
    expect(countOccurrences(body.system, P)).toBe(1);
  });

  it("injects into a claude array system once", () => {
    const body = { system: [{ type: "text", text: "Existing." }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P);
    expect(body.system).toHaveLength(2);
    injectSystemPrompt(body, FORMATS.CLAUDE, P);
    expect(body.system).toHaveLength(2);
    expect(
      body.system.filter(b => b.type === "text" && b.text === P)
    ).toHaveLength(1);
  });

  it("inserts claude block before the last cache_control", () => {
    const body = {
      system: [
        { type: "text", text: "Prefix." },
        { type: "text", text: "Cached.", cache_control: { type: "ephemeral" } },
      ],
    };
    injectSystemPrompt(body, FORMATS.CLAUDE, P);
    expect(body.system[1]).toEqual({ type: "text", text: P });
    expect(body.system[2].cache_control).toBeDefined();
  });

  it("injects into openai messages once", () => {
    const body = { messages: [{ role: "system", content: "Existing." }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P);
    expect(countOccurrences(body.messages[0].content, P)).toBe(1);
    injectSystemPrompt(body, FORMATS.OPENAI, P);
    expect(countOccurrences(body.messages[0].content, P)).toBe(1);
  });

  it("injects into openai developer role once", () => {
    const body = { messages: [{ role: "developer", content: "Existing." }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P);
    expect(countOccurrences(body.messages[0].content, P)).toBe(1);
    injectSystemPrompt(body, FORMATS.OPENAI, P);
    expect(countOccurrences(body.messages[0].content, P)).toBe(1);
  });

  it("injects into openai responses instructions once", () => {
    const body = { instructions: "Existing." };
    injectSystemPrompt(body, FORMATS.OPENAI, P);
    expect(countOccurrences(body.instructions, P)).toBe(1);
    injectSystemPrompt(body, FORMATS.OPENAI, P);
    expect(countOccurrences(body.instructions, P)).toBe(1);
  });

  it("injects into openai array content once", () => {
    const body = { messages: [{ role: "system", content: [{ type: "text", text: "Existing." }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P);
    const parts = body.messages[0].content;
    expect(parts.filter(p => p.text === P)).toHaveLength(1);
    injectSystemPrompt(body, FORMATS.OPENAI, P);
    expect(parts.filter(p => p.text === P)).toHaveLength(1);
  });

  it("injects into gemini systemInstruction once", () => {
    const body = { systemInstruction: { parts: [{ text: "Existing." }] } };
    injectSystemPrompt(body, FORMATS.GEMINI, P);
    expect(body.systemInstruction.parts).toHaveLength(2);
    injectSystemPrompt(body, FORMATS.GEMINI, P);
    expect(body.systemInstruction.parts).toHaveLength(2);
  });

  it("injects into gemini snake_case system_instruction once", () => {
    const body = { system_instruction: { parts: [{ text: "Existing." }] } };
    injectSystemPrompt(body, FORMATS.GEMINI, P);
    expect(body.system_instruction.parts).toHaveLength(2);
    injectSystemPrompt(body, FORMATS.GEMINI, P);
    expect(body.system_instruction.parts).toHaveLength(2);
  });

  it("injects into antigravity wrapped request once", () => {
    const body = { request: { systemInstruction: { parts: [{ text: "Existing." }] } } };
    injectSystemPrompt(body, FORMATS.ANTIGRAVITY, P);
    expect(body.request.systemInstruction.parts).toHaveLength(2);
    injectSystemPrompt(body, FORMATS.ANTIGRAVITY, P);
    expect(body.request.systemInstruction.parts).toHaveLength(2);
  });

  it("uses the first 100 chars as a signature, not the full prompt", () => {
    const body = { system: "Existing." };
    injectSystemPrompt(body, FORMATS.CLAUDE, LONG);
    const onlyFirst100 = LONG.slice(0, 100);
    expect(body.system).toContain(onlyFirst100);
    injectSystemPrompt(body, FORMATS.CLAUDE, LONG);
    expect(countOccurrences(body.system, LONG)).toBe(1);
  });

  it("is idempotent across multi-turn calls with a long prompt", () => {
    const body = { messages: [{ role: "system", content: "Existing." }] };
    injectSystemPrompt(body, FORMATS.OPENAI, LONG);
    const afterFirst = JSON.stringify(body);
    injectSystemPrompt(body, FORMATS.OPENAI, LONG);
    const afterSecond = JSON.stringify(body);
    expect(afterSecond).toEqual(afterFirst);
    expect(afterFirst).toContain(LONG.slice(0, 100));
    expect(countOccurrences(afterFirst, LONG)).toBe(1);
  });
});
