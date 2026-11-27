// Rev AI native asynchronous transcription (STT) adapter, staged and
// unregistered (#2034). Closed mocks only: every request goes to an injected
// transport, an unexpected request fails the test, and every key is synthetic.
// Wire shapes follow OmniRoute c71f0065 (audioTranscription.ts
// handleRevAiTranscription, audioMultipart.ts buildMultipartBody,
// audioRegistry.ts `rev-ai` rows, audioMiscProviders.ts validateRevAiProvider).
// Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-revai-stt/index.js";
import {
  REVAI_PROVIDER_DEFINITION,
  REVAI_STT_MODELS,
  createRevaiSttAdapter,
  revaiJobOptions,
  revaiSttAdapter,
  revaiUploadFileName,
} from "../../open-sse/services/providerParity/native-revai-stt/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { supportsSttTranslation } from "../../open-sse/handlers/sttCore.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const BASE_URL = "https://api.rev.ai/speechtotext/v1";
const JOBS_URL = `${BASE_URL}/jobs`;
const KEY_A = "revai-SYNTHETIC-a-0001";
const KEY_B = "revai-SYNTHETIC-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const STAGE_DIR = "../../open-sse/services/providerParity/native-revai-stt/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const plain = (text, type = "text/plain") => new Response(text, { status: 200, headers: { "content-type": type } });
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
const stt = (fetchImpl, extra = {}) => createRevaiSttAdapter({ fetchImpl, wait: fastWait, ...extra });

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

/** The source happy path: submit, one pending poll, transcribed poll, transcript. */
const happySteps = (text = "hello from rev ai", jobId = "job1", duration = 12.5) => [
  json({ id: jobId, status: "in_progress" }),
  json({ id: jobId, status: "in_progress" }),
  json({ id: jobId, status: "transcribed", duration_seconds: duration }),
  plain(text),
];
const transcribe = (adapter, { model = "machine", entries = [], credentials = CRED_A, signal, file } = {}) =>
  adapter.transcribe({ model, formData: form(entries, file), credentials, kind: "transcription", signal });

// ── Staging block: the only assertions about registration state ──────────
describe("Rev AI stt staging state (promote at registration)", () => {
  it("is not registered: no registry entry under rev-ai or revai", () => {
    expect(REGISTRY.some((entry) => entry.id === "rev-ai" || entry.alias === "revai" || entry.alias === "rev-ai"
      || entry.aliases?.includes("revai") || entry.aliases?.includes("rev-ai"))).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.provider.existingRegistryEntry).toBeNull();
  });
});

describe("Rev AI staged metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.stt).toEqual({ id: "rev-ai", baseUrl: BASE_URL, authType: "apikey", authHeader: "bearer", async: true, format: "rev-ai" });
    expect(REVAI_STT_MODELS.map((m) => [m.id, m.name])).toEqual([["machine", "Reverb ASR"], ["low_cost", "Low-Cost ASR"], ["fusion", "Fusion ASR"]]);
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(REVAI_STT_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.dynamicDiscovery).toMatch(/^none/);
  });

  it("stages an apikey-only provider definition with the source alias and fixed origin", () => {
    expect(REVAI_PROVIDER_DEFINITION).toMatchObject({ id: "rev-ai", alias: "rev-ai", aliases: ["revai"], uiAlias: "revai", category: "apikey", authType: "apikey", serviceKinds: ["stt"] });
    expect(REVAI_PROVIDER_DEFINITION.display).toEqual({ name: "Rev AI", icon: "record_voice_over", color: "#FF5C35", textIcon: "RV", website: "https://www.rev.ai" });
    expect(REVAI_PROVIDER_DEFINITION.transport.validateUrl).toBe(`${JOBS_URL}?limit=1`);
    expect(REVAI_PROVIDER_DEFINITION.sttConfig).toMatchObject({ baseUrl: BASE_URL, authType: "apikey", authHeader: "bearer", async: true, format: "rev-ai" });
    expect(supportsSttTranslation(REVAI_PROVIDER_DEFINITION.sttConfig, "machine")).toBe(false);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "rev-ai", aliases: ["revai"], authModes: ["apikey"], serviceKinds: ["stt"], formats: { stt: "rev-ai" } });
    expect(REGISTRATION.endpoints.submitJob.url).toBe(JOBS_URL);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(revaiSttAdapter.provider).toBe("rev-ai");
    expect(revaiSttAdapter.responseFormats).toEqual(["json", "text"]);
  });
});

