// Leonardo.Ai native image and video adapters, registered on leonardo / leo (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (imageGeneration/providers/leonardo.ts, videoGeneration/
// leonardoHandler.ts, tests/unit/leonardo-image-model-id.test.ts,
// tests/unit/leonardo-video-generation.test.ts). Passing here says nothing
// about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-leonardo-video-image/index.js";
import {
  LEONARDO_IMAGE_MODELS,
  LEONARDO_VIDEO_MODELS,
  buildLeonardoImageRequest,
  buildLeonardoVideoRequest,
  createLeonardoImageAdapter,
  createLeonardoVideoAdapter,
  leonardoImageAdapter,
  leonardoVideoAdapter,
  resolveLeonardoImageSize,
  resolveLeonardoVideoSize,
} from "../../open-sse/services/providerParity/native-leonardo-video-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import leonardoRegistry from "../../open-sse/providers/registry/leonardo.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const API = "https://cloud.leonardo.ai/api/rest/v1";
const IMAGE_SUBMIT = `${API}/generations`;
const VIDEO_SUBMIT = `${API}/generations-text-to-video`;
const status = (id) => `${API}/generations/${id}`;
const PHOENIX = "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3";
const SDXL = "16e7060a-803e-4df3-97ee-edcfa5dc9cc8";
const KEY_A = "leo-SYNTHETIC-key-a-0001";
const KEY_B = "leo-SYNTHETIC-key-b-0002";
const PROMPT = "a paper boat drifting on a pond";
const IMG = "https://cdn.leonardo.ai/users/u/generations/g/img.png";
const MP4 = "https://cdn.leonardo.ai/users/u/generations/g/video.mp4";
const THUMB = "https://cdn.leonardo.ai/users/u/generations/g/thumb.jpg";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-leonardo-video-image/registration.json", import.meta.url), "utf8"));

