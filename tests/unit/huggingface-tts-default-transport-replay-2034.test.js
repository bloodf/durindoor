// Transport replay guard for the staged, unregistered HuggingFace speech (TTS)
// adapter (#2034). Each test drives the adapter's default production
// transport, the real proxyAwareFetch, with every physical send captured by a
// mocked transport: no real proxy, socket or network. The selected connection
// uses a legacy (best-effort, non-strict) proxy, where proxyAwareFetch would
// otherwise resend the replayable JSON body directly after a proxy failure
// whose outcome is unknown. Every key is synthetic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
} from "../../open-sse/utils/proxyFetch.js";
import {
  HUGGINGFACE_TTS_MODELS,
  HUGGINGFACE_TTS_MODELS_FETCHER,
  createHuggingFaceTtsAdapter,
  huggingfaceTtsAdapter,
} from "../../open-sse/services/providerParity/native-huggingface-tts/index.js";

const PROXY_A = "http://legacy-proxy-a.invalid:8080";
const PROXY_B = "http://legacy-proxy-b.invalid:8080";
const KOKORO = "hexgrad/Kokoro-82M";
const KOKORO_URL = `https://router.huggingface.co/hf-inference/models/${KOKORO}`;
const KEY_A = "hf_SYNTHETICaaaaaaaaaaaaaaaaaaaaaaaaa01";
const KEY_B = "hf_SYNTHETICbbbbbbbbbbbbbbbbbbbbbbbbb02";
const TEXT = "Hello there.";
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);

const audio = (bytes = WAV) => new Response(bytes, { status: 200, headers: { "content-type": "audio/wav" } });
const status = (code, headers = {}) =>
  new Response(JSON.stringify({ error: `upstream echo ${KEY_A}` }), { status: code, headers: { "content-type": "application/json", ...headers } });
const transportError = (code, message = "fetch failed") =>
  Object.assign(new TypeError(message), { cause: Object.assign(new Error(`socket ${code}`), { code }) });
// A 2xx whose body fails after the headers arrived.
const brokenBody = () => new Response(new ReadableStream({
  start(controller) { controller.error(transportError("ECONNRESET", "terminated")); },
}), { status: 200, headers: { "content-type": "audio/wav" } });

// A selected connection: its own key and a legacy, non-strict connection proxy.
const connection = (key, proxyUrl) => ({
  apiKey: key,
  providerSpecificData: proxyUrl
    ? { proxyMode: "legacy", connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, strictProxy: false }
    : { disableEnvProxy: true },
});
const CRED_A = connection(KEY_A, PROXY_A);
const CRED_B = connection(KEY_B, PROXY_B);
const DIRECT_A = connection(KEY_A, null);

let dispatchers;
let sends;
let steps;
let restoreFetch;

