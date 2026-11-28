// Transport replay guard for the three staged, unregistered embedding adapters
// (CLOVA Studio, Mixedbread, NanoGPT; #2034). Each test drives the adapters'
// default production transport, the real proxyAwareFetch, with every physical
// send captured by a mocked transport: no real proxy, socket or network. The
// selected connection uses a legacy (best-effort, non-strict) proxy, where
// proxyAwareFetch would otherwise resend the JSON body directly after a proxy
// failure whose outcome is unknown.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
} from "../../open-sse/utils/proxyFetch.js";
import {
  CLOVA_EMBEDDING_MODELS,
  CLOVA_EMBEDDINGS_URL,
  buildClovaEmbeddingRequest,
  clovaEmbeddingAdapter,
  createClovaEmbeddingAdapter,
} from "../../open-sse/services/providerParity/native-clova-studio-embedding/index.js";
import {
  MIXEDBREAD_EMBEDDING_MODELS,
  MIXEDBREAD_EMBEDDINGS_URL,
  buildMixedbreadEmbeddingRequest,
  createMixedbreadEmbeddingAdapter,
  mixedbreadEmbeddingAdapter,
} from "../../open-sse/services/providerParity/native-mixedbread-embedding/index.js";
import {
  NANOGPT_EMBEDDING_MODELS,
  NANOGPT_EMBEDDINGS_URL,
  buildNanogptEmbeddingRequest,
  createNanogptEmbeddingAdapter,
  nanogptEmbeddingAdapter,
} from "../../open-sse/services/providerParity/native-nanogpt-embedding/index.js";

const PROXY_URL = "http://legacy-proxy.invalid:8080";
const KEY_SELECTED = "sk-SYNTHETIC-selected-0001";
const KEY_OTHER = "sk-SYNTHETIC-other-0002";
const TEXT = "the quick brown fox";

const vec = (seed, width) => Array.from({ length: width }, (_, i) => ((i + seed) % 7) / 8);
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const openAiAnswer = (width) => (count = 1) => json({
  object: "list",
  data: Array.from({ length: count }, (_, i) => ({ object: "embedding", index: i, embedding: vec(i, width) })),
  usage: { prompt_tokens: 5 * count, total_tokens: 5 * count },
});
const transportError = (code, message = "fetch failed") =>
  Object.assign(new TypeError(message), { cause: Object.assign(new Error(`socket ${code}`), { code }) });
// A 2xx whose body fails after the headers arrived.
const brokenBody = () => new Response(new ReadableStream({
  start(controller) { controller.error(transportError("ECONNRESET", "terminated")); },
}), { status: 200, headers: { "content-type": "application/json" } });

const PROVIDERS = [
  {
    name: "CLOVA Studio",
    create: createClovaEmbeddingAdapter,
    production: clovaEmbeddingAdapter,
    models: CLOVA_EMBEDDING_MODELS,
    url: CLOVA_EMBEDDINGS_URL,
    model: "clova-embedding-v2",
    bodyModel: "clova-studio/clova-embedding-v2",
    wireBody: (body) => buildClovaEmbeddingRequest("clova-embedding-v2", body).bodies[0],
    answer: () => json({ status: { code: "20000", message: "OK" }, result: { embedding: vec(0, 1024), inputTokens: 4 } }),
    usage: { prompt_tokens: 4, total_tokens: 4 },
    timeouts: { callTimeoutMs: 25, totalTimeoutMs: 25 },
  },
  {
    name: "Mixedbread",
    create: createMixedbreadEmbeddingAdapter,
    production: mixedbreadEmbeddingAdapter,
    models: MIXEDBREAD_EMBEDDING_MODELS,
    url: MIXEDBREAD_EMBEDDINGS_URL,
    model: "mixedbread-ai/mxbai-embed-large-v1",
    bodyModel: "mixedbread/mixedbread-ai/mxbai-embed-large-v1",
    wireBody: (body) => buildMixedbreadEmbeddingRequest("mixedbread-ai/mxbai-embed-large-v1", body).upstream,
    answer: () => openAiAnswer(1024)(),
    usage: { prompt_tokens: 5, total_tokens: 5 },
    timeouts: { timeoutMs: 25 },
  },
  {
    name: "NanoGPT",
    create: createNanogptEmbeddingAdapter,
    production: nanogptEmbeddingAdapter,
    models: NANOGPT_EMBEDDING_MODELS,
    url: NANOGPT_EMBEDDINGS_URL,
    model: "text-embedding-3-small",
    bodyModel: "nanogpt/text-embedding-3-small",
    wireBody: (body) => buildNanogptEmbeddingRequest("text-embedding-3-small", body).upstream,
    answer: () => openAiAnswer(1536)(),
    usage: { prompt_tokens: 5, total_tokens: 5 },
    timeouts: { timeoutMs: 25 },
  },
];

// The selected connection: its own key and a legacy, non-strict connection proxy.
const selected = (proxied = true) => ({
  apiKey: KEY_SELECTED,
  providerSpecificData: proxied
    ? { proxyMode: "legacy", connectionProxyEnabled: true, connectionProxyUrl: PROXY_URL, strictProxy: false }
    : { disableEnvProxy: true },
});

let proxyDispatcher;
let sends;
let steps;
let restoreFetch;

