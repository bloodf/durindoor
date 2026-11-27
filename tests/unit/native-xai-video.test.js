// xAI (Grok Imagine) native video adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every credential is synthetic. Wire shapes follow
// OmniRoute c71f0065 (videoRegistry.ts `xai`, videoGeneration.ts format
// dispatch, videoGeneration/xaiGrokImagineHandler.ts) and the OpenAI envelope
// follows CLIProxyAPI 47f18e4 (openai_videos_handlers.go). Passing here says
// nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-xai-video/index.js";
import {
  XAI_VIDEO_MODELS,
  buildXaiVideoRequest,
  createXaiVideoAdapter,
  openAIVideoFromXaiCreate,
  openAIVideoFromXaiStatus,
  openAIVideoStatus,
  resolveXaiTiming,
  resolveXaiVideoContent,
  xaiCredential,
  xaiVideoAdapter,
} from "../../open-sse/services/providerParity/native-xai-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { handleVideoProxyCore } from "../../open-sse/handlers/videoCore.js";
import xaiRegistry from "../../open-sse/providers/registry/xai.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://api.x.ai";
const VIDEOS = `${ORIGIN}/v1/videos`;
const KEY_A = "xai-SYNTHETIC-key-a-00000001";
const KEY_B = "xai-SYNTHETIC-key-b-00000002";
const OAUTH_A = "xai-SYNTHETIC-oauth-access-a-0001";
const REFRESH_A = "xai-SYNTHETIC-refresh-a-0001";
const PROMPT = "a lantern drifting over a misty forest";
const OUT_A = "https://vidgen.x.ai/out/a.mp4?sig=1";
const OUT_B = "https://vidgen.x.ai/out/b.mp4?sig=2";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-xai-video/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, code, headers = {}) =>
  json({ code, error: `upstream echo ${KEY_A} ${PROMPT}` }, status, headers);
const pending = (status = "pending") => json({ status });
const done = (url, extra = {}) => json({ status: "done", video: { url, duration: 8, respect_moderation: true }, model: "grok-imagine-video", ...extra });
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

const originalFetch = global.fetch;
let calls;
let clock;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: isFunction(init?.body?.getReader) ? undefined : init?.body ? JSON.parse(init.body) : undefined });
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
const video = (body = {}, { model = "grok-imagine-video", credentials = { apiKey: KEY_A, authType: "apikey" }, signal, options } = {}) =>
  createXaiVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  for (const secret of [KEY_A, KEY_B, OAUTH_A, REFRESH_A, "upstream echo", PROMPT]) expect(text).not.toContain(secret);
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
  vi.unstubAllGlobals();
});

