// Grok CLI (Grok Build OAuth) native speech and transcription adapters,
// staged and unregistered (#2034). Closed mocks only: every request goes to an
// injected transport, an unexpected request fails the test, and every token is
// synthetic. Wire shapes follow OmniRoute c71f0065 (grokMedia.ts
// handleGrokSpeech / handleGrokTranscription / grokMediaHeaders,
// audioRegistry.ts `grok-cli` rows, grok-oauth-media.test.ts). Passing here
// says nothing about the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-grok-cli-tts-stt/index.js";
import {
  GROK_CLI_STT_CONFIG,
  GROK_CLI_TTS_CONFIG,
  GROK_STT_MODELS,
  GROK_TTS_MODELS,
  buildGrokSpeechRequest,
  createGrokCliSttAdapter,
  createGrokCliTtsAdapter,
  grokCliSttAdapter,
  grokCliTtsAdapter,
  grokOAuthToken,
  grokUploadFileName,
} from "../../open-sse/services/providerParity/native-grok-cli-tts-stt/index.js";
import { GROK_CLI_SHELL_USER_AGENT, GROK_CLI_VERSION } from "../../open-sse/config/grokCli.js";
import { supportsSttTranslation } from "../../open-sse/handlers/sttCore.js";
import grokCliRegistry from "../../open-sse/providers/registry/grok-cli.js";
import xaiRegistry from "../../open-sse/providers/registry/xai.js";
import { getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";
import { resolveCredentialProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const TTS_URL = "https://api.x.ai/v1/tts";
const STT_URL = "https://api.x.ai/v1/stt";
const TOKEN_A = "oauth-SYNTHETIC-access-a-0001";
const TOKEN_B = "oauth-SYNTHETIC-access-b-0002";
const REFRESH_A = "oauth-SYNTHETIC-refresh-a-0001";
const API_KEY = "xai-SYNTHETIC-apikey-0003";
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const CRED_A = { accessToken: TOKEN_A, refreshToken: REFRESH_A, expiresAt: future(), connectionId: "conn-a" };
const CRED_B = { accessToken: TOKEN_B, expiresAt: future(), connectionId: "conn-b" };
const MP3 = Buffer.concat([Buffer.from("ID3\u0004\u0000"), Buffer.alloc(32, 7)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(32, 1)]);
const STT_MODEL = "grok-voice-transcribe-2.0";
const REGISTRATION = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-grok-cli-tts-stt/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const audio = (bytes, type = "audio/mpeg") => new Response(bytes, { status: 200, headers: { "content-type": type } });
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo Bearer ${TOKEN_A} at /srv/app/index.js:44` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${TOKEN_A}`), { code }) });
const hang = () => new Promise(() => {});
const stalledBody = (type = "application/json") =>
  new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{\"text\":")); } }), { status: 200, headers: { "content-type": type } });

function transport(...steps) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init, proxyOptions) => {
    calls.push({ url: String(url), init, proxyOptions });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    const value = isFunction(step) ? await step(url, init) : step;
    if (value instanceof Error) throw value;
    return value;
  });
  return { fetchImpl, calls };
}

const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  for (const secret of [TOKEN_A, TOKEN_B, REFRESH_A, API_KEY]) expect(text).not.toContain(secret);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};

const expectGrokHeaders = (headers, token) => {
  expect(headers).toMatchObject({
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-identifier": "grok-shell",
    "x-grok-client-mode": "headless",
    "User-Agent": GROK_CLI_SHELL_USER_AGENT,
    "X-XAI-Token-Auth": "xai-grok-cli",
    Authorization: `Bearer ${token}`,
  });
};

const speak = (adapter, extra = {}, credentials = CRED_A, text = "hello") =>
  adapter.synthesize(text, "grok-tts", credentials, "mp3", extra);

function form(entries, file = new File([Buffer.from("audio bytes")], "note.opus", { type: "audio/ogg" })) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
}
const transcribe = (adapter, extra = {}) => adapter.transcribe({ model: STT_MODEL, formData: form([]), credentials: CRED_A, ...extra });
const multipartOf = (call) => new Response(call.init.body).formData();

