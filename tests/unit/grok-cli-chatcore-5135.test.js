/**
 * grok-cli requests driven through chatCore, which resolves catalog ids to
 * upstream ids and freezes the request context before the executor runs.
 * Offline: proxyAwareFetch is mocked, and global fetch (stubbed before
 * proxyFetch patches it) throws if anything bypasses the mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const liveFetch = vi.hoisted(() => {
  const stub = vi.fn(async () => { throw new Error("offline test"); });
  vi.stubGlobal("fetch", stub);
  return stub;
});
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: vi.fn(),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn(),
}));

import "../translator/registerAll.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

// A 400 ends the request after exactly one dispatch; only the wire matters here.
beforeEach(() => {
  proxyAwareFetch.mockReset();
  proxyAwareFetch.mockImplementation(async () => Response.json({ error: { message: "fixture stop" } }, { status: 400 }));
});

async function dispatch(model, extra = {}) {
  const body = { model, messages: [{ role: "user", content: "hi" }], ...extra };
  await handleChatCore({
    body,
    modelInfo: { provider: "grok-cli", model },
    credentials: { accessToken: "fixture-token", authType: "oauth", providerSpecificData: { strictProxy: true } },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    connectionId: `fixture-${model}`,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    rtkEnabled: false, headroomEnabled: false, compressionEnabled: false,
  });
  expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  expect(liveFetch).not.toHaveBeenCalled();
  const [url, init] = proxyAwareFetch.mock.calls[0];
  expect(url).toBe("https://cli-chat-proxy.grok.com/v1/responses");
  return { headers: new Headers(init.headers), wire: JSON.parse(init.body) };
}

describe("grok-cli dispatch with chatCore's frozen request context", () => {
  it("reaches upstream and sends the session, request and turn headers", async () => {
    const { headers } = await dispatch("grok-4.6");
    expect(headers.get("x-grok-conv-id")).toBeTruthy();
    expect(headers.get("x-grok-req-id")).toBeTruthy();
    expect(headers.get("x-grok-turn-idx")).toBe("1");
  });
});
