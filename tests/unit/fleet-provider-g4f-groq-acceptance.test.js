/**
 * Issue #1186 scope: offline comparison of installed native Groq against the
 * unregistered g4f-groq identity. g4f/web/app-server is not the native vendor.
 * Mocked validation, discovery, tools and SSE prove local wire behavior only;
 * registry exports prove metadata, not account-backed capability or support.
 * Live verification is unavailable. No candidate capabilities are registered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: vi.fn(() => "kimchi/offline-fixture"),
  updateKimchiUserAgent: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
  getProviderNodeById: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => null),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn((url, init) => globalThis.fetch(url, init)),
}));

import { POST } from "../../src/app/api/providers/validate/route.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { normalizeProviderId } from "../../src/lib/providerNormalization.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const candidate = "g4f-groq";
const model = "llama-3.3-70b-versatile";
const apiKey = "offline-fixture-not-a-credential";
const modelsUrl = "https://api.groq.com/openai/v1/models";
const chatUrl = "https://api.groq.com/openai/v1/chat/completions";
const appServerUrl = "http://localhost:8080/v1";
const connection = {
  id: "offline-groq", provider: "groq", apiKey,
  providerSpecificData: { baseUrl: appServerUrl },
};
const tool = {
  type: "function",
  function: {
    name: "lookup", description: "Look up a fixture value",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
};
const toolCall = {
  id: "call_fixture", type: "function",
  function: { name: "lookup", arguments: '{"key":"fixture"}' },
};

function validate(provider) {
  return POST(new Request("http://localhost:20127/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey, providerSpecificData: { baseUrl: appServerUrl } }),
  }));
}

function execute(provider = "groq", stream = false) {
  return new DefaultExecutor(provider).execute({
    model, stream, credentials: { ...connection, provider },
    body: {
      model, stream, max_tokens: 32,
      messages: [
        { role: "user", content: "Look up fixture" },
        { role: "assistant", content: null, tool_calls: [structuredClone(toolCall)] },
        { role: "tool", tool_call_id: toolCall.id, content: "fixture value" },
      ],
      tools: [structuredClone(tool)], tool_choice: "auto",
    },
    requestPolicy: { maxTransportAttempts: 1 },
  });
}

describe("#1186 native Groq is not g4f-groq (offline partial acceptance)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected offline fetch"); }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("validates and discovers native models with bearer auth, ignoring an app-server URL", async () => {
    const catalog = { object: "list", data: [{ id: model, object: "model", owned_by: "groq" }] };
    fetch.mockImplementation(async () => Response.json(catalog));
    expect(await (await validate("groq")).json()).toEqual({ valid: true, error: null });
    expect(await fetchConnectionModels(connection)).toEqual({ models: catalog.data });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe(modelsUrl);
      expect(init.headers.Authorization).toBe(`Bearer ${apiKey}`);
      expect(init.headers.Cookie).toBeUndefined();
    }
    expect(fetch.mock.calls[1][1].method).toBe("GET");
  });

  it("rejects candidate validation and discovery without borrowing native Groq identity", async () => {
    expect(normalizeProviderId(candidate)).toBe(candidate);
    expect(AI_PROVIDERS[candidate]).toBeUndefined();
    const response = await validate(candidate);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Provider validation not supported" });
    expect(await fetchConnectionModels({ ...connection, provider: candidate })).toEqual({
      error: "Provider g4f-groq does not support models listing", status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends native tool history and returns a tool-call response without app-server routing", async () => {
    const completion = {
      id: "chatcmpl-fixture", object: "chat.completion", model,
      choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [toolCall] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    };
    fetch.mockResolvedValue(Response.json(completion));
    const result = await execute();
    expect(result.url).toBe(chatUrl);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(chatUrl);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(init.body)).toMatchObject({
      model, stream: false, tools: [tool], tool_choice: "auto",
      messages: [
        { role: "user", content: "Look up fixture" },
        { role: "assistant", tool_calls: [toolCall] },
        { role: "tool", tool_call_id: "call_fixture", content: "fixture value" },
      ],
    });
    expect(await result.response.json()).toEqual(completion);
  });

  it("preserves native SSE tool deltas, usage and DONE without proving live tool support", async () => {
    const chunks = [
      { id: "chatcmpl-fixture", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...toolCall }] }, finish_reason: null }] },
      { id: "chatcmpl-fixture", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      { id: "chatcmpl-fixture", choices: [], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } },
    ];
    const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    fetch.mockResolvedValue(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
    const result = await execute("groq", true);
    const [, init] = fetch.mock.calls[0];
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(init.body)).toMatchObject({ stream: true, stream_options: { include_usage: true }, tools: [tool] });
    expect(result.url).toBe(chatUrl);
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    expect(await result.response.text()).toBe(sse);
  });

  it.each([401, 403, 429, 503])("does not turn native HTTP %i into credential or model proof", async (status) => {
    const error = { error: { message: "Offline upstream rejection", type: "fixture_error" } };
    fetch.mockImplementation(async () => Response.json(error, { status }));
    expect(await (await validate("groq")).json()).toEqual({ valid: false, error: "Invalid API key" });
    const discovery = await fetchConnectionModels(connection);
    expect(discovery.status).toBe(status);
    expect(discovery.error).toBeTruthy();
    expect(discovery.models).toBeUndefined();
    const result = await execute();
    expect(result.response.status).toBe(status);
    expect(await result.response.json()).toEqual(error);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects unsupported candidate execution with status 400 before any fetch", async () => {
    // Requires shared executor guard 43d4b946 / PR #1283; production stays read-only.
    // A fallback vendor request is a regression, not candidate transport support.
    try {
      await expect(execute(candidate)).rejects.toMatchObject({ status: 400 });
    } finally {
      expect(fetch).not.toHaveBeenCalled();
    }
    expect(AI_PROVIDERS[candidate]).toBeUndefined();
  });
});
