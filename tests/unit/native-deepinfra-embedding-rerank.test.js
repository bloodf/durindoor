import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { embeddingConfig, rerankConfig, embeddingModels, rerankModels, deepinfraEmbeddingAdapter, deepinfraRerankAdapter, handleDeepinfraNative, discoverDeepinfraModels } from "../../open-sse/services/providerParity/native-deepinfra-embedding-rerank/index.js";

const embedding = "Qwen/Qwen3-Embedding-8B";
const rerank = "Qwen/Qwen3-Reranker-8B";
const credentials = { id: "connection-one", apiKey: "private-one" };
const vectors = { data: [{ index: 0, embedding: [0.5, -0.2] }], usage: { prompt_tokens: 3, total_tokens: 3 } };
const json = (v, status = 200, headers = {}) => Response.json(v, { status, headers });
const run = (opts = {}) => handleDeepinfraNative({ kind: "embedding", body: { input: "hello" }, modelInfo: { provider: "deepinfra", model: embedding }, credentials, ...opts });
const rank = (opts = {}) => run({ kind: "rerank", body: { query: "q", documents: ["one", { text: "two" }], top_n: 1 }, modelInfo: { provider: "deepinfra", model: rerank }, ...opts });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("DeepInfra native protocol (independent of registration)", () => {
  it("pins canonical endpoint/auth/catalog metadata", () => {
    expect(embeddingConfig).toMatchObject({ id: "deepinfra", baseUrl: "https://api.deepinfra.com/v1/openai/embeddings", authType: "apikey", authHeader: "bearer" });
    expect(rerankConfig).toMatchObject({ id: "deepinfra", baseUrl: "https://api.deepinfra.com/v1/inference", authType: "apikey", authHeader: "bearer", format: "deepinfra" });
    expect(embeddingModels.map((m) => [m.id, m.dimensions])).toEqual([
      [embedding, 4096], ["Qwen/Qwen3-Embedding-4B", 2560], ["Qwen/Qwen3-Embedding-0.6B", 1024],
      ["BAAI/bge-large-en-v1.5", 1024], ["BAAI/bge-base-en-v1.5", 768], ["BAAI/bge-m3", 1024], ["intfloat/e5-large-v2", 1024], ["thenlper/gte-large", 1024],
    ]);
    expect(rerankModels.map((m) => m.id)).toEqual([rerank, "Qwen/Qwen3-Reranker-4B", "Qwen/Qwen3-Reranker-0.6B"]);
  });
  it("sends exact embedding headers/body and normalizes only approved fields", async () => {
    const fetchImpl = vi.fn(async () => json({ ...vectors, url: "http://127.0.0.1/secret", secret: "private-one" }));
    const result = await run({ fetchImpl, body: { input: "hello", dimensions: 2, encoding_format: "float" } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(embeddingConfig.baseUrl);
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer private-one" });
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body)).toEqual({ model: embedding, input: "hello", dimensions: 2, encoding_format: "float" });
    expect(await result.response.json()).toEqual({ object: "list", model: embedding, data: [{ object: "embedding", index: 0, embedding: [0.5, -0.2] }], usage: vectors.usage });
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown", tokens: { input_tokens: 3 }, meta: { connectionId: credentials.id } });
  });
  it("sends native rerank envelope and locally sorts/limits/documents without fabricated usage", async () => {
    const fetchImpl = vi.fn(async () => json({ scores: [0.1, 0.9], inference_status: { cost: 123 } }));
    const result = await rank({ fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe(`${rerankConfig.baseUrl}/${rerank}`);
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer private-one" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ queries: ["q"], documents: ["one", "two"] });
    expect(await result.response.json()).toEqual({ id: expect.stringMatching(/^rerank-/), results: [{ index: 1, relevance_score: 0.9, document: { text: "two" } }] });
    expect(result.accounting).toMatchObject({ cost: null, tokens: {}, nativeUnits: {} });
  });
  it("honors return_documents false and preserves stable ties", () => {
    expect(deepinfraRerankAdapter.normalize({ scores: [1, 1] }, rerank, { query: "q", documents: ["a", "b"], return_documents: false }).results).toEqual([{ index: 0, relevance_score: 1 }, { index: 1, relevance_score: 1 }]);
  });
  it("permits custom safe model IDs without treating chat catalog as a capability claim", async () => {
    const fetchImpl = vi.fn(async () => json(vectors));
    expect((await run({ fetchImpl, modelInfo: { model: "custom/text-embed" } })).success).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe("custom/text-embed");
  });
  it.each([
    { input: [] }, { input: [1] }, { input: [{ image: "https://example.com/a" }] }, { input: "" },
    { input: "x".repeat(20001) }, { input: "a", encoding_format: "base64" }, { input: "a", stream: true },
    { input: "a", dimensions: -1 }, { input: "a", dimensions: "2" }, { input: "a", dimensions: 1.5 },
  ])("rejects unsupported embedding inputs before submission: %j", async (body) => {
    const fetchImpl = vi.fn();
    expect((await run({ body, fetchImpl })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    { query: "", documents: ["x"] }, { query: "q", documents: [] }, { query: "q", documents: [{ url: "https://example.com" }] },
    { query: "q", documents: ["a"], top_n: 2 }, { query: "q", documents: ["a"], return_documents: "yes" },
    { query: "q", documents: ["a"], stream: true },
  ])("rejects unsupported rerank inputs before submission: %j", async (body) => {
    const fetchImpl = vi.fn();
    expect((await rank({ body, fetchImpl })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["https://evil.test/x", "../x", "org/../x", "org/x?key=a", "org/%2e%2e", "org/x#fragment", "org/x\\evil"])("refuses model URL injection %s", async (model) => {
    const fetchImpl = vi.fn();
    expect((await rank({ modelInfo: { model }, fetchImpl })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("isolates selected credentials and receipts", async () => {
    const fetchImpl = vi.fn(async () => json(vectors));
    await run({ fetchImpl });
    const second = await run({ fetchImpl, credentials: { id: "two", apiKey: "private-two", accessToken: "ignored" } });
    expect(fetchImpl.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(["Bearer private-one", "Bearer private-two"]);
    expect(second.accounting.meta.connectionId).toBe("two");
    expect(JSON.stringify(second.accounting)).not.toMatch(/private|ignored/);
  });
  it.each([{}, { apiKey: "bad\r\nkey" }])("refuses missing/header-unsafe credentials", async (creds) => {
    const fetchImpl = vi.fn();
    expect((await run({ fetchImpl, credentials: creds })).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([401, 403, 400, 402, 429, 500])("maps failure %i without leaking bodies or retrying", async (status) => {
    const fetchImpl = vi.fn(async () => json({ error: { message: "private-one secret" } }, status, { "retry-after": "2" }));
    const result = await run({ fetchImpl });
    expect(result.status).toBe(status === 500 ? 502 : status);
    expect(result.quotaExhausted).toBe(status === 402 ? true : undefined);
    expect(Boolean(result.acceptedJob)).toBe(status === 500);
    expect(await result.response.text()).not.toMatch(/private-one|secret/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("identifies account quota while leaving another credential usable", async () => {
    const fetchImpl = vi.fn(async (_, init) => init.headers.Authorization.endsWith("one") ? json({ error: { code: "insufficient_quota" } }, 429) : json(vectors));
    expect((await run({ fetchImpl })).quotaExhausted).toBe(true);
    expect((await run({ fetchImpl, credentials: { apiKey: "private-two" } })).success).toBe(true);
  });
  it.each([
    {}, { data: [] }, { data: [{ index: 0, embedding: [] }] }, { data: [{ index: 0, embedding: ["secret"] }] },
    { data: [{ index: 1, embedding: [1] }] }, { data: [{ index: 0, embedding: [null] }] }, { error: { message: "private-one" } },
  ])("marks malformed successful embeddings as accepted/unusable: %j", async (raw) => {
    const result = await run({ fetchImpl: async () => json(raw) });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ cost: null, meta: { jobState: "completed-unusable" } });
    expect(await result.response.text()).not.toContain("private-one");
  });
  it("validates batch index uniqueness/dimensions and reorders valid rows", () => {
    const body = { input: ["a", "b"], dimensions: 1 };
    expect(() => deepinfraEmbeddingAdapter.normalize({ data: [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }] }, embedding, body)).toThrow();
    expect(() => deepinfraEmbeddingAdapter.normalize(vectors, embedding, { input: "a", dimensions: 3 })).toThrow();
    expect(deepinfraEmbeddingAdapter.normalize({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] }, embedding, body).data.map((r) => r.index)).toEqual([0, 1]);
    expect(() => deepinfraEmbeddingAdapter.normalize({ data: [{ index: 0, embedding: [Infinity] }] }, embedding, { input: "a" })).toThrow();
  });
  it.each([{}, { scores: [1] }, { scores: [1, 2, 3] }, { scores: ["0.1", 1] }, { scores: [null, 1] }])("rejects missing/non-numeric/mismatched scores", async (raw) => {
    expect((await rank({ fetchImpl: async () => json(raw) })).acceptedJob.meta.jobState).toBe("completed-unusable");
  });
  it("refuses redirects and foreign outputs without fetching result URLs", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } }));
    expect((await run({ fetchImpl })).status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const foreign = json(vectors);
    Object.defineProperty(foreign, "url", { value: "https://evil.test/result" });
    expect((await run({ fetchImpl: async () => foreign })).acceptedJob).toBeDefined();
  });
  it("does not submit pre-aborted requests", async () => {
    const fetchImpl = vi.fn();
    const result = await run({ fetchImpl, signal: AbortSignal.abort() });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("bounds a hung submit, aborts network, records uncertainty, never replays", async () => {
    vi.useFakeTimers();
    let networkSignal;
    const fetchImpl = vi.fn((_, init) => { networkSignal = init.signal; return new Promise(() => {}); });
    const pending = run({ fetchImpl, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(21);
    const result = await pending;
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toMatchObject({ cost: null, costStatus: "unknown", meta: { jobState: "submit-unknown" } });
    expect(networkSignal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("aborts submit on cancellation even if transport ignores the signal", async () => {
    const abort = new AbortController();
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const fetchImpl = vi.fn(() => { started(); return new Promise(() => {}); });
    const pending = run({ signal: abort.signal, fetchImpl });
    await ready;
    abort.abort();
    expect(await pending).toMatchObject({ status: 499, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("bounds/cancels stalled response reads within the same total deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetchImpl = vi.fn(async () => { await new Promise((r) => setTimeout(r, 8)); return new Response(new ReadableStream({ cancel }), { status: 200 }); });
    const pending = run({ fetchImpl, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "completed-unread" } } });
    expect(cancel).toHaveBeenCalled();
  });
  it("never replays an uncertain network failure; distinguishes proven nonconnect", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("private-one socket reset"); });
    expect((await run({ fetchImpl })).acceptedJob).toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const unsent = await run({ fetchImpl: async () => { throw Object.assign(new Error("no connection"), { cause: { code: "ECONNREFUSED" } }); } });
    expect(unsent.acceptedJob).toBeUndefined();
  });
  it("rejects malformed and oversized bodies without exposing contents", async () => {
    for (const body of ["private-one not JSON", JSON.stringify({ padding: "x".repeat(8 * 1024 * 1024 + 1) })]) {
      const result = await run({ fetchImpl: async () => new Response(body) });
      expect(result.status).toBe(502);
      expect(result.acceptedJob).toBeDefined();
      expect(await result.response.text()).not.toContain("private-one");
    }
  });
  it("discovers exact OpenAI-style IDs with isolated auth and no invented capabilities", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [{ id: embedding }, { id: rerank }, { id: "custom/unknown", url: "http://localhost" }] }));
    const result = await discoverDeepinfraModels({ credentials, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.deepinfra.com/v1/openai/models");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual", headers: { Authorization: "Bearer private-one" } });
    expect(result.models).toEqual([{ id: embedding, serviceKinds: ["embedding"] }, { id: rerank, serviceKinds: ["rerank"] }, { id: "custom/unknown", serviceKinds: [] }]);
    await discoverDeepinfraModels({ credentials: { apiKey: "private-two" }, fetchImpl });
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer private-two");
  });
  it.each([{ data: [{ id: "https://evil.test/x" }] }, { data: [{ id: "org/%2f" }] }, {}])("refuses unsafe discovery data %j", async (data) => {
    expect((await discoverDeepinfraModels({ credentials, fetchImpl: async () => json(data) })).status).toBe(502);
  });
  it("discovery deadline has no accepted work accounting", async () => {
    const result = await discoverDeepinfraModels({ credentials, timeoutMs: 1, fetchImpl: () => new Promise(() => {}) });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toBeUndefined();
  });
});

// ISOLATED STAGING BLOCK: registration can replace only these assertions.
describe("private staging registration", () => {
  it("remains unregistered with explicit future integration metadata", async () => {
    const { getEmbeddingAdapter } = await import("../../open-sse/handlers/embeddingProviders/index.js");
    expect(getEmbeddingAdapter("deepinfra")).toBeNull();
    const metadata = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-deepinfra-embedding-rerank/registration.json", import.meta.url), "utf8"));
    expect(metadata.registered).toBe(false);
    expect(metadata.canonicalId).toBe("deepinfra");
  });
});

// Accounting and cancellation contracts remain independent of staging registration.
describe("DeepInfra receipt and read cancellation", () => {
  it("retains real numeric receipts when a completed result is unusable", async () => {
    const result = await run({ fetchImpl: async () => json({ data: [], usage: { prompt_tokens: 7, total_tokens: 7, cost_usd: 0.01, secret: "private-one" } }) });
    expect(result.acceptedJob).toMatchObject({ cost: 0.01, costStatus: "known", costSource: "provider", tokens: { input_tokens: 7 } });
    expect(JSON.stringify(result.acceptedJob)).not.toContain("private-one");
  });
  it("cancels body reader after headers without replay", async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    let reading;
    const ready = new Promise((resolve) => { reading = resolve; });
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ pull() { reading(); }, cancel }, { highWaterMark: 0 })));
    const pending = run({ fetchImpl, signal: abort.signal });
    await ready;
    abort.abort();
    expect(await pending).toMatchObject({ status: 499, acceptedJob: { meta: { jobState: "completed-unread" } } });
    expect(cancel).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("prevents send if cancelled in the dispatch microtask gap", async () => {
    const abort = new AbortController();
    const fetchImpl = vi.fn();
    const pending = run({ fetchImpl, signal: abort.signal });
    abort.abort();
    expect(await pending).toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([0, -1, Infinity, 60001])("rejects invalid total deadline %s before fetch", async (timeoutMs) => {
    const fetchImpl = vi.fn();
    expect((await run({ fetchImpl, timeoutMs })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
