import { describe, expect, it } from "vitest";
import { formatClaudeSseError } from "../../open-sse/utils/sseFrames.js";
import { buildStreamErrorBytes } from "../../open-sse/utils/streamHelpers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Claude SSE error frames", () => {
  it("writes the standard event and JSON payload", () => {
    expect(formatClaudeSseError({ type: "api_error", message: "failed" }))
      .toBe('event: error\ndata: {"type":"error","error":{"type":"api_error","message":"failed"}}\n\n');
  });
  it("uses the same frame for an aborted Claude stream", () => {
    const frame = new TextDecoder().decode(buildStreamErrorBytes(500, "failed", FORMATS.CLAUDE));
    const payload = JSON.parse(frame.split("data: ")[1]);
    expect(frame).toBe(formatClaudeSseError(payload.error));
  });
});

import { createRequire } from "node:module";
import { vi } from "vitest";
import codex from "../../open-sse/handlers/imageProviders/codex.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { handleMusicGenerationCore } from "../../open-sse/handlers/musicGenerationCore.js";
import { createEmptyRetryStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";
import { buildKeepaliveErrorFrame } from "../../open-sse/utils/earlyStreamKeepalive.js";

const { iterateSSE } = createRequire(import.meta.url)("../../open-sse/handlers/realtimeCore.js");
const encoder = new TextEncoder();
const body = (wire) => new ReadableStream({
  start(controller) {
    const bytes = encoder.encode(wire);
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
    controller.close();
  },
});

describe("shared frame consumers", () => {
  it("reads split CRLF and multiline data in realtime, including an EOF tail", async () => {
    const frames = [];
    for await (const frame of iterateSSE(body(': ping\r\ndata: {"x":\r\ndata: 1}\r\n\r\ndata: tail'))) frames.push(frame);
    expect(frames).toEqual([{ data: '{"x":\n1}' }, { data: "tail" }]);
  });
  it("recognizes a multiline Codex image completion", async () => {
    const wire = 'event: response.completed\r\ndata: {"response":{"status":"completed",\r\ndata: "output":[{"type":"image_generation_call","result":"YQ=="}]}}\r\n\r\n';
    await expect(codex.parseResponse(new Response(body(wire)), {})).resolves.toMatchObject({ data: [{ b64_json: "YQ==" }] });
  });
  it("accounts for multiline MiniMax terminal frames and preserves bytes", async () => {
    const wire = 'data: {"data":{"status":2},\r\ndata: "base_resp":{"status_code":0}}\r\n\r\n';
    const restoreFetch = __setOriginalFetchForTesting(vi.fn().mockResolvedValue(new Response(body(wire), { headers: { "content-type": "text/event-stream" } })));
    const onComplete = vi.fn();
    try {
      const result = await handleMusicGenerationCore({ provider: "minimax", model: "music-3.0", body: { prompt: "song" }, credentials: { apiKey: "key" }, onComplete });
      expect(await result.response.text()).toBe(wire);
      expect(onComplete).toHaveBeenCalledOnce();
    } finally { restoreFetch(); }
  });
  it("classifies multiline empty terminals and keeps retried frame bytes", async () => {
    const empty = 'data: {"response":{\r\ndata: "candidates":[{"finishReason":"STOP"}]}}\r\n\r\n';
    const answer = 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"yes"}]}}]}}\r\n\r\n';
    const reexecute = vi.fn(async () => body(answer));
    const stream = createEmptyRetryStream({ body: body(empty), reexecute, baseDelayMs: 1 });
    expect(await new Response(stream).text()).toBe(answer);
    expect(reexecute).toHaveBeenCalledOnce();
  });
  it("uses the identical Claude frame for keepalive failures", () => {
    const bytes = buildKeepaliveErrorFrame("claude", { status: 500, text: '{"error":{"message":"failed"}}' });
    const frame = new TextDecoder().decode(bytes);
    const payload = JSON.parse(frame.split("data: ")[1]);
    expect(frame).toBe(formatClaudeSseError(payload.error));
  });
});
