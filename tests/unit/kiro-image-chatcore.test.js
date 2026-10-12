import "../translator/registerAll.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), fetchImageAsBase64: vi.fn() }));

vi.mock("../../open-sse/translator/concerns/image.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchImageAsBase64: mocks.fetchImageAsBase64,
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: false, execute: mocks.execute })),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
  maskSensitiveUrl: vi.fn((url) => url),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn(),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("Kiro guarded image dispatch (#1079)", () => {
  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])("returns HTTP 400 without upstream execution (stream: %s, mixed inline: %s)", async (stream, mixedInline) => {
    const url = "https://example.com/p.png";
    const controller = new AbortController();
    mocks.fetchImageAsBase64.mockResolvedValueOnce(null);
    const body = { model: "claude-sonnet-4", stream, messages: [{ role: "user", content: [
      { type: "text", text: "see" },
      ...(mixedInline ? [{ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }] : []),
      { type: "image_url", image_url: { url } },
    ] }] };
    const result = await handleChatCore({
      body,
      modelInfo: { provider: "kiro", model: body.model },
      credentials: {},
      sourceFormatOverride: FORMATS.OPENAI,
      modelCapabilities: { vision: true },
      abortSignal: controller.signal,
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
      rtkEnabled: false, headroomEnabled: false, cavemanEnabled: false,
      ponytailEnabled: false, pxpipeEnabled: false,
    });
    expect(mocks.fetchImageAsBase64).toHaveBeenCalledExactlyOnceWith(url, { signal: controller.signal });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(400);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    const error = await result.response.json();
    expect(error.error.message).toContain("Kiro requires inline image data");
    expect(error.error.message).toContain("Supply a base64 data URI");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
