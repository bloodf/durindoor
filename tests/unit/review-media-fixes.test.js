// Regression tests for #2181 (media proxy + abort signal),
// #2182 (AssemblyAI polling status/abort handling), and
// #2183 (binary image output rejecting n > 1).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleModerationsCore } from "../../open-sse/handlers/moderationsCore.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
} from "../../open-sse/utils/proxyFetch.js";

const originalGlobalFetch = global.fetch;

const PROXY_URL = "http://conn-proxy.test:8080";
const PROXY_DATA = {
  connectionProxyEnabled: true,
  connectionProxyUrl: PROXY_URL,
  disableEnvProxy: true,
};

function makeAudioForm(extra = {}) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }), "clip.wav");
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("#2181 moderationsCore proxy and abort signal", () => {
  let restoreOriginalFetch;
  const fakeDispatcher = { id: "conn-proxy-dispatcher" };

  beforeEach(() => {
    __clearProxyDispatchersForTesting();
    __setProxyDispatcherForTesting(PROXY_URL, fakeDispatcher);
  });

  afterEach(() => {
    restoreOriginalFetch?.();
    restoreOriginalFetch = null;
    __clearProxyDispatchersForTesting();
    global.fetch = originalGlobalFetch;
    vi.restoreAllMocks();
  });

  it("routes through the credential connection proxy and forwards the abort signal", async () => {
    const captured = [];
    restoreOriginalFetch = __setOriginalFetchForTesting(async (url, init) => {
      captured.push({ url: String(url), init });
      return jsonRes({ id: "modr-1", results: [{ flagged: false }] });
    });

    const ctrl = new AbortController();
    const result = await handleModerationsCore({
      body: { input: "hello world" },
      modelInfo: { provider: "openai", model: "omni-moderation-latest" },
      credentials: { apiKey: "mod-key", providerSpecificData: PROXY_DATA },
      signal: ctrl.signal,
    });

    expect(result.success).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://api.openai.com/v1/moderations");
    expect(captured[0].init.dispatcher).toBe(fakeDispatcher);
    expect(captured[0].init.signal).toBe(ctrl.signal);
  });

  it("returns 499 without fetching when signal is already aborted", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const ctrl = new AbortController();
    ctrl.abort();

    const result = await handleModerationsCore({
      body: { input: "hello" },
      modelInfo: { provider: "openai", model: "omni-moderation-latest" },
      credentials: { apiKey: "mod-key" },
      signal: ctrl.signal,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 499 when upstream fetch is aborted in flight", async () => {
    const ctrl = new AbortController();
    global.fetch = vi.fn(async () => {
      ctrl.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });

    const result = await handleModerationsCore({
      body: { input: "hello" },
      modelInfo: { provider: "openai", model: "omni-moderation-latest" },
      credentials: { apiKey: "mod-key" },
      signal: ctrl.signal,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
  });
});

describe("#2181 moderations route handler abort signal", () => {
  let coreMock;
  let markUnavailable;
  let credentialsMock;
  let handleModerations;

  beforeEach(async () => {
    vi.resetModules();
    coreMock = vi.fn();
    markUnavailable = vi.fn(async () => ({ shouldFallback: true }));
    credentialsMock = vi.fn()
      .mockResolvedValueOnce({ connectionId: "conn-1", connectionName: "acct-1", apiKey: "k1", providerSpecificData: PROXY_DATA })
      .mockResolvedValue({ allRateLimited: true, lastError: "exhausted" });

    vi.doMock("@/lib/localDb", () => ({
      getSettings: vi.fn(async () => ({ requireApiKey: false, modelFallbacks: { "openai/omni-moderation-latest": { fallbacks: ["openai/text-moderation-latest"] } } })),
    }));
    vi.doMock("../../src/sse/services/auth.js", () => ({
      getProviderCredentialsWithQuotaPreflight: credentialsMock,
      getNoAuthProviderCredentials: vi.fn(),
      markAccountUnavailable: markUnavailable,
      clearAccountError: vi.fn(),
      resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } })),
    }));
    vi.doMock("../../src/sse/services/model.js", () => ({
      getModelInfo: vi.fn(async (m) => {
        const [provider, ...rest] = String(m).split("/");
        return { provider, model: rest.join("/") };
      }),
    }));
    vi.doMock("../../src/sse/services/tokenRefresh.js", () => ({
      checkAndRefreshToken: vi.fn(async (_p, creds) => creds),
    }));
    vi.doMock("../../src/sse/services/apiKeyPolicy.js", () => ({
      enforceApiKeyModelPolicy: vi.fn(async () => null),
      recordApiKeyUsageForResponse: vi.fn(async (_k, response) => response),
    }));
    vi.doMock("../../src/sse/utils/requestCorrelation.js", () => ({
      getRequestId: vi.fn(() => "req-mod-1"),
      withRequestCorrelation: (fn) => fn,
    }));
    vi.doMock("open-sse/handlers/moderationsCore.js", () => ({
      handleModerationsCore: coreMock,
    }));

    ({ handleModerations } = await import("../../src/sse/handlers/moderations.js"));
  });

  afterEach(() => {
    for (const mod of [
      "@/lib/localDb",
      "../../src/sse/services/auth.js",
      "../../src/sse/services/model.js",
      "../../src/sse/services/tokenRefresh.js",
      "../../src/sse/services/apiKeyPolicy.js",
      "../../src/sse/utils/requestCorrelation.js",
      "open-sse/handlers/moderationsCore.js",
    ]) {
      vi.doUnmock(mod);
    }
    vi.resetModules();
  });

  it("forwards request.signal and does not cool down account or run fallbacks on client abort", async () => {
    const ctrl = new AbortController();
    coreMock.mockImplementationOnce(async () => {
      ctrl.abort();
      return {
        success: false,
        status: 499,
        error: "Moderation request aborted",
        response: new Response(JSON.stringify({ error: { message: "Moderation request aborted" } }), { status: 499 }),
      };
    });

    const req = new Request("http://localhost/v1/moderations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "openai/omni-moderation-latest", input: "hello" }),
      signal: ctrl.signal,
    });

    const response = await handleModerations(req);
    expect(response.status).toBe(499);
    expect(coreMock).toHaveBeenCalledTimes(1);
    expect(coreMock.mock.calls[0][0].signal).toBe(req.signal);
    expect(coreMock.mock.calls[0][0].credentials.providerSpecificData).toEqual(PROXY_DATA);
    expect(markUnavailable).not.toHaveBeenCalled();
    expect(credentialsMock).toHaveBeenCalledTimes(1);
  });
});