// The physical transport under proxyAwareFetch. A send with the fixture proxy
// dispatcher is the proxy leg; any other dispatcher is the direct leg.
const transport = vi.fn(async (url, init) => {
  sends.push({ url: String(url), init, leg: init?.dispatcher === proxyDispatcher ? "proxy" : "direct" });
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
  proxyDispatcher = { dispatch: vi.fn() };
  restoreFetch = __setOriginalFetchForTesting(transport);
  __setProxyDispatcherForTesting(PROXY_URL, proxyDispatcher);
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
  expect(result.accounting).toBeUndefined();
  expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, costStatus: "unknown", meta: { jobState } });
  expect(result.acceptedJob.tokens).toEqual({});
};

describe.each(PROVIDERS)("$name default transport", (p) => {
  const embed = (adapter, { credentials = selected(), signal } = {}) =>
    adapter.embed({ model: p.model, body: { model: p.bodyModel, input: TEXT }, credentials, signal });

  it("sends once through the selected proxy with unchanged inputs, headers and redirect policy", async () => {
    serve(p.answer());
    const result = await embed(p.production);
    expect(result.success).toBe(true);
    expect(result.accounting.tokens).toMatchObject(p.usage);
    expect(sends).toHaveLength(1);
    const [send] = sends;
    expect(send.leg).toBe("proxy");
    expect(send.url).toBe(p.url);
    expect(send.init.method).toBe("POST");
    expect(send.init.redirect).toBe("manual");
    expect(new Headers(send.init.headers).get("authorization")).toBe(`Bearer ${KEY_SELECTED}`);
    expect(JSON.stringify(send.init.headers)).not.toContain(KEY_OTHER);
    expect(JSON.parse(send.init.body)).toEqual(p.wireBody({ model: p.bodyModel, input: TEXT }));
    expect(send.init.signal).toBeInstanceOf(AbortSignal);
    // The guard is consumed by proxyAwareFetch and never reaches the wire.
    expect(send.init).not.toHaveProperty("noTransportReplay");
    expect(send.init).not.toHaveProperty("directFetch");
  });

  it("sends once directly when the connection has no proxy", async () => {
    serve(p.answer());
    const result = await embed(p.production, { credentials: selected(false) });
    expect(result.success).toBe(true);
    expect(sends.map((s) => s.leg)).toEqual(["direct"]);
  });

  it.each([
    ["a reset after the proxy accepted the POST", "ECONNRESET"],
    ["a closed proxy socket", "UND_ERR_SOCKET"],
    ["a request-body write failure", "EPIPE"],
    ["an undici headers timeout", "UND_ERR_HEADERS_TIMEOUT"],
  ])("does not resend directly after %s", async (_label, code) => {
    // The direct answer is queued so a replay would be visible as a success.
    serve(reject(transportError(code)), p.answer());
    const result = await embed(p.create());
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy"]);
    expect(steps).toHaveLength(1);
    expectUnknownCost(result, "submit-unknown");
  });

  it("does not resend after the call deadline while the proxy send is in flight", async () => {
    serve(hang(), p.answer());
    const result = await embed(p.create(p.timeouts));
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy"]);
    expectUnknownCost(result, "submit-unknown");
    expect(result.status).toBe(504);
  });

  it("does not resend after the caller aborts an in-flight proxy send", async () => {
    const controller = new AbortController();
    serve((url, init) => { setTimeout(() => controller.abort(), 1); return hang()(url, init); }, p.answer());
    const result = await embed(p.create(), { signal: controller.signal });
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy"]);
    expectUnknownCost(result, "submit-unknown");
  });

  it("sends once when the proxied 2xx body fails mid-read", async () => {
    serve(brokenBody, p.answer());
    const result = await embed(p.create());
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy"]);
    expectUnknownCost(result, "completed-unusable");
  });

  it("keeps a proven-unsent proxy failure free of accepted work and does not send again", async () => {
    serve(reject(transportError("ECONNREFUSED", "connect ECONNREFUSED")), p.answer());
    const result = await embed(p.create());
    await settle();
    expect(sends.map((s) => s.leg)).toEqual(["proxy"]);
    expect(result.success).not.toBe(true);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps a proven-unsent direct failure free of accepted work", async () => {
    serve(reject(transportError("ENOTFOUND", "getaddrinfo ENOTFOUND")));
    const result = await embed(p.create(), { credentials: selected(false) });
    expect(sends.map((s) => s.leg)).toEqual(["direct"]);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps static model discovery: no send without an embed call", async () => {
    const adapter = p.create();
    expect(adapter.models).toBe(p.models);
    expect(adapter.buildUrl()).toBe(p.url);
    expect(adapter).not.toHaveProperty("listModels");
    expect(adapter).not.toHaveProperty("discoverModels");
    await settle();
    expect(sends).toHaveLength(0);
  });
});

describe("CLOVA Studio fan-out", () => {
  it("never resends an earlier or the failed input after a reset mid fan-out", async () => {
    serve(
      json({ status: { code: "20000", message: "OK" }, result: { embedding: vec(0, 1024), inputTokens: 4 } }),
      reject(transportError("ECONNRESET")),
      json({ status: { code: "20000", message: "OK" }, result: { embedding: vec(1, 1024), inputTokens: 4 } }),
    );
    const result = await createClovaEmbeddingAdapter().embed({
      model: "clova-embedding-v2",
      body: { model: "clova-studio/clova-embedding-v2", input: [TEXT, "jumps over"] },
      credentials: selected(),
    });
    await settle();
    expect(sends.map((s) => [s.leg, JSON.parse(s.init.body).text])).toEqual([["proxy", TEXT], ["proxy", "jumps over"]]);
    expect(result.success).not.toBe(true);
    expect(result.acceptedJob).toMatchObject({
      costSource: "accepted-job", cost: null, costStatus: "unknown",
      meta: { jobState: "submit-unknown", completedInputs: 1, requestedInputs: 2 },
    });
  });
});
