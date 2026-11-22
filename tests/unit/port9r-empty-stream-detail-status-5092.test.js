// decolua/9router #5092: an empty upstream stream must be recorded as an error, not a success.
// The in-band client error frame already exists (createEmptyTerminalGuard); this covers the record.
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

const ctx = {
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
  reqTag: "T1",
  log: null,
  usageEventId: "usage-empty",
};

function finish(content, usage) {
  mocks.saveRequestDetail.mockResolvedValue(undefined);
  mocks.saveRequestUsage.mockResolvedValue(undefined);
  mocks.appendRequestLog.mockResolvedValue(undefined);
  buildOnStreamComplete(ctx).onStreamComplete(content, usage, null, {});
  return mocks.saveRequestDetail.mock.calls.at(-1)[0];
}

describe("streaming request detail status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a stream that produced nothing as an error", () => {
    const detail = finish({ content: "", thinking: "" }, { prompt_tokens: 4, completion_tokens: 0 });
    expect(detail.status).toBe("error");
  });

  it("records a stream with content as a success", () => {
    const detail = finish({ content: "hello" }, { prompt_tokens: 4, completion_tokens: 2 });
    expect(detail.status).toBe("success");
  });

  it("records a tool-call-only stream as a success", () => {
    const detail = finish({ content: "", hadToolCalls: true, toolCallNames: ["lookup"] }, { prompt_tokens: 4, completion_tokens: 0 });
    expect(detail.status).toBe("success");
  });

  it("records a stream with only generated tokens as a success", () => {
    const detail = finish({ content: "" }, { prompt_tokens: 4, completion_tokens: 9 });
    expect(detail.status).toBe("success");
  });
});
