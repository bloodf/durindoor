/**
 * Issue #1187: offline acceptance boundary, not account-backed provider proof.
 * Installed NVIDIA NIM uses native HTTPS + Bearer auth; g4f/web/app-server is
 * a distinct, unregistered identity, not an alias. Mocked catalogs, tool calls,
 * SSE bytes and errors prove local dispatch only, never live capabilities.
 * Keep candidate capabilities hidden until authorized account-backed evidence
 * verifies endpoint, authentication, models, tools, streaming and failures.
 * Authorized shared executor isolation preserves explicit custom transports.
 * HTTP dispatch evidence uses only a mocked active connection and fake key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
  getProviderNodeById: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

import { getProviderConnections } from "@/lib/localDb.js";
import { POST as send } from "../../src/app/api/translator/send/route.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { POST } from "../../src/app/api/providers/validate/route.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { normalizeProviderId } from "../../src/lib/providerNormalization.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

const candidate = "g4f-nvidia";
const model = "meta/llama-3.1-8b-instruct";
const credentials = { apiKey: "offline-fixture-not-a-credential" };
const modelsUrl = "https://integrate.api.nvidia.com/v1/models";
const chatUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
const connection = { id: "offline-nvidia", provider: "nvidia", ...credentials };
const catalog = { object: "list", data: [{ id: model, object: "model", owned_by: "meta" }] };
let fetchMock;
let restoreFetch;

function validationRequest(provider, extra = {}) {
  return new Request("http://localhost:20127/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, ...credentials, ...extra }),
  });
}

async function execute(provider, body, stream = false, account = credentials) {
  return getExecutor(provider).execute({ model, body, stream, credentials: account });
}

beforeEach(() => {
  fetchMock = vi.fn(() => { throw new Error("Unexpected offline fetch"); });
  vi.stubGlobal("fetch", fetchMock);
  restoreFetch = __setOriginalFetchForTesting(fetchMock);
});

afterEach(() => {
  restoreFetch();
  vi.unstubAllGlobals();
});

describe("#1187 g4f-nvidia versus installed native NVIDIA", () => {
  it("keeps candidate identity and capabilities unregistered rather than borrowing NVIDIA metadata", async () => {
    expect(normalizeProviderId("NVIDIA NIM")).toBe("nvidia");
    expect(normalizeProviderId(candidate)).toBe(candidate);
    expect(AI_PROVIDERS[candidate]).toBeUndefined();
    expect(PROVIDERS[candidate]).toBeUndefined();
    expect(PROVIDER_MODELS[candidate]).toBeUndefined();
    const response = await POST(validationRequest(candidate));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Provider validation not supported" });
    await expect(fetchConnectionModels({ ...connection, provider: candidate })).resolves.toEqual({
      error: "Provider g4f-nvidia does not support models listing", status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses native catalog endpoint and Bearer auth for validator and account model discovery", async () => {
    fetchMock.mockImplementation(async () => Response.json(catalog));
    const response = await POST(validationRequest("NVIDIA NIM"));
    await expect(response.json()).resolves.toEqual({ valid: true, error: null });
    await expect(fetchConnectionModels(connection)).resolves.toEqual({ models: catalog.data });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe(modelsUrl);
      expect(new Headers(options.headers).get("authorization")).toBe(`Bearer ${credentials.apiKey}`);
      expect(options.body).toBeUndefined();
    }
  });

  it.each([401, 403])("does not accept native auth failure %s or return static models", async (status) => {
    fetchMock.mockImplementation(async () => Response.json({ error: "fixture auth rejected" }, { status }));
    const response = await POST(validationRequest("nvidia"));
    await expect(response.json()).resolves.toEqual({ valid: false, error: "Invalid API key" });
    const discovery = await fetchConnectionModels(connection);
    expect(discovery).toMatchObject({ status, error: expect.stringContaining("fixture auth rejected") });
    expect(discovery.models).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dispatches native tool conversation, never treats g4f app-server URL or cookie as native auth", async () => {
    const toolCall = { id: "abc123def", type: "function", function: { name: "lookup", arguments: "{}" } };
    const payload = { id: "offline-chat", choices: [{ message: { role: "assistant", tool_calls: [toolCall] }, finish_reason: "tool_calls" }] };
    fetchMock.mockResolvedValueOnce(Response.json(payload));
    const body = {
      model, stream: false,
      messages: [
        { role: "assistant", content: null, tool_calls: [toolCall] },
        { role: "tool", tool_call_id: toolCall.id, content: "fixture result" },
      ],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }],
      tool_choice: "auto",
    };
    const result = await execute("nvidia", structuredClone(body), false, {
      ...credentials,
      providerSpecificData: { baseUrl: "http://localhost:8080/v1", cookie: "offline-g4f-cookie" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(chatUrl);
    expect(new Headers(options.headers).get("authorization")).toBe(`Bearer ${credentials.apiKey}`);
    expect(new Headers(options.headers).get("cookie")).toBeNull();
    expect(JSON.parse(options.body)).toMatchObject(body);
    await expect(result.response.json()).resolves.toEqual(payload);
  });

  it("preserves mocked native tool SSE and done marker without claiming live stream support", async () => {
    const chunk = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "abc123def", type: "function", function: { name: "lookup", arguments: "{}" } }] }, finish_reason: "tool_calls" }] };
    const sse = `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
    fetchMock.mockResolvedValueOnce(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
    const result = await execute("nvidia", { model, stream: true, messages: [{ role: "user", content: "fixture" }] }, true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(chatUrl);
    expect(new Headers(options.headers).get("accept")).toBe("text/event-stream");
    expect(JSON.parse(options.body)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    await expect(result.response.text()).resolves.toBe(sse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves native model-not-found status instead of synthesizing a successful completion", async () => {
    const error = { error: { code: "model_not_found", message: "fixture model unavailable" } };
    fetchMock.mockResolvedValueOnce(Response.json(error, { status: 404 }));
    const result = await execute("nvidia", { model, messages: [{ role: "user", content: "fixture" }] });
    expect(result.response.status).toBe(404);
    await expect(result.response.json()).resolves.toEqual(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(chatUrl);
  });

  it.each([
    ["openai-compatible-chat-offline", { providerSpecificData: { baseUrl: "http://localhost:8080/v1" } }, "http://localhost:8080/v1/chat/completions"],
    ["openai-compatible-responses-offline", { providerSpecificData: { baseUrl: "http://localhost:8080/v1" } }, "http://localhost:8080/v1/responses"],
    ["anthropic-compatible-offline", { providerSpecificData: { baseUrl: "http://localhost:8080/v1" } }, "http://localhost:8080/v1/messages"],
    ["offline-direct-proxy", { runtimeTransport: { format: "openai", baseUrl: "http://localhost:8080/v1/chat/completions" } }, "http://localhost:8080/v1/chat/completions"],
    ["offline-direct-claude", { runtimeTransport: { format: "claude", baseUrl: "http://localhost:8080/v1/messages", auth: { combined: true, header: "x-api-key", scheme: "raw" } } }, "http://localhost:8080/v1/messages"],
  ])("preserves explicit custom transport %s without borrowing OpenAI vendor config", async (provider, config, url) => {
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [] }));
    const result = await execute(provider, { model, messages: [{ role: "user", content: "fixture" }] }, false, { ...credentials, ...config });
    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(url);
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    if (provider.includes("claude") || provider.startsWith("anthropic-compatible-")) {
      expect(headers.get("x-api-key")).toBe(credentials.apiKey);
    } else {
      expect(headers.get("authorization")).toBe(`Bearer ${credentials.apiKey}`);
    }
  });

  it("resolves native registry alias without selecting OpenAI fallback", () => {
    expect(getExecutor("cc")).toBe(getExecutor("claude"));
    expect(new DefaultExecutor("cc").buildUrl(model, false)).toBe(`${PROVIDERS.claude.baseUrl}${PROVIDERS.claude.urlSuffix || ""}`);
  });

  it("blocks direct DefaultExecutor construction from restoring implicit vendor dispatch", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [] }));
    await expect(new DefaultExecutor(candidate).execute({ model, body: { model, messages: [] }, stream: false, credentials })).rejects.toThrow(/unsupported|not supported|unknown provider/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not dispatch unknown stored connection credentials through translator send HTTP handler", async () => {
    getProviderConnections.mockResolvedValueOnce([{ ...connection, provider: candidate, isActive: true }]);
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [] }));
    const response = await send(new Request("http://localhost:20127/api/translator/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: candidate, model, body: { model, stream: false, messages: [{ role: "user", content: "fixture" }] } }),
    }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false, error: 'Unknown provider "g4f-nvidia": no supported transport endpoint',
      request_id: expect.any(String),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported candidate transport before credentials can dispatch to an unrelated vendor", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [] }));
    await expect(execute(candidate, { model, messages: [{ role: "user", content: "fixture" }] })).rejects.toThrow(/unsupported|not supported|unknown provider/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
