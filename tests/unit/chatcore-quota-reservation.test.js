import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import {
  PROVIDER_BODY_TIMEOUT_MS,
  STREAM_STALL_TIMEOUT_MS,
} from "../../open-sse/config/runtimeConfig.js";

const { executeMock, executorState, requestLoggerState, activeSessions, trackPendingRequest, finishActiveSession } = vi.hoisted(() => {
  const activeSessions = new Map();
  return {
    executeMock: vi.fn(),
    executorState: { noAuth: true },
    requestLoggerState: { throwOnConvertedResponse: false },
    activeSessions,
    trackPendingRequest: vi.fn((_model, _provider, _connectionId, started, error, session) => {
      if (started && session?.requestId) activeSessions.set(session.requestId, "active");
      else if (session?.requestId) activeSessions.set(session.requestId, error ? "error" : session.status || "done");
      return session?.requestId || null;
    }),
    finishActiveSession: vi.fn(({ requestId, status }) => activeSessions.set(requestId, status)),
  };
});

vi.mock("../../open-sse/executors/index.js", async () => {
  const context = await import("../../open-sse/services/providerAttemptContext.js");
  return {
    getExecutor: () => ({
      noAuth: executorState.noAuth,
      execute: (options) => context.runQuotaBearingProviderRequest(
        () => context.runProviderAttemptDispatch(() => executeMock(options)),
      ),
    }),
  };
});

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(() => {
      if (requestLoggerState.throwOnConvertedResponse) throw new Error("logger projection failed");
    }),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest,
  finishActiveSession,
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function reservation(overrides = {}) {
  const ticket = {
    tracked: true,
    reservationId: "reservation-1",
    heartbeat: vi.fn(),
    settle: vi.fn(async () => ({ changed: true })),
    release: vi.fn(async () => ({ changed: true })),
  };
  return {
    tracked: true,
    ticket,
    beginDispatch: vi.fn(async () => ticket),
    heartbeat: vi.fn(),
    settle: vi.fn(async () => ({ changed: true })),
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function args(quotaReservation, overrides = {}) {
  return {
    body: { model: "llama3", stream: false, messages: [{ role: "user", content: "hello" }] },
    modelInfo: { provider: "ollama-local", model: "llama3" },
    credentials: { apiKey: "", providerSpecificData: { baseUrl: "http://localhost:11434" } },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "conn-1",
    quotaReservation,
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
    ...overrides,
  };
}

function ollamaSuccess() {
  return {
    response: new Response(JSON.stringify({
      model: "llama3",
      created_at: "2026-07-10T12:00:00.000Z",
      message: { role: "assistant", content: "ok" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 2,
      eval_count: 1,
    }), { status: 200, headers: { "content-type": "application/json" } }),
    url: "http://localhost:11434/api/chat",
    headers: {},
    transformedBody: null,
    terminalProvenance: "upstream",
  };
}

describe("chatCore quota reservation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executorState.noAuth = true;
    requestLoggerState.throwOnConvertedResponse = false;
    executeMock.mockResolvedValue(ollamaSuccess());
    activeSessions.clear();
  });

  it("fails locally before dispatch when atomic capacity cannot be acquired", async () => {
    const error = Object.assign(new Error("Provider quota capacity unavailable"), {
      code: "QUOTA_DISPATCH_UNAVAILABLE",
      reason: "capacity_exhausted",
    });
    const quota = reservation({ beginDispatch: vi.fn(async () => { throw error; }) });
    const result = await handleChatCore(args(quota));
    expect(result).toMatchObject({ success: false, status: 503, quotaCapacityUnavailable: true, quotaReason: "capacity_exhausted" });
    expect(executeMock).not.toHaveBeenCalled();
    expect(quota.beginDispatch).toHaveBeenCalledOnce();
    expect(quota.settle).not.toHaveBeenCalled();
  });

  it("dispatches untracked when the planned observation disappears at acquire", async () => {
    const quota = reservation({
      beginDispatch: vi.fn(async () => ({
        tracked: false,
        reservationId: null,
        heartbeat: vi.fn(),
        settle: vi.fn(async () => ({ changed: false })),
        release: vi.fn(async () => ({ changed: false })),
      })),
    });
    const result = await handleChatCore(args(quota));

    expect(result.success).toBe(true);
    expect(await result.response.json()).toBeTruthy();
    expect(quota.beginDispatch).toHaveBeenCalledOnce();
    expect(executeMock).toHaveBeenCalledOnce();
    expect(quota.heartbeat).not.toHaveBeenCalled();
    expect(quota.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
  });

  it("acquires after local validation, marks dispatch, and commits a coherent JSON terminal", async () => {
    const quota = reservation();
    const result = await handleChatCore(args(quota));
    expect(result.success).toBe(true);
    expect(await result.response.json()).toBeTruthy();
    expect(quota.beginDispatch).toHaveBeenCalledOnce();
    expect(executeMock).toHaveBeenCalledOnce();
    const finishCalls = trackPendingRequest.mock.calls.filter(([, , , started]) => started === false);
    expect(finishCalls).toHaveLength(1);
    expect(finishActiveSession).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
    expect(quota.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
    expect([...activeSessions.values()]).not.toContain("active");
  });

  it("releases on a non-2xx provider result without fabricating success", async () => {
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503, headers: { "content-type": "application/json" } }),
      url: "http://localhost:11434/api/chat",
      headers: {},
      transformedBody: null,
    });
    const quota = reservation();
    const result = await handleChatCore(args(quota));
    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
    expect(quota.settle).toHaveBeenCalledWith({ success: false, reason: "upstream_error" });
    expect([...activeSessions.values()]).not.toContain("active");
  });

  it("releases on a thrown transport error", async () => {
    executeMock.mockRejectedValue(new Error("socket reset"));
    const quota = reservation();
    const result = await handleChatCore(args(quota));
    expect(result.success).toBe(false);
    expect(quota.settle).toHaveBeenCalledWith({ success: false, reason: "transport_error" });
  });

  it("releases a wrapped 401 ticket before refresh and commits only the retry ticket", async () => {
    executorState.noAuth = false;
    executeMock
      .mockResolvedValueOnce({
        response: new Response(JSON.stringify({ error: { message: "expired" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
        url: "https://provider.invalid/chat",
        headers: {},
        transformedBody: null,
      })
      .mockResolvedValueOnce(ollamaSuccess());
    const active = new Set();
    const tickets = ["reservation-1", "reservation-2"].map((reservationId) => {
      const ticket = {
        tracked: true,
        reservationId,
        heartbeat: vi.fn(),
        settle: vi.fn(async (terminal) => {
          active.delete(ticket);
          return { changed: true, terminal };
        }),
        release: vi.fn(async (reason) => ticket.settle({ success: false, reason })),
      };
      return ticket;
    });
    const quota = {
      tracked: true,
      beginDispatch: vi.fn(async () => {
        const ticket = tickets[active.size === 0 && tickets[0].settle.mock.calls.length === 0 ? 0 : 1];
        active.add(ticket);
        return ticket;
      }),
      heartbeat: vi.fn(),
      settle: vi.fn(async (terminal) => {
        const results = await Promise.all([...active].map((ticket) => ticket.settle(terminal)));
        return { changed: results.some((result) => result.changed) };
      }),
    };
    const refreshCredentials = vi.fn(async () => ({ accessToken: "refreshed" }));

    const result = await handleChatCore(args(quota, {
      credentials: { accessToken: "expired", providerSpecificData: {} },
      refreshCredentials,
    }));

    expect(result.success).toBe(true);
    expect(quota.beginDispatch).toHaveBeenCalledTimes(2);
    expect(tickets[0].settle).toHaveBeenCalledTimes(1);
    expect(tickets[0].settle).toHaveBeenCalledWith({ success: false, reason: "fallback" });
    expect(tickets[1].settle).toHaveBeenCalledTimes(1);
    expect(tickets[1].settle).toHaveBeenCalledWith({ success: true, reason: "success" });
    expect(refreshCredentials).toHaveBeenCalledOnce();
  });

  it("commits exactly once for a coherent streaming terminal", async () => {
    const sse = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    executeMock.mockResolvedValue({
      response: new Response(sse, { headers: { "content-type": "text/event-stream" } }),
      url: "https://example.invalid/chat",
      headers: {},
      transformedBody: null,
      terminalProvenance: "upstream",
    });
    const quota = reservation();
    const result = await handleChatCore(args(quota, {
      body: { model: "gpt-test", stream: true, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-test" },
      credentials: { apiKey: "test", providerSpecificData: {} },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "text/event-stream" } },
    }));
    await result.response.text();
    await vi.waitFor(() => expect(quota.settle).toHaveBeenCalledWith({ success: true, reason: "success" }));
    expect(quota.settle).toHaveBeenCalledTimes(1);
  });

  it("releases a streaming response that ends without a coherent terminal", async () => {
    const partial = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] })}\n\n`;
    executeMock.mockResolvedValue({
      response: new Response(partial, { headers: { "content-type": "text/event-stream" } }),
      url: "https://example.invalid/chat",
      headers: {},
      transformedBody: null,
      terminalProvenance: "upstream",
    });
    const quota = reservation();
    const result = await handleChatCore(args(quota, {
      body: { model: "gpt-test", stream: true, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-test" },
      credentials: { apiKey: "test", providerSpecificData: {} },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "text/event-stream" } },
    }));
    await result.response.text();
    await vi.waitFor(() => expect(quota.settle).toHaveBeenCalledWith({ success: false, reason: "malformed_terminal" }));
  });

  it("releases exactly once when the client cancels the response body", async () => {
    const partial = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] })}\n\n`;
    executeMock.mockResolvedValue({
      response: new Response(partial, { headers: { "content-type": "text/event-stream" } }),
      url: "https://example.invalid/chat",
      headers: {},
      transformedBody: null,
      terminalProvenance: "upstream",
    });
    const quota = reservation();
    const result = await handleChatCore(args(quota, {
      body: { model: "gpt-test", stream: true, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-test" },
      credentials: { apiKey: "test", providerSpecificData: {} },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "text/event-stream" } },
    }));

    await result.response.body.cancel("client_cancelled");
    await vi.waitFor(() => expect(quota.settle).toHaveBeenCalledWith({ success: false, reason: "stream_cancel" }));
    expect(quota.settle).toHaveBeenCalledTimes(1);
    expect([...activeSessions.values()]).not.toContain("active");
  });

  it("releases an acquired physical ticket when an external abort wins during execute", async () => {
    const controller = new AbortController();
    executeMock.mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    const quota = reservation();
    const pending = handleChatCore(args(quota, { abortSignal: controller.signal }));
    await vi.waitFor(() => expect(executeMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException("aborted", "AbortError"));
    const result = await pending;

    expect(result.status).toBe(499);
    expect(quota.ticket.release).toHaveBeenCalledOnce();
    expect(quota.ticket.release).toHaveBeenCalledWith("abort");
    expect(quota.settle).toHaveBeenCalledWith({ success: false, reason: "abort" });
  });

  it("records timeout when a streaming upstream stalls", async () => {
    vi.useFakeTimers();
    try {
      executeMock.mockResolvedValue({
        response: new Response(new ReadableStream({ start() {} }), {
          headers: { "content-type": "text/event-stream" },
        }),
        url: "https://example.invalid/chat",
        headers: {},
        transformedBody: null,
        terminalProvenance: "upstream",
      });
      const quota = reservation();
      const result = await handleChatCore(args(quota, {
        body: { model: "gpt-test", stream: true, messages: [{ role: "user", content: "hello" }] },
        modelInfo: { provider: "openai", model: "gpt-test" },
        credentials: { apiKey: "test", providerSpecificData: {} },
        clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "text/event-stream" } },
      }));
      const reader = result.response.body.getReader();
      const pendingRead = reader.read();
      await vi.advanceTimersByTimeAsync(STREAM_STALL_TIMEOUT_MS + 1);
      await vi.waitFor(() => expect(quota.settle).toHaveBeenCalledWith({ success: false, reason: "timeout" }));
      expect(quota.settle).toHaveBeenCalledTimes(1);
      await reader.cancel();
      await pendingRead.catch(() => {});
    } finally {
      vi.useRealTimers();
    }
  });

  it("records buffered response body timeouts without calling them malformed terminals", async () => {
    vi.useFakeTimers();
    try {
      executeMock.mockResolvedValue({
        response: new Response(new ReadableStream({ start() {} }), {
          headers: { "content-type": "application/json" },
        }),
        url: "https://example.invalid/chat",
        headers: {},
        transformedBody: null,
        terminalProvenance: "upstream",
      });
      const quota = reservation();
      const pending = handleChatCore(args(quota));
      await vi.advanceTimersByTimeAsync(PROVIDER_BODY_TIMEOUT_MS + 1);
      const result = await pending;
      // #3220: a hung upstream body is a gateway timeout, not a malformed
      // terminal. Previously indistinguishable from a truncated body (502).
      expect(result.status).toBe(504);
      await vi.waitFor(() => expect(quota.settle).toHaveBeenCalledWith({ success: false, reason: "timeout" }));
      expect(quota.settle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases an active ticket when post-response projection throws", async () => {
    requestLoggerState.throwOnConvertedResponse = true;
    const release = deferred();
    const quota = reservation({ settle: vi.fn(() => release.promise) });

    let completed = false;
    const pending = handleChatCore(args(quota)).then((result) => {
      completed = true;
      return result;
    });
    await vi.waitFor(() => expect(quota.settle).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    release.resolve({ changed: true });
    const result = await pending;

    expect(result).toMatchObject({ success: false, status: 502 });
    expect(quota.settle).toHaveBeenCalledOnce();
    expect(quota.settle).toHaveBeenCalledWith({ success: false, reason: "stream_error" });
  });

  it("awaits immediate streaming failure settlement before returning", async () => {
    executeMock.mockResolvedValue({
      response: new Response(null, { headers: { "content-type": "text/event-stream" } }),
      url: "https://example.invalid/chat",
      headers: {},
      transformedBody: null,
      terminalProvenance: "upstream",
    });
    const release = deferred();
    const quota = reservation({ settle: vi.fn(() => release.promise) });
    let completed = false;
    const pending = handleChatCore(args(quota, {
      body: { model: "gpt-test", stream: true, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-test" },
      credentials: { apiKey: "test", providerSpecificData: {} },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "text/event-stream" } },
    })).then((result) => {
      completed = true;
      return result;
    });

    await vi.waitFor(() => expect(quota.settle).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    release.resolve({ changed: true });
    const result = await pending;

    expect(result).toMatchObject({ success: false, status: 502 });
    expect(quota.settle).toHaveBeenCalledWith({ success: false, reason: "stream_error" });
  });
});
