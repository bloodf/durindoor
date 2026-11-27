// Closed-network contract tests for the staged native Gemini API (AI Studio) Lyria 3 music adapter.
// Source: OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad
// open-sse/config/musicRegistry.ts (`gemini`), open-sse/handlers/musicGeneration.ts (`gemini-lyria`),
// open-sse/handlers/mediaGeneration/geminiMusic.ts, open-sse/executors/vertexMedia.ts (extractInlineAudio),
// src/lib/providerModels/geminiModelsParser.ts (Lyria => music).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import geminiMusicAdapter, {
  GEMINI_MUSIC_CONFIG,
  audioMatchesFormat,
  buildGeminiMusicAuth,
  buildGeminiMusicRequest,
  buildGeminiMusicUrl,
  discoverGeminiMusicModels,
  geminiMusicDiscoveryUrl,
  geminiMusicFormat,
  handleGeminiMusicGeneration,
  isGeminiMusicModel,
  isGeminiMusicProvider,
  listGeminiMusicModels,
  parseGeminiMusicModels,
} from "../../open-sse/services/providerParity/native-google-music/index.js";

const STAGING_DIR = new URL("../../open-sse/services/providerParity/native-google-music/", import.meta.url);
const GENERATE = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(64)]).toString("base64");
function wav(seconds = 1, byteRate = 192000) {
  const dataSize = Math.round(seconds * byteRate);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(48000, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf.toString("base64");
}

const keyCreds = (key = "AIza-key-alpha", connectionId = "conn-a") => ({ apiKey: key, connectionId, providerSpecificData: {} });
const oauthCreds = (token = "ya29.oauth-token", connectionId = "conn-o") => ({ accessToken: token, connectionId, providerSpecificData: {} });

const lyriaReply = (data = MP3, mimeType = "audio/mpeg", extra = {}) => ({
  candidates: [{ content: { role: "model", parts: [{ text: "<instrumental>" }, { text: "[[A0]]" }, { inlineData: { mimeType, data } }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 1024, totalTokenCount: 1031 },
  ...extra,
});

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function harness(responder) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init, proxyOptions) => {
    calls.push({ url, init, proxyOptions });
    return responder(calls.length - 1, { url, init });
  });
  return { calls, deps: { fetchImpl } };
}

const bodyOf = async (result) => JSON.parse(await result.response.text());

describe("native-google-music: source-derived wire contract", () => {
  it("exposes the pinned registry entry verbatim", () => {
    expect(GEMINI_MUSIC_CONFIG).toMatchObject({
      id: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      authType: "apikey",
      authHeader: "x-goog-api-key",
      format: "gemini-lyria",
    });
    expect(GEMINI_MUSIC_CONFIG.models.map((m) => [m.id, m.name])).toEqual([
      ["lyria-3-pro-preview", "Lyria 3 Pro (preview)"],
      ["lyria-3-clip-preview", "Lyria 3 Clip (preview)"],
      ["lyria-3.5", "Lyria 3.5"],
    ]);
    expect(listGeminiMusicModels().every((m) => m.provider === "gemini" && m.serviceKinds[0] === "music")).toBe(true);
  });

  it("matches only the source registry key; other Google providers are not this contract", () => {
    expect(isGeminiMusicProvider("gemini")).toBe(true);
    for (const other of ["vertex", "vx", "gemini-cli", "gemini-web", "gemini-interactions", "google", "GEMINI"]) {
      expect(isGeminiMusicProvider(other)).toBe(false);
    }
  });

  it("API key: exact URL, headers, body and manual redirect; text parts are dropped", async () => {
    const { calls, deps } = harness(() => jsonResponse(lyriaReply()));
    const result = await handleGeminiMusicGeneration({
      model: "lyria-3-pro-preview",
      body: { model: "gemini/lyria-3-pro-preview", prompt: "  calm lo-fi piano  ", response_format: "b64_json" },
      credentials: keyCreds(), now: () => 1_700_000_000_000, ...deps,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GENERATE("lyria-3-pro-preview"));
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", "x-goog-api-key": "AIza-key-alpha" });
    // Source: no generationConfig; prompt trimmed; single user text part.
    expect(JSON.parse(calls[0].init.body)).toEqual({ contents: [{ role: "user", parts: [{ text: "calm lo-fi piano" }] }] });
    expect(result.success).toBe(true);
    expect(result.connectionId).toBe("conn-a");
    expect(await bodyOf(result)).toEqual({
      object: "music.generation", created: 1_700_000_000, provider: "gemini", model: "lyria-3-pro-preview", status: "completed",
      data: [{ b64_json: MP3, format: "mp3", mime_type: "audio/mpeg" }],
    });
  });

  it("OAuth access token uses Bearer; an API key wins when both are present", () => {
    expect(buildGeminiMusicAuth(oauthCreds()).headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer ya29.oauth-token" });
    expect(buildGeminiMusicAuth({ apiKey: "k1", accessToken: "t1" })).toEqual({ mode: "api_key", headers: { "Content-Type": "application/json", "x-goog-api-key": "k1" } });
    expect(buildGeminiMusicAuth({ apiKey: "  ", accessToken: "" })).toBeNull();
  });

  it("two credentials stay isolated: each call carries only its own connection identity", async () => {
    const { calls, deps } = harness(() => jsonResponse(lyriaReply()));
    const a = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "a" }, credentials: keyCreds("key-A", "conn-A"), ...deps });
    const b = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "b" }, credentials: oauthCreds("tok-B", "conn-B"), ...deps });
    expect([a.connectionId, b.connectionId]).toEqual(["conn-A", "conn-B"]);
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", "x-goog-api-key": "key-A" });
    expect(calls[1].init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer tok-B" });
    expect(JSON.stringify(calls[1].init)).not.toMatch(/key-A/);
  });

  it("maps source mime types and normalizes WAV with a measured duration", async () => {
    expect(geminiMusicFormat("audio/mpeg")).toBe("mp3");
    expect(geminiMusicFormat("Audio/WAV; codecs=1")).toBe("wav");
    expect(geminiMusicFormat("audio/L16;rate=24000")).toBeNull();
    expect(geminiMusicFormat(undefined)).toBeNull();
    const { deps } = harness(() => jsonResponse(lyriaReply(wav(2), "audio/wav")));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3-clip-preview", body: { prompt: "x" }, credentials: keyCreds(), ...deps });
    const body = await bodyOf(result);
    expect(body.data[0]).toMatchObject({ format: "wav", mime_type: "audio/wav", duration_seconds: 2 });
    expect(result.accounting.nativeUnits.audioSeconds).toBe(2);
  });

  it("container signatures are checked per format", () => {
    expect(audioMatchesFormat(Buffer.from(MP3, "base64"), "mp3")).toBe(true);
    expect(audioMatchesFormat(Buffer.from("OggS\0\0\0\0"), "ogg")).toBe(true);
    expect(audioMatchesFormat(Buffer.from("fLaC\0\0\0\0"), "flac")).toBe(true);
    expect(audioMatchesFormat(Buffer.from([0xff, 0xf1, 0x50, 0x80]), "aac")).toBe(true);
    expect(audioMatchesFormat(Buffer.from([0xff, 0xf1, 0x50, 0x80]), "mp3")).toBe(false);
    expect(audioMatchesFormat(Buffer.from("\0\0\0\x20ftypM4A "), "m4a")).toBe(true);
    expect(audioMatchesFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), "webm")).toBe(true);
    expect(audioMatchesFormat(Buffer.from("<html>"), "mp3")).toBe(false);
  });
});

