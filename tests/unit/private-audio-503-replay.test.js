// 503 replay contract for the staged, unregistered Deepgram and Fish Audio
// speech adapters (#2034). Closed mocks only: every request goes to an
// injected transport, an unexpected request fails the test, and every key is
// synthetic. Passing here says nothing about the live services.
//
// Primary sources (public GET, read 2026-11-27); see
// internal/docs/port-reports/native-deepgram-tts.md and
// internal/docs/port-reports/native-fishaudio-tts.md:
// - Deepgram errors reference (developers.deepgram.com/reference/errors):
//   "503 Service Unavailable: The server isn't ready to handle the request.
//   Common causes include a server that is down for maintenance or is
//   overloaded." The TTS 503 example says "Please try again later". Neither
//   that page nor the pricing page says a 503 did no work or is not billed.
// - Fish Audio errors reference (docs.fish.audio/api-reference/errors): 5xx is
//   "Server error", "Retry with backoff", and edge 5xx "may not be JSON". The
//   pricing page says error responses are not billed only for file ASR and
//   Voice Design; its TTS section says nothing about failed requests.
// No vendor proves a speech 503 was unaccepted and unbilled, so a speech 503
// keeps status 503 and Retry-After but carries an unknown-cost accepted job,
// and the gateway's account loop never replays it on another account. Free
// discovery reads keep a plain 503.
import { beforeEach, describe, expect, it, vi } from "vitest";

const markAccountUnavailable = vi.fn(async () => ({ shouldFallback: true, cooldownMs: 0 }));
vi.mock("../../src/sse/services/auth.js", () => ({
  markAccountUnavailable: (...args) => markAccountUnavailable(...args),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async () => null),
}));

const { createDeepgramTtsAdapter, listDeepgramTtsModels } = await import("../../open-sse/services/providerParity/native-deepgram-tts/index.js");
const { createFishAudioTtsAdapter, createFishAudioVoiceLister } = await import("../../open-sse/services/providerParity/native-fishaudio-tts/index.js");
const { runMediaAccounts } = await import("../../src/sse/handlers/media/pipeline.js");

const SECRET_TEXT = "secret-upstream-detail /srv/worker.js:12";
const DG_KEY_A = "dg-SYNTHETIC-503-alpha-0001";
const DG_KEY_B = "dg-SYNTHETIC-503-bravo-0002";
const FISH_KEY_A = "fish-SYNTHETIC-503-alpha-0001";
const FISH_KEY_B = "fish-SYNTHETIC-503-bravo-0002";
const DG_URL = "https://api.deepgram.com/v1/speak?model=aura-asteria-en";
const FISH_URL = "https://api.fish.audio/v1/tts";

const jsonBody = (value, status, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

/** 503 bodies seen from each vendor, plus degenerate shapes. None may change the outcome. */
const BODIES_503 = {
  absent: (headers) => new Response(null, { status: 503, headers }),
  empty: (headers) => new Response("", { status: 503, headers }),
  malformed: (headers) => new Response(`{"err_msg": "unterminated ${SECRET_TEXT}`, { status: 503, headers: { "content-type": "application/json", ...headers } }),
  html: (headers) => new Response(`<html><body>503 ${SECRET_TEXT}</body></html>`, { status: 503, headers: { "content-type": "text/html", ...headers } }),
  // Deepgram's documented TTS 503 example shape.
  deepgram: (headers) => jsonBody({ err_code: "SERVICE_UNAVAILABLE", err_msg: `Please try again later. ${SECRET_TEXT}`, request_id: "req-1" }, 503, headers),
  // Fish's documented error shape (message + status).
  fish: (headers) => jsonBody({ status: 503, message: `Service unavailable ${SECRET_TEXT}` }, 503, headers),
  oversized: (headers) => new Response(`${SECRET_TEXT} ${"x".repeat(256 * 1024)}`, { status: 503, headers }),
};

const stalled503 = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`{"err_msg":"${SECRET_TEXT}`)); } }), { status: 503, headers: { "content-type": "application/json" } });

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
  expect(text).not.toContain("try again later");
};

const ACCEPTED = { modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } };

