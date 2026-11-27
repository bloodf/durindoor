import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  rerankConfig, rerankModels, togetherRerankMetadata, togetherRerankAdapter,
  handleTogetherRerankNative, discoverTogetherModels,
} from "../../open-sse/services/providerParity/native-together-rerank/index.js";

const model = "Salesforce/Llama-Rank-V2";
const credentials = { id: "connection-one", apiKey: "private-one" };
const ranked = {
  id: "oGs6Zt9-62bZhn-99529372487b1b0a", object: "rerank", model,
  results: [{ index: 1, relevance_score: 0.9, document: { text: "upstream-echo" } }],
  usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 },
};
const json = (v, status = 200, headers = {}) => Response.json(v, { status, headers });
const body = { query: "q", documents: ["one", { text: "two" }], top_n: 1 };
const rank = (opts = {}) => handleTogetherRerankNative({ body, modelInfo: { provider: "together", model }, credentials, ...opts });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Together native rerank protocol (independent of registration)", () => {
  it("pins exact source registry endpoint/auth/catalog metadata", () => {
    expect(rerankConfig).toEqual({ id: "together", baseUrl: "https://api.together.xyz/v1/rerank", authType: "apikey", authHeader: "bearer", models: rerankModels });
    expect(rerankConfig.format).toBeUndefined();
    expect(rerankModels).toEqual([{ id: model, name: "Llama Rank V2" }]);
    expect(togetherRerankMetadata.serviceKinds).toEqual(["rerank"]);
    expect(togetherRerankMetadata.models).toEqual([{ id: model, name: "Llama Rank V2", kind: "rerank" }]);
    expect(Object.isFrozen(rerankConfig) && Object.isFrozen(rerankModels[0])).toBe(true);
  });

  it("sends exact source headers/body and rebuilds results from caller documents", async () => {
    const fetchImpl = vi.fn(async () => json({ ...ranked, url: "http://127.0.0.1/secret", secret: "private-one" }));
    const result = await rank({ fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.together.xyz/v1/rerank");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer private-one" });
    expect(JSON.parse(init.body)).toEqual({ model, query: "q", documents: ["one", { text: "two" }], top_n: 1, return_documents: true });
    expect(result).toMatchObject({ success: true, status: 200 });
    expect(await result.response.json()).toEqual({
      id: ranked.id, model,
      results: [{ index: 1, relevance_score: 0.9, document: { text: "two" } }],
      usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 },
    });
    expect(result.accounting).toMatchObject({ modality: "rerank", cost: null, costStatus: "unknown", tokens: { input_tokens: 12, total_tokens: 12 }, meta: { connectionId: "connection-one" } });
  });

  it("defaults top_n to documents.length and return_documents to true, as the source does", () => {
    expect(togetherRerankAdapter.buildBody(model, { query: "q", documents: ["a", "b", "c"] }))
      .toEqual({ model, query: "q", documents: ["a", "b", "c"], top_n: 3, return_documents: true });
    expect(togetherRerankAdapter.buildBody(model, { query: "q", documents: ["a"], return_documents: false }).return_documents).toBe(false);
    expect(togetherRerankAdapter.buildUrl()).toBe(rerankConfig.baseUrl);
  });

  it("honors return_documents false, sorts descending with stable ties and replaces unsafe ids", () => {
    const out = togetherRerankAdapter.normalize(
      { id: "https://evil.test/x", results: [{ index: 1, relevance_score: 0.2 }, { index: 2, relevance_score: 0.7 }, { index: 0, relevance_score: 0.2 }] },
      model, { query: "q", documents: ["a", "b", "c"], return_documents: false });
    expect(out.results).toEqual([{ index: 2, relevance_score: 0.7 }, { index: 0, relevance_score: 0.2 }, { index: 1, relevance_score: 0.2 }]);
    expect(out.id).toMatch(/^rerank-\d+$/);
  });

  it("reports no synthetic billed units when upstream omits usage", async () => {
    const result = await rank({ fetchImpl: async () => json({ results: [{ index: 0, relevance_score: 1 }] }) });
    const out = await result.response.json();
    expect(out.usage).toBeUndefined();
    expect(out.meta).toBeUndefined();
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown", tokens: {}, nativeUnits: {} });
  });

  it("permits custom safe model IDs without claiming capability", async () => {
    const fetchImpl = vi.fn(async () => json(ranked));
    expect((await rank({ fetchImpl, modelInfo: { model: "mixedbread-ai/Mxbai-Rerank-Large-V2" } })).success).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe("mixedbread-ai/Mxbai-Rerank-Large-V2");
  });

  it.each([
    { query: "", documents: ["x"] }, { query: "   ", documents: ["x"] }, { query: 1, documents: ["x"] },
    { query: "q", documents: [] }, { query: "q", documents: "x" }, { query: "q", documents: [1] },
    { query: "q", documents: [""] }, { query: "q", documents: [{ url: "https://example.com" }] },
    { query: "q", documents: [{ text: "a", title: "t" }] }, { query: "q", documents: ["x".repeat(20001)] },
    { query: "q", documents: Array(1025).fill("a") },
    { query: "q", documents: ["a"], top_n: 2 }, { query: "q", documents: ["a"], top_n: 0 }, { query: "q", documents: ["a"], top_n: 1.5 },
    { query: "q", documents: ["a"], return_documents: "yes" }, { query: "q", documents: ["a"], stream: true },
    { query: "q", documents: ["a"], rank_fields: ["text"] },
  ])("rejects unsupported inputs before billable submission: %j", async (bad) => {
    const fetchImpl = vi.fn();
    expect((await rank({ body: bad, fetchImpl })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["", "https://evil.test/x", "../x", "org/../x", "org/x?key=a", "org/%2e%2e", "org/x#fragment", "org/x\\evil", "org//x", "a b", 42])(
    "refuses unsafe model id %s before submission", async (bad) => {
      const fetchImpl = vi.fn();
      expect((await rank({ modelInfo: { model: bad }, fetchImpl })).status).toBe(400);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

  it("refuses a different provider identity", async () => {
    const fetchImpl = vi.fn();
    expect((await rank({ modelInfo: { provider: "cohere", model }, fetchImpl })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("isolates two selected credentials and their receipts", async () => {
    const fetchImpl = vi.fn(async () => json(ranked));
    await rank({ fetchImpl });
    const second = await rank({ fetchImpl, credentials: { connectionId: "two", apiKey: "private-two", accessToken: "ignored" } });
    expect(fetchImpl.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(["Bearer private-one", "Bearer private-two"]);
    expect(second.accounting.meta.connectionId).toBe("two");
    expect(JSON.stringify(second.accounting)).not.toMatch(/private|ignored/);
  });

  it("falls back to accessToken bearer when no apiKey exists", async () => {
    const fetchImpl = vi.fn(async () => json(ranked));
    await rank({ fetchImpl, credentials: { accessToken: "token-three" } });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer token-three");
  });

  it.each([{}, { apiKey: "" }, { apiKey: "bad\r\nkey" }, { apiKey: "has space" }])("refuses missing/header-unsafe credentials %j", async (creds) => {
    const fetchImpl = vi.fn();
    expect((await rank({ fetchImpl, credentials: creds })).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 402, 429, 500, 503])("maps failure %i without leaking bodies or retrying", async (status) => {
    const fetchImpl = vi.fn(async () => json({ error: { message: "private-one secret upstream text" } }, status, { "retry-after": "2" }));
    const result = await rank({ fetchImpl });
    expect(result.status).toBe(status >= 500 ? 502 : status);
    expect(result.quotaExhausted).toBe(status === 402 ? true : undefined);
    expect(Boolean(result.acceptedJob)).toBe(status >= 500);
    expect(await result.response.text()).not.toMatch(/private-one|secret|upstream text/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses Retry-After evidence for 429 rate limits", async () => {
    const result = await rank({ fetchImpl: async () => json({}, 429, { "retry-after": "7" }) });
    expect(result.status).toBe(429);
    expect(result.rateLimitEvidence).toBeDefined();
    expect(Number.isFinite(result.resetsAtMs)).toBe(true);
    expect(result.response.headers.get("Retry-After")).toBe("7");
  });

  it("scopes quota exhaustion to the selected credential", async () => {
    const fetchImpl = vi.fn(async (_, init) => init.headers.Authorization.endsWith("one")
      ? json({ error: { code: "insufficient_quota" } }, 429) : json(ranked));
    expect((await rank({ fetchImpl })).quotaExhausted).toBe(true);
    expect((await rank({ fetchImpl, credentials: { apiKey: "private-two" } })).success).toBe(true);
  });

  it.each([
    {}, [], { results: [] }, { results: "x" }, { results: [{ index: 0 }] },
    { results: [{ index: 5, relevance_score: 1 }] }, { results: [{ index: -1, relevance_score: 1 }] },
    { results: [{ index: "0", relevance_score: 1 }] }, { results: [{ index: 0, relevance_score: "0.5" }] },
    { results: [{ index: 0, relevance_score: null }] }, { results: [{ index: 0, relevance_score: 1 }, { index: 1, relevance_score: 1 }] },
    { error: { message: "private-one" } },
  ])("marks malformed successful output as accepted/unusable: %j", async (raw) => {
    const result = await rank({ fetchImpl: async () => json(raw) });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "completed-unusable", connectionId: "connection-one" } });
    expect(await result.response.text()).not.toContain("private-one");
  });

  it("rejects duplicate indices and results beyond top_n", () => {
    const b = { query: "q", documents: ["a", "b"], top_n: 2 };
    expect(() => togetherRerankAdapter.normalize({ results: [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 0 }] }, model, b)).toThrow();
    expect(() => togetherRerankAdapter.normalize({ results: [{ index: 0, relevance_score: Infinity }] }, model, b)).toThrow();
  });

  it("refuses redirects and foreign outputs without following them", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } }));
    const redirect = await rank({ fetchImpl });
    expect(redirect.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const foreign = json(ranked);
    Object.defineProperty(foreign, "url", { value: "https://evil.test/result" });
    expect((await rank({ fetchImpl: async () => foreign })).acceptedJob).toBeDefined();
  });

  it("does not submit pre-aborted requests", async () => {
    const fetchImpl = vi.fn();
    const result = await rank({ fetchImpl, signal: AbortSignal.abort() });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prevents send if cancelled in the dispatch microtask gap", async () => {
    const abort = new AbortController();
    const fetchImpl = vi.fn();
    const pending = rank({ fetchImpl, signal: abort.signal });
    abort.abort();
    expect(await pending).toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds a hung submit, aborts network, records uncertainty, never replays", async () => {
    vi.useFakeTimers();
    let networkSignal;
    const fetchImpl = vi.fn((_, init) => { networkSignal = init.signal; return new Promise(() => {}); });
    const pending = rank({ fetchImpl, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(21);
    const result = await pending;
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toMatchObject({ cost: null, costStatus: "unknown", meta: { jobState: "submit-unknown" } });
    expect(networkSignal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts submit on caller cancellation even if transport ignores the signal", async () => {
    const abort = new AbortController();
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const fetchImpl = vi.fn(() => { started(); return new Promise(() => {}); });
    const pending = rank({ signal: abort.signal, fetchImpl });
    await ready;
    abort.abort();
    expect(await pending).toMatchObject({ status: 499, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds/cancels stalled response reads within the same total deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetchImpl = vi.fn(async () => { await new Promise((r) => setTimeout(r, 8)); return new Response(new ReadableStream({ cancel }), { status: 200 }); });
    const pending = rank({ fetchImpl, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toMatchObject({ status: 504, acceptedJob: { meta: { jobState: "completed-unread" } } });
    expect(cancel).toHaveBeenCalled();
  });

  it("cancels the body reader after headers without replay", async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    let reading;
    const ready = new Promise((resolve) => { reading = resolve; });
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ pull() { reading(); }, cancel }, { highWaterMark: 0 })));
    const pending = rank({ fetchImpl, signal: abort.signal });
    await ready;
    abort.abort();
    expect(await pending).toMatchObject({ status: 499, acceptedJob: { meta: { jobState: "completed-unread" } } });
    expect(cancel).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, Infinity, Number.NaN, 60001])("rejects invalid total deadline %s before fetch", async (timeoutMs) => {
    const fetchImpl = vi.fn();
    expect((await rank({ fetchImpl, timeoutMs })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never replays an uncertain network failure; distinguishes proven nonconnect", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("private-one socket reset"); });
    const uncertain = await rank({ fetchImpl });
    expect(uncertain.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(await uncertain.response.text()).not.toContain("private-one");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const unsent = await rank({ fetchImpl: async () => { throw Object.assign(new Error("no connection"), { cause: { code: "ECONNREFUSED" } }); } });
    expect(unsent.status).toBe(502);
    expect(unsent.acceptedJob).toBeUndefined();
  });

  it("rejects malformed and oversized bodies without exposing contents", async () => {
    for (const text of ["private-one not JSON", JSON.stringify({ padding: "x".repeat(8 * 1024 * 1024 + 1) })]) {
      const result = await rank({ fetchImpl: async () => new Response(text) });
      expect(result.status).toBe(502);
      expect(result.acceptedJob).toBeDefined();
      expect(await result.response.text()).not.toContain("private-one");
    }
  });

  it("retains real numeric receipts on unusable completions, dropping strings", async () => {
    const result = await rank({ fetchImpl: async () => json({ results: [], usage: { prompt_tokens: 7, total_tokens: 7, cost_usd: 0.01, secret: "private-one" } }) });
    expect(result.acceptedJob).toMatchObject({ cost: 0.01, costStatus: "known", costSource: "provider", tokens: { input_tokens: 7 } });
    expect(JSON.stringify(result.acceptedJob)).not.toContain("private-one");
  });

  it("ignores non-numeric/negative/fractional token usage", async () => {
    const result = await rank({ fetchImpl: async () => json({ ...ranked, usage: { prompt_tokens: -1, completion_tokens: 1.5, total_tokens: "12" } }) });
    expect((await result.response.json()).usage).toBeUndefined();
    expect(result.accounting.tokens).toEqual({});
  });
});

describe("Together model discovery (independent of registration)", () => {
  it("reads the source endpoint with isolated auth and catalog-only capabilities", async () => {
    const fetchImpl = vi.fn(async () => json([{ id: model, type: "rerank" }, { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", type: "chat", url: "http://localhost" }]));
    const result = await discoverTogetherModels({ credentials, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.together.xyz/v1/models");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual", headers: { Authorization: "Bearer private-one" } });
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
    expect(result.models).toEqual([{ id: model, serviceKinds: ["rerank"] }, { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", serviceKinds: [] }]);
    await discoverTogetherModels({ credentials: { apiKey: "private-two" }, fetchImpl });
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer private-two");
  });
  it.each([{ data: [{ id: model }] }, { models: [{ id: model }] }])("accepts the source data/models envelopes %j", async (raw) => {
    expect((await discoverTogetherModels({ credentials, fetchImpl: async () => json(raw) })).models).toEqual([{ id: model, serviceKinds: ["rerank"] }]);
  });
  it.each([[{ id: "https://evil.test/x" }], [{ id: "org/%2f" }], [{}], {}, { data: "x" }])("refuses unsafe discovery data %j", async (raw) => {
    expect((await discoverTogetherModels({ credentials, fetchImpl: async () => json(raw) })).status).toBe(502);
  });
  it("discovery failures and deadlines carry no accepted-work accounting", async () => {
    const timed = await discoverTogetherModels({ credentials, timeoutMs: 1, fetchImpl: () => new Promise(() => {}) });
    expect(timed.status).toBe(504);
    expect(timed.acceptedJob).toBeUndefined();
    const failed = await discoverTogetherModels({ credentials, fetchImpl: async () => json({ error: "private-one" }, 500) });
    expect(failed.status).toBe(502);
    expect(failed.acceptedJob).toBeUndefined();
  });
});

describe("existing local dispatch equivalence evidence", () => {
  it("generic rerankCore derives the same wire endpoint from the existing Together transport", async () => {
    const { deriveRerankUrl } = await import("../../open-sse/handlers/rerankCore.js");
    const { PROVIDERS, PROVIDER_MEDIA } = await import("../../open-sse/providers/index.js");
    expect(deriveRerankUrl(PROVIDERS.together, PROVIDER_MEDIA.together)).toBe(rerankConfig.baseUrl);
  });
});

// ISOLATED STAGING BLOCK: registration can replace only these assertions.
describe("private staging registration", () => {
  it("remains unregistered: Together has no rerank model kind or serviceKind yet", async () => {
    const { default: together } = await import("../../open-sse/providers/registry/together.js");
    expect(together.serviceKinds).not.toContain("rerank");
    expect(together.models.some((m) => m.kind === "rerank")).toBe(false);
    expect(together.rerankConfig).toBeUndefined();
    const metadata = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-together-rerank/registration.json", import.meta.url), "utf8"));
    expect(metadata).toMatchObject({ registered: false, canonicalId: "together", aliases: ["together"], serviceKinds: ["rerank"], models: { rerank: [model] } });
    expect(metadata.endpoints).toEqual({ rerank: "https://api.together.xyz/v1/rerank", discovery: "https://api.together.xyz/v1/models" });
  });
});
