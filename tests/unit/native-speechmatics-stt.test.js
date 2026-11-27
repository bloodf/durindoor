// Speechmatics native batch transcription (STT) adapter, staged and
// unregistered (#2034). Closed mocks only: every request goes to an injected
// transport, an unexpected request fails the test, and every key is synthetic.
// Wire shapes follow OmniRoute c71f0065 (audioTranscription.ts
// handleSpeechmaticsTranscription / pollSpeechmaticsJob /
// fetchSpeechmaticsTranscript, audioMultipart.ts, audioRegistry.ts
// `speechmatics` row). Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  SPEECHMATICS_PROVIDER_DEFINITION,
  SPEECHMATICS_STT_MODELS,
  buildSpeechmaticsTranscriptionRequest,
  createSpeechmaticsSttAdapter,
  speechmaticsJobConfig,
  speechmaticsSttAdapter,
  speechmaticsUploadFileName,
} from "../../open-sse/services/providerParity/native-speechmatics-stt/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const JOBS_URL = "https://asr.api.speechmatics.com/v2/jobs";
const KEY_A = "speechmatics-SYNTHETIC-a-0001";
const KEY_B = "speechmatics-SYNTHETIC-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const STAGE_DIR = "../../open-sse/services/providerParity/native-speechmatics-stt/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const txt = (value) => new Response(value, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo ${KEY_A} at /srv/app/index.js:44` } }, status, headers);
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
const stt = (fetchImpl, extra = {}) => createSpeechmaticsSttAdapter({ fetchImpl, wait: fastWait, ...extra });

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

/** The source happy path: submit, one running poll, done poll, transcript. */
const happySteps = (transcript = "speechmatics result", jobId = "job1", duration = 3.5) => [
  json({ id: jobId }, 201),
  json({ job: { id: jobId, status: "running" } }),
  json({ job: { id: jobId, status: "done", duration } }),
  txt(transcript),
];
const transcribe = (adapter, { model = "enhanced", entries = [], credentials = CRED_A, signal, file } = {}) =>
  adapter.transcribe({ model, formData: form(entries, file), credentials, kind: "transcription", signal });

// ── Staging block: the only assertions about registration state ──────────
describe("Speechmatics stt staging state (promote at registration)", () => {
  it("is not registered: no registry entry for the id or the sm alias", () => {
    expect(REGISTRY.some((entry) => entry.id === "speechmatics" || entry.alias === "sm" || entry.aliases?.includes("sm") || entry.aliases?.includes("speechmatics"))).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.provider.existingRegistryEntry).toBeNull();
  });
});

describe("Speechmatics staged metadata", () => {
  it("pins the source registry fields and model", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.stt).toEqual({
      id: "speechmatics", baseUrl: JOBS_URL, authType: "apikey", authHeader: "bearer", async: true, format: "speechmatics",
    });
    expect(SPEECHMATICS_STT_MODELS.map((m) => [m.id, m.operatingPoint])).toEqual([["enhanced", "enhanced"]]);
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(["enhanced"]);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "speechmatics", aliases: ["sm"], serviceKinds: ["stt"], authModes: ["apikey"], validateUrl: null });
  });

  it("stages an apikey-only provider definition with the source alias and fixed origin", () => {
    expect(SPEECHMATICS_PROVIDER_DEFINITION).toMatchObject({
      id: "speechmatics", alias: "speechmatics", aliases: ["sm"], uiAlias: "sm", category: "apikey", authType: "apikey", serviceKinds: ["stt"],
    });
    expect(SPEECHMATICS_PROVIDER_DEFINITION.display).toMatchObject({ name: "Speechmatics", textIcon: "SM", color: "#0A2540", website: "https://www.speechmatics.com", hasFree: true });
    expect(SPEECHMATICS_PROVIDER_DEFINITION.sttConfig).toEqual({
      baseUrl: JOBS_URL, authType: "apikey", authHeader: "bearer", async: true, format: "speechmatics", translationModels: [],
    });
    expect(Object.isFrozen(SPEECHMATICS_PROVIDER_DEFINITION)).toBe(true);
    expect(speechmaticsSttAdapter.provider).toBe("speechmatics");
  });

  it("exports every name registration.json lists", async () => {
    const mod = await import("../../open-sse/services/providerParity/native-speechmatics-stt/index.js");
    for (const name of Object.keys(REGISTRATION.exports)) expect(mod[name], name).toBeDefined();
  });
});

describe("Speechmatics transcription wire contract", () => {
  it("submits, polls and reads the transcript with the source requests", async () => {
    const { fetchImpl, calls } = transport(...happySteps());
    const result = await transcribe(stt(fetchImpl));
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", JOBS_URL],
      ["GET", `${JOBS_URL}/job1`],
      ["GET", `${JOBS_URL}/job1`],
      ["GET", `${JOBS_URL}/job1/transcript?format=txt`],
    ]);
    for (const call of calls) {
      expect(call.init.redirect).toBe("manual");
      expect(headersOf(call).Authorization).toBe(`Bearer ${KEY_A}`);
    }
    expect(headersOf(calls[0])).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(headersOf(calls[1])).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(headersOf(calls[3])).toEqual({ Authorization: `Bearer ${KEY_A}`, Accept: "text/plain" });
    const submitted = await sentForm(calls[0]);
    expect(submitted.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(submitted.entries.map(([k]) => k)).toEqual(["config", "data_file"]);
    expect(submitted.entries[0][1]).toBe(JSON.stringify({ type: "transcription", transcription_config: { language: "auto", operating_point: "enhanced" } }));
    expect(submitted.entries[1][1].name).toBe("clip.wav");
    expect(submitted.entries[1][1].type).toBe("audio/wav");
    expect(Buffer.from(await submitted.entries[1][1].arrayBuffer()).toString()).toBe("RIFFfakeaudio");
    expect(fastWait).toHaveBeenCalledWith(2_000, undefined);
    expect(result).toMatchObject({ success: true, usageValue: undefined, nativeUnits: { audioSeconds: 3.5 } });
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(await result.response.json()).toEqual({ text: "speechmatics result" });
    expect(result.accounting).toMatchObject({
      modality: "stt", cost: null, costStatus: "unknown", nativeUnits: { audioSeconds: 3.5 },
      meta: { model: "enhanced", operatingPoint: "enhanced", responseFormat: "json", jobId: "job1" },
    });
  });

  it.each([
    ["defaults to automatic language identification", null, "auto"],
    ["passes the trimmed requested language", " pt ", "pt"],
    ["passes an explicit auto", "auto", "auto"],
  ])("job config %s", async (_label, requested, expected) => {
    const { fetchImpl, calls } = transport(...happySteps());
    await transcribe(stt(fetchImpl), { entries: requested === null ? [] : [["language", requested]] });
    const submitted = await sentForm(calls[0]);
    expect(JSON.parse(submitted.entries[0][1])).toEqual({ type: "transcription", transcription_config: { language: expected, operating_point: "enhanced" } });
  });

  it("answers text as text/plain, keeps an empty transcript, and omits unknown duration", async () => {
    const { fetchImpl } = transport(...happySteps("hello world", "job2", null), ...happySteps("", "job3", "12"));
    const adapter = stt(fetchImpl);
    const plain = await transcribe(adapter, { entries: [["response_format", "text"]] });
    expect(plain.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await plain.response.text()).toBe("hello world");
    expect(plain.nativeUnits).toEqual({});
    const empty = await transcribe(adapter);
    expect(await empty.response.json()).toEqual({ text: "" });
    expect(empty.nativeUnits).toEqual({});
  });

  it("uses the source upload name rule and job config shape", async () => {
    expect(speechmaticsUploadFileName({ name: "note.opus" })).toBe("note.ogg");
    expect(speechmaticsUploadFileName({})).toBe("audio.wav");
    expect(speechmaticsUploadFileName({ name: 'a"b\r\n.wav' })).toBe("a_b__.wav");
    expect(speechmaticsJobConfig("enhanced")).toEqual({ type: "transcription", transcription_config: { language: "auto", operating_point: "enhanced" } });
    const built = await buildSpeechmaticsTranscriptionRequest("enhanced", form([], new File([Buffer.from("x")], "", { type: "" })));
    expect(built.submission.get("data_file").name).toBe("audio.wav");
    expect(built.submission.get("data_file").type).toBe("application/octet-stream");
  });

  it("keeps each selected connection's key on its own job and ignores connection base URLs", async () => {
    const { fetchImpl, calls } = transport(...happySteps(), ...happySteps("b", "job2"));
    const adapter = stt(fetchImpl);
    await transcribe(adapter, { credentials: { ...CRED_A, baseUrl: "https://evil.invalid" } });
    const second = await transcribe(adapter, { credentials: CRED_B });
    expect(calls.slice(0, 4).every((c) => headersOf(c).Authorization === `Bearer ${KEY_A}`)).toBe(true);
    expect(calls.slice(4).every((c) => headersOf(c).Authorization === `Bearer ${KEY_B}`)).toBe(true);
    expect(calls.every((c) => c.url.startsWith(`${JOBS_URL}`))).toBe(true);
    expect(await second.response.json()).toEqual({ text: "b" });
    expect(second.accounting.meta.jobId).toBe("job2");
  });

  it.each([
    ["a translation", { kind: "translation" }],
    ["an unknown model", { model: "whisper-1" }],
    ["an unlisted operating point", { model: "standard" }],
    ["a url instead of a file", { file: null, entries: [["url", "https://example.com/a.wav"]] }],
    ["a missing file", { file: null }],
    ["an empty file", { file: new File([], "a.wav") }],
    ["streaming", { entries: [["stream", "true"]] }],
    ["verbose_json output", { entries: [["response_format", "verbose_json"]] }],
    ["srt output", { entries: [["response_format", "srt"]] }],
    ["a prompt the source would drop", { entries: [["prompt", "names"]] }],
    ["a non-zero temperature", { entries: [["temperature", "0.4"]] }],
    ["word timestamps", { entries: [["timestamp_granularities[]", "word"]] }],
    ["diarization", { entries: [["diarize", "true"]] }],
    ["a malformed language", { entries: [["language", "en; DROP"]] }],
  ])("refuses %s before anything is submitted", async (_label, { kind = "transcription", model = "enhanced", entries = [], file } = {}) => {
    const { fetchImpl } = transport();
    const formData = form(entries, file === undefined ? undefined : file);
    const result = await stt(fetchImpl).transcribe({ model, formData, credentials: CRED_A, kind });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an oversized file and a missing or header-unsafe key before submission", async () => {
    const { fetchImpl } = transport();
    const big = await transcribe(stt(fetchImpl), { file: { name: "a.wav", size: 200 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(1) } });
    expect(big).toMatchObject({ success: false, status: 400, local: true });
    expect(await transcribe(stt(fetchImpl), { credentials: { apiKey: "" } })).toMatchObject({ success: false, status: 401 });
    expect(await transcribe(stt(fetchImpl), { credentials: { apiKey: "a\r\nX-Evil: 1" } })).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Speechmatics transcription failures, uncertainty and no replay", () => {
  it("maps submission refusals without quoting Speechmatics and never polls", async () => {
    const { fetchImpl, calls } = transport(leaky(401), leaky(402), leaky(429, { "retry-after": "30" }), leaky(400));
    const adapter = stt(fetchImpl);
    const auth = await transcribe(adapter);
    const quota = await transcribe(adapter);
    const limited = await transcribe(adapter);
    const bad = await transcribe(adapter);
    expect(calls.every((c) => c.url === JOBS_URL && c.init.method === "POST")).toBe(true);
    expect(auth).toMatchObject({ success: false, status: 401 });
    expect(quota).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(bad).toMatchObject({ success: false, status: 400 });
    for (const result of [auth, quota, limited, bad]) {
      expect(result.acceptedJob).toBeUndefined();
      expectNoLeak(result);
    }
  });

  it.each([
    ["a transport reset", transportError("ECONNRESET"), 502],
    ["a 500 answer", leaky(500), 502],
    ["a redirect", new Response(null, { status: 307, headers: { location: "https://evil.invalid/" } }), 502],
  ])("treats an uncertain submission (%s) as an accepted job and never replays it", async (_label, step, status) => {
    const { fetchImpl, calls } = transport(step);
    const result = await transcribe(stt(fetchImpl));
    expect(calls.map((c) => c.url)).toEqual([JOBS_URL]);
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toMatchObject({ modality: "stt", cost: null, costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(result);
  });

  it("does not mark a provably unsent submission as accepted", async () => {
    const { fetchImpl } = transport(transportError("ECONNREFUSED"));
    const result = await transcribe(stt(fetchImpl));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("records a submission answered without a usable job id as accepted, without polling", async () => {
    const { fetchImpl, calls } = transport(json({ id: "../../admin" }, 201), json({}, 201));
    const adapter = stt(fetchImpl);
    const unsafe = await transcribe(adapter);
    const missing = await transcribe(adapter);
    expect(calls).toHaveLength(2);
    for (const result of [unsafe, missing]) {
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob.meta).toEqual({ jobState: "accepted" });
    }
  });

  it.each(["rejected", "deleted", "expired"])("reports a %s job without quoting Speechmatics' message", async (state) => {
    const { fetchImpl, calls } = transport(json({ id: "job1" }, 201), json({ job: { status: state, errors: [{ message: `bad ${KEY_A} /srv/app` }] } }));
    const result = await transcribe(stt(fetchImpl));
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("keeps polling through transient status failures inside the deadline", async () => {
    const { fetchImpl, calls } = transport(
      json({ id: "job1" }, 201),
      leaky(503), leaky(429), transportError("ECONNRESET"), json({ job: { status: "done" } }), txt("ok"),
    );
    const result = await transcribe(stt(fetchImpl));
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
    expect(await result.response.json()).toEqual({ text: "ok" });
  });

  it("stops at an auth refusal, a redirect, an unknown state or an unreadable status, with the job recorded", async () => {
    const redirect = new Response(null, { status: 302, headers: { location: "https://evil.invalid/" } });
    const { fetchImpl } = transport(
      json({ id: "job1" }, 201), leaky(401),
      json({ id: "job2" }, 201), redirect,
      json({ id: "job3" }, 201), json({ job: { status: "weird" } }),
      json({ id: "job4" }, 201), json({ status: "done" }),
    );
    const adapter = stt(fetchImpl);
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await transcribe(adapter));
    expect(results[0]).toMatchObject({ success: false, status: 401 });
    results.forEach((result, index) => {
      expect(result.acceptedJob.meta).toEqual({ jobState: "poll-failed", jobId: `job${index + 1}` });
      expectNoLeak(result);
    });
  });

  it("ends at the total deadline while polling, without resubmitting the job", async () => {
    let clock = 0;
    const pending = () => json({ job: { status: "running" } });
    const { fetchImpl, calls } = transport(json({ id: "job1" }, 201), ...Array.from({ length: 50 }, () => pending));
    const adapter = stt(fetchImpl, { totalTimeoutMs: 10_000, now: () => clock, wait: async (ms) => { clock += ms; } });
    const result = await transcribe(adapter);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "poll-timeout", jobId: "job1" });
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
    expect(calls.length).toBeLessThanOrEqual(1 + 5);
  });

  it("bounds each call: a hung submission ends at the per-call ceiling as uncertain", async () => {
    let seenSignal;
    const { fetchImpl } = transport((_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const result = await transcribe(stt(fetchImpl, { callTimeoutMs: 20 }));
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("aborts polling when the caller leaves and records the running job", async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = transport(json({ id: "job1" }, 201));
    const adapter = stt(fetchImpl, {
      wait: (_ms, signal) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        setTimeout(() => controller.abort(), 5);
      }),
    });
    const result = await transcribe(adapter, { signal: controller.signal });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job1" });
  });

  it("aborts an in-flight status check through the transport signal", async () => {
    const controller = new AbortController();
    let seenSignal;
    const { fetchImpl } = transport(json({ id: "job1" }, 201), (_url, init) => {
      seenSignal = init.signal;
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await transcribe(stt(fetchImpl), { signal: controller.signal });
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job1" });
  });

  it("does not submit when the caller already left", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl } = transport();
    const result = await transcribe(stt(fetchImpl), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats HTML, JSON, oversized, non-UTF-8, binary, redirected or refused transcripts as lost results", async () => {
    const steps = (last) => [json({ id: "job1" }, 201), json({ job: { status: "done" } }), last];
    const { fetchImpl } = transport(
      ...steps(new Response("<html>x</html>", { status: 200, headers: { "content-type": "text/html" } })),
      ...steps(leaky(200)),
      ...steps(txt("x".repeat(4096))),
      ...steps(new Response(new Uint8Array([0xff, 0xfe, 0xfd]), { status: 200, headers: { "content-type": "text/plain" } })),
      ...steps(txt("a\u0000b")),
      ...steps(new Response(null, { status: 302, headers: { location: "https://evil.invalid/" } })),
      ...steps(leaky(404)),
    );
    const adapter = stt(fetchImpl, { maxTranscriptBytes: 1024 });
    for (let i = 0; i < 7; i += 1) {
      const result = await transcribe(adapter);
      expect(result.success).toBe(false);
      expect(result.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job1" });
      expectNoLeak(result);
    }
  });
});
