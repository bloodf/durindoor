// 503 accounting contract for the two staged, unregistered native audio
// adapters (#2034): HuggingFace speech and Gemini API Lyria music.
// Closed mocks only: every request goes to an injected transport, an
// unexpected request fails the test, and every key is synthetic. Passing here
// says nothing about the live services.
//
// Primary sources (public GET, read 2026-11-27); see
// internal/docs/port-reports/native-audio-503-contract.md:
// - Gemini API billing FAQ "Am I charged for failed, blocked, or canceled
//   requests?": "HTTP 4xx or 5xx error (request still counts against quota) |
//   Not billed | Not billed". Gemini API errors: 503 `service_unavailable`
//   "temporarily overloaded or down", "Wait and retry with exponential backoff".
//   So a Gemini 503 is a refusal by status alone: no accepted job.
// - HuggingFace Inference Providers pricing: hf-inference is "charged for every
//   inference request based on the compute time". No current HuggingFace doc
//   says a router 503 did no work or is not billed, and no structured
//   "not accepted" field is documented (huggingface.js only retries 503 by
//   default). So a HuggingFace 503 keeps status 503 and Retry-After but carries
//   an unknown-cost accepted job, and the body is never read to decide.
import { describe, expect, it, vi } from "vitest";

import { createHuggingFaceTtsAdapter } from "../../open-sse/services/providerParity/native-huggingface-tts/index.js";
import { handleGeminiMusicGeneration } from "../../open-sse/services/providerParity/native-google-music/index.js";

const HF_KEY_A = "hf_SYNTHETIC503aaaaaaaaaaaaaaaaaaaaaa01";
const HF_KEY_B = "hf_SYNTHETIC503bbbbbbbbbbbbbbbbbbbbbb02";
const G_KEY_A = "AIza-synthetic-503-alpha";
const G_KEY_B = "AIza-synthetic-503-bravo";
const HF_URL = "https://router.huggingface.co/hf-inference/models/hexgrad/Kokoro-82M";
const G_URL = "https://generativelanguage.googleapis.com/v1beta/models/lyria-3.5:generateContent";
const SECRET_TEXT = "secret-upstream-detail /srv/worker.js:12";

const jsonBody = (value, status, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

/** 503 bodies seen from each vendor, plus degenerate shapes. None may change the outcome. */
const BODIES_503 = {
  absent: (headers) => new Response(null, { status: 503, headers }),
  empty: (headers) => new Response("", { status: 503, headers }),
  malformed: (headers) => new Response(`{"error": "unterminated ${SECRET_TEXT}`, { status: 503, headers: { "content-type": "application/json", ...headers } }),
  html: (headers) => new Response(`<html><body>503 ${SECRET_TEXT}</body></html>`, { status: 503, headers: { "content-type": "text/html", ...headers } }),
  // Legacy hf-inference "model loading" shape: text plus estimated_time; not a documented contract.
  hfLoading: (headers) => jsonBody({ error: `Model hexgrad/Kokoro-82M is currently loading ${SECRET_TEXT}`, estimated_time: 20.5 }, 503, headers),
  // Google error envelope for an overloaded model.
  googleBusy: (headers) => jsonBody({ error: { code: 503, status: "UNAVAILABLE", message: `The model is overloaded. ${SECRET_TEXT}` } }, 503, headers),
  oversized: (headers) => new Response(`${SECRET_TEXT} ${"x".repeat(256 * 1024)}`, { status: 503, headers }),
};

/** A 503 whose body never finishes. */
const stalled503 = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`{"error":"${SECRET_TEXT}`)); } }), { status: 503, headers: { "content-type": "application/json" } });

function transport(...steps) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init, proxyOptions) => {
    calls.push({ url: String(url), init, proxyOptions });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return typeof step === "function" ? step(url, init) : step;
  });
  return { fetchImpl, calls };
}

const expectRedacted = (result, ...keys) => {
  const text = JSON.stringify(result);
  for (const key of keys) expect(text).not.toContain(key);
  expect(text).not.toContain("secret-upstream-detail");
  expect(text).not.toContain("/srv/worker.js");
  expect(text).not.toContain("currently loading");
  expect(text).not.toContain("overloaded");
};

