// OpenAI → Kiro (AWS CodeWhisperer) request translation.
import { describe, it, expect, vi } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/index.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";
import { prefetchRemoteImages } from "../../open-sse/translator/concerns/prefetch.js";
import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";

vi.mock("../../open-sse/translator/concerns/image.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchImageAsBase64: vi.fn(),
}));
const O2K = (body, stream = true) => translateRequest(FORMATS.OPENAI, FORMATS.KIRO, "m", body, stream, null, "kiro");

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

  describe.each([true, false])("output ceilings (stream=%s)", (stream) => {
    const messages = [{ role: ROLE.USER, content: "hi" }];

    it.each(["max_tokens", "max_completion_tokens"])("rejects unsupported %s ceilings with 400", (field) => {
      expect(() => O2K({ [field]: 100, messages }, stream)).toThrowError(expect.objectContaining({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: expect.stringContaining(`Kiro cannot enforce ${field}`),
      }));
    });

    it.each(["max_tokens", "max_completion_tokens"])("validates %s before rejecting enforcement", (field) => {
      for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, "100", true, {}, []]) {
        expect(() => O2K({ [field]: value, messages }, stream)).toThrowError(expect.objectContaining({
          statusCode: HTTP_STATUS.BAD_REQUEST,
          message: `${field} must be a finite positive integer.`,
        }));
      }
    });

    it("uses max_tokens before max_completion_tokens with nullish fallback", () => {
      for (const max_tokens of [100, 0, null, undefined]) {
        const field = max_tokens == null ? "max_completion_tokens" : "max_tokens";
        expect(() => O2K({ max_tokens, max_completion_tokens: 200, messages }, stream))
          .toThrowError(expect.objectContaining({
            statusCode: HTTP_STATUS.BAD_REQUEST,
            message: max_tokens === 0 ? `${field} must be a finite positive integer.` : expect.stringContaining(`Kiro cannot enforce ${field}`),
          }));
      }
    });

    it("preserves uncapped translation and sampling settings", () => {
      const out = O2K({ messages, temperature: 0.2, top_p: 0.9 }, stream);
      expect(out.inferenceConfig).toEqual({ maxTokens: 32000, temperature: 0.2, topP: 0.9 });
      expect(out.conversationState.currentMessage.userInputMessage.content).toContain("hi");
    });

    it("leaves native Kiro output settings unchanged", () => {
      const body = {
        conversationState: { currentMessage: { userInputMessage: { content: "hi", modelId: "m" } }, history: [] },
        inferenceConfig: { maxTokens: 100 },
      };
      const out = translateRequest(FORMATS.KIRO, FORMATS.KIRO, "m", body, stream, null, "kiro");
      expect(out).toBe(body);
      expect(out.inferenceConfig).toEqual({ maxTokens: 100 });
      expect(out.conversationState.currentMessage.userInputMessage.content).toBe("hi");
    });
  });

  it.each(["http://example.com/p.png", "https://example.com/p.png"])(
    "rejects unresolved remote image %s with a client error instead of text",
    (url) => {
      expect(() => O2K({ messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url } },
      ] }] })).toThrow(expect.objectContaining({ statusCode: 400 }));
    },
  );

  it("remote image url is preserved as an image, not text", async () => {
    const base64 = "aW1hZ2U=";
    fetchImageAsBase64.mockResolvedValueOnce({ url: `data:image/png;base64,${base64}`, mimeType: "image/png" });
    const body = {
      messages: [{ role: "user", content: [
        { type: "text", text: "see" },
        { type: "image_url", image_url: { url: "https://example.com/p.png" } },
      ] }],
    };
    await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.KIRO);
    const current = O2K(body).conversationState.currentMessage.userInputMessage;
    expect(current.images).toEqual([{ format: "png", source: { bytes: base64 } }]);
    expect(current.content).toContain("see");
    expect(current.content).not.toContain("[Image:");
  });

  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])("preserves prefetched image bytes (string image_url: %s, stream: %s)", async (stringUrl, stream) => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    const url = "https://example.com/p.png";
    fetchImageAsBase64.mockResolvedValueOnce({ url: `data:image/png;base64,${base64}`, mimeType: "image/png" });
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "see" },
      { type: "image_url", image_url: stringUrl ? url : { url } },
    ] }] };
    await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.KIRO);
    const current = O2K(body, stream).conversationState.currentMessage.userInputMessage;
    expect(current.images).toEqual([{ format: "png", source: { bytes: base64 } }]);
    expect(current.content).toContain("see");
    expect(current.content).not.toContain(url);
    expect(current.content).not.toContain("[Image:");
  });

  it.each([false, true])("preserves same-format images without prefetch (stream: %s)", async (stream) => {
    const body = { model: "gpt-4o", stream, messages: [{ role: "user", content: [
      { type: "text", text: "see" },
      { type: "image_url", image_url: { url: "https://example.com/p.png" } },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
    ] }] };
    const expected = structuredClone(body);
    fetchImageAsBase64.mockClear();
    expect(await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI)).toBe(0);
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", body, stream, null, "openai");
    expect(out.messages).toEqual(expected.messages);
    expect(out.stream).toBe(stream);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
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
