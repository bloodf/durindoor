import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState } from "../../open-sse/translator/index.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

function translate(chunks) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  return chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
}

describe("OpenAI Chat stream to Responses empty tool_calls arrays", () => {
  it("keeps output text open across content chunks carrying empty tool_calls arrays", () => {
    const events = translate([
      { id: "cbcn-test", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [] }, finish_reason: null }] },
      { id: "cbcn-test", choices: [{ index: 0, delta: { content: "cod", tool_calls: [] }, finish_reason: null }] },
      { id: "cbcn-test", choices: [{ index: 0, delta: { content: "ex", tool_calls: [] }, finish_reason: null }] },
      { id: "cbcn-test", choices: [{ index: 0, delta: { content: "-ok", tool_calls: [] }, finish_reason: "stop" }] },
    ]);

    const textDeltas = events.filter((event) => event.event === "response.output_text.delta");
    const textDone = events.filter((event) => event.event === "response.output_text.done");

    expect(textDeltas.map((event) => event.data.delta).join("")).toBe("codex-ok");
    expect(textDone).toHaveLength(1);
    expect(textDone[0].data.text).toBe("codex-ok");
    expect(events.indexOf(textDone[0])).toBeGreaterThan(events.indexOf(textDeltas.at(-1)));
  });

  it("keeps output text open while a real tool call is interleaved", () => {
    const events = translate([
      { id: "tool-test", choices: [{ index: 0, delta: { content: "Let me " }, finish_reason: null }] },
      { id: "tool-test", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "exec", arguments: "" } }] }, finish_reason: null }] },
      { id: "tool-test", choices: [{ index: 0, delta: { content: "run that." }, finish_reason: null }] },
      { id: "tool-test", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);

    const textDone = events.filter((event) => event.event === "response.output_text.done");
    expect(textDone).toHaveLength(1);
    expect(textDone[0].data.text).toBe("Let me run that.");
  });
});
