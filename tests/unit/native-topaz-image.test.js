// Topaz Labs native image enhance adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered by an injected fetch, an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (handlers/imageGeneration.ts
// handleTopazImageGeneration, config/imageRegistryData.ts). Passing here says
// nothing about the live service.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-topaz-image/index.js";
import {
  TOPAZ_IMAGE_MODELS,
  TOPAZ_MAX_INPUT_IMAGE_BYTES,
  buildTopazEnhanceForm,
  buildTopazEnhanceHeaders,
  createTopazImageAdapter,
  decodeTopazInputImage,
  parseTopazImageRequest,
  resolveTopazImageCredential,
  resolveTopazImageModel,
  sniffTopazImage,
  topazImageAdapter,
} from "../../open-sse/services/providerParity/native-topaz-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import topazRegistry from "../../open-sse/providers/registry/topaz.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const URL_ENHANCE = "https://api.topazlabs.com/image/v1/enhance";
const KEY_A = "tpz-SYNTHETIC-key-a-0001";
const KEY_B = "tpz-SYNTHETIC-key-b-0002";
const CONN_A = { apiKey: KEY_A };
const CONN_B = { apiKey: KEY_B };
const NOW = 1_800_000_000_000;
const PROMPT = "sharpen the silver gate";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(44, 1)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(36, 2)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(30, 3)]);
const PNG_URI = `data:image/png;base64,${PNG.toString("base64")}`;
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-topaz-image/registration.json", import.meta.url), "utf8"));

const image = (bytes, status = 200, headers = {}) =>
  new Response(bytes, { status, headers: { "content-type": "image/jpeg", ...headers } });
const json = (value, status, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status) => json({ message: `upstream echo ${KEY_A} ${KEY_B} ${PROMPT}` }, status);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

let calls;
let steps;
const fetchImpl = vi.fn(async (url, init) => {
  calls.push({ url: String(url), init });
  const step = steps.shift();
  if (!step) throw new Error(`Unexpected request: ${url}`);
  return isFunction(step) ? step(String(url), init) : step;
});
const serve = (...answers) => { steps = answers; };

