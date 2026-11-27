// Gladia native asynchronous transcription (STT) adapter, staged and
// unregistered (#2034). Closed mocks only: every request goes to an injected
// transport, an unexpected request fails the test, and every key is
// synthetic. Wire shapes follow OmniRoute c71f0065 (audioTranscription.ts
// handleGladiaTranscription / pollGladiaResultOnce, registryUtils.ts
// buildAuthHeaders "x-gladia-key", audioMultipart.ts, audioRegistry.ts
// `gladia` row). Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-gladia-stt/index.js";
import {
  GLADIA_PROVIDER_DEFINITION,
  GLADIA_STT_MODELS,
  createGladiaSttAdapter,
  gladiaAudioUrl,
  gladiaResultJob,
  gladiaSttAdapter,
  gladiaUploadFileName,
} from "../../open-sse/services/providerParity/native-gladia-stt/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { supportsSttTranslation } from "../../open-sse/handlers/sttCore.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const UPLOAD_URL = "https://api.gladia.io/v2/upload";
const JOBS_URL = "https://api.gladia.io/v2/pre-recorded";
const AUDIO_URL = "https://api.gladia.io/file/audio-1";
const KEY_A = "gladia-SYNTHETIC-a-0001";
const KEY_B = "gladia-SYNTHETIC-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const STAGE_DIR = "../../open-sse/services/providerParity/native-gladia-stt/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, headers = {}) => json({ message: `upstream echo ${KEY_A} at /srv/app/index.js:44` }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
const hang = () => new Promise(() => {});

/** A transport that answers each request with the next step (a Response, an Error, or a function). */
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

const headersOf = (call) => Object.fromEntries(Object.entries(call.init.headers));
const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};
const fastWait = vi.fn(async (_ms, signal) => { if (signal?.aborted) throw signal.reason; });
const stt = (fetchImpl, extra = {}) => createGladiaSttAdapter({ fetchImpl, wait: fastWait, ...extra });

function form(entries = [], file = new File([Buffer.from("RIFFfakeaudio")], "clip.wav", { type: "audio/wav" })) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
}

async function sentForm(call) {
  const request = new Request("https://capture.invalid/", { method: "POST", body: call.init.body });
  const contentType = request.headers.get("content-type");
  const parsed = await request.formData();
  return { contentType, entries: [...parsed.entries()] };
}

const submitted = (jobId = "job-1") => json({ id: jobId, result_url: `${JOBS_URL}/${jobId}` });
const done = (text = "gladia result") => json({ id: "job-1", status: "done", result: { transcription: { full_transcript: text } } });
/** The source happy path: upload, submit, one pending poll, done poll. */
const happySteps = (text = "gladia result", jobId = "job-1") => [
  json({ audio_url: AUDIO_URL, audio_metadata: { audio_duration: 3 } }),
  submitted(jobId),
  json({ status: "processing" }),
  done(text),
];
const transcribe = (adapter, { model = "solaria-1", entries = [], credentials = CRED_A, signal, file } = {}) =>
  adapter.transcribe({ model, formData: form(entries, file), credentials, kind: "transcription", signal });

// ── Staging block: the only assertions about registration state ──────────
describe("Gladia stt staging state (promote at registration)", () => {
  it("is not registered: no registry entry", () => {
    expect(REGISTRY.some((entry) => entry.id === "gladia" || entry.alias === "gladia" || entry.aliases?.includes("gladia"))).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.provider.existingRegistryEntry).toBeNull();
  });
});

