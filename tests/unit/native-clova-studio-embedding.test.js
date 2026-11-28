// Naver CLOVA Studio native embeddings adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (embeddingRegistry.ts `clova-studio`, handlers/embeddings.ts
// fetchClovaEmbeddingBatch, embeddingStructuredInput.ts
// normalizeClovaEmbeddingV2Response). Passing here says nothing about the live
// service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-clova-studio-embedding/index.js";
import {
  CLOVA_EMBEDDING_MODELS,
  buildClovaEmbeddingRequest,
  clovaAcceptedJob,
  clovaEmbeddingAdapter,
  createClovaEmbeddingAdapter,
  normalizeClovaEmbedding,
} from "../../open-sse/services/providerParity/native-clova-studio-embedding/index.js";
import { EMBEDDING_ADAPTERS, getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";
import clovaRegistry from "../../open-sse/providers/registry/clova-studio.js";

const ORIGIN = "https://clovastudio.stream.ntruss.com";
const URL_ = `${ORIGIN}/v1/api-tools/embedding/v2`;
const MODEL = "clova-embedding-v2";
const KEY_A = "nv-clova-SYNTHETIC-a-0001";
const KEY_B = "nv-clova-SYNTHETIC-b-0002";
const TEXT = "the quick brown fox";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-clova-studio-embedding/registration.json", import.meta.url), "utf8"));

const vec = (seed, width = 1024) => Array.from({ length: width }, (_, i) => ((i + seed) % 7) / 8);
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
// The source success envelope (live-verified shape in the source test).
const answer = (seed = 0, inputTokens = 4, width = 1024) =>
  json({ status: { code: "20000", message: "OK" }, result: { embedding: vec(seed, width), inputTokens } });
const leaky = (status, headers = {}) =>
  json({ status: { code: String(status * 100 + 1), message: `upstream echo ${KEY_A} ${TEXT}` } }, status, headers);
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
  createClovaEmbeddingAdapter({ now: () => clock, fetch: send, ...options })
    .embed({ model, body: { model: `clova-studio/${MODEL}`, input: TEXT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain(TEXT);
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
  it("stays unregistered: no clova-studio embedding adapter is reachable", () => {
    expect(getEmbeddingAdapter("clova-studio")).toBeNull();
    expect(getEmbeddingAdapter("clova")).toBeNull();
    expect(Object.keys(EMBEDDING_ADAPTERS)).not.toContain("clova-studio");
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });

  it("leaves the existing chat-only clova-studio registry entry untouched", () => {
    expect(clovaRegistry.serviceKinds).toEqual(["llm"]);
    expect(clovaRegistry.models.some((m) => m.kind === "embedding" || m.id === MODEL)).toBe(false);
    expect(clovaRegistry.media?.embeddingConfig).toBeUndefined();
    expect(REGISTRATION.provider.existingServiceKinds).toEqual(clovaRegistry.serviceKinds);
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.CLOVA_PROVIDER_ID).toBe("clova-studio");
    expect(staged.CLOVA_ALIAS).toBe("clova");
    expect(staged.CLOVA_EMBEDDINGS_URL).toBe(URL_);
    expect(staged.CLOVA_AUTH_HEADER).toBe("Authorization");
    expect(staged.CLOVA_AUTH_SCHEME).toBe("Bearer");
    expect(staged.CLOVA_SUCCESS_CODE).toBe("20000");
    expect(staged.CLOVA_PROVIDER).toMatchObject({ id: "clova-studio", alias: "clova", authType: "apikey", serviceKinds: ["embedding"], existingServiceKinds: ["llm"] });
    expect(CLOVA_EMBEDDING_MODELS.map((m) => [m.id, m.name, m.dimensions, m.kind])).toEqual([[MODEL, "CLOVA Embedding v2", 1024, "embedding"]]);
    expect(clovaEmbeddingAdapter.provider).toBe("clova-studio");
    expect(isFunction(clovaEmbeddingAdapter.embed)).toBe(true);
    expect(clovaEmbeddingAdapter.buildUrl()).toBe(URL_);
    expect(clovaEmbeddingAdapter.buildHeaders({ apiKey: KEY_A })).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(clovaEmbeddingAdapter.buildBody(MODEL, { input: ["a", "b"] })).toEqual({ text: "a" });
  });

  it("matches the existing fork provider identity it extends", () => {
    expect(staged.CLOVA_PROVIDER.id).toBe(clovaRegistry.id);
    expect(staged.CLOVA_PROVIDER.alias).toBe(clovaRegistry.alias);
    expect(staged.CLOVA_PROVIDER.authType).toBe(clovaRegistry.authType);
    expect(staged.CLOVA_PROVIDER.name).toBe(clovaRegistry.display.name);
    expect(staged.CLOVA_PROVIDER.website).toBe(clovaRegistry.display.website);
    expect(new URL(clovaRegistry.transport.baseUrl).origin).toBe(ORIGIN);
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields).toEqual({ id: "clova-studio", baseUrl: URL_, authType: "apikey", authHeader: "bearer", singleTextProtocol: "clova-v2" });
    expect(REGISTRATION.provider.canonicalId).toBe("clova-studio");
    expect(REGISTRATION.provider.aliases).toEqual(["clova"]);
    expect(REGISTRATION.provider.existingRegistryEntry).toBe("open-sse/providers/registry/clova-studio.js");
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["embedding"]);
    expect(REGISTRATION.provider.auth).toEqual({ header: "Authorization", scheme: "Bearer", credentialFields: ["apiKey", "accessToken"] });
    expect(REGISTRATION.models.embedding).toEqual(CLOVA_EMBEDDING_MODELS.map(({ id, name, dimensions }) => ({ id, name, dimensions })));
    expect(REGISTRATION.endpoints.embeddings.url).toBe(URL_);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name]).toBeDefined();
  });
});

