// Single-model early-EOF sibling failover (OmniRoute #13153/#13630), and
// request-scoped refusals kept out of it (#14585).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  projectProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  handleChatCore: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
  refreshProviderQuota: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
}));

vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  loadCustomCapabilities: async () => null,
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentials,
  projectProviderCredentials: mocks.projectProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: vi.fn(() => null),
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  resolveClientApiKey: async (request, options) => ({
    apiKey: null,
    auth: await mocks.evaluateApiKeyAuth(null, { ...options, request }),
  }),
  providerAllowsPublicNoAuthFallback: vi.fn(() => false),
}));

vi.mock("@/shared/services/providerCredentials", () => ({
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));

vi.mock("@/shared/services/providerQuotaTracker", () => ({
  refreshProviderQuota: mocks.refreshProviderQuota,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
}));

const { handleChat, holdForEarlyEof } = await import("../../src/sse/handlers/chat.js");
const { peekStreamForContent } = await import("../../open-sse/utils/streamContentPeek.js");

const encoder = new TextEncoder();
const CONTENT = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n';
const DONE = "data: [DONE]\n\n";

// Pull-based so an error lands after the queued chunks were read, the way a
// dropped upstream socket does.
function sse(chunks, { errorAfter = null } = {}) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else if (errorAfter) controller.error(errorAfter);
      else controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function request() {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "codex/gpt-5.4", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });
}

function selected(id) {
  return {
    connectionId: id,
    connectionName: id,
    apiKey: `key-${id}`,
    providerSpecificData: {},
    _connection: { id, provider: "codex", authType: "apikey", providerSpecificData: {} },
    _quotaPreflight: { eligible: true, skip: false, reason: "available", freshness: "fresh", shouldRefresh: false },
  };
}

// Serve connections in order, skipping excluded ones; record each call's excludes.
function pool(ids) {
  const excludes = [];
  mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) => {
    excludes.push([...(excluded || [])]);
    const id = ids.find((candidate) => !excluded?.has(candidate));
    return id ? selected(id) : null;
  });
  return excludes;
}

function streams(byConnection) {
  mocks.handleChatCore.mockImplementation(async (options) => ({
    success: true,
    attemptStartedAt: options.onProviderAttempt(),
    response: byConnection[options.connectionId](),
  }));
}

const attempted = () => mocks.handleChatCore.mock.calls.map(([options]) => options.connectionId);

describe("peekStreamForContent", () => {
  it("replays every consumed byte once content shows up", async () => {
    const chunks = [": keepalive\n\n", CONTENT, DONE];
    const peek = await peekStreamForContent(sse(chunks), 1000);
    expect(peek).toMatchObject({ hasContent: true, outcome: "content" });
    expect(await new Response(peek.body).text()).toBe(chunks.join(""));
  });

  it("reports an empty close and still replays it", async () => {
    const peek = await peekStreamForContent(sse([": keepalive\n\n", DONE]), 1000);
    expect(peek).toMatchObject({ hasContent: false, outcome: "empty", streamError: null });
    expect(await new Response(peek.body).text()).toBe(": keepalive\n\n" + DONE);
  });

  it("reports a pre-content error and re-raises it on replay", async () => {
    const peek = await peekStreamForContent(sse([": ping\n\n"], { errorAfter: new TypeError("terminated") }), 1000);
    expect(peek.outcome).toBe("error");
    await expect(new Response(peek.body).text()).rejects.toThrow("terminated");
  });

  it("captures the first in-stream error envelope", async () => {
    const frame = `data: ${JSON.stringify({ error: { type: "invalid_request_error", message: "bad" } })}\n\n`;
    const peek = await peekStreamForContent(sse([frame, DONE]), 1000);
    expect(peek.outcome).toBe("empty");
    expect(peek.streamError).toMatchObject({ type: "invalid_request_error" });
  });

  it("keeps the live stream intact after a timeout, including the read in flight", async () => {
    let push;
    const body = new ReadableStream({ start(controller) { push = controller; } });
    push.enqueue(encoder.encode(": keepalive\n\n"));
    const peek = await peekStreamForContent(
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
      20,
    );
    expect(peek.outcome).toBe("timeout");
    push.enqueue(encoder.encode(CONTENT));
    push.close();
    expect(await new Response(peek.body).text()).toBe(": keepalive\n\n" + CONTENT);
  });
});