const json = (value, code = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status: code, headers: { "content-type": "application/json", ...headers } });
const leaky = (code, vendor, headers = {}) => json({ error: `upstream echo ${KEY_A} ${PROMPT}`, code: vendor }, code, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
const imageJob = (id = "gen-1") => json({ sdGenerationJob: { generationId: id, apiCreditCost: 8 } });
const videoJob = (id = "vid-1") => json({ motionVideoGenerationJob: { generationId: id } });
const generation = (fields) => json({ generations_by_pk: fields });
const imageDone = (id = "gen-1", url = IMG) => generation({ id, status: "COMPLETE", generated_images: [{ url }] });
const videoDone = (id = "vid-1", motionMP4URL = MP4) => generation({ id, status: "COMPLETE", generated_images: [{ url: THUMB, motionMP4URL }] });
const pending = (id) => generation({ id, status: "PENDING", generated_images: [] });

const originalFetch = global.fetch;
let calls;
let clock;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

// A request that never answers; it rejects only when its signal aborts.
const stalled = (_url, init) => new Promise((_, rejectWait) => {
  init.signal.addEventListener("abort", () => rejectWait(init.signal.reason), { once: true });
});

const polling = () => ({
  pollIntervalMs: 5_000,
  timeoutMs: 300_000,
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const image = (body = {}, { model = "phoenix", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createLeonardoImageAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const video = (body = {}, { model = "motion-2.0-fast", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createLeonardoVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};

beforeEach(() => {
  calls = [];
  clock = 1_000_000;
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Isolated registration block: the positive registry identity checks. Every
// other block works staged or registered.
describe("canonical registration (isolated)", () => {
  it("registers both adapters on leonardo and leo and keeps the existing entry", () => {
    for (const id of ["leonardo", "leo"]) {
      expect(getImageAdapter(id)).toBe(leonardoImageAdapter);
      expect(getVideoGenerationAdapter(id)).toBe(leonardoVideoAdapter);
    }
    expect(leonardoRegistry.serviceKinds).toEqual(["image", "video"]);
    expect(leonardoRegistry.hiddenKinds).toBeUndefined();
    expect(leonardoRegistry.models.map(({ id, kind }) => `${kind}:${id}`)).toEqual([
      "image:phoenix", "image:sdxl", "video:motion-2.0", "video:motion-2.0-fast",
    ]);
    expect(leonardoRegistry.videoConfig).toBeUndefined();
    expect(leonardoRegistry.alias).toBe("leo");
    expect(leonardoRegistry.authType).toBe("apikey");
    expect(leonardoRegistry.imageConfig).toEqual({ baseUrl: API, authType: "apikey", authHeader: "bearer" });
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.LEONARDO_PROVIDER_ID).toBe("leonardo");
    expect(staged.LEONARDO_ALIAS).toBe("leo");
    expect(staged.LEONARDO_IMAGE_SUBMIT_URL).toBe(IMAGE_SUBMIT);
    expect(staged.LEONARDO_VIDEO_SUBMIT_URL).toBe(VIDEO_SUBMIT);
    expect(staged.LEONARDO_STATUS_URL).toBe(`${API}/generations`);
    expect(staged.LEONARDO_IMAGE_FORMAT).toBe("leonardo-image");
    expect(staged.LEONARDO_VIDEO_FORMAT).toBe("leonardo-video");
    expect(LEONARDO_IMAGE_MODELS.map((m) => [m.id, m.platformModelId])).toEqual([["phoenix", PHOENIX], ["sdxl", SDXL]]);
    expect(LEONARDO_VIDEO_MODELS.map((m) => [m.id, m.modelEnum])).toEqual([["motion-2.0", "MOTION2"], ["motion-2.0-fast", "MOTION2FAST"]]);
    expect(staged.LEONARDO_IMAGE_SIZES).toEqual(["1024x1024", "1024x576", "576x1024"]);
    expect(staged.LEONARDO_POLL_INTERVAL_MS).toBe(5_000);
    expect(staged.LEONARDO_JOB_TIMEOUT_MS).toBe(300_000);
  });

  it("default adapters follow the media adapter contracts", () => {
    expect(isFunction(leonardoImageAdapter.generate)).toBe(true);
    expect(leonardoImageAdapter.responseFormats).toEqual(["url"]);
    expect(leonardoImageAdapter.defaultResponseFormat).toBe("url");
    expect(leonardoVideoAdapter.async).toBe(true);
    expect(isFunction(leonardoVideoAdapter.generate)).toBe(true);
    expect(leonardoVideoAdapter.responseFormats).toEqual(["url"]);
  });

  it("registration.json matches the exports and the module", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.status).toBe("staged-unregistered");
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(REGISTRATION.provider.canonicalId).toBe("leonardo");
    expect(REGISTRATION.provider.aliases).toEqual(["leo"]);
    expect(REGISTRATION.models.image.map((m) => m.id)).toEqual(LEONARDO_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.video.map((m) => m.id)).toEqual(LEONARDO_VIDEO_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.imageSubmit.url).toBe(IMAGE_SUBMIT);
    expect(REGISTRATION.endpoints.videoSubmit.url).toBe(VIDEO_SUBMIT);
    expect(REGISTRATION.responseFormats).toEqual({ image: ["url"], video: ["url"] });
  });
});

describe("image request contract", () => {
  it("submits the source body and headers, then polls with the bearer key only", async () => {
    serve(imageJob(), imageDone());
    const result = await image();
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(2);
    const [submit, poll] = calls;
    expect(submit.url).toBe(IMAGE_SUBMIT);
    expect(submit.init.method).toBe("POST");
    expect(submit.init.redirect).toBe("manual");
    expect(submit.init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(submit.body).toEqual({ modelId: PHOENIX, prompt: PROMPT, width: 1024, height: 1024, num_images: 1 });
    expect(poll.url).toBe(status("gen-1"));
    expect(poll.init.method).toBe("GET");
    expect(poll.init.redirect).toBe("manual");
    expect(poll.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
  });

  it("maps catalog ids to platform-model UUIDs and passes a UUID through", () => {
    expect(buildLeonardoImageRequest("phoenix", { prompt: PROMPT }).modelId).toBe(PHOENIX);
    expect(buildLeonardoImageRequest("sdxl", { prompt: PROMPT }).modelId).toBe(SDXL);
    expect(buildLeonardoImageRequest("", { prompt: PROMPT }).modelId).toBe(PHOENIX);
    const custom = "b24e16ff-06e3-43eb-8d33-4416c2d75876";
    expect(buildLeonardoImageRequest(custom, { prompt: PROMPT }).modelId).toBe(custom);
  });

  it("resolves size like the source: width/height win, then WxH, then 1024", () => {
    expect(resolveLeonardoImageSize({ size: "576x1024" })).toEqual({ width: 576, height: 1024 });
    expect(resolveLeonardoImageSize({ size: "576x1024", width: 768 })).toEqual({ width: 768, height: 1024 });
    expect(resolveLeonardoImageSize({})).toEqual({ width: 1024, height: 1024 });
    expect(resolveLeonardoImageSize({ size: "auto" })).toEqual({ width: 1024, height: 1024 });
  });

  it.each([
    ["an unknown model", { model: "dall-e-3" }, /Unsupported Leonardo image model/],
    ["n > 1", { body: { n: 2 } }, /n=1/],
    ["streaming", { body: { stream: true } }, /streaming/],
    ["b64_json", { body: { response_format: "b64_json" } }, /url only/],
    ["a reference image", { body: { image: IMG } }, /does not support image/],
    ["a mask", { body: { mask: "data:image/png;base64,AA==" } }, /does not support mask/],
    ["quality", { body: { quality: "hd" } }, /does not support quality/],
    ["a size that is not WxH", { body: { size: "2K" } }, /look like 1024x1024/],
    ["a side out of bounds", { body: { size: "2048x1024" } }, /32 to 1536/],
    ["a side that is not a multiple of 8", { body: { width: 1001 } }, /multiple of 8/],
    ["an empty prompt", { body: { prompt: " " } }, /text prompt/],
  ])("refuses %s before anything is sent", async (_label, { model, body }, expected) => {
    const result = await image(body, model ? { model } : {});
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.acceptedJob).toBeUndefined();
    expect(await errorMessage(result)).toMatch(expected);
    expect(calls).toHaveLength(0);
  });

  it("requires a usable key and never sends without one", async () => {
    const result = await image({}, { credentials: { apiKey: "bad\r\nkey" } });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("image outputs and failures", () => {
  it("returns the public result URL with returned-image usage and unknown cost", async () => {
    serve(imageJob(), pending("gen-1"), imageDone());
    const result = await image({ size: "1024x576" });
    expect(result.success).toBe(true);
    expect(calls[0].body).toMatchObject({ width: 1024, height: 576 });
    const body = await payload(result);
    expect(body.data).toEqual([{ url: IMG }]);
    expect(result.accounting.nativeUnits.images).toBe(1);
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.accounting.cost).toBeNull();
    expect(calls.map((c) => c.url)).toEqual([IMAGE_SUBMIT, status("gen-1"), status("gen-1")]);
  });

  it("keeps two connections apart: each call uses only its own key", async () => {
    serve(imageJob("gen-a"), imageDone("gen-a"), imageJob("gen-b"), imageDone("gen-b"));
    const [a, b] = [await image({}, { credentials: { apiKey: KEY_A } }), await image({}, { credentials: { apiKey: KEY_B } })];
    expect(a.success && b.success).toBe(true);
    expect(calls.slice(0, 2).every((c) => c.init.headers.Authorization === `Bearer ${KEY_A}`)).toBe(true);
    expect(calls.slice(2).every((c) => c.init.headers.Authorization === `Bearer ${KEY_B}`)).toBe(true);
    expect(calls[3].url).toBe(status("gen-b"));
  });

  it("a FAILED generation is an ordinary failure", async () => {
    serve(imageJob(), generation({ id: "gen-1", status: "FAILED" }));
    const result = await image();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(await errorMessage(result)).toBe("Leonardo generation failed");
  });

  it.each([
    ["http", "http://cdn.leonardo.ai/img.png"],
    ["a private host", "https://127.0.0.1/img.png"],
    ["userinfo", `https://${KEY_A}@cdn.leonardo.ai/img.png`],
    ["missing", undefined],
  ])("a COMPLETE generation with an unsafe (%s) result is an accepted unknown outcome", async (_label, url) => {
    serve(imageJob(), generation({ id: "gen-1", status: "COMPLETE", generated_images: [{ url }] }));
    const result = await image();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "accepted" } });
    await assertNoLeak(result);
  });

  it("402 marks this connection's quota exhausted without quoting the body", async () => {
    serve(leaky(402, "insufficient_credits"));
    const result = await image();
    expect(result.status).toBe(402);
    expect(result.quotaExhausted).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("a quota code on 400 is quota, other 400s pass through", async () => {
    serve(leaky(400, "insufficient_api_credits"));
    expect((await image()).quotaExhausted).toBe(true);
    serve(leaky(400, "validation-failed"));
    const plain = await image();
    expect(plain.status).toBe(400);
    expect(plain.quotaExhausted).toBeUndefined();
    await assertNoLeak(plain);
  });

  it("401 is an auth refusal, 429 keeps Retry-After", async () => {
    serve(leaky(401, "invalid-jwt"));
    const auth = await image();
    expect(auth.status).toBe(401);
    await assertNoLeak(auth);
    serve(leaky(429, "rate_limited", { "retry-after": "30" }));
    const limited = await image();
    expect(limited.status).toBe(429);
    await assertNoLeak(limited);
  });

  it("a 5xx submit may have been accepted: acceptedJob, no resend", async () => {
    serve(leaky(500, "unexpected"));
    const result = await image();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });
});

describe("video request contract", () => {
  it("submits the source body to the text-to-video endpoint", async () => {
    serve(videoJob(), videoDone());
    const result = await video();
    expect(result.success).toBe(true);
    const [submit, poll] = calls;
    expect(submit.url).toBe(VIDEO_SUBMIT);
    expect(submit.init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(submit.body).toEqual({ model: "MOTION2FAST", prompt: PROMPT, resolution: "RESOLUTION_720", width: 1280, height: 720, isPublic: false });
    expect(submit.body.num_frames).toBeUndefined();
    expect(submit.body.modelId).toBeUndefined();
    expect(poll.url).toBe(status("vid-1"));
    expect(poll.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
  });

  it("motion-2.0 and the legacy phoenix id both send MOTION2; an enum passes through", () => {
    expect(buildLeonardoVideoRequest("motion-2.0", { prompt: PROMPT }).model).toBe("MOTION2");
    expect(buildLeonardoVideoRequest("phoenix", { prompt: PROMPT }).model).toBe("MOTION2");
    expect(buildLeonardoVideoRequest("KINO2_0", { prompt: PROMPT }).model).toBe("KINO2_0");
  });

  it("maps sizes exactly like the source, including 2:3 and 4:5 portraits", () => {
    const sent = (size) => Object.values(resolveLeonardoVideoSize(size));
    expect(sent("832x480")).toEqual(["RESOLUTION_480", 832, 480]);
    expect(sent("480x832")).toEqual(["RESOLUTION_480", 480, 832]);
    expect(sent("720x1280")).toEqual(["RESOLUTION_720", 720, 1280]);
    expect(sent("512x768")).toEqual(["RESOLUTION_480", 512, 768]);
    expect(sent("576x720")).toEqual(["RESOLUTION_480", 576, 720]);
    expect(sent("768x1152")).toEqual(["RESOLUTION_720", 512, 768]);
    expect(sent("864x1024")).toEqual(["RESOLUTION_720", 576, 720]);
    expect(sent("832x1024")).toEqual(["RESOLUTION_720", 576, 720]);
    expect(sent("1024x1024")).toEqual(["RESOLUTION_720", 1280, 720]);
    expect(sent("768x512")).toEqual(["RESOLUTION_720", 1280, 720]);
    expect(sent(undefined)).toEqual(["RESOLUTION_720", 1280, 720]);
  });

  it.each([
    ["an unknown model", { model: "sora-2" }],
    ["duration", { body: { duration: 5 } }],
    ["seconds", { body: { seconds: "5" } }],
    ["an image input", { body: { image_url: IMG } }],
    ["n > 1", { body: { n: 2 } }],
    ["streaming", { body: { stream: true } }],
    ["b64_json", { body: { response_format: "b64_json" } }],
    ["a size that is not WxH", { body: { size: "720p" } }],
  ])("refuses %s before anything is sent", async (_label, { model, body }) => {
    const result = await video(body, model ? { model } : {});
    expect(result.status).toBe(400);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("video job outcomes", () => {
  it("returns motionMP4URL, never the jpg thumbnail, with returned-video usage", async () => {
    serve(videoJob(), pending("vid-1"), videoDone());
    const result = await video();
    expect(await payload(result)).toMatchObject({ data: [{ url: MP4, format: "mp4" }] });
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
    expect(result.accounting.costStatus).toBe("unknown");
  });

  it("a COMPLETE generation with only a thumbnail is an accepted unknown outcome", async () => {
    serve(videoJob(), generation({ id: "vid-1", status: "COMPLETE", generated_images: [{ url: THUMB }] }));
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("two connections keep their own keys and jobs", async () => {
    serve(videoJob("vid-a"), videoDone("vid-a"), videoJob("vid-b"), videoDone("vid-b", "https://cdn.leonardo.ai/b.mp4"));
    const a = await video({}, { credentials: { apiKey: KEY_A } });
    const b = await video({}, { credentials: { apiKey: KEY_B } });
    expect((await payload(a)).data[0].url).toBe(MP4);
    expect((await payload(b)).data[0].url).toBe("https://cdn.leonardo.ai/b.mp4");
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_A}`, `Bearer ${KEY_B}`, `Bearer ${KEY_B}`]);
  });

  it("stops at the job deadline with an accepted unknown outcome", async () => {
    const steps = Array.from({ length: 80 }, () => pending("vid-1"));
    serve(videoJob(), ...steps);
    const result = await video({}, { options: { timeoutMs: 20_000, maxPolls: 100 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls.length).toBe(1 + 4);
  });

  it("stops at the poll budget", async () => {
    serve(videoJob(), pending("vid-1"), pending("vid-1"), pending("vid-1"));
    const result = await video({}, { options: { maxPolls: 3 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toBeDefined();
    expect(calls).toHaveLength(4);
  });

  it("retries a 429 poll within bounds, honoring Retry-After", async () => {
    serve(videoJob(), new Response("", { status: 429, headers: { "retry-after": "12" } }), videoDone());
    const start = clock;
    const result = await video();
    expect(result.success).toBe(true);
    expect(clock - start).toBe(5_000 + 12_000);
  });

  it("a non-retryable poll error is an accepted unknown outcome", async () => {
    serve(videoJob(), leaky(404, "not-found"));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(result);
  });

  it.each([
    ["an unreadable submit answer", [new Response("not json", { status: 200 })]],
    ["a missing generation id", [json({ motionVideoGenerationJob: {} })]],
    ["an unsafe generation id", [json({ motionVideoGenerationJob: { generationId: "../../me" } })]],
    ["an answer about another generation", [videoJob(), videoDone("vid-other")]],
    ["a generation without a status", [videoJob(), generation({ id: "vid-1" })]],
    ["a null generation", [videoJob(), json({ generations_by_pk: null })]],
    ["an unreadable status", [videoJob(), new Response("<html>", { status: 200 })]],
  ])("%s is an accepted unknown outcome and is not resent", async (_label, steps) => {
    serve(...steps);
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job" });
    expect(calls.filter((c) => c.url === VIDEO_SUBMIT)).toHaveLength(1);
    await assertNoLeak(result);
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
    const foreign = json({ sdGenerationJob: { generationId: "gen-1" } });
    Object.defineProperty(foreign, "url", { value: "https://evil.example/api" });
    serve(foreign);
    const result = await image();
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("a poll redirect is an accepted unknown outcome", async () => {
    serve(videoJob(), new Response(null, { status: 307, headers: { location: "https://evil.example/" } }));
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

  it("a stalled submit times out as an uncertain submit, sent once", async () => {
    serve(stalled);
    const result = await image({}, { options: { submitTimeoutMs: 10 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal.aborted).toBe(true);
  });

  it("a stalled status request is bounded and aborted", async () => {
    serve(videoJob(), stalled);
    const result = await video({}, { options: { requestTimeoutMs: 10 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls[1].init.signal.aborted).toBe(true);
  });

  it("an abort before send sends nothing and claims no job", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("an abort during the submit tears the socket down and keeps the uncertain job", async () => {
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
    serve(videoJob(), (url, init) => {
      setTimeout(() => controller.abort(), 1);
      return stalled(url, init);
    });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
    expect(calls[1].init.signal.aborted).toBe(true);
  });

  it("an abort during the poll wait sends no further request", async () => {
    const controller = new AbortController();
    serve(videoJob());
    const result = await createLeonardoVideoAdapter({
      ...polling(),
      wait: async () => {
        controller.abort();
        controller.signal.throwIfAborted();
      },
    }).generate({ model: "motion-2.0", body: { prompt: PROMPT }, credentials: { apiKey: KEY_A }, signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeDefined();
    expect(calls).toHaveLength(1);
  });
});
