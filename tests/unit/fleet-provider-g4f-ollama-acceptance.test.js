/**
 * #1188 scope: offline comparison of installed native Ollama with the unregistered
 * g4f-ollama candidate. g4f/web/app-server is not the native vendor. Registry
 * exports prove metadata only; mocked HTTP cannot prove account access, model
 * availability, tool execution, or live streaming. Keep candidate capabilities
 * unavailable until account-backed endpoint/auth/model evidence exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport }));
// Registry import otherwise starts an unrelated release lookup at module load.
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "kimchi/offline-fixture" }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => null),
}));
vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
  getProviderNodeById: vi.fn(),
}));

import { POST as validate } from "../../src/app/api/providers/validate/route.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { OllamaLocalExecutor } from "../../open-sse/executors/ollama-local.js";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

const candidate = "g4f-ollama";
const credentials = { apiKey: "offline-fixture-not-a-credential" };
const model = "gpt-oss:120b";
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const validateProvider = (provider) => validate(new Request("http://localhost:20127/api/providers/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider, ...credentials }),
}));

beforeEach(() => {
  transport.mockReset();
  transport.mockImplementation(() => { throw new Error("Unexpected offline transport call"); });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => vi.unstubAllGlobals());

describe("#1188 g4f-ollama is not installed native Ollama", () => {
  it("rejects candidate validation and discovery without borrowing Ollama identity or making HTTP calls", async () => {
    expect(AI_PROVIDERS[candidate]).toBeUndefined();
    expect(PROVIDERS[candidate]).toBeUndefined();
    expect(AI_PROVIDERS.ollama.alias).not.toBe(candidate);
    expect(AI_PROVIDERS.ollama.aliases || []).not.toContain(candidate);
    const response = await validateProvider(candidate);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Provider validation not supported" });
    expect(await fetchConnectionModels({ id: "offline-candidate", provider: candidate, ...credentials })).toEqual({
      error: "Provider g4f-ollama does not support models listing", status: 400,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses native /api/tags with Bearer for discovery, but does not treat public tags as account proof", async () => {
    const models = [{ name: model, model, details: { family: "gptoss" } }];
    transport.mockResolvedValueOnce(json({ models }));
    const result = await fetchConnectionModels({ id: "offline-native", provider: "ollama", ...credentials });
    expect(result.models).toEqual(models);
    expect(transport).toHaveBeenCalledExactlyOnceWith("https://ollama.com/api/tags", expect.objectContaining({
      method: "GET", headers: expect.objectContaining({ Authorization: `Bearer ${credentials.apiKey}` }),
    }), null);
    transport.mockClear();
    expect(await probeRegistryProvider("ollama", credentials.apiKey, transport)).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it("discovers and chats through configured local native endpoints without requiring cloud credentials", async () => {
    const local = { id: "offline-local-1188", provider: "ollama-local", providerSpecificData: { baseUrl: "http://127.0.0.1:11434" } };
    const localModel = "offline-local-1188:latest";
    transport.mockImplementation(async (url) => {
      if (url.endsWith("/api/tags")) return json({ models: [{ name: localModel, capabilities: ["completion"] }] });
      if (url.endsWith("/api/ps")) return json({ models: [] });
      if (url.endsWith("/api/chat")) return json({ model: localModel, message: { role: "assistant", content: "local" }, done: true });
      throw new Error(`Unexpected local endpoint: ${url}`);
    });
    expect(await fetchConnectionModels(local)).toMatchObject({ models: [{ id: localModel, kind: "llm", capabilities: { tools: false, vision: false } }] });
    expect(transport.mock.calls.map(([url]) => url).sort()).toEqual([
      "http://127.0.0.1:11434/api/ps", "http://127.0.0.1:11434/api/tags",
    ]);
    const body = openaiToOllamaRequest(localModel, { messages: [{ role: "user", content: "hi" }] }, false);
    const result = await new OllamaLocalExecutor().execute({ model: localModel, body, stream: false, credentials: local });
    expect(result.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(await result.response.json()).toMatchObject({ message: { content: "local" }, done: true });
    expect(transport).toHaveBeenCalledTimes(3);
    for (const [, init] of transport.mock.calls) {
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
    }
    transport.mockClear();
    expect(await fetchConnectionModels({ provider: "ollama" })).toEqual({ error: "No valid token found", status: 401 });
    expect(transport).not.toHaveBeenCalled();
  });

  it("round-trips installed native nonstream chat without promoting candidate support", async () => {
    const completion = { model, message: { role: "assistant", content: "hello" }, done: true };
    transport.mockResolvedValueOnce(json(completion));
    const body = openaiToOllamaRequest(model, { messages: [{ role: "user", content: "hi" }] }, false);
    const result = await new DefaultExecutor("ollama").execute({ model, body, stream: false, credentials });
    expect(result.url).toBe("https://ollama.com/api/chat");
    expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual(body);
    expect(await result.response.json()).toEqual(completion);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(AI_PROVIDERS[candidate]).toBeUndefined();
  });

  it("does not validate an unverified account key merely because public native tags returns 200", async () => {
    // Public tags accepts bad keys (existing provider-probe-validate-url-format
    // regression documents this). The POST route must not contradict that guard.
    transport.mockResolvedValueOnce(json({ models: [{ name: model }] }));
    const response = await validateProvider("ollama");
    const result = await response.json();
    expect(transport.mock.calls[0][0]).toBe("https://ollama.com/api/tags");
    expect(transport.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${credentials.apiKey}`);
    expect(result.valid).toBe(false);
  });

  it.each([401, 403])("preserves native auth rejection (%i) in validation, discovery, and chat", async (status) => {
    transport.mockImplementation(async () => json({ error: "fixture access denied" }, status));
    const validation = await validateProvider("ollama");
    expect(await validation.json()).toEqual({ valid: false, error: "Invalid API key" });
    expect(await fetchConnectionModels({ provider: "ollama", ...credentials })).toMatchObject({ status });
    const executor = new DefaultExecutor("ollama");
    const result = await executor.execute({ model, body: { model, messages: [{ role: "user", content: "hi" }], stream: false }, stream: false, credentials });
    expect(result.response.status).toBe(status);
    expect(executor.parseError(result.response, await result.response.text())).toMatchObject({ status, message: expect.stringContaining("fixture access denied") });
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "https://ollama.com/api/tags", "https://ollama.com/api/tags", "https://ollama.com/api/chat",
    ]);
  });

  it("sends translated tool history to native /api/chat and consumes mocked native NDJSON", async () => {
    const tools = [{ type: "function", function: { name: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }];
    const body = openaiToOllamaRequest(model, {
      messages: [
        { role: "user", content: "Weather in Paris?" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_fixture", type: "function", function: { name: "weather", arguments: '{"city":"Paris"}' } }] },
        { role: "tool", tool_call_id: "call_fixture", content: "Sunny" },
      ], tools, max_tokens: 16,
    }, true);
    const frames = [
      { model, message: { role: "assistant", content: "Sunny" }, done: false },
      { model, message: { role: "assistant", content: "" }, done: true, done_reason: "stop", eval_count: 1 },
    ];
    const bytes = new TextEncoder().encode(frames.map((frame) => JSON.stringify(frame) + "\n").join(""));
    transport.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 19));
        controller.enqueue(bytes.slice(19));
        controller.close();
      },
    }), { headers: { "Content-Type": "application/x-ndjson" } }));
    const result = await new DefaultExecutor("ollama").execute({ model, body, stream: true, credentials });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://ollama.com/api/chat");
    expect(init.headers.Authorization).toBe(`Bearer ${credentials.apiKey}`);
    expect(JSON.parse(init.body)).toMatchObject({
      model, stream: true, tools, options: { num_predict: 16 },
      messages: [
        { role: "user", content: "Weather in Paris?" },
        { role: "assistant", tool_calls: [{ function: { name: "weather", arguments: { city: "Paris" } } }] },
        { role: "tool", tool_name: "weather", content: "Sunny" },
      ],
    });
    expect(result.response.headers.get("content-type")).toBe("application/x-ndjson");
    expect((await result.response.text()).trim().split("\n").map(JSON.parse)).toEqual(frames);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not turn a g4f-style /v1-only transport mismatch into native success", async () => {
    // Synthetic mismatch fixture, not a claim about any deployed g4f server.
    transport.mockImplementation(async (url) => {
      expect(url).toBe("https://ollama.com/api/chat");
      return json({ error: "Unsupported native endpoint; fixture only serves /v1/chat/completions" }, 404);
    });
    const executor = new DefaultExecutor("ollama");
    const result = await executor.execute({ model, body: { model, messages: [{ role: "user", content: "hi" }], stream: false }, stream: false, credentials });
    expect(result.response.ok).toBe(false);
    expect(executor.parseError(result.response, await result.response.text())).toMatchObject({ status: 404, message: expect.stringContaining("Unsupported native endpoint") });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
