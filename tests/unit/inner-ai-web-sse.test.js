// Inner.ai Web reads its upstream event stream through the shared sseFrames reader.
import { describe, expect, it } from "vitest";
import { innerAiWebText } from "../../open-sse/executors/inner-ai-web/events.js";

const encoder = new TextEncoder();
const text = (item) => JSON.stringify({ type: "text", item });
const END = JSON.stringify({ type: "end_stream", item: "end" });

const readerOf = (input, size = 1 << 20) => {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }).getReader();
};

const collect = async (wire, size, options) => {
  const out = [];
  for await (const delta of innerAiWebText(readerOf(wire, size), options)) out.push(delta);
  return out;
};

const lines = (eol, ...frames) => frames.map((frame) => `${frame.join(eol)}${eol}${eol}`).join("");
const WIRES = [
  ["LF", lines("\n", [`data: ${text("one")}`], [`data: ${text("twö")}`], [`data: ${END}`])],
  ["CRLF", lines("\r\n", [`data: ${text("one")}`], [`data: ${text("twö")}`], [`data: ${END}`])],
  ["CR", lines("\r", [`data: ${text("one")}`], [`data: ${text("twö")}`], [`data: ${END}`])],
  ["data: without a space", lines("\n", [`data:${text("one")}`], [`data:${text("twö")}`], [`data:${END}`])],
  ["multi-line data", lines("\n", ['data: {"type":"text",', 'data: "item":"one"}'], [`data: ${text("twö")}`], ['data: {"type":', 'data: "end_stream"}'])],
  ["multi-line data, CRLF, with comments", lines("\r\n", ['data: {"type":"text",', ": ping", 'data: "item":"one"}'], [`data: ${text("twö")}`], [`data: ${END}`])],
  ["comments and keepalives", `: hello\n\ndata:\n\n${lines("\n", [": ping", `data: ${text("one")}`], ["event: status", 'data: {"type":"status"}'], [`data: ${text("twö")}`], [`data: ${END}`])}`],
  ["final frame without a blank line", `${lines("\n", [`data: ${text("one")}`], [`data: ${text("twö")}`])}data: ${END}`],
  ["final frame without a blank line, CR", `${lines("\r", [`data: ${text("one")}`], [`data: ${text("twö")}`])}data: ${END}\r`],
  ["[DONE] before end_stream", lines("\n", [`data: ${text("one")}`], ["data: [DONE]"], [`data: ${text("twö")}`], [`data: ${END}`])],
];

describe.each([1, 2, 3, 1 << 20])("Inner.ai Web SSE frames, chunk size %i", (size) => {
  it.each(WIRES)("%s", async (_name, wire) => {
    expect(await collect(wire, size)).toEqual(["one", "twö"]);
  });

  it("decodes a UTF-8 character split across reads", async () => {
    // Size 1 and 2 split the multi-byte characters themselves.
    expect(await collect(lines("\n", [`data: ${text("héllo 😀")}`], [`data: ${END}`]), size)).toEqual(["héllo 😀"]);
  });

  it("ignores everything after end_stream", async () => {
    expect(await collect(lines("\n", [`data: ${text("a")}`], [`data: ${END}`], [`data: ${text("late")}`], ["data: {broken"]), size)).toEqual(["a"]);
  });

  it.each([
    ["missing_credits"], ["reached_limit"], ["rate_limit_reached"], ["rate_limit_longer_reached"],
  ])("raises a 429 quota error on %s after earlier text", async (type) => {
    const wire = lines("\n", [`data: ${text("partial")}`], [`data: ${JSON.stringify({ type })}`], [`data: ${END}`]);
    const seen = [];
    await expect((async () => { for await (const d of innerAiWebText(readerOf(wire, size))) seen.push(d); })())
      .rejects.toMatchObject({ status: 429, type: "rate_limit_error", code: type });
    expect(seen).toEqual(["partial"]);
  });

  it.each([
    ["bad JSON", lines("\n", ["data: {not json"], [`data: ${END}`])],
    ["a non-object event", lines("\n", ["data: [1]"], [`data: ${END}`])],
    ["an event without a type", lines("\n", ['data: {"item":"x"}'], [`data: ${END}`])],
    ["a non-string text item", lines("\n", ['data: {"type":"text","item":{"secret":true}}'], [`data: ${END}`])],
    ["two JSON events in one frame", lines("\n", [`data: ${text("a")}`, `data: ${text("b")}`], [`data: ${END}`])],
    ["a truncated final frame", `data: ${text("a")}\n\ndata: {"type":"end_str`],
    ["a stream without end_stream", lines("\n", [`data: ${text("a")}`], ["data: [DONE]"])],
    ["an empty body", ""],
  ])("rejects %s as invalid_response", async (_name, wire) => {
    await expect(collect(wire, size)).rejects.toMatchObject({ status: 502, code: "invalid_response" });
  });
});

describe("Inner.ai Web SSE size bound", () => {
  it("rejects a pending frame over the byte limit, counting UTF-8 bytes", async () => {
    // 20 two-byte characters are 40 bytes: over a 32-byte bound though only 20 code units.
    const wire = `data: ${"é".repeat(20)}`;
    await expect(collect(wire, 4, { maxBytes: 32 })).rejects.toMatchObject({ status: 502, code: "invalid_response", message: "Inner.ai Web returned an oversized stream event" });
  });

  it("rejects a complete frame over the byte limit", async () => {
    await expect(collect(lines("\n", [`data: ${text("x".repeat(64))}`], [`data: ${END}`]), 1 << 20, { maxBytes: 32 }))
      .rejects.toMatchObject({ code: "invalid_response", message: "Inner.ai Web returned an oversized stream event" });
  });

  it("accepts frames that each fit, however long the stream", async () => {
    const frames = Array.from({ length: 50 }, () => [`data: ${text("ab")}`]);
    expect((await collect(lines("\n", ...frames, [`data: ${END}`]), 7, { maxBytes: 64 })).join("")).toBe("ab".repeat(50));
  });
});
