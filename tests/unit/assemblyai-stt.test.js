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