const VENDORS = [
  {
    name: "Deepgram",
    provider: "deepgram",
    url: DG_URL,
    keys: [DG_KEY_A, DG_KEY_B],
    auth: (key) => `Token ${key}`,
    body: JSON.stringify({ text: "Hello there." }),
    synth: (fetchImpl, { cred, signal, timeoutMs } = {}) =>
      createDeepgramTtsAdapter({ fetchImpl, ...(timeoutMs ? { timeoutMs } : null) })
        .synthesize("Hello there.", "aura-asteria-en", cred ?? { apiKey: DG_KEY_A, connectionId: "dg-a" }, "mp3", { signal }),
    discover: (fetchImpl) => listDeepgramTtsModels({ apiKey: DG_KEY_A, connectionId: "dg-a" }, { fetchImpl }),
  },
  {
    name: "Fish Audio",
    provider: "fish-audio",
    url: FISH_URL,
    keys: [FISH_KEY_A, FISH_KEY_B],
    auth: (key) => `Bearer ${key}`,
    body: JSON.stringify({ text: "Hello there.", format: "mp3" }),
    synth: (fetchImpl, { cred, signal, timeoutMs } = {}) =>
      createFishAudioTtsAdapter({ fetchImpl, ...(timeoutMs ? { timeoutMs } : null) })
        .synthesize("Hello there.", "s2.1-pro-free", cred ?? { apiKey: FISH_KEY_A, connectionId: "fish-a" }, "mp3", { signal }),
    discover: (fetchImpl) => createFishAudioVoiceLister({ fetchImpl })({ apiKey: FISH_KEY_A, connectionId: "fish-a" }, {}),
  },
];

beforeEach(() => markAccountUnavailable.mockClear());

