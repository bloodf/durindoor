// Vertex AI Gemini TTS/STT parity, staged. Closed mocks only: every request is
// answered below, an unexpected request fails the test, token minting is
// injected, and every credential is synthetic. Passing here says nothing about
// the live service.
//
// Source contract: OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad,
// open-sse/config/audioRegistry.ts (`vertex`), open-sse/executors/vertexMedia.ts.
import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VERTEX_STT_CONFIG,
  VERTEX_STT_MODEL_IDS,
  VERTEX_TTS_CONFIG,
  VERTEX_TTS_MODEL_IDS,
  createVertexSttTranscriber,
  createVertexTtsAdapter,
  listVertexAudioModels,
  listVertexTtsVoices,
  resolveVertexAudioAuth,
  vertexGenerateContentRequest,
} from "../../open-sse/services/providerParity/native-vertex-tts-stt/index.js";
import registration from "../../open-sse/services/providerParity/native-vertex-tts-stt/registration.json" with { type: "json" };
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const PROJECT_A = "synthetic-proj-a";
const PROJECT_B = "synthetic-proj-b";
const TOKEN_A = "ya29.SYNTHETIC-token-a-0001";
const TOKEN_B = "ya29.SYNTHETIC-token-b-0002";
const EXPRESS_KEY_A = "AQ.SYNTHETIC-express-key-a-0001";
const EXPRESS_KEY_B = "AQ.SYNTHETIC-express-key-b-0002";
const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----\n";
const sa = (project, email = `svc@${project}.iam.gserviceaccount.com`) => JSON.stringify({
  type: "service_account", project_id: project, client_email: email, private_key: PRIVATE_KEY,
});
const adc = (quota) => JSON.stringify({ type: "authorized_user", client_id: "cid.apps", client_secret: "SYNTHETIC-secret", refresh_token: "1//SYNTHETIC-refresh", ...(quota ? { quota_project_id: quota } : {}) });
const SA_A = { apiKey: sa(PROJECT_A), connectionId: "conn-a" };
const SA_B = { apiKey: sa(PROJECT_B), connectionId: "conn-b" };
const TEXT = "The forest gate opens at dawn.";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const STT_MODEL = "gemini-2.5-flash";
const regional = (project, model, location = "us-central1") =>
  `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const PCM = Buffer.alloc(480, 7);
const audioAnswer = (data = PCM.toString("base64"), mimeType = "audio/L16;codec=pcm;rate=24000", extra = {}) => json({
  candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType, data } }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 120, totalTokenCount: 129 },
  responseId: "resp-1",
  ...extra,
});
const textAnswer = (text = " the forest gate opens at dawn ", extra = {}) => json({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 8, totalTokenCount: 308 },
  ...extra,
});
const upstreamError = (status, googleStatus, extra = {}, headers = {}) => json({
  error: { code: status, status: googleStatus, message: `upstream echo ${TOKEN_A} ${EXPRESS_KEY_A} ${TEXT}`, ...extra },
}, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${TOKEN_A}`), { code }) });

const originalFetch = global.fetch;
let calls;
let mints;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

const tokens = { [PROJECT_A]: TOKEN_A, [PROJECT_B]: TOKEN_B };
const deps = (extra = {}) => ({
  mintServiceAccountToken: async (saJson) => {
    mints.push(saJson.project_id);
    return tokens[saJson.project_id];
  },
  refreshAdcToken: async (json) => {
    mints.push(`adc:${json.client_id}`);
    return TOKEN_B;
  },
  ...extra,
});
const tts = (extra) => createVertexTtsAdapter(deps(extra));
const stt = (extra) => createVertexSttTranscriber(deps(extra));
const wavFile = (bytes = Buffer.from("RIFF....WAVEfmt synthetic-audio"), name = "clip.wav", type = "audio/wav") => new File([bytes], name, { type });
function form(fields = {}, file = wavFile()) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}
const bodyOf = (call) => JSON.parse(call.init.body);
const expectNoSecrets = (result) => {
  const text = JSON.stringify(result);
  for (const secret of [TOKEN_A, TOKEN_B, EXPRESS_KEY_A, PRIVATE_KEY.trim(), TEXT]) expect(text).not.toContain(secret);
};

