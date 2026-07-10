/**
 * MiniMax's explicitly configured M3 OpenAI transport can inline reasoning in
 * complete `<think>` segments. The pure parser must preserve visible bytes and
 * fail open for any malformed token sequence.
 */

import { describe, expect, it } from "vitest";
import {
  createThinkTagStreamExtractor,
  extractThinkTags,
  stripThinkTags,
} from "../../open-sse/utils/thinkStripper.js";

describe("extractThinkTags", () => {
  it("extracts one complete segment without trimming visible text", () => {
    expect(extractThinkTags("before <think>hidden</think> after")).toEqual({
      content: "before  after",
      reasoning: "hidden",
      matched: true,
      malformed: false,
    });
  });

  it("extracts multiple and multiline segments in order", () => {
    const input = "a<think>first\nline</think>b<think>second</think>c";
    expect(extractThinkTags(input)).toEqual({
      content: "abc",
      reasoning: "first\nline\nsecond",
      matched: true,
      malformed: false,
    });
  });

  it("removes empty segments without discarding later reasoning", () => {
    expect(extractThinkTags("<think></think>x<think>kept</think>y")).toEqual({
      content: "xy",
      reasoning: "kept",
      matched: true,
      malformed: false,
    });
  });

  it("reports a complete empty segment without inventing reasoning", () => {
    expect(extractThinkTags("left<think></think>right")).toEqual({
      content: "leftright",
      reasoning: null,
      matched: true,
      malformed: false,
    });
  });

  it("leaves ordinary and non-string content unchanged", () => {
    expect(extractThinkTags("plain")).toEqual({
      content: "plain",
      reasoning: null,
      matched: false,
      malformed: false,
    });
    const structured = [{ type: "text", text: "<think>literal</think>" }];
    expect(extractThinkTags(structured)).toEqual({
      content: structured,
      reasoning: null,
      matched: false,
      malformed: false,
    });
  });

  it.each([
    "<think>unclosed",
    "stray</think>",
    "<think>outer<think>inner</think>end",
    "<think>valid</think><think>unclosed",
    "<think>valid</think></think>",
  ])("fails open byte-for-byte for malformed input %j", (input) => {
    expect(extractThinkTags(input)).toEqual({
      content: input,
      reasoning: null,
      matched: false,
      malformed: true,
    });
    expect(stripThinkTags(input)).toBe(input);
  });
});

describe("stripThinkTags", () => {
  it("uses the validated parser for complete segments", () => {
    expect(stripThinkTags("a<think>b</think>c<think>d</think>e")).toBe("ace");
  });

  it("leaves text without tags unchanged", () => {
    expect(stripThinkTags("no tags here")).toBe("no tags here");
  });
});

describe("createThinkTagStreamExtractor", () => {
  it("handles opening and closing tokens split across chunks", () => {
    const extractor = createThinkTagStreamExtractor();
    expect(extractor.process("<thi")).toEqual({ content: "", reasoning: null, changed: true });
    expect(extractor.process("nk>streamed</thi")).toEqual({ content: "", reasoning: null, changed: true });
    expect(extractor.process("nk>answer")).toEqual({ content: "answer", reasoning: "streamed", changed: true });
    expect(extractor.flush()).toEqual({ content: "", reasoning: null, changed: false });
  });

  it("restores an unclosed segment as visible content at terminal", () => {
    const extractor = createThinkTagStreamExtractor();
    expect(extractor.process("before<think>unfinished")).toEqual({
      content: "before",
      reasoning: null,
      changed: true,
    });
    expect(extractor.flush()).toEqual({
      content: "<think>unfinished",
      reasoning: null,
      changed: true,
    });
  });

  it("fails open and disables extraction after a nested opening tag", () => {
    const extractor = createThinkTagStreamExtractor();
    expect(extractor.process("<think>outer<think>inner")).toEqual({
      content: "<think>outer<think>inner",
      reasoning: null,
      changed: true,
    });
    expect(extractor.process("</think>tail")).toEqual({
      content: "</think>tail",
      reasoning: null,
      changed: false,
    });
  });

  it("fails open for a completed segment followed by a stray close", () => {
    const extractor = createThinkTagStreamExtractor();
    expect(extractor.process("before<think>valid</think></think>after")).toEqual({
      content: "before<think>valid</think></think>after",
      reasoning: null,
      changed: true,
    });
    expect(extractor.flush()).toEqual({ content: "", reasoning: null, changed: false });
  });

  it("rolls back a cross-chunk transaction before it is committed", () => {
    const extractor = createThinkTagStreamExtractor();
    expect(extractor.process("before<think>valid</thi")).toEqual({
      content: "before",
      reasoning: null,
      changed: true,
    });
    expect(extractor.process("nk></think>after")).toEqual({
      content: "<think>valid</think></think>after",
      reasoning: null,
      changed: true,
    });
  });

  it("cannot retract a committed segment when a later chunk is malformed", () => {
    const extractor = createThinkTagStreamExtractor();
    expect(extractor.process("before<think>valid</think>answer")).toEqual({
      content: "beforeanswer",
      reasoning: "valid",
      changed: true,
    });
    expect(extractor.process("</think>after")).toEqual({
      content: "</think>after",
      reasoning: null,
      changed: true,
    });
  });

  it("exposes a pending transaction when extraction must fail open", () => {
    const extractor = createThinkTagStreamExtractor();
    expect(extractor.process("before<think>part")).toEqual({
      content: "before",
      reasoning: null,
      changed: true,
    });
    expect(extractor.failOpen()).toEqual({
      content: "<think>part",
      reasoning: null,
      changed: true,
    });
    expect(extractor.process("ial</think>after")).toEqual({
      content: "ial</think>after",
      reasoning: null,
      changed: false,
    });
  });
});
