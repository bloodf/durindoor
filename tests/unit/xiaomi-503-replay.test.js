// Xiaomi speech 503 regression (#2034). Closed synthetic mocks only.
// Reuses the private-audio-503-replay.test.js account-loop regression pattern.
import { beforeEach, describe, expect, it, vi } from "vitest";

const markAccountUnavailable = vi.fn(async () => ({ shouldFallback: true, cooldownMs: 0 }));
vi.mock("../../src/sse/services/auth.js", () => ({
  markAccountUnavailable: (...args) => markAccountUnavailable(...args),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async () => null),
}));

const { createXiaomiMimoTtsAdapter, discoverXiaomiMimoTtsModels } = await import("../../open-sse/services/providerParity/native-xiaomi-tts/index.js");
const { runMediaAccounts } = await import("../../src/sse/handlers/media/pipeline.js");

const SECRET_TEXT = "secret-upstream-detail /srv/worker.js:12";
const jsonBody = (value, status, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

/** 503 bodies seen from each vendor, plus degenerate shapes. None may change the outcome. */
const BODIES_503 = {
  absent: (headers) => new Response(null, { status: 503, headers }),
  empty: (headers) => new Response("", { status: 503, headers }),
  malformed: (headers) => new Response(`{"err_msg": "unterminated ${SECRET_TEXT}`, { status: 503, headers: { "content-type": "application/json", ...headers } }),
  html: (headers) => new Response(`<html><body>503 ${SECRET_TEXT}</body></html>`, { status: 503, headers: { "content-type": "text/html", ...headers } }),
  // Alternate error envelope; no body is proof of no work.
  deepgram: (headers) => jsonBody({ err_code: "SERVICE_UNAVAILABLE", err_msg: `Please try again later. ${SECRET_TEXT}`, request_id: "req-1" }, 503, headers),
  // Alternate status/message envelope.
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

const VENDORS = [{
  name: "Xiaomi MiMo", provider: "xiaomi-mimo",
  url: "https://api.xiaomimimo.com/v1/chat/completions",
  keys: ["sk-SYNTHETIC-xiaomi-a", "sk-SYNTHETIC-xiaomi-b"],
  auth: (key) => `Bearer ${key}`,
  body: JSON.stringify({ model: "mimo-v2.5-tts", messages: [{ role: "assistant", content: "Hello there." }], audio: { format: "mp3", voice: "mimo_default" } }),
  synth: (fetchImpl, { cred, signal, timeoutMs } = {}) =>
    createXiaomiMimoTtsAdapter({ fetchImpl, ...(timeoutMs ? { timeoutMs } : null) })
      .synthesize("Hello there.", "mimo-v2.5-tts", cred ?? { apiKey: "sk-SYNTHETIC-xiaomi-a", connectionId: "acct-a" }, "mp3", { signal }),
  discover: (fetchImpl) => discoverXiaomiMimoTtsModels({ apiKey: "sk-SYNTHETIC-xiaomi-a" }, { fetchImpl }),
}];

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

    it("quota and explicit client refusals remain unaccepted and sanitized", async () => {
      for (const status of [400, 401, 402, 403, 404, 422, 429]) {
        const { fetchImpl, calls } = transport(jsonBody({ error: { message: SECRET_TEXT } }, status));
        const result = await vendor.synth(fetchImpl);
        expect(result.status).toBe(status);
        expect(result.acceptedJob).toBeUndefined();
        expect(result.quotaExhausted === true).toBe(status === 402);
        expect(calls).toHaveLength(1);
        expectRedacted(result, KEY_A, KEY_B);
      }
    });

    it("invalid Retry-After is ignored and excessive delay is bounded", async () => {
      for (const value of ["invalid", "999999999999"]) {
        const { fetchImpl } = transport(BODIES_503.absent({ "retry-after": value }));
        const result = await vendor.synth(fetchImpl);
        expect(result.status).toBe(503);
        expect(result.acceptedJob).toMatchObject(ACCEPTED);
        if (value === "invalid") expect(result.resetsAtMs ?? null).toBeNull();
        else expect(result.resetsAtMs ?? 0).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000);
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

  it("discovery 503 is a free GET with catalog fallback and no accepted job", async () => {
    const { fetchImpl, calls } = transport(BODIES_503.html({ "retry-after": "5" }));
    const result = await vendor.discover(fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("GET");
    expect(result).toMatchObject({ source: "local_catalog", status: 503 });
    expect(result.acceptedJob).toBeUndefined();
    expectRedacted(result, KEY_A, KEY_B);
  });
}
