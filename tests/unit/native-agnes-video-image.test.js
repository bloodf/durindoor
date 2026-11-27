// Agnes native image and video adapters, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (imageGeneration.ts buildAgnesImageRequestBody, videoGeneration/job.ts
// Agnes presets, tests/unit/agnes-provider.test.ts). Passing here says nothing
// about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-agnes-video-image/index.js";
import {
  AGNES_IMAGE_MODELS,
  AGNES_VIDEO_MODELS,
  agnesImageAdapter,
  agnesVideoAdapter,
  buildAgnesImageRequest,
  buildAgnesVideoRequest,
  createAgnesImageAdapter,
  createAgnesVideoAdapter,
} from "../../open-sse/services/providerParity/native-agnes-video-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import agnesRegistry from "../../open-sse/providers/registry/agnes.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://apihub.agnes-ai.com";
const IMAGE_URL = `${ORIGIN}/v1/images/generations`;
const SUBMIT_URL = `${ORIGIN}/v1/videos`;
const KEY_A = "agnes-SYNTHETIC-key-a-0001";
const KEY_B = "agnes-SYNTHETIC-key-b-0002";
const PROMPT = "a red ball rolling on a white floor";
const VIDEO_A = "https://platform-outputs.agnes-ai.space/video-a.mp4";
const VIDEO_B = "https://platform-outputs.agnes-ai.space/video-b.mp4";
const IMAGE_OUT = "https://platform-outputs.agnes-ai.space/image.png";
const B64 = "aGVsbG8gYWduZXM=";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-agnes-video-image/registration.json", import.meta.url), "utf8"));

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
const video = (body = {}, { model = "agnes-video-2.5-flash", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createAgnesVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const image = (body = {}, { model = "agnes-image-2.1-flash", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createAgnesImageAdapter(options).generate({ model, body: { prompt: PROMPT, size: "2K", ...body }, credentials, signal });
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

// Staging-only negatives. Registration replaces this block with positive
// registry identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered and leaves the existing agnes chat entry unchanged", () => {
    expect(getImageAdapter("agnes")).toBeNull();
    expect(getVideoGenerationAdapter("agnes")).toBeNull();
    expect(agnesRegistry.serviceKinds).toEqual(["llm"]);
    expect(agnesRegistry.authType).toBe("apikey");
    expect(agnesRegistry.transport.baseUrl).toBe(`${ORIGIN}/v1/chat/completions`);
  });
});