describe("native-google-music: input rejection before any billable submit", () => {
  it.each([
    ["unknown model", "lyria-9-unknown", { prompt: "x" }, /Unsupported Gemini music model/],
    ["Vertex-only Lyria 2", "lyria-002", { prompt: "x" }, /Unsupported Gemini music model/],
    ["chat model", "gemini-2.5-flash", { prompt: "x" }, /Unsupported Gemini music model/],
    ["path injection", "lyria-3.5/../x", { prompt: "x" }, /Unsupported Gemini music model/],
    ["empty model", "", { prompt: "x" }, /Unsupported Gemini music model/],
    ["missing prompt", "lyria-3.5", {}, /prompt/],
    ["blank prompt", "lyria-3.5", { prompt: "   " }, /prompt/],
    ["non-string prompt", "lyria-3.5", { prompt: 7 }, /prompt/],
    ["negative_prompt is not in the contract", "lyria-3.5", { prompt: "x", negative_prompt: "drums" }, /negative_prompt/],
    ["lyrics field", "lyria-3.5", { prompt: "x", lyrics: "la" }, /lyrics/],
    ["duration", "lyria-3.5", { prompt: "x", duration: 30 }, /duration/],
    ["streaming", "lyria-3.5", { prompt: "x", stream: true }, /streaming/],
    ["url output", "lyria-3.5", { prompt: "x", response_format: "url" }, /b64_json/],
    ["oversized prompt", "lyria-3.5", { prompt: "a".repeat(32_001) }, /at most/],
  ])("%s", async (_label, model, body, pattern) => {
    const { calls, deps } = harness(() => jsonResponse(lyriaReply()));
    const result = await handleGeminiMusicGeneration({ model, body, credentials: keyCreds(), ...deps });
    expect(result.status).toBe(400);
    expect(result.outcome).toBe("rejected");
    expect(result.error).toMatch(pattern);
    expect(calls).toHaveLength(0);
  });

  it("missing credentials is 401 and nothing is sent", async () => {
    const { calls, deps } = harness(() => jsonResponse(lyriaReply()));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: { connectionId: "c" }, ...deps });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("an already-aborted caller is 499 and nothing is sent", async () => {
    const { calls, deps } = harness(() => jsonResponse(lyriaReply()));
    const controller = new AbortController();
    controller.abort();
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), signal: controller.signal, ...deps });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("ids discovered for the connection are accepted; unsafe discovered ids are not", async () => {
    expect(isGeminiMusicModel("lyria-4-preview")).toBe(false);
    expect(isGeminiMusicModel("lyria-4-preview", [{ id: "lyria-4-preview" }])).toBe(true);
    expect(isGeminiMusicModel("lyria-4/x", ["lyria-4/x"])).toBe(false);
    const { calls, deps } = harness(() => jsonResponse(lyriaReply()));
    const result = await handleGeminiMusicGeneration({ model: "lyria-4-preview", models: ["lyria-4-preview"], body: { prompt: "x" }, credentials: keyCreds(), ...deps });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(GENERATE("lyria-4-preview"));
    expect(buildGeminiMusicRequest("lyria-3.5", { prompt: "x", user: "u1", stream: false }).payload).toEqual({ contents: [{ role: "user", parts: [{ text: "x" }] }] });
    expect(buildGeminiMusicUrl("lyria-3.5")).toBe(GENERATE("lyria-3.5"));
  });
});

