// Closed-mock regression for OmniRoute 5ffa68e83544 Claude refresh errors.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { refreshClaudeOAuthToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { __clearRefreshDedupCacheForTesting } from "../../open-sse/services/tokenRefresh/dedup.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("Claude refresh error envelopes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __clearRefreshDedupCacheForTesting();
  });

  it.each([
    [JSON.stringify({ error: "invalid_request" }), "invalid_request"],
    [JSON.stringify({ error: { code: "invalid_request" } }), "invalid_request"],
    [JSON.stringify(JSON.stringify({ error: "invalid_grant" })), "invalid_grant"],
    ["invalid_request", "invalid_request"],
  ])("classifies %s as requiring sign-in", async (body, code) => {
    proxyAwareFetch.mockResolvedValue(new Response(body, { status: 400 }));
    expect(await refreshClaudeOAuthToken("mock-refresh")).toEqual({
      error: "unrecoverable_refresh_error", code,
    });
  });

  it("keeps a server failure transient", async () => {
    proxyAwareFetch.mockResolvedValue(new Response('{"error":"server_error"}', { status: 503 }));
    expect(await refreshClaudeOAuthToken("mock-refresh")).toBeNull();
  });

  it("does not mistake unrelated JSON metadata for a refresh error", async () => {
    proxyAwareFetch.mockResolvedValue(new Response('{"error":"server_error","debug":"invalid_request"}', { status: 503 }));
    expect(await refreshClaudeOAuthToken("mock-refresh")).toBeNull();
  });

  it("propagates permanent errors through the executor used by credential refresh", async () => {
    proxyAwareFetch.mockResolvedValue(new Response('{"error":{"code":"invalid_request"}}', { status: 400 }));
    const executor = new DefaultExecutor("claude");
    expect(await executor.refreshCredentials({ refreshToken: "mock-refresh" })).toEqual({
      error: "unrecoverable_refresh_error", code: "invalid_request",
    });
  });

  it("honors the bounded refresh rate-limit window for the same token", async () => {
    vi.useFakeTimers();
    try {
      proxyAwareFetch.mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "10" } }));
      proxyAwareFetch.mockResolvedValueOnce(Response.json({ access_token: "new" }));
      const executor = new DefaultExecutor("claude");
      expect(await executor.refreshCredentials({ refreshToken: "limited-refresh" })).toBeNull();
      expect(await executor.refreshCredentials({ refreshToken: "limited-refresh" })).toBeNull();
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect((await executor.refreshCredentials({ refreshToken: "limited-refresh" })).accessToken).toBe("new");
      expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Claude OAuth message protocol", () => {
  const executor = new DefaultExecutor("claude");
  const model = "claude-opus-4-8";
  const credentials = { accessToken: "test-oauth" };
  const fastBeta = "fast-mode-2026-02-01";

  beforeEach(() => vi.resetAllMocks());

  it("negotiates functional betas without changing the input envelope", async () => {
    const body = {
      speed: "fast", betas: ["structured-outputs-2025-12-15", "unknown-beta"],
      messages: [{ output_config: { effort: "medium" }, tool_addition: [] }],
      thread: {}, fallbacks: [{ model }],
    };
    proxyAwareFetch.mockResolvedValue(new Response("data: {}\n\n"));
    await executor.execute({ model, body, stream: true, credentials });
    const [url, request] = proxyAwareFetch.mock.calls[0];
    const headers = new Headers(request.headers);
    expect(url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(headers.get("authorization")).toBe("Bearer test-oauth");
    expect(headers.get("accept")).toBe("text/event-stream");
    expect(headers.get("accept-encoding")).toBe("identity");
    expect(headers.get("anthropic-beta").split(",")).toEqual(
      expect.arrayContaining([
        fastBeta, "inline-tools-2026-09-15", "oauth-2025-04-20", "structured-outputs-2025-12-15",
        "mid-conversation-output-config-2026-07-01", "message-threads-2026-08-12",
        "server-side-fallback-2026-06-01", "fallback-credit-2026-06-01"
      ])
    );
    expect(headers.get("anthropic-beta")).not.toContain("unknown-beta");
    expect(JSON.parse(request.body)).toMatchObject({ speed: "fast" });
    expect(JSON.parse(request.body)).not.toHaveProperty("betas");
    expect(body.betas).toHaveLength(2);
    expect(new Headers(executor.buildHeaders(credentials, false)).get("accept")).toBe("application/json");
  });

  it("negotiates standard speed and preserves output format on forced tool calls", async () => {
    const body = {
      speed: "standard", thinking: { type: "adaptive", block_binding: "preserved" },
      tool_choice: { type: "tool", name: "lookup" },
      output_config: { effort: "high", format: { type: "json_schema" } }
    };
    proxyAwareFetch.mockResolvedValueOnce(Response.json({}));
    const result = await executor.execute({ model, body, stream: false, credentials });
    const request = proxyAwareFetch.mock.calls[0][1];
    expect(new Headers(request.headers).get("anthropic-beta")).toContain(fastBeta);
    expect(JSON.parse(request.body)).not.toHaveProperty("thinking");
    expect(JSON.parse(request.body).output_config).toEqual({ format: { type: "json_schema" } });
    expect(body.output_config.effort).toBe("high");
    expect(result.claudeFast).toBeUndefined();
  });

  it("ignores a Fast beta inherited from transport defaults", () => {
    const headers = executor.buildHeaders({
      ...credentials,
      runtimeTransport: { headers: { "anthropic-beta": fastBeta } }
    }, false);
    expect(new Headers(headers).get("anthropic-beta")).not.toContain(fastBeta);
  });

  it("surfaces a Fast transport failure before applying a retry rule", async () => {
    proxyAwareFetch.mockRejectedValueOnce(new Error("Closed mock connection"));
    await expect(executor.execute({
      model, body: { speed: "fast" }, stream: false, credentials,
      requestPolicy: { maxRetries: 3 }
    })).rejects.toMatchObject({ claudeRequestScoped: true, errorKind: "network" });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ speed: "fast" }, {}, 429, true],
    [{ betas: fastBeta }, {}, 529, true],
    [{}, {}, 429, true],
    [{ speed: "fast" }, { "anthropic-ratelimit-unified-5h-status": "rejected" }, 429, false],
    [{ speed: "fast" }, {
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-representative-claim": "overage",
      "anthropic-ratelimit-unified-7d-status": "allowed"
    }, 429, true],
  ])("dispatches %s only once for %s / %s", async (body, headers, status, requestScoped) => {
    const payload = { type: "error", error: { message: "Usage credits are required for fast mode" } };
    proxyAwareFetch.mockResolvedValueOnce(Response.json(payload, { status, headers }));
    const result = await executor.execute({ model, body, stream: false, credentials });
    expect(result.claudeRequestScoped).toBe(requestScoped);
    expect(result.response.status).toBe(status);
    expect(await result.response.json()).toEqual(payload);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});