describe("staged module metadata", () => {

  it("exports the pinned source registry fields", () => {
    expect(staged.AGNES_IMAGE_URL).toBe(IMAGE_URL);
    expect(staged.AGNES_ORIGIN).toBe(ORIGIN);
    expect(staged.AGNES_VIDEO_STATUS_URL).toBe(`${ORIGIN}/agnesapi`);
    expect(staged.AGNES_IMAGE_FORMAT).toBe("agnes-image");
    expect(staged.AGNES_VIDEO_FORMAT).toBe("agnes-video-job");
    expect(AGNES_IMAGE_MODELS.map((m) => m.id)).toEqual(["agnes-image-2.0-flash", "agnes-image-2.1-flash", "agnes-image-2.5-flash"]);
    expect(staged.AGNES_IMAGE_SIZES).toEqual(["1K", "2K", "3K", "4K"]);
    expect(AGNES_VIDEO_MODELS.map((m) => [m.id, m.jobPreset])).toEqual([
      ["agnes-video-v2.0", "agnes-video-job"],
      ["agnes-video-2.5-flash", "agnes-video-2.5-job"],
      ["agnes-video-2.5", "agnes-video-2.5-job"],
    ]);
    expect(agnesImageAdapter.responseFormats).toEqual(["url", "b64_json"]);
    expect(agnesVideoAdapter.responseFormats).toEqual(["url"]);
    expect(isFunction(agnesImageAdapter.generate) && isFunction(agnesVideoAdapter.generate)).toBe(true);
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("agnes");
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["image", "video"]);
    expect(REGISTRATION.models.image.map((m) => m.id)).toEqual(AGNES_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.video.map((m) => [m.id, m.jobPreset])).toEqual(AGNES_VIDEO_MODELS.map((m) => [m.id, m.jobPreset]));
    expect(REGISTRATION.endpoints.image.url).toBe(IMAGE_URL);
    expect(REGISTRATION.endpoints.videoSubmit.url).toBe(SUBMIT_URL);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("image request contract", () => {
  it("maps standard inputs into the source body and sends Bearer auth", async () => {
    serve(json({ created: 123, data: [{ b64_json: B64, revised_prompt: "combined references" }], usage: { total_tokens: 7 } }));
    const result = await image({
      aspect_ratio: "16:9",
      image_urls: ["https://example.com/one.png", "data:image/png;base64,dHdv"],
      response_format: "b64_json",
      extra_body: { workflow_hint: "preserve-composition" },
    });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(IMAGE_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].body).toEqual({
      model: "agnes-image-2.1-flash",
      prompt: PROMPT,
      size: "2K",
      ratio: "16:9",
      extra_body: {
        workflow_hint: "preserve-composition",
        image: ["https://example.com/one.png", "data:image/png;base64,dHdv"],
        response_format: "b64_json",
      },
    });
    expect(await payload(result)).toEqual({ created: 123, data: [{ b64_json: B64, revised_prompt: "combined references" }] });
    expect(result.accounting.nativeUnits.images).toBe(1);
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.accounting.meta.providerUsage.value).toEqual({ total_tokens: 7 });
  });

  it("sends a bare text request without extra_body and prefers ratio over aspect_ratio", () => {
    expect(buildAgnesImageRequest("agnes-image-2.5-flash", { prompt: "x", size: "4K", ratio: "1:1", aspect_ratio: "9:16", return_base64: true }))
      .toEqual({ model: "agnes-image-2.5-flash", prompt: "x", size: "4K", ratio: "1:1", return_base64: true });
    const fromChat = buildAgnesImageRequest("agnes-image-2.0-flash", {
      prompt: "x", size: "1K", image_url: "https://example.com/a.png",
      messages: [{ content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }, { type: "image_url", image_url: { url: "https://example.com/b.png" } }] }],
    });
    expect(fromChat.extra_body).toEqual({ image: ["https://example.com/a.png", "https://example.com/b.png"] });
  });

  it.each([
    [{ size: undefined }, /size is required/],
    [{ size: "1024x1024" }, /size must be one of/],
    [{ n: 2 }, /n=1/],
    [{ mask: "https://example.com/m.png" }, /mask/],
    [{ quality: "hd" }, /quality/],
    [{ response_format: "binary" }, /response_format/],
    [{ stream: true }, /streaming/],
    [{ image_url: "http://example.com/a.png" }, /public https/],
    [{ image_urls: ["https://127.0.0.1/a.png"] }, /public https/],
    [{ image: "data:text/plain;base64,aGk=" }, /data URIs/],
    [{ extra_body: "x" }, /extra_body/],
    [{ ratio: "wide" }, /ratio/],
  ])("refuses %j before anything is sent", async (extra, message) => {
    const result = await image(extra);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses unknown models and a missing key before sending", async () => {
    expect((await image({}, { model: "agnes-video-2.5" })).status).toBe(400);
    expect((await image({}, { credentials: {} })).status).toBe(401);
    expect((await image({}, { credentials: { apiKey: "a\r\nX-Evil: 1" } })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("image outputs and failures", () => {
  it("returns url items, drops unsafe ones and refuses a format mismatch", async () => {
    serve(json({ data: [{ url: IMAGE_OUT }, { url: "http://platform-outputs.agnes-ai.space/x.png" }, { url: "https://10.0.0.1/x.png" }, { url: "https://u:p@example.com/x.png" }] }));
    const ok = await image({ response_format: "url" });
    expect(ok.success).toBe(true);
    expect((await payload(ok)).data).toEqual([{ url: IMAGE_OUT }]);
    expect(ok.accounting.nativeUnits.images).toBe(1);

    serve(json({ data: [{ b64_json: B64 }] }));
    const mismatch = await image({ response_format: "url" });
    expect(mismatch.status).toBe(502);
    expect(mismatch.acceptedJob.meta.jobState).toBe("completed-unusable");
  });

  it.each([
    ["empty data", json({ data: [] })],
    ["malformed base64", json({ data: [{ b64_json: "not base64!" }] })],
    ["not json", new Response("<html>oops</html>", { status: 200 })],
    ["error envelope", json({ error: { message: `echo ${KEY_A}` } })],
  ])("treats a 2xx with %s as a possibly billed failure", async (_name, answer) => {
    serve(answer);
    const result = await image();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.acceptedJob.costSource).toBe("accepted-job");
    expect(result.acceptedJob.costStatus).toBe("unknown");
    await assertNoLeak(result);
  });

  it("maps refusals without quoting the upstream body", async () => {
    serve(leaky(401, "invalid_api_key"));
    const auth = await image();
    expect(auth.status).toBe(401);
    expect(auth.acceptedJob).toBeUndefined();
    await assertNoLeak(auth);

    serve(leaky(402, "insufficient_balance"));
    const quota = await image();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    await assertNoLeak(quota);

    serve(leaky(429, "insufficient_user_quota"));
    expect((await image()).quotaExhausted).toBe(true);

    serve(leaky(429, "rate_limited", { "retry-after": "30" }));
    const limited = await image();
    expect(limited.status).toBe(429);
    expect(limited.quotaExhausted).toBeUndefined();
    expect(limited.response.headers.get("retry-after")).toBeTruthy();

    serve(leaky(400, "bad_size"));
    const bad = await image();
    expect(bad.status).toBe(400);
    expect(await errorMessage(bad)).toContain("bad_size");
    await assertNoLeak(bad);

    serve(leaky(503, "overloaded"));
    const unknown = await image();
    expect(unknown.status).toBe(502);
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(unknown);
    expect(calls).toHaveLength(6);
  });

  it("refuses a redirect without following it, and flags a followed one", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const refused = await image();
    expect(refused.status).toBe(502);
    expect(refused.acceptedJob).toBeUndefined();

    const followed = json({ data: [{ url: IMAGE_OUT }] });
    Object.defineProperty(followed, "url", { value: "https://evil.example/v1/images/generations" });
    serve(followed);
    const foreign = await image();
    expect(foreign.status).toBe(502);
    expect(foreign.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("separates unsent connect failures from uncertain sends and never resends", async () => {
    serve(() => Promise.reject(transportError("ECONNREFUSED")));
    const unsent = await image();
    expect(unsent.status).toBe(502);
    expect(unsent.acceptedJob).toBeUndefined();

    serve(() => Promise.reject(transportError("ECONNRESET")));
    const uncertain = await image();
    expect(uncertain.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(uncertain);
    expect(calls).toHaveLength(2);
  });

  it("bounds the call with a deadline and aborts the socket", async () => {
    let seen;
    serve((_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await image({}, { options: { timeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
  });

  it("returns 499 on caller abort, with acceptedJob only once the request was sent", async () => {
    const before = new AbortController();
    before.abort();
    const early = await image({}, { signal: before.signal });
    expect(early.status).toBe(499);
    expect(early.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);

    const during = new AbortController();
    let seen;
    serve((_url, init) => { seen = init.signal; setTimeout(() => during.abort(), 5); return new Promise(() => {}); });
    const late = await image({}, { signal: during.signal });
    expect(late.status).toBe(499);
    expect(late.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
  });

  it("keeps each selected connection's key on its own request", async () => {
    serve(json({ data: [{ url: IMAGE_OUT }] }), json({ data: [{ url: IMAGE_OUT }] }));
    const [a, b] = await Promise.all([image({}, { credentials: { apiKey: KEY_A } }), image({}, { credentials: { apiKey: KEY_B } })]);
    expect(a.success && b.success).toBe(true);
    expect(calls.map((c) => c.init.headers.Authorization).sort()).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
  });
});

describe("video request contract", () => {
  it("V2.0 submits the source body and polls /agnesapi by video_id and model_name", async () => {
    serve(
      json({ id: "task-123", task_id: "task-123", video_id: "video-123", status: "queued" }),
      json({ status: "processing" }),
      json({ status: "completed", metadata: { url: VIDEO_A } }),
    );
    const result = await video({
      width: 1152, height: 768, num_frames: 121, frame_rate: 24, poll_interval_ms: 60000, max_polls: 3,
      extra_body: { image: ["https://example.com/k1.png"], mode: "keyframes" },
    }, { model: "agnes-video-v2.0" });
    expect(result.success).toBe(true);
    expect(await payload(result)).toMatchObject({ data: [{ url: VIDEO_A, format: "mp4" }] });
    expect(calls[0].url).toBe(SUBMIT_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].body).toEqual({
      model: "agnes-video-v2.0", prompt: PROMPT, width: 1152, height: 768, num_frames: 121, frame_rate: 24,
      extra_body: { image: ["https://example.com/k1.png"], mode: "keyframes" },
    });
    expect(calls[1].url).toBe(`${ORIGIN}/agnesapi?video_id=video-123&model_name=agnes-video-v2.0`);
    expect(calls[1].init.method).toBe("GET");
    expect(calls[1].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls).toHaveLength(3);
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
    expect(result.accounting.costStatus).toBe("unknown");
  });

  it("2.5 submits seconds as a string and polls /v1/videos/{id}", async () => {
    const id = "task_nEV6cJjyzWnix1g1O9QHjnHzTstegDGM";
    serve(json({ id, status: "queued" }), json({ id, status: "completed", metadata: { url: VIDEO_B } }));
    const result = await video({ seconds: 4, mode: "text", size: "720P", aspect_ratio: "16:9" }, { model: "agnes-video-2.5" });
    expect(result.success).toBe(true);
    expect(calls[0].body).toEqual({ model: "agnes-video-2.5", prompt: PROMPT, seconds: "4", mode: "text", size: "720P", aspect_ratio: "16:9" });
    expect(calls[1].url).toBe(`${SUBMIT_URL}/${id}`);
    expect((await payload(result)).data[0].url).toBe(VIDEO_B);
  });

  it.each([
    [{ duration: 5 }, /seconds/],
    [{ n: 2 }, /n=1/],
    [{ stream: true }, /streaming/],
    [{ response_format: "b64_json" }, /url only/],
    [{ prompt: "" }, /prompt/],
  ])("refuses %j before submit", async (extra, message) => {
    const result = await video(extra);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses unknown models and a missing key before submit", async () => {
    expect((await video({}, { model: "agnes-image-2.1-flash" })).status).toBe(400);
    expect((await video({}, { credentials: { apiKey: "" } })).status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(() => buildAgnesVideoRequest("agnes-video-2.5", { prompt: "x", seconds: 8 }).request.seconds).not.toThrow();
  });
});

describe("video job outcomes", () => {
  it("reports a failed job as an ordinary failure", async () => {
    serve(json({ id: "t1" }), json({ id: "t1", status: "failed", error: { message: `echo ${KEY_A}` } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it.each([
    ["completed without a URL", json({ id: "t1", status: "completed", metadata: {} })],
    ["an unsafe result URL", json({ id: "t1", status: "completed", metadata: { url: "https://169.254.169.254/latest" } })],
    ["a plain http result URL", json({ id: "t1", status: "completed", metadata: { url: "http://cdn.example.com/v.mp4" } })],
    ["another job's answer", json({ id: "t2", status: "completed", metadata: { url: VIDEO_A } })],
    ["no status", json({ id: "t1" })],
    ["an unreadable body", new Response("<html>", { status: 200 })],
    ["a status 500", json({}, 500)],
    ["a redirect", new Response(null, { status: 302, headers: { location: "https://evil.example" } })],
  ])("keeps an accepted job with %s as acceptedJob and never resubmits", async (_name, answer) => {
    serve(json({ id: "t1" }), answer);
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("retries 429/503 status checks without using the poll budget", async () => {
    serve(json({ id: "t1" }), json({}, 429, { "retry-after": "2" }), json({}, 503), json({ id: "t1", status: "completed", metadata: { url: VIDEO_A } }));
    const result = await video({}, { options: { maxPolls: 1 } });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it("stops at the poll budget and the job deadline with an unknown outcome", async () => {
    serve(json({ id: "t1" }), json({ status: "queued" }), json({ status: "queued" }));
    const byPolls = await video({}, { options: { maxPolls: 2 } });
    expect(byPolls.status).toBe(504);
    expect(byPolls.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(3);

    calls = [];
    serve(json({ id: "t1" }), json({ status: "queued" }));
    const byTime = await video({}, { options: { timeoutMs: 1_500 } });
    expect(byTime.status).toBe(504);
    expect(calls).toHaveLength(2);
  });

  it("passes a rejected status check's auth status on with acceptedJob", async () => {
    serve(json({ id: "t1" }), leaky(401, "invalid_api_key"));
    const result = await video();
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("maps submit refusals and quota without leaking", async () => {
    serve(leaky(402, "insufficient_balance"));
    const quota = await video();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    expect(quota.acceptedJob).toBeUndefined();
    await assertNoLeak(quota);

    serve(leaky(502, "bad_gateway"));
    const unknown = await video();
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(2);
  });

  it("treats a submit without a usable job id as accepted work", async () => {
    serve(json({ status: "queued" }));
    const missing = await video();
    expect(missing.acceptedJob.meta.jobState).toBe("accepted");
    serve(json({ id: "../../etc/passwd" }));
    const unsafe = await video();
    expect(unsafe.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("bounds the submit and never replays an uncertain one", async () => {
    let seen;
    serve((_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await video({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("aborts polling on the caller's signal and keeps the accepted job", async () => {
    const controller = new AbortController();
    serve(json({ id: "t1" }), () => { controller.abort(); return json({ id: "t1", status: "queued" }); });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("returns 499 without acceptedJob when aborted before submit", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("keeps two connections' keys and jobs apart", async () => {
    serve(
      (_url, init) => json({ id: init.headers.Authorization.endsWith(KEY_A) ? "ja" : "jb" }),
      (_url, init) => json({ id: init.headers.Authorization.endsWith(KEY_A) ? "ja" : "jb" }),
      (url) => json({ id: url.endsWith("ja") ? "ja" : "jb", status: "completed", metadata: { url: url.endsWith("ja") ? VIDEO_A : VIDEO_B } }),
      (url) => json({ id: url.endsWith("ja") ? "ja" : "jb", status: "completed", metadata: { url: url.endsWith("ja") ? VIDEO_A : VIDEO_B } }),
    );
    const [a, b] = await Promise.all([
      video({}, { credentials: { apiKey: KEY_A } }),
      video({}, { credentials: { apiKey: KEY_B } }),
    ]);
    expect((await payload(a)).data[0].url).toBe(VIDEO_A);
    expect((await payload(b)).data[0].url).toBe(VIDEO_B);
    for (const call of calls.filter((c) => c.init.method === "GET")) {
      const key = call.url.endsWith("ja") ? KEY_A : KEY_B;
      expect(call.init.headers.Authorization).toBe(`Bearer ${key}`);
    }
  });

  it("ignores a connection base URL and only talks to the fixed origin", async () => {
    serve(json({ id: "t1" }), json({ id: "t1", status: "completed", metadata: { url: VIDEO_A } }));
    const result = await video({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example", providerSpecificData: { baseUrl: "https://evil.example" } } });
    expect(result.success).toBe(true);
    for (const call of calls) expect(new URL(call.url).origin).toBe(ORIGIN);
  });
});