describe("Gladia staged metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.stt).toEqual({
      id: "gladia", baseUrl: JOBS_URL, authType: "apikey", authHeader: "x-gladia-key", async: true, format: "gladia",
    });
    expect(GLADIA_STT_MODELS.map((m) => m.id)).toEqual(["solaria-1", "solaria-mini"]);
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(GLADIA_STT_MODELS.map((m) => m.id));
  });

  it("stages an apikey-only provider definition on the fixed origin", () => {
    expect(GLADIA_PROVIDER_DEFINITION).toMatchObject({ id: "gladia", alias: "gladia", aliases: [], category: "apikey", authType: "apikey", serviceKinds: ["stt"] });
    expect(GLADIA_PROVIDER_DEFINITION.display).toMatchObject({ name: "Gladia", textIcon: "GL", color: "#6425FE", website: "https://gladia.io" });
    expect(GLADIA_PROVIDER_DEFINITION.sttConfig).toMatchObject({ baseUrl: JOBS_URL, authType: "apikey", authHeader: "x-gladia-key", async: true, format: "gladia" });
    expect(supportsSttTranslation(GLADIA_PROVIDER_DEFINITION.sttConfig, "solaria-1")).toBe(false);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "gladia", aliases: [], authModes: ["apikey"], serviceKinds: ["stt"], validateUrl: null });
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(gladiaSttAdapter.provider).toBe("gladia");
  });
});

