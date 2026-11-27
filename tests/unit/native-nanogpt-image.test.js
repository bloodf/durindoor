// NanoGPT native image adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered by an injected fetch, an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (config/imageRegistryData.ts `nanogpt`,
// handlers/imageGeneration.ts handleOpenAIImageGeneration,
// handlers/imageGeneration/openAiImageFetch.ts, named OpenAI-style discovery).
// Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-nanogpt-image/index.js";
import {
  NANOGPT_IMAGE_MODELS,
  buildNanoGptImageRequest,
  createNanoGptImageAdapter,
  discoverNanoGptModels,
  nanoGptImageAdapter,
  normalizeNanoGptImageItems,
  parseNanoGptModelList,
  resolveNanoGptImageCredential,
  resolveNanoGptImageModel,
} from "../../open-sse/services/providerParity/native-nanogpt-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import nanogptRegistry from "../../open-sse/providers/registry/nanogpt.js";
import { isFunction, isString } from "../../src/shared/utils/typeChecks.js";

const ENDPOINT = "https://nano-gpt.com/api/v1/images/generations";
const MODELS = "https://nano-gpt.com/api/v1/models";
const KEY_A = "ng-SYNTHETIC-key-a-0001";
const KEY_B = "ng-SYNTHETIC-key-b-0002";
const CONN_A = { apiKey: KEY_A };
const CONN_B = { accessToken: KEY_B };
const MODEL = "qwen-image";
const PROMPT = "a silver gate in a green forest";
const NOW = 1_800_000_000_000;
const URL_A = "https://cdn.nanogpt.example/img/a.png";
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 7)]).toString("base64");
const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 3)]).toString("base64");
const SVG_B64 = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>x()</script></svg>").toString("base64");
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-nanogpt-image/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}, url) => {
  const response = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
};
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo ${KEY_A} ${KEY_B} ${PROMPT}` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

let calls;
let steps;
const fetchImpl = vi.fn(async (url, init) => {
  calls.push({ url: String(url), init, body: isString(init?.body) ? JSON.parse(init.body) : undefined });
  const step = steps.shift();
  if (!step) throw new Error(`Unexpected request: ${url}`);
  return isFunction(step) ? step(String(url), init) : step;
});
const serve = (...answers) => { steps = answers; };

const adapter = (options = {}) => createNanoGptImageAdapter({ fetchImpl, now: () => NOW, ...options });
const generate = (body = {}, { model = MODEL, credentials = CONN_A, signal, options, log } = {}) =>
  adapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal, log });
const payload = async (result) => result.response.clone().json();
const assertNoLeak = async (result) => {
  const text = `${result.response ? await result.response.clone().text() : ""} ${result.error ?? ""} ${JSON.stringify(result)}`;
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};

beforeEach(() => {
  calls = [];
  steps = [];
  fetchImpl.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Staging-only negatives. Registration replaces this block with positive
// registry identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered and leaves the existing nanogpt chat entry unchanged", () => {
    expect(getImageAdapter("nanogpt")).toBeNull();
    expect(nanogptRegistry.serviceKinds).toEqual(["llm"]);
    expect(nanogptRegistry.imageConfig).toBeUndefined();
    expect(nanogptRegistry.authType).toBe("apikey");
    expect(nanogptRegistry.transport.baseUrl).toBe("https://nano-gpt.com/api/v1/chat/completions");
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.NANOGPT_PROVIDER_ID).toBe("nanogpt");
    expect(staged.NANOGPT_PROVIDER_ALIASES).toEqual([]);
    expect(staged.NANOGPT_IMAGE_URL).toBe(ENDPOINT);
    expect(staged.NANOGPT_MODELS_URL).toBe(MODELS);
    expect(staged.NANOGPT_IMAGE_FORMAT).toBe("openai");
    expect(NANOGPT_IMAGE_MODELS.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "qwen-image", name: "Qwen Image" },
      { id: "z-image-turbo", name: "Z Image Turbo" },
      { id: "chroma", name: "Chroma" },
      { id: "hidream", name: "Hidream I1 Full" },
    ]);
    expect(NANOGPT_IMAGE_MODELS[0].sourceInputModalities).toEqual(["text", "image"]);
    expect(staged.NANOGPT_IMAGE_SIZES).toEqual(["1024x1024", "1024x1280", "1280x1024"]);
    expect(nanoGptImageAdapter.provider).toBe("nanogpt");
    expect(nanoGptImageAdapter.responseFormats).toEqual(["url", "b64_json"]);
    expect(isFunction(nanoGptImageAdapter.generate)).toBe(true);
  });

  it("registration.json matches the module", () => {
    expect(REGISTRATION.issue).toBe("#2034");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("nanogpt");
    expect(REGISTRATION.provider.aliases).toEqual([]);
    expect(REGISTRATION.provider.serviceKinds).toEqual(["image"]);
    expect(REGISTRATION.provider.authModes).toEqual(["apikey"]);
    expect(REGISTRATION.provider.auth.sentTo).toEqual(["https://nano-gpt.com"]);
    expect(REGISTRATION.models.map((m) => m.id)).toEqual(NANOGPT_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.generate.url).toBe(ENDPOINT);
    expect(REGISTRATION.endpoints.discovery.url).toBe(MODELS);
    expect(REGISTRATION.endpoints.fallback).toBeUndefined();
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
  });
});

describe("request contract", () => {
  it("sends the source minimum { model, prompt } when nothing else is set", () => {
    expect(buildNanoGptImageRequest(MODEL, { prompt: PROMPT })).toEqual({ model: MODEL, prompt: PROMPT });
  });

  it("keeps the source field order for optional fields", () => {
    const body = buildNanoGptImageRequest("hidream", {
      prompt: PROMPT, style: "vivid", response_format: "b64_json", quality: "hd", size: "1024x1280", n: 2, output_format: "WEBP", user: "u-1",
    });
    expect(JSON.stringify(body)).toBe(JSON.stringify({
      model: "hidream", prompt: PROMPT, output_format: "webp", n: 2, size: "1024x1280", quality: "hd", response_format: "b64_json", style: "vivid",
    }));
  });

  it("passes every source model and any safe id through verbatim (no prefix stripping)", () => {
    for (const { id } of NANOGPT_IMAGE_MODELS) expect(resolveNanoGptImageModel(id)).toBe(id);
    expect(resolveNanoGptImageModel("nanogpt/coding-router:low")).toBe("nanogpt/coding-router:low");
    expect(resolveNanoGptImageModel("black-forest-labs/flux-dev")).toBe("black-forest-labs/flux-dev");
    for (const bad of ["", "../etc", "a/../b", "http://x", "a b", "a?x=1", null, 7]) expect(resolveNanoGptImageModel(bad), String(bad)).toBeNull();
  });

  it.each([
    [{ prompt: "" }, /Prompt is required/],
    [{ prompt: "x".repeat(32_001) }, /must not exceed/],
    [{ stream: true }, /streaming/],
    [{ n: 0 }, /n from 1 to 10/],
    [{ n: 11 }, /n from 1 to 10/],
    [{ n: 1.5 }, /n from 1 to 10/],
    [{ size: "1024" }, /WIDTHxHEIGHT/],
    [{ size: "4096x4096" }, /WIDTHxHEIGHT/],
    [{ response_format: "binary" }, /url or b64_json/],
    [{ output_format: "gif" }, /png, jpeg, webp/],
    [{ output_format: "svg" }, /png, jpeg, webp/],
    [{ quality: "hd; drop" }, /short word/],
    [{ image: "https://x.example/a.png" }, /does not support image/],
    [{ image_url: "https://x.example/a.png" }, /does not support image_url/],
    [{ image_urls: ["https://x.example/a.png"] }, /does not support image_urls/],
    [{ mask: "abc" }, /does not support mask/],
    [{ background: "transparent" }, /does not support background/],
    [{ frame_count: 4 }, /does not support frame_count/],
    [{ output_compression: 50 }, /does not support output_compression/],
  ])("refuses %j before any network call", async (extra, message) => {
    const result = await generate(extra);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses an input image even for qwen-image (source never forwarded it)", async () => {
    const result = await generate({ image_url: "https://x.example/a.png" }, { model: "qwen-image" });
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing key or unsafe model before any network call", async () => {
    expect((await generate({}, { credentials: {} })).status).toBe(401);
    expect((await generate({}, { credentials: { apiKey: "   " } })).status).toBe(401);
    expect((await generate({}, { model: "../x" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("uses apiKey before accessToken like the source", () => {
    expect(resolveNanoGptImageCredential({ apiKey: KEY_A, accessToken: KEY_B })).toBe(KEY_A);
    expect(resolveNanoGptImageCredential(CONN_B)).toBe(KEY_B);
    expect(resolveNanoGptImageCredential(null)).toBeNull();
  });
});

describe("wire contract", () => {
  it("posts JSON with the Bearer key to the fixed origin with manual redirects", async () => {
    serve(json({ created: 321, data: [{ url: URL_A }] }));
    const result = await generate({ size: "1024x1024" });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(ENDPOINT);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(call.init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(call.body).toEqual({ model: MODEL, prompt: PROMPT, size: "1024x1024" });
  });

  it("ignores a connection baseUrl and keeps the key on the fixed origin", async () => {
    serve(json({ data: [{ url: URL_A }] }));
    await generate({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example/v1", providerSpecificData: { baseUrl: "http://127.0.0.1" } } });
    expect(calls[0].url).toBe(ENDPOINT);
  });

  it("uses each connection's own key (two credentials)", async () => {
    serve(json({ data: [{ url: URL_A }] }), json({ data: [{ url: URL_A }] }));
    await generate({}, { credentials: CONN_A });
    await generate({}, { credentials: CONN_B });
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    expect(JSON.stringify(calls[0])).not.toContain(KEY_B);
    expect(JSON.stringify(calls[1])).not.toContain(KEY_A);
  });

  it.each([404, 410])("a %i is a not-served 404 and nothing is retried (no source fallback host)", async (status) => {
    serve(leaky(status), json({ data: [{ url: URL_A }] }));
    const result = await generate();
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(404);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it.each([500, 502, 503])("a %i is uncertain work, carries acceptedJob and is never replayed", async (status) => {
    serve(leaky(status), json({ data: [{ url: URL_A }] }));
    const result = await generate();
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(result.acceptedJob.costStatus).toBe("unknown");
    await assertNoLeak(result);
  });
});

describe("success normalization", () => {
  it("normalizes url items and records returned units with unknown cost", async () => {
    serve(json({ created: 321, data: [{ url: URL_A, revised_prompt: "x" }, { url: URL_A }] }));
    const result = await generate({ n: 2 });
    expect(await payload(result)).toEqual({ created: 321, data: [{ url: URL_A }, { url: URL_A }] });
    expect(result.accounting.nativeUnits.images).toBe(2);
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.accounting.cost).toBeNull();
  });

  it("labels base64 items by sniffed container and reports a uniform output_format", async () => {
    serve(json({ data: [{ b64_json: PNG_B64 }, { b64_json: PNG_B64 }] }));
    const result = await generate({ response_format: "b64_json", output_format: "png", n: 2 });
    const body = await payload(result);
    expect(body.data).toEqual([{ b64_json: PNG_B64, mime_type: "image/png" }, { b64_json: PNG_B64, mime_type: "image/png" }]);
    expect(body.output_format).toBe("png");
    expect(body.created).toBe(Math.floor(NOW / 1000));
    expect(result.accounting.nativeUnits.images).toBe(2);
  });

  it("warns on a container mismatch without relabelling", async () => {
    const log = { warn: vi.fn() };
    serve(json({ data: [{ b64_json: JPEG_B64 }] }));
    const result = await generate({ response_format: "b64_json", output_format: "png" }, { log });
    expect((await payload(result)).data[0].mime_type).toBe("image/jpeg");
    expect(log.warn).toHaveBeenCalled();
  });

  it("keeps upstream usage internal as accounting tokens", async () => {
    serve(json({ data: [{ url: URL_A }], usage: { prompt_tokens: 12, total_tokens: 12 } }));
    const result = await generate();
    expect(result.accounting.tokens.input_tokens).toBe(12);
    expect(await payload(result)).not.toHaveProperty("usage");
  });

  it("drops unsafe items and keeps the safe ones", () => {
    const { items, unsafe } = normalizeNanoGptImageItems({ data: [
      { url: "http://cdn.example/a.png" },
      { url: "https://127.0.0.1/a.png" },
      { url: "https://user:pw@cdn.example/a.png" },
      { url: "https://169.254.169.254/latest" },
      { b64_json: SVG_B64 },
      { b64_json: "not base64!!" },
      { b64_json: Buffer.from("plain text").toString("base64") },
      { url: URL_A },
    ] });
    expect(items).toEqual([{ url: URL_A }]);
    expect(unsafe).toBe(7);
  });
});

describe("malformed and unsafe outputs", () => {
  it.each([
    ["empty data", json({ data: [] })],
    ["no data", json({ created: 1 })],
    ["only unsafe items", json({ data: [{ url: "https://10.0.0.1/a.png" }, { b64_json: SVG_B64 }] })],
    ["non-JSON body", new Response("<html>ok</html>", { status: 200 })],
  ])("a 2xx with %s is a 502 with acceptedJob and no replay", async (_label, answer) => {
    serve(answer, json({ data: [{ url: URL_A }] }));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(1);
  });

  it("an answer from another origin is uncertain and not trusted", async () => {
    serve(json({ data: [{ url: URL_A }] }, 200, {}, "https://evil.example/api/v1/images/generations"));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("a redirect is refused and never followed", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/" } }));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/redirect refused/);
    expect(calls).toHaveLength(1);
  });
});

describe("refused answers and quota", () => {
  it.each([401, 403])("passes %i as an auth failure without the upstream body", async (status) => {
    serve(leaky(status));
    const result = await generate();
    expect(result.status).toBe(status);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("402 marks this connection's quota exhausted", async () => {
    serve(leaky(402));
    const result = await generate();
    expect(result.status).toBe(402);
    expect(result.quotaExhausted).toBe(true);
    await assertNoLeak(result);
  });

  it("429 carries the Retry-After reset", async () => {
    serve(leaky(429, { "retry-after": "30" }));
    const before = Date.now();
    const result = await generate();
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBeGreaterThanOrEqual(before + 29_000);
    expect(result.quotaExhausted).toBeUndefined();
    await assertNoLeak(result);
  });

  it.each([400, 422])("passes a %i validation refusal without quoting the body", async (status) => {
    serve(leaky(status));
    const result = await generate();
    expect(result.status).toBe(status);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });
});

describe("transport, cancellation and deadlines", () => {
  it("a pre-connect failure was not sent and has no acceptedJob", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("a mid-flight disconnect is uncertain, carries acceptedJob and is not replayed", async () => {
    serve(() => { throw transportError("ECONNRESET"); }, json({ data: [{ url: URL_A }] }));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("the submit deadline aborts the socket and reports an uncertain outcome", async () => {
    let seen;
    serve((_url, init) => { seen = init.signal; return new Promise(() => {}); });
    const result = await generate({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("the total deadline caps the submit wait", async () => {
    let seen;
    serve((_url, init) => { seen = init.signal; return new Promise(() => {}); });
    const result = await generate({}, { options: { submitTimeoutMs: 60_000, timeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(seen.aborted).toBe(true);
  });

  it("a stalled body read hits the deadline and keeps acceptedJob", async () => {
    let clock = NOW;
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200 });
    serve(() => { clock += 990; return stalled; });
    const result = await adapter({ now: () => clock, timeoutMs: 1000 }).generate({ model: MODEL, body: { prompt: PROMPT }, credentials: CONN_A });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("a caller abort mid-flight aborts the request and keeps acceptedJob", async () => {
    const controller = new AbortController();
    let seen;
    serve((_url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("an abort before send sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("dynamic model discovery", () => {
  it("GETs the source models URL with the selected key and parses data.data", async () => {
    serve(json({ object: "list", data: [{ id: MODEL }, { id: "nanogpt/coding-router:low" }, { id: MODEL }, { id: "../bad" }, { nope: 1 }] }));
    const result = await discoverNanoGptModels({ apiKey: KEY_B, fetchImpl });
    expect(result).toEqual({ ok: true, models: [MODEL, "nanogpt/coding-router:low"] });
    expect(calls[0].url).toBe(MODELS);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_B}` });
  });

  it("accepts a bare array or data.models and the id || model || name rule like the source", () => {
    expect(parseNanoGptModelList([{ id: "chroma" }, "hidream"])).toEqual(["chroma", "hidream"]);
    expect(parseNanoGptModelList({ models: [{ model: "z-image-turbo" }, { name: "qwen-image" }] })).toEqual(["z-image-turbo", "qwen-image"]);
    expect(parseNanoGptModelList({ nothing: true })).toEqual([]);
  });

  it("refuses without a key, on redirects and on errors without leaking", async () => {
    expect((await discoverNanoGptModels({ apiKey: "", fetchImpl })).status).toBe(401);
    expect(calls).toHaveLength(0);
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example" } }), leaky(401));
    const redirected = await discoverNanoGptModels({ apiKey: KEY_A, fetchImpl });
    expect(redirected).toMatchObject({ ok: false, status: 502 });
    const denied = await discoverNanoGptModels({ apiKey: KEY_A, fetchImpl });
    expect(denied).toMatchObject({ ok: false, status: 401 });
    expect(JSON.stringify(denied)).not.toContain(KEY_A);
  });

  it("is bounded by a deadline and rethrows a caller abort", async () => {
    serve(() => new Promise(() => {}));
    expect(await discoverNanoGptModels({ apiKey: KEY_A, fetchImpl, timeoutMs: 20 })).toMatchObject({ ok: false, status: 504 });
    const controller = new AbortController();
    serve(() => { setTimeout(() => controller.abort(new Error("stop")), 5); return new Promise(() => {}); });
    await expect(discoverNanoGptModels({ apiKey: KEY_A, fetchImpl, signal: controller.signal })).rejects.toThrow("stop");
  });
});
