import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyByKey: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: mocks.getApiKeyByKey,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
  getApiKeyUsageTotals: mocks.getApiKeyUsageTotals,
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => "sk-test"),
  evaluateApiKeyAuth: vi.fn(async () => ({ ok: true, stored: true })),
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));
vi.mock("../../open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function chatRequest(content, overrides = {}) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content }],
      stream: false,
      ...overrides,
    }),
  });
}

function responsesRequest(input, { accept = "application/json", stream } = {}) {
  const body = { model: "openai/gpt-4o", input };
  if (stream !== undefined) body.stream = stream;
  return new Request("http://localhost/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test",
      Accept: accept,
    },
    body: JSON.stringify(body),
  });
}

describe("Ponytail route integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({
      requireApiKey: true,
      ccFilterNaming: false,
      comboStrategy: "fallback",
      comboStickyRoundRobinLimit: 1,
    });
    mocks.getApiKeyByKey.mockResolvedValue({
      id: "key-id",
      name: "test key",
      allowedCombos: [],
    });
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({
      exceeded: false,
      usedTokens: 0,
      limitTokens: 0,
    });
    mocks.getApiKeyUsageTotals.mockResolvedValue({
      totalRequests: 4,
      totalTokens: 250,
      totalCost: 0.5,
    });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
  });

  it("returns scoped gain totals before model or provider account lookup", async () => {
    const response = await handleChat(chatRequest("/ponytail-gain"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.choices[0].message.content).toContain("lifetime (this API key)");
    expect(body.choices[0].message.content).toContain("total tokens: 250");
    expect(mocks.getApiKeyUsageTotals).toHaveBeenCalledOnce();
    expect(mocks.getApiKeyUsageTotals).toHaveBeenCalledWith("key-id");
    expect(mocks.getModelInfo).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("passes an ordinary request through to provider dispatch unchanged", async () => {
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "connection-1",
      connectionName: "test account",
      accessToken: "token",
    });
    mocks.handleChatCore.mockResolvedValue({
      success: true,
      response: new Response("upstream", { status: 200 }),
    });

    const requestBody = {
      messages: [
        { role: "tool", tool_call_id: "call_1", content: "/ponytail-help" },
        { role: "user", content: "hello" },
      ],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
      stream: true,
      temperature: 0.25,
      metadata: { trace: "keep-me" },
    };
    const response = await handleChat(chatRequest("unused", requestBody));

    expect(await response.text()).toBe("upstream");
    expect(mocks.getApiKeyUsageTotals).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials).toHaveBeenCalledOnce();
    expect(mocks.handleChatCore).toHaveBeenCalledOnce();
    expect(mocks.handleChatCore.mock.calls[0][0].body).toEqual({
      model: "openai/gpt-4o",
      ...requestBody,
    });
  });

  it("bypasses Ponytail command interception on X-DurinDoor-Token-Saver: off", async () => {
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "connection-1",
      connectionName: "test account",
      accessToken: "token",
    });
    mocks.handleChatCore.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "upstream" } }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });

    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
        "X-DurinDoor-Token-Saver": "off",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "/ponytail-help" }],
        stream: false,
      }),
    }));

    const body = await response.json();
    expect(body.choices[0].message.content).toBe("upstream");
    expect(mocks.getApiKeyUsageTotals).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials).toHaveBeenCalledOnce();
    expect(mocks.handleChatCore).toHaveBeenCalledOnce();
    expect(mocks.handleChatCore.mock.calls[0][0].body.messages).toEqual([
      { role: "user", content: "/ponytail-help" },
    ]);
  });

  it("returns native Responses JSON by default on the direct Next route", async () => {
    const response = await handleChat(responsesRequest([{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "/ponytail-help" }],
    }]));
    const body = await response.json();

    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(body).toMatchObject({
      object: "response",
      model: "openai/gpt-4o",
      status: "completed",
      output: [{ content: [{ type: "output_text" }] }],
    });
    expect(body.choices).toBeUndefined();
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("honors Accept SSE with ordered native events on the direct Responses route", async () => {
    const response = await handleChat(responsesRequest("/ponytail-help", {
      accept: "text/event-stream",
    }));
    const text = await response.text();
    const events = text.split("\n").filter((line) => line.startsWith("event: ")).map((line) => line.slice(7));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(events).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(events.filter((event) => event === "response.completed")).toHaveLength(1);
    expect(text).not.toContain('"choices"');
    expect(text).not.toContain("[DONE]");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
});
