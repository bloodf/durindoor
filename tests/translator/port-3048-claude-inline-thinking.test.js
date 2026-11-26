import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const chunk = (delta, finishReason = null) => ({
  id: "chatcmpl-12345678",
  model: "MiniMax-M3",
  choices: [{ index: 0, delta, finish_reason: finishReason }]
});

function run(chunks, { provider = "minimax", requestedModel = "MiniMax-M3", ...extra } = {}) {
  const state = { ...initState(FORMATS.CLAUDE), provider, requestedModel, ...extra };
  return chunks.flatMap((value) => translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, value, state) || []);
}

// [block type, joined payload] for every content block, in wire order.
function blocks(events) {
  const found = new Map();
  for (const event of events) {
    if (event.type === "content_block_start") found.set(event.index, [event.content_block.type, ""]);
    if (event.type === "content_block_delta") {
      found.get(event.index)[1] += event.delta.thinking ?? event.delta.text ?? "";
    }
  }
  return [...found.values()];
}

describe("upstream #3048: inline <think> on the streaming OpenAI to Claude path", () => {
  it("moves tags split across chunks into a thinking block, keeping placement", () => {
    const events = run([
      chunk({ content: "Before<thi" }),
      chunk({ content: "nk>inside</th" }),
      chunk({ content: "ink>after" }),
      chunk({}, "stop")
    ]);

    expect(blocks(events)).toEqual([["text", "Before"], ["thinking", "inside"], ["text", "after"]]);
    expect(events.at(-1).type).toBe("message_stop");
  });

  it("keeps native reasoning and inline reasoning in one thinking block", () => {
    const events = run([
      chunk({ reasoning_content: "field. " }),
      chunk({ content: "<think>tag.</think>final" }, "stop")
    ]);

    expect(blocks(events)).toEqual([["thinking", "field. tag."], ["text", "final"]]);
  });

  it.each([
    ["a finish_reason", [chunk({ content: "<think>unclosed" }), chunk({}, "stop")]],
    ["a truncated stream", [chunk({ content: "<think>unclosed" }), null]]
  ])("restores an unclosed tag as literal text on %s", (_name, chunks) => {
    const events = run(chunks);

    expect(blocks(events)).toEqual([["text", "<think>unclosed"]]);
    expect(events.at(-1).type).toBe("message_stop");
  });

  it("leaves literal tags alone for a model without the registry quirk", () => {
    const events = run([chunk({ content: "<think>literal</think>" }, "stop")], {
      provider: "openai",
      requestedModel: "gpt-5"
    });

    expect(blocks(events)).toEqual([["text", "<think>literal</think>"]]);
  });

  it("drops inline reasoning for Claude-compatible clients like native reasoning", () => {
    const events = run([chunk({ content: "<think>hidden</think>shown" }, "stop")], { claudeCompat: true });

    expect(blocks(events)).toEqual([["text", "shown"]]);
  });
});
