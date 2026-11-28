// Transport replay guard for the staged, unregistered Deepgram TTS adapter
// (#2034). Each test drives the module's default production transport, the
// real proxyAwareFetch, with every physical send captured by a mocked
// transport: no real proxy, socket or network, and every key is synthetic. The
// selected connection uses a legacy (best-effort, non-strict) proxy, where
// proxyAwareFetch would otherwise resend the billable JSON speech POST directly
// after a proxy failure whose outcome is unknown. Free model discovery (GET)
// keeps its existing transport behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
} from "../../open-sse/utils/proxyFetch.js";
import {
  createDeepgramTtsAdapter,
  deepgramTtsAdapter,
  listDeepgramTtsModels,
} from "../../open-sse/services/providerParity/native-deepgram-tts/index.js";

const SPEAK_URL = "https://api.deepgram.com/v1/speak?model=aura-asteria-en";
const MODELS_URL = "https://api.deepgram.com/v1/models";
const PROXY_A = "http://legacy-proxy-a.invalid:8080";
const PROXY_B = "http://legacy-proxy-b.invalid:8080";
const KEY_A = "dg-SYNTHETIC-key-a-0001";
const KEY_B = "dg-SYNTHETIC-key-b-0002";
const TEXT = "Hello from the gate.";
const MODEL = "aura-asteria-en";
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);

const audio = (headers = {}) => new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg", "dg-char-count": "20", ...headers } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const modelsAnswer = () => json({ tts: [{ canonical_name: MODEL, name: "asteria", languages: ["en-US"], metadata: { tags: ["feminine"] } }] });
const transportError = (code, message = "fetch failed") =>
  Object.assign(new TypeError(message), { cause: Object.assign(new Error(`socket ${code}`), { code }) });
// A 2xx whose audio body fails after the headers arrived.
const brokenBody = () => new Response(new ReadableStream({
  start(controller) { controller.error(transportError("ECONNRESET", "terminated")); },
}), { status: 200, headers: { "content-type": "audio/mpeg" } });

// A selected connection: its own key and its own legacy, non-strict connection proxy.
const connection = (apiKey, proxyUrl) => ({
  apiKey,
  connectionId: `conn-${apiKey.slice(-4)}`,
  providerSpecificData: proxyUrl
    ? { proxyMode: "legacy", connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, strictProxy: false }
    : { disableEnvProxy: true },
});
const CRED_A = connection(KEY_A, PROXY_A);
const CRED_B = connection(KEY_B, PROXY_B);
const CRED_DIRECT = connection(KEY_A, null);

let dispatchers;
let sends;
let steps;
let restoreFetch;

// The physical transport under proxyAwareFetch. A send with a fixture proxy
// dispatcher is that proxy's leg; any other dispatcher is the direct leg.
const legOf = (init) => (init?.dispatcher === dispatchers.a ? "proxy-a" : init?.dispatcher === dispatchers.b ? "proxy-b" : "direct");
const physical = vi.fn(async (url, init) => {
  sends.push({ url: String(url), init, leg: legOf(init) });
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
const legs = () => sends.map((s) => s.leg);

beforeEach(() => {
  sends = [];
  steps = [];
  physical.mockClear();
  dispatchers = { a: { dispatch: vi.fn() }, b: { dispatch: vi.fn() } };
  restoreFetch = __setOriginalFetchForTesting(physical);
  __setProxyDispatcherForTesting(PROXY_A, dispatchers.a);
  __setProxyDispatcherForTesting(PROXY_B, dispatchers.b);
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  restoreFetch();
  __clearProxyDispatchersForTesting();
  vi.restoreAllMocks();
});

const speak = (adapter, { credentials = CRED_A, signal } = {}) => adapter.synthesize(TEXT, MODEL, credentials, "mp3", { signal });

const expectUnknownCost = (result, jobState) => {
  expect(result.base64).toBeUndefined();
  expect(result.accounting).toBeUndefined();
  expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, costStatus: "unknown", meta: { jobState } });
  expect(result.acceptedJob.tokens).toEqual({});
};

