import { describe, expect, it } from "vitest";
import { frameCarriesContent } from "../../open-sse/utils/streamContentPeek.js";

const frame = (value) => `data: ${JSON.stringify(value)}`;

describe("combo stream reasoning", () => {
  it("recognizes completed reasoning summaries", () => {
    expect(frameCarriesContent(frame({ type: "response.reasoning_summary_text.done", text: "thought" }))).toBe(true);
    expect(frameCarriesContent(frame({ type: "response.output_item.done", item: { type: "reasoning", summary: [{ text: "thought" }] } }))).toBe(true);
  });
  it("rejects empty reasoning and metadata", () => {
    expect(frameCarriesContent(frame({ type: "response.output_item.done", item: { type: "reasoning", summary: [] } }))).toBe(false);
    expect(frameCarriesContent(frame({ type: "response.reasoning_summary_text.done", text: "" }))).toBe(false);
    expect(frameCarriesContent(frame({ choices: [{ delta: { role: "assistant" } }] }))).toBe(false);
  });
});
