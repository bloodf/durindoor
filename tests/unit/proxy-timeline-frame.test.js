import { describe, expect, it } from "vitest";
import { createClientFrameFramer } from "../../open-sse/handlers/chatCore/proxyTimelineFrame.js";

describe("createClientFrameFramer", () => {
  describe("format: sse-lines (repo passthrough)", () => {
    it("finalizes data lines without a blank delimiter", () => {
      const frames = [];
      const framer = createClientFrameFramer({ format: "sse-lines", onFrame: (f) => frames.push(f) });
      framer.push(Buffer.from("data: {\"x\":1}\n"));
      framer.push(Buffer.from("data: {\"x\":2}\n"));
      expect(frames).toEqual(["data: {\"x\":1}", "data: {\"x\":2}"]);
    });

    it("pairs event and data lines then also accepts blank-delimited frames", () => {
      const frames = [];
      const framer = createClientFrameFramer({ format: "sse-lines", onFrame: (f) => frames.push(f) });
      framer.push(Buffer.from("event: message_start\ndata: {\"type\":\"message_start\"}\n"));
      framer.push(Buffer.from("data: {\"x\":3}\n\n"));
      expect(frames).toEqual([
        "event: message_start\ndata: {\"type\":\"message_start\"}",
        "data: {\"x\":3}",
      ]);
    });

    it("does not emit a split data line until the newline arrives", () => {
      const frames = [];
      const framer = createClientFrameFramer({ format: "sse-lines", onFrame: (f) => frames.push(f) });
      framer.push(Buffer.from("data: {\"x\":1}"));
      expect(frames).toEqual([]);
      framer.push(Buffer.from("\n"));
      expect(frames).toEqual(["data: {\"x\":1}"]);
    });

    it("flushes a trailing partial record at EOF", () => {
      const frames = [];
      const framer = createClientFrameFramer({ format: "sse-lines", onFrame: (f) => frames.push(f) });
      framer.push(Buffer.from("data: leftover"));
      framer.flush();
      expect(frames).toEqual(["data: leftover"]);
    });
  });

  describe("format: sse (canonical blank-delimited)", () => {
    it("finalizes only on a blank line, keeping multi-line data as one frame", () => {
      const frames = [];
      const framer = createClientFrameFramer({ format: "sse", onFrame: (f) => frames.push(f) });
      framer.push(Buffer.from("data: a\ndata: b\n\n"));
      expect(frames).toEqual(["data: a\ndata: b"]);
    });

    it("does not finalize on a data: line alone", () => {
      const frames = [];
      const framer = createClientFrameFramer({ format: "sse", onFrame: (f) => frames.push(f) });
      framer.push(Buffer.from("data: {\"x\":1}\n"));
      framer.push(Buffer.from("data: {\"x\":2}\n"));
      expect(frames).toEqual([]);
    });

    it("emits separate frames for separate blank-delimited records", () => {
      const frames = [];
      const framer = createClientFrameFramer({ format: "sse", onFrame: (f) => frames.push(f) });
      framer.push(Buffer.from("event: message_start\ndata: {\"type\":\"message_start\"}\n\n"));
      framer.push(Buffer.from("data: {\"x\":3}\n\n"));
      expect(frames).toEqual([
        "event: message_start\ndata: {\"type\":\"message_start\"}",
        "data: {\"x\":3}",
      ]);
    });

    it("flushes a non-empty pending tail at EOF", () => {
      const frames = [];
      const framer = createClientFrameFramer({ format: "sse", onFrame: (f) => frames.push(f) });
      framer.push(Buffer.from("data: leftover"));
      framer.flush();
      expect(frames).toEqual(["data: leftover"]);
    });
  });

  describe("format: ndjson", () => {
    it("splits Ollama NDJSON on newlines", () => {
      const frames = [];
      const framer = createClientFrameFramer({ format: "ndjson", onFrame: (f) => frames.push(f) });
      framer.push(Buffer.from("{\"a\":1}\n{\"a\":2}\n"));
      expect(frames).toEqual(['{"a":1}', '{"a":2}']);
    });
  });

  describe("unknown format", () => {
    it("throws for an unrecognized format", () => {
      expect(() => createClientFrameFramer({ format: "nope", onFrame: () => {} })).toThrow();
    });
  });
});
