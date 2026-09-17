// `hasMediaBlocks` gates the behavioral style-prompt injectors (caveman, ponytail).
// One serialized scan has to cover every wire shape, so the cases below walk the
// formats a request can actually arrive in — plus the two ways a false positive
// would silently disable the token saver for text-only traffic.
import { describe, it, expect } from "vitest";
import { hasMediaBlocks } from "../../open-sse/translator/concerns/modality.js";

describe("hasMediaBlocks", () => {
  it("detects a claude image block", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "hi" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  // Claude Code delivers screenshots this way, nested a level deeper than a plain
  // user message — a per-format tree walk that only checked message content would
  // miss it.
  it("detects an image nested inside tool_result content", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "tool_result", tool_use_id: "t1", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      ] },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  it("detects a claude document block", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "AAA" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  it("detects an openai image_url part", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  it("detects an openai input_audio part", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "input_audio", input_audio: { data: "AAA", format: "wav" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  it("detects a responses input_image part", () => {
    const body = { input: [{ role: "user", content: [
      { type: "input_text", text: "hi" },
      { type: "input_image", image_url: "data:image/png;base64,AAA" },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  it("detects a gemini inlineData part", () => {
    const body = { contents: [{ role: "user", parts: [
      { text: "hi" },
      { inlineData: { mimeType: "image/png", data: "AAA" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  // The whole point of scanning the serialized body: Kiro wraps content in its own
  // envelope, and no per-format walker was ever taught that shape.
  it("detects media inside a kiro conversationState envelope", () => {
    const body = { conversationState: { currentMessage: { userInputMessage: { content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
    ] } } } };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  it("does not flag a text-only request", () => {
    const body = { system: "x", messages: [{ role: "user", content: [
      { type: "text", text: "just text" },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(false);
  });

  // A false positive here silently disables the token saver for ordinary coding
  // traffic, which is why the match is anchored on `"type": "<media>"` rather than
  // a bare word: plenty of tool schemas mention images without carrying one.
  it("does not flag a tool schema that merely names an image property", () => {
    const body = { tools: [{ name: "screenshot", input_schema: { type: "object", properties: {
      image: { type: "string", description: "image id" },
      file: { type: "string", description: "file path" },
    } } }] };
    expect(hasMediaBlocks(body)).toBe(false);
  });

  it("does not flag prose that merely mentions an image", () => {
    const body = { messages: [{ role: "user", content: "can you generate an image_url for me" }] };
    expect(hasMediaBlocks(body)).toBe(false);
  });

  it("returns false for null, undefined and primitives", () => {
    expect(hasMediaBlocks(null)).toBe(false);
    expect(hasMediaBlocks(undefined)).toBe(false);
    expect(hasMediaBlocks("string")).toBe(false);
    expect(hasMediaBlocks(42)).toBe(false);
  });

  // A circular body must not throw out of the gate; no evidence of media means the
  // saver keeps its existing behavior rather than failing the request.
  it("returns false on a non-serializable body instead of throwing", () => {
    const body = { messages: [] };
    body.self = body;
    expect(hasMediaBlocks(body)).toBe(false);
  });
});