const adapter = (options = {}) => createTopazImageAdapter({ fetchImpl, now: () => NOW, ...options });
const generate = (body = {}, { model = "topaz-enhance", credentials = CONN_A, signal, options } = {}) =>
  adapter(options).generate({ model, body: { prompt: PROMPT, image: PNG_URI, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const formEntries = (form) => [...form.entries()].map(([name, value]) => [name, typeof value === "string" ? value : "<blob>"]);
const assertNoLeak = async (result) => {
  const text = `${result.response ? await result.response.clone().text() : ""} ${result.error ?? ""} ${JSON.stringify(result.errorBody ?? "")}`;
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};
// Resolves only when the injected signal aborts, like a real socket.
const hang = (_url, init) => new Promise((_, rejectHang) => {
  init.signal.addEventListener("abort", () => rejectHang(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
});

beforeEach(() => {
  calls = [];
  steps = [];
  fetchImpl.mockClear();
});

// --- Isolated staging-state block: registration flips only these checks. ---
describe("staging state (isolated)", () => {
  it("stays unregistered and leaves the existing topaz registry entry unchanged", () => {
    expect(getImageAdapter("topaz")).toBeNull();
    expect(topazRegistry.models).toBeUndefined();
    expect(topazRegistry.imageConfig).toBeUndefined();
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.TOPAZ_PROVIDER_ID).toBe("topaz");
    expect(staged.TOPAZ_API_ORIGIN).toBe("https://api.topazlabs.com");
    expect(staged.TOPAZ_ENHANCE_URL).toBe(URL_ENHANCE);
    expect(staged.TOPAZ_IMAGE_FORMAT).toBe("topaz");
    expect(staged.TOPAZ_AUTH_HEADER.toLowerCase()).toBe("x-api-key");
    expect(TOPAZ_IMAGE_MODELS).toEqual([{ id: "topaz-enhance", name: "topaz-enhance", inputModalities: ["image"] }]);
    expect(staged.TOPAZ_IMAGE_SIZES).toEqual(["1024x1024"]);
    expect(topazImageAdapter.provider).toBe("topaz");
    expect(topazImageAdapter.aliases).toEqual([]);
    expect(topazImageAdapter.responseFormats).toEqual(["url", "b64_json"]);
    expect(topazImageAdapter.defaultResponseFormat).toBe("url");
    expect(isFunction(topazImageAdapter.generate)).toBe(true);
  });

  it("matches the local provider identity and auth mode it reuses", () => {
    expect(topazRegistry.id).toBe(staged.TOPAZ_PROVIDER_ID);
    expect(topazRegistry.alias).toBe("topaz");
    expect(topazRegistry.authType).toBe("apikey");
    expect(topazRegistry.category).toBe("apikey");
    expect(topazRegistry.serviceKinds).toEqual(["image"]);
  });

  it("registration.json matches the module", () => {
    expect(REGISTRATION.issue).toBe("#2034");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("topaz");
    expect(REGISTRATION.provider.aliases).toEqual([]);
    expect(REGISTRATION.provider.serviceKinds).toEqual(["image"]);
    expect(REGISTRATION.provider.authModes).toEqual(["apikey"]);
    expect(REGISTRATION.provider.auth.header).toBe("X-API-Key");
    expect(REGISTRATION.endpoints.enhance.url).toBe(URL_ENHANCE);
    expect(REGISTRATION.models.map((m) => m.id)).toEqual(TOPAZ_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.request.responseFormats).toEqual([...topazImageAdapter.responseFormats]);
    expect(REGISTRATION.bounds.maxInputImageBytes).toBe(TOPAZ_MAX_INPUT_IMAGE_BYTES);
    for (const name of Object.keys(REGISTRATION.exports).filter((key) => !key.includes("*"))) {
      expect(staged[name], name).toBeDefined();
    }
  });
});

describe("request contract", () => {
  it("parses the source fields and defaults", () => {
    const request = parseTopazImageRequest("topaz/topaz-enhance", { image: PNG_URI });
    expect(request.model).toBe("topaz-enhance");
    expect(request.output).toBeNull();
    expect(request.responseFormat).toBe("url");
    expect(request.prompt).toBeUndefined();
    expect(request.image.format).toBe("png");
    expect(Buffer.from(request.image.bytes).equals(PNG)).toBe(true);
    expect(parseTopazImageRequest("topaz-enhance", { image_url: PNG_URI, size: "2048x1536", n: 1, response_format: "b64_json", user: "u", stream: false }).output)
      .toEqual({ width: 2048, height: 1536 });
  });

  it("accepts the source input fields and identical duplicates", () => {
    for (const body of [{ image: PNG_URI }, { image_url: PNG_URI }, { image_urls: [PNG_URI] }, { imageUrls: [PNG_URI] },
      { image: PNG_URI, image_url: PNG_URI, image_urls: [PNG_URI] }]) {
      expect(parseTopazImageRequest("topaz-enhance", body).image.format).toBe("png");
    }
  });

  it("decodes inline PNG, JPEG and WebP and refuses anything else", () => {
    expect(decodeTopazInputImage(JPEG.toString("base64")).mime).toBe("image/jpeg");
    expect(decodeTopazInputImage(`data:image/webp;base64,${WEBP.toString("base64")}`).mime).toBe("image/webp");
    expect(decodeTopazInputImage(`data:image/jpg;base64,${JPEG.toString("base64")}`).mime).toBe("image/jpeg");
    expect(() => decodeTopazInputImage(GIF.toString("base64"))).toThrow(/PNG, JPEG or WebP/);
    expect(() => decodeTopazInputImage(Buffer.from("<svg onload=alert(1)></svg>....").toString("base64"))).toThrow(/PNG, JPEG or WebP/);
    expect(() => decodeTopazInputImage(`data:image/jpeg;base64,${PNG.toString("base64")}`)).toThrow(/not the declared/);
    expect(() => decodeTopazInputImage("data:image/png,raw")).toThrow(/base64-encoded/);
    expect(() => decodeTopazInputImage("not!base64")).toThrow(/valid base64/);
  });

  it("resolves the provider prefix and refuses unknown models", () => {
    expect(resolveTopazImageModel("topaz/topaz-enhance")).toBe("topaz-enhance");
    expect(resolveTopazImageModel("topaz-enhance")).toBe("topaz-enhance");
    expect(resolveTopazImageModel("upscale")).toBeNull();
    expect(resolveTopazImageModel("fal-ai/topaz-enhance")).toBeNull();
    expect(resolveTopazImageModel(42)).toBeNull();
  });

  it.each([
    [{ image: undefined }, /requires an input image/],
    [{ image: "https://cdn.example/a.png" }, /image URLs are not fetched/],
    [{ image: "http://127.0.0.1/a.png" }, /image URLs are not fetched/],
    [{ image: undefined, image_urls: ["file:///etc/passwd"] }, /image URLs are not fetched/],
    [{ image_urls: [PNG_URI, JPEG.toString("base64")] }, /exactly one input image/],
    [{ image_urls: PNG_URI }, /must be an array/],
    [{ image: 7 }, /must be a string/],
    [{ size: "banana" }, /WIDTHxHEIGHT/],
    [{ size: "0x10" }, /WIDTHxHEIGHT/],
    [{ size: "9000x10" }, /WIDTHxHEIGHT/],
    [{ size: 1024 }, /WIDTHxHEIGHT/],
    [{ n: 2 }, /n = 1 only/],
    [{ n: "1" }, /n = 1 only/],
    [{ stream: true }, /streaming/],
    [{ response_format: "binary" }, /response_format url, b64_json only/],
    [{ prompt: "x".repeat(8001) }, /must not exceed/],
    [{ mask: PNG_URI }, /does not support mask/],
    [{ messages: [] }, /does not support messages/],
    [{ output_format: "png" }, /does not support output_format/],
    [{ topaz_model: "Standard V2" }, /does not support topaz_model/],
    [{ sharpen: 0.5 }, /does not support sharpen/],
  ])("refuses %j before any request", async (extra, message) => {
    const result = await generate(extra);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses an oversized input before any request", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(TOPAZ_MAX_INPUT_IMAGE_BYTES)]).toString("base64");
    const result = await generate({ image: big });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/must not exceed/);
    expect(calls).toHaveLength(0);
  });

  it("refuses an unknown model before any request", async () => {
    const result = await generate({}, { model: "topaz-upscale" });
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("wire contract", () => {
  it("sends the exact source URL, headers and multipart form", async () => {
    serve(image(JPEG));
    const result = await generate({ size: "2048x1024" }, { model: "topaz/topaz-enhance" });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(URL_ENHANCE);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(call.init.headers).toEqual({ Accept: "image/jpeg", "X-API-Key": KEY_A });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(call.init.body).toBeInstanceOf(FormData);
    expect(formEntries(call.init.body)).toEqual([["image", "<blob>"], ["output_width", "2048"], ["output_height", "1024"]]);
    const file = call.init.body.get("image");
    expect(file.name).toBe("image.png");
    expect(file.type).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
    // The prompt is echoed only; it never goes upstream.
    expect([...call.init.body.keys()]).not.toContain("prompt");
  });

  it("omits output dimensions when no size is given and uploads with the sniffed type", async () => {
    serve(image(JPEG));
    await generate({ image: undefined, image_url: JPEG.toString("base64") });
    const form = calls[0].init.body;
    expect(formEntries(form)).toEqual([["image", "<blob>"]]);
    expect(form.get("image").type).toBe("image/jpeg");
    expect(form.get("image").name).toBe("image.png");
  });

  it("builds the same form and headers through the exported helpers", () => {
    const request = parseTopazImageRequest("topaz-enhance", { image: PNG_URI, size: "1024x1024" });
    expect(formEntries(buildTopazEnhanceForm(request))).toEqual([["image", "<blob>"], ["output_width", "1024"], ["output_height", "1024"]]);
    expect(buildTopazEnhanceHeaders(KEY_B)).toEqual({ Accept: "image/jpeg", "X-API-Key": KEY_B });
  });

  it("uses each selected connection's own key (two credentials)", async () => {
    serve(image(JPEG), image(JPEG));
    await generate({}, { credentials: CONN_A });
    await generate({}, { credentials: CONN_B });
    expect(calls.map((c) => c.init.headers["X-API-Key"])).toEqual([KEY_A, KEY_B]);
  });

  it("follows the source credential order and ignores a connection baseUrl", async () => {
    expect(resolveTopazImageCredential({ apiKey: " k1 ", accessToken: "t1" })).toBe("k1");
    expect(resolveTopazImageCredential({ apiKey: "", accessToken: "t1" })).toBe("t1");
    expect(resolveTopazImageCredential({})).toBeNull();
    serve(image(JPEG));
    await generate({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example", providerSpecificData: { baseUrl: "http://127.0.0.1" } } });
    expect(calls[0].url).toBe(URL_ENHANCE);
  });

  it("refuses a connection without a key before any request", async () => {
    const result = await generate({}, { credentials: { cookie: "x=1" } });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("success normalization", () => {
  it("returns a data: URL by default with the sniffed type; one image, unknown cost", async () => {
    // Upstream claims JPEG but sends PNG: the sniffed type wins.
    serve(image(PNG));
    const result = await generate();
    expect(await payload(result)).toEqual({
      created: Math.floor(NOW / 1000),
      data: [{ url: `data:image/png;base64,${PNG.toString("base64")}`, revised_prompt: PROMPT }],
    });
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(result.accounting.nativeUnits.images).toBe(1);
    expect(result.accounting.cost).toBeNull();
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.acceptedJob).toBeUndefined();
  });

  it("returns b64_json when asked, without a prompt when none was given", async () => {
    serve(image(WEBP, 200, { "content-type": "image/webp" }));
    const result = await generate({ response_format: "b64_json", prompt: undefined });
    expect(await payload(result)).toEqual({ created: Math.floor(NOW / 1000), data: [{ b64_json: WEBP.toString("base64") }] });
  });

  it("sniffs only PNG, JPEG and WebP bytes", () => {
    expect(sniffTopazImage(new Uint8Array(PNG))).toBe("png");
    expect(sniffTopazImage(new Uint8Array(JPEG))).toBe("jpeg");
    expect(sniffTopazImage(new Uint8Array(WEBP))).toBe("webp");
    expect(sniffTopazImage(new Uint8Array(GIF))).toBeNull();
    expect(sniffTopazImage(new Uint8Array(Buffer.from("<html>hello world</html>")))).toBeNull();
    expect(sniffTopazImage(new Uint8Array(4))).toBeNull();
    expect(sniffTopazImage("png")).toBeNull();
  });

  it.each([
    ["an empty body", () => image(Buffer.alloc(0))],
    ["HTML", () => new Response("<html>error page</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["SVG", () => image(Buffer.from("<svg onload=alert(1)></svg>"), 200, { "content-type": "image/svg+xml" })],
    ["JSON", () => json({ status: "ok", url: "https://cdn.example/x.jpg" }, 200)],
    ["a body over the bound", () => image(JPEG, 200, { "content-length": String(64 * 1024 * 1024) })],
  ])("a 2xx with %s is accepted work: acceptedJob, no replay", async (_name, answer) => {
    serve(answer());
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.success).toBe(false);
    expect(result.acceptedJob?.costSource).toBe("accepted-job");
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(1);
  });
});

describe("refused answers and quota", () => {
  it.each([401, 403])("passes %i as an auth failure without leaking the body or key", async (status) => {
    serve(leaky(status));
    const result = await generate();
    expect(result.status).toBe(status);
    expect(result.acceptedJob).toBeUndefined();
    expect(result.quotaExhausted).toBeUndefined();
    await assertNoLeak(result);
  });

  it("marks 402 as quota exhausted for this connection only", async () => {
    serve(leaky(402), image(JPEG));
    const first = await generate({}, { credentials: CONN_A });
    expect(first.status).toBe(402);
    expect(first.quotaExhausted).toBe(true);
    expect(first.acceptedJob).toBeUndefined();
    await assertNoLeak(first);
    const second = await generate({}, { credentials: CONN_B });
    expect(second.success).toBe(true);
    expect(calls.map((c) => c.init.headers["X-API-Key"])).toEqual([KEY_A, KEY_B]);
  });

  it("keeps a bounded Retry-After on 429", async () => {
    serve(json({ message: "slow down" }, 429, { "retry-after": "30" }));
    const result = await generate();
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBeGreaterThan(Date.now() + 20_000);
    expect(result.rateLimitEvidence.source).toBe("retry_after");
    expect(result.acceptedJob).toBeUndefined();
  });

  it.each([400, 413, 422])("passes %i without the upstream body and no acceptedJob", async (status) => {
    serve(leaky(status));
    const result = await generate();
    expect(result.status).toBe(status);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it.each([500, 503])("treats %i as an unknown outcome and never resends", async (status) => {
    serve(leaky(status));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("refuses a redirect without following it or resending the key", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } }));
    const result = await generate();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("treats an answer from another origin as possibly billed", async () => {
    const foreign = image(JPEG);
    Object.defineProperty(foreign, "url", { value: "https://evil.example/image/v1/enhance" });
    serve(foreign);
    const result = await generate();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });
});

describe("transport, cancellation and deadlines", () => {
  it("a pre-connect failure was not sent and has no acceptedJob", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("a mid-flight disconnect is uncertain, carries acceptedJob and is not replayed", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("the submit deadline aborts the socket and reports an uncertain outcome", async () => {
    serve(hang);
    const result = await generate({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("the total deadline caps the submit budget", async () => {
    serve(hang);
    const started = Date.now();
    const result = await generate({}, { options: { submitTimeoutMs: 60_000, timeoutMs: 20, now: Date.now } });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.status).toBe(504);
    expect(calls[0].init.signal.aborted).toBe(true);
  });

  it("the deadline also bounds a stalled body read after a 2xx", async () => {
    serve(() => new Response(new ReadableStream({ start() {} }), { status: 200 }));
    const result = await generate({}, { options: { timeoutMs: 30, now: Date.now } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("a caller abort during the body read keeps acceptedJob", async () => {
    const controller = new AbortController();
    serve(() => {
      setTimeout(() => controller.abort(), 5);
      return new Response(new ReadableStream({ start() {} }), { status: 200 });
    });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("a caller abort mid-flight aborts the request and keeps acceptedJob", async () => {
    const controller = new AbortController();
    serve((url, init) => {
      setTimeout(() => controller.abort(), 5);
      return hang(url, init);
    });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("a transport that ignores the signal still ends the wait", async () => {
    const controller = new AbortController();
    serve(() => {
      setTimeout(() => controller.abort(), 5);
      return new Promise(() => {});
    });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeDefined();
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
