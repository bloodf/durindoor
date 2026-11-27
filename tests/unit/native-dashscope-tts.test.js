// Qwen Cloud Token Plan (DashScope SpeechSynthesizer) native speech adapter,
// staged and unregistered (#2034). Closed mocks only: every request goes to an
// injected transport, an unexpected request fails the test, and every key is
// synthetic. Wire shapes follow OmniRoute c71f0065 (executors/dashscopeTts.ts
// handleDashscopeTtsSpeech, audioRegistry.ts `qwen-cloud-token-plan` speech
// row, audioSpeech.ts `dashscope-tts` dispatch). Passing here says nothing
// about the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-dashscope-tts/index.js";
import {
  DASHSCOPE_TTS_CONFIG,
  DASHSCOPE_TTS_MODELS,
  DASHSCOPE_TTS_PROVIDER_ADDITIONS,
  buildDashscopeTtsRequest,
  createDashscopeTtsAdapter,
  dashscopeTtsAdapter,
  normalizeDashscopeTtsFormat,
} from "../../open-sse/services/providerParity/native-dashscope-tts/index.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import qctRegistry from "../../open-sse/providers/registry/qwen-cloud-token-plan.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SPEECH_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";
const MODEL = "qwen-audio-3.0-tts-plus";
const KEY_A = "sk-SYNTHETIC-qct-a-0001";
const KEY_B = "sk-SYNTHETIC-qct-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
// Public IP literals, so the download guard runs without a DNS lookup.
const AUDIO_URL = "https://93.184.216.34/tts/a.mp3?Expires=1&Signature=synthetic";
const AUDIO_URL_B = "https://93.184.216.35/tts/b.mp3";
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(100, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-dashscope-tts/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
/** Source success shape with inline base64 audio. */
const inline = (bytes = MP3, extra = {}) =>
  json({ request_id: "req-1", output: { finish_reason: "stop", audio: { data: Buffer.from(bytes).toString("base64"), url: "" } }, ...extra });
/** Source success shape with an expiring audio URL and empty data. */
const linked = (url = AUDIO_URL, extra = {}) => json({ request_id: "req-1", output: { audio: { data: "", url, expires_at: 1 } }, ...extra });
const audio = (bytes = MP3, type = "audio/mpeg") => new Response(bytes, { status: 200, headers: { "content-type": type } });
const leaky = (status, headers = {}, code = "InvalidParameter") =>
  json({ code, message: `upstream echo ${KEY_A} at /srv/app/index.js:44`, request_id: "r" }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
/** A fetch that never settles and ignores its signal. */
const hang = () => new Promise(() => {});
const stalled = (type = "application/json", start = '{"output":{"audio":{"data":"SUQz') =>
  new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(start)); } }), { status: 200, headers: { "content-type": type } });

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
const bodyOf = (call) => JSON.parse(call.init.body);
const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
  expect(text).not.toContain("Signature");
};
const adapterWith = (api = transport(), download = transport(), options = {}) =>
  createDashscopeTtsAdapter({ fetchImpl: api.fetchImpl, downloadFetchImpl: download.fetchImpl, ...options });
const synth = (adapter, options = {}, model = MODEL, cred = CRED_A, text = "Hello there.") => adapter.synthesize(text, model, cred, "mp3", options);