// ── Staging block: the only assertions about registration state ──────────
describe("Grok CLI tts/stt staging state (promote at registration)", () => {
  it("is not registered: grok-cli has no voice kinds, configs or adapter", () => {
    expect(grokCliRegistry.serviceKinds ?? []).not.toContain("tts");
    expect(grokCliRegistry.serviceKinds ?? []).not.toContain("stt");
    expect(grokCliRegistry.ttsConfig).toBeUndefined();
    expect(grokCliRegistry.sttConfig).toBeUndefined();
    expect(getTtsAdapter("grok-cli")).toBeFalsy();
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("Grok CLI voice staged metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toEqual({ id: "grok-cli", baseUrl: TTS_URL, authType: "oauth", authHeader: "bearer", format: "grok-tts", models: ["grok-tts"] });
    expect(REGISTRATION.source.registryFields.stt).toEqual({ id: "grok-cli", baseUrl: STT_URL, authType: "oauth", authHeader: "bearer", format: "grok-stt", models: [STT_MODEL] });
    expect(GROK_TTS_MODELS.map((m) => [m.id, m.kind])).toEqual([["grok-tts", "tts"]]);
    expect(GROK_STT_MODELS.map((m) => [m.id, m.kind])).toEqual([[STT_MODEL, "stt"]]);
    expect(GROK_CLI_TTS_CONFIG).toMatchObject({ baseUrl: TTS_URL, authType: "oauth", authHeader: "bearer", format: "grok-tts" });
    expect(GROK_CLI_STT_CONFIG).toMatchObject({ baseUrl: STT_URL, authType: "oauth", authHeader: "bearer", format: "grok-stt" });
    expect(supportsSttTranslation(GROK_CLI_STT_CONFIG, STT_MODEL)).toBe(false);
  });

  it("targets the existing grok-cli identity and aliases, OAuth only", () => {
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: grokCliRegistry.id, authModes: ["oauth"] });
    expect(REGISTRATION.provider.aliases).toEqual([grokCliRegistry.alias, ...grokCliRegistry.aliases]);
    expect(grokCliRegistry.authModes).toEqual(["oauth"]);
  });

  it("is distinct from the xai API-key voice configs on the same endpoints", () => {
    expect(xaiRegistry.ttsConfig).toMatchObject({ baseUrl: TTS_URL, authType: "apikey", format: "xai-tts" });
    expect(xaiRegistry.sttConfig).toMatchObject({ baseUrl: STT_URL, authType: "apikey", format: "xai-stt" });
    expect(GROK_CLI_TTS_CONFIG.authType).not.toBe(xaiRegistry.ttsConfig.authType);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(grokCliTtsAdapter.provider).toBe("grok-cli");
    expect(grokCliSttAdapter.provider).toBe("grok-cli");
  });
});

