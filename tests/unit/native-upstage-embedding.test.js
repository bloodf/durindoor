// Upstage native embeddings adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (embeddingRegistry.ts `upstage`, handlers/embeddings.ts and its
// upstage handler test). Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-upstage-embedding/index.js";
import {
  UPSTAGE_EMBEDDING_MODELS,
  buildUpstageEmbeddingRequest,
  createUpstageEmbeddingAdapter,
  normalizeUpstageEmbeddings,
  upstageEmbeddingAdapter,
} from "../../open-sse/services/providerParity/native-upstage-embedding/index.js";
import { EMBEDDING_ADAPTERS, getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";
import upstageRegistry from "../../open-sse/providers/registry/upstage.js";

const ORIGIN = "https://api.upstage.ai";
const URL_ = `${ORIGIN}/v1/embeddings`;
const MODEL = "embedding-query";
const PASSAGE = "embedding-passage";
const WIDTH = 4096;
const KEY_A = "up-SYNTHETIC-key-a-0001";
const KEY_B = "up-SYNTHETIC-key-b-0002";
const TEXT = "Solar embeddings are useful";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-upstage-embedding/registration.json", import.meta.url), "utf8"));

const vec = (seed, width = WIDTH) => Array.from({ length: width }, (_, i) => ((i + seed) % 7) / 8);
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const answer = (count = 1, extra = {}, width = WIDTH) => json({
  object: "list",
  data: Array.from({ length: count }, (_, i) => ({ object: "embedding", index: i, embedding: vec(i, width) })),
  model: MODEL,
  usage: { prompt_tokens: 5 * count, total_tokens: 5 * count },
  ...extra,
});
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo ${KEY_A} ${TEXT}` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
// A fetch that only settles on abort, like a stalled socket.
const hang = () => (_url, init) => new Promise((_, reject) => {
  init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
});

let calls;
let steps;
let clock;
const send = vi.fn(async (url, init) => {
  calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
  const step = steps.shift();
  if (!step) throw new Error(`Unexpected request: ${url}`);
  return isFunction(step) ? step(String(url), init) : step;
});
const serve = (...list) => { steps = list; };

const embed = (body = {}, { model = MODEL, credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createUpstageEmbeddingAdapter({ now: () => clock, fetch: send, ...options })
    .embed({ model, body: { model: `upstage/${MODEL}`, input: TEXT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};

beforeEach(() => {
  calls = [];
  steps = [];
  clock = 1_000_000_000;
  send.mockClear();
});
afterEach(() => vi.restoreAllMocks());

// Staging-only negatives. Registration replaces this block with positive
// registry identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered: no upstage embedding adapter is reachable", () => {
    expect(getEmbeddingAdapter("upstage")).toBeNull();
    expect(Object.keys(EMBEDDING_ADAPTERS)).not.toContain("upstage");
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });

  it("leaves the existing chat-only upstage registry entry untouched", () => {
    expect(upstageRegistry.id).toBe("upstage");
    expect(upstageRegistry.alias).toBe("upstage");
    expect(upstageRegistry.category).toBe("apikey");
    expect(upstageRegistry.serviceKinds).toBeUndefined();
    expect(upstageRegistry.transport.baseUrl).toBe("https://api.upstage.ai/v1/chat/completions");
    expect(upstageRegistry.models.map((m) => m.id)).toEqual(["solar-pro3", "solar-mini"]);
    expect(upstageRegistry.media?.embeddingConfig).toBeUndefined();
    expect(REGISTRATION.provider.existingRegistryEntry).toBe("open-sse/providers/registry/upstage.js");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.UPSTAGE_PROVIDER_ID).toBe("upstage");
    expect(staged.UPSTAGE_ALIAS).toBe("upstage");
    expect(staged.UPSTAGE_EMBEDDINGS_URL).toBe(URL_);
    expect(staged.UPSTAGE_AUTH_HEADER).toBe("Authorization");
    expect(staged.UPSTAGE_AUTH_SCHEME).toBe("Bearer");
    expect(staged.UPSTAGE_PROVIDER).toMatchObject({ id: "upstage", alias: "upstage", authType: "apikey", website: "https://www.upstage.ai", serviceKinds: ["embedding"], existingServiceKinds: ["llm"] });
    expect(UPSTAGE_EMBEDDING_MODELS.map((m) => [m.id, m.name, m.kind, m.dimensions])).toEqual([
      [MODEL, "Embedding Query", "embedding", WIDTH],
      [PASSAGE, "Embedding Passage", "embedding", WIDTH],
    ]);
    expect(upstageEmbeddingAdapter.provider).toBe("upstage");
    expect(isFunction(upstageEmbeddingAdapter.embed)).toBe(true);
    expect(upstageEmbeddingAdapter.buildUrl()).toBe(URL_);
    expect(upstageEmbeddingAdapter.buildHeaders({ apiKey: KEY_A })).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(upstageEmbeddingAdapter.buildBody(MODEL, { input: TEXT })).toEqual({ model: MODEL, input: TEXT });
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields).toEqual({ id: "upstage", baseUrl: URL_, authType: "apikey", authHeader: "bearer" });
    expect(REGISTRATION.provider.canonicalId).toBe("upstage");
    expect(REGISTRATION.provider.aliases).toEqual(["upstage"]);
    expect(REGISTRATION.provider.existingServiceKinds).toEqual(["llm"]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["embedding"]);
    expect(REGISTRATION.provider.auth).toEqual({ header: "Authorization", scheme: "Bearer", credentialFields: ["apiKey", "accessToken"] });
    expect(REGISTRATION.models.embedding).toEqual(UPSTAGE_EMBEDDING_MODELS.map(({ id, name, dimensions }) => ({ id, name, dimensions })));
    expect(REGISTRATION.endpoints.embeddings.url).toBe(URL_);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name]).toBeDefined();
  });
});

describe("request contract", () => {
  it("sends the source envelope: POST /v1/embeddings, Bearer key, exactly { model, input }", async () => {
    serve(answer());
    const result = await embed();
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(URL_);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(call.init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    // Same body the source's upstage handler test pins.
    expect(call.body).toEqual({ model: MODEL, input: TEXT });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("forwards an input array in order and drops the user tag", async () => {
    serve(answer(2));
    const result = await embed({ input: ["a", "b"], user: "tag" });
    expect(result.success).toBe(true);
    expect(calls[0].body).toEqual({ model: MODEL, input: ["a", "b"] });
  });

  it("forwards an explicit float encoding as the source did", async () => {
    serve(answer());
    await embed({ encoding_format: "float" });
    expect(calls[0].body).toEqual({ model: MODEL, input: TEXT, encoding_format: "float" });
  });

  it("serves the passage model and accepts (without forwarding) its fixed width", async () => {
    serve(answer());
    const result = await embed({ model: `upstage/${PASSAGE}`, dimensions: WIDTH }, { model: PASSAGE });
    expect(result.success).toBe(true);
    expect(calls[0].body).toEqual({ model: PASSAGE, input: TEXT });
    expect((await payload(result)).model).toBe(`upstage/${PASSAGE}`);
  });

  it("falls back to accessToken when apiKey is absent (source apiKey || accessToken)", async () => {
    serve(answer());
    await embed({}, { credentials: { accessToken: KEY_B } });
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it("uses only the selected connection's key and ignores connection base URLs", async () => {
    serve(answer(), answer());
    await embed({}, { credentials: { apiKey: KEY_A, providerSpecificData: { baseUrl: "https://evil.example/v1" } } });
    await embed({}, { credentials: { apiKey: KEY_B } });
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    expect(calls.every((c) => c.url === URL_)).toBe(true);
  });

  it.each([
    ["unknown model", {}, "solar-embedding-1-large-query", /do not support model solar-embedding-1-large-query/],
    ["chat model", {}, "solar-pro3", /do not support model solar-pro3/],
    ["empty input", { input: [] }, MODEL, /non-empty/],
    ["missing input", { input: undefined }, MODEL, /non-empty/],
    ["blank string", { input: ["ok", "  "] }, MODEL, /input 1 is empty/],
    ["token array", { input: [[1, 2, 3]] }, MODEL, /text strings only/],
    ["structured image", { input: [{ type: "image", source: { type: "url", url: "https://x.example/a.png" } }] }, MODEL, /text strings only/],
    ["over-long text", { input: "x".repeat(20_001) }, MODEL, /exceeds 20000/],
    ["too many items", { input: Array(101).fill("a") }, MODEL, /at most 100/],
    ["prefixed model id", {}, `upstage/${MODEL}`, /do not support model/],
    ["reduced dimensions", { dimensions: 1024 }, MODEL, /fixed dimension of 4096/],
    ["string dimensions", { dimensions: "4096" }, MODEL, /fixed dimension/],
    ["unknown encoding", { encoding_format: "int8" }, MODEL, /float or base64/],
    ["input_type", { input_type: "query" }, MODEL, /input_type field/],
  ])("refuses %s before any billable send", async (_name, body, model, pattern) => {
    const result = await embed(body, { model });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(pattern);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses missing or header-unsafe keys before sending", async () => {
    for (const credentials of [{}, { apiKey: "  " }, { apiKey: `${KEY_A}\r\nX-Evil: 1` }]) {
      const result = await embed({}, { credentials });
      expect(result.status).toBe(401);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("buildUpstageEmbeddingRequest throws status 400 errors", () => {
    expect(() => buildUpstageEmbeddingRequest(MODEL, { input: 5 })).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("response normalization", () => {
  it("returns an OpenAI list with the provider-scoped model and upstream usage", async () => {
    serve(answer(2));
    const result = await embed({ input: ["a", "b"] });
    const body = await payload(result);
    expect(body.object).toBe("list");
    expect(body.model).toBe(`upstage/${MODEL}`);
    expect(body.data.map((d) => [d.object, d.index, d.embedding.length])).toEqual([["embedding", 0, WIDTH], ["embedding", 1, WIDTH]]);
    expect(body.data[1].embedding).toEqual(vec(1));
    expect(body.usage).toEqual({ prompt_tokens: 10, total_tokens: 10 });
    expect(result.accounting).toMatchObject({ modality: "embedding", state: "complete", costStatus: "unknown", nativeUnits: { inputs: 2 } });
    expect(result.accounting.tokens).toMatchObject({ input_tokens: 10, total_tokens: 10 });
    expect(result.response.headers.get("content-type")).toBe("application/json");
  });

  it("echoes a bare client model id (source rule)", async () => {
    serve(answer());
    const result = await embed({ model: MODEL });
    expect((await payload(result)).model).toBe(MODEL);
  });

  it("orders by index, fills a missing index, unwraps one redundant row", async () => {
    serve(json({ data: [{ index: 2, embedding: vec(2) }, { embedding: [vec(1)] }, { index: 0, embedding: vec(0) }] }));
    const result = await embed({ input: ["a", "b", "c"] });
    const body = await payload(result);
    expect(body.data.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(body.data.map((d) => d.embedding)).toEqual([vec(0), vec(1), vec(2)]);
  });

  it("packs float32 little-endian base64 locally and does not forward base64", async () => {
    serve(answer());
    const result = await embed({ encoding_format: "base64" });
    expect(calls[0].body).toEqual({ model: MODEL, input: TEXT });
    const [item] = (await payload(result)).data;
    const bytes = Buffer.from(item.embedding, "base64");
    expect(bytes.length).toBe(WIDTH * 4);
    expect(bytes.readFloatLE(4 * 3)).toBeCloseTo(vec(0)[3], 6);
  });

  it("keeps absent usage unknown in accounting while the body carries the source zero fallback", async () => {
    serve(json({ data: [{ index: 0, embedding: vec(0) }] }));
    const result = await embed();
    expect((await payload(result)).usage).toEqual({ prompt_tokens: 0, total_tokens: 0 });
    expect(result.accounting.tokens).toEqual({});
    expect(result.accounting.meta.usageMissing).toBe(true);
    expect(result.accounting.cost).toBeNull();
  });

  it.each([
    ["wrong count", { data: [] }],
    ["non-numeric vector", { data: [{ index: 0, embedding: vec(0).map(String) }] }],
    ["null in vector", { data: [{ index: 0, embedding: [...vec(0).slice(1), null] }] }],
    ["wrong width", { data: [{ index: 0, embedding: [0.1, 0.2] }] }],
    ["string vector", { data: [{ index: 0, embedding: "AAAA" }] }],
    ["out-of-range index", { data: [{ index: 3, embedding: vec(0) }] }],
    ["error envelope", { error: { message: `echo ${KEY_A}` } }],
    ["not a list", { result: "ok" }],
  ])("refuses a 2xx with %s as unusable accepted work", async (_name, body) => {
    serve(json(body));
    const result = await embed();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", modality: "embedding", meta: { jobState: "completed-unusable" } });
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("refuses duplicate indices", () => {
    expect(() => normalizeUpstageEmbeddings({ data: [{ index: 0, embedding: vec(0) }, { index: 0, embedding: vec(1) }] }, { items: 2, dimensions: WIDTH }))
      .toThrow(/index/);
  });

  it("refuses unreadable JSON without quoting it", async () => {
    serve(new Response(`not json ${KEY_A}`, { status: 200 }));
    const result = await embed();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeDefined();
    await assertNoLeak(result);
  });
});

describe("failures, quota and redirects", () => {
  it.each([
    [401, 401, /refused the API key/],
    [403, 403, /refused the API key/],
    [400, 400, /refused the embeddings request with 400/],
    [422, 422, /with 422/],
  ])("maps %i without quoting the upstream body", async (upstream, status, pattern) => {
    serve(leaky(upstream));
    const result = await embed();
    expect(result.status).toBe(status);
    expect(await errorMessage(result)).toMatch(pattern);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
    expect(calls).toHaveLength(1);
  });

  it("marks 402 as quota exhausted on this connection only; a second credential still works", async () => {
    serve(leaky(402), answer());
    const a = await embed();
    expect(a.status).toBe(402);
    expect(a.quotaExhausted).toBe(true);
    await assertNoLeak(a);
    const b = await embed({}, { credentials: { apiKey: KEY_B } });
    expect(b.success).toBe(true);
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
  });

  it("keeps a bounded Retry-After on 429", async () => {
    serve(leaky(429, { "retry-after": "30" }));
    const result = await embed();
    expect(result.status).toBe(429);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("treats 5xx as uncertain accepted work and never resends", async () => {
    serve(leaky(503));
    const result = await embed();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("refuses a redirect and never follows it with the key", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/v1/embeddings" } }));
    const result = await embed();
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toMatch(/redirect refused/);
    expect(calls).toHaveLength(1);
  });

  it("treats an answer from another origin as uncertain", async () => {
    const foreign = answer();
    Object.defineProperty(foreign, "url", { value: "https://evil.example/v1/embeddings" });
    serve(foreign);
    const result = await embed();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });
});

describe("cancellation, deadlines and uncertain submits", () => {
  it("does not send when the caller already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await embed({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("aborts the socket on caller abort after send and reports uncertain work once", async () => {
    const controller = new AbortController();
    let seen;
    serve((url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return hang()(url, init); });
    const result = await embed({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("ends the wait at the deadline even when the transport ignores its signal", async () => {
    serve(() => new Promise(() => {}));
    const result = await embed({}, { options: { timeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("bounds the body read with the same deadline", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200 });
    serve(stalled);
    const result = await embed({}, { options: { timeoutMs: 30 } });
    expect([502, 504]).toContain(result.status);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unusable");
  });

  it("reports a pre-connect failure as not sent, without acceptedJob or retry", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await embed();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("reports a mid-flight reset as uncertain and does not replay", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const result = await embed();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });
});

describe("default transport", () => {
  it("goes through the shared proxy-aware fetch to the fixed origin", async () => {
    const original = globalThis.fetch;
    const seen = [];
    globalThis.fetch = vi.fn(async (url, init) => { seen.push({ url: String(url), redirect: init?.redirect }); return answer(); });
    try {
      const result = await upstageEmbeddingAdapter.embed({ model: MODEL, body: { model: `upstage/${MODEL}`, input: TEXT }, credentials: { apiKey: KEY_A } });
      expect(result.success).toBe(true);
      expect(seen).toEqual([{ url: URL_, redirect: "manual" }]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
