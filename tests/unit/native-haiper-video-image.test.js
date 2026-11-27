// Haiper native image and video adapters, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (videoRegistry.ts / imageRegistryData.ts `haiper`,
// videoGeneration.ts handleHaiperVideoGeneration,
// imageGeneration/providers/haiper.ts). Passing here says nothing about the
// live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-haiper-video-image/index.js";
import {
  HAIPER_IMAGE_MODELS,
  HAIPER_VIDEO_MODELS,
  buildHaiperImageRequest,
  buildHaiperVideoRequest,
  createHaiperImageAdapter,
  createHaiperVideoAdapter,
  haiperImageAdapter,
  haiperVideoAdapter,
} from "../../open-sse/services/providerParity/native-haiper-video-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import haiperRegistry from "../../open-sse/providers/registry/haiper.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://api.haiper.ai";
const IMAGE_SUBMIT = `${ORIGIN}/v1/jobs/gen2/text2image`;
const VIDEO_SUBMIT = `${ORIGIN}/v1/jobs/gen2/text2video`;
const STATUS = `${ORIGIN}/v1/jobs`;
const KEY_A = "haiper-SYNTHETIC-key-a-0001";
const KEY_B = "haiper-SYNTHETIC-key-b-0002";
const PROMPT = "a paper boat on a calm lake";
const OUT_A = "https://cdn.haiper.example/out-a.mp4";
const OUT_B = "https://cdn.haiper.example/out-b.mp4";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-haiper-video-image/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, code, headers = {}) => json({ error: { code, message: `upstream echo ${KEY_A} ${PROMPT}` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

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

const polling = () => ({
  pollIntervalMs: 1_000,
  timeoutMs: 100_000,
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const factories = { image: createHaiperImageAdapter, video: createHaiperVideoAdapter };
const run = (modality, body = {}, { model = "gen2", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  factories[modality]({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const image = (body, opts) => run("image", body, opts);
const video = (body, opts) => run("video", body, opts);
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};
const posts = () => calls.filter((c) => c.init.method === "POST");

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
  it("stays unregistered and leaves the existing haiper entry unchanged", () => {
    expect(getImageAdapter("haiper")).toBeNull();
    expect(getVideoGenerationAdapter("haiper")).toBeNull();
    expect(haiperRegistry.serviceKinds).toEqual([]);
    expect(haiperRegistry.hiddenKinds).toEqual(["image", "video"]);
    expect(haiperRegistry.models).toEqual([]);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.HAIPER_PROVIDER_ID).toBe("haiper");
    expect(staged.HAIPER_IMAGE_SUBMIT_URL).toBe(IMAGE_SUBMIT);
    expect(staged.HAIPER_VIDEO_SUBMIT_URL).toBe(VIDEO_SUBMIT);
    expect(staged.HAIPER_STATUS_URL).toBe(STATUS);
    expect(staged.HAIPER_AUTH_HEADER).toBe("HAIPER_KEY");
    expect(staged.HAIPER_IMAGE_FORMAT).toBe("haiper-image");
    expect(staged.HAIPER_VIDEO_FORMAT).toBe("haiper-video");
    expect(HAIPER_IMAGE_MODELS.map((m) => [m.id, m.name])).toEqual([["gen2", "Gen 2 Image"]]);
    expect(HAIPER_VIDEO_MODELS.map((m) => [m.id, m.name])).toEqual([["gen2", "Gen 2"]]);
    expect(staged.HAIPER_IMAGE_ASPECT_RATIOS).toEqual(["16:9", "9:16", "1:1", "4:3", "3:4"]);
    expect(staged.HAIPER_POLL_INTERVAL_MS).toBe(5_000);
    expect(staged.HAIPER_JOB_TIMEOUT_MS).toBe(300_000);
    for (const adapter of [haiperImageAdapter, haiperVideoAdapter]) {
      expect(adapter.provider).toBe("haiper");
      expect(adapter.responseFormats).toEqual(["url"]);
      expect(adapter.async).toBe(true);
      expect(isFunction(adapter.generate)).toBe(true);
    }
  });

  it("matches the existing provider identity and auth mode", () => {
    expect(haiperRegistry.id).toBe(staged.HAIPER_PROVIDER_ID);
    expect(haiperRegistry.alias).toBe(staged.HAIPER_ALIAS);
    expect(haiperRegistry.authType).toBe("apikey");
    expect(haiperRegistry.transport.auth).toMatchObject({ header: "HAIPER_KEY", scheme: "raw" });
    expect(new URL(haiperRegistry.transport.baseUrl).origin).toBe(ORIGIN);
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("haiper");
    expect(REGISTRATION.provider.aliases).toEqual(["hp"]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["image", "video"]);
    expect(REGISTRATION.provider.auth).toEqual({ header: "HAIPER_KEY", scheme: "raw", credentialFields: ["apiKey"] });
    expect(REGISTRATION.models.image.map((m) => m.id)).toEqual(HAIPER_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.video.map((m) => m.id)).toEqual(HAIPER_VIDEO_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.imageSubmit.url).toBe(IMAGE_SUBMIT);
    expect(REGISTRATION.endpoints.videoSubmit.url).toBe(VIDEO_SUBMIT);
    expect(REGISTRATION.endpoints.status.url).toBe(`${STATUS}/{job_id}`);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("image request contract", () => {
  it("submits the source body with the raw HAIPER_KEY and polls the job", async () => {
    serve(json({ job_id: "img-1" }), json({ status: "pending" }), json({ status: "completed", creation_url: "https://cdn.haiper.example/i.png" }));
    const result = await image({ aspect_ratio: "9:16" });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(IMAGE_SUBMIT);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", HAIPER_KEY: KEY_A });
    expect(calls[0].body).toEqual({ prompt: PROMPT, aspect_ratio: "9:16" });
    expect(calls[1].url).toBe(`${STATUS}/img-1`);
    expect(calls[1].init.method).toBe("GET");
    expect(calls[1].init.headers).toEqual({ HAIPER_KEY: KEY_A });
    expect(calls).toHaveLength(3);
    const body = await payload(result);
    expect(body.data).toEqual([{ url: "https://cdn.haiper.example/i.png" }]);
    expect(result.accounting.nativeUnits).toEqual({ images: 1 });
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.accounting.meta.jobId).toBe("img-1");
  });

  it("defaults aspect_ratio to 16:9, takes a ratio size as its alias and reads output.image_url", async () => {
    expect(buildHaiperImageRequest("gen2", { prompt: "x" })).toEqual({ prompt: "x", aspect_ratio: "16:9" });
    expect(buildHaiperImageRequest("gen2", { prompt: "x", size: "1:1" })).toEqual({ prompt: "x", aspect_ratio: "1:1" });
    serve(json({ job_id: "img-2" }), json({ status: "succeeded", output: { image_url: "https://cdn.haiper.example/o.png" } }));
    const result = await image();
    expect((await payload(result)).data[0].url).toBe("https://cdn.haiper.example/o.png");
  });

  it.each([
    [{ size: "1024x1024" }, /size must be one of/],
    [{ aspect_ratio: "21:9" }, /aspect_ratio must be one of/],
    [{ aspect_ratio: "1:1", size: "16:9" }, /disagree/],
    [{ n: 2 }, /n=1/],
    [{ stream: true }, /streaming/],
    [{ response_format: "b64_json" }, /url only/],
    [{ image_url: "https://example.com/a.png" }, /does not support image_url/],
    [{ negative_prompt: "blur" }, /does not support negative_prompt/],
    [{ prompt: "" }, /prompt/],
  ])("refuses %j before submit", async (extra, message) => {
    const result = await image(extra);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });
});

describe("video request contract", () => {
  it("submits the fixed source body with the raw HAIPER_KEY and polls the job", async () => {
    serve(json({ job_id: "vid-1" }), json({ status: "processing" }), json({ status: "completed", creation_url: OUT_A }));
    const result = await video({ duration: 4, aspect_ratio: "16:9" });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(VIDEO_SUBMIT);
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", HAIPER_KEY: KEY_A });
    expect(calls[0].body).toEqual({ prompt: PROMPT, duration: 4, aspect_ratio: "16:9" });
    expect(calls[1].url).toBe(`${STATUS}/vid-1`);
    expect(calls[1].init.headers).toEqual({ HAIPER_KEY: KEY_A });
    expect(await payload(result)).toMatchObject({ data: [{ url: OUT_A, format: "mp4" }] });
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
    expect(result.accounting.costStatus).toBe("unknown");
  });

  it("reads output.video_url and sends the same body when nothing optional is given", async () => {
    expect(buildHaiperVideoRequest("gen2", { prompt: "x", seconds: "4" })).toEqual({ prompt: "x", duration: 4, aspect_ratio: "16:9" });
    serve(json({ job_id: "vid-2" }), json({ status: "succeeded", output: { video_url: OUT_B } }));
    const result = await video();
    expect(calls[0].body).toEqual({ prompt: PROMPT, duration: 4, aspect_ratio: "16:9" });
    expect((await payload(result)).data[0].url).toBe(OUT_B);
  });

  it.each([
    [{ duration: 8 }, /duration must be 4/],
    [{ seconds: 6 }, /seconds must be 4/],
    [{ aspect_ratio: "9:16" }, /aspect_ratio must be 16:9/],
    [{ image: "https://example.com/a.png" }, /does not support image/],
    [{ size: "1280x720" }, /does not support size/],
    [{ n: 2 }, /n=1/],
    [{ stream: true }, /streaming/],
    [{ response_format: "b64_json" }, /url only/],
  ])("refuses %j before submit", async (extra, message) => {
    const result = await video(extra);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses unknown models and a missing or unsafe key before submit", async () => {
    expect((await video({}, { model: "gen3" })).status).toBe(400);
    expect((await image({}, { model: "gen2-image" })).status).toBe(400);
    expect((await video({}, { credentials: { apiKey: "" } })).status).toBe(401);
    expect((await image({}, { credentials: { apiKey: "a\r\nX-Injected: 1" } })).status).toBe(401);
    expect((await video({}, { credentials: { accessToken: KEY_A } })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe.each(["image", "video"])("%s job outcomes", (modality) => {
  const go = (body, opts) => run(modality, body, opts);

  it("reports a failed job as an ordinary failure without leaking", async () => {
    serve(json({ job_id: "j1" }), json({ job_id: "j1", status: "failed", error: `echo ${KEY_A}` }));
    const result = await go();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it.each([
    ["completed without a URL", () => json({ status: "completed" })],
    ["an unsafe result URL", () => json({ status: "completed", creation_url: "https://169.254.169.254/latest" })],
    ["a loopback result URL", () => json({ status: "completed", creation_url: "https://127.0.0.1/x" })],
    ["a plain http result URL", () => json({ status: "completed", creation_url: "http://cdn.example.com/x" })],
    ["a result URL with userinfo", () => json({ status: "completed", creation_url: "https://u:p@cdn.example.com/x" })],
    ["another job's answer", () => json({ job_id: "j2", status: "completed", creation_url: OUT_A })],
    ["no status", () => json({ job_id: "j1" })],
    ["an unreadable body", () => new Response(`<html>${KEY_A}`, { status: 200 })],
    ["a status 500", () => leaky(500, "server_error")],
    ["a redirect", () => new Response(null, { status: 302, headers: { location: "https://evil.example" } })],
  ])("keeps an accepted job with %s as acceptedJob and never resubmits", async (_name, answer) => {
    serve(json({ job_id: "j1" }), answer());
    const result = await go();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(result.acceptedJob.costSource).toBe("accepted-job");
    expect(result.acceptedJob.modality).toBe(modality);
    expect(posts()).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("retries 429/503 status checks a bounded number of times", async () => {
    serve(json({ job_id: "j1" }), json({}, 429, { "retry-after": "2" }), json({}, 503), json({ status: "completed", creation_url: OUT_A }));
    const result = await go();
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(4);

    calls = [];
    serve(json({ job_id: "j1" }), ...Array.from({ length: 6 }, () => json({}, 429)));
    const limited = await go();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(7);
  });

  it("stops at the job deadline with an unknown outcome", async () => {
    serve(json({ job_id: "j1" }), json({ status: "queued" }));
    const result = await go({}, { options: { timeoutMs: 1_500 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("bounds a hanging status check", async () => {
    let seen;
    serve(json({ job_id: "j1" }), (_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await go({}, { options: { requestTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(seen.aborted).toBe(true);
  });

  it("passes a rejected status check's auth status on with acceptedJob", async () => {
    serve(json({ job_id: "j1" }), leaky(401, "invalid_api_key"));
    const result = await go();
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(result);
  });

  it("maps submit refusals, quota and rate limits without leaking", async () => {
    serve(leaky(402, "insufficient_credit"));
    const quota = await go();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    expect(quota.acceptedJob).toBeUndefined();
    await assertNoLeak(quota);

    serve(leaky(401, "invalid_key"));
    const auth = await go();
    expect(auth.status).toBe(401);
    expect(auth.acceptedJob).toBeUndefined();
    await assertNoLeak(auth);

    serve(leaky(429, "rate_limited", { "retry-after": "30" }));
    const limited = await go();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob).toBeUndefined();
    await assertNoLeak(limited);

    serve(leaky(400, "bad_request"));
    const bad = await go();
    expect(bad.status).toBe(400);
    await assertNoLeak(bad);

    serve(leaky(502, "bad_gateway"));
    const unknown = await go();
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(unknown);
    expect(calls).toHaveLength(5);
  });

  it("refuses a submit redirect without following it", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } }));
    const result = await go();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats a submit without a usable job id as accepted work", async () => {
    serve(json({ status: "queued" }));
    const missing = await go();
    expect(missing.acceptedJob.meta.jobState).toBe("accepted");
    serve(json({ job_id: "../../etc/passwd" }));
    const unsafe = await go();
    expect(unsafe.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("bounds the submit and never replays an uncertain one", async () => {
    let seen;
    serve((_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await go({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);

    serve(() => { throw new TypeError("socket hang up"); });
    const reset = await go();
    expect(reset.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(2);
  });

  it("reports a proven pre-connect failure without acceptedJob or leaking", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await go();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("aborts polling on the caller's signal and keeps the accepted job", async () => {
    const controller = new AbortController();
    serve(json({ job_id: "j1" }), () => { controller.abort(); return json({ status: "queued" }); });
    const result = await go({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("aborts an in-flight submit and keeps it as submit-unknown", async () => {
    const controller = new AbortController();
    let seen;
    serve((_url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
    const result = await go({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
  });

  it("returns 499 without acceptedJob when aborted before submit", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await go({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("keeps two connections' keys and jobs apart", async () => {
    const idFor = (init) => (init.headers.HAIPER_KEY === KEY_A ? "ja" : "jb");
    const done = (url) => json({ status: "completed", creation_url: url.endsWith("/ja") ? OUT_A : OUT_B });
    serve((_u, init) => json({ job_id: idFor(init) }), (_u, init) => json({ job_id: idFor(init) }), done, done);
    const [a, b] = await Promise.all([go({}, { credentials: { apiKey: KEY_A } }), go({}, { credentials: { apiKey: KEY_B } })]);
    expect((await payload(a)).data[0].url).toBe(OUT_A);
    expect((await payload(b)).data[0].url).toBe(OUT_B);
    for (const call of calls.filter((c) => c.init.method === "GET")) {
      expect(call.init.headers.HAIPER_KEY).toBe(call.url.endsWith("/ja") ? KEY_A : KEY_B);
    }
  });

  it("ignores a connection base URL and only talks to the fixed origin", async () => {
    serve(json({ job_id: "j1" }), json({ status: "completed", creation_url: OUT_A }));
    const result = await go({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example", providerSpecificData: { baseUrl: "https://evil.example" } } });
    expect(result.success).toBe(true);
    for (const call of calls) expect(new URL(call.url).origin).toBe(ORIGIN);
  });
});
