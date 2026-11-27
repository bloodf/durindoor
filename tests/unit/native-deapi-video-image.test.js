// deAPI native image and video adapters, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (config/imageRegistryData.ts, config/videoRegistry.ts,
// handlers/imageGeneration.ts, handlers/videoGeneration/job.ts preset
// "deapi-video-job", tests/unit/deapi-provider.test.ts). Passing here says
// nothing about the live service.
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-deapi-video-image/index.js";
import {
  DEAPI_IMAGE_MODELS,
  DEAPI_PROVIDER_DEFINITION,
  DEAPI_VIDEO_MODELS,
  buildDeapiImageRequest,
  buildDeapiVideoRequest,
  createDeapiImageAdapter,
  createDeapiVideoAdapter,
  deapiImageAdapter,
  deapiVideoAdapter,
} from "../../open-sse/services/providerParity/native-deapi-video-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const API = "https://oai.deapi.ai/v1";
const IMAGE_URL = `${API}/images/generations`;
const VIDEO_URL = `${API}/videos`;
const status = (id) => `${VIDEO_URL}/${id}`;
const content = (id) => `${VIDEO_URL}/${id}/content`;
const KEY_A = "sk-dp-1-SYNTHETIC-key-a";
const KEY_B = "sk-dp-2-SYNTHETIC-key-b";
const PROMPT = "a paper boat drifting on a pond";
const IMG = "https://cdn.deapi.ai/out/img-1.png";
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
// The source test's 12-byte mp4 header (box size 24, type `ftyp`, brand mp42).
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-deapi-video-image/registration.json", import.meta.url), "utf8"));

const json = (value, code = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status: code, headers: { "content-type": "application/json", ...headers } });
const leaky = (code, vendor, headers = {}) =>
  json({ error: { code: vendor, message: `upstream echo ${KEY_A} ${PROMPT}` } }, code, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
const imageOk = (data = [{ url: IMG }], extra = {}) => json({ created: 1_700_000_000, data, ...extra });
const queued = (id = "vid-1") => json({ id, object: "video", status: "queued", progress: 0 });
const job = (statusText, id = "vid-1", extra = {}) => json({ id, object: "video", status: statusText, ...extra });
const clip = (bytes = MP4, headers = { "content-type": "video/mp4" }) => new Response(bytes, { status: 200, headers });

const originalFetch = global.fetch;
let calls;
let clock;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: isString(init?.body) ? JSON.parse(init.body) : undefined });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}
function isString(value) {
  return typeof value === "string";
}

// A request that never answers; it rejects only when its signal aborts.
const stalled = (_url, init) => new Promise((_, rejectWait) => {
  init.signal.addEventListener("abort", () => rejectWait(init.signal.reason), { once: true });
});