describe("native-google-music: usage accounting", () => {
  it("reports Gemini usageMetadata tokens with unknown cost", async () => {
    const { deps } = harness(() => jsonResponse(lyriaReply()));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), ...deps });
    expect(result.accounting).toMatchObject({
      state: "complete", modality: "music", cost: null, costStatus: "unknown",
      tokens: { input_tokens: 7, output_tokens: 1024, total_tokens: 1031 },
      meta: { clips: 1, providerUsage: { path: "usageMetadata" } },
    });
    // MP3 duration is not guessed.
    expect(result.accounting.nativeUnits.audioSeconds).toBeUndefined();
  });
});

describe("native-google-music: upstream failures, quota and secrecy", () => {
  it("429 keeps quota status and Retry-After reset; body is not echoed; no accepted job", async () => {
    const { deps } = harness(() => jsonResponse({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded secret-detail AIza-key-alpha" } }, 429, { "Retry-After": "45" }));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), now: () => 1_000_000, ...deps });
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBe(1_045_000);
    expect(result.error).toBe("Gemini Lyria refused the request (HTTP 429 RESOURCE_EXHAUSTED)");
    expect(await result.response.text()).not.toMatch(/secret-detail|AIza-key-alpha/);
    expect(result.acceptedJob).toBeUndefined();
    expect(result.outcome).toBe("refused");
  });

  it("400/401/403/404/503 are refusals; unknown 4xx collapse to 502", async () => {
    for (const [status, expected] of [[400, 400], [401, 401], [403, 403], [404, 404], [503, 503], [409, 502]]) {
      const { deps } = harness(() => jsonResponse({ error: { status: "SOME_STATUS", message: "leak" } }, status));
      const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), ...deps });
      expect(result.status).toBe(expected);
      expect(result.acceptedJob).toBeUndefined();
      expect(result.error).not.toMatch(/leak/);
    }
  });

  it("500 is an uncertain submit with an unknown-cost accepted job and is not replayed", async () => {
    const { calls, deps } = harness(() => new Response("<html>internal trace</html>", { status: 500 }));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), ...deps });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.outcome).toBe("outcome_unknown");
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", cost: null, modality: "music", meta: { jobState: "submit_outcome_unknown", httpStatus: 500 } });
    expect(result.error).not.toMatch(/internal trace/);
  });

  it("network failure after dispatch is uncertain, never resubmitted, and never leaks the key", async () => {
    const { calls, deps } = harness(() => { throw new TypeError("socket hang up for AIza-secret-key"); });
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds("AIza-secret-key"), ...deps });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("submit_outcome_unknown");
    expect(result.error).not.toMatch(/AIza-secret-key/);
    expect(await result.response.text()).not.toMatch(/AIza-secret-key/);
  });

  it("redirects are refused without following", async () => {
    const { calls, deps } = harness(() => new Response(null, { status: 302, headers: { Location: "https://evil.example.com/" } }));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), ...deps });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.outcome).toBe("refused");
    expect(result.error).toMatch(/redirect was not followed/);
  });
});