describe("Deepgram TTS default transport: billable speech POST", () => {
  it("sends once through the selected proxy with unchanged URL, method, headers, body and redirect policy", async () => {
    serve(audio());
    const result = await speak(deepgramTtsAdapter);
    expect(result.base64).toBe(MP3.toString("base64"));
    expect(result.format).toBe("mp3");
    expect(result.accounting.nativeUnits).toEqual({ characters: 20 });
    expect(result.acceptedJob).toBeUndefined();
    expect(sends).toHaveLength(1);
    const [send] = sends;
    expect(send.leg).toBe("proxy-a");
    expect(send.url).toBe(SPEAK_URL);
    expect(send.init.method).toBe("POST");
    expect(send.init.redirect).toBe("manual");
    expect(new Headers(send.init.headers).get("authorization")).toBe(`Token ${KEY_A}`);
    expect(new Headers(send.init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(send.init.body)).toEqual({ text: TEXT });
    expect(send.init.signal).toBeInstanceOf(AbortSignal);
    // The guard is consumed by proxyAwareFetch and never reaches the wire.
    expect(send.init).not.toHaveProperty("noTransportReplay");
    expect(send.init).not.toHaveProperty("directFetch");
  });

  it("sends once directly when the connection has no proxy", async () => {
    serve(audio());
    const result = await speak(createDeepgramTtsAdapter(), { credentials: CRED_DIRECT });
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
    const result = await speak(createDeepgramTtsAdapter());
    await settle();
    expect(legs()).toEqual(["proxy-a"]);
    expect(steps).toHaveLength(1);
    expect(result.status).toBe(502);
    expectUnknownCost(result, "submit-unknown");
  });

  it("does not resend after the call deadline while the proxy send is in flight", async () => {
    serve(hang(), audio());
    const result = await speak(createDeepgramTtsAdapter({ timeoutMs: 25 }));
    await settle();
    expect(legs()).toEqual(["proxy-a"]);
    expect(result.status).toBe(504);
    expectUnknownCost(result, "submit-unknown");
  });

  it("does not resend after the caller aborts an in-flight proxy send", async () => {
    const controller = new AbortController();
    serve((url, init) => { setTimeout(() => controller.abort(), 1); return hang()(url, init); }, audio());
    const result = await speak(createDeepgramTtsAdapter(), { signal: controller.signal });
    await settle();
    expect(legs()).toEqual(["proxy-a"]);
    expect(result.status).toBe(499);
    expectUnknownCost(result, "submit-unknown");
  });

  it("sends nothing when the caller left before the send", async () => {
    const controller = new AbortController();
    controller.abort();
    serve(audio());
    const result = await speak(createDeepgramTtsAdapter(), { signal: controller.signal });
    await settle();
    expect(sends).toHaveLength(0);
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("sends once when the proxied 2xx audio body fails mid-read", async () => {
    serve(brokenBody, audio());
    const result = await speak(createDeepgramTtsAdapter());
    await settle();
    expect(legs()).toEqual(["proxy-a"]);
    expectUnknownCost(result, "accepted");
  });

  it("sends once on a proxied 503 and keeps it unknown-cost", async () => {
    serve(json({ err_code: "UNAVAILABLE" }, 503), audio());
    const result = await speak(createDeepgramTtsAdapter());
    await settle();
    expect(legs()).toEqual(["proxy-a"]);
    expect(result.status).toBe(503);
    expectUnknownCost(result, "submit-unknown");
  });

  it("keeps a proven-unsent proxy failure free of accepted work and does not send again", async () => {
    serve(reject(transportError("ECONNREFUSED", "connect ECONNREFUSED")), audio());
    const result = await speak(createDeepgramTtsAdapter());
    await settle();
    expect(legs()).toEqual(["proxy-a"]);
    expect(result.status).toBe(502);
    expect(result.base64).toBeUndefined();
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps a proven-unsent direct failure free of accepted work", async () => {
    serve(reject(transportError("ENOTFOUND", "getaddrinfo ENOTFOUND")));
    const result = await speak(createDeepgramTtsAdapter(), { credentials: CRED_DIRECT });
    expect(legs()).toEqual(["direct"]);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps each selected connection on its own key and proxy, and a failure on A sends nothing for B", async () => {
    const adapter = createDeepgramTtsAdapter();
    serve(reject(transportError("ECONNRESET")), audio());
    const failedA = await speak(adapter, { credentials: CRED_A });
    await settle();
    expect(legs()).toEqual(["proxy-a"]);
    expectUnknownCost(failedA, "submit-unknown");

    const okB = await speak(adapter, { credentials: CRED_B });
    expect(okB.base64).toBe(MP3.toString("base64"));
    expect(legs()).toEqual(["proxy-a", "proxy-b"]);
    const [a, b] = sends.map((s) => new Headers(s.init.headers).get("authorization"));
    expect(a).toBe(`Token ${KEY_A}`);
    expect(b).toBe(`Token ${KEY_B}`);
    expect(JSON.stringify(sends[0].init.headers)).not.toContain(KEY_B);
    expect(JSON.stringify(sends[1].init.headers)).not.toContain(KEY_A);
  });

  it("leaves an injected test transport's call contract unchanged", async () => {
    const fetchImpl = vi.fn(async () => audio());
    const result = await speak(createDeepgramTtsAdapter({ fetchImpl }));
    expect(result.base64).toBe(MP3.toString("base64"));
    expect(sends).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init, proxyOptions] = fetchImpl.mock.calls[0];
    expect(url).toBe(SPEAK_URL);
    expect(Object.keys(init).sort()).toEqual(["body", "headers", "method", "redirect", "signal"]);
    expect(proxyOptions).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: PROXY_A, strictProxy: false });
  });
});

describe("Deepgram TTS default transport: free model discovery GET", () => {
  it("sends one GET through the selected proxy with no accepted work", async () => {
    serve(modelsAnswer());
    const result = await listDeepgramTtsModels(CRED_A);
    expect(result.models.map((m) => m.id)).toEqual([MODEL]);
    expect(result.acceptedJob).toBeUndefined();
    expect(legs()).toEqual(["proxy-a"]);
    expect(sends[0].url).toBe(MODELS_URL);
    expect(sends[0].init.method).toBe("GET");
    expect(sends[0].init.body).toBeUndefined();
    expect(new Headers(sends[0].init.headers).get("authorization")).toBe(`Token ${KEY_A}`);
  });

  it("keeps its existing proxy-to-direct fallback for a free read and never marks accepted work", async () => {
    serve(reject(transportError("ECONNRESET")), modelsAnswer());
    const result = await listDeepgramTtsModels(CRED_A);
    await settle();
    expect(legs()).toEqual(["proxy-a", "direct"]);
    expect(result.models.map((m) => m.id)).toEqual([MODEL]);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps an uncertain discovery failure free of accepted work", async () => {
    serve(reject(transportError("ECONNRESET")), reject(transportError("ECONNRESET")));
    const result = await listDeepgramTtsModels(CRED_A);
    expect(legs()).toEqual(["proxy-a", "direct"]);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });
});
