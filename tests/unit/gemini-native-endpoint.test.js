import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  getSettings: vi.fn(),
  evaluateApiKeyAuth: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  resolveClientApiKey: vi.fn(),
  enforceApiKeyModelPolicy: vi.fn(),
  recordApiKeyUsageForResponse: vi.fn(),
}));

vi.mock("@/sse/handlers/chat.js", () => ({
  handleChat: mocks.handleChat,
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  evaluateApiKeyAuth: mocks.evaluateApiKeyAuth,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  resolveClientApiKey: mocks.resolveClientApiKey,
}));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
  recordApiKeyUsageForResponse: mocks.recordApiKeyUsageForResponse,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

const { GET } = await import("../../src/app/api/v1beta/models/route.js");
const { POST } = await import("../../src/app/api/v1beta/models/[...path]/route.js");

function makeGeminiRequest(path, body, headers = {}, signal) {
  return new Request(`https://router.test/v1beta/models/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer router-client-key",
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });
}

function audioBody() {
  return {
    contents: [{ parts: [{ text: "Speak naturally: hello" }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Kore" },
        },
      },
      temperature: 0.01,
      seed: 123,
    },
  };
}

describe("Gemini native v1beta endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.evaluateApiKeyAuth.mockResolvedValue({ ok: true, reason: null, stored: true });
    mocks.extractApiKey.mockImplementation((request) => {
      const auth = request.headers.get("authorization");
      return auth?.startsWith("Bearer ") ? auth.slice(7) : request.headers.get("x-api-key") || request.headers.get("x-goog-api-key") || new URL(request.url).searchParams.get("key");
    });
    mocks.resolveClientApiKey.mockImplementation(async (request) => ({
      apiKey: mocks.extractApiKey(request),
      auth: await mocks.evaluateApiKeyAuth(),
    }));
    mocks.enforceApiKeyModelPolicy.mockResolvedValue(null);
    mocks.recordApiKeyUsageForResponse.mockImplementation(async (_apiKey, response) => response);
    mocks.getProviderCredentials.mockResolvedValue({
      apiKey: "real-gemini-key",
      connectionId: "gemini-conn",
      connectionName: "Gemini Test",
      providerSpecificData: {},
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    mocks.handleChat.mockResolvedValue(
      Response.json({ candidates: [{ content: { parts: [{ text: "chat" }] } }] })
    );
  });

  it("lists Gemini TTS models using standard Google model names", async () => {
    const response = await GET();
    const body = await response.json();
    const names = body.models.map((model) => model.name);

    expect(names).toContain("models/gemini-3.1-flash-tts-preview");
    expect(names).toContain("models/gemini-2.5-flash-preview-tts");
    expect(names).toContain("models/gemini-2.5-pro-preview-tts");
  });

  it("passes Gemini AUDIO generateContent requests through to Google's native endpoint", async () => {
    const body = audioBody();
    const response = await POST(makeGeminiRequest("gemini-3.1-flash-tts-preview:generateContent", body), {
      params: Promise.resolve({ path: ["gemini-3.1-flash-tts-preview:generateContent"] }),
    });

    expect(response.status).toBe(200);
    expect(mocks.handleChat).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent"
    );

    const options = global.fetch.mock.calls[0][1];
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual(body);
    expect(options.headers["x-goog-api-key"]).toBe("real-gemini-key");
    expect(options.headers.Authorization).toBeUndefined();
    expect(mocks.recordApiKeyUsageForResponse).toHaveBeenCalledWith(
      "router-client-key",
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ tokens: expect.any(Number), cost: 0 }),
    );
  });

  it("accepts Google-style client keys without forwarding them upstream", async () => {
    const request = makeGeminiRequest(
      "gemini-2.5-flash-preview-tts:generateContent?key=query-router-key",
      audioBody(),
      {
        Authorization: "",
        "x-goog-api-key": "client-router-key",
      }
    );
    await POST(request, {
      params: Promise.resolve({ path: ["gemini-2.5-flash-preview-tts:generateContent"] }),
    });

    expect(mocks.resolveClientApiKey).toHaveBeenCalledWith(request, { required: true });
    expect(global.fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("real-gemini-key");
    expect(global.fetch.mock.calls[0][1].headers["x-goog-api-key"]).not.toBe("client-router-key");
  });

  it("enforces the canonical Gemini TTS model before credentials or fetch", async () => {
    mocks.enforceApiKeyModelPolicy.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const request = makeGeminiRequest("gemini-3.1-flash-tts-preview:generateContent", audioBody());
    const response = await POST(request, { params: Promise.resolve({ path: ["gemini-3.1-flash-tts-preview:generateContent"] }) });
    expect(response.status).toBe(403);
    expect(mocks.enforceApiKeyModelPolicy).toHaveBeenCalledWith(request, "gemini/gemini-3.1-flash-tts-preview", "router-client-key");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid stored key before native provider work when global enforcement is disabled", async () => {
    mocks.getSettings.mockResolvedValueOnce({ requireApiKey: false });
    mocks.evaluateApiKeyAuth.mockResolvedValueOnce({ ok: false, reason: "invalid", stored: true });

    const response = await POST(makeGeminiRequest("gemini-3.1-flash-tts-preview:generateContent", audioBody()), {
      params: Promise.resolve({ path: ["gemini-3.1-flash-tts-preview:generateContent"] }),
    });

    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Invalid API key");
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mocks.handleChat).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("does not forward stale compression headers from native upstream responses", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Content-Length": "123",
        },
      })
    );

    const response = await POST(makeGeminiRequest("gemini-3.1-flash-tts-preview:generateContent", audioBody()), {
      params: Promise.resolve({ path: ["gemini-3.1-flash-tts-preview:generateContent"] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("falls back to the next Gemini credential when native fetch times out before headers", async () => {
    const timeoutError = new TypeError("fetch failed");
    timeoutError.cause = { code: "UND_ERR_HEADERS_TIMEOUT", name: "HeadersTimeoutError" };

    mocks.getProviderCredentials
      .mockResolvedValueOnce({
        apiKey: "first-gemini-key",
        connectionId: "first-conn",
        connectionName: "First Gemini",
        providerSpecificData: {},
      })
      .mockResolvedValueOnce({
        apiKey: "second-gemini-key",
        connectionId: "second-conn",
        connectionName: "Second Gemini",
        providerSpecificData: {},
      });
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true });
    global.fetch
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: "pcm" } }] } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    const response = await POST(makeGeminiRequest("gemini-3.1-flash-tts-preview:generateContent", audioBody()), {
      params: Promise.resolve({ path: ["gemini-3.1-flash-tts-preview:generateContent"] }),
    });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("first-gemini-key");
    expect(global.fetch.mock.calls[1][1].headers["x-goog-api-key"]).toBe("second-gemini-key");
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "first-conn",
      504,
      expect.stringContaining("UND_ERR_HEADERS_TIMEOUT"),
      "gemini",
      "gemini-3.1-flash-tts-preview"
    );
    expect(mocks.clearAccountError).toHaveBeenCalledWith(
      "second-conn",
      expect.objectContaining({ apiKey: "second-gemini-key" }),
      "gemini-3.1-flash-tts-preview"
    );
  });

  it("returns 502 for native fetch failures when credential fallback is not allowed", async () => {
    const networkError = new TypeError("fetch failed");
    networkError.cause = { code: "ECONNRESET" };
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: false });
    global.fetch.mockRejectedValueOnce(networkError);

    const response = await POST(makeGeminiRequest("gemini-3.1-flash-tts-preview:generateContent", audioBody()), {
      params: Promise.resolve({ path: ["gemini-3.1-flash-tts-preview:generateContent"] }),
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.message).toContain("ECONNRESET");
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "gemini-conn",
      502,
      expect.stringContaining("ECONNRESET"),
      "gemini",
      "gemini-3.1-flash-tts-preview"
    );
  });

  it("does not mark Gemini credentials unavailable when the native client aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch.mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"));

    const response = await POST(
      makeGeminiRequest("gemini-3.1-flash-tts-preview:generateContent", audioBody(), {}, controller.signal),
      {
        params: Promise.resolve({ path: ["gemini-3.1-flash-tts-preview:generateContent"] }),
      }
    );

    expect(response.status).toBe(499);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("keeps non-audio Gemini requests on the existing chat conversion path", async () => {
    const body = {
      contents: [{ parts: [{ text: "hello" }] }],
      generationConfig: { temperature: 0.3 },
    };

    await POST(makeGeminiRequest("gemini-2.5-flash:generateContent", body), {
      params: Promise.resolve({ path: ["gemini-2.5-flash:generateContent"] }),
    });

    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not hijack provider-prefixed non-Gemini audio requests", async () => {
    await POST(makeGeminiRequest("openai/gpt-4o-mini-tts:generateContent", audioBody()), {
      params: Promise.resolve({ path: ["openai", "gpt-4o-mini-tts:generateContent"] }),
    });

    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
