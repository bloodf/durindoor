// Port of decolua/9router#4885: Responses reasoning summary parts are separate
// thoughts and must not be joined into one run-on sentence.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const partAdded = (index) => ({ type: "response.reasoning_summary_part.added", item_id: "rs_1", output_index: 0, summary_index: index, part: { type: "summary_text", text: "" } });
const textDelta = (index, delta) => ({ type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: index, delta });

const firstPart = [
  { type: "response.created", response: { id: "resp_1", status: "in_progress", output: [] } },
  partAdded(0),
  textDelta(0, "Checking the input."),
];
const secondPart = [partAdded(1), textDelta(1, "Applying "), textDelta(1, "the check.")];
const completed = { type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } };

function translate(clientFormat, events) {
  const state = initState(clientFormat);
  return [...events, completed, null].flatMap((event) =>
    translateResponse(FORMATS.OPENAI_RESPONSES, clientFormat, structuredClone(event), state) || []);
}
const chatReasoning = (events) => translate(FORMATS.OPENAI, events)
  .map((chunk) => chunk.choices?.[0]?.delta?.reasoning_content).filter(Boolean);

describe("port decolua/9router#4885 - Responses reasoning summary parts", () => {
  it("separates parts with a blank line without touching the first part", () => {
    expect(chatReasoning([...firstPart, ...secondPart]))
      .toEqual(["Checking the input.", "\n\nApplying ", "the check."]);
  });

  it("separates parts in a Claude thinking block", () => {
    const thinking = translate(FORMATS.CLAUDE, [...firstPart, ...secondPart])
      .filter((event) => event.delta?.type === "thinking_delta")
      .map((event) => event.delta.thinking).join("");
    expect(thinking).toBe("Checking the input.\n\nApplying the check.");
  });

  it("leaves a single-part summary unchanged", () => {
    expect(chatReasoning(firstPart)).toEqual(["Checking the input."]);
  });

  it("starts a new response without a leading break", () => {
    const next = [{ type: "response.created", response: { id: "resp_2", status: "in_progress", output: [] } }, partAdded(0), textDelta(0, "Again.")];
    expect(chatReasoning([...firstPart, ...next])).toEqual(["Checking the input.", "Again."]);
  });
});