for (const vendor of VENDORS) {
  const [KEY_A, KEY_B] = vendor.keys;
  const cred = (key, connectionId) => ({ apiKey: key, connectionId });

  describe(`${vendor.name} speech 503: no documented no-work guarantee, so an unknown-cost accepted job`, () => {
    for (const [name, make] of Object.entries(BODIES_503)) {
      it(`503 with a ${name} body: one send, status 503, accepted job, Retry-After kept, nothing quoted`, async () => {
        const { fetchImpl, calls } = transport(make({ "retry-after": "5" }));
        const result = await vendor.synth(fetchImpl);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(vendor.url);
        expect(calls[0].init).toMatchObject({ method: "POST", redirect: "manual", body: vendor.body });
        expect(result).toMatchObject({ success: false, status: 503 });
        expect(result.local).toBeUndefined();
        expect(result.quotaExhausted).toBeUndefined();
        expect(result.acceptedJob).toMatchObject(ACCEPTED);
        expect(result.resetsAtMs).toBeGreaterThan(Date.now());
        expect(result.resetsAtMs).toBeLessThanOrEqual(Date.now() + 6_000);
        expectRedacted(result, KEY_A);
      });
    }

    it("503 with an HTTP-date Retry-After keeps that reset and the accepted job", async () => {
      const at = new Date(Date.now() + 60_000).toUTCString();
      const { fetchImpl } = transport(BODIES_503.absent({ "retry-after": at }));
      const result = await vendor.synth(fetchImpl);
      expect(result).toMatchObject({ success: false, status: 503 });
      expect(result.resetsAtMs).toBeGreaterThan(Date.now() + 30_000);
      expect(result.acceptedJob).toMatchObject(ACCEPTED);
    });

    it("503 without Retry-After has no reset but is still an accepted job", async () => {
      const { fetchImpl } = transport(BODIES_503.absent({}));
      const result = await vendor.synth(fetchImpl);
      expect(result).toMatchObject({ success: false, status: 503 });
      expect(result.resetsAtMs ?? null).toBeNull();
      expect(result.acceptedJob).toMatchObject(ACCEPTED);
    });

    it("a caller abort while a 503 body stalls stays a 503 accepted job, sent once", async () => {
      const controller = new AbortController();
      const { fetchImpl, calls } = transport(stalled503());
      const pending = vendor.synth(fetchImpl, { signal: controller.signal });
      await new Promise((r) => setTimeout(r, 10));
      controller.abort();
      const result = await pending;
      expect(calls).toHaveLength(1);
      expect(result).toMatchObject({ success: false, status: 503 });
      expect(result.acceptedJob).toMatchObject(ACCEPTED);
      expectRedacted(result, KEY_A);
    });

    it("a stalled 503 body is bounded and stays a 503 accepted job", async () => {
      const { fetchImpl, calls } = transport(stalled503());
      const started = Date.now();
      const result = await vendor.synth(fetchImpl, { timeoutMs: 50 });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(calls).toHaveLength(1);
      expect(result).toMatchObject({ success: false, status: 503 });
      expect(result.acceptedJob).toMatchObject(ACCEPTED);
    });

    it("neighbouring statuses keep their classification: 429 no job, 500/502/504 unknown-cost 502", async () => {
      const { fetchImpl } = transport(jsonBody({ message: SECRET_TEXT }, 429, { "retry-after": "5" }), ...[500, 502, 504].map((s) => jsonBody({ message: SECRET_TEXT }, s)));
      const limited = await vendor.synth(fetchImpl);
      expect(limited).toMatchObject({ status: 429 });
      expect(limited.acceptedJob).toBeUndefined();
      for (let i = 0; i < 3; i += 1) {
        const result = await vendor.synth(fetchImpl);
        expect(result).toMatchObject({ status: 502 });
        expect(result.acceptedJob).toMatchObject(ACCEPTED);
      }
    });

    it("two accounts stay isolated: each 503 is attributed to its own key only", async () => {
      const { fetchImpl, calls } = transport(BODIES_503.absent({ "retry-after": "3" }), BODIES_503.absent({}));
      const a = await vendor.synth(fetchImpl, { cred: cred(KEY_A, "acct-a") });
      const b = await vendor.synth(fetchImpl, { cred: cred(KEY_B, "acct-b") });
      expect(calls).toHaveLength(2);
      expect(calls[0].init.headers.Authorization).toBe(vendor.auth(KEY_A));
      expect(calls[1].init.headers.Authorization).toBe(vendor.auth(KEY_B));
      expect(JSON.stringify(calls[0])).not.toContain(KEY_B);
      expect(JSON.stringify(calls[1])).not.toContain(KEY_A);
      expect(a.acceptedJob).toMatchObject(ACCEPTED);
      expect(b.acceptedJob).toMatchObject(ACCEPTED);
      expect(a.resetsAtMs).toBeGreaterThan(Date.now());
      expect(b.resetsAtMs ?? null).toBeNull();
      expectRedacted(a, KEY_A, KEY_B);
      expectRedacted(b, KEY_A, KEY_B);
    });

    it("the media account loop records the 503 on the first account and never replays it on a second", async () => {
      const { fetchImpl, calls } = transport(BODIES_503.absent({ "retry-after": "5" }));
      const accounts = [cred(KEY_A, "acct-a"), cred(KEY_B, "acct-b")];
      const selectCredentials = vi.fn(async (excluded) => accounts.find((c) => !excluded.has(c.connectionId)) ?? null);
      const recorded = [];
      const response = await runMediaAccounts({
        provider: vendor.provider,
        model: "m",
        selectCredentials,
        runAttempt: async (credentials) => ({ result: await vendor.synth(fetchImpl, { cred: credentials }) }),
        // Same rule as src/sse/handlers/tts.js: an accepted job ends the loop on this account.
        onAccountFailure: (result, credentials) => {
          if (!result.acceptedJob) return null;
          recorded.push({ connectionId: credentials.connectionId, status: result.status, acceptedJob: result.acceptedJob });
          return new Response(null, { status: result.status });
        },
        buildExhaustedResponse: () => new Response(null, { status: 599 }),
      });
      expect(response.status).toBe(503);
      expect(calls).toHaveLength(1);
      expect(calls[0].init.headers.Authorization).toBe(vendor.auth(KEY_A));
      expect(selectCredentials).toHaveBeenCalledTimes(1);
      expect(markAccountUnavailable).toHaveBeenCalledTimes(1);
      expect(markAccountUnavailable.mock.calls[0][0]).toBe("acct-a");
      expect(markAccountUnavailable.mock.calls[0][1]).toBe(503);
      expect(recorded).toEqual([{ connectionId: "acct-a", status: 503, acceptedJob: expect.objectContaining(ACCEPTED) }]);
    });
  });

  describe(`${vendor.name} discovery 503: a free read, so a plain 503 without a job`, () => {
    it("keeps status 503 and Retry-After and carries no accepted job", async () => {
      const { fetchImpl, calls } = transport(BODIES_503.absent({ "retry-after": "5" }));
      const result = await vendor.discover(fetchImpl);
      expect(calls).toHaveLength(1);
      expect(result).toMatchObject({ success: false, status: 503 });
      expect(result.resetsAtMs).toBeGreaterThan(Date.now());
      expect(result.acceptedJob).toBeUndefined();
      expectRedacted(result, KEY_A);
    });
  });
}