// Staging-only negatives. Registration replaces this block with positive
// adapter identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered for /v1/video/generations", () => {
    expect(getVideoGenerationAdapter("xai")).toBeNull();
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.XAI_PROVIDER_ID).toBe("xai");
    expect(staged.XAI_VIDEOS_URL).toBe(VIDEOS);
    expect(staged.XAI_VIDEO_GENERATIONS_URL).toBe(`${VIDEOS}/generations`);
    expect(staged.XAI_VIDEO_ACTION_URLS).toEqual({
      generations: `${VIDEOS}/generations`, edits: `${VIDEOS}/edits`, extensions: `${VIDEOS}/extensions`,
    });
    expect(staged.xaiVideoStatusUrl("req_1")).toBe(`${VIDEOS}/req_1`);
    expect(staged.XAI_AUTH_HEADER).toBe("Authorization");
    expect(staged.XAI_AUTH_SCHEME).toBe("Bearer");
    expect(staged.XAI_VIDEO_FORMAT).toBe("xai-video");
    expect(staged.XAI_JOB_TIMEOUT_MS).toBe(300_000);
    expect(staged.XAI_MAX_JOB_TIMEOUT_MS).toBe(30 * 60_000);
    expect(staged.XAI_POLL_INTERVAL_MS).toBe(2_500);
    expect(staged.XAI_MAX_POLLS).toBe(300);
    expect(staged.XAI_MAX_RESPONSE_BYTES).toBe(1024 * 1024);
    expect(xaiVideoAdapter.provider).toBe("xai");
    expect(xaiVideoAdapter.responseFormats).toEqual(["url"]);
    expect(xaiVideoAdapter.async).toBe(true);
    expect(isFunction(xaiVideoAdapter.generate)).toBe(true);
  });

  it("matches the existing xai entry's identity, auth modes, video models and async config", () => {
    expect(xaiRegistry.id).toBe(staged.XAI_PROVIDER_ID);
    expect(xaiRegistry.alias).toBe(staged.XAI_ALIAS);
    expect(xaiRegistry.authModes).toEqual(["oauth", "apikey"]);
    expect(xaiRegistry.serviceKinds).toContain("video");
    expect(xaiRegistry.videoConfig.baseUrl).toBe(VIDEOS);
    const registryVideo = xaiRegistry.models.filter((m) => m.kind === "video");
    expect(registryVideo.map((m) => m.id).sort()).toEqual(XAI_VIDEO_MODELS.map((m) => m.id).sort());
    for (const row of XAI_VIDEO_MODELS) {
      const local = registryVideo.find((m) => m.id === row.id);
      expect(local.aliases ?? []).toEqual(row.aliases ? [...row.aliases] : []);
      expect(local.params.includes("generate_audio")).toBe(row.generateAudio);
    }
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.comparedWith.commit).toBe("47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e");
    expect(REGISTRATION.provider.canonicalId).toBe("xai");
    expect(REGISTRATION.provider.aliases).toEqual(["xai"]);
    expect(REGISTRATION.provider.authModes).toEqual(["apikey", "oauth"]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual([]);
    expect(REGISTRATION.models.video.map((m) => m.id)).toEqual(XAI_VIDEO_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.create.url).toBe(`${VIDEOS}/generations`);
    expect(REGISTRATION.endpoints.status.url).toBe(`${VIDEOS}/{request_id}`);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("video request contract", () => {
  it("creates with the source body and Bearer key, then polls /v1/videos/{request_id}", async () => {
    serve(json({ request_id: "req_1" }), pending("pending"), pending("processing"), done(OUT_A));
    const result = await video({ duration: 8, aspect_ratio: "16:9", resolution: "720p", image: "https://cdn.example.com/start.png" });
    expect(result.success).toBe(true);
    expect(await payload(result)).toEqual({ created: Math.floor(clock / 1000), data: [{ url: OUT_A, format: "mp4" }] });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", `${VIDEOS}/generations`],
      ["GET", `${VIDEOS}/req_1`],
      ["GET", `${VIDEOS}/req_1`],
      ["GET", `${VIDEOS}/req_1`],
    ]);
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].body).toEqual({
      model: "grok-imagine-video", prompt: PROMPT, duration: 8, aspect_ratio: "16:9", resolution: "720p",
      image: { url: "https://cdn.example.com/start.png" },
    });
    for (const call of calls.slice(1)) {
      expect(call.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
      expect(call.init.body).toBeUndefined();
      expect(call.init.redirect).toBe("manual");
    }
  });

  it("sends only model and prompt when nothing optional is given", () => {
    expect(buildXaiVideoRequest("grok-imagine-video", { prompt: ` ${PROMPT} ` }).request).toEqual({ model: "grok-imagine-video", prompt: PROMPT });
  });

  it("canonicalizes aliases and an xai/ prefix, and refuses other models", () => {
    expect(buildXaiVideoRequest("grok-imagine-video-1.5-preview", { prompt: PROMPT }).request.model).toBe("grok-imagine-video-1.5");
    expect(buildXaiVideoRequest("grok-imagine-video-1.5-2026-05-30", { prompt: PROMPT }).request.model).toBe("grok-imagine-video-1.5");
    expect(buildXaiVideoRequest("xai/grok-imagine-video-1.5-lite", { prompt: PROMPT }).request.model).toBe("grok-imagine-video-1.5-lite");
    expect(() => buildXaiVideoRequest("grok-imagine-image", { prompt: PROMPT })).toThrow(/Unsupported xAI video model/);
    expect(() => buildXaiVideoRequest("sora-2", { prompt: PROMPT })).toThrow(/Unsupported xAI video model/);
  });

  it("maps CPA's OpenAI-style seconds, size, input_reference and reference images", () => {
    const { request, meta } = buildXaiVideoRequest("grok-imagine-video", {
      prompt: PROMPT, seconds: "6", size: "720x1280", reference_image_urls: ["https://cdn.example.com/r1.png", { image_url: { url: "https://cdn.example.com/r2.png" } }],
    });
    expect(request).toEqual({
      model: "grok-imagine-video", prompt: PROMPT, duration: 6, aspect_ratio: "9:16", resolution: "720p",
      reference_images: [{ url: "https://cdn.example.com/r1.png" }, { url: "https://cdn.example.com/r2.png" }],
    });
    expect(meta).toEqual({ model: "grok-imagine-video", prompt: PROMPT, seconds: "6", size: "720x1280" });
    expect(buildXaiVideoRequest("grok-imagine-video", { prompt: PROMPT, input_reference: { image_url: "data:image/png;base64,iVBORw0KGgo=" } }).request.image)
      .toEqual({ url: "data:image/png;base64,iVBORw0KGgo=" });
    expect(buildXaiVideoRequest("grok-imagine-video", { prompt: PROMPT, aspect_ratio: "Portrait", resolution: "1080P" }).request)
      .toMatchObject({ aspect_ratio: "9:16", resolution: "1080p" });
    expect(buildXaiVideoRequest("grok-imagine-video-1.5", { prompt: PROMPT, generate_audio: true }).request.generate_audio).toBe(true);
  });

  it("refuses unsupported or unsafe inputs with a 400 before anything is sent", async () => {
    const refused = [
      [{ prompt: "" }, /text prompt/],
      [{ prompt: 7 }, /text prompt/],
      [{ n: 2 }, /n=1/],
      [{ stream: true }, /streaming/],
      [{ response_format: "b64_json" }, /url only/],
      [{ negative_prompt: "x" }, /does not support negative_prompt/],
      [{ duration: 16 }, /1 to 15/],
      [{ duration: 2.5 }, /1 to 15/],
      [{ duration: 5, seconds: 6 }, /disagree/],
      [{ size: "1024x1024" }, /size must be one of/],
      [{ size: "1280x720", aspect_ratio: "9:16" }, /disagree/],
      [{ aspect_ratio: "21:9" }, /aspect_ratio/],
      [{ resolution: "4k" }, /resolution/],
      [{ generate_audio: true }, /does not support generate_audio/],
      [{ image: "http://cdn.example.com/a.png" }, /public https/],
      [{ image: "https://127.0.0.1/a.png" }, /public https/],
      [{ image: "https://user:pw@cdn.example.com/a.png" }, /public https/],
      [{ image: "data:text/html;base64,PGh0bWw+" }, /data:image/],
      [{ input_reference: { file_id: "file_1" } }, /file_id is not supported/],
      [{ image: "https://cdn.example.com/a.png", image_url: "https://cdn.example.com/b.png" }, /one start image/],
      [{ image: "https://cdn.example.com/a.png", reference_images: ["https://cdn.example.com/b.png"] }, /cannot be combined/],
      [{ reference_images: Array.from({ length: 8 }, (_, i) => `https://cdn.example.com/${i}.png`) }, /at most 7/],
      [{ timeout_ms: 0 }, /timeout_ms/],
      [{ timeout_ms: 31 * 60_000 }, /timeout_ms/],
      [{ poll_interval_ms: 500 }, /poll_interval_ms/],
      [{ max_polls: 301 }, /max_polls/],
    ];
    for (const [body, pattern] of refused) {
      const result = await video(body);
      expect(result.status, JSON.stringify(body)).toBe(400);
      expect(await errorMessage(result)).toMatch(pattern);
      expect(result.acceptedJob).toBeUndefined();
    }
    const unknownModel = await video({}, { model: "grok-4.7" });
    expect(unknownModel.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("reads timeout_ms, poll_interval_ms and max_polls with the source bounds and never forwards them", async () => {
    expect(resolveXaiTiming({})).toEqual({ timeoutMs: 300_000, pollIntervalMs: 2_500, maxPolls: 120 });
    expect(resolveXaiTiming({ timeout_ms: 10_000, poll_interval_ms: "1000", max_polls: 3 })).toEqual({ timeoutMs: 10_000, pollIntervalMs: 1_000, maxPolls: 3 });
    serve(json({ request_id: "req_1" }), pending(), pending(), pending());
    const result = await createXaiVideoAdapter({ wait: polling().wait, now: () => clock })
      .generate({ model: "grok-imagine-video", body: { prompt: PROMPT, timeout_ms: 600_000, poll_interval_ms: 1_000, max_polls: 3 }, credentials: { apiKey: KEY_A } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(4);
    expect(calls[0].body).toEqual({ model: "grok-imagine-video", prompt: PROMPT });
  });
});

describe("auth modes and connection identity", () => {
  it("sends the API key for an apikey connection and the access token for an OAuth one", async () => {
    expect(xaiCredential({ authType: "apikey", apiKey: KEY_A, accessToken: OAUTH_A })).toEqual({ token: KEY_A, mode: "apikey" });
    expect(xaiCredential({ authType: "oauth", apiKey: KEY_A, accessToken: OAUTH_A })).toEqual({ token: OAUTH_A, mode: "oauth" });
    expect(xaiCredential({ apiKey: KEY_A, accessToken: OAUTH_A })).toEqual({ token: KEY_A, mode: "apikey" });
    expect(xaiCredential({ accessToken: OAUTH_A })).toEqual({ token: OAUTH_A, mode: "oauth" });
    expect(xaiCredential({ authType: "oauth", apiKey: KEY_A })).toBeNull();
    expect(xaiCredential({ authType: "apikey", apiKey: `${KEY_A}\r\nX-Evil: 1` })).toBeNull();

    serve(json({ request_id: "req_o" }), done(OUT_A));
    const oauth = await video({}, { credentials: { authType: "oauth", accessToken: OAUTH_A, refreshToken: REFRESH_A, connectionId: "conn-o" } });
    expect(oauth.success).toBe(true);
    for (const call of calls) expect(call.init.headers.Authorization).toBe(`Bearer ${OAUTH_A}`);
    expect(oauth.accounting.meta).toMatchObject({ jobId: "req_o", authMode: "oauth", connectionId: "conn-o" });
  });

  it("refuses a missing credential before anything is sent", async () => {
    const result = await video({}, { credentials: { authType: "apikey" } });
    expect(result.status).toBe(401);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("does not refresh or retry an OAuth 401 inside the adapter", async () => {
    serve(leaky(401, "invalid_token"));
    const result = await video({}, { credentials: { authType: "oauth", accessToken: OAUTH_A, refreshToken: REFRESH_A } });
    expect(result.status).toBe(401);
    expect(result.authFailed).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("keeps two connections' credentials and request ids apart", async () => {
    const idFor = (init) => (init.headers.Authorization === `Bearer ${KEY_A}` ? "req_a" : "req_b");
    const answer = (url) => (url.endsWith("/req_a") ? done(OUT_A) : done(OUT_B));
    serve((_u, init) => json({ request_id: idFor(init) }), (_u, init) => json({ request_id: idFor(init) }), answer, answer);
    const [a, b] = await Promise.all([
      video({}, { credentials: { apiKey: KEY_A, authType: "apikey", connectionId: "conn-a" } }),
      video({}, { credentials: { apiKey: KEY_B, authType: "apikey", connectionId: "conn-b" } }),
    ]);
    expect((await payload(a)).data[0].url).toBe(OUT_A);
    expect((await payload(b)).data[0].url).toBe(OUT_B);
    expect(a.accounting.meta).toMatchObject({ jobId: "req_a", connectionId: "conn-a" });
    expect(b.accounting.meta).toMatchObject({ jobId: "req_b", connectionId: "conn-b" });
    for (const call of calls.filter((c) => c.init.method === "GET")) {
      expect(call.init.headers.Authorization).toBe(call.url.endsWith("/req_a") ? `Bearer ${KEY_A}` : `Bearer ${KEY_B}`);
    }
  });

  it("ignores a connection base URL and only talks to the fixed origin", async () => {
    serve(json({ request_id: "req_1" }), done(OUT_A));
    const result = await video({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example", providerSpecificData: { baseUrl: "https://evil.example" } } });
    expect(result.success).toBe(true);
    for (const call of calls) expect(new URL(call.url).origin).toBe(ORIGIN);
  });
});

describe("usage accounting", () => {
  it("counts the returned video and response-measured seconds, cost unknown without a receipt", async () => {
    serve(json({ request_id: "req_1" }), done(OUT_A));
    const result = await video({ duration: 12 });
    expect(result.accounting).toMatchObject({
      modality: "video", nativeUnits: { videos: 1, videoSeconds: 8 }, cost: null, costStatus: "unknown", costSource: "unavailable",
    });
    expect(result.accounting.meta.nativeUnitsSource).toBe("response-duration");
  });

  it("never bills requested duration when the response has none", async () => {
    serve(json({ request_id: "req_1" }), json({ status: "done", video: { url: OUT_A } }));
    const result = await video({ duration: 12 });
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
    expect(result.accounting.meta.nativeUnitsSource).toBe("returned-videos");
  });

  it("keeps a provider USD receipt when xAI sends one", async () => {
    serve(json({ request_id: "req_1" }), done(OUT_A, { usage: { cost_in_usd_ticks: 5_000_000_000 } }));
    const result = await video();
    expect(result.accounting.meta.providerCost).toEqual({ path: "usage.cost_in_usd_ticks", value: 5_000_000_000 });
    expect(result.accounting.costStatus).toBe("known");
    expect(result.accounting.cost).toBeCloseTo(0.5);
  });
});

describe("job outcomes", () => {
  it("accepts every done spelling and every pending spelling", async () => {
    for (const status of ["done", "completed", "succeeded", "success"]) {
      serve(json({ request_id: "req_1" }), pending("queued"), pending("in_progress"), pending("running"), json({ status, video: { url: OUT_A } }));
      expect((await video()).success).toBe(true);
    }
  });

  it("reports a failed job as an ordinary failure without leaking upstream text", async () => {
    serve(json({ request_id: "req_1" }), json({ status: "failed", code: "content_moderated", error: { message: `nope ${KEY_A} ${PROMPT}` } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(await errorMessage(result)).toContain("content_moderated");
    await assertNoLeak(result);
  });

  it("keeps expired, unknown-status, other-request and URL-less done answers as accepted work", async () => {
    const cases = [
      json({ status: "expired" }),
      json({ status: "mystery" }),
      json({ status: "" }),
      json({ request_id: "req_other", status: "done", video: { url: OUT_A } }),
      json({ status: "done", video: {} }),
      json({ status: "done", video: { url: "http://vidgen.x.ai/a.mp4" } }),
      json({ status: "done", video: { url: "https://169.254.169.254/latest/meta-data" } }),
      json({ status: "done", video: { url: "https://user:pw@vidgen.x.ai/a.mp4" } }),
      new Response(`not json ${KEY_A}`, { status: 200 }),
      json(["done"]),
    ];
    for (const answer of cases) {
      calls = [];
      serve(json({ request_id: "req_1" }), answer);
      const result = await video();
      expect(result.success).toBe(false);
      expect(result.acceptedJob.meta.jobState).toBe("accepted");
      expect(result.acceptedJob.costStatus).toBe("unknown");
      expect(result.acceptedJob.costSource).toBe("accepted-job");
      expect(calls).toHaveLength(2);
      await assertNoLeak(result);
    }
  });

  it("refuses an oversized status body", async () => {
    serve(json({ request_id: "req_1" }), new Response("x".repeat(1024 * 1024 + 10), { status: 200 }));
    const result = await video();
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(result.status).toBe(502);
  });

  it("retries 429/503 status checks a bounded number of times", async () => {
    serve(json({ request_id: "req_1" }), json({}, 429, { "retry-after": "2" }), json({}, 503), done(OUT_A));
    const ok = await video();
    expect(ok.success).toBe(true);
    expect(calls).toHaveLength(4);

    calls = [];
    serve(json({ request_id: "req_1" }), ...Array.from({ length: 6 }, () => json({}, 429)));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(7);
  });

  it("passes a rejected status check's auth status on with acceptedJob", async () => {
    serve(json({ request_id: "req_1" }), leaky(403, "forbidden"));
    const result = await video();
    expect(result.status).toBe(403);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "accepted", jobId: "req_1", authMode: "apikey" });
    await assertNoLeak(result);
  });

  it("stops at the job deadline with an unknown outcome", async () => {
    serve(json({ request_id: "req_1" }), pending());
    const result = await video({}, { options: { timeoutMs: 1_500 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("bounds a hanging status check", async () => {
    let seen;
    serve(json({ request_id: "req_1" }), (_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await video({}, { options: { requestTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(seen.aborted).toBe(true);
  });
});

describe("create failures, uncertainty and no replay", () => {
  it("maps create refusals, quota and rate limits without leaking", async () => {
    serve(leaky(402, "payment_required"));
    const quota = await video();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    expect(quota.acceptedJob).toBeUndefined();
    await assertNoLeak(quota);

    serve(leaky(403, "insufficient_credits"));
    const credits = await video();
    expect(credits.status).toBe(402);
    expect(credits.quotaExhausted).toBe(true);
    expect(await errorMessage(credits)).toContain("insufficient_credits");

    serve(leaky(401, "invalid_api_key"));
    const auth = await video();
    expect(auth.status).toBe(401);
    expect(auth.acceptedJob).toBeUndefined();
    await assertNoLeak(auth);

    serve(leaky(429, "rate_limited", { "retry-after": "30" }));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob).toBeUndefined();
    await assertNoLeak(limited);

    serve(leaky(422, "invalid_argument"));
    const bad = await video();
    expect(bad.status).toBe(422);
    expect(bad.acceptedJob).toBeUndefined();
    await assertNoLeak(bad);

    serve(leaky(500, "internal"));
    const unknown = await video();
    expect(unknown.status).toBe(502);
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(unknown);
    expect(posts()).toHaveLength(6);
    expect(calls).toHaveLength(6);
  });

  it("refuses a create redirect without following it", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats an answer from another origin as submit-unknown", async () => {
    const foreign = json({ request_id: "req_1" });
    Object.defineProperty(foreign, "url", { value: "https://evil.example/v1/videos/generations" });
    serve(foreign);
    const result = await video();
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("treats a create without a usable request_id as submit-unknown work", async () => {
    for (const answer of [json({ status: "pending" }), json({ request_id: "../../etc/passwd" }), json({ request_id: "a".repeat(257) }), new Response(`not json ${KEY_A}`, { status: 200 })]) {
      calls = [];
      serve(answer);
      const result = await video();
      expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
      expect(calls).toHaveLength(1);
      await assertNoLeak(result);
    }
  });

  it("bounds the create and never replays an uncertain one", async () => {
    let seen;
    serve((_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await video({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(await errorMessage(result)).toMatch(/not resubmitted/);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);

    serve(() => { throw new TypeError("socket hang up"); });
    const reset = await video();
    expect(reset.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(2);
  });

  it("reports a proven pre-connect failure without acceptedJob or leaking", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });
});

describe("cancellation", () => {
  it("aborts polling on the caller's signal and keeps the accepted job", async () => {
    const controller = new AbortController();
    serve(json({ request_id: "req_1" }), () => { controller.abort(); return pending(); });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta).toMatchObject({ jobState: "accepted", jobId: "req_1" });
    expect(calls).toHaveLength(2);
  });

  it("aborts an in-flight status socket on the caller's signal", async () => {
    const controller = new AbortController();
    let seen;
    serve(json({ request_id: "req_1" }), (_url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(seen.aborted).toBe(true);
  });

  it("aborts an in-flight create and keeps it as submit-unknown", async () => {
    const controller = new AbortController();
    let seen;
    serve((_url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
  });

  it("returns 499 without acceptedJob when aborted before create", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("OpenAI video envelope (CPA delta)", () => {
  it("maps xAI statuses as CPA openAIVideoStatus does", () => {
    expect(["queued", "pending", "in_progress", "processing", "running", "completed", "done", "succeeded", "success", "failed", "error", "expired", "cancelled", "canceled", "weird"].map(openAIVideoStatus))
      .toEqual(["queued", "queued", "in_progress", "in_progress", "in_progress", "completed", "completed", "completed", "completed", "failed", "failed", "failed", "failed", "failed", ""]);
  });

  it("builds the create video object from request_id and request metadata", () => {
    const { meta } = buildXaiVideoRequest("grok-imagine-video-1.5-preview", { prompt: PROMPT, seconds: 6, size: "1280x720" });
    expect(openAIVideoFromXaiCreate({ request_id: "req_1" }, meta, 1_700_000_000)).toEqual({
      object: "video", id: "req_1", model: "grok-imagine-video-1.5", status: "queued", progress: 0,
      prompt: PROMPT, created_at: 1_700_000_000, seconds: "6", size: "1280x720",
    });
    expect(openAIVideoFromXaiCreate({ status: "pending" }, meta)).toBeNull();
    expect(openAIVideoFromXaiCreate({ request_id: "../x" }, meta)).toBeNull();
  });

  it("builds the retrieve video object with a public video_url and no upstream error text", () => {
    expect(openAIVideoFromXaiStatus("req_1", { status: "done", video: { url: OUT_A, duration: 8 }, model: "grok-imagine-video", progress: 100 })).toEqual({
      object: "video", id: "req_1", model: "grok-imagine-video", status: "completed", progress: 100, seconds: "8", video_url: OUT_A,
    });
    expect(openAIVideoFromXaiStatus("req_1", { status: "pending" }, "grok-imagine-video-1.5-lite")).toEqual({
      object: "video", id: "req_1", model: "grok-imagine-video-1.5-lite", status: "queued",
    });
    const failed = openAIVideoFromXaiStatus("req_1", { error: { message: `boom ${KEY_A}`, code: "moderation" } });
    expect(failed).toEqual({ object: "video", id: "req_1", model: "grok-imagine-video", status: "failed", progress: 0, error: { code: "moderation", message: "Video generation failed" } });
    expect(JSON.stringify(failed)).not.toContain(KEY_A);
    expect(openAIVideoFromXaiStatus("req_1", { status: "done", video: { url: "http://10.0.0.1/a.mp4" } }).video_url).toBeUndefined();
  });

  it("resolves content to the public URL with one status read and never downloads it", async () => {
    serve(done(OUT_A));
    const ok = await resolveXaiVideoContent({ videoId: "req_1", credentials: { apiKey: KEY_A, authType: "apikey" } });
    expect(ok).toEqual({ success: true, url: OUT_A });
    expect(calls.map((c) => [c.init.method, c.url, c.init.headers])).toEqual([["GET", `${VIDEOS}/req_1`, { Authorization: `Bearer ${KEY_A}` }]]);

    serve(pending());
    expect((await resolveXaiVideoContent({ videoId: "req_1", credentials: { apiKey: KEY_A } })).status).toBe(409);
    serve(json({ status: "done", video: { url: "https://localhost/a.mp4" } }));
    expect((await resolveXaiVideoContent({ videoId: "req_1", credentials: { apiKey: KEY_A } })).status).toBe(502);
    serve(leaky(404, "not_found"));
    const missing = await resolveXaiVideoContent({ videoId: "req_1", credentials: { apiKey: KEY_A } });
    expect(missing.status).toBe(404);
    await assertNoLeak(missing);
    expect(calls).toHaveLength(4);

    expect((await resolveXaiVideoContent({ videoId: "req_1", variant: "thumbnail", credentials: { apiKey: KEY_A } })).status).toBe(400);
    expect((await resolveXaiVideoContent({ videoId: "../x", credentials: { apiKey: KEY_A } })).status).toBe(400);
    expect((await resolveXaiVideoContent({ videoId: "req_1", credentials: {} })).status).toBe(401);
    expect(calls).toHaveLength(4);
  });
});

// The native xAI create/edit/extend/retrieve wire already exists in
// videoCore.js; these pin that equivalence instead of duplicating it.
describe("existing /v1/videos proxy equivalence", () => {
  it.each(["generations", "edits", "extensions"])("forwards %s byte-for-byte to the CPA native path with a Bearer credential", async (action) => {
    const raw = JSON.stringify({ model: "grok-imagine-video", prompt: PROMPT, video: { url: "https://cdn.example.com/in.mp4" } });
    const fetchMock = vi.fn(async () => json({ request_id: `req_${action}` }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleVideoProxyCore({
      provider: "xai", action, rawBody: raw, contentType: "application/json", credentials: { apiKey: KEY_A },
    });
    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${VIDEOS}/${action}`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(init.body).toBe(raw);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retrieves GET /v1/videos/{request_id} with the OAuth access token", async () => {
    const fetchMock = vi.fn(async () => json({ status: "done", video: { url: OUT_A } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleVideoProxyCore({ provider: "xai", requestId: "req_1", credentials: { accessToken: OAUTH_A } });
    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${VIDEOS}/req_1`);
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${OAUTH_A}`);
  });
});