describe("#2181 Deepgram, AssemblyAI, and HuggingFace STT proxy and abort signal", () => {
  let restoreOriginalFetch;
  const fakeDispatcher = { id: "stt-conn-proxy-dispatcher" };

  beforeEach(() => {
    __clearProxyDispatchersForTesting();
    __setProxyDispatcherForTesting(PROXY_URL, fakeDispatcher);
  });

  afterEach(() => {
    restoreOriginalFetch?.();
    restoreOriginalFetch = null;
    __clearProxyDispatchersForTesting();
    global.fetch = originalGlobalFetch;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Deepgram STT uses the connection proxy and forwards signal", async () => {
    const captured = [];
    restoreOriginalFetch = __setOriginalFetchForTesting(async (url, init) => {
      captured.push({ url: String(url), init });
      return jsonRes({ results: { channels: [{ alternatives: [{ transcript: "proxied dg" }] }] } });
    });

    const ctrl = new AbortController();
    const result = await handleSttCore({
      provider: "deepgram",
      model: "nova-3",
      formData: makeAudioForm(),
      credentials: { apiKey: "dg-key", providerSpecificData: PROXY_DATA },
      sttConfig: { baseUrl: "https://api.deepgram.com/v1/listen", authType: "apikey", authHeader: "token", format: "deepgram" },
      signal: ctrl.signal,
    });

    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "proxied dg" });
    expect(captured).toHaveLength(1);
    expect(captured[0].init.dispatcher).toBe(fakeDispatcher);
    expect(captured[0].init.signal).toBe(ctrl.signal);
  });

  it("HuggingFace STT uses the connection proxy and forwards signal", async () => {
    const captured = [];
    restoreOriginalFetch = __setOriginalFetchForTesting(async (url, init) => {
      captured.push({ url: String(url), init });
      return jsonRes({ text: "proxied hf" });
    });

    const ctrl = new AbortController();
    const result = await handleSttCore({
      provider: "huggingface",
      model: "openai/whisper-large-v3",
      formData: makeAudioForm(),
      credentials: { apiKey: "hf-key", providerSpecificData: PROXY_DATA },
      sttConfig: { baseUrl: "https://router.huggingface.co/hf-inference/models", authType: "apikey", authHeader: "bearer", format: "huggingface-asr" },
      signal: ctrl.signal,
    });

    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "proxied hf" });
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3");
    expect(captured[0].init.dispatcher).toBe(fakeDispatcher);
    expect(captured[0].init.signal).toBe(ctrl.signal);
  });

  it("AssemblyAI STT uses the connection proxy and forwards signal across upload, submit, and poll", async () => {
    vi.useFakeTimers();
    const captured = [];
    const responses = [
      jsonRes({ upload_url: "https://cdn.assemblyai.com/audio.wav" }),
      jsonRes({ id: "tr-proxy-1" }),
      jsonRes({ status: "completed", text: "proxied aai", audio_duration: 2 }),
    ];
    restoreOriginalFetch = __setOriginalFetchForTesting(async (url, init) => {
      captured.push({ url: String(url), init });
      return responses.shift();
    });

    const ctrl = new AbortController();
    const pending = handleSttCore({
      provider: "assemblyai",
      model: "universal-2",
      formData: makeAudioForm(),
      credentials: { apiKey: "aai-key", providerSpecificData: PROXY_DATA },
      sttConfig: { baseUrl: "https://api.assemblyai.com/v2/transcript", authType: "apikey", authHeader: "authorization", format: "assemblyai" },
      signal: ctrl.signal,
    });

    for (let i = 0; i < 50 && vi.getTimerCount() === 0; i++) {
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "proxied aai" });
    expect(captured.map((c) => c.url)).toEqual([
      "https://api.assemblyai.com/v2/upload",
      "https://api.assemblyai.com/v2/transcript",
      "https://api.assemblyai.com/v2/transcript/tr-proxy-1",
    ]);
    for (const call of captured) {
      expect(call.init.dispatcher).toBe(fakeDispatcher);
      expect(call.init.signal).toBe(ctrl.signal);
    }
  });

  it.each([
    ["deepgram", { baseUrl: "https://api.deepgram.com/v1/listen", authType: "apikey", authHeader: "token", format: "deepgram" }, "nova-3"],
    ["huggingface", { baseUrl: "https://router.huggingface.co/hf-inference/models", authType: "apikey", authHeader: "bearer", format: "huggingface-asr" }, "openai/whisper-large-v3"],
    ["assemblyai", { baseUrl: "https://api.assemblyai.com/v2/transcript", authType: "apikey", authHeader: "authorization", format: "assemblyai" }, "universal-2"],
  ])("%s STT returns 499 (local) on abort during fetch", async (provider, sttConfig, model) => {
    const ctrl = new AbortController();
    global.fetch = vi.fn(async () => {
      ctrl.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });

    const result = await handleSttCore({
      provider,
      model,
      formData: makeAudioForm(),
      credentials: { apiKey: "secret-key" },
      sttConfig,
      signal: ctrl.signal,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
    expect(result.local).toBe(true);
  });
});

