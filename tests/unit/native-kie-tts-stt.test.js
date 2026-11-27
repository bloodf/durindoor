// Kie native speech (TTS) and transcription (STT) adapters, registered on
// the existing kie provider (#2034). Closed mocks only: every request is answered below, an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (audioSpeech.ts handleKieAudioSpeech,
// audioTranscription.ts handleKieAudioTranscription, executors/kie.ts,
// utils/kieTask.ts, tests/unit/kie-audio-transcription-result.test.ts).
// Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-kie-tts-stt/index.js";
import {
  KIE_STT_MODELS,
  KIE_TTS_MODELS,
  buildKieSpeechRequest,
  createKieSttAdapter,
  createKieTtsAdapter,
  findKieAudioUrl,
  kieSttAdapter,
  kieTtsAdapter,
  normalizeKieTaskState,
} from "../../open-sse/services/providerParity/native-kie-tts-stt/index.js";
import { getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";
import kieRegistry from "../../open-sse/providers/registry/kie.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://api.kie.ai";
const CREATE_URL = `${ORIGIN}/api/v1/jobs/createTask`;
const RECORD_URL = (id) => `${ORIGIN}/api/v1/jobs/recordInfo?taskId=${id}`;
const KEY_A = "kie-SYNTHETIC-key-a-0001";
const KEY_B = "kie-SYNTHETIC-key-b-0002";
const TTS_MODEL = "elevenlabs/text-to-speech-multilingual-v2";
const STT_MODEL = "elevenlabs/speech-to-text";
// Public IP literals, so the download guard runs without a DNS lookup.
const AUDIO_URL = "https://93.184.216.34/kie/speech-a.mp3";
const AUDIO_URL_B = "https://93.184.216.35/kie/speech-b.mp3";
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-kie-tts-stt/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const audio = (bytes = MP3, type = "audio/mpeg") => new Response(bytes, { status: 200, headers: { "content-type": type } });
const accepted = (taskId = "task-1") => json({ code: 200, msg: "success", data: { taskId } });
const record = (state, extra = {}, taskId = "task-1") => json({ code: 200, msg: "success", data: { taskId, state, ...extra } });
const done = (url = AUDIO_URL, taskId = "task-1") => record("success", { resultJson: JSON.stringify({ resultUrls: [url] }) }, taskId);
const leaky = (status) => json({ code: status, msg: `upstream echo ${KEY_A} at /srv/app/index.js:44` }, status);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

const originalFetch = global.fetch;
let calls;
let clock;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), init, body });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