const HF_ACCEPTED = { modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } };
const hfCred = (key = HF_KEY_A, connectionId = "hf-a") => ({ apiKey: key, connectionId });
const gCred = (key = G_KEY_A, connectionId = "g-a") => ({ apiKey: key, connectionId, providerSpecificData: {} });
const hfSynth = (fetchImpl, { cred = hfCred(), signal, timeoutMs } = {}) =>
  createHuggingFaceTtsAdapter({ fetchImpl, ...(timeoutMs ? { timeoutMs } : null) }).synthesize("Hello there.", "hexgrad/Kokoro-82M", cred, "mp3", { signal });
const gGenerate = (fetchImpl, { cred = gCred(), signal, totalTimeoutMs, now } = {}) =>
  handleGeminiMusicGeneration({ model: "lyria-3.5", body: { prompt: "calm piano" }, credentials: cred, signal, fetchImpl, ...(totalTimeoutMs ? { totalTimeoutMs } : null), ...(now ? { now } : null) });

describe("HuggingFace speech 503: no documented no-work guarantee, so an unknown-cost accepted job", () => {
  for (const [name, make] of Object.entries(BODIES_503)) {
    it(`503 with a ${name} body: one send, status 503, accepted job, Retry-After kept, nothing quoted`, async () => {
      const { fetchImpl, calls } = transport(make({ "retry-after": "5" }));
      const result = await hfSynth(fetchImpl);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(HF_URL);
      expect(calls[0].init).toMatchObject({ method: "POST", redirect: "manual", body: JSON.stringify({ inputs: "Hello there." }) });
      expect(result).toMatchObject({ success: false, status: 503 });
      expect(result.local).toBeUndefined();
      expect(result.quotaExhausted).toBeUndefined();
      expect(result.acceptedJob).toMatchObject(HF_ACCEPTED);
      expect(result.resetsAtMs).toBeGreaterThan(Date.now());
      expect(result.resetsAtMs).toBeLessThanOrEqual(Date.now() + 6_000);
      expectRedacted(result, HF_KEY_A);
    });
  }

  it("503 without Retry-After has no reset but is still an accepted job", async () => {
    const { fetchImpl } = transport(BODIES_503.hfLoading({}));
    const result = await hfSynth(fetchImpl);
    expect(result).toMatchObject({ success: false, status: 503 });
    expect(result.resetsAtMs ?? null).toBeNull();
    expect(result.acceptedJob).toMatchObject(HF_ACCEPTED);
  });

  it("a caller abort while a 503 body stalls stays a 503 accepted job, sent once", async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = transport(stalled503());
    const pending = hfSynth(fetchImpl, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    const result = await pending;
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 503 });
    expect(result.acceptedJob).toMatchObject(HF_ACCEPTED);
    expectRedacted(result, HF_KEY_A);
  });

  it("a stalled 503 body is bounded and stays a 503 accepted job", async () => {
    const { fetchImpl, calls } = transport(stalled503());
    const started = Date.now();
    const result = await hfSynth(fetchImpl, { timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 503 });
    expect(result.acceptedJob).toMatchObject(HF_ACCEPTED);
  });

  it("neighbouring statuses keep their classification: 429 no job, 500/502/504 unknown-cost 502", async () => {
    const { fetchImpl } = transport(jsonBody({ error: SECRET_TEXT }, 429, { "retry-after": "5" }), ...[500, 502, 504].map((s) => jsonBody({ error: SECRET_TEXT }, s)));
    const limited = await hfSynth(fetchImpl);
    expect(limited).toMatchObject({ status: 429 });
    expect(limited.acceptedJob).toBeUndefined();
    for (let i = 0; i < 3; i += 1) {
      const result = await hfSynth(fetchImpl);
      expect(result).toMatchObject({ status: 502 });
      expect(result.acceptedJob).toMatchObject(HF_ACCEPTED);
    }
  });

  it("two accounts stay isolated: each 503 is attributed to its own account and key only", async () => {
    const { fetchImpl, calls } = transport(BODIES_503.hfLoading({ "retry-after": "3" }), BODIES_503.absent({}));
    const a = await hfSynth(fetchImpl, { cred: hfCred(HF_KEY_A, "hf-a") });
    const b = await hfSynth(fetchImpl, { cred: hfCred(HF_KEY_B, "hf-b") });
    expect(calls).toHaveLength(2);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${HF_KEY_A}`);
    expect(calls[1].init.headers.Authorization).toBe(`Bearer ${HF_KEY_B}`);
    expect(JSON.stringify(calls[0])).not.toContain(HF_KEY_B);
    expect(JSON.stringify(calls[1])).not.toContain(HF_KEY_A);
    expect(a.acceptedJob).toMatchObject(HF_ACCEPTED);
    expect(b.acceptedJob).toMatchObject(HF_ACCEPTED);
    expect(a.resetsAtMs).toBeGreaterThan(Date.now());
    expect(b.resetsAtMs ?? null).toBeNull();
    expectRedacted(a, HF_KEY_A, HF_KEY_B);
    expectRedacted(b, HF_KEY_A, HF_KEY_B);
  });
});

describe("Gemini Lyria 503: documented as not billed by status alone, so a refusal without a job", () => {
  for (const [name, make] of Object.entries(BODIES_503)) {
    it(`503 with a ${name} body: one send, status 503, refused, Retry-After kept, enum only`, async () => {
      const { fetchImpl, calls } = transport(make({ "retry-after": "5" }));
      const result = await gGenerate(fetchImpl, { now: () => 1_000_000 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(G_URL);
      expect(calls[0].init).toMatchObject({ method: "POST", redirect: "manual" });
      expect(result).toMatchObject({ status: 503, outcome: "refused", connectionId: "g-a" });
      expect(result.acceptedJob).toBeUndefined();
      expect(result.resetsAtMs).toBe(1_005_000);
      expect(result.error).toBe(name === "googleBusy"
        ? "Gemini Lyria refused the request (HTTP 503 UNAVAILABLE)"
        : "Gemini Lyria refused the request (HTTP 503)");
      expectRedacted(result, G_KEY_A);
      expect(await result.response.text()).not.toContain("secret-upstream-detail");
    });
  }

  it("a caller abort while a 503 body stalls stays a refused 503 without a job, sent once", async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = transport(stalled503());
    const pending = gGenerate(fetchImpl, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    const result = await pending;
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ status: 503, outcome: "refused" });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("a stalled 503 body is bounded by the deadline and stays a refused 503", async () => {
    const { fetchImpl, calls } = transport(stalled503());
    const result = await gGenerate(fetchImpl, { totalTimeoutMs: 30 });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ status: 503, outcome: "refused" });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("neighbouring statuses keep their classification: 429 refused, 500/502/504 unknown-cost 502", async () => {
    for (const status of [500, 502, 504]) {
      const { fetchImpl } = transport(jsonBody({ error: { status: "INTERNAL", message: SECRET_TEXT } }, status));
      const result = await gGenerate(fetchImpl);
      expect(result).toMatchObject({ status: 502, outcome: "outcome_unknown" });
      expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, meta: { jobState: "submit_outcome_unknown", httpStatus: status } });
    }
    const { fetchImpl } = transport(jsonBody({ error: { status: "RESOURCE_EXHAUSTED" } }, 429));
    const limited = await gGenerate(fetchImpl);
    expect(limited).toMatchObject({ status: 429, outcome: "refused" });
    expect(limited.acceptedJob).toBeUndefined();
  });

  it("two accounts stay isolated: each 503 is attributed to its own connection and key only", async () => {
    const { fetchImpl, calls } = transport(BODIES_503.googleBusy({ "retry-after": "3" }), BODIES_503.absent({}));
    const a = await gGenerate(fetchImpl, { cred: gCred(G_KEY_A, "g-a"), now: () => 1_000_000 });
    const b = await gGenerate(fetchImpl, { cred: gCred(G_KEY_B, "g-b"), now: () => 1_000_000 });
    expect(calls).toHaveLength(2);
    expect(calls[0].init.headers["x-goog-api-key"]).toBe(G_KEY_A);
    expect(calls[1].init.headers["x-goog-api-key"]).toBe(G_KEY_B);
    expect(JSON.stringify(calls[0].init)).not.toContain(G_KEY_B);
    expect(JSON.stringify(calls[1].init)).not.toContain(G_KEY_A);
    expect(a).toMatchObject({ status: 503, connectionId: "g-a", resetsAtMs: 1_003_000 });
    expect(b).toMatchObject({ status: 503, connectionId: "g-b" });
    expect(b.resetsAtMs ?? null).toBeNull();
    expect(a.acceptedJob).toBeUndefined();
    expect(b.acceptedJob).toBeUndefined();
    expectRedacted(a, G_KEY_A, G_KEY_B);
    expectRedacted(b, G_KEY_A, G_KEY_B);
  });
});