describe("native-google-music: malformed and unsafe 2xx outputs stay accepted jobs", () => {
  const textOnly = { candidates: [{ content: { parts: [{ text: "<instrumental>" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3 } };
  it.each([
    ["no audio part", textOnly, /no audio content/],
    ["missing mimeType (source would default to L16 and call it mp3)", { candidates: [{ content: { parts: [{ inlineData: { data: MP3 } }] } }] }, /unsupported mime type/],
    ["raw PCM mime", lyriaReply(MP3, "audio/L16;rate=24000"), /unsupported mime type/],
    ["non-audio mime", lyriaReply(MP3, "text/html"), /unsupported mime type/],
    ["invalid base64", lyriaReply("@@not-base64@@"), /invalid base64/],
    ["HTML disguised as mp3", lyriaReply(Buffer.from("<html><script>x</script></html>").toString("base64")), /not a mp3 container/],
    ["WAV header without data", lyriaReply(Buffer.from("RIFF\0\0\0\0WAVE").toString("base64"), "audio/wav"), /not a wav container/],
  ])("%s", async (_label, reply, pattern) => {
    const { calls, deps } = harness(() => jsonResponse(reply));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), ...deps });
    expect(calls).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.outcome).toBe("accepted_malformed");
    expect(result.error).toMatch(pattern);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "accepted_malformed", httpStatus: 200 } });
  });

  it("a safety block is a 400 accepted job carrying only the enum and the reported tokens", async () => {
    const { deps } = harness(() => jsonResponse({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, usageMetadata: { promptTokenCount: 4, totalTokenCount: 4 } }));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), ...deps });
    expect(result.status).toBe(400);
    expect(result.outcome).toBe("accepted_blocked");
    expect(result.error).toBe("Gemini Lyria blocked the prompt (PROHIBITED_CONTENT)");
    expect(result.acceptedJob).toMatchObject({ tokens: { input_tokens: 4 }, meta: { jobState: "accepted_blocked", blockReason: "PROHIBITED_CONTENT" } });
  });

  it("a non-JSON 2xx is accepted_unreadable", async () => {
    const { deps } = harness(() => new Response("not json", { status: 200 }));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), ...deps });
    expect(result.status).toBe(502);
    expect(result.outcome).toBe("accepted_unreadable");
    expect(result.acceptedJob.meta.jobState).toBe("accepted_unreadable");
  });
});

describe("native-google-music: cancellation and deadlines", () => {
  it("caller abort during submit aborts the socket signal and is 499 + accepted job, not replayed", async () => {
    const controller = new AbortController();
    let seenSignal;
    const fetchImpl = vi.fn((url, init) => {
      seenSignal = init.signal;
      return new Promise(() => {});
    });
    const pending = handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), signal: controller.signal, fetchImpl });
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    const result = await pending;
    expect(seenSignal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(499);
    expect(result.outcome).toBe("outcome_unknown");
    expect(result.acceptedJob.meta.jobState).toBe("submit_outcome_unknown");
  });

  it("total deadline bounds a hung submit with 504", async () => {
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), totalTimeoutMs: 30, fetchImpl });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit_outcome_unknown");
  });

  it("total deadline bounds a stalled 2xx body read", async () => {
    const stalled = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{\"candidates\":")); } });
    const fetchImpl = vi.fn(async () => new Response(stalled, { status: 200 }));
    const result = await handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "x" }, credentials: keyCreds(), totalTimeoutMs: 30, fetchImpl });
    expect(result.status).toBe(504);
    expect(result.outcome).toBe("accepted_unreadable");
  });
});

