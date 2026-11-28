import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { importSPKI, jwtVerify } from "jose";
const network = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => network.send(...args) }));
// Private gateway fixture: production registry remains unmodified. Exercise the
// real core dispatch and native adapter with only registry selection substituted.
vi.mock("../../open-sse/handlers/embeddingProviders/index.js", async () => {
  const { vertexEmbeddingAdapter } = await import("../../open-sse/services/providerParity/native-vertex-embedding/index.js");
  return { getEmbeddingAdapter: (provider) => provider === "vertex" ? vertexEmbeddingAdapter : null };
});
import { createVertexEmbeddingAdapter, buildVertexEmbeddingPlan, mapVertexEmbeddingResponse, vertexEmbeddingScope, VERTEX_EMBEDDING_MODELS } from "../../open-sse/services/providerParity/native-vertex-embedding/index.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
let privateKey, publicKey;
beforeAll(() => {
  ({ privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }));
});
const credentials = (project = "fake-project-a", location = "us-central1") => ({
  apiKey: JSON.stringify({ type: "service_account", project_id: project, private_key: privateKey, client_email: `fake@${project}.iam.gserviceaccount.com`, private_key_id: "fake-key" }),
  providerSpecificData: { location, connectionProxyEnabled: true, connectionProxyUrl: "http://fake-proxy.invalid:9999", disableEnvProxy: true },
});
const predictions = (count = 1, width = 2) => ({ predictions: Array.from({ length: count }, () => ({ embeddings: { values: Array(width).fill(0.25) } })) });
const json = (value, status = 200, headers) => new Response(JSON.stringify(value), { status, headers });
const params = (overrides = {}) => ({ model: "text-embedding-005", body: { input: "hello", dimensions: 2 }, credentials: credentials(), ...overrides });
const call = (overrides, options) => createVertexEmbeddingAdapter(options).embed(params(overrides));
beforeEach(() => {
  network.send.mockReset();
  network.send.mockImplementation(async (url, init) => url === "https://oauth2.googleapis.com/token" ? json({ access_token: "fake-access-token" }) : json(predictions(JSON.parse(init.body).instances.length)));
});
describe("frozen Vertex contract", () => {
  it.each(VERTEX_EMBEDDING_MODELS)("uses source model $id and default width", (model) => {
    const plan = buildVertexEmbeddingPlan(model.id, { input: ["a", "b"] });
    expect(plan.dimensions).toBe(model.dimensions);
    expect(plan.body.instances[0]).toEqual({ content: "a", task_type: "RETRIEVAL_QUERY" });
    expect(plan.bodies).toHaveLength(model.id === "gemini-embedding-001" ? 2 : 1);
  });
  it.each([
    { input: [] }, { input: [1] }, { input: [[1]] }, { input: [""] }, { input: Array(251).fill("a") },
    { input: { text: "hi" } }, { input: "a", dimensions: "2" }, { input: "a", dimensions: 0 },
    { input: "a", dimensions: 1.5 }, { input: "a", encoding_format: "invalid" },
    { input: "a", input_type: "RETRIEVAL_DOCUMENT" }, { input: "a", task_type: "CLUSTERING" },
  ])("rejects invalid/unsupported input before auth: %j", async (body) => {
    expect((await call({ body })).status).toBe(400);
    expect(network.send).not.toHaveBeenCalled();
  });
  it("rejects unknown models before auth", async () => {
    expect((await call({ model: "text-embedding-004" })).status).toBe(400);
    expect(network.send).not.toHaveBeenCalled();
  });
  it("keeps the source 250 item batch and whitespace semantics", () => {
    expect(buildVertexEmbeddingPlan("text-embedding-005", { input: Array(250).fill(" ") }).body.instances).toHaveLength(250);
  });
  it.each([{}, { predictions: [] }, { error: { message: "secret" }, ...predictions() }, predictions(2), predictions(1, 0), predictions(1, 3), { predictions: [{ embeddings: { values: [NaN, 1] } }] }, { predictions: [{ embeddings: { values: [Infinity, 1] } }] }, { predictions: [{ embeddings: { values: ["1", 1] } }] }])("rejects unusable vectors %j", (raw) => {
    expect(() => mapVertexEmbeddingResponse(raw, buildVertexEmbeddingPlan("text-embedding-005", { input: "a", dimensions: 2 }))).toThrow();
  });
});
describe("real auth with network-only substitutions", () => {
  it.each([
    ["fake-project-a", "us-central1", "aiplatform.googleapis.com"],
    ["fake-project-b", "europe-west4", "aiplatform.googleapis.com"],
    ["fake-project-a", "global", "aiplatform.googleapis.com"],
    ["fake-project-b", "eu", "aiplatform.eu.rep.googleapis.com"],
  ])("binds %s at %s to source host %s", async (project, location, host) => {
    const creds = credentials(project, location);
    const result = await call({ credentials: creds });
    expect(result.success).toBe(true);
    const [tokenUrl, tokenInit, tokenProxy] = network.send.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(tokenInit.redirect).toBe("manual");
    const { payload } = await jwtVerify(tokenInit.body.get("assertion"), await importSPKI(publicKey, "RS256"), { audience: tokenUrl });
    expect(payload.iss).toBe(`fake@${project}.iam.gserviceaccount.com`);
    expect(payload.scope).toContain("https://www.googleapis.com/auth/cloud-platform");
    const [url, init, proxy] = network.send.mock.calls[1];
    expect(url).toBe(`https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-005:predict`);
    expect(init.signal).toBe(tokenInit.signal);
    expect(init.redirect).toBe("manual");
    expect(init.headers.Authorization).toBe("Bearer fake-access-token");
    expect(proxy).toEqual(tokenProxy);
    expect(proxy.connectionProxyUrl).toBe("http://fake-proxy.invalid:9999");
    expect(result.accounting.cost).toBe(null);
    expect(result.accounting.tokens).toEqual({});
    expect(result.accounting.meta.usageMissing).toBe(true);
    expect((await result.response.json()).data[0].embedding).toEqual([0.25, 0.25]);
  });
  it.each(["fake-express-key", '{"type":"authorized_user","client_id":"fake","client_secret":"fake","refresh_token":"fake"}', '{"accessKeyId":"fake","secretAccessKey":"fake"}', '{"web":{"client_secret":"fake"}}', "{malformed", ""])('refuses credential %s without network', async (apiKey) => {
    const result = await call({ credentials: { apiKey, accessToken: "fake-preset", providerSpecificData: { projectId: "fake-project-a" } } });
    expect(result.status).toBe(400);
    expect(network.send).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("fake-preset");
  });
  it.each([{ location: "https://evil.invalid" }, { projectId: "fake-project-b" }, { region: "europe-west4" }])("refuses invalid/conflicting selected scope %j", async (change) => {
    const creds = credentials(); Object.assign(creds.providerSpecificData, change);
    expect((await call({ credentials: creds })).status).toBe(400);
    expect(network.send).not.toHaveBeenCalled();
  });
  it("migrates legacy region explicitly, without borrowing Veo host", () => {
    const creds = credentials(); delete creds.providerSpecificData.location;
    creds.providerSpecificData.region = "europe-west4";
    expect(vertexEmbeddingScope(creds)).toMatchObject({ location: "europe-west4", origin: "https://aiplatform.googleapis.com" });
  });
  it("snapshots proxy and project before mint; ignores runtime endpoint overrides", async () => {
    const creds = credentials(); creds.providerSpecificData.baseUrl = "https://evil.invalid";
    network.send.mockImplementation(async (url) => {
      creds.providerSpecificData.connectionProxyUrl = "http://changed.invalid";
      creds.providerSpecificData.location = "global";
      return url.endsWith("/token") ? json({ access_token: "fake-token" }) : json(predictions());
    });
    expect((await call({ credentials: creds })).success).toBe(true);
    expect(network.send.mock.calls[1][0]).toContain("/locations/us-central1/");
    expect(network.send.mock.calls[1][2].connectionProxyUrl).toBe("http://fake-proxy.invalid:9999");
  });
  it("separately mints for two selected accounts without token cache crossover", async () => {
    await call({ credentials: credentials("fake-project-a") });
    await call({ credentials: credentials("fake-project-b", "global") });
    expect(network.send.mock.calls.filter(([url]) => url.endsWith("/token"))).toHaveLength(2);
    expect(network.send.mock.calls[3][0]).toContain("projects/fake-project-b/locations/global");
  });
});
describe("bounded send and honest failure accounting", () => {
  it.each([401, 403, 429, 500, 503, 302])("handles HTTP %i without leaking/replay", async (status) => {
    network.send.mockResolvedValueOnce(json({ access_token: "fake-token" })).mockResolvedValueOnce(json({ error: "fake-secret" }, status, { "retry-after": "2", location: "https://evil.invalid" }));
    const result = await call();
    expect(result.success).toBe(false);
    expect(Boolean(result.acceptedJob)).toBe(status >= 500);
    expect(JSON.stringify(result)).not.toContain("fake-secret");
    expect(network.send).toHaveBeenCalledTimes(2);
    if (status === 429) expect(result.status).toBe(429);
  });
  it.each([302, 401, 500])("refuses token HTTP %i before any billable send", async (status) => {
    network.send.mockResolvedValue(json({ error: "fake-private-key" }, status));
    const result = await call();
    expect(result.acceptedJob).toBeUndefined();
    expect(network.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("fake-private-key");
  });
  it("bounds stalled mint network and actually aborts its signal", async () => {
    network.send.mockImplementation(() => new Promise(() => {}));
    const result = await call(undefined, { timeoutMs: 100 });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toBeUndefined();
    expect(network.send.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("bounds token body under the same deadline", async () => {
    network.send.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const result = await call(undefined, { timeoutMs: 100 });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toBeUndefined();
    expect(network.send).toHaveBeenCalledTimes(1);
  });
  it("bounds stalled billable send, preserves unknown cost and aborts transport", async () => {
    network.send.mockResolvedValueOnce(json({ access_token: "fake-token" })).mockImplementation(() => new Promise(() => {}));
    const result = await call(undefined, { timeoutMs: 100 });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toMatchObject({ cost: null, costStatus: "unknown" });
    expect(network.send.mock.calls[1][1].signal.aborted).toBe(true);
    expect(network.send).toHaveBeenCalledTimes(2);
  });
  it("bounds prediction body and marks unusable 2xx", async () => {
    network.send.mockResolvedValueOnce(json({ access_token: "fake-token" })).mockResolvedValueOnce(new Response(new ReadableStream({ start() {} })));
    expect((await call(undefined, { timeoutMs: 100 })).acceptedJob).toBeDefined();
  });
  it("client abort during mint is unsubmitted", async () => {
    const controller = new AbortController();
    network.send.mockImplementation(async () => { controller.abort(); throw controller.signal.reason; });
    const result = await call({ signal: controller.signal });
    expect(result.status).toBe(499); expect(result.acceptedJob).toBeUndefined();
  });
  it("client abort after submission is unknown accepted work", async () => {
    const controller = new AbortController();
    network.send.mockResolvedValueOnce(json({ access_token: "fake-token" })).mockImplementation(async () => { controller.abort(); throw controller.signal.reason; });
    const result = await call({ signal: controller.signal });
    expect(result.status).toBe(499); expect(result.acceptedJob).toBeDefined();
  });
  it("pre-aborted request never sends", async () => {
    expect((await call({ signal: AbortSignal.abort() })).status).toBe(499);
    expect(network.send).not.toHaveBeenCalled();
  });
  it("distinguishes proven unsent connection failures", async () => {
    network.send.mockResolvedValueOnce(json({ access_token: "fake-token" })).mockRejectedValueOnce(Object.assign(new Error("fake-secret"), { cause: { code: "ECONNREFUSED" } }));
    const result = await call(); expect(result.acceptedJob).toBeUndefined(); expect(result.status).toBe(502);
  });
  it.each([{}, { error: "fake-secret" }, predictions(2), predictions(1, 3)])("marks malformed 2xx as uncertain without retry: %j", async (raw) => {
    network.send.mockResolvedValueOnce(json({ access_token: "fake-token" })).mockResolvedValueOnce(json(raw));
    expect((await call()).acceptedJob).toBeDefined(); expect(network.send).toHaveBeenCalledTimes(2);
  });
  it("preserves partial Gemini acceptance even when next send is proven unsent", async () => {
    network.send.mockResolvedValueOnce(json({ access_token: "fake-token" })).mockResolvedValueOnce(json(predictions())).mockRejectedValueOnce(Object.assign(new Error("unsent"), { code: "ECONNREFUSED" }));
    const result = await call({ model: "gemini-embedding-001", body: { input: ["a", "b"], dimensions: 2 } });
    expect(result.acceptedJob).toBeDefined(); expect(network.send).toHaveBeenCalledTimes(3);
  });
  it("packs source base64 locally and echoes provider-scoped model", async () => {
    const result = await call({ body: { model: "vertex/text-embedding-005", input: "a", dimensions: 2, encoding_format: "base64" } });
    const payload = await result.response.json();
    expect(payload.model).toBe("vertex/text-embedding-005");
    const bytes = Buffer.from(payload.data[0].embedding, "base64");
    expect(bytes.readFloatLE(0)).toBe(0.25);
    expect(bytes.length).toBe(8);
    expect(JSON.parse(network.send.mock.calls[1][1].body)).not.toHaveProperty("encoding_format");
  });
  it("uses one total deadline across mint and predict", async () => {
    network.send.mockImplementation(async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return url.endsWith("/token") ? json({ access_token: "fake-token" }) : json(predictions());
    });
    const result = await call(undefined, { timeoutMs: 110 });
    expect(result.status).toBe(504); expect(result.acceptedJob).toBeDefined();
    expect(network.send.mock.calls[0][1].signal).toBe(network.send.mock.calls[1][1].signal);
  });
  it("marks later Gemini 4xx as accepted partial work and stops", async () => {
    network.send.mockResolvedValueOnce(json({ access_token: "fake-token" })).mockResolvedValueOnce(json(predictions())).mockResolvedValueOnce(json({}, 429));
    const result = await call({ model: "gemini-embedding-001", body: { input: ["a", "b", "c"], dimensions: 2 } });
    expect(result.status).toBe(429); expect(result.acceptedJob).toBeDefined(); expect(network.send).toHaveBeenCalledTimes(3);
  });
  it("merges sequential single-input Gemini responses in order", async () => {
    const result = await call({ model: "gemini-embedding-001", body: { input: ["a", "b"], dimensions: 2 } });
    expect(result.success).toBe(true); expect(network.send).toHaveBeenCalledTimes(3);
    expect((await result.response.json()).data.map((row) => row.index)).toEqual([0, 1]);
    expect(network.send.mock.calls.slice(1).map(([, init]) => JSON.parse(init.body).instances.length)).toEqual([1, 1]);
  });
  it("runs actual gateway native dispatch without shared refresh or replay", async () => {
    const success = vi.fn(), refresh = vi.fn();
    const result = await handleEmbeddingsCore({ ...params(), modelInfo: { provider: "vertex", model: "text-embedding-005" }, onRequestSuccess: success, refreshCredentials: refresh });
    expect(result.success).toBe(true); expect(success).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled();
    network.send.mockReset(); network.send.mockResolvedValueOnce(json({ access_token: "fake-token" })).mockResolvedValueOnce(json({}, 503));
    const failed = await handleEmbeddingsCore({ ...params(), modelInfo: { provider: "vertex", model: "text-embedding-005" }, refreshCredentials: refresh });
    expect(failed.acceptedJob).toBeDefined(); expect(network.send).toHaveBeenCalledTimes(2); expect(refresh).not.toHaveBeenCalled();
  });
});