// ── Staging block: the only assertions about registration state ──────────
describe("DashScope tts staging state (promote at registration)", () => {
  it("is not registered: no TTS adapter, no ttsConfig, no tts kind or model row, no format handler", () => {
    for (const key of ["qwen-cloud-token-plan", "qct"]) expect(Object.hasOwn(TTS_ADAPTERS, key), key).toBe(false);
    expect(qctRegistry.ttsConfig).toBeUndefined();
    expect(qctRegistry.serviceKinds).toEqual(["llm"]);
    expect(qctRegistry.models.some((m) => m.id === MODEL || m.kind === "tts")).toBe(false);
    expect(Object.hasOwn(FORMAT_HANDLERS, "dashscope-tts")).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("DashScope tts staged metadata", () => {
  it("pins the exact source registry fields and model", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toEqual({
      id: "qwen-cloud-token-plan", alias: "qct", baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer",
      format: "dashscope-tts", supportedFormats: ["mp3"], models: [{ id: MODEL, name: "Qwen Audio 3.0 TTS Plus" }],
    });
    expect(REGISTRATION.models.tts).toEqual([{ id: MODEL, name: "Qwen Audio 3.0 TTS Plus" }]);
    expect(DASHSCOPE_TTS_MODELS).toEqual([{ id: MODEL, name: "Qwen Audio 3.0 TTS Plus", kind: "tts" }]);
  });

  it("stages a ttsConfig and additions that keep the existing provider identity", () => {
    expect(DASHSCOPE_TTS_CONFIG).toMatchObject({ baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "dashscope-tts", supportedFormats: ["mp3"], defaultVoice: "longanlingxin" });
    expect(DASHSCOPE_TTS_PROVIDER_ADDITIONS).toMatchObject({ id: "qwen-cloud-token-plan", alias: "qct", authModes: ["apikey"], addServiceKinds: ["tts"] });
    // Identity must match the existing chat provider the speech half merges into.
    expect(qctRegistry.id).toBe(DASHSCOPE_TTS_PROVIDER_ADDITIONS.id);
    expect(qctRegistry.alias).toBe(DASHSCOPE_TTS_PROVIDER_ADDITIONS.alias);
    expect(qctRegistry.authType).toBe("apikey");
    expect(new URL(qctRegistry.transport.baseUrl).origin).toBe(new URL(SPEECH_URL).origin);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "qwen-cloud-token-plan", alias: "qct", connectionBaseUrlHonored: false });
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(dashscopeTtsAdapter.provider).toBe("qwen-cloud-token-plan");
  });
});

describe("DashScope speech wire contract", () => {
  it("posts exactly the source body with the Bearer key and returns inline mp3", async () => {
    const api = transport(inline(MP3, { usage: { characters: 14 } }));
    const result = await synth(adapterWith(api), { voice: "  longanlufeng " });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].url).toBe(SPEECH_URL);
    expect(api.calls[0].init.method).toBe("POST");
    expect(api.calls[0].init.redirect).toBe("manual");
    expect(headersOf(api.calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(bodyOf(api.calls[0])).toEqual({
      model: MODEL,
      input: { text: "Hello there.", voice: "longanlufeng" },
      parameters: { format: "mp3", sample_rate: 24000 },
    });
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", nativeUnits: { characters: 14 }, meta: { model: MODEL, container: "mp3", nativeUnitsSource: "provider-usage" } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("defaults the voice to longanlingxin and an empty model to qwen-audio-3.0-tts-plus", async () => {
    const api = transport(inline(), inline(MP3_FRAME), inline());
    const adapter = adapterWith(api);
    await synth(adapter);
    await synth(adapter, { voice: "  " }, "");
    await synth(adapter, { speed: 1, response_format: "audio/mpeg" });
    expect(api.calls.map((c) => [bodyOf(c).model, bodyOf(c).input.voice, bodyOf(c).parameters.format])).toEqual([
      [MODEL, "longanlingxin", "mp3"], [MODEL, "longanlingxin", "mp3"], [MODEL, "longanlingxin", "mp3"],
    ]);
  });

  it("downloads an expiring audio URL without the key, redirects or the API transport", async () => {
    const api = transport(linked(AUDIO_URL, { usage: { characters: 12 } }));
    const download = transport(audio(MP3));
    const result = await synth(adapterWith(api, download));
    expect(api.calls).toHaveLength(1);
    expect(download.calls).toHaveLength(1);
    expect(download.calls[0].url).toBe(AUDIO_URL);
    expect(download.calls[0].init.method).toBe("GET");
    expect(download.calls[0].init.redirect).toBe("manual");
    expect(download.calls[0].init.dispatcher).toBeDefined();
    expect(JSON.stringify(download.calls[0].init.headers)).not.toContain(KEY_A);
    expect(download.calls[0].init.headers).toEqual({ Accept: "audio/*" });
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(result.accounting.nativeUnits).toEqual({ characters: 12 });
    expectNoLeak(result);
  });

  it("prefers inline data over a URL, as the source does", async () => {
    const api = transport(json({ output: { audio: { data: MP3.toString("base64"), url: AUDIO_URL } } }));
    const download = transport();
    const result = await synth(adapterWith(api, download));
    expect(download.fetchImpl).not.toHaveBeenCalled();
    expect(result.format).toBe("mp3");
  });

  it("ignores a connection base URL override and forwards the connection egress policy", async () => {
    const api = transport(inline());
    const proxied = { ...CRED_A, baseUrl: "https://evil.invalid", providerSpecificData: { baseUrl: "https://evil.invalid/api/v1", region: "Singapore", connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" } };
    await synth(adapterWith(api), {}, MODEL, proxied);
    expect(api.calls[0].url).toBe(SPEECH_URL);
    expect(api.calls[0].proxyOptions).toBeTypeOf("object");
  });

  it("keeps two credentials isolated, also when their requests overlap", async () => {
    const api = transport(
      async () => { await new Promise((r) => setTimeout(r, 10)); return linked(AUDIO_URL); },
      () => linked(AUDIO_URL_B),
    );
    const download = transport((url) => audio(url === AUDIO_URL ? MP3 : MP3_FRAME), (url) => audio(url === AUDIO_URL ? MP3 : MP3_FRAME));
    const adapter = adapterWith(api, download);
    const [a, b] = await Promise.all([synth(adapter, {}, MODEL, CRED_A), synth(adapter, {}, MODEL, CRED_B)]);
    expect(api.calls.map((c) => headersOf(c).Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    expect(Buffer.from(a.base64, "base64").equals(MP3)).toBe(true);
    expect(Buffer.from(b.base64, "base64").equals(MP3_FRAME)).toBe(true);
    for (const call of download.calls) expect(JSON.stringify(call.init)).not.toMatch(/SYNTHETIC-qct/);
  });

  it("refuses a connection naming another region before anything is sent", async () => {
    const api = transport();
    for (const region of ["china-beijing", "cn", "eu-central-1", 7]) {
      const result = await synth(adapterWith(api), {}, MODEL, { ...CRED_A, providerSpecificData: { region } });
      expect(result).toMatchObject({ success: false, status: 400, local: true });
    }
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["an unsupported response_format", { response_format: "wav" }, /mp3 only/],
    ["an IANA wav format from the query", { requestedResponseFormat: "audio/wav" }, /mp3 only/],
    ["streaming", { stream: true }, /streaming/],
    ["a stream_format", { stream_format: "sse" }, /streaming/],
    ["a speed", { speed: 1.5 }, /speed/],
    ["instructions", { instructions: "cheerful" }, /instructions/],
    ["a language hint", { language: "zh" }, /language/],
    ["a non-string voice", { voice: 3 }, /voice must be a string/],
  ])("refuses %s before submit", async (_name, options, message) => {
    const api = transport();
    const result = await synth(adapterWith(api), options);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(JSON.stringify(result)).toMatch(message);
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses unknown models, a model/voice suffix, empty input, an oversized body and a missing or unsafe key before submit", async () => {
    const api = transport();
    const adapter = adapterWith(api);
    expect(await synth(adapter, {}, "qwen3-tts-flash")).toMatchObject({ status: 400, local: true });
    expect(await synth(adapter, {}, "qwen3.8-max")).toMatchObject({ status: 400, local: true });
    expect(JSON.stringify(await synth(adapter, {}, `${MODEL}/longanlufeng`))).toContain("voice field");
    expect(await synth(adapter, {}, MODEL, CRED_A, "   ")).toMatchObject({ status: 400, local: true });
    expect(await synth(adapter, {}, MODEL, CRED_A, "x".repeat(300 * 1024))).toMatchObject({ status: 400, local: true });
    expect(await synth(adapter, {}, MODEL, {})).toMatchObject({ status: 401 });
    expect(await synth(adapter, {}, MODEL, { apiKey: "sk-a\r\nX-Evil: 1" })).toMatchObject({ status: 401 });
    expect(await synth(adapter, {}, MODEL, { accessToken: KEY_B })).toMatchObject({ status: 401 });
    expect(api.fetchImpl).not.toHaveBeenCalled();
    expect(() => buildDashscopeTtsRequest(MODEL, "hi", { voice: "v" })).not.toThrow();
    expect(normalizeDashscopeTtsFormat(undefined)).toBe("mp3");
    expect(normalizeDashscopeTtsFormat("JSON")).toBe("mp3");
    expect(normalizeDashscopeTtsFormat("opus")).toBeNull();
  });
});

describe("DashScope speech failures", () => {
  it.each([[401, 401], [403, 403], [400, 400], [404, 404], [422, 422]])(
    "maps HTTP %i to %i without quoting DashScope or accepting a job",
    async (status, expected) => {
      const api = transport(leaky(status));
      const result = await synth(adapterWith(api));
      expect(result).toMatchObject({ success: false, status: expected });
      expect(result.acceptedJob).toBeUndefined();
      expect(JSON.stringify(result)).toContain("InvalidParameter");
      expectNoLeak(result);
    },
  );

  it.each([[400, "Arrearage"], [403, "AccessDenied.Unpurchased"], [402, "InsufficientBalance"]])(
    "marks HTTP %i %s as quota exhausted on this connection only",
    async (status, code) => {
      const api = transport(leaky(status, {}, code));
      const result = await synth(adapterWith(api));
      expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
      expect(result.acceptedJob).toBeUndefined();
      expectNoLeak(result);
    },
  );

  it("keeps a bounded Retry-After on 429 and 503", async () => {
    const api = transport(leaky(429, { "retry-after": "7" }, "Throttling.RateQuota"), leaky(503, { "retry-after": "3" }));
    const adapter = adapterWith(api);
    const limited = await synth(adapter);
    const unavailable = await synth(adapter);
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(unavailable).toMatchObject({ success: false, status: 503 });
    expect(limited.acceptedJob).toBeUndefined();
    expect(unavailable.acceptedJob).toBeUndefined();
    expectNoLeak(limited);
  });

  it("treats other 5xx as an uncertain, never-replayed job with unknown cost", async () => {
    const api = transport(leaky(500));
    const result = await synth(adapterWith(api));
    expect(api.calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(result);
  });

  it("refuses a redirect without following it or resending the key", async () => {
    const api = transport(new Response(null, { status: 307, headers: { location: "https://evil.invalid/steal" } }));
    const result = await synth(adapterWith(api));
    expect(api.calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("distinguishes a provably unsent connect failure from a failure after send", async () => {
    const api = transport(transportError("ENOTFOUND"), transportError("ECONNRESET"));
    const adapter = adapterWith(api);
    const unsent = await synth(adapter);
    const reset = await synth(adapter);
    expect(api.calls).toHaveLength(2);
    expect(unsent).toMatchObject({ success: false, status: 502 });
    expect(unsent.acceptedJob).toBeUndefined();
    expect(reset).toMatchObject({ success: false, status: 502 });
    expect(reset.acceptedJob.meta.jobState).toBe("submit-unknown");
    expectNoLeak(unsent);
    expectNoLeak(reset);
  });

  it("does not send when the caller already left", async () => {
    const api = transport();
    const controller = new AbortController();
    controller.abort();
    const result = await synth(adapterWith(api), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });

  it("stops waiting when the caller aborts after send and records the job as uncertain", async () => {
    const controller = new AbortController();
    let seenSignal;
    const api = transport((_url, init) => {
      seenSignal = init.signal;
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await synth(adapterWith(api), { signal: controller.signal });
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("aborts the transport signal and ends at the deadline even when fetch ignores it", async () => {
    let seenSignal;
    const api = transport((_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const result = await synth(adapterWith(api, transport(), { timeoutMs: 20 }));
    expect(api.calls).toHaveLength(1);
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("bounds a stalled JSON body by the same deadline as accepted work", async () => {
    const result = await synth(adapterWith(transport(stalled()), transport(), { timeoutMs: 30 }));
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("records a caller abort during the body read as accepted work", async () => {
    const controller = new AbortController();
    const api = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return stalled();
    });
    const result = await synth(adapterWith(api), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("DashScope speech 200 answers and result downloads", () => {
  it("reads a 200 { code, message } as a refusal without quoting it, as the source does", async () => {
    const api = transport(leaky(200), leaky(200, {}, "Arrearage"), json({ code: "<script>bad</script>", message: "x" }));
    const adapter = adapterWith(api);
    const failed = await synth(adapter);
    const unpaid = await synth(adapter);
    const odd = await synth(adapter);
    expect(failed).toMatchObject({ success: false, status: 502 });
    expect(JSON.stringify(failed)).toContain("InvalidParameter");
    expect(failed.acceptedJob).toBeUndefined();
    expect(unpaid).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(odd).toMatchObject({ success: false, status: 502 });
    expect(JSON.stringify(odd)).not.toContain("script");
    for (const result of [failed, unpaid, odd]) expectNoLeak(result);
  });

  it.each([
    ["no audio", json({ output: { audio: { data: "", url: "" } } }), /no audio/],
    ["no output", json({ request_id: "r" }), /no audio/],
    ["invalid JSON", new Response("not json", { status: 200, headers: { "content-type": "application/json" } }), /JSON audio payload/],
    ["a non-object JSON", json([1, 2]), /JSON audio payload/],
    ["non-base64 audio", json({ output: { audio: { data: "@@not-base64@@" } } }), /not base64/],
    ["non-mp3 inline audio", inline(WAV), /not an mp3/],
    ["an http audio URL", linked("http://93.184.216.34/a.mp3"), /not https/],
    ["a private audio URL", linked("https://127.0.0.1/a.mp3"), /not https/],
    ["a metadata audio URL", linked("https://169.254.169.254/latest"), /not https/],
    ["a userinfo audio URL", linked(`https://user:${KEY_A}@93.184.216.34/a.mp3`), /not https/],
  ])("treats %s as a lost, accepted result and never fetches it", async (_name, answer, message) => {
    const download = transport();
    const result = await synth(adapterWith(transport(answer), download));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(JSON.stringify(result)).toMatch(message);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(download.fetchImpl).not.toHaveBeenCalled();
    expectNoLeak(result);
  });

  it.each([
    ["a download redirect", () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }), /returned 302|refused or failed/],
    ["a 403 download", () => new Response("denied", { status: 403 }), /returned 403/],
    ["a non-audio download", () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), /not audio/],
    ["a non-mp3 download", () => audio(WAV, "audio/wav"), /not an mp3/],
    ["an empty download", () => audio(Buffer.alloc(0)), /empty/],
    ["a failed download", () => transportError("ECONNRESET"), /refused or failed/],
  ])("keeps the accepted job and never replays the speech when the download yields %s", async (_name, step, message) => {
    const api = transport(linked());
    const download = transport(step);
    const result = await synth(adapterWith(api, download));
    expect(api.calls).toHaveLength(1);
    expect(download.calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false });
    expect(JSON.stringify(result)).toMatch(message);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expectNoLeak(result);
  });

  it("bounds the download size, the inline audio size and the download deadline", async () => {
    const big = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2048, 1)]);
    const sized = await synth(adapterWith(transport(linked()), transport(audio(big)), { maxAudioBytes: 1024 }));
    expect(sized).toMatchObject({ success: false, status: 502 });
    expect(sized.acceptedJob.meta.jobState).toBe("accepted");
    const inlineBig = await synth(adapterWith(transport(inline(big)), transport(), { maxAudioBytes: 1024 }));
    expect(inlineBig).toMatchObject({ success: false, status: 502 });
    expect(inlineBig.acceptedJob).toBeDefined();
    const slow = await synth(adapterWith(transport(linked()), transport(() => stalled("audio/mpeg", "ID3")), { downloadTimeoutMs: 30 }));
    expect(slow).toMatchObject({ success: false, status: 504 });
    expect(slow.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("records a caller abort during the download as accepted work", async () => {
    const controller = new AbortController();
    const download = transport((_url, init) => {
      setTimeout(() => controller.abort(), 5);
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    });
    const result = await synth(adapterWith(transport(linked()), download), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("does not read usage cost fields as a priced receipt; keeps token counts and reported characters once", async () => {
    const api = transport(inline(MP3, { usage: { characters: 9, input_tokens: 3, output_tokens: "7", cost_usd: 99, total_cost: 5 } }), inline(MP3, { usage: { characters: -1 } }));
    const adapter = adapterWith(api);
    const priced = await synth(adapter);
    expect(priced.accounting).toMatchObject({ cost: null, costStatus: "unknown", tokens: { input_tokens: 3 }, nativeUnits: { characters: 9 } });
    expect(priced.accounting.tokens.output_tokens).toBeUndefined();
    expect(JSON.stringify(priced.accounting)).not.toContain("99");
    const bogus = await synth(adapter);
    expect(bogus.accounting.nativeUnits).toEqual({});
    expect(bogus.accounting.meta.nativeUnitsSource).toBe("input-characters");
  });
});

describe("DashScope speech through handleTtsCore (test-local wiring)", () => {
  // Wires the adapter into TTS_ADAPTERS only for the duration of this test to
  // check the core contract (usage merge, json wrapper, binary body); the
  // registration state itself is asserted only in the staging block above.
  it("returns audio bytes with usage counted once, or the json wrapper, and keeps refusals local", async () => {
    const api = transport(inline(MP3, { usage: { characters: 11 } }), linked(), inline());
    const download = transport(audio(MP3_FRAME));
    const adapter = adapterWith(api, download);
    const key = "qwen-cloud-token-plan-test-wiring";
    TTS_ADAPTERS[key] = { adapter };
    try {
      const binary = await handleTtsCore({ provider: key, model: MODEL, input: " Hé llo ", credentials: CRED_A, responseFormat: "mp3" });
      expect(binary.success).toBe(true);
      expect(binary.response.headers.get("content-type")).toMatch(/^audio\/mp(eg|3)$/);
      expect(Buffer.from(await binary.response.arrayBuffer()).equals(MP3)).toBe(true);
      // The provider's own billed count wins over the local input count, and is not added to it.
      expect(binary.accounting).toMatchObject({ costStatus: "unknown", nativeUnits: { characters: 11 } });

      const downloaded = await handleTtsCore({ provider: key, model: MODEL, input: "Hi", credentials: CRED_B, responseFormat: "mp3" });
      expect(Buffer.from(await downloaded.response.arrayBuffer()).equals(MP3_FRAME)).toBe(true);
      expect(downloaded.accounting.nativeUnits).toEqual({ characters: 2 });

      const wrapped = await handleTtsCore({ provider: key, model: MODEL, input: "Hi", credentials: CRED_A, responseFormat: "json", requestedResponseFormat: "json" });
      expect(await wrapped.response.json()).toEqual({ audio: MP3.toString("base64"), format: "mp3" });

      const refused = await handleTtsCore({ provider: key, model: MODEL, input: "Hi", credentials: CRED_A, speed: 2 });
      expect(refused).toMatchObject({ success: false, status: 400, local: true });
      expect(api.fetchImpl).toHaveBeenCalledTimes(3);
      expect(download.fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      delete TTS_ADAPTERS[key];
    }
  });
});
