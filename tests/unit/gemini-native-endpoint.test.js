import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  saveRequestUsage: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
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
vi.mock("@/sse/services/apiKeyPolicy.js", async (importOriginal) => ({
  ...await importOriginal(),
  enforceApiKeyModelPolicy: mocks.enforceApiKeyModelPolicy,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  saveRequestUsage: mocks.saveRequestUsage,
  getApiKeyUsageLimitStatus: mocks.getApiKeyUsageLimitStatus,
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
    mocks.saveRequestUsage.mockResolvedValue(true);
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ exceeded: false });
    mocks.getProviderCredentials.mockResolvedValue({
      apiKey: "real-gemini-key",
      connectionId: "gemini-conn",
      connectionName: "Gemini Test",
      providerSpecificData: {},
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: "cGNt" } }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 } }), {
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
    const delivered = await response.json();
    expect(delivered.candidates[0].content.parts[0].inlineData.data).toBe("cGNt");
  });

  it.each(["generateContent", "streamGenerateContent"])("persists real Gemini %s usage only after clean completion", async (action) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-native-ledger-"));
    const environment = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"].map((key) => [key, process.env[key]]));
    const previousAdapter = global._dbAdapter;
    const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
    const listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
    let adapter;
    try {
      process.env.DATA_DIR = directory;
      process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
      delete process.env.DURINDOOR_PG_URL;
      delete global._dbAdapter;
      vi.resetModules();
      adapter = await (await import("@/lib/db/driver.js")).getAdapter();
      adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)",
        ["gemini-key", "router-client-key", "Gemini test", new Date().toISOString()]);
      const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
      mocks.saveRequestUsage.mockImplementation(saveRequestUsage);
      const { POST: post } = await import("../../src/app/api/v1beta/models/[...path]/route.js");
      const usageMetadata = { promptTokenCount: 3, candidatesTokenCount: 5, thoughtsTokenCount: 2, cachedContentTokenCount: 1, totalTokenCount: 10 };
      let upstream;
      const streaming = action === "streamGenerateContent";
      // Module imports can restore fetch, so install this test's transport afterward.
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(streaming
        ? new Response(new ReadableStream({ start(controller) { upstream = controller; } }), { headers: { "content-type": "text/event-stream" } })
        : Response.json({ candidates: [{ finishReason: "STOP" }], usageMetadata })));
      const response = await post(makeGeminiRequest(`gemini-3.1-flash-tts-preview:${action}${streaming ? "?alt=sse" : ""}`, audioBody()), {
        params: Promise.resolve({ path: [`gemini-3.1-flash-tts-preview:${action}`] }),
      });
      expect(response.status).toBe(200);
      const rows = () => adapter.all("SELECT * FROM usageHistory");
      expect(rows()).toEqual([]);
      if (streaming) {
        const reader = response.body.getReader();
        for (const value of [
          { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } },
          { candidates: [{ finishReason: "STOP" }] },
          { usageMetadata },
        ]) {
          upstream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
          await reader.read();
          expect(rows()).toEqual([]);
        }
        upstream.close();
        expect((await reader.read()).done).toBe(true);
      } else {
        await response.json();
      }
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({
        provider: "gemini", model: "gemini-3.1-flash-tts-preview", connectionId: "gemini-conn",
        apiKey: "router-client-key", status: "ok", promptTokens: 3, completionTokens: 7, cachedTokens: 1, reasoningTokens: 2,
      });
      expect(JSON.parse(rows()[0].tokens)).toMatchObject({
        prompt_tokens: 3, completion_tokens: 7, total_tokens: 10, cached_tokens: 1, reasoning_tokens: 2,
      });
    } finally {
      vi.unstubAllGlobals();
      mocks.saveRequestUsage.mockReset().mockResolvedValue(true);
      await adapter?.close?.();
      if (previousAdapter === undefined) delete global._dbAdapter; else global._dbAdapter = previousAdapter;
      for (const signal of signals) for (const listener of process.listeners(signal)) {
        if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
      }
      for (const [key, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(directory, { recursive: true, force: true });
      vi.resetModules();
    }
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

    expect(global.fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("real-gemini-key");
    expect(global.fetch.mock.calls[0][1].headers["x-goog-api-key"]).not.toBe("client-router-key");
  });

  it("enforces the canonical Gemini TTS model before credentials or fetch", async () => {
    mocks.enforceApiKeyModelPolicy.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const request = makeGeminiRequest("gemini-3.1-flash-tts-preview:generateContent", audioBody());
    const response = await POST(request, { params: Promise.resolve({ path: ["gemini-3.1-flash-tts-preview:generateContent"] }) });
    expect(response.status).toBe(403);
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
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
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
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
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