// The physical transport under proxyAwareFetch. A send with a fixture proxy
// dispatcher is that proxy's leg; any other dispatcher is the direct leg.
const legOf = (dispatcher) => dispatcher === dispatchers.a ? "proxy-a" : dispatcher === dispatchers.b ? "proxy-b" : "direct";
const transport = vi.fn(async (url, init) => {
  sends.push({ url: String(url), init, leg: legOf(init?.dispatcher), auth: new Headers(init?.headers).get("authorization") });
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
const synth = (adapter, cred = CRED_A, options = {}) => adapter.synthesize(TEXT, KOKORO, cred, "mp3", options);

beforeEach(() => {
  sends = [];
  steps = [];
  transport.mockClear();
  dispatchers = { a: { dispatch: vi.fn() }, b: { dispatch: vi.fn() } };
  restoreFetch = __setOriginalFetchForTesting(transport);
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

const expectUnknownCost = (result, jobState) => {
  expect(result.success).not.toBe(true);
  expect(result.base64).toBeUndefined();
  expect(result.accounting).toBeUndefined();
  expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, costStatus: "unknown", meta: { jobState } });
  expect(JSON.stringify(result)).not.toContain(KEY_A);
};

describe("HuggingFace speech default transport: normal sends", () => {
  it("sends one fixed-host JSON POST through the selected proxy with unchanged inputs, headers and redirect policy", async () => {
    serve(audio());
    const result = await synth(huggingfaceTtsAdapter);
    expect(sends).toHaveLength(1);
    const [send] = sends;
    expect(send.leg).toBe("proxy-a");
    expect(send.url).toBe(KOKORO_URL);
    expect(send.init.method).toBe("POST");
    expect(send.init.redirect).toBe("manual");
    expect(send.auth).toBe(`Bearer ${KEY_A}`);
    expect(new Headers(send.init.headers).get("content-type")).toBe("application/json");
    expect(send.init.body).toBe(JSON.stringify({ inputs: TEXT }));
    expect(send.init.signal).toBeInstanceOf(AbortSignal);
    // The guard is consumed by proxyAwareFetch and never reaches the wire.
    expect(send.init).not.toHaveProperty("noTransportReplay");
    expect(send.init).not.toHaveProperty("directFetch");
    expect(result.format).toBe("wav");
    expect(Buffer.from(result.base64, "base64").equals(WAV)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", meta: { model: KOKORO } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("ignores a connection base URL and still sends only to the router host", async () => {
    serve(audio());
    const result = await synth(createHuggingFaceTtsAdapter(), { ...CRED_A, baseUrl: "https://evil.invalid" });
    expect(result.format).toBe("wav");
    expect(sends.map((s) => [s.leg, s.url])).toEqual([["proxy-a", KOKORO_URL]]);
  });

  it("sends once directly when the connection has no proxy", async () => {
    serve(audio());
    const result = await synth(createHuggingFaceTtsAdapter(), DIRECT_A);
    expect(result.format).toBe("wav");
    expect(sends.map((s) => s.leg)).toEqual(["direct"]);
  });

  it("keeps each selected connection's key on its own proxy", async () => {
    serve(audio(), audio());
    const adapter = createHuggingFaceTtsAdapter();
    await synth(adapter, CRED_A);
    await synth(adapter, CRED_B);
    expect(sends.map((s) => [s.leg, s.auth])).toEqual([["proxy-a", `Bearer ${KEY_A}`], ["proxy-b", `Bearer ${KEY_B}`]]);
  });
});

describe("HuggingFace speech default transport: uncertain failures are never resent", () => {
  it.each([
    ["a reset after the proxy accepted the POST", "ECONNRESET"],
    ["a closed proxy socket", "UND_ERR_SOCKET"],
    ["a request-body write failure", "EPIPE"],
    ["an undici headers timeout", "UND_ERR_HEADERS_TIMEOUT"],
  ])("does not resend directly after %s", async (_label, code) => {
    // The direct answer is queued so a replay would be visible as a success.
    serve(reject(transportError(code)), audio());
    const result = await synth(createHuggingFaceTtsAdapter());
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy-a"]);
    expect(steps).toHaveLength(1);
    expectUnknownCost(result, "submit-unknown");
    expect(result.status).toBe(502);
  });

  it("does not resend after the deadline while the proxy send is in flight", async () => {
    serve(hang(), audio());
    const result = await synth(createHuggingFaceTtsAdapter({ timeoutMs: 25 }));
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy-a"]);
    expectUnknownCost(result, "submit-unknown");
    expect(result.status).toBe(504);
  });

  it("does not resend after the caller aborts an in-flight proxy send", async () => {
    const controller = new AbortController();
    serve((url, init) => { setTimeout(() => controller.abort(), 1); return hang()(url, init); }, audio());
    const result = await synth(createHuggingFaceTtsAdapter(), CRED_A, { signal: controller.signal });
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy-a"]);
    expectUnknownCost(result, "submit-unknown");
    expect(result.status).toBe(499);
  });

  it("sends once when the proxied 2xx audio body fails mid-read", async () => {
    serve(brokenBody, audio());
    const result = await synth(createHuggingFaceTtsAdapter());
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy-a"]);
    expectUnknownCost(result, "accepted");
  });

  it("keeps a proxied 503 as unknown work, with its Retry-After, and does not resend", async () => {
    serve(status(503, { "retry-after": "3" }), audio());
    const result = await synth(createHuggingFaceTtsAdapter());
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy-a"]);
    expect(result.status).toBe(503);
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
    expectUnknownCost(result, "submit-unknown");
    expect(JSON.stringify(result)).not.toContain("upstream echo");
  });

  it("keeps a proxied 500 as unknown work and does not resend", async () => {
    serve(status(500), audio());
    const result = await synth(createHuggingFaceTtsAdapter());
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy-a"]);
    expect(result.status).toBe(502);
    expectUnknownCost(result, "submit-unknown");
  });

  it("refuses a proxied redirect without following it", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.invalid/x" } }), audio());
    const result = await synth(createHuggingFaceTtsAdapter());
    await settle();
    expect(sends.map((s) => [s.leg, s.url])).toEqual([["proxy-a", KOKORO_URL]]);
    expectUnknownCost(result, "submit-unknown");
  });

  it("never moves an uncertain send on connection A to connection B's proxy or key", async () => {
    serve(reject(transportError("ECONNRESET")), audio(), audio());
    const adapter = createHuggingFaceTtsAdapter();
    const failed = await synth(adapter, CRED_A);
    await settle();
    expectUnknownCost(failed, "submit-unknown");
    const ok = await synth(adapter, CRED_B);
    expect(ok.format).toBe("wav");
    expect(sends.map((s) => [s.leg, s.auth])).toEqual([["proxy-a", `Bearer ${KEY_A}`], ["proxy-b", `Bearer ${KEY_B}`]]);
    expect(JSON.stringify(failed)).not.toContain(KEY_B);
  });
});

describe("HuggingFace speech default transport: proven-unsent and local failures", () => {
  it("keeps a proven-unsent proxy failure free of accepted work and does not send again", async () => {
    serve(reject(transportError("ECONNREFUSED", "connect ECONNREFUSED")), audio());
    const result = await synth(createHuggingFaceTtsAdapter());
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy-a"]);
    expect(result.success).not.toBe(true);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(result.accounting).toBeUndefined();
  });

  it("keeps a proven-unsent direct failure free of accepted work", async () => {
    serve(reject(transportError("ENOTFOUND", "getaddrinfo ENOTFOUND")));
    const result = await synth(createHuggingFaceTtsAdapter(), DIRECT_A);
    expect(sends.map((s) => s.leg)).toEqual(["direct"]);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("does not send when the caller already left", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await synth(createHuggingFaceTtsAdapter(), CRED_A, { signal: controller.signal });
    expect(sends).toHaveLength(0);
    expect(result).toMatchObject({ status: 499, local: true });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("refuses an invalid request body before any send", async () => {
    const adapter = createHuggingFaceTtsAdapter();
    const result = await adapter.synthesize(TEXT, KOKORO, CRED_A, "mp3", { voice: "af_heart" });
    expect(result).toMatchObject({ status: 400, local: true });
    expect(sends).toHaveLength(0);
  });
});

describe("HuggingFace speech: free discovery and injected transport unchanged", () => {
  it("keeps static model discovery: no send without a synthesize call", async () => {
    const adapter = createHuggingFaceTtsAdapter();
    expect(adapter.models).toBe(HUGGINGFACE_TTS_MODELS);
    expect(HUGGINGFACE_TTS_MODELS_FETCHER).toEqual({
      url: "https://huggingface.co/api/models?inference_provider=hf-inference&pipeline_tag=text-to-speech&limit=30",
      type: "huggingface-tts",
    });
    expect(adapter).not.toHaveProperty("listModels");
    expect(adapter).not.toHaveProperty("discoverModels");
    await settle();
    expect(sends).toHaveLength(0);
  });

  it("passes an injected transport the same init as before, without the default-transport guard", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init, proxyOptions) => { calls.push({ url, init, proxyOptions }); return audio(); });
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(result.format).toBe("wav");
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].init).sort()).toEqual(["body", "headers", "method", "redirect", "signal"]);
    expect(calls[0].proxyOptions).toBeTypeOf("object");
    expect(sends).toHaveLength(0);
  });
});