beforeEach(() => {
  calls = [];
  mints = [];
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("source-derived metadata", () => {
  it("matches the pinned audioRegistry vertex entries", () => {
    for (const cfg of [VERTEX_TTS_CONFIG, VERTEX_STT_CONFIG]) {
      expect(cfg.baseUrl).toBe("https://us-central1-aiplatform.googleapis.com/v1");
      expect(cfg.authType).toBe("apikey");
      expect(cfg.authHeader).toBe("bearer");
    }
    expect(VERTEX_TTS_CONFIG.format).toBe("vertex-gemini-tts");
    expect(VERTEX_STT_CONFIG.format).toBe("vertex-gemini");
    expect(VERTEX_TTS_MODEL_IDS).toEqual([
      "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts", "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts",
    ]);
    expect(VERTEX_STT_MODEL_IDS).toEqual(["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]);
    expect(listVertexAudioModels("tts").every((m) => m.kind === "tts")).toBe(true);
    expect(listVertexAudioModels("stt").map((m) => m.id)).toEqual(VERTEX_STT_MODEL_IDS);
    expect(listVertexAudioModels("image")).toEqual([]);
  });

  it("registration.json describes the same ids, formats and the existing provider", () => {
    expect(registration.provider.canonicalId).toBe("vertex");
    expect(registration.provider.aliases).toEqual(["vx"]);
    expect(registration.services.tts.models).toEqual([...VERTEX_TTS_MODEL_IDS]);
    expect(registration.services.stt.models).toEqual([...VERTEX_STT_MODEL_IDS]);
    expect(registration.services.tts.format).toBe("vertex-gemini-tts");
    expect(registration.services.stt.format).toBe("vertex-gemini");
    expect(registration.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
  });

  it("discovers the Gemini prebuilt voices, Kore included", async () => {
    const voices = (await listVertexTtsVoices()).map((v) => v.voice_id);
    expect(voices).toContain("Kore");
    expect(voices.length).toBeGreaterThanOrEqual(30);
  });
});

describe("auth and endpoint scope", () => {
  it("builds the source SA endpoint: regional host, project path, bearer", async () => {
    const auth = await resolveVertexAudioAuth(SA_A, deps());
    expect(auth).toMatchObject({ ok: true, mode: "bearer", project: PROJECT_A, location: "us-central1", token: TOKEN_A });
    expect(vertexGenerateContentRequest(auth, TTS_MODEL)).toEqual({
      url: regional(PROJECT_A, TTS_MODEL),
      origin: "https://us-central1-aiplatform.googleapis.com",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_A}` },
    });
  });

  it("builds the source Express endpoint: global, project-less, ?key=", async () => {
    const auth = await resolveVertexAudioAuth({ apiKey: EXPRESS_KEY_A }, deps());
    expect(vertexGenerateContentRequest(auth, STT_MODEL)).toEqual({
      url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${STT_MODEL}:generateContent?key=${encodeURIComponent(EXPRESS_KEY_A)}`,
      origin: "https://aiplatform.googleapis.com",
      headers: { "Content-Type": "application/json" },
    });
    expect(mints).toEqual([]);
  });

  it("keeps the stored location and maps global and multi-regions to fixed hosts", async () => {
    const at = async (location) => vertexGenerateContentRequest(await resolveVertexAudioAuth({ ...SA_A, providerSpecificData: { location } }, deps()), TTS_MODEL).url;
    expect(await at("europe-west4")).toBe(regional(PROJECT_A, TTS_MODEL, "europe-west4"));
    expect(await at("global")).toBe(`https://aiplatform.googleapis.com/v1/projects/${PROJECT_A}/locations/global/publishers/google/models/${TTS_MODEL}:generateContent`);
    expect(await at("eu")).toBe(`https://aiplatform.eu.rep.googleapis.com/v1/projects/${PROJECT_A}/locations/eu/publishers/google/models/${TTS_MODEL}:generateContent`);
  });

  it.each(["evil.example/x", "us-central1.evil.example", "US-CENTRAL1", "../us"])("refuses location %j before minting", async (location) => {
    const auth = await resolveVertexAudioAuth({ ...SA_A, providerSpecificData: { location } }, deps());
    expect(auth).toMatchObject({ ok: false, status: 400 });
    expect(mints).toEqual([]);
  });

  it("supports ADC with quota_project_id or providerSpecificData.projectId and a pre-set token", async () => {
    expect(await resolveVertexAudioAuth({ apiKey: adc(PROJECT_B) }, deps())).toMatchObject({ ok: true, project: PROJECT_B, token: TOKEN_B });
    expect(await resolveVertexAudioAuth({ apiKey: adc(), providerSpecificData: { projectId: PROJECT_A } }, deps())).toMatchObject({ ok: true, project: PROJECT_A });
    expect(await resolveVertexAudioAuth({ apiKey: adc() }, deps())).toMatchObject({ ok: false, status: 400 });
    expect(await resolveVertexAudioAuth({ accessToken: TOKEN_A, providerSpecificData: { projectId: PROJECT_A } }, deps())).toMatchObject({ ok: true, token: TOKEN_A, project: PROJECT_A });
  });

  it("refuses unusable credentials without sending anything", async () => {
    const results = await Promise.all([
      resolveVertexAudioAuth({ apiKey: JSON.stringify({ web: { client_id: "x" } }) }, deps()),
      resolveVertexAudioAuth({ apiKey: "{not json" }, deps()),
      resolveVertexAudioAuth({}, deps()),
      resolveVertexAudioAuth({ apiKey: "short" }, deps()),
      resolveVertexAudioAuth(SA_A, deps({ mintServiceAccountToken: async () => null })),
      resolveVertexAudioAuth({ apiKey: sa("UPPER_case") }, deps()),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 400]);
    expectNoSecrets(results);
  });

  it("bounds token minting by a deadline and the caller's signal", async () => {
    const never = () => new Promise(() => {});
    expect(await resolveVertexAudioAuth(SA_A, deps({ mintServiceAccountToken: never, tokenTimeoutMs: 10 }))).toMatchObject({ ok: false, status: 401, message: expect.stringContaining("timed out") });
    const controller = new AbortController();
    const pending = resolveVertexAudioAuth(SA_A, deps({ mintServiceAccountToken: never, signal: controller.signal }));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, status: 499 });
  });
});

describe("TTS adapter", () => {
  it("sends the exact source body and returns WAV with provider usage", async () => {
    serve(audioAnswer());
    const result = await tts().synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(regional(PROJECT_A, TTS_MODEL));
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_A}` });
    expect(bodyOf(calls[0])).toEqual({
      contents: [{ role: "user", parts: [{ text: TEXT }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
    });
    expect(result.format).toBe("wav");
    const wav = Buffer.from(result.base64, "base64");
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(PCM.length);
    expect(wav.subarray(44)).toEqual(PCM);
    expect(result.accounting).toEqual({
      tokens: { input_tokens: 9, output_tokens: 120, total_tokens: 129 },
      nativeUnits: {},
      meta: { providerReceipt: { usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 120, totalTokenCount: 129 }, responseId: "resp-1" } },
    });
  });

  it("uses Express ?key= without an Authorization header", async () => {
    serve(audioAnswer());
    await tts().synthesize(TEXT, TTS_MODEL, { apiKey: EXPRESS_KEY_A }, "mp3", {});
    expect(calls[0].url).toBe(`https://aiplatform.googleapis.com/v1/publishers/google/models/${TTS_MODEL}:generateContent?key=${encodeURIComponent(EXPRESS_KEY_A)}`);
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("carries style and pace in speech_metadata and the voice from model or body", async () => {
    serve(audioAnswer(), audioAnswer());
    await tts().synthesize(TEXT, `${TTS_MODEL}/puck`, SA_A, "mp3", { instructions: "Calm and low", speed: 1.5 });
    expect(bodyOf(calls[0]).contents[0].parts[0]).toEqual({ text: TEXT, speech_metadata: { style: "Calm and low. Pace: 1.5x normal speed" } });
    expect(bodyOf(calls[0]).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck");
    await tts().synthesize(TEXT, "gemini-3.8-flash-tts", SA_A, "mp3", { voice: "Charon", style: "whisper" });
    expect(calls[1].url).toBe(regional(PROJECT_A, "gemini-3.8-flash-tts"));
    expect(bodyOf(calls[1]).contents[0].parts[0].speech_metadata).toEqual({ style: "whisper" });
    expect(bodyOf(calls[1]).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Charon");
  });

  it("returns raw PCM for pcm and strips a C2PA trailer from WAV", async () => {
    const data = Buffer.alloc(64, 3);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(0, 4); header.write("WAVE", 8); header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24);
    header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(64, 40);
    const trailer = Buffer.concat([Buffer.from("C2PA"), Buffer.from([4, 0, 0, 0]), Buffer.from("meta")]);
    const wavWithTrailer = Buffer.concat([header, data, trailer]);
    serve(audioAnswer(wavWithTrailer.toString("base64"), "audio/wav"), audioAnswer(PCM.toString("base64")));
    const wav = await tts().synthesize(TEXT, TTS_MODEL, SA_A, "wav", {});
    const out = Buffer.from(wav.base64, "base64");
    expect(out.length).toBe(44 + 64);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    const pcm = await tts().synthesize(TEXT, TTS_MODEL, SA_A, "pcm", {});
    expect(pcm.format).toBe("pcm");
    expect(Buffer.from(pcm.base64, "base64")).toEqual(PCM);
  });

  it.each([
    ["an encoded container", { response_format: "mp3" }, "mp3"],
    ["opus by query", {}, "opus"],
    ["streaming", { stream_format: "sse" }, "mp3"],
    ["language", { language: "pt-BR" }, "mp3"],
    ["a speed out of range", { speed: 9 }, "mp3"],
    ["a non-string style", { instructions: { x: 1 } }, "mp3"],
    ["an unknown voice", { voice: "Gandalf" }, "mp3"],
    ["a voice conflict", { voice: "Puck" }, "mp3", `${TTS_MODEL}/Kore`],
    ["an unknown model", {}, "mp3", "gemini-2.5-flash"],
    ["empty input", {}, "mp3", TTS_MODEL, "   "],
  ])("refuses %s before submission", async (_label, options, format, model = TTS_MODEL, text = TEXT) => {
    const result = await tts().synthesize(text, model, SA_A, format, options);
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(calls).toHaveLength(0);
    expect(mints).toEqual([]);
  });

  it("keeps two credentials' identity, project and token apart", async () => {
    serve(audioAnswer(), audioAnswer(), audioAnswer(), audioAnswer());
    const adapter = tts();
    await adapter.synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    await adapter.synthesize(TEXT, TTS_MODEL, SA_B, "mp3", {});
    await adapter.synthesize(TEXT, TTS_MODEL, { apiKey: EXPRESS_KEY_A }, "mp3", {});
    await adapter.synthesize(TEXT, TTS_MODEL, { apiKey: EXPRESS_KEY_B }, "mp3", {});
    expect(calls.map((c) => c.url)).toEqual([
      regional(PROJECT_A, TTS_MODEL),
      regional(PROJECT_B, TTS_MODEL),
      expect.stringContaining(`?key=${encodeURIComponent(EXPRESS_KEY_A)}`),
      expect.stringContaining(`?key=${encodeURIComponent(EXPRESS_KEY_B)}`),
    ]);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(calls[1].init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
    expect(mints).toEqual([PROJECT_A, PROJECT_B]);
  });

  it("maps refusals to safe errors without upstream text or credentials", async () => {
    serve(
      upstreamError(429, "RESOURCE_EXHAUSTED", {}, { "retry-after": "30" }),
      upstreamError(403, "PERMISSION_DENIED", { details: [{ reason: "BILLING_DISABLED" }] }),
      upstreamError(400, "INVALID_ARGUMENT"),
      upstreamError(401, "UNAUTHENTICATED"),
      upstreamError(404, "NOT_FOUND"),
    );
    const adapter = tts();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await adapter.synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {}));
    expect(results.map((r) => r.status)).toEqual([429, 402, 400, 401, 404]);
    expect(results[0].error).toContain("RESOURCE_EXHAUSTED");
    expect(results[0].resetsAtMs).toBeGreaterThan(Date.now());
    expect(results[1].quotaExhausted).toBe(true);
    for (const result of results) expect(result.acceptedJob).toBeUndefined();
    expectNoSecrets(results);
  });

  it("records an upstream 5xx as an accepted job of unknown cost and never retries", async () => {
    serve(upstreamError(503, "UNAVAILABLE"));
    const result = await tts().synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, costStatus: "unknown", meta: { jobState: "submit-unknown" } });
    expectNoSecrets(result);
  });

  it("refuses a redirect and rejects an answer from another origin", async () => {
    const moved = new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
    const elsewhere = audioAnswer();
    Object.defineProperty(elsewhere, "url", { value: "https://evil.example/v1/x" });
    serve(moved, elsewhere);
    const redirect = await tts().synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    expect(redirect).toMatchObject({ success: false, status: 502 });
    expect(redirect.acceptedJob).toBeUndefined();
    const foreign = await tts().synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    expect(foreign.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });

  it("classifies transport failures: pre-connect is unsent, mid-flight is uncertain", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); }, () => { throw transportError("ECONNRESET"); });
    const unsent = await tts().synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    expect(unsent).toMatchObject({ success: false, status: 502 });
    expect(unsent.acceptedJob).toBeUndefined();
    const cut = await tts().synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    expect(cut.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expectNoSecrets([unsent, cut]);
  });

  it("aborts before submit without sending and mid-flight as an uncertain job", async () => {
    const early = new AbortController();
    early.abort();
    expect(await tts().synthesize(TEXT, TTS_MODEL, SA_A, "mp3", { signal: early.signal })).toMatchObject({ status: 499 });
    expect(calls).toHaveLength(0);

    const late = new AbortController();
    serve((_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const pending = tts().synthesize(TEXT, TTS_MODEL, SA_A, "mp3", { signal: late.signal });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].init.signal.aborted).toBe(false);
    late.abort();
    const result = await pending;
    expect(result).toMatchObject({ status: 499 });
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });

  it("enforces the per-call deadline even when the transport ignores its signal", async () => {
    serve(() => new Promise(() => {}));
    const result = await tts({ requestTimeoutMs: 20 }).synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });

  it.each([
    ["no audio", () => json({ candidates: [{ finishReason: "SAFETY" }], usageMetadata: { promptTokenCount: 4 } }), "completed-unusable"],
    ["an mp3 MIME type", () => audioAnswer(PCM.toString("base64"), "audio/mpeg"), "completed-unusable"],
    ["malformed base64", () => audioAnswer("!!not base64!!"), "completed-unusable"],
    ["an implausible sample rate", () => audioAnswer(PCM.toString("base64"), "audio/L16;rate=999999"), "completed-unusable"],
    ["a non-JSON 200", () => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }), "completed-unread"],
  ])("reports %s as a possibly billed, unusable answer", async (_label, answer, jobState) => {
    serve(answer());
    const result = await tts().synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob?.meta.jobState).toBe(jobState);
    expectNoSecrets(result);
  });

  it("bounds the response size", async () => {
    serve(audioAnswer(Buffer.alloc(4096, 1).toString("base64")));
    const result = await tts({ maxResponseBytes: 1024 }).synthesize(TEXT, TTS_MODEL, SA_A, "mp3", {});
    expect(result.acceptedJob?.meta.jobState).toBe("completed-unread");
  });

  it("refuses unusable credentials before sending", async () => {
    const result = await tts().synthesize(TEXT, TTS_MODEL, { apiKey: JSON.stringify({ installed: {} }) }, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(calls).toHaveLength(0);
  });
});

