// Hyperbolic native image adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered by an injected fetch, an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (handlers/imageGeneration/providers/hyperbolic.ts,
// config/imageRegistryData.ts). Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-hyperbolic-image/index.js";
import {
  HYPERBOLIC_IMAGE_MODELS,
  buildHyperbolicImageRequest,
  createHyperbolicImageAdapter,
  extractHyperbolicImages,
  hyperbolicImageAdapter,
  resolveHyperbolicImageCredential,
  resolveHyperbolicImageModel,
  sniffImageBase64,
} from "../../open-sse/services/providerParity/native-hyperbolic-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import hyperbolicRegistry from "../../open-sse/providers/registry/hyperbolic.js";
import { isFunction, isString } from "../../src/shared/utils/typeChecks.js";

const URL_IMAGE = "https://api.hyperbolic.xyz/v1/image/generation";
const KEY_A = "hyp-SYNTHETIC-key-a-0001";
const KEY_B = "hyp-SYNTHETIC-key-b-0002";
const CONN_A = { apiKey: KEY_A };
const CONN_B = { apiKey: KEY_B };
const NOW = 1_800_000_000_000;
const PROMPT = "a silver gate in a green forest";
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]).toString("base64");
const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(44, 1)]).toString("base64");
const WEBP_B64 = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(36, 2)]).toString("base64");
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-hyperbolic-image/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (images) => json({ images, inference_time: 1.2 });
const leaky = (status) => json({ detail: `upstream echo ${KEY_A} ${KEY_B} ${PROMPT}` }, status);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

let calls;
let steps;
const fetchImpl = vi.fn(async (url, init) => {
  calls.push({ url: String(url), init, body: isString(init?.body) ? init.body : undefined });
  const step = steps.shift();
  if (!step) throw new Error(`Unexpected request: ${url}`);
  return isFunction(step) ? step(String(url), init) : step;
});
const serve = (...answers) => { steps = answers; };

const adapter = (options = {}) => createHyperbolicImageAdapter({ fetchImpl, now: () => NOW, ...options });
const generate = (body = {}, { model = "SDXL1.0-base", credentials = CONN_A, signal, options } = {}) =>
  adapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
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
  it("stays unregistered and leaves the existing hyperbolic chat entry unchanged", () => {
    expect(getImageAdapter("hyperbolic")).toBeNull();
    expect(getImageAdapter("hyp")).toBeNull();
    expect(hyperbolicRegistry.serviceKinds).toBeUndefined();
    expect(hyperbolicRegistry.imageConfig).toBeUndefined();
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.HYPERBOLIC_PROVIDER_ID).toBe("hyperbolic");
    expect(staged.HYPERBOLIC_IMAGE_URL).toBe(URL_IMAGE);
    expect(staged.HYPERBOLIC_IMAGE_FORMAT).toBe("hyperbolic");
    expect(HYPERBOLIC_IMAGE_MODELS.map((m) => m.id)).toEqual(["SDXL1.0-base"]);
    expect(staged.HYPERBOLIC_IMAGE_SIZES).toEqual(["1024x1024"]);
    expect(hyperbolicImageAdapter.provider).toBe("hyperbolic");
    expect(hyperbolicImageAdapter.aliases).toEqual(["hyp"]);
    expect(hyperbolicImageAdapter.responseFormats).toEqual(["b64_json"]);
    expect(hyperbolicImageAdapter.defaultResponseFormat).toBe("b64_json");
    expect(isFunction(hyperbolicImageAdapter.generate)).toBe(true);
  });

  it("matches the local provider identity and auth mode it reuses", () => {
    expect(hyperbolicRegistry.id).toBe(staged.HYPERBOLIC_PROVIDER_ID);
    expect(hyperbolicRegistry.aliases).toEqual([...staged.HYPERBOLIC_PROVIDER_ALIASES]);
    expect(hyperbolicRegistry.authType).toBe("apikey");
    expect(new URL(hyperbolicRegistry.transport.baseUrl).origin).toBe(staged.HYPERBOLIC_API_ORIGIN);
  });

  it("registration.json matches the module", () => {
    expect(REGISTRATION.issue).toBe("#2034");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("hyperbolic");
    expect(REGISTRATION.provider.aliases).toEqual(["hyp"]);
    expect(REGISTRATION.provider.serviceKinds).toEqual(["image"]);
    expect(REGISTRATION.provider.authModes).toEqual(["apikey"]);
    expect(REGISTRATION.endpoints.generate.url).toBe(URL_IMAGE);
    expect(REGISTRATION.models.map((m) => m.id)).toEqual(HYPERBOLIC_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.request.responseFormats).toEqual([...hyperbolicImageAdapter.responseFormats]);
    for (const name of Object.keys(REGISTRATION.exports).filter((key) => !key.includes("*"))) {
      expect(staged[name], name).toBeDefined();
    }
  });
});

