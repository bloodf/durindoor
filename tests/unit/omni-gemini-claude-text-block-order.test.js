// Synthetic, offline fixtures only: no network, no credentials, no provider calls.
import "../translator/registerAll.js";
import { beforeEach, describe, expect, it } from "vitest";
import { geminiToClaudeResponse } from "../../open-sse/translator/response/gemini-to-claude.js";
import { translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  buildGeminiThoughtSignatureKey,
  clearGeminiThoughtSignatureMemoryForTests,
  getGeminiThoughtSignature,
} from "../../open-sse/services/geminiThoughtSignatureStore.js";

const SIGNATURE = "EhAKDmNhY2hlZC1zaWduYXR1cmU=";

const textChunk = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const thoughtChunk = (text) => ({ candidates: [{ content: { parts: [{ thought: true, text }] } }] });
const toolChunk = (id, name, args = {}, extra = {}) => ({
  candidates: [{ content: { parts: [{ functionCall: { id, name, args }, ...extra }] } }],
});
const finishChunk = (finishReason = "STOP", usageMetadata) => ({
  candidates: [{ content: { parts: [] }, finishReason }],
  ...(usageMetadata ? { usageMetadata } : {}),
});

function stream(chunks, state = {}) {
  const events = [];
  for (const chunk of chunks) {
    const result = geminiToClaudeResponse(chunk, state);
    if (result) events.push(...(Array.isArray(result) ? result : [result]));
  }
  return events;
}

const blockTrace = (events) =>
  events.filter((event) => event.type.startsWith("content_block_")).map((event) => `${event.type}:${event.index}`);

// Claude streaming contract: every content block is start -> delta* -> stop,
// blocks are opened in strictly ascending index order, and no event for an
// index may follow that index's content_block_stop.
function expectOrderedBlocks(events) {
  const started = [];
  let open = null;
  for (const event of events.filter((e) => e.type.startsWith("content_block_"))) {
    if (event.type === "content_block_start") {
      expect(open).toBeNull();
      started.push(event.index);
      open = event.index;
      continue;
    }
    expect(open).toBe(event.index);
    if (event.type === "content_block_stop") open = null;
  }
  expect(open).toBeNull();
  expect(started).toEqual([...started].sort((a, b) => a - b));
  expect(new Set(started).size).toBe(started.length);
  return started;
}

beforeEach(() => {
  clearGeminiThoughtSignatureMemoryForTests();
});

