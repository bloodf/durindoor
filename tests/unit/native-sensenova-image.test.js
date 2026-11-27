// SenseNova (China) native image adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered by an injected fetch, an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (config/imageRegistryData.ts `sensenova`,
// handlers/imageGeneration.ts handleOpenAIImageGeneration,
// handlers/imageGeneration/openAiImageFetch.ts). Passing here says nothing
// about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-sensenova-image/index.js";
import {
  SENSENOVA_IMAGE_MODELS,
  buildSensenovaImageRequest,
  createSensenovaImageAdapter,
  normalizeSensenovaImageItems,
  resolveSensenovaImageCredential,
  resolveSensenovaImageModel,
  sensenovaImageAdapter,
} from "../../open-sse/services/providerParity/native-sensenova-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import sensenovaRegistry from "../../open-sse/providers/registry/sensenova.js";
import sensenovaIntlRegistry from "../../open-sse/providers/registry/sensenova-intl.js";
import { isFunction, isString } from "../../src/shared/utils/typeChecks.js";

const ENDPOINT = "https://api.sensenova.cn/v1/images/generations";
const KEY_A = "sn-SYNTHETIC-key-a-0001";
const KEY_B = "sn-SYNTHETIC-key-b-0002";
const CONN_A = { apiKey: KEY_A };
const CONN_B = { accessToken: KEY_B };
const MODEL = "sensenova-u1-fast";
const PROMPT = "a silver gate in a green forest";
const NOW = 1_800_000_000_000;
const URL_A = "https://cdn.sensenova.example/img/a.png";
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 7)]).toString("base64");
const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 3)]).toString("base64");
const SVG_B64 = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>x()</script></svg>").toString("base64");
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-sensenova-image/registration.json", import.meta.url), "utf8"));

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

const adapter = (options = {}) => createSensenovaImageAdapter({ fetchImpl, now: () => NOW, ...options });
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
  it("stays unregistered and leaves the existing sensenova chat entry unchanged", () => {
    expect(getImageAdapter("sensenova")).toBeNull();
    expect(sensenovaRegistry.serviceKinds).toBeUndefined();
    expect(sensenovaRegistry.imageConfig).toBeUndefined();
    expect(sensenovaRegistry.category).toBe("freeTier");
    expect(sensenovaRegistry.transport.baseUrl).toBe("https://token.sensenova.cn/v1/chat/completions");
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("sensenova-intl is a different contract (not an equivalent)", () => {
  it("keeps its own host and adapter, which this staging does not replace", () => {
    expect(sensenovaIntlRegistry.imageConfig.baseUrl).toBe("https://token.sensenova.ai/v1/images/generations");
    expect(new URL(sensenovaIntlRegistry.imageConfig.baseUrl).origin).not.toBe(new URL(ENDPOINT).origin);
    expect(getImageAdapter("sensenova-intl")).not.toBeNull();
    expect(getImageAdapter("sensenova-intl")).not.toBe(sensenovaImageAdapter);
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.SENSENOVA_PROVIDER_ID).toBe("sensenova");
    expect(staged.SENSENOVA_PROVIDER_ALIASES).toEqual([]);
    expect(staged.SENSENOVA_IMAGE_URL).toBe(ENDPOINT);
    expect(staged.SENSENOVA_IMAGE_FORMAT).toBe("openai");
    expect(SENSENOVA_IMAGE_MODELS).toEqual([{ id: MODEL, name: "SenseNova U1 Fast" }]);
    expect(staged.SENSENOVA_IMAGE_SIZES).toEqual(["1024x1024"]);
    expect(sensenovaImageAdapter.provider).toBe("sensenova");
    expect(sensenovaImageAdapter.responseFormats).toEqual(["url", "b64_json"]);
    expect(isFunction(sensenovaImageAdapter.generate)).toBe(true);
  });

  it("registration.json matches the module", () => {
    expect(REGISTRATION.issue).toBe("#2034");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("sensenova");
    expect(REGISTRATION.provider.aliases).toEqual([]);
    expect(REGISTRATION.provider.serviceKinds).toEqual(["image"]);
    expect(REGISTRATION.provider.authModes).toEqual(["apikey"]);
    expect(REGISTRATION.provider.auth.sentTo).toEqual(["https://api.sensenova.cn"]);
    expect(REGISTRATION.models.map((m) => m.id)).toEqual(SENSENOVA_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.generate.url).toBe(ENDPOINT);
    expect(Object.keys(REGISTRATION.endpoints)).toEqual(["generate"]);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
  });
});

describe("request contract", () => {
  it("sends the source minimum { model, prompt } when nothing else is set", () => {
    expect(buildSensenovaImageRequest(MODEL, { prompt: PROMPT })).toEqual({ model: MODEL, prompt: PROMPT });
  });

  it("keeps the source field order for optional fields", () => {
    const body = buildSensenovaImageRequest(`sensenova/${MODEL}`, {
      prompt: PROMPT, style: "vivid", response_format: "b64_json", quality: "hd", size: "1024x1024", n: 2, output_format: "WEBP", user: "u-1",
    });
    expect(JSON.stringify(body)).toBe(JSON.stringify({
      model: MODEL, prompt: PROMPT, output_format: "webp", n: 2, size: "1024x1024", quality: "hd", response_format: "b64_json", style: "vivid",
    }));
  });

  it("strips the sensenova/ prefix and passes any safe model id through like the source", () => {
    expect(resolveSensenovaImageModel(`sensenova/${MODEL}`)).toBe(MODEL);
    expect(resolveSensenovaImageModel("sensenova-u1.5-lite")).toBe("sensenova-u1.5-lite");
    for (const bad of ["", "..", "../etc", "a/b", "sensenova-intl/x", "http://x", "a b", "a?x=1", null, 7]) {
      expect(resolveSensenovaImageModel(bad), String(bad)).toBeNull();
    }
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
    [{ mask: "abc" }, /does not support mask/],
    [{ background: "transparent" }, /does not support background/],
    [{ watermark: true }, /does not support watermark/],
    [{ prompt_extend: true }, /does not support prompt_extend/],
    [{ output_compression: 50 }, /does not support output_compression/],
  ])("refuses %j before any network call", async (extra, message) => {
    const result = await generate(extra);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing key or unsafe model before any network call", async () => {
    expect((await generate({}, { credentials: {} })).status).toBe(401);
    expect((await generate({}, { credentials: { apiKey: "   " } })).status).toBe(401);
    expect((await generate({}, { model: "../x" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("uses apiKey before accessToken like the source", () => {
    expect(resolveSensenovaImageCredential({ apiKey: KEY_A, accessToken: KEY_B })).toBe(KEY_A);
    expect(resolveSensenovaImageCredential(CONN_B)).toBe(KEY_B);
    expect(resolveSensenovaImageCredential(null)).toBeNull();
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

  it("has no fallback host: a 404 is a model-not-served answer with one request", async () => {
    serve(leaky(404), json({ data: [{ url: URL_A }] }));
    const result = await generate();
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(404);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it.each([500, 502, 503])("never replays a %i (uncertain work)", async (status) => {
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
    const { items, unsafe } = normalizeSensenovaImageItems({ data: [
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
    serve(json({ data: [{ url: URL_A }] }, 200, {}, "https://evil.example/v1/images/generations"));
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

  it("the total deadline caps the submit when shorter than the per-call one", async () => {
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
