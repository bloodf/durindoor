import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestDetail: vi.fn(),
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: mocks.saveRequestDetail,
  saveRequestUsage: mocks.saveRequestUsage,
  appendRequestLog: mocks.appendRequestLog,
}));

import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";

const context = {
  provider: "test-provider",
  model: "test-model",
  connectionId: "connection-12345678",
  apiKey: "client-key",
  requestStartTime: Date.now() - 1000,
  body: { messages: [{ role: "user", content: "hi" }] },
  stream: true,
  finalBody: null,
  translatedBody: null,
  clientRawRequest: { endpoint: "/v1/chat/completions" },
  pxpipe: undefined,
  reqTag: "T1",
  log: null,
};

describe("interrupted streaming request detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveRequestDetail.mockResolvedValue(undefined);
    mocks.saveRequestUsage.mockResolvedValue(undefined);
  });

  it("replaces an abandoned stream placeholder with one cancelled detail", () => {
    const { onStreamAbandoned, streamDetailId } = buildOnStreamComplete({ ...context });

    onStreamAbandoned("client_disconnected");
    onStreamAbandoned("stream_error");

    expect(mocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    const detail = mocks.saveRequestDetail.mock.calls[0][0];
    expect(detail).toMatchObject({
      id: streamDetailId,
      status: "cancelled",
      response: { type: "streaming" },
    });
    expect(detail.response.content).toContain("client_disconnected");
    expect(detail.response.content).not.toContain("Streaming in progress");
  });

  it("keeps one successful detail when completion precedes abandonment", () => {
    const { onStreamComplete, onStreamAbandoned, streamDetailId } = buildOnStreamComplete({ ...context });

    onStreamComplete({ content: "done" }, { prompt_tokens: 5, completion_tokens: 7 }, Date.now());
    onStreamAbandoned("client_disconnected");

    expect(mocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestDetail.mock.calls[0][0]).toMatchObject({
      id: streamDetailId,
      status: "success",
      response: { content: "done" },
    });
  });
});
