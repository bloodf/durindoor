// OpenAI → Kiro (AWS CodeWhisperer) request translation.
import { describe, it, expect, vi } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { prefetchRemoteImages } from "../../open-sse/translator/concerns/prefetch.js";
import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";

vi.mock("../../open-sse/translator/concerns/image.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchImageAsBase64: vi.fn(),
}));

const O2K = (body) => translateRequest(FORMATS.OPENAI, FORMATS.KIRO, "m", body, true, null, "kiro");

describe("OpenAI → Kiro", () => {
  // openai-to-kiro.js — safeJSONParse guards bad tool-call JSON (fixed in PR #1582)
  it("malformed tool arguments do not throw the whole request", () => {
    expect(() =>
      O2K({
        messages: [
          { role: "user", content: "go" },
          { role: "assistant", content: "", tool_calls: [
            { id: "c1", type: "function", function: { name: "f", arguments: "{not json" } },
          ] },
          { role: "tool", tool_call_id: "c1", content: "r" },
        ],
      })
    ).not.toThrow();
  });

  // openai-to-kiro.js:309 — maxTokens hardcoded to 32000, ignores body.max_tokens
  // KNOWN BUG
  it.fails("respects client max_tokens", () => {
    const out = O2K({ max_tokens: 100, messages: [{ role: "user", content: "hi" }] });
    expect(out.inferenceConfig?.maxTokens, "client max_tokens ignored").toBe(100);
  });

  it.each(["http://example.com/p.png", "https://example.com/p.png"])(
    "rejects unresolved remote image %s with a client error instead of text",
    (url) => {
      expect(() => O2K({ messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url } },
      ] }] })).toThrow(expect.objectContaining({ statusCode: 400 }));
    },
  );

  it.each([false, true])("preserves prefetched image bytes (string image_url: %s)", async (stringUrl) => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    const url = "https://example.com/p.png";
    fetchImageAsBase64.mockResolvedValueOnce({ url: `data:image/png;base64,${base64}`, mimeType: "image/png" });
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "see" },
      { type: "image_url", image_url: stringUrl ? url : { url } },
    ] }] };
    await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.KIRO);
    const current = O2K(body).conversationState.currentMessage.userInputMessage;
    expect(current.images).toEqual([{ format: "png", source: { bytes: base64 } }]);
    expect(current.content).toContain("see");
    expect(current.content).not.toContain(url);
    expect(current.content).not.toContain("[Image:");
  });

  it("rejects failed guarded resolution even when an inline image is also present", async () => {
    fetchImageAsBase64.mockResolvedValueOnce(null);
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
      { type: "image_url", image_url: { url: "https://example.com/p.png" } },
    ] }] };
    await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.KIRO);
    expect(() => O2K(body)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it("preserves inline images in history and the current turn", () => {
    const image = { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } };
    const out = O2K({ messages: [
      { role: "user", content: [image] },
      { role: "assistant", content: "What next?" },
      { role: "user", content: [image] },
    ] }).conversationState;
    const expected = [{ format: "png", source: { bytes: "aW1hZ2U=" } }];
    expect(out.history[0].userInputMessage.images).toEqual(expected);
    expect(out.currentMessage.userInputMessage.images).toEqual(expected);
  });
});