describe("native-google-music: dynamic discovery (models.list)", () => {
  const page = (models, nextPageToken) => jsonResponse({ models, ...(nextPageToken ? { nextPageToken } : {}) });

  it("parses only lyria-* models that advertise generateContent (source parser rule)", () => {
    expect(parseGeminiMusicModels({
      models: [
        { name: "models/lyria-3-pro-preview", displayName: "Lyria 3 Pro", supportedGenerationMethods: ["generateContent", "countTokens"] },
        { name: "models/lyria-realtime-exp", supportedGenerationMethods: ["bidiGenerateContent"] },
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/Lyria-Upper", supportedGenerationMethods: ["generateContent"] },
        { name: "models/lyria-x/../y", supportedGenerationMethods: ["generateContent"] },
        "garbage",
      ],
    })).toEqual([{ id: "lyria-3-pro-preview", name: "Lyria 3 Pro", provider: "gemini", serviceKinds: ["music"], endpoints: ["music"] }]);
  });

  it("pages with the key in a header (never the URL), manual redirects, and stops on the last page", async () => {
    const { calls, deps } = harness((i) => i === 0 ?
      page([{ name: "models/lyria-3.5", supportedGenerationMethods: ["generateContent"] }], "tok-2") :
      page([{ name: "models/lyria-4-preview", displayName: "Lyria 4", supportedGenerationMethods: ["generateContent"] }]));
    const models = await discoverGeminiMusicModels({ credentials: keyCreds("disc-key"), ...deps });
    expect(models.map((m) => m.id)).toEqual(["lyria-3.5", "lyria-4-preview"]);
    expect(calls.map((c) => c.url)).toEqual([geminiMusicDiscoveryUrl(), geminiMusicDiscoveryUrl("tok-2")]);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
    expect(calls[0].url).not.toMatch(/disc-key/);
    expect(calls[0].init).toMatchObject({ method: "GET", redirect: "manual", headers: { "x-goog-api-key": "disc-key", Accept: "application/json" } });
  });

  it("OAuth discovery uses Bearer", async () => {
    const { calls, deps } = harness(() => page([]));
    await discoverGeminiMusicModels({ credentials: oauthCreds("tok-Z"), ...deps });
    expect(calls[0].init.headers).toEqual({ Authorization: "Bearer tok-Z", Accept: "application/json" });
  });

  it("errors carry status and Google enum only; redirects and bad tokens are refused", async () => {
    let h = harness(() => jsonResponse({ error: { status: "PERMISSION_DENIED", message: "leak disc-key" } }, 403));
    await expect(discoverGeminiMusicModels({ credentials: keyCreds("disc-key"), ...h.deps })).rejects.toMatchObject({ status: 403, message: "Gemini model discovery failed (HTTP 403 PERMISSION_DENIED)" });
    h = harness(() => new Response(null, { status: 301, headers: { Location: "https://evil.example.com" } }));
    await expect(discoverGeminiMusicModels({ credentials: keyCreds(), ...h.deps })).rejects.toMatchObject({ status: 502 });
    h = harness(() => page([], "bad token with spaces"));
    await expect(discoverGeminiMusicModels({ credentials: keyCreds(), ...h.deps })).rejects.toMatchObject({ status: 502 });
    h = harness(() => jsonResponse({ models: "nope" }));
    await expect(discoverGeminiMusicModels({ credentials: keyCreds(), ...h.deps })).rejects.toMatchObject({ status: 502 });
    await expect(discoverGeminiMusicModels({ credentials: {}, ...h.deps })).rejects.toMatchObject({ status: 401 });
  });

  it("discovery is bounded by its deadline and by caller abort", async () => {
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    await expect(discoverGeminiMusicModels({ credentials: keyCreds(), fetchImpl, timeoutMs: 20 })).rejects.toMatchObject({ status: 504 });
    const controller = new AbortController();
    const pending = discoverGeminiMusicModels({ credentials: keyCreds(), fetchImpl, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 499 });
  });
});

// ── Staging block: unregistered state. Registration promotes ONLY this block. ──
describe("native-google-music: staging (unregistered) state", () => {
  const registration = JSON.parse(readFileSync(fileURLToPath(new URL("registration.json", STAGING_DIR)), "utf8"));

  it("registration.json describes the staged exports and identity", async () => {
    expect(registration).toMatchObject({
      status: "staged-unregistered",
      provider: "gemini",
      aliases: [],
      serviceKinds: ["music"],
      models: [{ id: "lyria-3-pro-preview" }, { id: "lyria-3-clip-preview" }, { id: "lyria-3.5" }],
      source: { commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad", registryEntry: { id: "gemini", format: "gemini-lyria" } },
    });
    const mod = await import("../../open-sse/services/providerParity/native-google-music/index.js");
    for (const name of registration.exports) expect(mod[name], name).toBeDefined();
    expect(geminiMusicAdapter.generate).toBe(handleGeminiMusicGeneration);
  });

  it("is not wired into the live music core or the gemini registry yet", async () => {
    const core = readFileSync(fileURLToPath(new URL("../../open-sse/handlers/musicGenerationCore.js", import.meta.url)), "utf8");
    expect(core).not.toMatch(/native-google-music/);
    const gemini = (await import("../../open-sse/providers/registry/gemini.js")).default;
    expect(gemini.serviceKinds).not.toContain("music");
    expect(gemini.models.some((m) => m.id.startsWith("lyria-"))).toBe(false);
  });
});
