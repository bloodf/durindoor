import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Outbound wire proof for the Grok Build subscription protocol.
 * Ported from decolua/9router#2590: the official @xai-official/grok 0.2.99
 * client talks to cli-chat-proxy.grok.com with a grok-shell fingerprint, omits
 * the legacy grok-pager headers, and never sends reasoning.effort for
 * grok-build — while still requesting encrypted-reasoning continuity.
 * Non-Build models must keep the legacy 0.2.93 header path preserved.
 */

const GROK_CLI_URL = "https://cli-chat-proxy.grok.com/v1/responses";

function normalSseResponse() {
  const text = [
    "event: response.output_text.delta",
    'data: {"type":"response.output_text.delta","delta":"ok"}',
    "",
    "event: response.completed",
    'data: {"type":"response.completed"}',
    "",
  ].join("\n");
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const proxyAwareFetch = vi.fn(async () => normalSseResponse());

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("grok-cli Grok Build subscription wire protocol (#2590)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockClear();
    proxyAwareFetch.mockImplementation(async () => normalSseResponse());
  });

  async function executeWithModel(model, bodyFields = {}) {
    const { GrokCliExecutor, _resetGrokCliTurnStore } = await import(
      "../../open-sse/executors/grok-cli.js"
    );
    _resetGrokCliTurnStore();
    const executor = new GrokCliExecutor();
    const result = await executor.execute({
      model,
      body: {
        model,
        input: [{ type: "message", role: "user", content: "hi" }],
        ...bodyFields,
      },
      stream: true,
      credentials: {
        accessToken: "test-token",
        connectionId: "conn_test",
        providerSpecificData: { email: "u@example.com", userId: "uid-1" },
        rawHeaders: { "x-session-id": "client-session-3169" },
      },
      log: null,
    });
    return result;
  }

  function parsePostedCall() {
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(GROK_CLI_URL);
    expect(options.method).toBe("POST");
    return { headers: options.headers, body: JSON.parse(options.body) };
  }

  it("grok-build posts the official 0.2.99 grok-shell fingerprint", async () => {
    await executeWithModel("grok-build");
    const { headers, body } = parsePostedCall();

    // Official 0.2.99 client fingerprint
    expect(headers["User-Agent"]).toBe("grok-shell/0.2.99 (linux; x86_64)");
    expect(headers["x-grok-client-identifier"]).toBe("grok-shell");
    expect(headers["x-grok-client-version"]).toBe("0.2.99");

    // Legacy grok-pager headers omitted on the Build wire
    expect(headers["x-xai-token-auth"]).toBeUndefined();
    expect(headers["x-authenticateresponse"]).toBeUndefined();
    expect(headers["x-compaction-at"]).toBeUndefined();

    // Auth + identity survive
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["x-email"]).toBe("u@example.com");
    expect(headers["x-userid"]).toBe("uid-1");
    // execute() callers may omit requestContext; BaseExecutor must allocate and
    // thread one so request-scoped Grok metadata still reaches outbound headers.
    expect(headers["x-grok-conv-id"]).toBe("client-session-3169");
    expect(headers["x-grok-req-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["x-grok-turn-idx"]).toBe("1");

    // Build never sends reasoning effort; summary continuity is kept and
    // encrypted reasoning is still requested for store=false multi-turn.
    expect(body.model).toBe("grok-build");
    expect(body.reasoning).toEqual({ summary: "concise" });
    expect(body.reasoning?.effort).toBeUndefined();
    expect(body.include).toContain("reasoning.encrypted_content");
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
  });

  it("grok-build strips a caller-supplied effort but preserves summary", async () => {
    await executeWithModel("grok-build", {
      reasoning: { effort: "high", summary: "detailed" },
      reasoning_effort: "low",
    });
    const { body } = parsePostedCall();

    expect(body.reasoning).toEqual({ summary: "detailed" });
    expect(body.reasoning?.effort).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.include).toContain("reasoning.encrypted_content");
  });

  it("non-Build models keep the legacy 0.2.93 header path and effort", async () => {
    await executeWithModel("grok-4.5", { reasoning_effort: "low" });
    const { headers, body } = parsePostedCall();

    // Legacy fingerprint unchanged
    expect(headers["User-Agent"]).toBe("grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)");
    expect(headers["x-xai-token-auth"]).toBe("xai-grok-cli");
    expect(headers["x-grok-client-identifier"]).toBe("grok-pager");
    expect(headers["x-grok-client-version"]).toBe("0.2.93");
    expect(headers["x-authenticateresponse"]).toBe("authenticate-response");
    expect(headers["x-compaction-at"]).toBe("400000");

    // Reasoning-capable models keep effort on the wire
    expect(body.model).toBe("grok-4.5");
    expect(body.reasoning).toEqual({ effort: "low", summary: "concise" });
    expect(body.include).toContain("reasoning.encrypted_content");
  });

  it("passes the upstream Responses SSE stream through to the client", async () => {
    const result = await executeWithModel("grok-build");
    parsePostedCall();

    const response = result?.response ?? result;
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("response.output_text.delta");
    expect(text).toContain("response.completed");
  });
});