describe("request contract", () => {
  it("sends the source envelope: POST { text }, Bearer key, JSON body, manual redirect", async () => {
    serve(answer());
    const result = await embed();
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(URL_);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(call.init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(call.body).toEqual({ text: TEXT });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("fans a batch out into one sequential call per text, in order (source fetchClovaEmbeddingBatch)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const step = (seed) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return answer(seed, seed + 1);
    };
    serve(step(0), step(1), step(2));
    const result = await embed({ input: ["alpha", "beta", "gamma"], user: "tag" });
    expect(result.success).toBe(true);
    expect(calls.map((c) => c.body)).toEqual([{ text: "alpha" }, { text: "beta" }, { text: "gamma" }]);
    expect(maxInFlight).toBe(1);
  });

  it("never forwards encoding_format, dimensions or user upstream", async () => {
    serve(answer(), answer(1));
    await embed({ input: ["ab", "c"], encoding_format: "base64", dimensions: 1024, user: "u" });
    expect(calls.map((c) => Object.keys(c.body))).toEqual([["text"], ["text"]]);
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
    ["unknown model", {}, "HCX-007", /do not support model HCX-007/],
    ["prefixed model id", {}, `clova-studio/${MODEL}`, /do not support model/],
    ["empty input", { input: [] }, MODEL, /non-empty/],
    ["missing input", { input: undefined }, MODEL, /non-empty/],
    ["empty string", { input: "" }, MODEL, /non-empty/],
    ["blank item amid real text", { input: ["", "  ", "real"] }, MODEL, /input 0 is empty/],
    ["token array", { input: [101, 202] }, MODEL, /text strings only/],
    ["nested token array", { input: [[1, 2, 3]] }, MODEL, /text strings only/],
    ["structured image", { input: [{ type: "image", source: { type: "url", url: "https://x.example/a.png" } }] }, MODEL, /text strings only/],
    ["over-long text", { input: "x".repeat(20_001) }, MODEL, /exceeds 20000/],
    ["too many items", { input: Array(65).fill("a") }, MODEL, /at most 64/],
    ["non-1024 dimensions", { dimensions: 1536 }, MODEL, /fixed dimension of 1024/],
    ["reduced dimensions", { dimensions: 256 }, MODEL, /fixed dimension of 1024/],
    ["string dimensions", { dimensions: "1024" }, MODEL, /fixed dimension of 1024/],
    ["unknown encoding", { encoding_format: "int8" }, MODEL, /float or base64/],
    ["unknown field", { input_type: "query" }, MODEL, /input_type field/],
  ])("refuses %s before any billable send", async (_name, body, model, pattern) => {
    const result = await embed(body, { model });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(pattern);
    expect(result.acceptedJob).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts a fixed 1024 dimensions value (source allows it)", async () => {
    serve(answer());
    expect((await embed({ dimensions: 1024 })).success).toBe(true);
  });

  it("refuses missing or header-unsafe keys before sending", async () => {
    for (const credentials of [{}, { apiKey: "  " }, { apiKey: `${KEY_A}\r\nX-Evil: 1` }]) {
      const result = await embed({}, { credentials });
      expect(result.status).toBe(401);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("buildClovaEmbeddingRequest throws status 400 errors and builds one body per text", () => {
    expect(() => buildClovaEmbeddingRequest(MODEL, { input: 5 })).toThrow(expect.objectContaining({ status: 400 }));
    expect(buildClovaEmbeddingRequest(MODEL, { input: ["a", "b"] })).toMatchObject({ bodies: [{ text: "a" }, { text: "b" }], items: 2, dimensions: 1024, encodingFormat: "float" });
  });
});

describe("response normalization", () => {
  it("returns an OpenAI list with caller indexes, provider-scoped model and summed usage", async () => {
    serve(answer(0, 5), answer(1, 4), answer(2, 5));
    const result = await embed({ input: ["alpha", "beta", "gamma"] });
    const body = await payload(result);
    expect(body.object).toBe("list");
    expect(body.model).toBe(`clova-studio/${MODEL}`);
    expect(body.data.map((d) => [d.object, d.index, d.embedding.length])).toEqual([["embedding", 0, 1024], ["embedding", 1, 1024], ["embedding", 2, 1024]]);
    expect(body.data.map((d) => d.embedding)).toEqual([vec(0), vec(1), vec(2)]);
    expect(body.usage).toEqual({ prompt_tokens: 14, total_tokens: 14 });
    expect(result.accounting).toMatchObject({ modality: "embedding", state: "complete", costStatus: "unknown", nativeUnits: { inputs: 3, calls: 3 } });
    expect(result.accounting.tokens).toMatchObject({ input_tokens: 14, total_tokens: 14 });
    expect(result.response.headers.get("content-type")).toBe("application/json");
  });

  it("echoes a bare client model id (source rule)", async () => {
    serve(answer());
    const result = await embed({ model: MODEL });
    expect((await payload(result)).model).toBe(MODEL);
  });

  it("maps the alias-addressed model to the canonical provider-scoped id", async () => {
    serve(answer());
    const result = await embed({ model: `clova/${MODEL}` });
    expect((await payload(result)).model).toBe(`clova-studio/${MODEL}`);
  });

  it("unwraps one redundant row (source flattenSingleRowEmbedding)", async () => {
    serve(json({ status: { code: 20000 }, result: { embedding: [vec(3)], inputTokens: 2 } }));
    const result = await embed();
    expect((await payload(result)).data[0].embedding).toEqual(vec(3));
  });

  it("packs float32 little-endian base64 when the client asked for base64", async () => {
    serve(answer(0), answer(1));
    const result = await embed({ input: ["ab", "c"], encoding_format: "base64" });
    const items = (await payload(result)).data;
    const pack = (values) => Buffer.from(new Float32Array(values).buffer).toString("base64");
    expect(items.map((d) => d.embedding)).toEqual([pack(vec(0)), pack(vec(1))]);
  });

  it("keeps usage unknown in accounting when any call omits inputTokens", async () => {
    serve(answer(0, 4), json({ status: { code: "20000" }, result: { embedding: vec(1) } }));
    const result = await embed({ input: ["a", "b"] });
    expect(result.success).toBe(true);
    expect((await payload(result)).usage).toEqual({ prompt_tokens: 0, total_tokens: 0 });
    expect(result.accounting.tokens).toEqual({});
    expect(result.accounting.meta.usageMissing).toBe(true);
    expect(result.accounting.cost).toBeNull();
  });

  it("normalizeClovaEmbedding ports the source envelope rules", () => {
    expect(normalizeClovaEmbedding({ status: { code: "20000", message: "OK" }, result: { embedding: [0.1, -0.2, 0.3], inputTokens: 4 } }, { dimensions: 3 }))
      .toEqual({ vector: [0.1, -0.2, 0.3], inputTokens: 4 });
    expect(() => normalizeClovaEmbedding({ status: { code: "40004", message: "Text empty" } })).toThrow(/unsuccessful status/);
    expect(() => normalizeClovaEmbedding({ status: { code: "20000" }, result: { inputTokens: 0 } })).toThrow(/missing|invalid embedding vector/);
  });

  it.each([
    ["HTTP-200 error envelope", { status: { code: "40004", message: `Text empty ${KEY_A}` } }, /unsuccessful embeddings status/],
    ["missing status", { result: { embedding: vec(0), inputTokens: 1 } }, /unsuccessful embeddings status/],
    ["missing result", { status: { code: "20000" } }, /no valid embedding vector/],
    ["missing vector", { status: { code: "20000" }, result: { inputTokens: 0 } }, /no valid embedding vector/],
    ["wrong width", { status: { code: "20000" }, result: { embedding: [0.1, 0.2], inputTokens: 1 } }, /no valid embedding vector/],
    ["non-numeric vector", { status: { code: "20000" }, result: { embedding: vec(0).map(String) } }, /no valid embedding vector/],
    ["null in vector", { status: { code: "20000" }, result: { embedding: [...vec(0).slice(1), null] } }, /no valid embedding vector/],
    ["string vector", { status: { code: "20000" }, result: { embedding: "AAAA" } }, /no valid embedding vector/],
  ])("refuses a 2xx with %s as unusable accepted work", async (_name, body, pattern) => {
    serve(json(body));
    const result = await embed();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toMatch(pattern);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", modality: "embedding", meta: { jobState: "completed-unusable", completedInputs: 0, requestedInputs: 1 } });
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("refuses unreadable JSON without quoting it", async () => {
    serve(new Response(`not json ${KEY_A}`, { status: 200 }));
    const result = await embed();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeDefined();
    await assertNoLeak(result);
  });

  it("refuses an oversized answer body", async () => {
    serve(new Response("x".repeat(1024 * 1024 + 10), { status: 200 }));
    const result = await embed();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unusable");
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

  it("stops the fan-out at the first failure and reports earlier billed calls as partial work", async () => {
    serve(answer(0, 5), leaky(429));
    const result = await embed({ input: ["alpha", "beta", "gamma"] });
    expect(result.status).toBe(429);
    expect(calls).toHaveLength(2);
    expect(result.acceptedJob).toMatchObject({
      costSource: "accepted-job",
      costStatus: "unknown",
      meta: { jobState: "partial", completedInputs: 1, requestedInputs: 3 },
    });
    expect(result.acceptedJob.tokens).toMatchObject({ input_tokens: 5 });
    await assertNoLeak(result);
  });

  it("refuses a redirect and never follows it with the key", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/v1/embeddings" } }));
    const result = await embed();
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toMatch(/redirect refused/);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats an answer from another origin as uncertain", async () => {
    const foreign = answer();
    Object.defineProperty(foreign, "url", { value: "https://evil.example/v1/api-tools/embedding/v2" });
    serve(foreign);
    const result = await embed();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("clovaAcceptedJob keeps cost unknown and records progress", () => {
    const job = clovaAcceptedJob("partial", { completedInputs: 2, requestedInputs: 3, usage: { prompt_tokens: 7, total_tokens: 7 } });
    expect(job.tokens).toMatchObject({ input_tokens: 7 });
    expect(job).toMatchObject({ modality: "embedding", cost: null, costStatus: "unknown", costSource: "accepted-job" });
    expect(job.meta).toMatchObject({ jobState: "partial", completedInputs: 2, requestedInputs: 3 });
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

  it("stops the fan-out on abort during a later call and reports the completed calls", async () => {
    const controller = new AbortController();
    serve(answer(0, 3), (url, init) => { controller.abort(); return hang()(url, init); });
    const result = await embed({ input: ["a", "b", "c"] }, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(calls.map((c) => c.body.text)).toEqual(["a", "b"]);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "submit-unknown", completedInputs: 1, requestedInputs: 3 });
    expect(result.acceptedJob.tokens).toMatchObject({ input_tokens: 3 });
  });

  it("ends the per-call wait at its deadline even when the transport ignores its signal", async () => {
    serve(() => new Promise(() => {}));
    const result = await embed({}, { options: { callTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("caps each call by what is left of the total deadline", async () => {
    serve(() => new Promise(() => {}));
    const started = Date.now();
    const result = await embed({}, { options: { callTimeoutMs: 60_000, totalTimeoutMs: 25 } });
    expect(result.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("refuses to start another call once the total deadline is spent", async () => {
    const tick = (seed) => () => { clock += 50; return answer(seed, 1); };
    serve(tick(0), tick(1), tick(2), tick(3));
    const result = await embed({ input: ["a", "b", "c", "d"] }, { options: { totalTimeoutMs: 120 } });
    expect(result.status).toBe(504);
    expect(await errorMessage(result)).toMatch(/total deadline/);
    expect(calls).toHaveLength(3);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "partial", completedInputs: 3, requestedInputs: 4 });
  });

  it("bounds the body read with the call deadline", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200 });
    serve(stalled);
    const result = await embed({}, { options: { callTimeoutMs: 30 } });
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

  it("reports an uncertain failure mid-batch with the completed count and no replay", async () => {
    serve(answer(0, 2), () => { throw transportError("ECONNRESET"); });
    const result = await embed({ input: ["a", "b", "c"] });
    expect(result.status).toBe(502);
    expect(calls.map((c) => c.body.text)).toEqual(["a", "b"]);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "submit-unknown", completedInputs: 1, requestedInputs: 3 });
  });
});

describe("default transport", () => {
  it("goes through the shared proxy-aware fetch to the fixed origin", async () => {
    const original = globalThis.fetch;
    const seen = [];
    globalThis.fetch = vi.fn(async (url, init) => { seen.push({ url: String(url), redirect: init?.redirect }); return answer(); });
    try {
      const result = await clovaEmbeddingAdapter.embed({ model: MODEL, body: { model: `clova-studio/${MODEL}`, input: TEXT }, credentials: { apiKey: KEY_A } });
      expect(result.success).toBe(true);
      expect(seen).toEqual([{ url: URL_, redirect: "manual" }]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