describe("STT transcriber", () => {
  it("sends the exact source body and returns { text } with provider usage", async () => {
    serve(textAnswer());
    const audio = Buffer.from("RIFF....WAVEfmt synthetic-audio");
    const result = await stt()({ model: STT_MODEL, formData: form({ language: "pt-BR" }, wavFile(audio)), credentials: SA_A });
    expect(calls[0].url).toBe(regional(PROJECT_A, STT_MODEL));
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_A}` });
    expect(bodyOf(calls[0])).toEqual({
      contents: [{
        role: "user",
        parts: [
          { text: "Transcribe this audio verbatim. Output only the spoken words (language: pt-BR), with no commentary." },
          { inlineData: { mimeType: "audio/wav", data: audio.toString("base64") } },
        ],
      }],
    });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "the forest gate opens at dawn" });
    expect(result.usageValue).toEqual({ usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 8, totalTokenCount: 308 } });
    expect(result.nativeUnits).toEqual({});
  });

  it("uses a caller prompt, plain text output and the MIME type from the extension", async () => {
    serve(textAnswer("hello"));
    const file = new File([Buffer.from("ID3synthetic")], "clip.mp3", { type: "" });
    const result = await stt()({ model: "gemini-2.0-flash", formData: form({ prompt: "Transcribe names carefully.", response_format: "text" }, file), credentials: { apiKey: EXPRESS_KEY_A } });
    expect(calls[0].url).toBe(`https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(EXPRESS_KEY_A)}`);
    expect(bodyOf(calls[0]).contents[0].parts[0]).toEqual({ text: "Transcribe names carefully." });
    expect(bodyOf(calls[0]).contents[0].parts[1].inlineData.mimeType).toBe("audio/mpeg");
    expect(result.response.headers.get("content-type")).toContain("text/plain");
    expect(await result.response.text()).toBe("hello");
  });

  it("returns an empty transcript for a clean stop with no parts (silence)", async () => {
    serve(json({ candidates: [{ content: { role: "model" }, finishReason: "STOP" }] }));
    const result = await stt()({ model: STT_MODEL, formData: form(), credentials: SA_A });
    expect(await result.response.json()).toEqual({ text: "" });
  });

  it.each([
    ["temperature", { temperature: "0" }],
    ["timestamps", { "timestamp_granularities[]": "word" }],
    ["verbose_json", { response_format: "verbose_json" }],
    ["prompt with language", { prompt: "x", language: "en" }],
    ["a malformed language", { language: "english please" }],
    ["an unknown model", {}, wavFile(), "whisper-1"],
    ["a non-audio file", {}, new File([Buffer.from("x")], "notes.txt", { type: "text/plain" })],
    ["an empty file", {}, wavFile(Buffer.alloc(0))],
    ["no file", {}, null],
  ])("refuses %s before submission", async (_label, fields, file = wavFile(), model = STT_MODEL) => {
    const result = await stt()({ model, formData: form(fields, file), credentials: SA_A });
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(calls).toHaveLength(0);
    expect(mints).toEqual([]);
  });

  it("refuses translations and oversized audio", async () => {
    expect(await stt()({ model: STT_MODEL, formData: form(), credentials: SA_A, kind: "translation" })).toMatchObject({ status: 400 });
    const big = wavFile(Buffer.alloc(14 * 1024 * 1024 + 1));
    expect(await stt()({ model: STT_MODEL, formData: form({}, big), credentials: SA_A })).toMatchObject({ status: 413 });
    expect(calls).toHaveLength(0);
  });

  it("keeps two credentials apart", async () => {
    serve(textAnswer("a"), textAnswer("b"));
    const transcribe = stt();
    await transcribe({ model: STT_MODEL, formData: form(), credentials: SA_A });
    await transcribe({ model: STT_MODEL, formData: form(), credentials: { ...SA_B, providerSpecificData: { location: "asia-northeast1" } } });
    expect(calls[0].url).toBe(regional(PROJECT_A, STT_MODEL));
    expect(calls[1].url).toBe(regional(PROJECT_B, STT_MODEL, "asia-northeast1"));
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${TOKEN_A}`, `Bearer ${TOKEN_B}`]);
  });

  it("maps quota and failures safely and records uncertain outcomes", async () => {
    serve(
      upstreamError(429, "RESOURCE_EXHAUSTED"),
      upstreamError(500, "INTERNAL"),
      json({ candidates: [{ finishReason: "SAFETY" }], usageMetadata: { promptTokenCount: 300 } }),
      json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: "AA==" } }] } }] }),
    );
    const transcribe = stt();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await transcribe({ model: STT_MODEL, formData: form(), credentials: SA_A }));
    expect(results.map((r) => r.status)).toEqual([429, 502, 502, 502]);
    expect(results[0].acceptedJob).toBeUndefined();
    expect(results[1].acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(results[2].acceptedJob.meta).toMatchObject({ jobState: "completed-unusable", providerUsage: { path: "usageMetadata" } });
    expect(results[2].acceptedJob.tokens.input_tokens).toBe(300);
    expect(results[2].error).toContain("SAFETY");
    expect(results[3].acceptedJob.meta.jobState).toBe("completed-unusable");
    expectNoSecrets(results);
  });

  it("aborts mid-flight as an uncertain job and before submit without sending", async () => {
    const early = new AbortController();
    early.abort();
    expect(await stt()({ model: STT_MODEL, formData: form(), credentials: SA_A, signal: early.signal })).toMatchObject({ status: 499, local: true });
    expect(calls).toHaveLength(0);
    const late = new AbortController();
    serve(() => new Promise(() => {}));
    const pending = stt()({ model: STT_MODEL, formData: form(), credentials: SA_A, signal: late.signal });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    late.abort();
    const result = await pending;
    expect(result).toMatchObject({ status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("enforces the deadline", async () => {
    serve(() => new Promise(() => {}));
    const result = await stt({ requestTimeoutMs: 20 })({ model: STT_MODEL, formData: form(), credentials: SA_A });
    expect(result).toMatchObject({ status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });
});

// Isolated staging block: these assert the CURRENT unregistered state only.
// Registration replaces them with positive registry identity assertions.
describe("staging (unregistered state)", () => {
  it("the existing vertex provider has no audio config yet and no TTS adapter is registered", async () => {
    const { default: vertex } = await import("../../open-sse/providers/registry/vertex.js");
    expect(vertex.id).toBe("vertex");
    expect(vertex.ttsConfig).toMatchObject({ format: "vertex-gemini-tts", models: VERTEX_TTS_CONFIG.models.map(({ id, name }) => ({ id, name })) });
    expect(vertex.sttConfig).toMatchObject({ format: "vertex-gemini", models: VERTEX_STT_CONFIG.models.map(({ id, name }) => ({ id, name })) });
    expect(vertex.serviceKinds).toContain("tts");
    expect(vertex.serviceKinds).toContain("stt");
    const { getTtsAdapter } = await import("../../open-sse/handlers/ttsProviders/index.js");
    expect(getTtsAdapter("vertex")).toBe((await import("../../open-sse/services/providerParity/native-vertex-tts-stt/speech.js")).default);
  });
});