describe("Gladia transcription wire contract", () => {
  it("uploads, submits and polls result_url with the source requests", async () => {
    fastWait.mockClear();
    const { fetchImpl, calls } = transport(...happySteps());
    const result = await transcribe(stt(fetchImpl));
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", UPLOAD_URL],
      ["POST", JOBS_URL],
      ["GET", `${JOBS_URL}/job-1`],
      ["GET", `${JOBS_URL}/job-1`],
    ]);
    for (const call of calls) {
      expect(call.init.redirect).toBe("manual");
      expect(headersOf(call)["x-gladia-key"]).toBe(KEY_A);
      expect(headersOf(call).Authorization).toBeUndefined();
    }
    expect(Object.keys(headersOf(calls[0]))).toEqual(["x-gladia-key"]);
    const upload = await sentForm(calls[0]);
    expect(upload.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(upload.entries.map(([k]) => k)).toEqual(["audio"]);
    expect(upload.entries[0][1].name).toBe("clip.wav");
    expect(upload.entries[0][1].type).toBe("audio/wav");
    expect(headersOf(calls[1])).toEqual({ "x-gladia-key": KEY_A, "Content-Type": "application/json" });
    expect(calls[1].init.body).toBe(JSON.stringify({ audio_url: AUDIO_URL, model: "solaria-1" }));
    expect(headersOf(calls[2])).toEqual({ "x-gladia-key": KEY_A });
    expect(fastWait).toHaveBeenCalledWith(2_000, undefined);
    expect(result).toMatchObject({ success: true, usageValue: undefined, nativeUnits: {} });
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(await result.response.json()).toEqual({ text: "gladia result" });
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", meta: { model: "solaria-1", responseFormat: "json", jobId: "job-1" } });
  });

  it("sends solaria-mini, answers text as text/plain and keeps an empty transcript", async () => {
    const { fetchImpl, calls } = transport(json({ audio_url: AUDIO_URL }), submitted(), done(""), json({ audio_url: AUDIO_URL }), submitted(), done("hi"));
    const adapter = stt(fetchImpl);
    const empty = await transcribe(adapter, { model: "solaria-mini" });
    expect(JSON.parse(calls[1].init.body)).toEqual({ audio_url: AUDIO_URL, model: "solaria-mini" });
    expect(await empty.response.json()).toEqual({ text: "" });
    const text = await transcribe(adapter, { entries: [["response_format", "text"], ["temperature", "0"], ["language", ""]] });
    expect(text.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await text.response.text()).toBe("hi");
  });

  it("uses the source upload name rule", () => {
    expect(gladiaUploadFileName({ name: "note.opus" })).toBe("note.ogg");
    expect(gladiaUploadFileName({})).toBe("audio.wav");
    expect(gladiaUploadFileName({ name: 'a"b\r\n.wav' })).toBe("a_b__.wav");
  });

  it("keeps each selected connection's key on its own job and ignores connection base URLs", async () => {
    const { fetchImpl, calls } = transport(...happySteps(), ...happySteps("b", "job-2"));
    const adapter = stt(fetchImpl);
    await transcribe(adapter, { credentials: { ...CRED_A, baseUrl: "https://evil.invalid" } });
    const second = await transcribe(adapter, { credentials: { accessToken: KEY_B, connectionId: "conn-b" } });
    expect(calls.slice(0, 4).every((c) => headersOf(c)["x-gladia-key"] === KEY_A)).toBe(true);
    expect(calls.slice(4).every((c) => headersOf(c)["x-gladia-key"] === KEY_B)).toBe(true);
    expect(calls.every((c) => c.url.startsWith("https://api.gladia.io/v2/"))).toBe(true);
    expect(calls[7].url).toBe(`${JOBS_URL}/job-2`);
    expect(await second.response.json()).toEqual({ text: "b" });
  });

  it.each([
    ["a translation", { kind: "translation" }],
    ["an unknown model", { model: "whisper-1" }],
    ["a url instead of a file", { file: null, entries: [["url", "https://example.com/a.wav"]] }],
    ["a missing file", { file: null }],
    ["an empty file", { file: new File([], "a.wav") }],
    ["streaming", { entries: [["stream", "true"]] }],
    ["verbose_json output", { entries: [["response_format", "verbose_json"]] }],
    ["srt output", { entries: [["response_format", "srt"]] }],
    ["a language the source drops", { entries: [["language", "en"]] }],
    ["a prompt the source drops", { entries: [["prompt", "names"]] }],
    ["a non-zero temperature", { entries: [["temperature", "0.4"]] }],
    ["timestamp granularities", { entries: [["timestamp_granularities[]", "word"]] }],
    ["diarization", { entries: [["diarize", "true"]] }],
  ])("refuses %s before anything is uploaded", async (_label, { kind = "transcription", model = "solaria-1", entries = [], file } = {}) => {
    const { fetchImpl } = transport();
    const formData = form(entries, file === undefined ? undefined : file);
    const result = await stt(fetchImpl).transcribe({ model, formData, credentials: CRED_A, kind });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an oversized file and a missing or header-unsafe key before upload", async () => {
    const { fetchImpl } = transport();
    const big = await transcribe(stt(fetchImpl), { file: { name: "a.wav", size: 200 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(1) } });
    expect(big).toMatchObject({ success: false, status: 400, local: true });
    expect(await transcribe(stt(fetchImpl), { credentials: { apiKey: "" } })).toMatchObject({ success: false, status: 401 });
    expect(await transcribe(stt(fetchImpl), { credentials: { apiKey: "a\r\nX-Evil: 1" } })).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Gladia result_url and audio_url safety", () => {
  it("accepts only an exact pre-recorded result path on the API origin and rebuilds the poll URL", () => {
    expect(gladiaResultJob({ id: "abc-1", result_url: `${JOBS_URL}/abc-1` })).toEqual({ jobId: "abc-1", pollUrl: `${JOBS_URL}/abc-1` });
    expect(gladiaResultJob({ result_url: "https://api.gladia.io:443/v2/pre-recorded/abc" })).toEqual({ jobId: "abc", pollUrl: `${JOBS_URL}/abc` });
    for (const bad of [
      "https://evil.example/v2/pre-recorded/abc",
      "http://api.gladia.io/v2/pre-recorded/abc",
      "https://api.gladia.io.evil.example/v2/pre-recorded/abc",
      "https://user:pw@api.gladia.io/v2/pre-recorded/abc",
      "https://api.gladia.io/v2/pre-recorded/abc?x=1",
      "https://api.gladia.io/v2/pre-recorded/abc#x",
      "https://api.gladia.io/v2/pre-recorded/%2e%2e",
      "https://api.gladia.io/v2/upload/abc",
      "https://169.254.169.254/v2/pre-recorded/abc",
      "not a url",
    ]) expect(gladiaResultJob({ result_url: bad }), bad).toBeNull();
    expect(gladiaResultJob({ id: "other", result_url: `${JOBS_URL}/abc` })).toBeNull();
    expect(gladiaResultJob({ id: "abc" })).toBeNull();
  });

  it("passes only plain https audio_url values back to Gladia", () => {
    expect(gladiaAudioUrl({ audio_url: AUDIO_URL })).toBe(AUDIO_URL);
    for (const bad of ["http://api.gladia.io/file/a", "https://u:p@api.gladia.io/f", "file:///etc/passwd", "https://a.io/\nx", `https://a.io/${"x".repeat(3000)}`, 7, ""]) {
      expect(gladiaAudioUrl({ audio_url: bad })).toBeNull();
    }
  });

  it("records an off-origin result_url as an accepted job and never polls it", async () => {
    const { fetchImpl, calls } = transport(json({ audio_url: AUDIO_URL }), json({ id: "job-9", result_url: "https://evil.example/v2/pre-recorded/job-9" }));
    const result = await transcribe(stt(fetchImpl));
    expect(calls.map((c) => c.url)).toEqual([UPLOAD_URL, JOBS_URL]);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ cost: null, costSource: "accepted-job", meta: { jobState: "accepted", jobId: "job-9" } });
  });

  it("refuses an unusable audio_url without submitting a job", async () => {
    const { fetchImpl, calls } = transport(json({ audio_url: "http://169.254.169.254/latest" }));
    const result = await transcribe(stt(fetchImpl));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
  });
});