const polling = () => ({
  pollIntervalMs: 1_000,
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const speak = (text = "hello there", { model = TTS_MODEL, credentials = { apiKey: KEY_A }, options = {}, adapter = {} } = {}) =>
  createKieTtsAdapter({ ...polling(), ...adapter }).synthesize(text, model, credentials, "mp3", options);

function form({ bytes = Buffer.from("RIFF-synthetic-audio"), name = "clip.wav", type = "audio/wav", fields = {} } = {}) {
  const fd = new FormData();
  if (bytes !== null) fd.append("file", new File([bytes], name, { type }));
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}
const transcribe = ({ model = STT_MODEL, formData = form(), credentials = { apiKey: KEY_A }, kind, signal, adapter = {} } = {}) =>
  createKieSttAdapter({ ...polling(), ...adapter }).transcribe({ model, formData, credentials, kind, signal });

const errorText = async (result) => (await result.response.clone().json()).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};

beforeEach(() => {
  calls = [];
  clock = 1_000_000;
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Isolated registration block: the positive registry identity checks. Every
// other block works staged or registered.
describe("canonical registration (isolated)", () => {
  it("registers speech and transcription and preserves registered KIE chat and media", () => {
    expect(getTtsAdapter("kie")).toBe(kieTtsAdapter);
    expect(kieRegistry.serviceKinds).toEqual(["llm", "image", "video", "tts", "stt"]);
    expect(kieRegistry.ttsConfig).toBeUndefined();
    expect(kieRegistry.sttConfig).toEqual({ baseUrl: ORIGIN, authType: "apikey", authHeader: "bearer", format: "kie-audio" });
    expect(kieRegistry.models.filter((row) => row.kind === "tts").map((row) => row.id)).toEqual(KIE_TTS_MODELS.map((m) => m.id));
    expect(kieRegistry.models.filter((row) => row.kind === "stt").map((row) => row.id)).toEqual(KIE_STT_MODELS.map((m) => m.id));
    expect(kieRegistry.authType).toBe("apikey");
    expect(kieRegistry.transport.baseUrl).toBe(`${ORIGIN}/v1/chat/completions`);
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields and the supported subset", () => {
    expect(staged.KIE_PROVIDER_ID).toBe("kie");
    expect(staged.KIE_ORIGIN).toBe(ORIGIN);
    expect(staged.KIE_AUDIO_FORMAT).toBe("kie-audio");
    expect(staged.KIE_CREATE_TASK_URL).toBe(CREATE_URL);
    expect(staged.KIE_RECORD_INFO_URL).toBe(`${ORIGIN}/api/v1/jobs/recordInfo`);
    expect(KIE_TTS_MODELS.map((m) => m.id)).toEqual([TTS_MODEL, "elevenlabs/text-to-speech-turbo-2-5"]);
    expect(KIE_STT_MODELS.map((m) => m.id)).toEqual([STT_MODEL]);
    expect(Object.keys(staged.KIE_EXCLUDED_MODELS).sort()).toEqual([
      "elevenlabs/audio-isolation", "elevenlabs/sound-effect-v2", "elevenlabs/text-to-dialogue-v3",
    ]);
    expect(kieTtsAdapter.responseFormats).toEqual(["mp3", "json"]);
    expect(kieSttAdapter.responseFormats).toEqual(["json", "text"]);
    expect(isFunction(kieTtsAdapter.synthesize) && isFunction(kieSttAdapter.transcribe)).toBe(true);
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields).toEqual({
      id: "kie", baseUrl: ORIGIN, authType: "apikey", authHeader: "bearer", format: "kie-audio",
    });
    expect(REGISTRATION.provider.canonicalId).toBe("kie");
    expect(REGISTRATION.provider.aliases).toEqual(["kie"]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["tts", "stt"]);
    expect(REGISTRATION.models.tts.map((m) => m.id)).toEqual(KIE_TTS_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(KIE_STT_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.excluded.sort()).toEqual(Object.keys(staged.KIE_EXCLUDED_MODELS).sort());
    expect(REGISTRATION.endpoints.createTask.url).toBe(CREATE_URL);
    expect(REGISTRATION.endpoints.recordInfo.url).toBe(`${ORIGIN}/api/v1/jobs/recordInfo?taskId={taskId}`);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("speech request contract", () => {
  it("submits the source body with Bearer auth, polls recordInfo and downloads the audio without the key", async () => {
    serve(accepted(), record("generating"), done(), audio());
    const result = await speak("hello there", { options: { voice: "nova" } });
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([CREATE_URL, RECORD_URL("task-1"), RECORD_URL("task-1"), AUDIO_URL]);
    const [submit, poll, , download] = calls;
    expect(submit.init.method).toBe("POST");
    expect(submit.init.redirect).toBe("manual");
    expect(submit.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(submit.body).toEqual({
      model: TTS_MODEL,
      callBackUrl: "https://durindoor.invalid/api/kie/callback",
      input: {
        text: "hello there", voice: "Bella", stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1,
        timestamps: false, previous_text: "", next_text: "", language_code: "",
      },
    });
    expect(poll.init.method).toBe("GET");
    expect(poll.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(poll.init.redirect).toBe("manual");
    expect(JSON.stringify(download.init.headers)).not.toContain(KEY_A);
    expect(download.init.redirect).toBe("manual");
    // The connection-time DNS guard rides on a guarded dispatcher.
    expect(download.init.dispatcher).toBeDefined();
    expect(result.accounting).toMatchObject({
      modality: "tts", cost: null, costStatus: "unknown", meta: { taskId: "task-1", nativeUnitsSource: "input-characters" },
    });
  });

  it("forwards tuning fields, maps voice aliases and accepts a model/voice suffix", () => {
    const body = buildKieSpeechRequest(`${TTS_MODEL}/Adam`, "hi", {
      stability: 0.2, similarity_boost: 0.9, style: 0.3, speed: 1.2, previous_text: "a", next_text: "b", language_code: "en",
    });
    expect(body.input).toEqual({
      text: "hi", voice: "Adam", stability: 0.2, similarity_boost: 0.9, style: 0.3, speed: 1.2,
      timestamps: false, previous_text: "a", next_text: "b", language_code: "en",
    });
    expect(buildKieSpeechRequest(TTS_MODEL, "hi", {}).input.voice).toBe("Rachel");
    expect(buildKieSpeechRequest(TTS_MODEL, "hi", { voice: "ONYX" }).input.voice).toBe("Antoni");
    expect(buildKieSpeechRequest("elevenlabs/text-to-speech-turbo-2-5", "hi", { voice: "Custom" }).model).toBe("elevenlabs/text-to-speech-turbo-2-5");
  });

  it.each([
    ["an excluded dialogue model", { model: "elevenlabs/text-to-dialogue-v3" }, /not supported for speech/],
    ["an excluded sound-effect model", { model: "elevenlabs/sound-effect-v2" }, /not supported for speech/],
    ["an unknown model", { model: "elevenlabs/unknown" }, /Unsupported Kie speech model/],
    ["streaming", { options: { stream: true } }, /streaming/],
    ["sse stream format", { options: { stream_format: "sse" } }, /streaming/],
    ["timestamps", { options: { timestamps: true } }, /timestamps/],
    ["a caller callback", { options: { callBackUrl: "https://attacker.example/cb" } }, /callbacks/],
    ["a non-numeric speed", { options: { speed: "fast" } }, /speed must be a finite number/],
    ["a non-finite stability", { options: { stability: Infinity } }, /stability must be a finite number/],
    ["a non-string language code", { options: { language_code: 5 } }, /language_code must be a string/],
    ["a conflicting voice", { model: `${TTS_MODEL}/Adam`, options: { voice: "Bella" } }, /named twice/],
    ["a wav container", { options: { requestedResponseFormat: "wav" } }, /omit response_format/],
    ["an opus container in the body", { options: { response_format: "opus" } }, /omit response_format/],
  ])("refuses %s before anything is sent", async (_name, args, message) => {
    const result = await speak("hello", args);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(message);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("refuses missing or unusable keys before anything is sent", async () => {
    for (const credentials of [{}, { apiKey: "" }, { apiKey: "a\r\nb" }]) {
      const result = await speak("hello", { credentials });
      expect(result.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("speech outcomes", () => {
  it("reads a synchronous submit answer that already carries the audio URL", async () => {
    serve(json({ code: 200, data: { response: { audio_url: AUDIO_URL } } }), audio());
    const result = await speak();
    expect(result.format).toBe("mp3");
    expect(calls.map((c) => c.url)).toEqual([CREATE_URL, AUDIO_URL]);
    expect(result.accounting.meta.taskId).toBeNull();
  });

  it("finds the URL under the source's named keys and ignores echoed callbacks and images", () => {
    const rec = (data) => ({ code: 200, data });
    expect(findKieAudioUrl(rec({ resultJson: { resultUrls: [AUDIO_URL] } }))).toBe(AUDIO_URL);
    expect(findKieAudioUrl(rec({ response: { audioUrl: AUDIO_URL } }))).toBe(AUDIO_URL);
    expect(findKieAudioUrl(rec({ resultJson: { result: [{ url: AUDIO_URL }] } }))).toBe(AUDIO_URL);
    expect(findKieAudioUrl(rec({ param: JSON.stringify({ callBackUrl: AUDIO_URL }) }))).toBeNull();
    expect(findKieAudioUrl(rec({ resultJson: { resultUrls: ["https://93.184.216.34/cover.png"] } }))).toBeNull();
    expect(findKieAudioUrl(rec({ resultJson: { resultUrls: ["http://93.184.216.34/a.mp3"] } }))).toBeNull();
    expect(findKieAudioUrl(rec({ resultJson: { resultUrls: ["https://127.0.0.1/a.mp3"] } }))).toBeNull();
    expect(findKieAudioUrl(rec({ resultJson: { resultUrls: ["https://user:pw@93.184.216.34/a.mp3"] } }))).toBeNull();
  });

  it("normalizes task states like the source, without the msg fallback", () => {
    expect(normalizeKieTaskState({ data: { state: "success" } })).toBe("success");
    expect(normalizeKieTaskState({ data: { successFlag: 1 } })).toBe("success");
    expect(normalizeKieTaskState({ data: { status: "GENERATE_AUDIO_FAILED" } })).toBe("failed");
    expect(normalizeKieTaskState({ data: { state: "fail" } })).toBe("failed");
    expect(normalizeKieTaskState({ data: { state: "queuing" } })).toBe("pending");
    expect(normalizeKieTaskState({ msg: "success", data: {} })).toBe("pending");
  });

  it("keeps each connection's key on its own task", async () => {
    serve(
      (url, init) => (init.headers.Authorization.endsWith(KEY_A) ? accepted("task-a") : accepted("task-b")),
      (url, init) => (init.headers.Authorization.endsWith(KEY_A) ? accepted("task-a") : accepted("task-b")),
      (url) => (url.endsWith("task-a") ? done(AUDIO_URL, "task-a") : done(AUDIO_URL_B, "task-b")),
      (url) => (url.endsWith("task-a") ? done(AUDIO_URL, "task-a") : done(AUDIO_URL_B, "task-b")),
      audio(), audio(),
    );
    const [a, b] = await Promise.all([
      speak("one", { credentials: { apiKey: KEY_A, connectionId: "conn-a" } }),
      speak("two", { credentials: { apiKey: KEY_B, connectionId: "conn-b" } }),
    ]);
    expect(a.accounting.meta.taskId).toBe("task-a");
    expect(b.accounting.meta.taskId).toBe("task-b");
    const auth = (id) => calls.filter((c) => c.url.endsWith(id)).map((c) => c.init.headers.Authorization);
    expect(auth("task-a")).toEqual([`Bearer ${KEY_A}`]);
    expect(auth("task-b")).toEqual([`Bearer ${KEY_B}`]);
    const submits = calls.filter((c) => c.url === CREATE_URL);
    expect(submits.find((c) => c.body.input.text === "one").init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(submits.find((c) => c.body.input.text === "two").init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it("reports a failed task as an ordinary failure", async () => {
    serve(accepted(), record("fail", { failMsg: `upstream echo ${KEY_A}` }));
    const result = await speak();
    expect(result.status).toBe(502);
    expect(result.error).toBe("Kie speech task failed");
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it.each([
    [401, 401, false],
    [403, 403, false],
    [422, 422, false],
    [402, 402, true],
  ])("maps a refused submit %s without quoting Kie", async (status, expected, quota) => {
    serve(leaky(status));
    const result = await speak();
    expect(result.status).toBe(expected);
    expect(Boolean(result.quotaExhausted)).toBe(quota);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
    expect(calls).toHaveLength(1);
  });

  it("maps refusals sent in a 200 envelope, including quota", async () => {
    serve(json({ code: 402, msg: `upstream echo ${KEY_A}` }));
    const quota = await speak();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    await assertNoLeak(quota);
    serve(json({ code: 401, msg: "bad key" }));
    expect((await speak()).status).toBe(401);
  });

  it("keeps a bounded Retry-After on a rate-limited submit", async () => {
    serve(json({ msg: "slow down" }, 429, { "retry-after": "7" }));
    const result = await speak();
    expect(result.status).toBe(429);
    expect(result.resetsAtMs ?? result.rateLimitEvidence?.resetAtMs ?? 0).toBeGreaterThan(0);
  });

  it("marks a 5xx submit as possibly accepted and never resends it", async () => {
    serve(leaky(500));
    const result = await speak();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ modality: "tts", costSource: "accepted-job", cost: null, meta: { jobState: "submit-unknown" } });
    await assertNoLeak(result);
    expect(calls).toHaveLength(1);
  });

  it("separates provably unsent transport failures from uncertain ones", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const unsent = await speak();
    expect(unsent.status).toBe(502);
    expect(unsent.acceptedJob).toBeUndefined();
    await assertNoLeak(unsent);

    serve(() => { throw transportError("ECONNRESET"); });
    const uncertain = await speak();
    expect(uncertain.acceptedJob?.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(uncertain);
  });

  it("bounds the submit with a deadline and does not replay it", async () => {
    serve(() => new Promise(() => {}));
    const result = await speak("hello", { adapter: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("stops polling at the task deadline and keeps the accepted job", async () => {
    serve(accepted(), ...Array.from({ length: 10 }, () => record("generating")));
    const result = await speak("hello", { adapter: { timeoutMs: 3_500 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls.filter((c) => c.url === CREATE_URL)).toHaveLength(1);
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it("does not send anything when the caller already left", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await speak("hello", { options: { signal: controller.signal } });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("stops polling on abort and records the accepted job", async () => {
    const controller = new AbortController();
    serve(accepted(), () => {
      controller.abort();
      return record("generating");
    });
    const result = await speak("hello", { options: { signal: controller.signal } });
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("retries a bounded number of 429/503 status answers", async () => {
    serve(accepted(), json({}, 503), json({}, 429, { "retry-after": "1" }), done(), audio());
    const result = await speak();
    expect(result.format).toBe("mp3");
    expect(calls.filter((c) => c.url === CREATE_URL)).toHaveLength(1);
  });

  it("refuses a submit redirect without following it", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const result = await speak();
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/redirect refused/);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["a redirected status check", () => new Response(null, { status: 307, headers: { location: "https://evil.example/" } }), /redirected/],
    ["a record about another task", () => record("success", {}, "task-other"), /different speech task/],
    ["an unreadable status body", () => new Response("not json", { status: 200 }), /unreadable/],
    ["a completed task with only a private URL", () => done("https://10.0.0.5/a.mp3"), /without a usable result/],
    ["a completed task with no URL", () => record("success", { resultJson: "{}" }), /without a usable result/],
  ])("treats %s as an unknown outcome of an accepted job", async (_name, step, message) => {
    serve(accepted(), step);
    const result = await speak();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(message);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    await assertNoLeak(result);
    expect(calls).toHaveLength(2);
  });

  it("refuses an unusable task id without polling", async () => {
    serve(json({ code: 200, data: { taskId: "../../etc" } }));
    const result = await speak();
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["a non-audio content type", () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), /not audio/],
    ["bytes that are not audio", () => audio(Buffer.from("plain text, not audio at all"), "application/octet-stream"), /not a recognized audio/],
    ["an empty body", () => audio(Buffer.alloc(0)), /empty/],
    ["a download redirect", () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }), /refused or failed|returned 302/],
    ["a 404", () => new Response("gone", { status: 404 }), /returned 404/],
  ])("keeps the accepted job when the download yields %s", async (_name, step, message) => {
    serve(accepted(), done(), step);
    const result = await speak();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(message);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(3);
  });

  it("bounds the download size", async () => {
    serve(accepted(), done(), audio(Buffer.concat([MP3, Buffer.alloc(4096)])));
    const result = await speak("hello", { adapter: { maxAudioBytes: 1024 } });
    expect(result.error).toMatch(/too large/);
    expect(result.acceptedJob).toBeDefined();
  });

  it("refuses to relabel another container as a requested mp3", async () => {
    serve(accepted(), done(), audio(WAV, "audio/wav"));
    const result = await speak("hello", { options: { requestedResponseFormat: "mp3" } });
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/wav audio, not the requested mp3/);
    expect(result.acceptedJob).toBeDefined();

    serve(accepted(), done(), audio(WAV, "audio/wav"));
    const unnamed = await speak();
    expect(unnamed.format).toBe("wav");
  });
});

describe("transcription request contract", () => {
  it("submits the source body with the file as base64 and reads the polled text", async () => {
    const bytes = Buffer.from("RIFF-synthetic-audio");
    serve(accepted("stt-1"), record("success", { response: { text: "hello world" } }, "stt-1"));
    const result = await transcribe({ formData: form({ bytes, name: "note.opus", fields: { language: "en", prompt: "names" } }) });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "hello world" });
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(calls.map((c) => c.url)).toEqual([CREATE_URL, RECORD_URL("stt-1")]);
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(calls[0].body).toEqual({ model: STT_MODEL, input: { file_name: "note.ogg", file_base64: bytes.toString("base64") } });
    expect(calls[1].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(result.nativeUnits).toEqual({});
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", meta: { taskId: "stt-1", synchronous: false } });
  });

  it("reads every source result envelope and the text format", async () => {
    const cases = [
      [{ response: { text: "a" } }, "a"],
      [{ response: { text: { malformed: true } }, resultText: "b" }, "b"],
      [{ text: "c" }, "c"],
    ];
    for (const [data, expected] of cases) {
      serve(accepted(), record("success", data));
      const result = await transcribe();
      expect((await result.response.json()).text).toBe(expected);
    }
    serve(accepted(), json({ code: 200, data: { taskId: "task-1", state: "success" }, text: "d" }));
    expect((await (await transcribe()).response.json()).text).toBe("d");

    serve(accepted(), record("success", { response: { text: "plain" } }));
    const text = await transcribe({ formData: form({ fields: { response_format: "text" } }) });
    expect(text.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await text.response.text()).toBe("plain");
  });

  it("reads a synchronous answer and names an unnamed upload like the source", async () => {
    serve(json({ code: 200, data: { text: "sync" } }));
    const result = await transcribe({ formData: (() => { const fd = new FormData(); fd.append("file", new Blob([Buffer.from("abc")])); return fd; })() });
    expect((await result.response.json()).text).toBe("sync");
    expect(calls[0].body.input.file_name).toBe("blob");
    expect(result.accounting.meta.synchronous).toBe(true);
    expect(staged.kieUploadFileName({})).toBe("audio.wav");
  });

  it.each([
    ["a translation", { kind: "translation" }, /translations/],
    ["the audio-isolation model", { model: "elevenlabs/audio-isolation" }, /not supported for transcription/],
    ["an unknown model", { model: "whisper-1" }, /Unsupported Kie transcription model/],
    ["a missing file", { formData: form({ bytes: null }) }, /Missing required field: file/],
    ["an empty file", { formData: form({ bytes: Buffer.alloc(0) }) }, /empty/],
    ["streaming", { formData: form({ fields: { stream: "true" } }) }, /streaming/],
    ["timestamps", { formData: form({ fields: { "timestamp_granularities[]": "word" } }) }, /timestamps/],
    ["an srt format", { formData: form({ fields: { response_format: "srt" } }) }, /json or text/],
    ["a verbose_json format", { formData: form({ fields: { response_format: "verbose_json" } }) }, /json or text/],
  ])("refuses %s before anything is sent", async (_name, args, message) => {
    const result = await transcribe(args);
    expect(result.status).toBe(400);
    expect(result.local).toBe(true);
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses an oversized file before reading it into a submit", async () => {
    const big = { name: "big.wav", size: 26 * 1024 * 1024, arrayBuffer: vi.fn() };
    const fd = { get: (name) => (name === "file" ? big : null) };
    const result = await transcribe({ formData: fd });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/too large/);
    expect(big.arrayBuffer).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe("transcription outcomes", () => {
  it("uses the selected connection's key for each call", async () => {
    serve(accepted("a"), record("success", { text: "one" }, "a"), accepted("b"), record("success", { text: "two" }, "b"));
    await transcribe({ credentials: { apiKey: KEY_A } });
    await transcribe({ credentials: { accessToken: KEY_B } });
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([
      `Bearer ${KEY_A}`, `Bearer ${KEY_A}`, `Bearer ${KEY_B}`, `Bearer ${KEY_B}`,
    ]);
  });

  it("treats a completed task without text as an unknown outcome, not an empty transcript", async () => {
    serve(accepted(), record("success", {}));
    const result = await transcribe();
    expect(result.success).toBe(false);
    expect(result.acceptedJob).toMatchObject({ modality: "stt", meta: { jobState: "accepted" } });
  });

  it("maps quota, failure and uncertain submit without leaking", async () => {
    serve(leaky(402));
    const quota = await transcribe();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    await assertNoLeak(quota);

    serve(accepted(), record("failed", { failMsg: `upstream echo ${KEY_A}` }));
    const failed = await transcribe();
    expect(failed.error).toBe("Kie transcription task failed");
    expect(failed.acceptedJob).toBeUndefined();
    await assertNoLeak(failed);

    serve(() => new Promise(() => {}));
    const timedOut = await transcribe({ adapter: { submitTimeoutMs: 20 } });
    expect(timedOut.status).toBe(504);
    expect(timedOut.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });

  it("stops polling on abort and at the deadline", async () => {
    const controller = new AbortController();
    serve(accepted(), () => {
      controller.abort();
      return record("queuing");
    });
    const aborted = await transcribe({ signal: controller.signal });
    expect(aborted.status).toBe(499);
    expect(aborted.acceptedJob).toBeDefined();

    serve(accepted(), ...Array.from({ length: 10 }, () => record("queuing")));
    const late = await transcribe({ adapter: { timeoutMs: 2_500 } });
    expect(late.status).toBe(504);
    expect(late.acceptedJob?.meta.jobState).toBe("accepted");
  });
});
