import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../../open-sse/translator/schema/index.js";

const imageUrl = (url) => ({ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url } });
const text = (value) => ({ type: OPENAI_BLOCK.TEXT, text: value });

function translate(content, stream, isError = false) {
  const body = {
    messages: [
      { role: ROLE.USER, content: "Take a screenshot" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [
        { id: "shot", type: OPENAI_BLOCK.FUNCTION, function: { name: "screenshot", arguments: "{}" } },
      ] },
      { role: ROLE.TOOL, tool_call_id: "shot", content, ...(isError && { is_error: true }) },
    ],
    tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "screenshot", parameters: { type: "object" } } }],
  };
  const before = structuredClone(body);
  const result = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-6", body, stream);
  expect(body).toEqual(before);
  return result.messages.flatMap((message) => message.content)
    .find((block) => block.type === CLAUDE_BLOCK.TOOL_RESULT);
}

describe.each([false, true])("Chat tool-result images to Claude (stream=%s)", (stream) => {
  it("converts text and data-URI images in order and preserves error semantics", () => {
    expect(translate([text("screen"), imageUrl("data:image/png;base64,AAAA")], stream, true)).toEqual({
      type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "shot", is_error: true,
      content: [text("screen"), { type: CLAUDE_BLOCK.IMAGE, source: { type: "base64", media_type: "image/png", data: "AAAA" } }],
    });
  });

  it.each(["http://example.invalid/a.png", "https://example.invalid/a.png"])("converts a remote image without fetching: %s", (url) => {
    expect(translate([imageUrl(url)], stream).content).toEqual([
      { type: CLAUDE_BLOCK.IMAGE, source: { type: "url", url } },
    ]);
  });

  it("retains already-Claude image blocks", () => {
    const image = { type: CLAUDE_BLOCK.IMAGE, source: { type: "base64", media_type: "image/png", data: "AAAA" } };
    expect(translate([text("screen"), image], stream).content).toEqual([text("screen"), image]);
  });

  it.each(["  exact result\n", ""])("keeps string content byte-identical: %j", (content) => {
    expect(translate(content, stream).content).toBe(content);
  });

  it("drops malformed and unsupported parts instead of forwarding invalid wire shapes", () => {
    const invalid = [null, false, 7, {}, { type: OPENAI_BLOCK.TEXT, text: {} },
      { type: OPENAI_BLOCK.IMAGE_URL }, imageUrl(null), imageUrl(42),
      imageUrl("file:///tmp/a.png"), imageUrl("https://"), imageUrl("data:application/pdf;base64,AAAA"),
      { type: CLAUDE_BLOCK.IMAGE, source: null }, { type: CLAUDE_BLOCK.IMAGE, source: [] },
      { type: CLAUDE_BLOCK.IMAGE, source: {} },
      { type: CLAUDE_BLOCK.IMAGE, source: { type: "url", url: "file:///tmp/a.png" } },
      { type: CLAUDE_BLOCK.IMAGE, source: { type: "base64", media_type: "image/png", data: 42 } },
      { type: "audio", data: "AAAA" }];
    expect(translate([...invalid, text("valid")], stream).content).toEqual([text("valid")]);
    expect(translate(invalid, stream).content).toEqual([]);
  });

  it("preserves cache_control and native document/search_result blocks, skips empty text", () => {
    const cc = { type: "ephemeral" };
    const doc = { type: "document", source: { type: "text", media_type: "text/plain", data: "d" }, cache_control: cc };
    const sr = { type: "search_result", source: "s", title: "t", content: [{ type: "text", text: "x" }] };
    const image = { type: CLAUDE_BLOCK.IMAGE, source: { type: "base64", media_type: "image/png", data: "AAAA" }, cache_control: cc };
    const content = [
      { ...text("keep"), cache_control: cc }, text(""),
      { ...imageUrl("data:image/png;base64,BBBB"), cache_control: cc },
      image, doc, sr,
    ];
    expect(translate(content, stream).content).toEqual([
      { type: CLAUDE_BLOCK.TEXT, text: "keep", cache_control: cc },
      { type: CLAUDE_BLOCK.IMAGE, source: { type: "base64", media_type: "image/png", data: "BBBB" }, cache_control: cc },
      image, doc, sr,
    ]);
  });
});
