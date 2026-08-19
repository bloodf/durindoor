// Port of decolua/9router #3220: "bound non-streaming body reads, return 504
// on stall". DurinDoor already carries this fix (merged into main as
// a9e02aacf / commit "fix(chat): bound non-streaming body reads with a
// gateway timeout (#3220)"), with fork-specific extensions: readBodyWithTimeout
// takes { signal, maxBytes, timeoutMs } and RESPONSE_BODY_TIMEOUT_MS backs the
// default via open-sse/config/runtimeConfig.js. This test re-proves the
// upstream contract directly against our current bodyTimeout.js so the
// behavior stays pinned even if the underlying implementation is refactored.
import { describe, expect, it, vi } from "vitest";
import { RESPONSE_BODY_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";
import { BodyReadTimeoutError, readBodyWithTimeout } from "../../open-sse/utils/bodyTimeout.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function hangingResponse(contentType = "application/json") {
  let cancelled = false;
  const stream = new ReadableStream({
    start() {},
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(stream, { headers: { "content-type": contentType } });
  return { response, wasCancelled: () => cancelled };
}

describe("port 3220 — non-streaming body read timeout", () => {
  it("has a positive default RESPONSE_BODY_TIMEOUT_MS", () => {
    expect(RESPONSE_BODY_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("readBodyWithTimeout rejects a stalled body with BodyReadTimeoutError and cancels the stream", async () => {
    const { response, wasCancelled } = hangingResponse();
    await expect(readBodyWithTimeout(response, { timeoutMs: 5 })).rejects.toBeInstanceOf(BodyReadTimeoutError);
    expect(wasCancelled()).toBe(true);
  });

  it("handleNonStreamingResponse returns a real HTTP 504 when the upstream body stalls", async () => {
    const trackDone = vi.fn();
    const { response } = hangingResponse();
    const result = await handleNonStreamingResponse({
      providerResponse: response,
      provider: "openai",
      model: "gpt-test",
      sourceFormat: "openai",
      targetFormat: "openai",
      body: {},
      stream: false,
      streamToClient: false,
      translatedBody: {},
      finalBody: {},
      requestStartTime: Date.now(),
      connectionId: "conn-3220",
      apiKey: "test-key",
      clientRawRequest: {},
      onRequestSuccess: vi.fn(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      toolNameMap: {},
      trackDone,
      appendLog: vi.fn(),
      pxpipe: null,
      reqTag: "port-3220",
      log: vi.fn(),
      usageEventId: "evt-3220",
      claudeClassifierCompat: "off",
      responseBodyTimeoutMs: 1,
    });

    expect(result.status).toBe(504);
    expect(trackDone).toHaveBeenCalledOnce();
  });
});