describe("Grok CLI OAuth credential selection", () => {
  it("uses only the OAuth access token and refuses API keys and expired tokens unsent", async () => {
    expect(grokOAuthToken(CRED_A)).toEqual({ token: TOKEN_A });
    expect(grokOAuthToken({ apiKey: API_KEY }).failure.status).toBe(401);
    expect(grokOAuthToken({ accessToken: "a\r\nb" }).failure.status).toBe(401);
    expect(grokOAuthToken({ accessToken: TOKEN_A, expiresAt: new Date(Date.now() - 1000).toISOString() }).failure.status).toBe(401);
    expect(grokOAuthToken({ accessToken: TOKEN_A, expiresAt: "not a date" }).failure.status).toBe(401);
    expect(grokOAuthToken({ accessToken: TOKEN_A })).toEqual({ token: TOKEN_A });

    const { fetchImpl } = transport();
    const tts = createGrokCliTtsAdapter({ fetchImpl });
    const stt = createGrokCliSttAdapter({ fetchImpl });
    for (const credentials of [{ apiKey: API_KEY }, { accessToken: TOKEN_A, expiresAt: new Date(Date.now() - 1).toISOString() }]) {
      const a = await speak(tts, {}, credentials);
      const b = await transcribe(stt, { credentials });
      expect(a).toMatchObject({ success: false, status: 401 });
      expect(b).toMatchObject({ success: false, status: 401 });
      expectNoLeak([a, b]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends each connection's own token and proxy options", async () => {
    const { fetchImpl, calls } = transport(audio(MP3), audio(MP3));
    const adapter = createGrokCliTtsAdapter({ fetchImpl });
    expect((await speak(adapter, {}, CRED_A)).base64).toBeDefined();
    expect((await speak(adapter, {}, CRED_B)).base64).toBeDefined();
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(calls[1].init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
    expect(calls[0].proxyOptions).toEqual(resolveCredentialProxyOptions(CRED_A));
    expect(calls[1].proxyOptions).toEqual(resolveCredentialProxyOptions(CRED_B));
  });
});

describe("Grok CLI speech wire contract (source handleGrokSpeech)", () => {
  it("maps OpenAI input to the native body with the Grok Build headers", async () => {
    const { fetchImpl, calls } = transport(audio(WAV, "audio/wav"));
    const result = await speak(createGrokCliTtsAdapter({ fetchImpl }), { voice: "eve", language: "pt-BR", response_format: "wav", speed: 0.9 }, CRED_A, "olá");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TTS_URL);
    expect(calls[0].init).toMatchObject({ method: "POST", redirect: "manual" });
    expectGrokHeaders(calls[0].init.headers, TOKEN_A);
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual({ text: "olá", voice_id: "eve", language: "pt-BR", output_format: { codec: "wav" }, speed: 0.9 });
    expect(result.format).toBe("wav");
    expect(Buffer.from(result.base64, "base64").equals(WAV)).toBe(true);
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown", modality: "tts" });
    expect(result.accounting.meta).toMatchObject({ model: "grok-tts", codec: "wav", authMode: "oauth" });
  });

  it("applies the source defaults and response_format precedence over output_format.codec", () => {
    expect(buildGrokSpeechRequest("grok-tts", "hello")).toEqual({ text: "hello", voice_id: "eve", language: "auto", output_format: { codec: "mp3" } });
    expect(buildGrokSpeechRequest("grok-tts", "hello", { voice: "eve", voice_id: "rex", output_format: { codec: "pcm", sample_rate: 24000 }, response_format: "wav" }))
      .toEqual({ text: "hello", voice_id: "rex", language: "auto", output_format: { codec: "wav", sample_rate: 24000 } });
    expect(buildGrokSpeechRequest("grok-tts", "x", { output_format: { codec: "alaw" }, language: "" }).output_format).toEqual({ codec: "alaw" });
  });

  it("rejects unsupported models, codecs, speeds, streaming and format keys before dispatch", async () => {
    const { fetchImpl } = transport();
    const adapter = createGrokCliTtsAdapter({ fetchImpl });
    for (const options of [
      { response_format: "opus" }, { response_format: "json" }, { speed: 2 }, { speed: 0.5 }, { speed: Number.NaN },
      { speed: Number.POSITIVE_INFINITY }, { speed: "1" }, { stream: true }, { stream_format: "sse" }, { output_format: [] },
      { output_format: "mp3" }, { output_format: { codec: "mp3", container: "raw" } }, { output_format: { sample_rate: -1 } },
      { voice: 5 }, { language: "pt\r\nX-Evil: 1" },
    ]) {
      const result = await speak(adapter, options);
      expect(result, JSON.stringify(options)).toMatchObject({ success: false, status: 400, local: true });
    }
    expect(await adapter.synthesize("x", "grok-4.7", CRED_A, "mp3", {})).toMatchObject({ status: 400, local: true });
    expect(await adapter.synthesize("x".repeat(300 * 1024), "grok-tts", CRED_A, "mp3", {})).toMatchObject({ status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats malformed, mislabelled or empty audio as a lost accepted result", async () => {
    const { fetchImpl } = transport(
      audio(Buffer.from("not mp3 bytes")),
      audio(Buffer.alloc(0)),
      new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }),
      json({ audio: "data" }),
      json({ error: { message: `bad ${TOKEN_A}` } }),
    );
    const adapter = createGrokCliTtsAdapter({ fetchImpl });
    const [wrong, empty, html, unknownJson, envelope] = [await speak(adapter), await speak(adapter), await speak(adapter), await speak(adapter), await speak(adapter)];
    for (const result of [wrong, empty, html, unknownJson]) {
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob).toMatchObject({ cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "accepted" } });
    }
    expect(envelope).toMatchObject({ success: false, status: 502 });
    expect(envelope.acceptedJob).toBeUndefined();
    expectNoLeak([wrong, empty, html, unknownJson, envelope]);
  });

  it("bounds the audio body", async () => {
    const { fetchImpl } = transport(audio(Buffer.concat([MP3, Buffer.alloc(4096)])));
    const result = await speak(createGrokCliTtsAdapter({ fetchImpl, maxAudioBytes: 64 }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("Grok CLI transcription wire contract (source handleGrokTranscription)", () => {
  it("sends model, native options in source order, then the file last, with .opus relabelled", async () => {
    const { fetchImpl, calls } = transport(json({ text: "é um teste de áudio", duration: 1.5, words: [{ text: "é", start: 0, end: 0.2 }] }));
    const fd = form([["model", `gb/${STT_MODEL}`], ["diarize", "true"], ["language", "pt"], ["response_format", "verbose_json"]]);
    const result = await createGrokCliSttAdapter({ fetchImpl }).transcribe({ model: STT_MODEL, formData: fd, credentials: CRED_A });
    expect(calls[0].url).toBe(STT_URL);
    expect(calls[0].init).toMatchObject({ method: "POST", redirect: "manual" });
    expectGrokHeaders(calls[0].init.headers, TOKEN_A);
    expect(calls[0].init.headers["Content-Type"]).toBeUndefined();
    const multipart = await multipartOf(calls[0]);
    expect([...multipart.keys()]).toEqual(["model", "language", "diarize", "file"]);
    expect(multipart.get("model")).toBe(STT_MODEL);
    expect(multipart.get("language")).toBe("pt");
    expect(multipart.get("file").name).toBe("note.ogg");
    expect(await multipart.get("file").text()).toBe("audio bytes");
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.text).toBe("é um teste de áudio");
    expect(payload.words[0].text).toBe("é");
    expect(result.nativeUnits).toEqual({ audioSeconds: 1.5 });
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown", modality: "stt" });
  });

  it("returns text/plain for response_format text and JSON by default", async () => {
    const { fetchImpl } = transport(json({ text: "olá" }), json({ text: "olá" }));
    const adapter = createGrokCliSttAdapter({ fetchImpl });
    const text = await adapter.transcribe({ model: STT_MODEL, formData: form([["response_format", "text"]]), credentials: CRED_A });
    expect(text.response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await text.response.text()).toBe("olá");
    const def = await transcribe(adapter);
    expect(def.response.headers.get("content-type")).toBe("application/json");
    expect(await def.response.json()).toEqual({ text: "olá" });
    expect(def.nativeUnits).toEqual({});
  });

  it("names an unnamed upload audio.wav and strips header-breaking characters", () => {
    expect(grokUploadFileName({})).toBe("audio.wav");
    expect(grokUploadFileName({ name: "a\"b\r\n.OPUS" })).toBe("a_b__.ogg");
  });

  it("rejects unsupported inputs before dispatch", async () => {
    const { fetchImpl } = transport();
    const adapter = createGrokCliSttAdapter({ fetchImpl });
    const cases = [
      { formData: form([["response_format", "srt"]]) },
      { formData: form([["prompt", "context"]]) },
      { formData: form([["temperature", "0.2"]]) },
      { formData: form([["timestamp_granularities[]", "word"]]) },
      { formData: form([["stream", "true"]]) },
      { formData: form([["diarize", "yes"]]) },
      { formData: form([["channels", "0"]]) },
      { formData: form([["sample_rate", "16k"]]) },
      { formData: form([["language", "pt\r\nx"]]) },
      { formData: form([["language", "pt"], ["language", "en"]]) },
      { formData: form([], null) },
      { formData: form([], new File([], "empty.wav")) },
      { kind: "translation" },
      { model: "whisper-1" },
    ];
    for (const extra of cases) {
      const result = await transcribe(adapter, extra);
      expect(result, JSON.stringify(Object.keys(extra))).toMatchObject({ success: false, status: 400, local: true });
    }
    const big = await createGrokCliSttAdapter({ fetchImpl }).transcribe({
      model: STT_MODEL, credentials: CRED_A, formData: form([], new File([Buffer.alloc(25 * 1024 * 1024 + 1)], "big.wav")),
    });
    expect(big).toMatchObject({ status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats non-JSON, malformed and textless answers as lost accepted results", async () => {
    const { fetchImpl } = transport(
      new Response("plain words", { status: 200, headers: { "content-type": "text/plain" } }),
      new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }),
      json([{ text: "x" }]),
      json({ words: [] }),
      json({ error: { message: `bad ${TOKEN_A}` } }),
    );
    const adapter = createGrokCliSttAdapter({ fetchImpl });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await transcribe(adapter));
    for (const result of results.slice(0, 4)) {
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob.meta.jobState).toBe("accepted");
    }
    expect(results[4]).toMatchObject({ success: false, status: 502 });
    expect(results[4].acceptedJob).toBeUndefined();
    expectNoLeak(results);
  });

  it("bounds the transcript body", async () => {
    const { fetchImpl } = transport(json({ text: "x".repeat(2048) }));
    const result = await transcribe(createGrokCliSttAdapter({ fetchImpl, maxTranscriptBytes: 256 }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("Grok CLI voice refusals, quota and uncertain outcomes", () => {
  it("maps refusals by status without quoting xAI or leaking tokens, sending once", async () => {
    const statuses = [400, 401, 402, 403, 404, 429, 500, 503];
    const { fetchImpl, calls } = transport(...statuses.map((status) => leaky(status, status === 429 ? { "retry-after": "30" } : {})));
    const adapter = createGrokCliTtsAdapter({ fetchImpl });
    const results = {};
    for (const status of statuses) results[status] = await speak(adapter);
    expect(calls).toHaveLength(statuses.length);
    expect(results[400]).toMatchObject({ status: 400 });
    expect(results[401]).toMatchObject({ status: 401 });
    expect(results[402]).toMatchObject({ status: 402, quotaExhausted: true });
    expect(results[403]).toMatchObject({ status: 403 });
    expect(results[404]).toMatchObject({ status: 404 });
    expect(results[429]).toMatchObject({ status: 429 });
    expect(results[429].resetsAtMs ?? results[429].rateLimitEvidence?.resetAtMs).toBeGreaterThan(Date.now());
    expect(results[503]).toMatchObject({ status: 503 });
    expect(results[500]).toMatchObject({ status: 502 });
    expect(results[500].acceptedJob.meta.jobState).toBe("submit-unknown");
    for (const status of [400, 401, 402, 403, 429, 503]) expect(results[status].acceptedJob).toBeUndefined();
    expectNoLeak(results);
  });

  it("keeps quota on the failing connection only", async () => {
    const { fetchImpl, calls } = transport(leaky(402), json({ text: "ok" }));
    const adapter = createGrokCliSttAdapter({ fetchImpl });
    const first = await transcribe(adapter, { credentials: CRED_A });
    const second = await transcribe(adapter, { credentials: CRED_B });
    expect(first).toMatchObject({ status: 402, quotaExhausted: true });
    expect(second.success).toBe(true);
    expect(calls[1].init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
  });

  it("refuses redirects without following them", async () => {
    const { fetchImpl, calls } = transport(new Response(null, { status: 302, headers: { location: "https://evil.example/x" } }));
    const result = await speak(createGrokCliTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(calls[0].init.redirect).toBe("manual");
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("separates provably unsent failures from uncertain ones and never replays", async () => {
    const { fetchImpl, calls } = transport(transportError("ECONNREFUSED"), transportError("ECONNRESET"));
    const adapter = createGrokCliSttAdapter({ fetchImpl });
    const unsent = await transcribe(adapter);
    const uncertain = await transcribe(adapter);
    expect(calls).toHaveLength(2);
    expect(unsent).toMatchObject({ success: false, status: 502 });
    expect(unsent.acceptedJob).toBeUndefined();
    expect(uncertain).toMatchObject({ success: false, status: 502 });
    expect(uncertain.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, meta: { jobState: "submit-unknown" } });
    expectNoLeak([unsent, uncertain]);
  });

  it("does not send when the caller already left", async () => {
    const before = new AbortController();
    before.abort();
    const { fetchImpl } = transport();
    const a = await speak(createGrokCliTtsAdapter({ fetchImpl }), { signal: before.signal });
    const b = await transcribe(createGrokCliSttAdapter({ fetchImpl }), { signal: before.signal });
    expect(a).toMatchObject({ success: false, status: 499, local: true });
    expect(b).toMatchObject({ success: false, status: 499, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a caller abort after send as uncertain and aborts the transport signal", async () => {
    const controller = new AbortController();
    let seen;
    const { fetchImpl } = transport((_url, init) => {
      seen = init.signal;
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await speak(createGrokCliTtsAdapter({ fetchImpl }), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
  });

  it("ends at the deadline even when fetch ignores its signal, and bounds a stalled body", async () => {
    let seen;
    const { fetchImpl, calls } = transport((_url, init) => {
      seen = init.signal;
      return hang();
    }, stalledBody(), new Response(new ReadableStream({ start(c) { c.enqueue(MP3); } }), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const stt = createGrokCliSttAdapter({ fetchImpl, timeoutMs: 25 });
    const timedOut = await transcribe(stt);
    const stalled = await transcribe(stt);
    const stalledAudio = await speak(createGrokCliTtsAdapter({ fetchImpl, timeoutMs: 25 }));
    expect(calls).toHaveLength(3);
    expect(timedOut).toMatchObject({ success: false, status: 504 });
    expect(timedOut.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(stalled).toMatchObject({ success: false, status: 504 });
    expect(stalled.acceptedJob.meta.jobState).toBe("accepted");
    expect(stalledAudio).toMatchObject({ success: false, status: 504 });
    expect(stalledAudio.acceptedJob.meta.jobState).toBe("accepted");
  });
});
