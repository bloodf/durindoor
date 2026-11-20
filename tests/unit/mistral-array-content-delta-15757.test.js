// G-a2-1 / OmniRoute #15757: Mistral reasoning models (e.g. `labs-leanstral-1-5`)
// stream `choices[].delta.content` as typed part arrays instead of a string:
//
//   {"delta": {"content": [{"type": "thinking", "thinking": [{"type": "text", "text": "The"}]}]}}
//
// The Responses translator forwarded that array verbatim as
// `response.output_text.delta.delta`, which strict Responses clients reject
// ("malformed response.output_text.delta delta"), and Chat-Completions
// passthrough clients received a non-string `content`.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  normalizeArrayContentChunk,
  normalizeArrayContentDelta,
} from "../../open-sse/utils/arrayContentDelta.js";

const thinking = (text) => ({
  content: [{ type: "thinking", thinking: [{ type: "text", text }] }],
});
const text = (value) => ({ content: [{ type: "text", text: value }] });

/** Feed OpenAI chat chunks through the Responses response translator. */
function responsesEvents(chunks, requestBody = { input: "hello" }) {
  const state = initState(FORMATS.OPENAI_RESPONSES, requestBody);
  return chunks.flatMap((chunk) =>
    translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state));
}

const chunk = (delta, finishReason = null) => ({
  id: "cmpl_mistral",
  object: "chat.completion.chunk",
  created: 1,
  model: "labs-leanstral-1-5",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

const textDeltas = (events) =>
  events.filter((e) => e.event === "response.output_text.delta").map((e) => e.data.delta);

const reasoningDeltas = (events) =>
  events
    .filter((e) => e.event === "response.reasoning_summary_text.delta")
    .map((e) => e.data.delta);

describe("Mistral typed content-part arrays (OmniRoute #15757)", () => {
  it("emits string output_text deltas for array content", () => {
    const events = responsesEvents([
      chunk({ role: "assistant", content: "" }),
      chunk(thinking("The user")),
      chunk(thinking(" wants a greeting.")),
      chunk(text("Hi ")),
      chunk({ content: "there!" }),
      chunk({}, "stop"),
    ]);

    const deltas = textDeltas(events);
    expect(deltas.length).toBeGreaterThan(0);
    for (const delta of deltas) expect(typeof delta).toBe("string");
    expect(deltas.join("")).toBe("Hi there!");
    expect(reasoningDeltas(events).join("")).toBe("The user wants a greeting.");
  });

  it("keeps a plain string content delta untouched", () => {
    const events = responsesEvents([chunk({ content: "hello" })]);
    expect(textDeltas(events)).toEqual(["hello"]);
  });

  it("normalizes a delta in place and reports the change", () => {
    const plain = { content: "hello" };
    expect(normalizeArrayContentDelta(plain)).toBe(false);
    expect(plain).toEqual({ content: "hello" });

    const mixed = {
      reasoning_content: "a",
      content: [
        { type: "thinking", thinking: "b" },
        { type: "text", text: "c" },
        { type: "thinking", thinking: [{ type: "text", text: "d" }] },
        { type: "image_url", image_url: { url: "x" } },
      ],
    };
    expect(normalizeArrayContentDelta(mixed)).toBe(true);
    expect(mixed).toEqual({ reasoning_content: "abd", content: "c" });

    const thinkingOnly = thinking("e");
    expect(normalizeArrayContentDelta(thinkingOnly)).toBe(true);
    expect(thinkingOnly).toEqual({ reasoning_content: "e" });
  });

  it("normalizes every choice delta of a chat-completion chunk", () => {
    const parsed = {
      choices: [
        { index: 0, delta: thinking("x") },
        { index: 1, delta: text("y") },
      ],
    };
    expect(normalizeArrayContentChunk(parsed)).toBe(true);
    expect(parsed.choices[0].delta).toEqual({ reasoning_content: "x" });
    expect(parsed.choices[1].delta).toEqual({ content: "y" });

    expect(normalizeArrayContentChunk({ choices: [] })).toBe(false);
    expect(normalizeArrayContentChunk(null)).toBe(false);
  });

  it("appends thinking text to an existing reasoning_content", () => {
    const delta = { reasoning_content: "pre", content: [{ type: "thinking", thinking: "post" }] };
    expect(normalizeArrayContentDelta(delta)).toBe(true);
    expect(delta).toEqual({ reasoning_content: "prepost" });
  });
});
