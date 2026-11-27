// UC Direct native image and video adapters, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (handlers/imageGeneration/providers/ucImage.ts and
// handlers/videoGeneration/providers/ucVideo.ts surface (B),
// config/imageRegistryData.ts and config/videoRegistry.ts `uc`,
// tests/unit/uc-image.test.ts and uc-video.test.ts). Passing here says
// nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-uc-video-image/index.js";
import {
  UC_IMAGE_MODELS,
  UC_VIDEO_MODELS,
  buildUcImageRequest,
  buildUcVideoRequest,
  createUcImageAdapter,
  createUcVideoAdapter,
  ucImageAdapter,
  ucStatusUrl,
  ucVideoAdapter,
} from "../../open-sse/services/providerParity/native-uc-video-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

const API = "https://api.uncensored.com/api/v1";
const IMAGE_URL = `${API}/images/generations`;
const VIDEO_URL = `${API}/videos/generations`;
const STATUS_URL = `${API}/videos/status/job-1`;
const KEY_A = "uai_sk_live_SYNTHETIC_a";
const KEY_B = "uai_sk_live_SYNTHETIC_b";
const PROMPT = "a lantern floating over a lake";
const IMG = "https://cdn.uncensored.com/out/img-1.png";
const MP4_URL = "https://videogen.moveinwater.com/vid-1.mp4";
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-uc-video-image/registration.json", import.meta.url), "utf8"));