describe("Gladia transcription failures, uncertainty and no replay", () => {
  it("maps upload refusals without quoting Gladia and never submits a job", async () => {
    const { fetchImpl, calls } = transport(leaky(401), leaky(402), leaky(429, { "retry-after": "30" }), leaky(500));
    const adapter = stt(fetchImpl);
    const auth = await transcribe(adapter);
    const quota = await transcribe(adapter);
    const limited = await transcribe(adapter);
    const broken = await transcribe(adapter);
    expect(calls.every((c) => c.url === UPLOAD_URL)).toBe(true);
    expect(auth).toMatchObject({ success: false, status: 401 });
    expect(quota).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(limited).toMatchObject({ success: false, status: 429 });
    // The upload bills nothing, so even an uncertain upload records no accepted job.
    expect(broken).toMatchObject({ success: false, status: 502 });
    for (const result of [auth, quota, limited, broken]) {
      expect(result.acceptedJob).toBeUndefined();
      expectNoLeak(result);
    }
  });

  it("maps a submit quota refusal to the selected connection without an accepted job", async () => {
    const { fetchImpl, calls } = transport(json({ audio_url: AUDIO_URL }), leaky(402));
    const result = await transcribe(stt(fetchImpl), { credentials: CRED_B });
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("treats an uncertain submit as an accepted job and never replays it", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/" } });
    const { fetchImpl, calls } = transport(
      json({ audio_url: AUDIO_URL }), transportError("ECONNRESET"),
      json({ audio_url: AUDIO_URL }), leaky(500),
      json({ audio_url: AUDIO_URL }), redirect,
    );
    const adapter = stt(fetchImpl);
    for (let i = 0; i < 3; i += 1) {
      const result = await transcribe(adapter);
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob).toMatchObject({ modality: "stt", cost: null, costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
      expectNoLeak(result);
    }
    expect(calls.map((c) => c.url)).toEqual([UPLOAD_URL, JOBS_URL, UPLOAD_URL, JOBS_URL, UPLOAD_URL, JOBS_URL]);
  });

  it("does not count a pre-connect submit failure as accepted", async () => {
    const { fetchImpl } = transport(json({ audio_url: AUDIO_URL }), transportError("ECONNREFUSED"));
    const result = await transcribe(stt(fetchImpl));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("reports a failed job with only its numeric code", async () => {
    const { fetchImpl } = transport(json({ audio_url: AUDIO_URL }), submitted(), json({ status: "error", error_code: 422, error: `bad ${KEY_A} /srv/app` }));
    const result = await transcribe(stt(fetchImpl));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.error).toContain("code 422");
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("keeps polling through transient poll failures inside the deadline", async () => {
    const { fetchImpl, calls } = transport(
      json({ audio_url: AUDIO_URL }), submitted(),
      leaky(503), leaky(429), transportError("ECONNRESET"), json({ status: "queued" }), done("ok"),
    );
    const result = await transcribe(stt(fetchImpl));
    expect(calls.filter((c) => c.url === JOBS_URL)).toHaveLength(1);
    expect(await result.response.json()).toEqual({ text: "ok" });
  });

  it("stops at an auth refusal, a redirect or an unknown state while polling, with the job recorded", async () => {
    const redirect = new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    const { fetchImpl } = transport(
      json({ audio_url: AUDIO_URL }), submitted("job-1"), leaky(401),
      json({ audio_url: AUDIO_URL }), submitted("job-2"), redirect,
      json({ audio_url: AUDIO_URL }), submitted("job-3"), json({ status: "weird" }),
    );
    const adapter = stt(fetchImpl);
    const auth = await transcribe(adapter);
    const moved = await transcribe(adapter);
    const weird = await transcribe(adapter);
    expect(auth).toMatchObject({ success: false, status: 401 });
    expect(auth.acceptedJob.meta).toEqual({ jobState: "poll-failed", jobId: "job-1" });
    expect(moved.acceptedJob.meta).toEqual({ jobState: "poll-failed", jobId: "job-2" });
    expect(weird.acceptedJob.meta).toEqual({ jobState: "poll-failed", jobId: "job-3" });
    for (const result of [auth, moved, weird]) expectNoLeak(result);
  });

  it("ends at the source poll window without re-submitting the job", async () => {
    let clock = 0;
    const pending = () => json({ status: "processing" });
    const { fetchImpl, calls } = transport(json({ audio_url: AUDIO_URL }), submitted(), ...Array.from({ length: 80 }, () => pending));
    const adapter = stt(fetchImpl, { now: () => clock, wait: async (ms) => { clock += ms; } });
    const result = await transcribe(adapter);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "poll-timeout", jobId: "job-1" });
    expect(calls.filter((c) => c.url === JOBS_URL)).toHaveLength(1);
    // 120 s window / 2 s interval; the last slot has no time left for a poll.
    expect(calls.length).toBe(2 + 59);
  });

  it("bounds each call: a hung submit ends at the per-call ceiling as uncertain", async () => {
    let seenSignal;
    const { fetchImpl } = transport(json({ audio_url: AUDIO_URL }), (_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const result = await transcribe(stt(fetchImpl, { callTimeoutMs: 20 }));
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("bounds each poll: a hung poll is aborted and retried inside the window", async () => {
    const signals = [];
    const { fetchImpl } = transport(json({ audio_url: AUDIO_URL }), submitted(), (_url, init) => {
      signals.push(init.signal);
      return hang();
    }, done("late"));
    const result = await transcribe(stt(fetchImpl, { pollCallTimeoutMs: 20 }));
    expect(signals[0].aborted).toBe(true);
    expect(await result.response.json()).toEqual({ text: "late" });
  });

  it("aborts polling when the caller leaves and records the running job", async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = transport(json({ audio_url: AUDIO_URL }), submitted());
    const adapter = stt(fetchImpl, {
      wait: (_ms, signal) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        setTimeout(() => controller.abort(), 5);
      }),
    });
    const result = await transcribe(adapter, { signal: controller.signal });
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job-1" });
  });

  it("aborts an in-flight poll through its signal", async () => {
    const controller = new AbortController();
    let seen;
    const { fetchImpl } = transport(json({ audio_url: AUDIO_URL }), submitted(), (_url, init) => {
      seen = init.signal;
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await transcribe(stt(fetchImpl), { signal: controller.signal });
    expect(seen.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job-1" });
  });

  it("does not upload when the caller already left", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl } = transport();
    const result = await transcribe(stt(fetchImpl), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats malformed, HTML, oversized or transcript-less finished results as lost", async () => {
    const steps = (last) => [json({ audio_url: AUDIO_URL }), submitted(), last];
    const { fetchImpl } = transport(
      ...steps(json({ status: "done", result: { transcription: { full_transcript: 5 } } })),
      ...steps(json({ status: "done" })),
      ...steps(new Response("<html>x</html>", { status: 200, headers: { "content-type": "text/html" } })),
      ...steps(new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })),
      ...steps(done("x".repeat(4096))),
    );
    const adapter = stt(fetchImpl, { maxResultBytes: 1024 });
    for (let i = 0; i < 5; i += 1) {
      const result = await transcribe(adapter);
      expect(result.success).toBe(false);
      expect(result.acceptedJob.meta.jobId).toBe("job-1");
      expectNoLeak(result);
    }
  });
});
