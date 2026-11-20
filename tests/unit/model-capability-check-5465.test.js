import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// port(upstream): #5465 - on-demand model capability check.
//
// Offline only: the gateway is a mocked fetch, so no provider, account or
// network is involved. The fixtures are the provider answers a capability
// check has to tell apart.

const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
  isOperatorRequest: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: mocks.isOperatorRequest,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const originalFetch = global.fetch;

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const TOOL_CALL_ANSWER = {
  choices: [{
    message: {
      role: "assistant",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"location\":\"Paris\"}" } }],
    },
    finish_reason: "tool_calls",
  }],
};

const PROSE_ANSWER = {
  choices: [{ message: { role: "assistant", content: "It is sunny in Paris." }, finish_reason: "stop" }],
};

const post = (body) => new Request("http://localhost/api/models/test", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("on-demand model capability check (port upstream #5465)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeys.mockResolvedValue([{ key: "sk-internal", isActive: true }]);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.isOperatorRequest.mockResolvedValue(true);
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(TOOL_CALL_ANSWER));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends exactly one normal chat request that carries a tool definition", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(post({ model: "openai/gpt-4o", kind: "llm", check: "tools" }));
    const body = await res.json();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(String(url)).toContain("/api/v1/chat/completions");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("openai/gpt-4o");
    expect(sent.stream).toBe(false);
    expect(sent.tools).toHaveLength(1);
    expect(sent.tools[0].function.name).toBe("get_weather");
    expect(sent.tool_choice).toBe("auto");
  });

  it("treats a returned tool_call as confirmed support", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(post({ model: "openai/gpt-4o", kind: "llm", check: "tools" }));
    const body = await res.json();

    // A model that answers with a tool_call has no prose content. That is a
    // successful answer, not an empty completion.
    expect(body.ok).toBe(true);
    expect(body.error).toBeNull();
    expect(body.capability.check).toBe("tools");
    expect(body.capability.evidence).toBe("tool_call");
    expect(body.capability.supported).toBe(true);
  });

  it("reports a client error as a rejection of the tool request", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "tools are not supported" } }, 400));
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(post({ model: "openai/gpt-4o", kind: "llm", check: "tools" }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.capability.evidence).toBe("rejected");
    expect(body.capability.supported).toBe(false);
    expect(body.capability.detail).toContain("tools are not supported");
  });

  it.each([401, 403, 429, 500, 404])(
    "reports status %i as no capability evidence, never as missing support",
    async (status) => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "upstream said no" } }, status));
      const { POST } = await import("../../src/app/api/models/test/route.js");
      const res = await POST(post({ model: "openai/gpt-4o", kind: "llm", check: "tools" }));
      const body = await res.json();

      expect(body.capability.evidence).toBe("inconclusive");
      expect(body.capability.supported).toBeNull();
    },
  );

  it("reports an accepted request that returned no tool_call as unproven", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(PROSE_ANSWER));
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(post({ model: "openai/gpt-4o", kind: "llm", check: "tools" }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.capability.evidence).toBe("no_tool_call");
    expect(body.capability.supported).toBeNull();
  });

  it("reports the declared capability next to the measured one", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");

    const declared = await (await POST(post({ model: "openai/gpt-4o", kind: "llm", check: "tools" }))).json();
    expect(declared.capability.declared).toBe(true);

    const undeclared = await (await POST(post({ model: "aihorde/koboldcpp/LLaMA2-13B", kind: "llm", check: "tools" }))).json();
    expect(undeclared.capability.declared).toBe(false);
  });

  it("exposes the request and cost semantics of the check", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(post({ model: "openai/gpt-4o", kind: "llm", check: "tools" }));
    const body = await res.json();

    expect(body.capability.request).toMatchObject({
      operation: "chat.completions",
      endpoint: "/api/v1/chat/completions",
      maxTokens: 1024,
      tool: "get_weather",
    });
    expect(body.capability.cost.upstreamRequests).toBe(1);
    expect(body.capability.cost.note).toMatch(/quota|charge/i);
  });

  it("keeps the selected account scope of the existing probe", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");
    await POST(post({ model: "openai/gpt-4o", kind: "llm", check: "tools", connectionId: " conn-7 " }));

    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers["x-connection-id"]).toBe("conn-7");
    expect(headers["x-9r-cli-token"]).toBe("cli-token");
  });

  it("still refuses an account pin from a non-operator", async () => {
    mocks.isOperatorRequest.mockResolvedValue(false);
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(post({ model: "openai/gpt-4o", kind: "llm", check: "tools", connectionId: "conn-7" }));

    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["vision", "unsupported check name"],
    ["", "empty check name"],
    [42, "non-string check"],
  ])("rejects %j (%s) without probing", async (check) => {
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(post({ model: "openai/gpt-4o", kind: "llm", check }));

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a capability check on a non-chat kind", async () => {
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(post({ model: "voyage/voyage-3-large", kind: "embedding", check: "tools" }));

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("leaves the plain probe contract untouched when no check is requested", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(PROSE_ANSWER));
    const { POST } = await import("../../src/app/api/models/test/route.js");
    const res = await POST(post({ model: "openai/gpt-4o", kind: "llm" }));
    const body = await res.json();

    expect(body.capability).toBeUndefined();
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.tools).toBeUndefined();
    expect(sent.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("capability check classification", () => {
  it("keeps the verdict three-valued", async () => {
    const { classifyCapabilityEvidence } = await import("../../src/app/api/models/test/capabilityCheck.js");

    expect(classifyCapabilityEvidence({ ok: true, parsed: TOOL_CALL_ANSWER }))
      .toMatchObject({ evidence: "tool_call", supported: true });
    expect(classifyCapabilityEvidence({ ok: true, parsed: PROSE_ANSWER }))
      .toMatchObject({ evidence: "no_tool_call", supported: null });
    expect(classifyCapabilityEvidence({ ok: false, status: 400, error: "HTTP 400: nope", parsed: null }))
      .toMatchObject({ evidence: "rejected", supported: false });
    expect(classifyCapabilityEvidence({ ok: false, status: 429, error: "HTTP 429: slow down", parsed: null }))
      .toMatchObject({ evidence: "inconclusive", supported: null });
    expect(classifyCapabilityEvidence({ ok: false, status: 0, error: "timeout", parsed: null }))
      .toMatchObject({ evidence: "inconclusive", supported: null });
  });

  it("builds a single portable tool request", async () => {
    const { buildCapabilityProbeRequest } = await import("../../src/app/api/models/test/capabilityCheck.js");
    const request = buildCapabilityProbeRequest("openai/gpt-4o", { maxTokens: 1024 });

    expect(request.tools).toHaveLength(1);
    expect(request.tools[0].type).toBe("function");
    expect(request.tool_choice).toBe("auto");
    expect(request.stream).toBe(false);
    expect(request.max_tokens).toBe(1024);
  });
});
