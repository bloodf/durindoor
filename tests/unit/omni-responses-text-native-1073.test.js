import "../translator/registerAll.js";
import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { geminiToClaudeResponse } from "../../open-sse/translator/response/gemini-to-claude.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { applyResponseMasking } from "../../open-sse/services/responseMasking.js";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";

const message = (id, text) => ({ id, type: "message", role: "assistant", content: [{ type: "output_text", text }] });
function textStream(events) {
  const state = {};
  return events.flatMap(e => {
    const result = openaiResponsesToOpenAIResponse(e, state);
    return result ? (Array.isArray(result) ? result : [result]) : [];
  }).map(c => c.choices?.[0]?.delta?.content || "").join("");
}

describe("Responses text and native parts", () => {
  it("recovers only unseen snapshot suffixes across rotated IDs and a reused output index", () => {
    const events = [
      { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "a", delta: "Hel" },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "b", delta: "lo" },
      { type: "response.output_text.done", output_index: 0, content_index: 0, item_id: "c", text: "Hello!" },
      { type: "response.output_item.done", output_index: 0, item: message("d", "Hello!") },
      { type: "response.output_item.done", output_index: 0, item: message("new", "Other") },
      { type: "response.completed", response: { output: [message("new", "Other")] } },
    ];
    expect(textStream(events)).toBe("Hello!Other");
    expect(textStream([{ type: "response.completed", response: { output: [message("only", "Snapshot")] } }])).toBe("Snapshot");
  });

  it("emits empty signatures for translated thinking", () => {
    const openai = openaiToClaudeResponse({ choices: [{ delta: { reasoning_content: "plan" } }] }, {});
    const gemini = geminiToClaudeResponse({ candidates: [{ content: { parts: [{ thought: true, text: "plan" }] } }] }, {});
    expect(openai.find(e => e.content_block?.type === "thinking").content_block.signature).toBe("");
    expect(gemini.find(e => e.content_block?.type === "thinking").content_block.signature).toBe("");
  });

  it("keeps consecutive indexless tool calls distinct", () => {
    const state = {};
    const send = delta => openaiToAntigravityResponse({ choices: [{ delta }] }, state);
    send({ tool_calls: [{ id: "one", function: { name: "first", arguments: '{"a":' } }] });
    send({ tool_calls: [{ function: { arguments: "1}" } }] });
    send({ tool_calls: [{ id: "two", function: { name: "second", arguments: '{"b":2}' } }] });
    const result = openaiToAntigravityResponse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }, state);
    expect(result.response.candidates[0].content.parts.map(part => part.functionCall)).toEqual([
      { id: "one", name: "first", args: { a: 1 } },
      { id: "two", name: "second", args: { b: 2 } },
    ]);
  });

  it("retains native system and user parts when a long system instruction is folded", () => {
    const image = { inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } };
    const input = { request: { systemInstruction: { parts: [{ text: "x".repeat(4001) }, image] }, contents: [{ role: "user", parts: [{ text: "question" }, image] }] } };
    const parts = new AntigravityExecutor().transformRequest("gemini-3.8-flash-tiered", input, true, {}).request.contents[0].parts;
    expect(parts.filter(p => p.inlineData)).toEqual([image, image]);
    expect(parts.map(p => p.text || "").join("")).toContain("question");
    expect(parts.map(p => p.inlineData ? "image" : p.text)).toEqual([
      "[System Instructions]\n", "x".repeat(4001), "image", "\n\n[User Message]\n", "question", "image",
    ]);
  });

  it("leaves opaque reasoning records intact while masking split visible text", async () => {
    const detail = { type: "reasoning.encrypted", index: 7, data: "opaque", extension: { text: "a@b.co" } };
    const frames = [
      { choices: [{ index: 0, delta: { content: "mail a@", reasoning_details: [detail] } }] },
      { choices: [{ index: 0, delta: { content: "b.co" }, finish_reason: "stop" }] },
    ];
    const body = frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
    const result = { success: true, response: new Response(body, { headers: { "content-type": "text/event-stream" } }) };
    const out = await (await applyResponseMasking(result, { mode: "mask" })).response.text();
    const chunks = out.split("\n").filter(l => l.startsWith("data: {")).map(l => JSON.parse(l.slice(6)));
    expect(chunks.flatMap(c => c.choices || []).flatMap(c => c.delta?.reasoning_details || [])).toEqual([detail]);
    expect(chunks.flatMap(c => c.choices || []).map(c => c.delta?.content || "").join("")).toBe("mail [EMAIL_REDACTED]");
  });
});
