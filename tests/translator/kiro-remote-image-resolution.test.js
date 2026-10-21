import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { prefetchRemoteImages } from "../../open-sse/translator/concerns/prefetch.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const url = "https://images.example/p.png";

function request(format, stream) {
  const image = format === FORMATS.CLAUDE
    ? { type: "image", source: { type: "url", url } }
    : { type: "image_url", image_url: { url } };
  return { stream, messages: [{ role: "user", content: [{ type: "text", text: "describe" }, image] }] };
}

beforeEach(() => {
  lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(png)));
});
afterEach(() => vi.unstubAllGlobals());

describe("Kiro remote images through guarded resolution (#1079)", () => {
  it.each([
    [FORMATS.OPENAI, false], [FORMATS.OPENAI, true],
    [FORMATS.CLAUDE, false], [FORMATS.CLAUDE, true],
  ])("preserves native image bytes from %s (stream: %s)", async (format, stream) => {
    const body = request(format, stream);
    await prefetchRemoteImages(body, format, FORMATS.KIRO);
    const out = translateRequest(format, FORMATS.KIRO, "claude-sonnet-4.5", body, stream, null, "kiro");
    const current = out.conversationState.currentMessage.userInputMessage;
    expect(current.images).toEqual([{ format: "png", source: { bytes: png.toString("base64") } }]);
    expect(current.content).toContain("describe");
    expect(JSON.stringify(out)).not.toContain(url);
  });

  it.each([FORMATS.OPENAI, FORMATS.CLAUDE])("rejects blocked remote images from %s without fetching", async (format) => {
    lookup.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    const body = request(format, false);
    await prefetchRemoteImages(body, format, FORMATS.KIRO);
    expect(() => translateRequest(format, FORMATS.KIRO, "claude-sonnet-4.5", body, false, null, "kiro"))
      .toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([FORMATS.OPENAI, FORMATS.CLAUDE])("rejects non-image payloads from %s", async (format) => {
    fetch.mockResolvedValueOnce(new Response("not an image"));
    const body = request(format, true);
    await prefetchRemoteImages(body, format, FORMATS.KIRO);
    expect(() => translateRequest(format, FORMATS.KIRO, "claude-sonnet-4.5", body, true, null, "kiro"))
      .toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  describe.each([false, true])("paired Claude tool-result images (stream: %s)", (stream) => {
    const nestedRequest = (source, withTools, completed) => ({
      ...(withTools ? { tools: [{ name: "screenshot", input_schema: { type: "object", properties: {} } }] } : {}),
      messages: [
        { role: "user", content: "capture" },
        { role: "assistant", content: [{ type: "tool_use", id: "capture-1", name: "screenshot", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "capture-1", is_error: true, content: [
          { type: "text", text: "capture failed; inspect screenshot" },
          { type: "image", source },
        ] }] },
        ...(completed ? [{ role: "assistant", content: "Captured." }, { role: "user", content: "Continue." }] : []),
      ],
    });

    it.each([
      [false, false], [false, true], [true, false], [true, true],
    ])("retains inline bytes without losing failure meaning (tools: %s, completed: %s)", (withTools, completed) => {
      const bytes = png.toString("base64");
      const body = nestedRequest({ type: "base64", media_type: "image/png", data: bytes }, withTools, completed);
      const original = structuredClone(body);
      const out = translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4.5", body, stream, null, "kiro");
      expect(body).toEqual(original);
      const carriers = [...out.conversationState.history, out.conversationState.currentMessage];
      const imageTurn = carriers.find((item) => item.userInputMessage?.images?.length)?.userInputMessage;
      expect(imageTurn?.images).toEqual([{ format: "png", source: { bytes } }]);
      if (withTools) {
        expect(imageTurn.userInputMessageContext.toolResults).toEqual([
          { toolUseId: "capture-1", status: "error", content: [{ text: "capture failed; inspect screenshot" }] },
        ]);
      } else {
        expect(imageTurn.content).toContain("[Tool error: capture failed; inspect screenshot]");
        expect(carriers.flatMap((item) => item.userInputMessage?.userInputMessageContext?.toolResults || [])).toEqual([]);
      }
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      [false, false], [false, true], [true, false], [true, true],
    ])("rejects unresolved remote bytes before flattening (tools: %s, completed: %s)", async (withTools, completed) => {
      const body = nestedRequest({ type: "url", url }, withTools, completed);
      const original = structuredClone(body);
      await prefetchRemoteImages(body, FORMATS.CLAUDE, FORMATS.KIRO);
      expect(() => translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4.5", body, stream, null, "kiro"))
        .toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringContaining("Supply a base64 image source") }));
      expect(body).toEqual(original);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