describe("#2182 AssemblyAI polling status handling and abort", () => {
  const AAI_CONFIG = {
    baseUrl: "https://api.assemblyai.com/v2/transcript",
    authType: "apikey",
    authHeader: "authorization",
    format: "assemblyai",
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalGlobalFetch;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function flushToNextTimer() {
    for (let i = 0; i < 50 && vi.getTimerCount() === 0; i++) {
      await vi.advanceTimersByTimeAsync(0);
    }
  }

  it.each([400, 401, 403, 404, 422])("returns upstream error immediately on poll HTTP %i without retrying", async (status) => {
    const token = "aai-secret-token-2182";
    const responses = [
      jsonRes({ upload_url: "https://cdn.example/a.wav" }),
      jsonRes({ id: "tr-4xx" }),
      jsonRes({ error: `rejected ${token}` }, status),
    ];
    const fetchMock = vi.fn(async () => {
      if (!responses.length) throw new Error("Should not keep polling after 4xx");
      return responses.shift();
    });
    global.fetch = fetchMock;

    const pending = handleSttCore({
      provider: "assemblyai",
      model: "universal-2",
      formData: makeAudioForm(),
      credentials: { apiKey: token },
      sttConfig: AAI_CONFIG,
    });

    await flushToNextTimer();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.status).toBe(status);
    expect(result.error).not.toContain(token);
    expect(result.error).toContain("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps polling on 429 and 5xx until completed", async () => {
    const responses = [
      jsonRes({ upload_url: "https://cdn.example/a.wav" }),
      jsonRes({ id: "tr-retry" }),
      jsonRes({ error: "rate limited" }, 429),
      jsonRes({ error: "internal error" }, 500),
      jsonRes({ error: "unavailable" }, 503),
      jsonRes({ status: "completed", text: "recovered transcript", audio_duration: 4 }),
    ];
    const fetchMock = vi.fn(async () => responses.shift());
    global.fetch = fetchMock;

    const pending = handleSttCore({
      provider: "assemblyai",
      model: "universal-2",
      formData: makeAudioForm(),
      credentials: { apiKey: "aai-key" },
      sttConfig: AAI_CONFIG,
    });

    for (let poll = 0; poll < 4; poll++) {
      await flushToNextTimer();
      await vi.advanceTimersByTimeAsync(2000);
    }

    const result = await pending;
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "recovered transcript" });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("stops polling immediately when aborted during the poll wait interval", async () => {
    const responses = [
      jsonRes({ upload_url: "https://cdn.example/a.wav" }),
      jsonRes({ id: "tr-abort-wait" }),
      jsonRes({ status: "processing" }),
    ];
    const fetchMock = vi.fn(async () => responses.shift() || jsonRes({ status: "processing" }));
    global.fetch = fetchMock;

    const ctrl = new AbortController();
    const pending = handleSttCore({
      provider: "assemblyai",
      model: "universal-2",
      formData: makeAudioForm(),
      credentials: { apiKey: "aai-key" },
      sttConfig: AAI_CONFIG,
      signal: ctrl.signal,
    });

    // Complete first poll -> enters second sleep timer
    await flushToNextTimer();
    await vi.advanceTimersByTimeAsync(2000);
    await flushToNextTimer();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);

    ctrl.abort();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
    expect(result.local).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("#2183 binary image output rejects n > 1", () => {
  afterEach(() => {
    global.fetch = originalGlobalFetch;
    vi.restoreAllMocks();
  });

  it.each([2, 4, "2"])("handleImageGenerationCore rejects binaryOutput with n=%s before any upstream call", async (n) => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const result = await handleImageGenerationCore({
      body: { prompt: "a lighthouse", n },
      modelInfo: { provider: "openai", model: "gpt-image-1" },
      credentials: { apiKey: "img-key" },
      binaryOutput: true,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/binary/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handleImageGenerationCore allows binaryOutput with n=1 or omitted, and JSON output with n>1", async () => {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString("base64");
    global.fetch = vi.fn(async () => jsonRes({ created: 1, data: [{ b64_json: pngB64 }, { b64_json: pngB64 }] }));

    const singleBinary = await handleImageGenerationCore({
      body: { prompt: "a lighthouse", n: 1 },
      modelInfo: { provider: "openai", model: "gpt-image-1" },
      credentials: { apiKey: "img-key" },
      binaryOutput: true,
    });
    expect(singleBinary.success).toBe(true);
    expect(singleBinary.response.headers.get("Content-Type")).toBe("image/png");

    const multiJson = await handleImageGenerationCore({
      body: { prompt: "a lighthouse", n: 2 },
      modelInfo: { provider: "openai", model: "gpt-image-1" },
      credentials: { apiKey: "img-key" },
      binaryOutput: false,
    });
    expect(multiJson.success).toBe(true);
    expect((await multiJson.response.json()).data).toHaveLength(2);
  });

  describe("route handler (src/sse/handlers/imageGeneration.js)", () => {
    let coreMock;
    let credentialsMock;
    let handleImageGeneration;

    beforeEach(async () => {
      vi.resetModules();
      coreMock = vi.fn(async () => ({ success: true, response: new Response("ok"), accounting: { state: "complete" } }));
      credentialsMock = vi.fn(async () => ({ connectionId: "conn-1", apiKey: "img-key" }));

      vi.doMock("open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: coreMock }));
      vi.doMock("../../src/sse/services/auth.js", () => ({
        getProviderCredentialsWithQuotaPreflight: credentialsMock,
        getNoAuthProviderCredentials: vi.fn(),
        markAccountUnavailable: vi.fn(),
        clearAccountError: vi.fn(),
        resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } })),
      }));
      vi.doMock("@/lib/localDb", () => ({
        getSettings: vi.fn(async () => ({})),
        getApiKeyByKey: vi.fn(async () => null),
        getComboForModel: vi.fn(async () => null),
      }));
      vi.doMock("../../src/sse/services/model.js", () => ({
        getModelInfo: vi.fn(async (m) => {
          const [provider, ...rest] = String(m).split("/");
          return { provider, model: rest.join("/") };
        }),
        getComboModels: vi.fn(async () => null),
        getComboCanonicalName: vi.fn(async () => null),
      }));
      vi.doMock("../../src/sse/services/tokenRefresh.js", () => ({
        updateProviderCredentials: vi.fn(),
        checkAndRefreshToken: vi.fn(async (_p, creds) => creds),
      }));
      vi.doMock("../../src/sse/services/apiKeyPolicy.js", () => ({
        enforceApiKeyModelPolicy: vi.fn(async () => null),
        recordApiKeyUsage: vi.fn(),
        recordApiKeyUsageForResponse: vi.fn(async (_k, response) => response),
      }));
      vi.doMock("../../src/sse/utils/requestCorrelation.js", () => ({
        captureRequestBillingEpoch: vi.fn(async () => {}),
        getRequestId: vi.fn(() => "req-img-1"),
        withRequestCorrelation: (fn) => fn,
      }));
      vi.doMock("../../src/sse/services/mediaRoutes.js", () => ({
        wantsDefaultRoute: vi.fn(() => false),
        resolveMediaRoute: vi.fn(),
        defaultRouteComboOptions: () => ({}),
      }));
      vi.doMock("open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));

      ({ handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js"));
    });

    afterEach(() => {
      for (const mod of [
        "open-sse/handlers/imageGenerationCore.js",
        "../../src/sse/services/auth.js",
        "@/lib/localDb",
        "../../src/sse/services/model.js",
        "../../src/sse/services/tokenRefresh.js",
        "../../src/sse/services/apiKeyPolicy.js",
        "../../src/sse/utils/requestCorrelation.js",
        "../../src/sse/services/mediaRoutes.js",
        "open-sse/services/comboRoutingPolicy.js",
      ]) {
        vi.doUnmock(mod);
      }
      vi.resetModules();
    });

    it("returns 400 for ?response_format=binary with n > 1 before credential selection or upstream calls", async () => {
      const req = new Request("http://localhost/v1/images/generations?response_format=binary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-image-1", prompt: "a fox", n: 2 }),
      });

      const res = await handleImageGeneration(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toMatch(/binary/i);
      expect(credentialsMock).not.toHaveBeenCalled();
      expect(coreMock).not.toHaveBeenCalled();
    });

    it("allows ?response_format=binary with n=1 and non-binary with n=2", async () => {
      const binReq = new Request("http://localhost/v1/images/generations?response_format=binary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-image-1", prompt: "a fox", n: 1 }),
      });
      const binRes = await handleImageGeneration(binReq);
      expect(binRes.status).toBe(200);
      expect(coreMock).toHaveBeenCalledTimes(1);

      const jsonReq = new Request("http://localhost/v1/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-image-1", prompt: "a fox", n: 2 }),
      });
      const jsonResOut = await handleImageGeneration(jsonReq);
      expect(jsonResOut.status).toBe(200);
      expect(coreMock).toHaveBeenCalledTimes(2);
    });
  });
});