const polling = () => ({
  pollIntervalMs: 5_000,
  timeoutMs: 600_000,
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const image = (body = {}, { model = "Flux1schnell", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createDeapiImageAdapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const video = (body = {}, { model = "Ltx2_3_22B_Dist_INT8", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createDeapiVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};
const header = (call, name) => new Headers(call.init.headers).get(name);

beforeEach(() => {
  calls = [];
  clock = 1_000_000;
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Staging-only negatives. Registration replaces this block with positive
// registry identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered: no adapter, registry entry or media config for deapi", () => {
    expect(getImageAdapter("deapi")).toBeNull();
    expect(getVideoGenerationAdapter("deapi")).toBeNull();
    expect(PROVIDERS.deapi).toBeUndefined();
    expect(PROVIDER_MEDIA.deapi).toBeUndefined();
    expect(existsSync(new URL("../../open-sse/providers/registry/deapi.js", import.meta.url))).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.DEAPI_PROVIDER_ID).toBe("deapi");
    expect(staged.DEAPI_ALIAS).toBe("deapi");
    expect(staged.DEAPI_IMAGE_URL).toBe(IMAGE_URL);
    expect(staged.DEAPI_VIDEO_URL).toBe(VIDEO_URL);
    expect(staged.DEAPI_IMAGE_FORMAT).toBe("openai");
    expect(staged.DEAPI_VIDEO_FORMAT).toBe("deapi-video-job");
    expect(DEAPI_IMAGE_MODELS.map((m) => m.id)).toEqual(["ZImageTurbo_INT8", "Flux_2_Klein_4B_BF16", "Flux1schnell", "ZAnimeDistill_8Step_INT8"]);
    expect(DEAPI_VIDEO_MODELS.map((m) => m.id)).toEqual([
      "Ltx2_5_22B_Dist_INT8", "MiniMaxH3_33B_Turbo_INT8", "Ltx2_3_22B_Dist_INT8", "Ltxv_13B_0_9_8_Distilled_FP8",
    ]);
    expect(staged.DEAPI_IMAGE_SIZES).toEqual(["512x512", "768x768", "1024x1024", "1024x1536", "1536x1024"]);
    for (const id of ["ZImageTurbo_INT8", "ZAnimeDistill_8Step_INT8"]) expect(staged.deapiImageSizes(id)).toEqual(["512x512", "768x768", "1024x1024"]);
    for (const id of ["Flux_2_Klein_4B_BF16", "Flux1schnell"]) expect(staged.deapiImageSizes(id)).toEqual(staged.DEAPI_IMAGE_SIZES);
    // The gateway has no dall-e / gpt aliases; they would 404 upstream.
    for (const model of [...DEAPI_IMAGE_MODELS, ...DEAPI_VIDEO_MODELS]) expect(model.id).not.toMatch(/^(dall-e|gpt-|sora)/);
    expect(staged.DEAPI_POLL_INTERVAL_MS).toBe(5_000);
    expect(staged.DEAPI_MAX_POLLS).toBe(120);
  });

  it("stages an API-key provider definition with image and video kinds", () => {
    expect(DEAPI_PROVIDER_DEFINITION).toMatchObject({
      id: "deapi", alias: "deapi", category: "apikey", authType: "apikey", transport: null,
      serviceKinds: ["image", "video"],
      imageConfig: { baseUrl: IMAGE_URL, authType: "apikey", authHeader: "bearer" },
    });
    expect(DEAPI_PROVIDER_DEFINITION.display.website).toBe("https://deapi.ai");
    expect(DEAPI_PROVIDER_DEFINITION.models.filter((m) => m.kind === "image")).toHaveLength(4);
    expect(DEAPI_PROVIDER_DEFINITION.models.filter((m) => m.kind === "video")).toHaveLength(4);
    expect(DEAPI_PROVIDER_DEFINITION.videoConfig).toBeUndefined();
  });

  it("default adapters follow the media adapter contracts", () => {
    expect(isFunction(deapiImageAdapter.generate)).toBe(true);
    expect(deapiImageAdapter.responseFormats).toEqual(["url", "b64_json"]);
    expect(deapiImageAdapter.defaultResponseFormat).toBe("url");
    expect(deapiVideoAdapter.async).toBe(true);
    expect(isFunction(deapiVideoAdapter.generate)).toBe(true);
    expect(deapiVideoAdapter.responseFormats).toEqual(["b64_json"]);
    expect(deapiVideoAdapter.defaultResponseFormat).toBe("b64_json");
  });

  it("registration.json matches the exports and the module", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(REGISTRATION.provider.canonicalId).toBe("deapi");
    expect(REGISTRATION.provider.aliases).toEqual([]);
    expect(REGISTRATION.provider.authModes).toEqual(["apikey"]);
    expect(REGISTRATION.serviceKinds).toEqual(DEAPI_PROVIDER_DEFINITION.serviceKinds);
    expect(REGISTRATION.models.image.map((m) => m.id)).toEqual(DEAPI_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.video.map((m) => m.id)).toEqual(DEAPI_VIDEO_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.imageSizes).toEqual(staged.DEAPI_IMAGE_SIZES);
    expect(REGISTRATION.endpoints.image.url).toBe(IMAGE_URL);
    expect(REGISTRATION.endpoints.videoSubmit.url).toBe(VIDEO_URL);
    expect(REGISTRATION.endpoints.videoContent.url).toBe(`${VIDEO_URL}/{id}/content`);
    expect(REGISTRATION.responseFormats).toEqual({ image: ["url", "b64_json"], video: ["b64_json"] });
  });
});

describe("image request contract", () => {
  it("sends the source OpenAI body with the bearer key to the fixed endpoint", async () => {
    serve(imageOk());
    const result = await image({ size: "1024x1536", quality: "hd", response_format: "url", style: "vivid", n: 1, user: "u-1" });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(IMAGE_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(header(calls[0], "authorization")).toBe(`Bearer ${KEY_A}`);
    expect(header(calls[0], "content-type")).toBe("application/json");
    expect(calls[0].body).toEqual({ model: "Flux1schnell", prompt: PROMPT, n: 1, size: "1024x1536", quality: "hd", response_format: "url", style: "vivid" });
  });

  it("sends only model and prompt when nothing else is given", () => {
    expect(buildDeapiImageRequest("ZImageTurbo_INT8", { prompt: PROMPT })).toEqual({ model: "ZImageTurbo_INT8", prompt: PROMPT });
  });

  it("refuses inputs this subset cannot honor before any request", async () => {
    const cases = [
      [{ size: "1024x1536" }, "ZImageTurbo_INT8", /size must be one of: 512x512, 768x768, 1024x1024/],
      [{ size: "2048x2048" }, "Flux1schnell", /size must be one of/],
      [{ n: 2 }, "Flux1schnell", /n=1/],
      [{ stream: true }, "Flux1schnell", /streaming/],
      [{ response_format: "binary" }, "Flux1schnell", /response_format url, b64_json only/],
      [{ output_format: "jpeg" }, "Flux1schnell", /always png/],
      [{ image: "https://example.com/a.png" }, "Flux1schnell", /does not support image/],
      [{ mask: "x" }, "Flux1schnell", /does not support mask/],
      [{ background: "transparent" }, "Flux1schnell", /does not support background/],
      [{ quality: "HD please" }, "Flux1schnell", /quality must be/],
      [{ prompt: "  " }, "Flux1schnell", /text prompt/],
      [{}, "dall-e-3", /Unsupported deAPI image model: dall-e-3/],
    ];
    for (const [body, model, message] of cases) {
      const result = await image(body, { model });
      expect(result.status, JSON.stringify(body)).toBe(400);
      expect(await errorMessage(result)).toMatch(message);
      expect(result.acceptedJob).toBeUndefined();
    }
    expect(calls).toHaveLength(0);
  });

  it("requires a usable key and sends nothing without one", async () => {
    for (const credentials of [{}, { apiKey: "" }, { apiKey: "a\r\nX-Evil: 1" }]) {
      const result = await image({}, { credentials });
      expect(result.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it("ignores a connection base URL: the key goes only to oai.deapi.ai", async () => {
    serve(imageOk());
    await image({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example/v1", providerSpecificData: { baseUrl: "https://evil.example" } } });
    expect(calls[0].url).toBe(IMAGE_URL);
  });

  it("uses each connection's own key and shares nothing between calls", async () => {
    serve(imageOk(), imageOk());
    await image({}, { credentials: { apiKey: KEY_A } });
    await image({}, { credentials: { accessToken: KEY_B } });
    expect(header(calls[0], "authorization")).toBe(`Bearer ${KEY_A}`);
    expect(header(calls[1], "authorization")).toBe(`Bearer ${KEY_B}`);
  });
});

describe("image outputs and failures", () => {
  it("normalizes a URL answer and counts returned images", async () => {
    serve(imageOk([{ url: IMG, revised_prompt: "boat" }]));
    const result = await image();
    expect(await payload(result)).toEqual({ created: 1_700_000_000, data: [{ url: IMG, revised_prompt: "boat" }] });
    expect(result.accounting).toMatchObject({ modality: "image", nativeUnits: { images: 1 }, cost: null, costStatus: "unknown" });
  });

  it("returns b64_json when asked and drops items of the other form", async () => {
    serve(imageOk([{ url: IMG }, { b64_json: PNG_B64 }]));
    const result = await image({ response_format: "b64_json" });
    expect((await payload(result)).data).toEqual([{ b64_json: PNG_B64 }]);
  });

  it("drops unsafe or malformed items; a 2xx without a usable image may still bill", async () => {
    for (const data of [
      [{ url: "http://cdn.deapi.ai/a.png" }],
      [{ url: "https://127.0.0.1/a.png" }],
      [{ url: "https://user:pw@cdn.deapi.ai/a.png" }],
      [{ b64_json: "not base64!" }],
      [],
      "nope",
    ]) {
      serve(imageOk(data));
      const result = await image();
      expect(result.status, JSON.stringify(data)).toBe(502);
      expect(result.acceptedJob.meta.jobState).toBe("completed-unusable");
      expect(result.acceptedJob.costSource).toBe("accepted-job");
    }
  });

  it("an unreadable 2xx answer is an unread completed job", async () => {
    serve(new Response("<html>oops</html>", { status: 200 }));
    const result = await image();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
  });

  it("maps refusals without quoting the upstream body", async () => {
    const cases = [
      [401, "invalid_api_key", 401, undefined],
      [402, "insufficient_balance", 402, true],
      [400, "insufficient_balance", 402, true],
      [400, "size_not_supported", 400, undefined],
      [404, "model_not_found", 404, undefined],
    ];
    for (const [code, vendor, expected, quota] of cases) {
      serve(leaky(code, vendor));
      const result = await image();
      expect(result.status, vendor).toBe(expected);
      expect(result.quotaExhausted).toBe(quota);
      expect(result.acceptedJob).toBeUndefined();
      expect(await errorMessage(result)).toContain(`(${vendor})`);
      await assertNoLeak(result);
    }
  });

  it("a 429 keeps a bounded Retry-After and no acceptedJob", async () => {
    serve(leaky(429, "rate_limited", { "retry-after": "7" }));
    const result = await image();
    expect(result.status).toBe(429);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("a 5xx may have run: acceptedJob and no retry", async () => {
    serve(leaky(503, "overloaded"));
    const result = await image();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });
});

describe("video request contract", () => {
  it("submits, polls and downloads the key-gated content (source flow)", async () => {
    serve(queued(), job("in_progress"), job("completed", "vid-1", { seconds: "5" }), clip());
    const result = await video({ duration: 5, size: "768x768" });
    expect(result.success).toBe(true);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `POST ${VIDEO_URL}`, `GET ${status("vid-1")}`, `GET ${status("vid-1")}`, `GET ${content("vid-1")}`,
    ]);
    // The content route 401s without the key, so every call carries it.
    for (const call of calls) {
      expect(header(call, "authorization")).toBe(`Bearer ${KEY_A}`);
      expect(call.init.redirect).toBe("manual");
    }
    expect(header(calls[0], "content-type")).toBe("application/json");
    expect(header(calls[1], "content-type")).toBeNull();
    // `seconds` is a string in the Sora-shaped contract; duration is not sent.
    expect(calls[0].body).toEqual({ model: "Ltx2_3_22B_Dist_INT8", prompt: PROMPT, seconds: "5", size: "768x768" });
    const body = await payload(result);
    expect(body.data).toEqual([{ b64_json: Buffer.from(MP4).toString("base64"), format: "mp4", mime_type: "video/mp4" }]);
    expect(result.accounting).toMatchObject({
      modality: "video", nativeUnits: { videos: 1, videoSeconds: 5 }, cost: null, costStatus: "unknown",
    });
  });

  it("does not bill requested seconds when deAPI reports none", async () => {
    serve(queued(), job("completed"), clip());
    const result = await video({ seconds: "8" });
    expect(calls[0].body.seconds).toBe("8");
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
  });

  it("builds the minimal body and accepts matching seconds and duration", () => {
    expect(buildDeapiVideoRequest("Ltxv_13B_0_9_8_Distilled_FP8", { prompt: PROMPT })).toEqual({ model: "Ltxv_13B_0_9_8_Distilled_FP8", prompt: PROMPT });
    expect(buildDeapiVideoRequest("Ltx2_5_22B_Dist_INT8", { prompt: PROMPT, seconds: 6, duration: 6 }).seconds).toBe("6");
  });

  it("refuses inputs this subset cannot honor before any request", async () => {
    const cases = [
      [{ response_format: "url" }, /b64_json only/],
      [{ n: 2 }, /n=1/],
      [{ stream: true }, /streaming/],
      [{ size: "big" }, /size must look like/],
      [{ seconds: "5.5" }, /whole number/],
      [{ duration: 0 }, /whole number/],
      [{ seconds: 5, duration: 6 }, /disagree/],
      [{ image: "https://example.com/a.png" }, /does not support image/],
      [{ input_reference: "x" }, /does not support input_reference/],
    ];
    for (const [body, message] of cases) {
      const result = await video(body);
      expect(result.status, JSON.stringify(body)).toBe(400);
      expect(await errorMessage(result)).toMatch(message);
    }
    const unknownModel = await video({}, { model: "sora-2" });
    expect(unknownModel.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("uses each connection's own key on every leg", async () => {
    serve(queued("a"), job("completed", "a"), clip(), queued("b"), job("completed", "b"), clip());
    await video({}, { credentials: { apiKey: KEY_A } });
    await video({}, { credentials: { apiKey: KEY_B, baseUrl: "https://evil.example" } });
    expect(calls.slice(0, 3).map((c) => header(c, "authorization"))).toEqual(Array(3).fill(`Bearer ${KEY_A}`));
    expect(calls.slice(3).map((c) => header(c, "authorization"))).toEqual(Array(3).fill(`Bearer ${KEY_B}`));
    for (const call of calls) expect(call.url.startsWith(`${API}/`)).toBe(true);
  });
});

describe("video job outcomes", () => {
  it("a failed job is reported, not downloaded, and claims no accepted job", async () => {
    serve(queued("vid-2"), job("failed", "vid-2", { error: { code: "job_failed", message: `echo ${KEY_A}` } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toBe("deAPI video job failed");
    expect(result.acceptedJob).toBeUndefined();
    expect(calls.some((c) => c.url.endsWith("/content"))).toBe(false);
    await assertNoLeak(result);
  });

  it("refused submits map like images; a 5xx submit is uncertain and not replayed", async () => {
    serve(leaky(402, "insufficient_balance"));
    const quota = await video();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    serve(leaky(500, "server_error"));
    const unknown = await video();
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(2);
    await assertNoLeak(unknown);
  });

  it("a submit answer without a usable job id is an accepted unknown outcome", async () => {
    for (const answer of [json({ status: "queued" }), json({ id: "../../etc" }), new Response("nope", { status: 200 })]) {
      serve(answer);
      const result = await video();
      expect(result.status).toBe(502);
      expect(result.acceptedJob.meta.jobState).toBe("accepted");
    }
  });

  it("an answer about another job or without a status is an unknown outcome", async () => {
    serve(queued(), job("completed", "other"));
    const other = await video();
    expect(await errorMessage(other)).toMatch(/different video job/);
    expect(other.acceptedJob.meta.jobState).toBe("accepted");
    serve(queued(), json({ id: "vid-1" }));
    const missing = await video();
    expect(await errorMessage(missing)).toMatch(/without a status/);
  });

  it("retries poll 429/503 within bounds, then gives up as unknown", async () => {
    serve(queued(), json({}, 503), json({}, 429, { "retry-after": "2" }), job("completed"), clip());
    const ok = await video();
    expect(ok.success).toBe(true);
    serve(queued(), ...Array(6).fill(0).map(() => json({}, 429)));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("other poll errors pass auth statuses through as unknown outcomes", async () => {
    serve(queued(), leaky(401, "invalid_api_key"));
    const result = await video();
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(result);
  });

  it("stops at the job deadline", async () => {
    serve(queued(), ...Array(4).fill(0).map(() => job("in_progress")));
    const result = await video({}, { options: { timeoutMs: 20_000 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it("stops at the poll budget", async () => {
    serve(queued(), job("queued"), job("in_progress"));
    const result = await video({}, { options: { maxPolls: 2 } });
    expect(result.status).toBe(504);
    expect(calls).toHaveLength(3);
  });

  it("unusable content after completion is an unread completed job", async () => {
    const bad = [
      clip(new Uint8Array(0)),
      clip(new TextEncoder().encode("<html>not a video</html>"), { "content-type": "video/mp4" }),
      clip(MP4, { "content-type": "text/html" }),
      clip(MP4, { "content-type": "video/mp4", "content-length": String(64 * 1024 * 1024 + 1) }),
      new Response(null, { status: 302, headers: { location: "https://storage.example/clip.mp4" } }),
      leaky(404, "not_found"),
    ];
    for (const answer of bad) {
      serve(queued(), job("completed"), answer);
      const result = await video();
      expect(result.success).toBeFalsy();
      expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
      await assertNoLeak(result);
    }
  });

  it("an oversized streamed body is cut off and not buffered", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulled = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    serve(queued(), job("completed"), new Response(stream, { headers: { "content-type": "video/mp4" } }));
    const result = await video();
    expect(await errorMessage(result)).toMatch(/larger than/);
    expect(pulled).toBeLessThan(70);
  });
});

describe("transport, redirects, abort and deadlines", () => {
  it("a submit redirect is refused, not followed", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }));
    const result = await image();
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toMatch(/redirect refused/);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("an answer from another origin is treated as possibly accepted", async () => {
    const foreign = queued();
    Object.defineProperty(foreign, "url", { value: "https://evil.example/v1/videos" });
    serve(foreign);
    const result = await video();
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("a poll redirect is an accepted unknown outcome", async () => {
    serve(queued(), new Response(null, { status: 307, headers: { location: "https://evil.example/" } }));
    const result = await video();
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("a pre-connect failure is provably unsent: no acceptedJob", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await image();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("a mid-send failure may have been accepted: acceptedJob and no replay", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("a stalled image call times out as uncertain, sent once", async () => {
    serve(stalled);
    const result = await image({}, { options: { timeoutMs: 10 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal.aborted).toBe(true);
  });

  it("a stalled video submit times out as uncertain, sent once", async () => {
    serve(stalled);
    const result = await video({}, { options: { submitTimeoutMs: 10 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("a stalled status request is bounded and aborted", async () => {
    serve(queued(), stalled);
    const result = await video({}, { options: { requestTimeoutMs: 10 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls[1].init.signal.aborted).toBe(true);
  });

  it("a stalled content download is bounded and aborted", async () => {
    serve(queued(), job("completed"), stalled);
    const result = await video({}, { options: { contentTimeoutMs: 10 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
    expect(calls[2].init.signal.aborted).toBe(true);
  });

  it("an abort before send sends nothing and claims no job", async () => {
    const controller = new AbortController();
    controller.abort();
    for (const run of [() => image({}, { signal: controller.signal }), () => video({}, { signal: controller.signal })]) {
      const result = await run();
      expect(result.status).toBe(499);
      expect(result.acceptedJob).toBeUndefined();
    }
    expect(calls).toHaveLength(0);
  });

  it("an abort during the image call tears the socket down and keeps the uncertain job", async () => {
    const controller = new AbortController();
    serve((url, init) => {
      setTimeout(() => controller.abort(), 1);
      return stalled(url, init);
    });
    const result = await image({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls[0].init.signal.aborted).toBe(true);
  });

  it("an abort while polling stops the poll and keeps the accepted job", async () => {
    const controller = new AbortController();
    serve(queued(), (url, init) => {
      setTimeout(() => controller.abort(), 1);
      return stalled(url, init);
    });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
    expect(calls[1].init.signal.aborted).toBe(true);
  });

  it("an abort during the content download keeps the completed job", async () => {
    const controller = new AbortController();
    serve(queued(), job("completed"), (url, init) => {
      setTimeout(() => controller.abort(), 1);
      return stalled(url, init);
    });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
  });
});
