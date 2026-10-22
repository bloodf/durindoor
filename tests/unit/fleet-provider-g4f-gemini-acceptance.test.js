/**
 * Issue #1185 offline acceptance scope: installed `gemini` is Google's native
 * API, not evidence for g4f, Gemini Web, or an app-server transport. Synthetic
 * fetch fixtures prove request wiring only, never account access or capability
 * availability. Candidate capabilities must stay hidden until account-backed
 * endpoint/auth/model, tool, stream, and error verification is available.
 * Production is read-only; the unsupported-identity regression requests a grant.
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

  it("keeps unregistered candidate models and metadata hidden, not aliased to native Gemini", () => {
    expect(PROVIDERS.gemini.baseUrl).toBe(nativeBase);
    expect(PROVIDERS.gemini.format).toBe("gemini");
    expect(PROVIDERS[candidate]).toBeUndefined();
    expect(getModelsByProviderId(candidate)).toEqual([]);
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

  it("rejects candidate validation and model discovery without sending its credential", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(connection(candidate));
    expect(await testSingleConnection(`fixture-${candidate}`)).toMatchObject({
      valid: false, error: "Provider test not supported",
    });
    expect(await fetchConnectionModels(connection(candidate))).toEqual({
      error: `Provider ${candidate} does not support models listing`, status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
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

  it("rejects unsupported candidate executor identity before credential-bearing transport dispatch", async () => {
    // A mock success must not turn an unknown provider's OpenAI fallback into support.
    fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "wrong vendor" } }] }));
    await expect(Promise.resolve().then(() => getExecutor(candidate).execute({
      model, body: { messages: [{ role: "user", content: "hello" }] },
      stream: false, credentials: connection(candidate),
    }))).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