describe("request contract", () => {
  it("builds the source body in field order with defaults", () => {
    const request = buildHyperbolicImageRequest("SDXL1.0-base", { prompt: `  ${PROMPT} ` });
    expect(JSON.stringify(request)).toBe(JSON.stringify({ model_name: "SDXL1.0-base", prompt: PROMPT, height: 1024, width: 1024, backend: "auto" }));
    expect(buildHyperbolicImageRequest("SDXL1.0-base", { prompt: PROMPT, size: "1024x1024", n: 1, response_format: "b64_json", user: "u", stream: false }))
      .toEqual({ model_name: "SDXL1.0-base", prompt: PROMPT, height: 1024, width: 1024, backend: "auto" });
  });

  it("resolves provider prefixes and refuses unknown models", () => {
    expect(resolveHyperbolicImageModel("hyperbolic/SDXL1.0-base")).toBe("SDXL1.0-base");
    expect(resolveHyperbolicImageModel("hyp/SDXL1.0-base")).toBe("SDXL1.0-base");
    expect(resolveHyperbolicImageModel("FLUX.1-dev")).toBeNull();
    expect(resolveHyperbolicImageModel("sdxl1.0-base")).toBeNull();
    expect(resolveHyperbolicImageModel(42)).toBeNull();
  });

  it.each([
    [{ prompt: "" }, /Prompt is required/],
    [{ prompt: "x".repeat(8001) }, /must not exceed/],
    [{ size: "512x512" }, /size must be one of/],
    [{ size: "banana" }, /size must be one of/],
    [{ n: 2 }, /n = 1 only/],
    [{ n: "1" }, /n = 1 only/],
    [{ stream: true }, /streaming/],
    [{ response_format: "url" }, /b64_json only/],
    [{ mask: "data" }, /does not support mask/],
    [{ image: "data" }, /does not support image/],
    [{ negative_prompt: "x" }, /does not support negative_prompt/],
    [{ seed: 3 }, /does not support seed/],
    [{ quality: "hd" }, /does not support quality/],
  ])("refuses %j before any request", async (extra, message) => {
    const result = await generate(extra);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses an unknown model before any request", async () => {
    const result = await generate({}, { model: "FLUX.1-dev" });
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("wire contract", () => {
  it("sends the exact source URL, headers and body", async () => {
    serve(ok([{ image: PNG_B64, index: 0, random_seed: 1 }]));
    const result = await generate({ size: "1024x1024" }, { model: "hyp/SDXL1.0-base" });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(URL_IMAGE);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(call.init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(call.body).toBe(JSON.stringify({ model_name: "SDXL1.0-base", prompt: PROMPT, height: 1024, width: 1024, backend: "auto" }));
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses each selected connection's own key (two credentials)", async () => {
    serve(ok([{ image: PNG_B64 }]), ok([{ image: PNG_B64 }]));
    await generate({}, { credentials: CONN_A });
    await generate({}, { credentials: CONN_B });
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
  });

  it("follows the source credential order and ignores a connection baseUrl", async () => {
    expect(resolveHyperbolicImageCredential({ apiKey: " k1 ", accessToken: "t1" })).toBe("k1");
    expect(resolveHyperbolicImageCredential({ apiKey: "", accessToken: "t1" })).toBe("t1");
    expect(resolveHyperbolicImageCredential({})).toBeNull();
    serve(ok([{ image: PNG_B64 }]));
    await generate({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example/v1", providerSpecificData: { baseUrl: "http://127.0.0.1" } } });
    expect(calls[0].url).toBe(URL_IMAGE);
  });

  it("refuses a connection without a key before any request", async () => {
    const result = await generate({}, { credentials: { cookie: "x=1" } });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("success normalization", () => {
  it("maps images[].image to b64_json with the prompt; returned images, unknown cost", async () => {
    serve(ok([{ image: PNG_B64 }, { image: JPEG_B64 }, { image: WEBP_B64 }]));
    const result = await generate();
    expect(await payload(result)).toEqual({
      created: Math.floor(NOW / 1000),
      data: [PNG_B64, JPEG_B64, WEBP_B64].map((b64) => ({ b64_json: b64, revised_prompt: PROMPT })),
    });
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(result.accounting.nativeUnits.images).toBe(3);
    expect(result.accounting.cost).toBeNull();
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.acceptedJob).toBeUndefined();
  });

  it("sniffs only strict base64 PNG, JPEG and WebP", () => {
    expect(sniffImageBase64(PNG_B64)).toBe("png");
    expect(sniffImageBase64(JPEG_B64)).toBe("jpeg");
    expect(sniffImageBase64(WEBP_B64)).toBe("webp");
    expect(sniffImageBase64(`data:image/png;base64,${PNG_B64}`)).toBeNull();
    expect(sniffImageBase64(Buffer.from("<svg onload=alert(1)></svg>....").toString("base64"))).toBeNull();
    expect(sniffImageBase64(`${PNG_B64.slice(0, -4)}!!!!`)).toBeNull();
    expect(sniffImageBase64("https://cdn.example/a.png")).toBeNull();
    expect(sniffImageBase64({})).toBeNull();
  });

  it("drops malformed images and keeps the valid ones", () => {
    expect(extractHyperbolicImages({ images: [{ image: PNG_B64 }, { image: "not base64" }, { image: 7 }, null, {}] }))
      .toEqual({ images: [PNG_B64], unsafe: 2 });
    expect(extractHyperbolicImages({ images: "x" })).toEqual({ images: [], unsafe: 0 });
    expect(extractHyperbolicImages(null)).toEqual({ images: [], unsafe: 0 });
  });

  it.each([
    ["no images", () => ok([])],
    ["only unsafe images", () => ok([{ image: Buffer.from("<html>hello world</html>").toString("base64") }])],
    ["unreadable JSON", () => new Response("{oops", { status: 200 })],
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
    serve(leaky(402), ok([{ image: PNG_B64 }]));
    const first = await generate({}, { credentials: CONN_A });
    expect(first.status).toBe(402);
    expect(first.quotaExhausted).toBe(true);
    expect(first.acceptedJob).toBeUndefined();
    await assertNoLeak(first);
    const second = await generate({}, { credentials: CONN_B });
    expect(second.success).toBe(true);
  });

  it("keeps a bounded Retry-After on 429", async () => {
    serve(json({ detail: "slow down" }, 429, { "retry-after": "30" }));
    const result = await generate();
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBeGreaterThan(Date.now() + 20_000);
    expect(result.rateLimitEvidence.source).toBe("retry_after");
    expect(result.acceptedJob).toBeUndefined();
  });

  it.each([400, 422])("passes %i without the upstream body and no acceptedJob", async (status) => {
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
    const foreign = ok([{ image: PNG_B64 }]);
    Object.defineProperty(foreign, "url", { value: "https://evil.example/v1/image/generation" });
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
    expect(result.success).toBe(false);
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