describe("Gemini to Claude content block ordering", () => {
  it("closes the open text block before a thought part and resumes text with a fresh index", () => {
    const events = stream([textChunk("Hello"), thoughtChunk("planning"), textChunk("World"), finishChunk("STOP")]);

    expect(blockTrace(events)).toEqual([
      "content_block_start:0",
      "content_block_delta:0",
      "content_block_stop:0",
      "content_block_start:1",
      "content_block_delta:1",
      "content_block_stop:1",
      "content_block_start:2",
      "content_block_delta:2",
      "content_block_stop:2",
    ]);
    expectOrderedBlocks(events);

    const textDeltas = events.filter((event) => event.delta?.type === "text_delta");
    expect(textDeltas.map((event) => event.delta.text)).toEqual(["Hello", "World"]);
    expect(textDeltas.map((event) => event.index)).toEqual([0, 2]);
    expect(events.find((event) => event.content_block?.type === "thinking").content_block.signature).toBe("");
  });

  it("keeps one text block open across consecutive plain text deltas", () => {
    const events = stream([textChunk("A"), textChunk("B"), textChunk("C"), finishChunk("STOP")]);

    expect(blockTrace(events)).toEqual([
      "content_block_start:0",
      "content_block_delta:0",
      "content_block_delta:0",
      "content_block_delta:0",
      "content_block_stop:0",
    ]);
    expectOrderedBlocks(events);
    expect(events.filter((event) => event.delta?.type === "text_delta").map((event) => event.delta.text)).toEqual(["A", "B", "C"]);
  });

  it("orders text, thought and text parts delivered in one chunk", () => {
    const chunk = {
      candidates: [{ content: { parts: [{ text: "one" }, { thought: true, text: "two" }, { text: "three" }] } }],
    };
    const events = stream([chunk, finishChunk("STOP")]);

    expect(blockTrace(events)).toEqual([
      "content_block_start:0",
      "content_block_delta:0",
      "content_block_stop:0",
      "content_block_start:1",
      "content_block_delta:1",
      "content_block_stop:1",
      "content_block_start:2",
      "content_block_delta:2",
      "content_block_stop:2",
    ]);
    expectOrderedBlocks(events);
  });

  it("closes the text block at a tool boundary and opens a fresh text block after the tool", () => {
    const events = stream([
      textChunk("before"),
      toolChunk("toolu_1", "read_file", { path: "a.txt" }),
      textChunk("after"),
      finishChunk("TOOL_CALLS"),
    ]);

    expect(blockTrace(events)).toEqual([
      "content_block_start:0",
      "content_block_delta:0",
      "content_block_stop:0",
      "content_block_start:1",
      "content_block_delta:1",
      "content_block_stop:1",
      "content_block_start:2",
      "content_block_delta:2",
      "content_block_stop:2",
    ]);
    expectOrderedBlocks(events);

    const toolStart = events.find((event) => event.content_block?.type === "tool_use");
    expect(toolStart.index).toBe(1);
    expect(toolStart.content_block.id).toBe("toolu_1");
    expect(toolStart.content_block.name).toBe("read_file");
    const toolDelta = events.find((event) => event.delta?.type === "input_json_delta");
    expect(JSON.parse(toolDelta.delta.partial_json)).toEqual({ path: "a.txt" });
  });

  it("closes the last block before the terminal usage and finish events", () => {
    const events = stream([
      textChunk("done"),
      finishChunk("STOP", { promptTokenCount: 11, candidatesTokenCount: 4, thoughtsTokenCount: 2, cachedContentTokenCount: 3 }),
    ]);

    expect(blockTrace(events)).toEqual(["content_block_start:0", "content_block_delta:0", "content_block_stop:0"]);
    expectOrderedBlocks(events);

    const messageDelta = events.find((event) => event.type === "message_delta");
    expect(messageDelta.delta.stop_reason).toBe("end_turn");
    expect(messageDelta.delta.stop_sequence).toBeNull();
    expect(messageDelta.usage).toEqual({ input_tokens: 11, output_tokens: 6, cache_read_input_tokens: 3 });
    expect(events.at(-1).type).toBe("message_stop");
    expect(events.findIndex((event) => event.type === "content_block_stop")).toBeLessThan(
      events.findIndex((event) => event.type === "message_delta"),
    );
  });

  it("keeps tool identity and thought signature bookkeeping across the boundary", () => {
    const state = { signatureNamespace: "conn-a" };
    const events = stream([
      textChunk("calling"),
      toolChunk("toolu_sig", "Read", { query: "q" }, { thoughtSignature: SIGNATURE }),
      finishChunk("TOOL_CALLS"),
    ], state);

    expectOrderedBlocks(events);
    const toolStart = events.find((event) => event.content_block?.type === "tool_use");
    expect(toolStart.content_block.id).toBe("toolu_sig");
    expect(toolStart.content_block.name).toBe("Read");
    expect(events.find((event) => event.type === "message_delta").delta.stop_reason).toBe("tool_use");
    expect(getGeminiThoughtSignature(buildGeminiThoughtSignatureKey("conn-a", "toolu_sig"))).toBe(SIGNATURE);
  });

  it("orders blocks through the registered direct Gemini to Claude route", () => {
    const state = {};
    const events = [
      ...translateResponse(FORMATS.GEMINI, FORMATS.CLAUDE, textChunk("Hello"), state),
      ...translateResponse(FORMATS.GEMINI, FORMATS.CLAUDE, thoughtChunk("planning"), state),
      ...translateResponse(FORMATS.GEMINI, FORMATS.CLAUDE, textChunk("World"), state),
      ...translateResponse(FORMATS.GEMINI, FORMATS.CLAUDE, finishChunk("STOP"), state),
    ];

    expect(blockTrace(events)).toEqual([
      "content_block_start:0",
      "content_block_delta:0",
      "content_block_stop:0",
      "content_block_start:1",
      "content_block_delta:1",
      "content_block_stop:1",
      "content_block_start:2",
      "content_block_delta:2",
      "content_block_stop:2",
    ]);
    expectOrderedBlocks(events);
    expect(events[0].type).toBe("message_start");
    expect(events.at(-1).type).toBe("message_stop");
  });
});