describe("holdForEarlyEof", () => {
  it("fails over on a transient pre-content error frame", async () => {
    const frame = `data: ${JSON.stringify({ error: { type: "server_error", message: "boom" } })}\n\n`;
    expect((await holdForEarlyEof(sse([frame, DONE]), 1000)).failed).toBe(true);
  });

  it("does not fail over on a request-scoped refusal (#14585)", async () => {
    const frame = `data: ${JSON.stringify({ error: { code: "context_length_exceeded", message: "too long" } })}\n\n`;
    const held = await holdForEarlyEof(sse([frame, DONE]), 1000);
    expect(held.failed).toBe(false);
    expect(await held.response.text()).toBe(frame + DONE);
  });

  it("passes the response through untouched when disabled", async () => {
    const response = sse([DONE]);
    const held = await holdForEarlyEof(response, 0);
    expect(held).toEqual({ response, failed: false });
  });

  it("never touches a non-SSE body", async () => {
    const response = new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } });
    expect((await holdForEarlyEof(response, 1000)).response).toBe(response);
  });
});

describe("single-model early-EOF sibling failover (#13153/#13630)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getApiKeyByKey.mockResolvedValue(null);
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true, stored: false });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "codex", model: "gpt-5.4" });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 2000 });
    mocks.clearAccountError.mockResolvedValue();
  });

  it("retries an empty stream on a sibling connection before any byte reaches the client", async () => {
    const excludes = pool(["conn-one", "conn-two"]);
    streams({ "conn-one": () => sse([DONE]), "conn-two": () => sse([CONTENT, DONE]) });

    const response = await handleChat(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT + DONE);
    expect(attempted()).toEqual(["conn-one", "conn-two"]);
    expect(excludes).toEqual([[], ["conn-one"]]);
    // Routing only: the hop itself writes no cooldown.
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("retries a stream that errors before content", async () => {
    pool(["conn-one", "conn-two"]);
    streams({
      "conn-one": () => sse([], { errorAfter: new TypeError("terminated") }),
      "conn-two": () => sse([CONTENT, DONE]),
    });

    const response = await handleChat(request());

    expect(await response.text()).toBe(CONTENT + DONE);
    expect(attempted()).toEqual(["conn-one", "conn-two"]);
  });

  it("returns the original stream when no sibling is left", async () => {
    pool(["conn-one"]);
    streams({ "conn-one": () => sse([": keepalive\n\n", DONE]) });

    const response = await handleChat(request());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(": keepalive\n\n" + DONE);
    expect(attempted()).toEqual(["conn-one"]);
  });

  it("makes at most one sibling hop per request", async () => {
    pool(["conn-one", "conn-two", "conn-three"]);
    streams({
      "conn-one": () => sse([DONE]),
      "conn-two": () => sse(["data: {\"second\":true}\n\n", DONE]),
      "conn-three": () => sse([CONTENT, DONE]),
    });

    const response = await handleChat(request());

    expect(await response.text()).toBe("data: {\"second\":true}\n\n" + DONE);
    expect(attempted()).toEqual(["conn-one", "conn-two"]);
  });

  it("never retries once content has started, even if the stream then fails", async () => {
    pool(["conn-one", "conn-two"]);
    streams({
      "conn-one": () => sse([CONTENT], { errorAfter: new TypeError("terminated") }),
      "conn-two": () => sse([CONTENT, DONE]),
    });

    const response = await handleChat(request());

    await expect(response.text()).rejects.toThrow("terminated");
    expect(attempted()).toEqual(["conn-one"]);
  });

  it("does not retry a request-scoped in-stream refusal on a sibling", async () => {
    const frame = `data: ${JSON.stringify({ error: { type: "invalid_request_error", message: "bad tool schema" } })}\n\n`;
    pool(["conn-one", "conn-two"]);
    streams({ "conn-one": () => sse([frame, DONE]), "conn-two": () => sse([CONTENT, DONE]) });

    const response = await handleChat(request());

    expect(await response.text()).toBe(frame + DONE);
    expect(attempted()).toEqual(["conn-one"]);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});
