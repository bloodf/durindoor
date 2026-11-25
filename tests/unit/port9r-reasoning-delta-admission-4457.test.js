import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { hasValuableContent } from "../../open-sse/utils/streamHelpers.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

const chunk = (delta, finishReason = null) => ({
  id: "chatcmpl-details",
  object: "chat.completion.chunk",
  created: 1758585600,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

const sse = (...chunks) => `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;

async function runPassthrough(input) {
  let completion = null;
  let summary = null;
  const transform = createPassthroughStreamWithLogger(
    "cline", null, null, "m", null, null,
    (result, _usage, _ttft, detail) => { completion = result; summary = detail; },
    null, FORMATS.OPENAI,
  );
  const text = await new Response(new Response(input).body.pipeThrough(transform)).text();
  const deltas = text
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)).choices?.[0]?.delta || {});
  return { deltas, completion, summary };
}

const details = (text) => [{ type: "reasoning.text", text, format: "unknown", index: 0 }];

describe("9router #4457 - reasoning chunks carried in delta.reasoning_details", () => {
  it("admits a delta carrying only a non-empty reasoning_details array", () => {
    const summaryOnly = chunk({ reasoning_details: [{ type: "reasoning.summary", summary: "Planning" }] });

    expect(hasValuableContent(summaryOnly, FORMATS.OPENAI)).toBeTruthy();
  });

  it("still drops an empty delta and an empty reasoning_details array", () => {
    expect(hasValuableContent(chunk({}), FORMATS.OPENAI)).toBeFalsy();
    expect(hasValuableContent(chunk({ reasoning: "", reasoning_details: [] }), FORMATS.OPENAI)).toBeFalsy();
  });

  it("forwards details-only frames, including opaque ones, to a passthrough client", async () => {
    const encrypted = [{ type: "reasoning.encrypted", data: "opaque", index: 1 }];
    const { deltas } = await runPassthrough(sse(
      chunk({ role: "assistant" }),
      chunk({ reasoning_details: details("17 by 23") }),
      chunk({ reasoning_details: encrypted }),
      chunk({ content: "391" }),
      chunk({}, "stop"),
    ));

    expect(deltas.flatMap((delta) => delta.reasoning_details || [])).toEqual([...details("17 by 23"), ...encrypted]);
  });

  it("counts details-only reasoning once in the thinking trace and the stored reply", async () => {
    const { completion, summary } = await runPassthrough(sse(
      chunk({ reasoning_details: details("thinking ") }),
      // Cline sends both shapes with the same text; it must not be counted twice.
      chunk({ reasoning: "hard", reasoning_details: details("hard") }),
      chunk({ content: "391" }),
      chunk({}, "stop"),
    ));

    expect(completion).toEqual({ content: "391", thinking: "thinking hard" });
    expect(summary.providerResponse.choices[0].message.reasoning_content).toBe("thinking hard");
  });
});
