import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const { trackPendingRequest, finishActiveSession } = vi.hoisted(() => ({
  trackPendingRequest: vi.fn(() => "request-1"),
  finishActiveSession: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest,
  finishActiveSession,
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const failure = new Error("proxy log sink failed");

// The proxy log line runs after the pending row is registered and before dispatch.
const request = () => ({
  body: { model: "llama3", stream: false, messages: [{ role: "user", content: "hello" }] },
  modelInfo: { provider: "ollama-local", model: "llama3" },
  credentials: { apiKey: "", providerSpecificData: { vercelRelayUrl: "https://relay.example.test" } },
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn((tag) => {
      if (tag === "PROXY") throw failure;
    }),
  },
  connectionId: "conn-1",
  clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
});

describe("OmniRoute #20190 - pending request row after an unexpected throw", () => {
  beforeEach(() => {
    trackPendingRequest.mockClear();
    finishActiveSession.mockClear();
  });

  it("releases the pending row and rethrows the same error", async () => {
    await expect(handleChatCore(request())).rejects.toBe(failure);

    const states = trackPendingRequest.mock.calls.map((call) => call[3]);
    expect(states).toEqual([true, false]);
    expect(finishActiveSession).toHaveBeenCalledWith({ requestId: "request-1", status: "error" });
  });
});