describe("Rev AI transcription wire contract", () => {
  it("submits the options and media parts, polls and reads the plain-text transcript with the source requests", async () => {
    const { fetchImpl, calls } = transport(...happySteps());
    const result = await transcribe(stt(fetchImpl));
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", JOBS_URL],
      ["GET", `${JOBS_URL}/job1`],
      ["GET", `${JOBS_URL}/job1`],
      ["GET", `${JOBS_URL}/job1/transcript`],
    ]);
    for (const call of calls) {
      expect(call.init.redirect).toBe("manual");
      expect(headersOf(call).Authorization).toBe(`Bearer ${KEY_A}`);
      expect(call.proxyOptions).toBeTypeOf("object");
    }
    expect(Object.keys(headersOf(calls[0]))).toEqual(["Authorization"]);
    const submit = await sentForm(calls[0]);
    expect(submit.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(submit.entries.map(([k]) => k)).toEqual(["options", "media"]);
    expect(submit.entries[0][1]).toBe('{"transcriber":"machine"}');
    expect(submit.entries[1][1].name).toBe("clip.wav");
    expect(submit.entries[1][1].type).toBe("audio/wav");
    expect(Buffer.from(await submit.entries[1][1].arrayBuffer()).toString()).toBe("RIFFfakeaudio");
    expect(headersOf(calls[1])).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(headersOf(calls[3])).toEqual({ Authorization: `Bearer ${KEY_A}`, Accept: "text/plain" });
    expect(fastWait).toHaveBeenCalledWith(2_000, undefined);
    expect(result).toMatchObject({ success: true, usageValue: undefined, nativeUnits: { audioSeconds: 12.5 } });
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(await result.response.json()).toEqual({ text: "hello from rev ai" });
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", nativeUnits: { audioSeconds: 12.5 }, meta: { model: "machine", responseFormat: "json", jobId: "job1" } });
  });

  it.each(["machine", "low_cost", "fusion"])("sends model %s as options.transcriber", async (model) => {
    const { fetchImpl, calls } = transport(...happySteps());
    await transcribe(stt(fetchImpl), { model });
    expect((await sentForm(calls[0])).entries[0][1]).toBe(revaiJobOptions(model));
    expect(revaiJobOptions(model)).toBe(JSON.stringify({ transcriber: model }));
  });

  it("answers text as text/plain, accepts English and a zero temperature, and omits unknown duration", async () => {
    const { fetchImpl } = transport(json({ id: "job1" }), json({ id: "job1", status: "transcribed" }), plain("Speaker 0    00:00:01    hi", "text/plain; charset=utf-8"));
    const result = await transcribe(stt(fetchImpl), { entries: [["response_format", "text"], ["language", "en"], ["temperature", "0"]] });
    expect(result.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await result.response.text()).toBe("Speaker 0    00:00:01    hi");
    expect(result.nativeUnits).toEqual({});
  });

  it("returns an empty transcript as empty text, like the source", async () => {
    const { fetchImpl } = transport(json({ id: "job1" }), json({ status: "transcribed" }), plain(""));
    const result = await transcribe(stt(fetchImpl));
    expect(await result.response.json()).toEqual({ text: "" });
  });

  it("uses the source upload name rule", () => {
    expect(revaiUploadFileName({ name: "note.opus" })).toBe("note.ogg");
    expect(revaiUploadFileName({})).toBe("audio.wav");
    expect(revaiUploadFileName({ name: 'a"b\r\n.wav' })).toBe("a_b__.wav");
  });

  it("keeps each selected connection's key on its own job and ignores connection base URLs", async () => {
    const { fetchImpl, calls } = transport(...happySteps(), ...happySteps("b", "job2"));
    const adapter = stt(fetchImpl);
    await transcribe(adapter, { credentials: { ...CRED_A, baseUrl: "https://evil.invalid" } });
    const second = await transcribe(adapter, { credentials: CRED_B });
    expect(calls.slice(0, 4).every((c) => headersOf(c).Authorization === `Bearer ${KEY_A}`)).toBe(true);
    expect(calls.slice(4).every((c) => headersOf(c).Authorization === `Bearer ${KEY_B}`)).toBe(true);
    expect(calls.every((c) => c.url.startsWith(`${JOBS_URL}`))).toBe(true);
    expect(calls[4].url).toBe(JOBS_URL);
    expect(calls[5].url).toBe(`${JOBS_URL}/job2`);
    expect(await second.response.json()).toEqual({ text: "b" });
  });

  it.each([
    ["a translation", { kind: "translation" }],
    ["an unknown model", { model: "whisper-1" }],
    ["a url instead of a file", { file: null, entries: [["url", "https://example.com/a.wav"]] }],
    ["a missing file", { file: null }],
    ["an empty file", { file: new File([], "a.wav") }],
    ["streaming", { entries: [["stream", "true"]] }],
    ["verbose_json the source never produced", { entries: [["response_format", "verbose_json"]] }],
    ["srt output", { entries: [["response_format", "srt"]] }],
    ["a prompt the source would drop", { entries: [["prompt", "names"]] }],
    ["a non-zero temperature", { entries: [["temperature", "0.4"]] }],
    ["word timestamps", { entries: [["timestamp_granularities[]", "word"]] }],
    ["diarization", { entries: [["diarize", "true"]] }],
    ["a non-English language the source would drop", { entries: [["language", "fr"]] }],
    ["a malformed language", { entries: [["language", "en; DROP"]] }],
  ])("refuses %s before anything is submitted", async (_label, { kind = "transcription", model = "machine", entries = [], file } = {}) => {
    const { fetchImpl } = transport();
    const formData = form(entries, file === undefined ? undefined : file);
    const result = await stt(fetchImpl).transcribe({ model, formData, credentials: CRED_A, kind });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an oversized file and a missing or unsafe key before submit", async () => {
    const { fetchImpl } = transport();
    const big = await transcribe(stt(fetchImpl), { file: { name: "a.wav", size: 200 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(1) } });
    expect(big).toMatchObject({ success: false, status: 400, local: true });
    expect(await transcribe(stt(fetchImpl), { credentials: { apiKey: "" } })).toMatchObject({ success: false, status: 401 });
    expect(await transcribe(stt(fetchImpl), { credentials: { apiKey: "k\r\nX-Evil: 1" } })).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Rev AI transcription failures, uncertainty and no replay", () => {
  it("maps submit refusals without quoting Rev AI and never polls", async () => {
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
    expect(bad.local).toBeUndefined();
    for (const result of [auth, quota, limited, bad]) {
      expect(result.acceptedJob).toBeUndefined();
      expectNoLeak(result);
    }
  });

  it("treats a 5xx, a redirect and a reset after submit as uncertain accepted work, never replayed", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/jobs" } });
    const { fetchImpl, calls } = transport(leaky(500), redirect, transportError("ECONNRESET"));
    const adapter = stt(fetchImpl);
    const results = [await transcribe(adapter), await transcribe(adapter), await transcribe(adapter)];
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.url === JOBS_URL)).toBe(true);
    for (const result of results) {
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob).toMatchObject({ modality: "stt", cost: null, costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
      expectNoLeak(result);
    }
  });

  it("reports a connect failure before send as not accepted", async () => {
    const { fetchImpl } = transport(transportError("ECONNREFUSED"));
    const result = await transcribe(stt(fetchImpl));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("records a submit answered without a usable job id as accepted", async () => {
    const { fetchImpl, calls } = transport(json({ id: "../../admin" }));
    const result = await transcribe(stt(fetchImpl));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "accepted" });
  });

  it("reports a failed job without quoting failure_detail", async () => {
    const { fetchImpl } = transport(json({ id: "job1" }), json({ id: "job1", status: "failed", failure_detail: `bad ${KEY_A} /srv/app` }));
    const result = await transcribe(stt(fetchImpl));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("keeps polling through transient status failures inside the deadline", async () => {
    const { fetchImpl, calls } = transport(
      json({ id: "job1" }), leaky(503), leaky(429), transportError("ECONNRESET"), json({ status: "transcribed" }), plain("ok"),
    );
    const result = await transcribe(stt(fetchImpl));
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
    expect(await result.response.json()).toEqual({ text: "ok" });
  });

  it("stops at an auth refusal, a redirect, an unknown state or another job's answer while polling, with the job recorded", async () => {
    const redirect = new Response(null, { status: 302, headers: { location: "https://evil.invalid/" } });
    const { fetchImpl } = transport(
      json({ id: "job1" }), leaky(401),
      json({ id: "job2" }), redirect,
      json({ id: "job3" }), json({ status: "weird" }),
      json({ id: "job4" }), json({ id: "other", status: "transcribed" }),
    );
    const adapter = stt(fetchImpl);
    const results = [await transcribe(adapter), await transcribe(adapter), await transcribe(adapter), await transcribe(adapter)];
    expect(results[0]).toMatchObject({ success: false, status: 401 });
    results.forEach((result, index) => {
      expect(result.acceptedJob.meta).toEqual({ jobState: "poll-failed", jobId: `job${index + 1}` });
      expectNoLeak(result);
    });
  });

  it("ends at the total deadline while polling, without re-submitting the job", async () => {
    let clock = 0;
    const pending = () => json({ status: "in_progress" });
    const { fetchImpl, calls } = transport(json({ id: "job1" }), ...Array.from({ length: 50 }, () => pending));
    const adapter = stt(fetchImpl, { totalTimeoutMs: 10_000, now: () => clock, wait: async (ms) => { clock += ms; } });
    const result = await transcribe(adapter);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "poll-timeout", jobId: "job1" });
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
    expect(calls.length).toBeLessThanOrEqual(1 + 5);
  });

  it("bounds each call: a hung submit ends at the per-call ceiling as uncertain", async () => {
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
    const { fetchImpl, calls } = transport(json({ id: "job1" }));
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

  it("aborts a hung transcript read and records the finished job", async () => {
    const controller = new AbortController();
    let seenSignal;
    const { fetchImpl } = transport(json({ id: "job1" }), json({ status: "transcribed" }), (_url, init) => {
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
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats HTML, JSON envelopes, oversized, binary, redirected or refused transcripts as lost results", async () => {
    const steps = (last) => [json({ id: "job1" }), json({ status: "transcribed" }), last];
    const { fetchImpl } = transport(
      ...steps(plain("<html>x</html>", "text/html")),
      ...steps(leaky(200)),
      ...steps(plain("x".repeat(4096))),
      ...steps(plain("a\u0000b")),
      ...steps(new Response(null, { status: 302, headers: { location: "https://evil.invalid/" } })),
      ...steps(leaky(404)),
    );
    const adapter = stt(fetchImpl, { maxTranscriptBytes: 1024 });
    for (let i = 0; i < 6; i += 1) {
      const result = await transcribe(adapter);
      expect(result.success).toBe(false);
      expect(result.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job1" });
      expectNoLeak(result);
    }
  });
});
