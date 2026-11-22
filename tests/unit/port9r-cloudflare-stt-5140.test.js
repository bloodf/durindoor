// Port of decolua/9router #5140: Cloudflare Workers AI Nova-3 transcription.
// Synthetic fixtures only: no real account, token or audio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

const CFG = AI_PROVIDERS["cloudflare-ai"]?.sttConfig;
const MODEL = "@cf/deepgram/nova-3";
const CRED = { apiKey: "cf-token-TEST", providerSpecificData: { accountId: "acct-TEST" } };

// Speakers: 0 0 0 1 1 0
const WORDS = [
  { word: "hello", punctuated_word: "Hello", start: 0, end: 0.4, speaker: 0 },
  { word: "there", punctuated_word: "there,", start: 0.4, end: 0.8, speaker: 0 },
  { word: "how", punctuated_word: "how", start: 0.8, end: 1, speaker: 0 },
  { word: "fine", punctuated_word: "Fine", start: 1.2, end: 1.6, speaker: 1 },
  { word: "thanks", punctuated_word: "thanks.", start: 1.6, end: 2, speaker: 1 },
  { word: "great", punctuated_word: "Great.", start: 2.2, end: 2.6, speaker: 0 },
];
const OK = {
  success: true, errors: [], messages: [],
  result: { usage: { neurons: 123.4 }, results: { channels: [{ alternatives: [{ transcript: "Hello there, how Fine thanks. Great.", words: WORDS }] }] } },
};

const run = async (fields = {}, upstream = OK, status = 200, credentials = CRED) => {
  const formData = new FormData();
  formData.set("file", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }), "a.webm");
  for (const [key, value] of Object.entries(fields)) for (const item of [value].flat()) formData.append(key, item);
  fetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status, headers: { "content-type": "application/json" } }));
  return handleSttCore({ provider: "cloudflare-ai", model: MODEL, formData, credentials, sttConfig: CFG });
};
const sent = () => ({ url: new URL(String(fetch.mock.calls[0][0])), init: fetch.mock.calls[0][1] });

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("cloudflare-ai STT registry (#5140)", () => {
  it("registers Nova-3 as an stt model with the cloudflare-workers-ai format", () => {
    expect(CFG).toMatchObject({ format: "cloudflare-workers-ai", authHeader: "bearer", authType: "apikey" });
    expect(AI_PROVIDERS["cloudflare-ai"].serviceKinds).toContain("stt");
  });
});

describe("cloudflare-ai STT transport (#5140)", () => {
  it("posts raw audio to {base}/{model} with bearer auth and the file's content type", async () => {
    const result = await run();
    expect(result.success).toBe(true);
    const { url, init } = sent();
    expect(url.origin + url.pathname).toBe("https://api.cloudflare.com/client/v4/accounts/acct-TEST/ai/run/@cf/deepgram/nova-3");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer cf-token-TEST");
    expect(init.headers["Content-Type"]).toBe("audio/webm");
    expect(init.body.byteLength).toBe(4);
    expect(await result.response.json()).toEqual({ text: "Hello there, how Fine thanks. Great." });
  });

  it("URL-encodes the account id so it cannot rewrite the path", async () => {
    await run({}, OK, 200, { ...CRED, providerSpecificData: { accountId: "a/../b?x=1" } });
    expect(sent().url.pathname).toBe("/client/v4/accounts/a%2F..%2Fb%3Fx%3D1/ai/run/@cf/deepgram/nova-3");
  });

  it("fails fast without an account id and never calls upstream", async () => {
    const result = await run({}, OK, 200, { apiKey: "cf-token-TEST" });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards diarize and language only when asked", async () => {
    await run({ diarize: "true", response_format: "verbose_json", language: "en" });
    expect(Object.fromEntries(sent().url.searchParams)).toEqual({ punctuate: "true", language: "en", diarize: "true" });
    fetch.mockClear();
    await run();
    expect(Object.fromEntries(sent().url.searchParams)).toEqual({ punctuate: "true" });
  });
});

describe("cloudflare-ai STT responses (#5140)", () => {
  it("verbose_json: one segment per speaker run, speakers and word timing", async () => {
    const result = await run({ diarize: "true", response_format: "verbose_json", "timestamp_granularities[]": ["segment", "word"] });
    const body = await result.response.json();
    expect(body.text).toBe("Hello there, how Fine thanks. Great.");
    expect(body.segments.map((s) => [s.speaker, s.text])).toEqual([
      [0, "Hello there, how"], [1, "Fine thanks."], [0, "Great."],
    ]);
    expect(body.speakers).toEqual([0, 1]);
    expect(body.words).toHaveLength(6);
    expect(body.words[1]).toMatchObject({ word: "there", start: 0.4, end: 0.8, speaker: 0 });
    expect(body.duration).toBe(2.6);
  });

  it("success:false envelope with HTTP 200 becomes a gateway error", async () => {
    const result = await run({}, { success: false, errors: [{ code: 7003, message: "No route for that URI" }], result: null });
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("No route for that URI");
    expect(result.error).toContain("7003");
  });

  it("non-2xx upstream passes its status through", async () => {
    const result = await run({}, { errors: [{ message: "bad token" }] }, 401);
    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });
});