const json = (value, code = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status: code, headers: { "content-type": "application/json", ...headers } });
const leaky = (code, vendor, headers = {}) =>
  json({ error: { code: vendor, message: `upstream echo ${KEY_A} ${PROMPT}` } }, code, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
const imageOk = (data = [{ url: IMG }], extra = {}) => json({ created: 1_700_000_000, data, ...extra });
const pending = (extra = {}) => json({ request_id: "job-1", status: "pending", status_url: STATUS_URL, ...extra });

const originalFetch = global.fetch;
let calls;
let clock;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return typeof step === "function" ? step(String(url), init) : step;
  });
}
const stalled = (_url, init) => new Promise((_, rejectWait) => {
  init.signal.addEventListener("abort", () => rejectWait(init.signal.reason), { once: true });
});
const polling = () => ({
  pollIntervalMs: 3_000,
  timeoutMs: 300_000,
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const image = (body = {}, { model = "seedream-v5", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createUcImageAdapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const video = (body = {}, { model = "t2v-standard", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createUcVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};
const rawHeaders = (call) => call.init.headers;

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
  it("stays unregistered: no uc-direct/ucd media adapter or media kinds, no uc provider", () => {
    for (const id of ["uc-direct", "ucd", "uc"]) {
      expect(getImageAdapter(id)).toBeNull();
      expect(getVideoGenerationAdapter(id)).toBeNull();
    }
    expect(PROVIDERS["uc-direct"]).toBeDefined();
    expect(PROVIDER_MEDIA["uc-direct"].serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MEDIA["uc-direct"]?.imageConfig).toBeUndefined();
    expect(PROVIDERS.uc).toBeUndefined();
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source fields and REST endpoints", () => {
    expect(staged.UC_PROVIDER_ID).toBe("uc-direct");
    expect(staged.UC_ALIAS).toBe("ucd");
    expect(staged.UC_SOURCE_PROVIDER_ID).toBe("uc");
    expect(staged.UC_IMAGE_URL).toBe(IMAGE_URL);
    expect(staged.UC_VIDEO_URL).toBe(VIDEO_URL);
    expect(staged.UC_AUTH_HEADER).toBe("X-api-key");
    expect(staged.UC_IMAGE_FORMAT).toBe("uc-image");
    expect(staged.UC_VIDEO_FORMAT).toBe("uc-video");
    expect(staged.UC_PERSONA_ENDPOINTS).toMatchObject({
      image: "https://internal.chatuncensored.ai/v2/image-gen",
      imageToVideo: "https://internal.chatuncensored.ai/image_to_video",
      tts: "wss://tts-stream.chatuncensored.ai",
    });
    expect(UC_IMAGE_MODELS).toHaveLength(22);
    expect(UC_IMAGE_MODELS[0].id).toBe("model-dev");
    expect(UC_IMAGE_MODELS.at(-1).id).toBe("wan-2.7-text-to-image-pro");
    expect(UC_VIDEO_MODELS.map((m) => m.id)).toEqual([
      "t2v-turbo", "t2v-standard", "i2v-turbo", "i2v-standard", "i2v-pro", "i2v-sora", "i2v-sora-pro",
      "cosmos-predict", "av-gen", "ltx-distilled", "seedance-2.0", "seedance-2.0-fast", "happyhorse",
    ]);
    expect(staged.ucVideoModel("wan-2.2-spicy")).toBeNull();
    expect(staged.UC_POLL_INTERVAL_MS).toBe(3_000);
    expect(staged.UC_JOB_TIMEOUT_MS).toBe(300_000);
    expect(staged.UC_IMAGE_N_MAX).toBe(4);
  });

  it("registration.json matches the exports", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("uc-direct");
    expect(REGISTRATION.provider.aliases).toEqual(["ucd"]);
    expect(REGISTRATION.models.image).toEqual(UC_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.video).toEqual(UC_VIDEO_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.image.url).toBe(IMAGE_URL);
    expect(REGISTRATION.endpoints.videoSubmit.url).toBe(VIDEO_URL);
    expect(REGISTRATION.responseFormats).toEqual({ image: ucImageAdapter.responseFormats, video: ucVideoAdapter.responseFormats });
    expect(staged.UC_PROVIDER_MEDIA_ADDITIONS.addServiceKinds).toEqual(["image", "video"]);
    expect(staged.UC_PROVIDER_MEDIA_ADDITIONS.imageConfig).toEqual({ baseUrl: IMAGE_URL, authType: "apikey", authHeader: "x-api-key" });
  });

  it("adapters follow the local media adapter contracts", () => {
    expect(ucImageAdapter.provider).toBe("uc-direct");
    expect(typeof ucImageAdapter.generate).toBe("function");
    expect(ucImageAdapter.defaultResponseFormat).toBe("url");
    expect(ucVideoAdapter.async).toBe(true);
    expect(ucVideoAdapter.responseFormats).toEqual(["url"]);
    expect(ucVideoAdapter.defaultResponseFormat).toBe("url");
  });
});

describe("image request building", () => {
  it("builds the source REST body and strips routing prefixes", () => {
    expect(buildUcImageRequest("uc-direct/seedream-v5", { prompt: ` ${PROMPT} ` })).toEqual({ model: "seedream-v5", prompt: PROMPT, n: 1 });
    expect(buildUcImageRequest("uc/flux-2", { prompt: PROMPT, n: 4, size: "1024x768" })).toEqual({ model: "flux-2", prompt: PROMPT, n: 4, size: "1024x768" });
    expect(buildUcImageRequest("ucd/realism", { prompt: PROMPT }).model).toBe("realism");
  });

  it.each([
    ["unknown model", "dall-e-3", {}, /Unsupported UC Direct image model/],
    ["empty prompt", "seedream-v5", { prompt: " " }, /Prompt is required/],
    ["n above source cap", "seedream-v5", { n: 5 }, /n must be an integer from 1 to 4/],
    ["fractional n", "seedream-v5", { n: 1.5 }, /n must be an integer/],
    ["bad size", "seedream-v5", { size: "big" }, /size must look like/],
    ["persona aspect_ratio", "seedream-v5", { aspect_ratio: "16:9" }, /does not support aspect_ratio/],
    ["persona poll knob", "seedream-v5", { timeout_ms: 1 }, /does not support timeout_ms/],
    ["input image", "seedream-v5", { image: IMG }, /does not support image/],
    ["stream", "seedream-v5", { stream: true }, /streaming/],
    ["unknown response_format", "seedream-v5", { response_format: "binary" }, /response_format url, b64_json only/],
  ])("refuses %s before any send", async (_label, model, extra, message) => {
    const result = await image(extra, { model });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });
});

describe("image generation", () => {
  it("sends the exact source headers and body to the fixed origin and normalizes the answer", async () => {
    serve(imageOk([{ url: IMG }, { b64_json: PNG_B64 }]));
    const result = await image({ n: 2, size: "1024x1024" }, { model: "uc-direct/seedream-v5" });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(IMAGE_URL);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(rawHeaders(call)).toEqual({ "X-api-key": KEY_A, "Content-Type": "application/json" });
    expect(Object.keys(rawHeaders(call))).not.toContain("Authorization");
    expect(call.body).toEqual({ model: "seedream-v5", prompt: PROMPT, n: 2, size: "1024x1024" });
    expect(await payload(result)).toEqual({ created: 1_700_000_000, data: [{ url: IMG }, { b64_json: PNG_B64 }] });
    expect(result.accounting.nativeUnits.images).toBe(2);
    expect(result.accounting.costStatus).toBe("unknown");
  });

  it("keeps only items of a requested response_format and never forwards response_format", async () => {
    serve(imageOk([{ url: IMG }, { b64_json: PNG_B64 }]));
    const result = await image({ response_format: "b64_json", n: 2 });
    expect(calls[0].body).not.toHaveProperty("response_format");
    expect((await payload(result)).data).toEqual([{ b64_json: PNG_B64 }]);
  });

  it("drops unsafe result URLs; an answer with nothing usable is an accepted job", async () => {
    serve(imageOk([{ url: "http://cdn.example.com/a.png" }, { url: "https://127.0.0.1/a.png" }, { url: "https://u:p@cdn.example.com/a.png" }, { b64_json: "not base64!" }]));
    const result = await image();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "completed-unusable" } });
  });

  it("a malformed 2xx body is an accepted job and is not quoted", async () => {
    serve(new Response(`not json ${KEY_A}`, { status: 200 }));
    const result = await image();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
    await assertNoLeak(result);
  });

  it.each([
    [402, "insufficient_funds", 402, true],
    [403, "content_moderation", 403, false],
    [401, "invalid_api_key", 401, false],
    [400, "bad_request", 400, false],
  ])("maps a refused %s without quoting the upstream body", async (code, vendor, expected, quota) => {
    serve(leaky(code, vendor));
    const result = await image();
    expect(result.status).toBe(expected);
    expect(result.acceptedJob).toBeUndefined();
    expect(Boolean(result.quotaExhausted)).toBe(quota);
    expect(await errorMessage(result)).toContain(vendor);
    await assertNoLeak(result);
  });

  it("429 keeps a bounded Retry-After and is not an accepted job", async () => {
    serve(leaky(429, "rate_limited", { "retry-after": "7" }));
    const result = await image();
    expect(result.status).toBe(429);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("a 5xx may have run: accepted job, never resent", async () => {
    serve(leaky(503, "overloaded"));
    const result = await image();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("refuses a redirect and never follows it with the key", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }));
    const result = await image();
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toMatch(/redirect refused/);
    expect(calls).toHaveLength(1);
  });

  it("an answer from another origin is an accepted job", async () => {
    const moved = imageOk();
    Object.defineProperty(moved, "url", { value: "https://other.example/images" });
    serve(moved);
    const result = await image();
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("a send that never connected is not an accepted job; an interrupted one is", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const unsent = await image();
    expect(unsent.status).toBe(502);
    expect(unsent.acceptedJob).toBeUndefined();
    await assertNoLeak(unsent);

    serve(() => { throw transportError("ECONNRESET"); });
    const unsure = await image();
    expect(unsure.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(unsure);
  });

  it("times out at the deadline as an accepted job without a resend", async () => {
    serve(stalled);
    const result = await image({}, { options: { timeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("an abort before send sends nothing; an abort in flight is an accepted job", async () => {
    const early = new AbortController();
    early.abort();
    expect((await image({}, { signal: early.signal })).status).toBe(499);
    expect(calls).toHaveLength(0);

    const late = new AbortController();
    serve((url, init) => {
      setTimeout(() => late.abort(), 5);
      return stalled(url, init);
    });
    const result = await image({}, { signal: late.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("requires a uai_ developer key and ignores OAuth/persona credentials", async () => {
    for (const credentials of [{}, { apiKey: "sk-other" }, { accessToken: KEY_A }, { providerSpecificData: { clientCookie: "c", sid: "s", uid: "u" } }]) {
      const result = await image({}, { credentials });
      expect(result.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it("two connections each use only their own key", async () => {
    serve(imageOk(), imageOk());
    await image({}, { credentials: { apiKey: KEY_A } });
    await image({}, { credentials: { apiKey: KEY_B } });
    expect(rawHeaders(calls[0])["X-api-key"]).toBe(KEY_A);
    expect(rawHeaders(calls[1])["X-api-key"]).toBe(KEY_B);
  });
});

describe("video request building", () => {
  it("builds the source REST body", () => {
    expect(buildUcVideoRequest("uc-direct/seedance-2.0", {
      prompt: PROMPT, size: "1280x720", aspect_ratio: "16:9", resolution: "720p", duration: "5",
    })).toEqual({ model: "seedance-2.0", prompt: PROMPT, size: "1280x720", aspect_ratio: "16:9", resolution: "720p", duration: 5 });
    const dataUrl = `data:image/png;base64,${PNG_B64}`;
    expect(buildUcVideoRequest("i2v-pro", { prompt: PROMPT, input_image: dataUrl }).image).toBe(dataUrl);
    expect(buildUcVideoRequest("i2v-pro", { prompt: PROMPT, image_url: IMG }).image).toBe(IMG);
  });

  it.each([
    ["persona model", "wan-2.2-spicy", {}, /Unsupported UC Direct video model/],
    ["i2v without image", "i2v-turbo", {}, /needs an input image/],
    ["t2v with image", "t2v-turbo", { image: IMG }, /does not take an input image/],
    ["private image URL", "i2v-pro", { image: "https://169.254.169.254/latest" }, /public https URL/],
    ["http image URL", "i2v-pro", { image: "http://cdn.example.com/a.png" }, /public https URL/],
    ["bare base64", "i2v-pro", { image: PNG_B64 }, /public https URL/],
    ["disagreeing images", "i2v-pro", { image: IMG, media: "https://cdn.example.com/b.png" }, /disagree/],
    ["persona knob", "t2v-turbo", { num_frames: 81 }, /does not support num_frames/],
    ["persona seconds", "t2v-turbo", { seconds: 5 }, /does not support seconds/],
    ["bad duration", "t2v-turbo", { duration: -1 }, /duration must be/],
    ["bad aspect", "t2v-turbo", { aspect_ratio: "wide" }, /aspect_ratio/],
    ["bad resolution", "t2v-turbo", { resolution: "huge" }, /resolution/],
    ["n > 1", "t2v-turbo", { n: 2 }, /n=1/],
    ["b64 output", "t2v-turbo", { response_format: "b64_json" }, /response_format url only/],
  ])("refuses %s before any send", async (_label, model, extra, message) => {
    const result = await video(extra, { model });
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("follows only status URLs on the fixed API origin", () => {
    expect(ucStatusUrl(STATUS_URL)).toBe(STATUS_URL);
    expect(ucStatusUrl("/api/v1/videos/status/9")).toBe(`${API}/videos/status/9`);
    for (const bad of ["https://evil.example/api/v1/videos/1", "http://api.uncensored.com/api/v1/videos/1",
      "https://api.uncensored.com/api/v1/chat/completions", "https://u:p@api.uncensored.com/api/v1/videos/1", 42]) {
      expect(ucStatusUrl(bad)).toBeNull();
    }
  });
});

describe("video generation", () => {
  it("returns an immediate result with the exact source wire", async () => {
    serve(json({ request_id: "job-1", status: "completed", data: [{ url: MP4_URL }], duration: 5 }));
    const result = await video({ duration: 5 }, { model: "uc-direct/seedance-2.0" });
    expect(result.success).toBe(true);
    const [call] = calls;
    expect(call.url).toBe(VIDEO_URL);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(rawHeaders(call)).toEqual({ "X-api-key": KEY_A, "Content-Type": "application/json" });
    expect(call.body).toEqual({ model: "seedance-2.0", prompt: PROMPT, duration: 5 });
    expect((await payload(result)).data).toEqual([{ url: MP4_URL, format: "mp4", request_id: "job-1" }]);
    expect(result.accounting.nativeUnits).toEqual({ videos: 1, videoSeconds: 5 });
    expect(result.accounting.costStatus).toBe("unknown");
  });

  it("polls status_url with the key only until a source result shape appears", async () => {
    serve(
      pending(),
      json({ request_id: "job-1", status: "processing" }),
      json({ request_id: "job-1", status: "succeeded", video: { url: MP4_URL } }),
    );
    const result = await video();
    expect(result.success).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([VIDEO_URL, STATUS_URL, STATUS_URL]);
    expect(calls[1].init.method).toBe("GET");
    expect(rawHeaders(calls[1])).toEqual({ "X-api-key": KEY_A });
    expect(calls[1].init.redirect).toBe("manual");
    expect((await payload(result)).data[0].url).toBe(MP4_URL);
    expect(clock).toBe(1_000_000 + 3_000);
  });

  it.each([
    ["top-level url", { url: MP4_URL }],
    ["video_url", { video_url: MP4_URL }],
    ["string output", { output: MP4_URL, status: "done" }],
  ])("reads the result from %s", async (_label, answer) => {
    serve(pending(), json({ request_id: "job-1", ...answer }));
    const result = await video();
    expect((await payload(result)).data[0].url).toBe(MP4_URL);
  });

  it("a job UC reports failed is an ordinary failure", async () => {
    serve(pending(), json({ request_id: "job-1", status: "failed", error: `upstream echo ${KEY_A}` }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("a callback-only job is an accepted job with its id, not a success", async () => {
    serve(json({ request_id: "job-7", status: "queued" }));
    const callback = await video({}, { model: "seedance-2.0" });
    expect(callback.success).toBe(false);
    expect(callback.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job-7" });
    expect(await errorMessage(callback)).toMatch(/job-7 without a status URL/);
    expect(calls).toHaveLength(1);
  });

  it("never sends the key to a foreign status_url", async () => {
    serve(pending({ status_url: "https://evil.example/api/v1/videos/status/job-1" }));
    const result = await video();
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "accepted", jobId: "job-1" });
    expect(await errorMessage(result)).toMatch(/not followed/);
    expect(calls).toHaveLength(1);
  });

  it("an unsafe result URL or an answer about another job is an accepted job", async () => {
    serve(pending(), json({ request_id: "job-1", status: "completed", url: "https://10.0.0.5/v.mp4" }));
    const unsafe = await video();
    expect(unsafe.acceptedJob.meta.jobState).toBe("accepted");
    expect(await errorMessage(unsafe)).toMatch(/not public https/);

    serve(pending(), json({ request_id: "job-2", status: "completed", url: MP4_URL }));
    const other = await video();
    expect(await errorMessage(other)).toMatch(/different video job/);
    expect(other.acceptedJob).toBeDefined();
  });

  it("a malformed status body is an accepted job and is not quoted", async () => {
    serve(pending(), new Response(`<<${KEY_A}>>`, { status: 200 }));
    const result = await video();
    expect(result.acceptedJob).toBeDefined();
    await assertNoLeak(result);
  });

  it("retries a 429 poll within bounds, honoring Retry-After", async () => {
    serve(pending(), json({}, 429, { "retry-after": "10" }), json({ request_id: "job-1", status: "completed", url: MP4_URL }));
    const result = await video();
    expect(result.success).toBe(true);
    expect(clock).toBe(1_000_000 + 10_000);
  });

  it("a rejected poll status is an accepted job with the passed status", async () => {
    serve(pending(), json({}, 401));
    const result = await video();
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("stops at the job deadline as an accepted job", async () => {
    serve(pending(), ...Array.from({ length: 5 }, () => json({ request_id: "job-1", status: "processing" })));
    const result = await video({}, { options: { timeoutMs: 12_000 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "accepted", jobId: "job-1" });
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it("an abort while polling stops polling and keeps the accepted job", async () => {
    const controller = new AbortController();
    serve(pending(), json({ request_id: "job-1", status: "processing" }));
    const result = await createUcVideoAdapter({
      ...polling(),
      wait: async (ms, signal) => {
        if (calls.length >= 2) controller.abort();
        signal?.throwIfAborted();
        clock += ms;
      },
    }).generate({ model: "t2v-turbo", body: { prompt: PROMPT }, credentials: { apiKey: KEY_A }, signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "accepted", jobId: "job-1" });
    expect(calls).toHaveLength(2);
  });

  it("an uncertain submit is an accepted job and is never resent", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const result = await video();
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);

    serve(stalled);
    const slow = await video({}, { options: { submitTimeoutMs: 20 } });
    expect(slow.status).toBe(504);
    expect(slow.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("a refused submit maps quota and moderation without quoting the body", async () => {
    serve(leaky(402, "insufficient_funds"));
    const funds = await video();
    expect(funds.status).toBe(402);
    expect(funds.quotaExhausted).toBe(true);
    await assertNoLeak(funds);

    serve(leaky(403, "moderation"));
    const moderated = await video();
    expect(moderated.status).toBe(403);
    expect(moderated.acceptedJob).toBeUndefined();
    await assertNoLeak(moderated);
  });

  it("two connections each use only their own key for submit and poll", async () => {
    serve(pending(), json({ request_id: "job-1", status: "completed", url: MP4_URL }));
    await video({}, { credentials: { apiKey: KEY_A } });
    serve(pending(), json({ request_id: "job-1", status: "completed", url: MP4_URL }));
    await video({}, { credentials: { apiKey: KEY_B } });
    expect(calls.map((c) => rawHeaders(c)["X-api-key"])).toEqual([KEY_A, KEY_A, KEY_B, KEY_B]);
  });
});
