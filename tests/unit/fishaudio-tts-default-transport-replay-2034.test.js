// Transport replay guard for the staged, unregistered Fish Audio speech adapter
// (#2034). Each test drives the adapter's default production transport, the
// real proxyAwareFetch, and captures every physical send with a mocked
// transport and proxy dispatcher: no real proxy, socket or network, and every
// key is synthetic. The selected connection uses a legacy (best-effort,
// non-strict) proxy, where proxyAwareFetch would otherwise resend a replayable
// JSON body directly after a proxy failure whose outcome is unknown. The
// billable speech POST must go out once; the free voice-discovery GET keeps its
// existing transport behavior.
import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
} from "../../open-sse/utils/proxyFetch.js";
import {
  FISH_AUDIO_TTS_URL,
  FISH_AUDIO_VOICES_URL,
  createFishAudioTtsAdapter,
  createFishAudioVoiceLister,
  fishAudioTtsAdapter,
  listFishAudioVoices,
} from "../../open-sse/services/providerParity/native-fishaudio-tts/index.js";

const PROXY_A = "http://legacy-proxy-a.invalid:8080";
const PROXY_B = "http://legacy-proxy-b.invalid:8080";
const KEY_A = "fish-SYNTHETIC-a-0001";
const KEY_B = "fish-SYNTHETIC-b-0002";
const TEXT = "Hello from the gate.";
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);

const legacyProxy = (proxyUrl) => ({ proxyMode: "legacy", connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, strictProxy: false });
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a", providerSpecificData: legacyProxy(PROXY_A) };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b", providerSpecificData: legacyProxy(PROXY_B) };
const CRED_DIRECT = { apiKey: KEY_A, connectionId: "conn-a", providerSpecificData: { disableEnvProxy: true } };

const audio = () => new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const voices = () => json({ total: 0, items: [] });
const transportError = (code, message = "fetch failed") =>
  Object.assign(new TypeError(message), { cause: Object.assign(new Error(`socket ${code}`), { code }) });
// A 2xx whose body fails after the headers arrived.
const brokenBody = () => new Response(new ReadableStream({
  start(controller) { controller.error(transportError("ECONNRESET", "terminated")); },
}), { status: 200, headers: { "content-type": "audio/mpeg" } });

let dispatchers;
let sends;
let steps;
let restoreFetch;

// The physical transport under proxyAwareFetch. A send carrying a fixture proxy
// dispatcher is that proxy's leg; any other dispatcher is the direct leg.
const transport = vi.fn(async (url, init) => {
  const leg = Object.entries(dispatchers).find(([, d]) => d === init?.dispatcher)?.[0] ?? "direct";
  sends.push({ url: String(url), init, leg });
  const step = steps.shift();
  if (!step) throw new Error(`Unexpected physical send: ${url}`);
  return typeof step === "function" ? step(String(url), init) : step;
});
const serve = (...list) => { steps = list; };
const reject = (error) => () => Promise.reject(error);
// A stalled socket that settles only on abort.
const hang = () => (_url, init) => new Promise((_, rejectSend) => {
  init.signal.addEventListener("abort", () => rejectSend(init.signal.reason), { once: true });
});
// Let any late fallback that proxyAwareFetch might start after the adapter returned show up.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  sends = [];
  steps = [];
  transport.mockClear();
  dispatchers = { proxyA: { dispatch: vi.fn() }, proxyB: { dispatch: vi.fn() } };
  restoreFetch = __setOriginalFetchForTesting(transport);
  __setProxyDispatcherForTesting(PROXY_A, dispatchers.proxyA);
  __setProxyDispatcherForTesting(PROXY_B, dispatchers.proxyB);
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  restoreFetch();
  __clearProxyDispatchersForTesting();
  vi.restoreAllMocks();
});

const speak = (adapter, credentials = CRED_A, options = {}) => adapter.synthesize(TEXT, "s1", credentials, "mp3", options);
const legs = () => sends.map((s) => s.leg);

const expectUnknownCost = (result, jobState = "submit-unknown") => {
  expect(result.success).not.toBe(true);
  expect(result.base64).toBeUndefined();
  expect(result.accounting).toBeUndefined();
  expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, costStatus: "unknown", modality: "tts", meta: { jobState } });
  expect(result.acceptedJob.tokens).toEqual({});
};

