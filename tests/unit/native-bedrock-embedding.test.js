import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { createBedrockEmbeddingAdapter, BEDROCK_EMBEDDING_MODELS, buildBedrockEmbeddingRequest, discoverBedrockEmbeddingModels } from "../../open-sse/services/providerParity/native-bedrock-embedding/index.js";
import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import registry from "../../open-sse/providers/registry/bedrock.js";
const MODEL = "amazon.titan-embed-text-v2:0";
const vector = (width = 1024) => Array(width).fill(0.25);
const json = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers });
const success = () => json({ embedding: vector(), inputTextTokenCount: 4 });
const call = (fetch, { model = MODEL, body = {}, credentials = { apiKey: "key-a" }, signal, timeoutMs } = {}) => createBedrockEmbeddingAdapter({ fetch, timeoutMs }).embed({ model, body: { input: "hello", ...body }, credentials, signal });
// Staging-only assertions; registration may replace ONLY this block.
describe("isolated staging state", () => {
  it("has no production registration and preserves chat aliases/auth", () => {
    expect(getEmbeddingAdapter("bedrock")).toBeNull();
    expect(getEmbeddingAdapter("br")).toBeNull();
    expect(registry.aliases).toContain("br");
    expect(registry.credentialForm).toBe("aws");
    expect(registry.apiKeyOptionalWith).toBe("profile");
  });
});
describe("native embedding wire contracts", () => {
  it("sends exact source endpoint/header/envelope with selected region and credentials", async () => {
    const send = vi.fn(async () => success());
    for (const apiKey of ["key-a", "key-b"]) {
      const result = await call(send, { credentials: { apiKey, providerSpecificData: { region: "eu-west-2", baseUrl: "https://evil.example" } } });
      expect(result.success).toBe(true);
    }
    for (const [index, [url, init]] of send.mock.calls.entries()) {
      expect(url).toBe("https://bedrock-runtime.eu-west-2.amazonaws.com/model/amazon.titan-embed-text-v2%3A0/invoke");
      expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer key-${index ? "b" : "a"}` });
      expect(JSON.parse(init.body)).toEqual({ inputText: "hello" });
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("manual");
    }
  });
  it("fans Titan out in order and sums reported usage", async () => {
    const send = vi.fn(async () => success());
    const result = await call(send, { body: { input: ["a", "b"], encoding_format: "base64" } });
    expect(send).toHaveBeenCalledTimes(2);
    const output = await result.response.json();
    expect(output.usage).toEqual({ prompt_tokens: 8, total_tokens: 8 });
    expect(Buffer.from(output.data[0].embedding, "base64").readFloatLE()).toBe(0.25);
    expect(result.accounting.costStatus).toBe("unknown");
  });
  it.each(BEDROCK_EMBEDDING_MODELS)("normalizes $id source shapes", async model => {
    const cohere = model.id.startsWith("cohere");
    const send = vi.fn(async () => json(cohere ? { embeddings: model.id.includes("v4") ? { float: [vector(model.dimensions)] } : [vector(model.dimensions)] } : { embeddingsByType: { float: vector(model.dimensions) } }));
    const result = await call(send, { model: model.id });
    expect(result.success).toBe(true);
    expect((await result.response.json()).data[0].embedding).toHaveLength(model.dimensions);
    expect(result.accounting.tokens).toEqual({});
    expect(result.accounting.meta.usageMissing).toBe(true);
    if (cohere) expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ texts: ["hello"], input_type: "search_document" });
  });
  it("maps dimension and task options per family", () => {
    expect(buildBedrockEmbeddingRequest(MODEL, { input: "a", dimensions: 256, normalize: false }).bodies).toEqual([{ inputText: "a", dimensions: 256, normalize: false }]);
    expect(buildBedrockEmbeddingRequest("amazon.titan-embed-image-v1", { input: "a", dimensions: 384 }).bodies).toEqual([{ inputText: "a", embeddingConfig: { outputEmbeddingLength: 384 } }]);
    expect(buildBedrockEmbeddingRequest("cohere.embed-v4:0", { input: ["a", "b"], dimensions: 512, input_type: "search_query" }).bodies).toEqual([{ texts: ["a", "b"], input_type: "search_query", output_dimension: 512 }]);
  });
  it.each([{ input: [] }, { input: [1] }, { input: { image: "http://127.0.0.1" } }, { input: " " }, { input: "a".repeat(20001) }, { stream: true }, { dimensions: 3 }, { normalize: "yes" }, { input_type: "image" }, { encoding_format: "int8" }])("rejects unsupported input before send: %j", async body => {
    const send = vi.fn();
    expect((await call(send, { body })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{ apiKey: "bad\r\nkey" }, { apiKey: "a", providerSpecificData: { profile: "sso" } }, { apiKey: "secret", providerSpecificData: { accessKeyId: "AKIA" } }, { apiKey: "a", providerSpecificData: { region: "evil.example/x" } }])("refuses invalid auth/region without sending", async credentials => {
    const send = vi.fn();
    expect((await call(send, { credentials })).success).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
describe("errors, deadlines and accounting", () => {
  it.each([400, 401, 403, 402, 429, 503])("sanitizes %i and scopes failures to the call", async status => {
    const send = vi.fn(async () => json({ message: "key-a upstream secret" }, status, { "retry-after": "30" }));
    const result = await call(send);
    expect(result.status).toBe(status === 503 ? 502 : status);
    expect(await result.response.text()).not.toContain("key-a");
    expect(Boolean(result.acceptedJob)).toBe(status === 503);
    if (status === 402) expect(result.quotaExhausted).toBe(true);
    expect((await call(async () => success(), { credentials: { accessToken: "key-b" } })).success).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([{ embedding: [1] }, { embedding: vector().fill(null) }, { embedding: "https://127.0.0.1" }, { failureCount: 1, message: "secret" }, { embeddings: { int8: [vector()] } }, {}])("rejects malformed/unsafe output without replay: %j", async body => {
    const send = vi.fn(async () => json(body));
    const result = await call(send);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.costStatus).toBe("unknown");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("refuses redirects without a second request", async () => {
    const send = vi.fn(async () => new Response(null, { status: 307, headers: { location: "http://127.0.0.1" } }));
    expect((await call(send)).status).toBe(502);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("retains partial accepted work when a later input is refused", async () => {
    const send = vi.fn().mockResolvedValueOnce(success()).mockResolvedValueOnce(json({}, 429));
    const result = await call(send, { body: { input: ["a", "b"] } });
    expect(result.acceptedJob.meta.jobState).toBe("partial");
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("never submits pre-aborted work", async () => {
    const send = vi.fn(); const controller = new AbortController(); controller.abort();
    expect((await call(send, { signal: controller.signal })).acceptedJob).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
  it("aborts stalled socket on cancellation and never replays", async () => {
    const controller = new AbortController(); let socket;
    const send = vi.fn(async (_url, init) => { socket = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
    const result = await call(send, { signal: controller.signal });
    expect(result.status).toBe(499); expect(socket.aborted).toBe(true);
    expect(result.acceptedJob).toBeDefined(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("bounds ignored signals and stalled response bodies", async () => {
    for (const send of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
      const result = await call(send, { timeoutMs: 15 });
      expect(result.status).toBe(504); expect(result.acceptedJob).toBeDefined();
    }
  });
  it("distinguishes pre-connect failure from uncertain reset", async () => {
    for (const code of ["ECONNREFUSED", "ECONNRESET"]) {
      const send = vi.fn(async () => { throw Object.assign(new Error("key-a"), { code }); });
      const result = await call(send);
      expect(Boolean(result.acceptedJob)).toBe(code === "ECONNRESET");
      expect(send).toHaveBeenCalledTimes(1);
    }
  });
});
describe("closed discovery", () => {
  it("uses source control endpoints, selected key and bounded pagination", async () => {
    const send = vi.fn().mockResolvedValueOnce(json({ modelSummaries: [{ modelId: MODEL }, { modelId: "evil" }] })).mockResolvedValueOnce(json({ inferenceProfileSummaries: [], nextToken: "token&x" })).mockResolvedValueOnce(json({ inferenceProfileSummaries: [] }));
    expect((await discoverBedrockEmbeddingModels({ credentials: { apiKey: "key-b" }, fetch: send })).map(row => row.id)).toEqual([MODEL]);
    expect(send.mock.calls[0][0]).toBe("https://bedrock.us-east-1.amazonaws.com/foundation-models?byOutputModality=TEXT");
    expect(send.mock.calls[2][0]).toContain("nextToken=token%26x");
    expect(send.mock.calls[0][1].headers).toEqual({ Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer key-b" });
  });
  it("rejects redirect, malformed list, deadline and repeated pagination", async () => {
    for (const send of [async () => new Response(null, { status: 302 }), async () => json({}), async () => new Promise(() => {})]) {
      await expect(discoverBedrockEmbeddingModels({ credentials: { apiKey: "a" }, fetch: send, timeoutMs: 10 })).rejects.toThrow();
    }
    const send = vi.fn().mockResolvedValueOnce(json({ modelSummaries: [] })).mockImplementation(async () => json({ inferenceProfileSummaries: [], nextToken: "same" }));
    await expect(discoverBedrockEmbeddingModels({ credentials: { apiKey: "a" }, fetch: send })).rejects.toThrow(/pagination/);
  });
});

describe("registration and final security contracts", () => {
  it("pins source metadata and exports exact model identities", () => {
    const registration = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-bedrock-embedding/registration.json", import.meta.url), "utf8"));
    expect(registration.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(registration.source.registryFields).toEqual({ id: "bedrock", baseUrl: "https://bedrock-runtime.{region}.amazonaws.com/model/{model}/invoke", authType: "apikey", authHeader: "bearer" });
    expect(registration.models.embedding).toEqual(BEDROCK_EMBEDDING_MODELS.map(model => model.id));
  });
  it("treats an unexpected answering origin as uncertain accepted work", async () => {
    const response = success();
    Object.defineProperty(response, "url", { value: "https://evil.example/answer" });
    const send = vi.fn(async () => response);
    const result = await call(send);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("sanitizes unreadable JSON and aborts a stalled body", async () => {
    const malformed = await call(async () => new Response("key-a not JSON"));
    expect(malformed.acceptedJob).toBeDefined();
    expect(await malformed.response.text()).not.toContain("key-a");
    const controller = new AbortController();
    let cancelled = false;
    const result = await call(async () => {
      setTimeout(() => controller.abort(), 5);
      return new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } }));
    }, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeDefined();
    expect(cancelled).toBe(true);
  });
});
