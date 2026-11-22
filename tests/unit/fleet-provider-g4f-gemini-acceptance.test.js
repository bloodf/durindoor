/**
 * Issue #1185 offline acceptance scope: installed `gemini` is Google's native
 * API, not evidence for g4f, Gemini Web, or an app-server transport. Synthetic
 * fetch fixtures prove request wiring only, never account access or capability
 * availability. Registered g4f dispatch and unregistered-provider rejection
 * are both exercised with closed transport mocks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => globalThis.fetch(...args),
}));
// Registry import otherwise starts an unrelated background release lookup.
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-fixture",
}));

import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";

const candidate = "g4f-gemini";
const model = "gemini-2.5-flash";
const nativeBase = "https://generativelanguage.googleapis.com/v1beta/models";
const connection = (provider = "gemini") => ({
  id: `fixture-${provider}`,
  provider,
  authType: "apikey",
  apiKey: "offline-fixture-key",
  providerSpecificData: { baseUrl: "http://localhost:8080/v1" },
});
const toolBody = () => ({
  contents: [{ role: "user", parts: [{ text: "Read temperature in Paris" }] }],
  tools: [{ functionDeclarations: [{
    name: "temperature",
    description: "Read temperature",
    parameters: { type: "OBJECT", properties: { city: { type: "STRING" } }, required: ["city"] },
  }] }],
  toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["temperature"] } },
});
const toolResponse = {
  candidates: [{ content: { role: "model", parts: [{
    functionCall: { name: "temperature", args: { city: "Paris" } },
  }] }, finishReason: "STOP" }],
};

async function executeNative(stream = false) {
  return getExecutor("gemini").execute({
    model, body: toolBody(), stream, credentials: connection(),
  });
}

describe("#1185 g4f-gemini identity and offline native comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unconfigured offline fetch"); }));
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false, connectionProxyUrl: "", vercelRelayUrl: "",
    });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the registered g4f candidate separate from native Gemini", () => {
    expect(PROVIDERS.gemini.baseUrl).toBe(nativeBase);
    expect(PROVIDERS.gemini.format).toBe("gemini");
    expect(PROVIDERS[candidate]).toMatchObject({
      baseUrl: "https://g4f.space/api/gemini/v1/chat/completions",
      format: "openai",
    });
    expect(getModelsByProviderId(candidate).map((entry) => entry.id)).toEqual(["models/gemini-2.5-flash", "models/gemini-2.5-pro"]);
    expect(getModelsByProviderId("gemini").some((entry) => entry.id === model)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates installed native key against Google, ignoring app-server base URL", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(connection());
    fetch.mockResolvedValueOnce(Response.json({ models: [{ name: `models/${model}` }] }));
    expect(await testSingleConnection("fixture-gemini")).toMatchObject({ valid: true, error: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/v1/models?key=offline-fixture-key");
    expect(fetch.mock.calls[0][1].headers?.Authorization).toBeUndefined();
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("fixture-gemini", expect.objectContaining({ testStatus: "active" }));
  });

  it("validates and discovers the candidate against g4f.space only, never Google", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(connection(candidate));
    fetch.mockResolvedValue(Response.json({ data: [{ id: `models/${model}` }] }));
    expect(await testSingleConnection(`fixture-${candidate}`)).toMatchObject({ valid: true, error: null });
    expect(await fetchConnectionModels(connection(candidate))).toMatchObject({ models: [{ id: `models/${model}` }] });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://g4f.space/api/gemini/v1/models",
      "https://g4f.space/api/gemini/v1/models",
    ]);
    for (const [, options] of fetch.mock.calls) expect(options.headers.Authorization).toBe("Bearer offline-fixture-key");
  });

  it("discovers account-fixture models through native Google query auth, not g4f /v1/models", async () => {
    const models = [{ name: `models/${model}`, supportedGenerationMethods: ["generateContent"] }];
    fetch.mockResolvedValueOnce(Response.json({ models }));
    expect(await fetchConnectionModels(connection())).toEqual({ models });
    const [url, options] = fetch.mock.calls[0];
    expect(new URL(url).origin + new URL(url).pathname).toBe(nativeBase);
    expect(new URL(url).searchParams.get("key")).toBe("offline-fixture-key");
    expect(options).toMatchObject({ method: "GET", cache: "no-store" });
    expect(options.headers.Authorization).toBeUndefined();
  });

  it("does not replace denied discovery with published static model capabilities", async () => {
    const error = { error: { code: 403, message: "Account lacks Gemini access", status: "PERMISSION_DENIED" } };
    fetch.mockResolvedValueOnce(Response.json(error, { status: 403 }));
    const result = await fetchConnectionModels(connection());
    expect(result).toEqual({ error: JSON.stringify(error), status: 403 });
    expect(result.models).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("executes native tool request and preserves native function-call response", async () => {
    fetch.mockResolvedValueOnce(Response.json(toolResponse));
    const result = await executeNative();
    expect(result.url).toBe(`${nativeBase}/${model}:generateContent`);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(result.url);
    expect(options.method).toBe("POST");
    expect(options.headers["x-goog-api-key"]).toBe("offline-fixture-key");
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.parse(options.body)).toEqual(toolBody());
    expect(await result.response.json()).toEqual(toolResponse);
  });

  it("preserves native SSE tool chunks and stream endpoint, without claiming g4f streaming", async () => {
    const frames = `data: ${JSON.stringify(toolResponse)}\n\ndata: ${JSON.stringify({ candidates: [{ finishReason: "STOP" }] })}\n\n`;
    fetch.mockResolvedValueOnce(new Response(frames, { headers: { "Content-Type": "text/event-stream" } }));
    const result = await executeNative(true);
    expect(result.url).toBe(`${nativeBase}/${model}:streamGenerateContent?alt=sse`);
    expect(fetch.mock.calls[0][1].headers.Accept).toBe("text/event-stream");
    expect(await result.response.text()).toBe(frames);
  });

  it("preserves native auth error status/body without fabricating a tool result", async () => {
    const error = { error: { code: 401, message: "Invalid fixture key", status: "UNAUTHENTICATED" } };
    fetch.mockResolvedValueOnce(Response.json(error, { status: 401 }));
    const result = await executeNative();
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an unregistered identity without reading models or dispatching credentials", async () => {
    const provider = "fleet-unregistered-provider-1185";
    expect(PROVIDERS[provider]).toBeUndefined();
    expect(getModelsByProviderId(provider)).toEqual([]);
    mocks.getProviderConnectionById.mockResolvedValue(connection(provider));
    expect(await testSingleConnection(`fixture-${provider}`)).toMatchObject({
      valid: false, error: "Provider test not supported",
    });
    expect(await fetchConnectionModels(connection(provider))).toEqual({
      error: `Provider ${provider} does not support models listing`, status: 400,
    });
    fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "wrong vendor" } }] }));
    await expect(getExecutor(provider).execute({
      model, body: { messages: [{ role: "user", content: "hello" }] },
      stream: false, credentials: connection(provider),
    })).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("dispatches the candidate to g4f.space with its own key, never to Google or an app-server base URL", async () => {
    fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "from g4f" } }] }));
    const result = await getExecutor(candidate).execute({
      model: `models/${model}`, body: { messages: [{ role: "user", content: "hello" }] },
      stream: false, credentials: connection(candidate),
    });
    expect(result.url).toBe("https://g4f.space/api/gemini/v1/chat/completions");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://g4f.space/api/gemini/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer offline-fixture-key");
    expect(options.headers["x-goog-api-key"]).toBeUndefined();
    expect(await result.response.json()).toMatchObject({ choices: [{ message: { content: "from g4f" } }] });
  });
});