describe("Fish Audio speech default transport", () => {
  it("sends once through the selected proxy with unchanged URL, headers, body and redirect policy", async () => {
    serve(audio());
    const result = await speak(fishAudioTtsAdapter);
    expect(result.base64).toBe(MP3.toString("base64"));
    expect(result.format).toBe("mp3");
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown" });
    expect(result.acceptedJob).toBeUndefined();
    expect(legs()).toEqual(["proxyA"]);
    const [send] = sends;
    expect(send.url).toBe(FISH_AUDIO_TTS_URL);
    expect(send.init.method).toBe("POST");
    expect(send.init.redirect).toBe("manual");
    expect(send.init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(send.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY_A}`);
    expect(headers.get("model")).toBe("s1");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(send.init.body)).toEqual({ text: TEXT, format: "mp3" });
    // The guard is consumed by proxyAwareFetch and never reaches the wire.
    expect(send.init).not.toHaveProperty("noTransportReplay");
    expect(send.init).not.toHaveProperty("directFetch");
  });

  it("sends once directly when the connection has no proxy", async () => {
    serve(audio());
    const result = await speak(createFishAudioTtsAdapter(), CRED_DIRECT);
    expect(result.base64).toBe(MP3.toString("base64"));
    expect(legs()).toEqual(["direct"]);
  });

  it.each([
    ["a reset after the proxy accepted the POST", "ECONNRESET"],
    ["a closed proxy socket", "UND_ERR_SOCKET"],
    ["a request-body write failure", "EPIPE"],
    ["an undici headers timeout", "UND_ERR_HEADERS_TIMEOUT"],
  ])("does not resend directly after %s", async (_label, code) => {
    // The direct answer is queued so a replay would be visible as a success.
    serve(reject(transportError(code)), audio());
    const result = await speak(createFishAudioTtsAdapter());
    await settle();
    expect(legs()).toEqual(["proxyA"]);
    expect(steps).toHaveLength(1);
    expectUnknownCost(result);
    expect(result.status).toBe(502);
  });

  it("does not resend after the deadline while the proxy send is in flight", async () => {
    serve(hang(), audio());
    const result = await speak(createFishAudioTtsAdapter({ timeoutMs: 25 }));
    await settle();
    expect(legs()).toEqual(["proxyA"]);
    expectUnknownCost(result);
    expect(result.status).toBe(504);
  });

  it("does not resend after the caller aborts an in-flight proxy send", async () => {
    const controller = new AbortController();
    serve((url, init) => { setTimeout(() => controller.abort(), 1); return hang()(url, init); }, audio());
    const result = await speak(createFishAudioTtsAdapter(), CRED_A, { signal: controller.signal });
    await settle();
    expect(legs()).toEqual(["proxyA"]);
    expectUnknownCost(result);
    expect(result.status).toBe(499);
  });

  it("sends nothing when the caller left before the send", async () => {
    const controller = new AbortController();
    controller.abort();
    serve(audio());
    const result = await speak(createFishAudioTtsAdapter(), CRED_A, { signal: controller.signal });
    await settle();
    expect(sends).toHaveLength(0);
    expect(result.status).toBe(499);
    expect(result.local).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("sends once when the proxied 2xx audio body fails mid-read", async () => {
    serve(brokenBody, audio());
    const result = await speak(createFishAudioTtsAdapter());
    await settle();
    expect(legs()).toEqual(["proxyA"]);
    expectUnknownCost(result, "accepted");
  });

  it("sends once on a proxied 503 and keeps it unknown-cost", async () => {
    serve(json({ message: "busy" }, 503), audio());
    const result = await speak(createFishAudioTtsAdapter());
    await settle();
    expect(legs()).toEqual(["proxyA"]);
    expect(result.status).toBe(503);
    expectUnknownCost(result);
  });

  it("keeps a proven-unsent proxy failure free of accepted work and does not send again", async () => {
    serve(reject(transportError("ECONNREFUSED", "connect ECONNREFUSED")), audio());
    const result = await speak(createFishAudioTtsAdapter());
    await settle();
    expect(legs()).toEqual(["proxyA"]);
    expect(result.success).not.toBe(true);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps a proven-unsent direct failure free of accepted work", async () => {
    serve(reject(transportError("ENOTFOUND", "getaddrinfo ENOTFOUND")));
    const result = await speak(createFishAudioTtsAdapter(), CRED_DIRECT);
    expect(legs()).toEqual(["direct"]);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps each selected key on its own proxy and never moves a failed send to the other", async () => {
    const adapter = createFishAudioTtsAdapter();
    serve(reject(transportError("ECONNRESET")), audio(), audio());
    const failed = await speak(adapter, CRED_A);
    await settle();
    expect(legs()).toEqual(["proxyA"]);
    expectUnknownCost(failed);
    const ok = await speak(adapter, CRED_B);
    await settle();
    expect(legs()).toEqual(["proxyA", "proxyB"]);
    expect(ok.base64).toBe(MP3.toString("base64"));
    expect(new Headers(sends[0].init.headers).get("authorization")).toBe(`Bearer ${KEY_A}`);
    expect(new Headers(sends[1].init.headers).get("authorization")).toBe(`Bearer ${KEY_B}`);
    expect(JSON.stringify(sends[0].init.headers)).not.toContain(KEY_B);
    expect(JSON.stringify(sends[1].init.headers)).not.toContain(KEY_A);
    expect(steps).toHaveLength(1);
  });

  it("passes an injected transport the same init it always received", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init, proxyOptions) => { calls.push({ url, init, proxyOptions }); return audio(); });
    const result = await speak(createFishAudioTtsAdapter({ fetchImpl }));
    expect(result.base64).toBe(MP3.toString("base64"));
    expect(sends).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].init).sort()).toEqual(["body", "headers", "method", "redirect", "signal"]);
    expect(calls[0].proxyOptions).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: PROXY_A });
  });
});

describe("Fish Audio voice discovery default transport", () => {
  it("lists once through the selected proxy", async () => {
    serve(voices());
    const result = await listFishAudioVoices(CRED_A, { self: true });
    expect(result).toMatchObject({ success: true, total: 0, voices: [] });
    expect(legs()).toEqual(["proxyA"]);
    expect(sends[0].url.startsWith(FISH_AUDIO_VOICES_URL)).toBe(true);
    expect(sends[0].init.method).toBe("GET");
    expect(sends[0].init.redirect).toBe("manual");
  });

  it("keeps the free GET's existing direct fallback after a proxy failure", async () => {
    serve(reject(transportError("ECONNRESET")), voices());
    const result = await createFishAudioVoiceLister()(CRED_A, {});
    await settle();
    expect(legs()).toEqual(["proxyA", "direct"]);
    expect(result).toMatchObject({ success: true, total: 0 });
    expect(result.acceptedJob).toBeUndefined();
  });
});
