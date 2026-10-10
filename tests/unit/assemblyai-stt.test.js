import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

const originalFetch = global.fetch;

function makeFormData(language) {
  const formData = new FormData();
  formData.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "speech.wav");
  if (language !== undefined) formData.set("language", language);
  return formData;
}

async function transcribe({ authHeader = "authorization", language } = {}) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ upload_url: "https://cdn.example/audio.wav" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "transcript-id" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", text: "hola" }) });
  global.fetch = fetchMock;

  const result = await handleSttCore({
    provider: "assemblyai",
    model: "universal-2",
    formData: makeFormData(language),
    credentials: { apiKey: "test-api-key" },
    sttConfig: {
      baseUrl: "https://api.assemblyai.com/v2/transcript",
      authType: "apikey",
      authHeader,
      format: "assemblyai",
    },
  });

  return { fetchMock, result };
}

describe("AssemblyAI STT", () => {
  beforeEach(() => {
    vi.spyOn(global, "setTimeout").mockImplementation((callback) => {
      callback();
      return 0;
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.each([
    ["authorization", { Authorization: "test-api-key" }],
    ["bearer", { Authorization: "Bearer test-api-key" }],
    ["token", { Authorization: "Token test-api-key" }],
    ["x-api-key", { "x-api-key": "test-api-key" }],
    ["key", { Authorization: "Key test-api-key" }],
  ])("uses the %s auth scheme for upload, submit, and poll", async (authHeader, expectedAuth) => {
    const { fetchMock, result } = await transcribe({ authHeader });

    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "hola" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers).toMatchObject(expectedAuth);
    }
  });

  it("maps a submitted language to language_code", async () => {
    const { fetchMock } = await transcribe({ language: "es" });
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);

    expect(payload).toMatchObject({ language_code: "es" });
    expect(payload).not.toHaveProperty("language_detection");
  });

  it.each([undefined, "   "])("uses language detection for a blank or absent language (%s)", async (language) => {
    const { fetchMock } = await transcribe({ language });
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);

    expect(payload).toMatchObject({ language_detection: true });
    expect(payload).not.toHaveProperty("language_code");
  });
});

describe("AssemblyAI STT failure boundary", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { name: "apiKey-only terminal poll", credentials: { apiKey: "opaque-media-1150" }, token: "opaque-media-1150", status: 500 },
    { name: "accessToken-only terminal poll", credentials: { accessToken: "opaque-access-1150" }, token: "opaque-access-1150", status: 500 },
    { name: "safe terminal poll", credentials: { apiKey: "opaque-media-1150" }, token: "opaque-media-1150", status: 500, safe: true },
    { name: "upload 502", credentials: { apiKey: "opaque-media-1150" }, token: "opaque-media-1150", status: 502 },
  ])("protects public errors and terminates after $name", async ({ credentials, token, status, safe }) => {
    const message = safe ? "Audio could not be decoded" : `denied ${token} /home/fixture/private.ts:7`;
    const json = (value, code = 200) => new Response(JSON.stringify(value), {
      status: code, headers: { "content-type": "application/json" },
    });
    const responses = status === 502 ? [json({ error: { message } }, 502)] : [
      json({ upload_url: "https://audio.invalid/upload" }),
      json({ id: "transcript-id" }),
      json({ status: "error", error: message }),
    ];
    const fetchMock = vi.fn(async () => {
      if (!responses.length) throw new Error("Unexpected AssemblyAI fetch");
      return responses.shift();
    });
    global.fetch = fetchMock;
    const pending = handleSttCore({
      provider: "assemblyai", model: "universal-2", formData: makeFormData(),
      credentials: { ...credentials, connectionId: "account-a" },
      sttConfig: {
        baseUrl: "https://api.assemblyai.com/v2/transcript",
        authType: "apikey", authHeader: "authorization", format: "assemblyai",
      },
    });
    if (status === 500) {
      // Zero-time turns allow Blob I/O to finish without racing timer registration.
      for (let turn = 0; turn < 100 && vi.getTimerCount() === 0; turn++) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
    }
    const result = await pending;
    const wire = await result.response.text();
    const body = JSON.parse(wire);
    expect(result.success).toBe(false);
    expect(result.status).toBe(status);
    expect(result.response.status).toBe(result.status);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    expect(body.error.message).toBe(result.error);
    expect(body).not.toHaveProperty("text");
    expect(result).not.toHaveProperty("usageValue");
    expect(result).not.toHaveProperty("nativeUnits");
    if (safe) {
      expect(result.error).toBe(message);
    } else {
      // Soft secrecy assertions keep lifecycle evidence visible when redaction fails.
      for (const value of [result.error, wire]) {
        expect.soft(value).not.toContain(token);
        expect.soft(value).not.toContain("/home/fixture/private.ts:7");
        expect.soft(value).toContain("denied");
      }
    }
    const expectedCalls = [
      ["https://api.assemblyai.com/v2/upload", "POST"],
      ["https://api.assemblyai.com/v2/transcript", "POST"],
      ["https://api.assemblyai.com/v2/transcript/transcript-id", "GET"],
    ].slice(0, status === 502 ? 1 : 3);
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init.method || "GET"])).toEqual(expectedCalls);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init.headers).get("authorization")).toBe(token);
    }
    expect(responses).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(expectedCalls.length);
    expect(vi.getTimerCount()).toBe(0);
  }, 5000);
});