describe("Claude OAuth through the Messages and Models routes", () => {
  let messages, models, db;
  let directory;
  let originalFetch;

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-claude-parity-"));
    vi.stubEnv("DATA_DIR", directory);
    originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (...args) => proxyAwareFetch(...args));
    messages = await import("@/app/api/v1/messages/route.js");
    models = await import("@/app/api/v1/models/route.js");
    db = await import("@/lib/localDb");
    vi.stubGlobal("fetch", (...args) => proxyAwareFetch(...args));
    for (const suffix of ["first", "second"]) {
      await db.createProviderConnection({
        provider: "claude", authType: "oauth", email: `${suffix}@example.test`,
        accessToken: `mock-access-${suffix}`, isActive: true
      });
    }
    await db.createCombo({
      name: "claude-fast-parity", models: ["cc/claude-opus-4-6", "cc/claude-sonnet-4-6"]
    });
  }, 60_000);

  afterAll(() => {
    vi.unstubAllGlobals();
    if (originalFetch) globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  function mockMessages(respond) {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockImplementation(async (url, request) => {
      if (url === "https://api.anthropic.com/api/oauth/usage") {
        return Response.json({ five_hour: { utilization: 0, resets_at: new Date(Date.now() + 3600000).toISOString() } });
      }
      if (url === "https://api.anthropic.com/v1/messages/count_tokens?beta=true") return Response.json({ input_tokens: 4 });
      expect(url).toBe("https://api.anthropic.com/v1/messages?beta=true");
      return respond(request);
    });
  }

  function postMessage(options = {}, headers = {}) {
    return messages.POST(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        model: "cc/claude-opus-4-6", max_tokens: 32,
        messages: [{ role: "user", content: "Hello" }], ...options
      }),
    }));
  }

  it("publishes the restored IDs and returns a Fast 429 without rotating accounts", async () => {
    const response = await models.GET(new Request("http://localhost/v1/models"));
    expect((await response.json()).data.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "cc/claude-opus-4-6", "cc/claude-opus-4-5-20251101",
      "cc/claude-sonnet-4-6", "cc/claude-sonnet-4-5-20250929"
    ]));

    mockMessages(() => {
      return Response.json({ type: "error", error: { type: "rate_limit_error", message: "Fast request rejected" } }, { status: 429 });
    });
    const refusal = await postMessage({ speed: "fast" });
    expect(refusal.status).toBe(429);
    expect(refusal.headers.get("retry-after")).toBeNull();
    expect(await refusal.json()).toMatchObject({ error: { message: "Usage credits are required for fast mode" } });
    expect(proxyAwareFetch.mock.calls.filter(([url]) => url === "https://api.anthropic.com/v1/messages?beta=true")).toHaveLength(1);
    const connections = await db.getProviderConnections({ provider: "claude" });
    expect(connections.every(({ lastError }) => !lastError)).toBe(true);
  });

  it("keeps a Fast HTTP overload typed without retrying a sibling", async () => {
    const payload = { type: "error", error: { type: "overloaded_error", message: "Overloaded" } };
    mockMessages(() => Response.json(payload, { status: 529 }));
    const response = await postMessage({ model: "claude-fast-parity" }, { "anthropic-beta": "fast-mode-2026-02-01" });
    expect(response.status).toBe(529);
    expect(await response.json()).toMatchObject(payload);
    expect(proxyAwareFetch.mock.calls.filter(([url]) => url === "https://api.anthropic.com/v1/messages?beta=true")).toHaveLength(1);
  });

  it("preserves an in-band Fast overload without replaying the stream", async () => {
    mockMessages(() => {
      return new Response('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n', {
        headers: { "content-type": "text/event-stream" }
      });
    });
    const response = await postMessage({ model: "claude-fast-parity", speed: "fast", stream: true });
    const sse = await response.text();
    expect(sse).toContain("overloaded_error");
    expect(sse).not.toContain("message_stop");
    expect(proxyAwareFetch.mock.calls.filter(([url]) => url === "https://api.anthropic.com/v1/messages?beta=true")).toHaveLength(1);
    const connections = await db.getProviderConnections({ provider: "claude" });
    expect(connections.every(({ lastError }) => !lastError)).toBe(true);
  });

  it("rotates on shared quota rejection and retains the cooldown across models", async () => {
    const accounts = [];
    mockMessages((request) => {
      const account = new Headers(request.headers).get("authorization");
      accounts.push(account);
      if (accounts.length === 1) {
        return Response.json({ type: "error", error: { type: "rate_limit_error", message: "Usage limit reached" } }, {
          status: 429,
          headers: {
            "anthropic-ratelimit-unified-5h-status": "rejected",
            "anthropic-ratelimit-unified-5h-reset": String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      }
      return Response.json({
        id: "msg_mock", type: "message", model: "claude-opus-4-6", role: "assistant",
        content: [{ type: "text", text: "Success" }], stop_reason: "end_turn",
        usage: { input_tokens: 4, output_tokens: 1 },
      });
    });
    expect((await postMessage({ speed: "fast" })).status).toBe(200);
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).not.toBe(accounts[1]);
    expect((await postMessage({ model: "cc/claude-sonnet-4-6" })).status).toBe(200);
    expect(accounts).toHaveLength(3);
    expect(accounts[2]).toBe(accounts[1]);
  });
});
