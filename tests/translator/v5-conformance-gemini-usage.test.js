import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { GEMINI_FINISH, GEMINI_ROLE, OPENAI_FINISH, ROLE } from "../../open-sse/translator/schema/index.js";

const usageMetadata = {
  promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2,
  totalTokenCount: 15, cachedContentTokenCount: 4,
};
const native = (parts, usage = usageMetadata) => ({
  responseId: "gemini-conformance", modelVersion: "gemini-test",
  candidates: [{ index: 0, content: { role: GEMINI_ROLE.MODEL, parts }, finishReason: GEMINI_FINISH.STOP }],
  usageMetadata: usage,
});
const completion = (usage) => ({
  id: "chat-conformance", model: "gemini-test", object: "chat.completion",
  choices: [{ index: 0, message: { role: ROLE.ASSISTANT, content: "answer" }, finish_reason: OPENAI_FINISH.STOP }],
  usage,
});

describe("#1089 Gemini thought and candidate accounting", () => {
  it.each([
    ["true", { text: "private reasoning", thought: true }, "", "private reasoning"],
    ["absent", { text: "public answer" }, "public answer", ""],
    ["false", { text: "public answer", thought: false }, "public answer", ""],
    ["signature without flag", { text: "public answer", thoughtSignature: "opaque-signature" }, "public answer", ""],
  ])("keeps thought=%s identical across registered stream and JSON dispatch", (_label, part, content, reasoning) => {
    const body = native([part]);
    const chunks = translateResponse(FORMATS.GEMINI, FORMATS.OPENAI, body, initState(FORMATS.OPENAI));
    const deltas = chunks.map((chunk) => chunk.choices[0].delta);
    expect(deltas.map((delta) => delta.content || "").join("")).toBe(content);
    expect(deltas.map((delta) => delta.reasoning_content || "").join("")).toBe(reasoning);
    const json = translateNonStreamingResponse(body, FORMATS.GEMINI, FORMATS.OPENAI);
    expect(json.choices[0].message.content || "").toBe(content);
    expect(json.choices[0].message.reasoning_content || "").toBe(reasoning);
    const expected = {
      prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 2 },
    };
    expect(chunks.find((chunk) => chunk.usage).usage).toMatchObject(expected);
    expect(json.usage).toMatchObject(expected);
  });

  it.each([
    ["positive", 2, 3], ["zero", 0, 5], ["all reasoning", 5, 0], ["overreported reasoning", 8, 0],
  ])("subtracts %s reasoning exactly once when projecting Chat JSON to Gemini", (_label, reasoning, candidates) => {
    const result = translateNonStreamingResponse(completion({
      prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: reasoning },
    }), FORMATS.OPENAI, FORMATS.GEMINI);
    expect(result.usageMetadata).toEqual({
      promptTokenCount: 10, candidatesTokenCount: candidates, totalTokenCount: 15,
      thoughtsTokenCount: reasoning, cachedContentTokenCount: 0,
    });
    expect(result).not.toHaveProperty("candidateTokenCount");
    expect(result.usageMetadata).not.toHaveProperty("candidateTokenCount");
    expect(result).not.toHaveProperty("response");
    expect(result).not.toHaveProperty("choices");
  });

  it("does not invent thought or cache counts when OpenAI detail fields are absent", () => {
    const result = translateNonStreamingResponse(completion({
      prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
    }), FORMATS.OPENAI, FORMATS.GEMINI);
    expect(result.usageMetadata).toEqual({ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 });
  });

  it("round-trips mixed public and private text without leaking thoughts or double-counting usage", () => {
    const body = native([{ text: "private", thought: true }, { text: "answer" }]);
    const chat = translateNonStreamingResponse(body, FORMATS.GEMINI, FORMATS.OPENAI);
    expect(chat.choices[0].message).toMatchObject({ content: "answer", reasoning_content: "private" });
    const restored = translateNonStreamingResponse(chat, FORMATS.OPENAI, FORMATS.GEMINI);
    expect(restored.usageMetadata).toEqual(usageMetadata);
    expect(restored.candidates[0].content.parts).toEqual([
      { thought: true, text: "private" }, { text: "answer" },
    ]);
    expect(translateNonStreamingResponse(body, FORMATS.GEMINI, FORMATS.GEMINI)).toBe(body);
  });
});
