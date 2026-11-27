// Alibaba DashScope video generation, registered for synchronous generation. Closed mocks
// only: every request is answered below, an unexpected request fails the test,
// and every key is synthetic. Passing here says nothing about the live service.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import defaultAdapter, { createAlibabaVideoAdapter } from "../../open-sse/handlers/videoProviders/alibaba.js";
import {
  ALIBABA_VIDEO_MODEL_IDS,
  buildAlibabaVideoRequest,
} from "../../open-sse/services/alibabaVideo/request.js";
import {
  ALIBABA_DASHSCOPE_CN_ORIGIN,
  alibabaVideoResultUrl,
  runAlibabaVideoJob,
} from "../../open-sse/services/alibabaVideo/job.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://dashscope-intl.aliyuncs.com";
const SUBMIT_URL = `${ORIGIN}/api/v1/services/aigc/video-generation/video-synthesis`;
const KEY_A = "sk-SYNTHETIC-alibaba-key-a-0001";
const KEY_B = "sk-SYNTHETIC-alibaba-key-b-0002";
const TASK_A = "0385dc79-5ff8-4d82-bcb6-000000000a0a";
const TASK_B = "0385dc79-5ff8-4d82-bcb6-000000000b0b";
const VIDEO_A = "https://dashscope-result-sgp.oss-accelerate.aliyuncs.com/a/out.mp4?Expires=1";
const VIDEO_B = "https://dashscope-result-sgp.oss-accelerate.aliyuncs.com/b/out.mp4?Expires=1";
const IMAGE = "https://cdn.example.com/frame.png";
const CLIP = "https://cdn.example.com/clip.mp4";
const AUDIO = "https://cdn.example.com/voice.mp3";
const PROMPT = "a small paper boat drifting down a rain-filled street";
const T2V = "wan2.7-t2v-2026-06-12";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const accepted = (taskId = TASK_A) => json({ request_id: "r1", output: { task_id: taskId, task_status: "PENDING" } });
const task = (task_status, extra = {}, taskId = TASK_A) => json({ request_id: "r2", output: { task_id: taskId, task_status, ...extra } });
const succeeded = (video_url = VIDEO_A, taskId = TASK_A) => task("SUCCEEDED", { video_url }, taskId);
const refused = (status, code, message = `upstream echo ${KEY_A} ${PROMPT}`, headers = {}) => json({ request_id: "r0", code, message }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

const originalFetch = global.fetch;
let calls;
let clock;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

// Virtual poll clock: waiting advances time instantly, and aborts still apply.
const polling = () => ({
  pollIntervalMs: 1_000,
  timeoutMs: 10_000,
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const adapter = (options = {}) => createAlibabaVideoAdapter({ ...polling(), ...options });
const generate = (body = {}, { model = T2V, credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  adapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const errorBody = async (result) => (await result.response.clone().json()).error;
const assertNoSecrets = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain(PROMPT);
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

describe("registration", () => {
  it("registers the canonical identity and existing alias for /v1/video/generations", () => {
    expect(getVideoGenerationAdapter("alibaba")).toBe(defaultAdapter);
    expect(getVideoGenerationAdapter("ali")).toBe(defaultAdapter);
    expect(defaultAdapter.async).toBe(true);
    expect(isFunction(defaultAdapter.generate)).toBe(true);
  });

  it("knows exactly the source registry's alibaba video models", () => {
    expect(ALIBABA_VIDEO_MODEL_IDS).toEqual([
      "happyhorse-1.1-i2v", "happyhorse-1.1-t2v", "happyhorse-1.1-r2v", "happyhorse-1.0-video-edit",
      "wan2.7-i2v-2026-04-25", "wan2.6-i2v-flash", "wan2.7-t2v-2026-06-12", "wan2.7-r2v-2026-06-12", "wan2.7-videoedit",
    ]);
    // Undated qwen-cloud ids are not alibaba models, and no alias is invented.
    for (const model of ["wan2.7-t2v", "wan2.7-i2v", "wan-2.7", "alibaba/wan2.7-t2v-2026-06-12"]) {
      expect(() => buildAlibabaVideoRequest(model, { prompt: PROMPT })).toThrow(/Unsupported alibaba video model/);
    }
  });
});

describe("request bodies", () => {
  it("builds text-to-video parameters from named fields", () => {
    expect(buildAlibabaVideoRequest(T2V, {
      prompt: PROMPT, negative_prompt: "  blur ", size: "1920x1080", seconds: "5", prompt_extend: false, watermark: true, seed: 7,
      shot_type: "multi", audio_url: AUDIO,
    })).toEqual({
      model: T2V,
      input: { prompt: PROMPT, negative_prompt: "blur", audio_url: AUDIO },
      parameters: { resolution: "1080P", ratio: "16:9", duration: 5, prompt_extend: false, watermark: true, seed: 7, shot_type: "multi" },
    });
    expect(buildAlibabaVideoRequest("happyhorse-1.1-t2v", { prompt: PROMPT, resolution: "720p", aspect_ratio: "9:16", duration: 3 }))
      .toEqual({ model: "happyhorse-1.1-t2v", input: { prompt: PROMPT }, parameters: { resolution: "720P", ratio: "9:16", duration: 3 } });
  });

  it("maps media the way each source builder does", () => {
    expect(buildAlibabaVideoRequest("wan2.6-i2v-flash", { prompt: PROMPT, image_url: IMAGE, media: undefined, resolution: "1080P" })).toEqual({
      model: "wan2.6-i2v-flash", input: { prompt: PROMPT, media: [{ type: "first_frame", url: IMAGE }] }, parameters: { resolution: "1080P" },
    });
    expect(buildAlibabaVideoRequest("wan2.7-i2v-2026-04-25", {
      prompt: PROMPT,
      media: [{ type: "first_frame", url: IMAGE }, { type: "last_frame", url: `${IMAGE}?last` }, { type: "driving_audio", url: AUDIO, reference_voice: "v1" }],
    }).input.media).toEqual([
      { type: "first_frame", url: IMAGE }, { type: "last_frame", url: `${IMAGE}?last` }, { type: "driving_audio", url: AUDIO, reference_voice: "v1" },
    ]);
    expect(buildAlibabaVideoRequest("happyhorse-1.1-i2v", { prompt: PROMPT, image: { url: IMAGE } }).input.media)
      .toEqual([{ type: "first_frame", url: IMAGE }]);
    expect(buildAlibabaVideoRequest("happyhorse-1.1-r2v", { prompt: PROMPT, image_urls: [IMAGE, `${IMAGE}?2`], ratio: "1:1" })).toEqual({
      model: "happyhorse-1.1-r2v",
      input: { prompt: PROMPT, media: [{ type: "reference_image", url: IMAGE }, { type: "reference_image", url: `${IMAGE}?2` }] },
      parameters: { ratio: "1:1" },
    });
    expect(buildAlibabaVideoRequest("wan2.7-r2v-2026-06-12", { prompt: PROMPT, reference_images: [IMAGE], reference_videos: [CLIP] }).input.media)
      .toEqual([{ type: "reference_image", url: IMAGE }, { type: "reference_video", url: CLIP }]);
    expect(buildAlibabaVideoRequest("wan2.7-videoedit", { prompt: PROMPT, video_url: CLIP, reference_images: [IMAGE] }).input.media)
      .toEqual([{ type: "video", url: CLIP }, { type: "reference_image", url: IMAGE }]);
  });

  const refusals = [
    ["a raw parameters object", T2V, { parameters: { duration: 99 } }, /raw parameters/],
    ["more than one video", T2V, { n: 2 }, /one video/],
    ["a chat body", T2V, { messages: [] }, /not a chat/],
    ["an image for text-to-video", T2V, { image_url: IMAGE }, /does not take first_frame/],
    ["audio for happyhorse text-to-video", "happyhorse-1.1-t2v", { audio_url: AUDIO }, /does not take driving_audio/],
    ["a missing first frame", "wan2.6-i2v-flash", {}, /Image input is required/],
    ["two first frames", "happyhorse-1.1-i2v", { image_urls: [IMAGE], reference_images: [`${IMAGE}?2`] }, /takes one first frame/],
    ["a ratio for image-to-video", "wan2.6-i2v-flash", { image_url: IMAGE, aspect_ratio: "16:9" }, /ratio is not supported/],
    ["a size for image-to-video", "happyhorse-1.1-i2v", { image_url: IMAGE, size: "1280x720" }, /send resolution instead/],
    ["audio for reference-to-video", "wan2.7-r2v-2026-06-12", { reference_images: [IMAGE], audio_url: AUDIO }, /does not take driving_audio/],
    ["a missing source video", "happyhorse-1.0-video-edit", { image_url: IMAGE }, /Video input is required/],
    ["two source videos", "wan2.7-videoedit", { video_urls: [CLIP, `${CLIP}?2`] }, /one source video/],
    ["mixed media forms", "wan2.7-videoedit", { media: [{ type: "video", url: CLIP }], image_url: IMAGE }, /not both/],
    ["an unknown media type", "wan2.7-videoedit", { media: [{ type: "mask", url: CLIP }] }, /media type must be one of/],
    ["an unsupported resolution", T2V, { resolution: "480P" }, /resolution must be one of/],
    ["an unsupported ratio", T2V, { ratio: "21:9" }, /ratio must be one of/],
    ["an odd size", T2V, { size: "1000x1000" }, /720 or 1080 short side/],
    ["a size that disagrees", T2V, { size: "1280x720", resolution: "1080P" }, /disagrees/],
    ["disagreeing durations", T2V, { duration: 5, seconds: 10 }, /disagree/],
    ["a fractional duration", T2V, { duration: 2.5 }, /whole number/],
    ["a zero duration", T2V, { seconds: "0" }, /whole number/],
    ["a negative seed", T2V, { seed: -1 }, /seed/],
    ["a string watermark", T2V, { watermark: "yes" }, /watermark/],
    ["a missing prompt", T2V, { prompt: " " }, /text prompt/],
  ];
  for (const [label, model, body, message] of refusals) {
    it(`refuses ${label} before anything is sent`, async () => {
      const result = await generate(body, { model });
      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect((await errorBody(result)).message).toMatch(message);
      expect(calls).toHaveLength(0);
    });
  }

  const maliciousMedia = [
    "http://cdn.example.com/frame.png",
    "https://127.0.0.1/frame.png",
    "https://localhost/frame.png",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/frame.png",
    "https://10.0.0.5/frame.png",
    "https://user:pass@cdn.example.com/frame.png",
    "file:///etc/passwd",
    "data:image/png;base64,AAAA",
    `https://cdn.example.com/${"a".repeat(2100)}`,
  ];
  for (const url of maliciousMedia) {
    it(`refuses media URL ${url.slice(0, 48)} before anything is sent`, async () => {
      const result = await generate({ image_url: url }, { model: "wan2.6-i2v-flash" });
      expect(result.status).toBe(400);
      expect((await errorBody(result)).message).toMatch(/https URLs on a public host/);
      expect(calls).toHaveLength(0);
    });
  }
});

describe("job flow", () => {
  it("submits once to the fixed endpoint, polls the task and returns its URL", async () => {
    serve(accepted(), task("PENDING"), task("RUNNING"), succeeded());
    const result = await generate({ size: "1280x720", duration: 5 });
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.data).toEqual([{ url: VIDEO_A, format: "mp4" }]);
    expect(result.accounting).toMatchObject({
      modality: "video", nativeUnits: { videos: 1 }, cost: null, costStatus: "unknown", meta: { nativeUnitsSource: "returned-videos" },
    });
    expect(calls.map((call) => call.url)).toEqual([SUBMIT_URL, ...Array(3).fill(`${ORIGIN}/api/v1/tasks/${TASK_A}`)]);
    const submit = calls[0].init;
    expect(submit.method).toBe("POST");
    expect(submit.redirect).toBe("manual");
    expect(submit.headers).toMatchObject({ Authorization: `Bearer ${KEY_A}`, "X-DashScope-Async": "enable", "Content-Type": "application/json" });
    expect(JSON.parse(submit.body)).toEqual({ model: T2V, input: { prompt: PROMPT }, parameters: { resolution: "720P", ratio: "16:9", duration: 5 } });
    for (const poll of calls.slice(1)) {
      expect(poll.init.method).toBe("GET");
      expect(poll.init.redirect).toBe("error");
      expect(poll.init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
      expect(poll.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("can target the fixed china-beijing origin and nothing else", async () => {
    serve(accepted(), succeeded());
    const result = await generate({}, { options: { origin: ALIBABA_DASHSCOPE_CN_ORIGIN } });
    expect(result.success).toBe(true);
    expect(calls.map((call) => new URL(call.url).origin)).toEqual([ALIBABA_DASHSCOPE_CN_ORIGIN, ALIBABA_DASHSCOPE_CN_ORIGIN]);

    calls = [];
    const custom = await generate({}, { options: { origin: "https://attacker.example" } });
    expect(custom.status).toBe(500);
    expect(calls).toHaveLength(0);
  });

  it("ignores a connection base URL: the key only goes to DashScope", async () => {
    serve(accepted(), succeeded());
    const credentials = { apiKey: KEY_A, providerSpecificData: { baseUrl: "https://attacker.example/api/v1" } };
    expect((await generate({}, { credentials })).success).toBe(true);
    expect(calls.every((call) => new URL(call.url).origin === ORIGIN)).toBe(true);
  });

  it("requires an API key and sends nothing without one", async () => {
    for (const credentials of [null, {}, { apiKey: "" }, { apiKey: `${KEY_A}\r\nX-Evil: 1` }]) {
      const result = await generate({}, { credentials });
      expect(result.status).toBe(401);
      expect(result.acceptedJob).toBeUndefined();
    }
    expect(calls).toHaveLength(0);
  });

  it("keeps two credentials' tasks apart when they run at once", async () => {
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      const key = init.headers.Authorization.slice("Bearer ".length);
      const id = key === KEY_A ? TASK_A : TASK_B;
      if (String(url) === SUBMIT_URL) return accepted(id);
      expect(String(url)).toBe(`${ORIGIN}/api/v1/tasks/${id}`);
      return succeeded(key === KEY_A ? VIDEO_A : VIDEO_B, id);
    });
    const [a, b] = await Promise.all([
      generate({}, { credentials: { apiKey: KEY_A } }),
      generate({}, { credentials: { apiKey: KEY_B } }),
    ]);
    expect((await a.response.json()).data[0].url).toBe(VIDEO_A);
    expect((await b.response.json()).data[0].url).toBe(VIDEO_B);
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      const key = call.init.headers.Authorization.slice("Bearer ".length);
      if (call.url !== SUBMIT_URL) expect(call.url).toContain(key === KEY_A ? TASK_A : TASK_B);
    }
  });
});

describe("submit refusals", () => {
  it("reports a refused key as 401 without upstream text or an accepted job", async () => {
    serve(refused(401, "InvalidApiKey"));
    const result = await generate();
    expect(result.status).toBe(401);
    expect(result.acceptedJob).toBeUndefined();
    expect((await errorBody(result)).message).toContain("InvalidApiKey");
    await assertNoSecrets(result);
    expect(calls).toHaveLength(1);
  });

  it("flags an unpaid or unpurchased account as quota exhaustion on this connection", async () => {
    for (const [status, code] of [[400, "Arrearage"], [403, "AccessDenied.Unpurchased"]]) {
      calls = [];
      serve(refused(status, code));
      const result = await generate();
      expect(result.status).toBe(402);
      expect(result.quotaExhausted).toBe(true);
      expect(result.acceptedJob).toBeUndefined();
      await assertNoSecrets(result);
      expect(calls).toHaveLength(1);
    }
  });

  it("keeps a throttle as a 429 with only a bounded Retry-After reset", async () => {
    serve(refused(429, "Throttling.RateQuota", "slow down", { "retry-after": "30" }));
    const result = await generate();
    expect(result.status).toBe(429);
    expect(result.quotaExhausted).toBeUndefined();
    expect(result.rateLimitEvidence?.source).toBe("retry_after");
    expect(result.rateLimitEvidence.resetAtMs).toBeGreaterThan(Date.now());
    expect(result.acceptedJob).toBeUndefined();
  });

  it("passes an ordinary 400 and drops a code of an unsafe shape", async () => {
    serve(refused(400, `<script>${KEY_A}</script>`));
    const result = await generate();
    expect(result.status).toBe(400);
    expect((await errorBody(result)).message).toBe("Alibaba DashScope refused the video request with 400");
    expect(result.acceptedJob).toBeUndefined();
  });

  it("treats a 5xx submit as an unknown outcome and never resends it", async () => {
    serve(refused(500, "InternalError"));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect without following it", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://attacker.example/steal" } }));
    const result = await generate();
    expect(result.status).toBe(502);
    expect((await errorBody(result)).message).toMatch(/redirect refused/);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats an answer from another host as an unknown outcome", async () => {
    const moved = accepted();
    Object.defineProperty(moved, "redirected", { value: true });
    Object.defineProperty(moved, "url", { value: "https://attacker.example/api" });
    serve(moved);
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });
});

describe("uncertain submits", () => {
  it("records an interrupted submit as possibly accepted and never resends it", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    await assertNoSecrets(result);
    expect(calls).toHaveLength(1);
  });

  it("knows a connect failure sent nothing", async () => {
    serve(() => { throw transportError("ENOTFOUND"); });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("treats a 2xx without a usable task id as an unknown outcome", async () => {
    for (const body of [{ output: {} }, { output: { task_id: "../../etc" } }, "not json"]) {
      calls = [];
      serve(isFunction(body) ? body : new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 }));
      const result = await generate();
      expect(result.status).toBe(502);
      expect(result.acceptedJob?.meta.jobState).toBe("accepted");
      expect(calls).toHaveLength(1);
    }
  });

  it("bounds a submit that never answers, even if the transport ignores its signal", async () => {
    serve(() => new Promise(() => {}));
    const result = await generate({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("does not send a submit after the caller has gone", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("marks a submit aborted in flight as possibly accepted", async () => {
    const controller = new AbortController();
    serve(() => {
      controller.abort();
      return new Promise(() => {});
    });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });
});

describe("task outcomes", () => {
  it("reports a FAILED task as a failure, with its code only", async () => {
    serve(accepted(), task("FAILED", { code: "DataInspectionFailed", message: `bad prompt ${PROMPT} ${KEY_A}` }));
    const result = await generate();
    expect(result.status).toBe(502);
    expect((await errorBody(result)).message).toBe("Alibaba DashScope video task failed (DataInspectionFailed)");
    expect(result.acceptedJob).toBeUndefined();
    await assertNoSecrets(result);
  });

  it("treats UNKNOWN_ERROR, CANCELED and unknown statuses as unknown outcomes", async () => {
    for (const status of ["UNKNOWN_ERROR", "CANCELED", "WHATEVER"]) {
      calls = [];
      serve(accepted(), task(status));
      const result = await generate();
      expect(result.status).toBe(502);
      expect(result.acceptedJob?.meta.jobState).toBe("accepted");
      expect(calls).toHaveLength(2);
    }
  });

  it("refuses an answer about another task", async () => {
    serve(accepted(), succeeded(VIDEO_A, TASK_B));
    const result = await generate();
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect((await errorBody(result)).message).toMatch(/different video task/);
  });

  it("stops at the job deadline and records the task", async () => {
    serve(accepted(), ...Array(20).fill(null).map(() => () => task("RUNNING")));
    const result = await generate({}, { options: { timeoutMs: 3_500 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(4);
  });

  it("bounds a status check that never answers", async () => {
    serve(accepted(), (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    const result = await generate({}, { options: { requestTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
  });

  it("stops polling when the caller aborts and sends nothing more", async () => {
    const controller = new AbortController();
    serve(accepted(), () => {
      controller.abort();
      return task("RUNNING");
    });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("retries a throttled status check, then succeeds", async () => {
    serve(accepted(), json({}, 429, { "retry-after": "2" }), json({}, 503), succeeded());
    const result = await generate();
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it("does not hide a refused status check: the task stays recorded", async () => {
    serve(accepted(), refused(401, "InvalidApiKey"));
    const result = await generate();
    expect(result.status).toBe(401);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    await assertNoSecrets(result);
  });

  const maliciousResults = [
    "http://dashscope-result-sgp.oss-accelerate.aliyuncs.com/a.mp4",
    "https://127.0.0.1/a.mp4",
    "https://[::ffff:127.0.0.1]/a.mp4",
    "https://169.254.169.254/latest/meta-data/iam",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://localhost:20128/api/keys",
    "https://user:pw@dashscope-result-sgp.oss-accelerate.aliyuncs.com/a.mp4",
    "javascript:alert(1)",
    `https://dashscope-result-sgp.oss-accelerate.aliyuncs.com/${"a".repeat(5000)}`,
    "",
    null,
  ];
  for (const url of maliciousResults) {
    it(`never returns or fetches result URL ${String(url).slice(0, 48)}`, async () => {
      serve(accepted(), succeeded(url));
      const result = await generate();
      expect(result.success).toBe(false);
      expect(result.status).toBe(502);
      expect(result.acceptedJob?.meta.jobState).toBe("accepted");
      expect(calls).toHaveLength(2);
      expect(alibabaVideoResultUrl(url)).toBeNull();
    });
  }
});

describe("job client", () => {
  it("returns the media core shape", async () => {
    serve(accepted(), succeeded());
    const result = await runAlibabaVideoJob({
      request: buildAlibabaVideoRequest(T2V, { prompt: PROMPT }),
      credentials: { apiKey: KEY_A },
      ...polling(),
    });
    expect(result).toMatchObject({ success: true, url: VIDEO_A, accounting: { modality: "video", costStatus: "unknown" } });
  });
});
