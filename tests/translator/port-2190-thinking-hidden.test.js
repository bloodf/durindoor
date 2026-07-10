// Regression for upstream decolua/9router#2190 — keep thinking out of visible content.
// A Claude→OpenAI stream must emit reasoning via the reasoning channel, never
// as literal `<think>`/`</think>` text inside `delta.content`. The bug surfaced
// as think tags leaking into user-visible content at thinking block start/stop.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

const freshState = () => ({ messageId: "m1", model: "m", toolCallIndex: 0 });

function collect(events) {
  const state = freshState();
  const out = [];
  for (const ev of events) out.push(...(claudeToOpenAIResponse(ev, state) || []));
  return out;
}

describe("port #2190: thinking stays out of visible content", () => {
  it("emits no literal <think>/</think> text in content deltas", () => {
    const out = collect([
      { type: "message_start", message: { id: "m1", usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } },
      { type: "content_block_stop", index: 1 },
    ]);
    const contentText = out
      .map((e) => e?.choices?.[0]?.delta?.content)
      .filter((s) => typeof s === "string")
      .join("");
    expect(contentText, "<think> leaked into visible content").not.toContain("<think>");
    expect(contentText, "</think> leaked into visible content").not.toContain("</think>");
  });

  it("still surfaces reasoning via the reasoning channel and keeps visible text", () => {
    const out = collect([
      { type: "message_start", message: { id: "m1", usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } },
    ]);
    const json = JSON.stringify(out);
    expect(json, "reasoning content dropped").toContain("secret");
    expect(json, "visible text dropped").toContain("answer");
  });
});
