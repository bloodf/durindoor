// Adobe Firefly Services API text-to-video, staged. Closed mocks only: every
// request is answered below, an unexpected URL fails the test, and every
// credential is synthetic. Passing here says nothing about the live service or
// about any account's Firefly Services video entitlement.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import provider, {
  ADOBE_FIREFLY_API_MODEL_IDS,
  ADOBE_FIREFLY_STAGED_VIDEO,
  ADOBE_FIREFLY_VIDEO_GENERATE_URL,
  ADOBE_FIREFLY_VIDEO_MODEL_IDS,
  ADOBE_FIREFLY_VIDEO_SECONDS,
  ADOBE_FIREFLY_VIDEO_SIZES,
  ADOBE_IMS_TOKEN_URL,
} from "../../open-sse/providers/private/adobe-firefly-api.js";
import defaultVideoAdapter, {
  buildAdobeFireflyVideoRequest,
  createAdobeFireflyApiVideoAdapter,
} from "../../open-sse/handlers/videoProviders/adobe-firefly-api.js";
import * as video from "../../open-sse/services/adobeFireflyApi/video.js";
import { createAdobeTokenCache } from "../../open-sse/services/adobeFireflyApi/auth.js";
import imageAdapter from "../../open-sse/handlers/imageProviders/adobe-firefly-api.js";
import { getVideoConfig } from "../../open-sse/handlers/videoCore.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const API = "https://firefly-api.adobe.io";
const CLIENT_A = "synthclienta0000000000000000000a";
const CLIENT_B = "synthclientb0000000000000000000b";
const SECRET_A = "p8e-SYNTHETIC-secret-account-a";
const SECRET_B = "p8e-SYNTHETIC-secret-account-b";
const TOKEN_A1 = "synthetic-ims-token-a-0001";
const TOKEN_A2 = "synthetic-ims-token-a-0002";
const TOKEN_B1 = "synthetic-ims-token-b-0001";
const PASTED = "synthetic-pasted-access-token-0001";
const JOB = "urn:ff:jobs:eso851211:86ffe2ea-d765-4bd3-b2fd-568ca8fc36ac";
const JOB_B = "urn:ff:jobs:eso851211:0b0b0b0b-0000-4000-8000-00000000000b";
const STATUS_URL = `${API}/v3/status/${JOB}`;
const CANCEL_URL = `${API}/v3/cancel/${JOB}`;
const VIDEO_1 = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/videos/one.mp4";
const VIDEO_2 = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/videos/two.mp4";
const SECRETS = [SECRET_A, SECRET_B, TOKEN_A1, TOKEN_A2, TOKEN_B1, PASTED];
const MODEL = "video1_standard";
const PROMPT = "a lone figure in a vast desert looking up at the sky";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const ims = (token = TOKEN_A1, expiresIn = 86_399) => json({ access_token: token, token_type: "bearer", expires_in: expiresIn });
// The submit answer's own statusUrl and cancelUrl point elsewhere; they must never be used.
const accepted = (jobId = JOB) => json({
  jobId, statusUrl: `https://attacker.example/v3/status/${jobId}`, cancelUrl: `https://attacker.example/v3/cancel/${jobId}`,
}, 202);
const running = (jobId = JOB) => json({ status: "running", jobId });
const succeeded = (urls = [VIDEO_1], jobId = JOB) => json({
  status: "succeeded", jobId,
  result: { size: { width: 1280, height: 720 }, outputs: urls.map((url, seed) => ({ seed, video: { url } })) },
});
const failedJob = (error_code, message = `upstream says ${TOKEN_A1}`) => json({ status: "failed", jobId: JOB, error_code, message });
const transportError = (code, message) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(message), { code }) });

const s2s = (clientId = CLIENT_A, secret = SECRET_A) => ({ apiKey: secret, providerSpecificData: { clientId } });
const pasted = () => ({ accessToken: PASTED, providerSpecificData: { clientId: CLIENT_A } });

const originalFetch = global.fetch;
let calls;
let virtual;
let cache;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

// Answers by URL, for concurrent requests whose order is not fixed.
function route(handler) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const answer = await handler(String(url), init);
    if (!answer) throw new Error(`Unexpected request: ${url}`);
    return answer;
  });
}

function clock() {
  let time = 1_000_000;
  const waits = [];
  return {
    waits,
    now: () => time,
    wait: async (ms, signal) => {
      signal?.throwIfAborted();
      waits.push(ms);
      time += ms;
    },
  };
}

let adapter;
function useAdapter(options = {}) {
  virtual = clock();
  cache = createAdobeTokenCache({ now: virtual.now });
  adapter = createAdobeFireflyApiVideoAdapter({ cache, wait: virtual.wait, now: virtual.now, ...options });
}

const run = ({ body = {}, credentials = s2s(), model = MODEL, ...options } = {}) =>
  adapter.generate({ model, body: { prompt: PROMPT, ...body }, credentials, log: null, ...options });

const submits = () => calls.filter((call) => call.url === ADOBE_FIREFLY_VIDEO_GENERATE_URL);
const mints = () => calls.filter((call) => call.url === ADOBE_IMS_TOKEN_URL);
const cancels = () => calls.filter((call) => call.init?.method === "PUT");
const authOf = (call) => call.init.headers.Authorization;

function expectNoSecrets(text) {
  for (const secret of SECRETS) expect(String(text)).not.toContain(secret);
  expect(String(text)).not.toContain("attacker.example");
}

function expectAccepted(result, jobState = "accepted") {
  expect(result.success).toBe(false);
  expect(result.acceptedJob).toMatchObject({
    modality: "video", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState },
  });
}

async function expectCleanError(result, status) {
  expect(result).toMatchObject({ success: false, status });
  expectNoSecrets(result.error);
  expectNoSecrets(await result.response.text());
}

beforeEach(() => {
  calls = [];
  useAdapter();
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe("adobe-firefly-api video staging", () => {
  it("keeps the provider's default export image-only and the video slice separate", () => {
    expect(provider).toMatchObject({ id: "adobe-firefly-api", serviceKinds: ["image"] });
    expect(provider).not.toHaveProperty("videoConfig");
    expect(provider.models.every((model) => model.kind === "image")).toBe(true);
    expect(ADOBE_FIREFLY_VIDEO_MODEL_IDS).toEqual(["video1_standard"]);
    expect(ADOBE_FIREFLY_VIDEO_MODEL_IDS.some((id) => ADOBE_FIREFLY_API_MODEL_IDS.includes(id))).toBe(false);
    expect(ADOBE_FIREFLY_STAGED_VIDEO).toMatchObject({
      serviceKinds: ["video"],
      models: [{ id: "video1_standard", kind: "video" }],
      videoConfig: { baseUrl: "https://firefly-api.adobe.io/v3/videos/generate" },
    });
    expect(ADOBE_FIREFLY_VIDEO_GENERATE_URL).toBe("https://firefly-api.adobe.io/v3/videos/generate");
    expect(ADOBE_FIREFLY_VIDEO_SECONDS).toBe(5);
    expect(ADOBE_FIREFLY_VIDEO_SIZES.map(([w, h]) => `${w}x${h}`)).toEqual([
      "1920x1080", "1280x720", "960x540", "1080x1920", "720x1280", "540x960", "1080x1080", "720x720", "540x540",
    ]);
  });

  it("keeps the image adapter from taking the video model", () => {
    expect(() => imageAdapter.buildUrl("video1_standard", s2s(), {}, {})).toThrow(/Unsupported Adobe Firefly Services image model/);
  });

  it("is reachable from no route: no registry entry and no video config", () => {
    expect(REGISTRY["adobe-firefly-api"]).toBeUndefined();
    expect(PROVIDER_MEDIA["adobe-firefly-api"]).toBeUndefined();
    expect(getVideoConfig("adobe-firefly-api")).toBeNull();
    expect(defaultVideoAdapter.async).toBe(true);
    expect(isFunction(defaultVideoAdapter.generate)).toBe(true);
  });

  it("uses gateway poll bounds sized for video", () => {
    expect(video.ADOBE_FIREFLY_VIDEO_POLL_INTERVAL_MS).toBe(10_000);
    expect(video.ADOBE_FIREFLY_VIDEO_POLL_TIMEOUT_MS).toBe(600_000);
    expect(video.ADOBE_FIREFLY_VIDEO_SUBMIT_TIMEOUT_MS).toBe(30_000);
  });
});

describe("adobe-firefly-api video request", () => {
  it("maps the documented text-to-video fields", () => {
    expect(buildAdobeFireflyVideoRequest(MODEL, {
      prompt: PROMPT, size: "1280x720", seconds: "5s", seed: 1842533538, bit_rate_factor: 20,
      camera_motion: "camera pan left", videoSettings: { promptStyle: "cinematic" }, shot_angle: "aerial shot", shotSize: "medium shot",
      response_format: "b64_json", n: 1,
    })).toEqual({
      prompt: PROMPT,
      sizes: [{ width: 1280, height: 720 }],
      seeds: [1842533538],
      bitRateFactor: 20,
      videoSettings: { cameraMotion: "camera pan left", promptStyle: "cinematic", shotAngle: "aerial shot", shotSize: "medium shot" },
    });
    expect(buildAdobeFireflyVideoRequest(MODEL, { prompt: PROMPT })).toEqual({ prompt: PROMPT });
  });

  it.each([
    ["16:9", "1080p", { width: 1920, height: 1080 }],
    ["9:16", "720p", { width: 720, height: 1280 }],
    ["1:1", "540p", { width: 540, height: 540 }],
  ])("maps aspect_ratio %s at %s to a documented size", (aspect_ratio, resolution, size) => {
    expect(buildAdobeFireflyVideoRequest(MODEL, { prompt: PROMPT, aspect_ratio, resolution }).sizes).toEqual([size]);
  });

  it.each([
    ["an image model", "image4_standard", {}, /image4_standard is an Adobe Firefly image model, not a video model/],
    ["an unknown model", "video2_pro", {}, /Unsupported Adobe Firefly Services video model/],
    ["a chat body", MODEL, { messages: [{ role: "user", content: "hi" }] }, /no chat/],
    ["an empty prompt", MODEL, { prompt: "  " }, /needs a text prompt/],
    ["a long prompt", MODEL, { prompt: "x".repeat(4097) }, /limited to 4096/],
    ["a keyframe image", MODEL, { image: { conditions: [{ source: { url: VIDEO_1 }, placement: { position: 0 } }] } }, /keyframes are not supported/],
    ["a first frame URL", MODEL, { image_url: "https://example.com/a.png" }, /keyframes are not supported/],
    ["several videos", MODEL, { n: 2 }, /one video per request/],
    ["another duration", MODEL, { seconds: 8 }, /must be 5/],
    ["an undocumented size", MODEL, { size: "1024x1024" }, /size must be one of/],
    ["an unknown ratio", MODEL, { aspect_ratio: "4:3", resolution: "720p" }, /aspect_ratio must be one of/],
    ["a ratio without resolution", MODEL, { aspect_ratio: "16:9" }, /needs a size of/],
    ["two seeds", MODEL, { seeds: [1, 2] }, /exactly one integer seed/],
    ["a bit rate out of range", MODEL, { bitRateFactor: 64 }, /0 to 63/],
    ["an unknown camera motion", MODEL, { cameraMotion: "orbit" }, /cameraMotion must be one of/],
  ])("refuses %s before any request", async (_label, model, body, message) => {
    serve();
    const result = await run({ model, body });
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toMatch(message);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("adobe-firefly-api video success", () => {
  it("mints an S2S token, submits once to the fixed endpoint, polls the fixed status URL and returns the URL unfetched", async () => {
    const credentials = s2s();
    serve(ims(TOKEN_A1), accepted(), running(), succeeded());
    const result = await run({ credentials, body: { size: "1920x1080", response_format: "b64_json" } });

    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.data).toEqual([{ url: VIDEO_1 }]);
    expect(Number.isInteger(payload.created)).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([ADOBE_IMS_TOKEN_URL, ADOBE_FIREFLY_VIDEO_GENERATE_URL, STATUS_URL, STATUS_URL]);

    const [mint, submit, poll] = calls;
    expect(new URLSearchParams(mint.init.body).get("grant_type")).toBe("client_credentials");
    expect(mint.init.redirect).toBe("error");
    expect(submit.init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(submit.init.headers).toEqual({
      "Content-Type": "application/json", Accept: "application/json",
      Authorization: `Bearer ${TOKEN_A1}`, "x-api-key": CLIENT_A, "x-model-version": "video1_standard",
    });
    expect(JSON.parse(submit.init.body)).toEqual({ prompt: PROMPT, sizes: [{ width: 1920, height: 1080 }] });
    expect(poll.init).toMatchObject({ method: "GET", redirect: "error" });
    expect(poll.init.headers).toEqual({ Authorization: `Bearer ${TOKEN_A1}`, "x-api-key": CLIENT_A, Accept: "application/json" });
    expect(virtual.waits).toEqual([10_000, 10_000]);

    expect(result.accounting).toMatchObject({
      state: "complete", modality: "video", tokens: {}, nativeUnits: { videos: 1 },
      cost: null, costStatus: "unknown", costSource: "unavailable", meta: { nativeUnitsSource: "returned-videos" },
    });
    expect(result.acceptedJob).toBeUndefined();
    expect(credentials).toEqual(s2s());
  });

  it("uses a pasted access token without contacting IMS", async () => {
    const credentials = pasted();
    serve(accepted(), succeeded());
    const result = await run({ credentials });
    expect(result.success).toBe(true);
    expect(mints()).toHaveLength(0);
    expect(submits().map(authOf)).toEqual([`Bearer ${PASTED}`]);
    expect(credentials).toEqual(pasted());
  });

  it("reuses the cached token for the next video on the same account", async () => {
    serve(ims(TOKEN_A1), accepted(), succeeded(), accepted(), succeeded());
    expect((await run()).success).toBe(true);
    expect((await run()).success).toBe(true);
    expect(mints()).toHaveLength(1);
    expect(submits().map(authOf)).toEqual([`Bearer ${TOKEN_A1}`, `Bearer ${TOKEN_A1}`]);
  });

  it("keeps concurrent accounts apart: each submit, poll and accounting uses only its selected account", async () => {
    route(async (url, init) => {
      if (url === ADOBE_IMS_TOKEN_URL) {
        return ims(new URLSearchParams(init.body).get("client_id") === CLIENT_A ? TOKEN_A1 : TOKEN_B1);
      }
      const isA = init.headers.Authorization === `Bearer ${TOKEN_A1}`;
      expect(init.headers["x-api-key"]).toBe(isA ? CLIENT_A : CLIENT_B);
      if (url === ADOBE_FIREFLY_VIDEO_GENERATE_URL) return accepted(isA ? JOB : JOB_B);
      if (url === `${API}/v3/status/${isA ? JOB : JOB_B}`) return succeeded([isA ? VIDEO_1 : VIDEO_2], isA ? JOB : JOB_B);
      return null;
    });
    const [a, b] = await Promise.all([run({ credentials: s2s() }), run({ credentials: s2s(CLIENT_B, SECRET_B) })]);
    expect((await a.response.json()).data).toEqual([{ url: VIDEO_1 }]);
    expect((await b.response.json()).data).toEqual([{ url: VIDEO_2 }]);
    expect(a.accounting).not.toBe(b.accounting);
    expect(a.accounting).toMatchObject({ nativeUnits: { videos: 1 }, cost: null, costStatus: "unknown" });
    expect(b.accounting).toMatchObject({ nativeUnits: { videos: 1 }, cost: null, costStatus: "unknown" });
    expect(calls.every((call) => !call.url.includes("attacker.example"))).toBe(true);
    expect(cache.size).toBe(2);
  });
});

describe("adobe-firefly-api video credentials", () => {
  it.each([
    ["no client ID", { apiKey: SECRET_A }],
    ["a web-app client ID", { apiKey: SECRET_A, providerSpecificData: { clientId: "clio-playground-web" } }],
    ["no secret or token", { providerSpecificData: { clientId: CLIENT_A } }],
    ["a cookie only", { cookie: "session=abc", providerSpecificData: { clientId: CLIENT_A } }],
  ])("refuses %s with a 401 before any request", async (_label, credentials) => {
    serve();
    const result = await run({ credentials });
    await expectCleanError(result, 401);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("reports an IMS refusal as 401 without submitting", async () => {
    serve(json({ error: "invalid_client", error_description: `bad ${SECRET_A}` }, 401));
    const result = await run();
    await expectCleanError(result, 401);
    expect(result.error).toMatch(/invalid_client/);
    expect(submits()).toHaveLength(0);
  });
});

describe("adobe-firefly-api video submit refusals", () => {
  it("on a 401, drops the token, mints once and resends only the refused submit", async () => {
    const credentials = s2s();
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), accepted(), succeeded());
    const result = await run({ credentials });
    expect(result.success).toBe(true);
    expect(submits().map(authOf)).toEqual([`Bearer ${TOKEN_A1}`, `Bearer ${TOKEN_A2}`]);
    expect(submits().map((call) => call.init.redirect)).toEqual(["manual", "manual"]);
    expect(mints()).toHaveLength(2);
    expect(credentials).toEqual(s2s());
  });

  it("is terminal after one fresh token: a second 401 stands, the token is dropped and nothing is accepted", async () => {
    serve(ims(TOKEN_A1), json({ message: `bad ${TOKEN_A1}` }, 401), ims(TOKEN_A2), json({ message: `bad ${TOKEN_A2}` }, 401));
    const result = await run();
    await expectCleanError(result, 401);
    expect(result.acceptedJob).toBeUndefined();
    expect(submits()).toHaveLength(2);
    expect(cache.size).toBe(0);
  });

  it("does not resend when a pasted token is refused", async () => {
    serve(json({ message: `bad ${PASTED}` }, 401));
    const result = await run({ credentials: pasted() });
    await expectCleanError(result, 401);
    expect(calls).toHaveLength(1);
  });

  it("passes a 403 entitlement refusal with only its documented access-error code, keeping the token", async () => {
    serve(ims(TOKEN_A1), json({ message: `not entitled ${TOKEN_A1}` }, 403, { "x-access-error": "user_non_entitled" }));
    const result = await run();
    await expectCleanError(result, 403);
    expect(result.error).toMatch(/\(user_non_entitled\)/);
    expect(result.acceptedJob).toBeUndefined();
    expect(mints()).toHaveLength(1);
    expect(submits()).toHaveLength(1);
    expect(cache.size).toBe(1);
  });

  it("drops an undocumented access-error value", async () => {
    serve(ims(TOKEN_A1), json({}, 403, { "x-access-error": "<script>" }));
    const result = await run();
    expect(result.error).not.toMatch(/script/);
  });

  it("carries a 429 Retry-After to the account cooldown without resubmitting", async () => {
    serve(ims(TOKEN_A1), json({ message: "slow down" }, 429, { "retry-after": "30", "x-access-rate-limit-level": "org" }));
    const before = Date.now();
    const result = await run();
    await expectCleanError(result, 429);
    expect(result.resetsAtMs).toBeGreaterThanOrEqual(before + 29_000);
    expect(result.rateLimitEvidence).toMatchObject({ source: "retry_after" });
    expect(result.response.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(result.acceptedJob).toBeUndefined();
    expect(submits()).toHaveLength(1);
  });

  it.each([[400, 400], [415, 415], [422, 400], [408, 504], [500, 502]])("maps a submit %i to %i without upstream text", async (upstream, status) => {
    serve(ims(TOKEN_A1), json({ message: `detail ${SECRET_A}` }, upstream));
    const result = await run();
    await expectCleanError(result, status);
    expect(result.error).not.toMatch(/detail/);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("refuses a submit redirect without following it or forwarding the token", async () => {
    serve(ims(TOKEN_A1), new Response(null, { status: 302, headers: { location: "https://attacker.example/steal" } }));
    const result = await run();
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.error).toMatch(/redirect refused/);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls.map((call) => call.url)).toEqual([ADOBE_IMS_TOKEN_URL, ADOBE_FIREFLY_VIDEO_GENERATE_URL]);
  });

  it("treats an answer that reports a followed redirect as a possibly billed job and drops the token", async () => {
    const answer = accepted();
    Object.defineProperty(answer, "redirected", { value: true });
    serve(ims(TOKEN_A1), answer);
    const result = await run();
    expectAccepted(result, "submit-unknown");
    expect(cache.size).toBe(0);
    expect(calls).toHaveLength(2);
  });
});

describe("adobe-firefly-api video submit transport", () => {
  it("never replays a submit whose transport failed after dispatch", async () => {
    serve(ims(TOKEN_A1), () => { throw transportError("ECONNRESET", `reset ${TOKEN_A1}`); });
    const result = await run();
    expectAccepted(result, "submit-unknown");
    await expectCleanError(result, 502);
    expect(submits()).toHaveLength(1);
  });

  it("reports a pre-connect failure as not accepted", async () => {
    serve(ims(TOKEN_A1), () => { throw transportError("ECONNREFUSED", "refused"); });
    const result = await run();
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("treats a transport failure on the 401 resend as unknown, never a third submit", async () => {
    serve(ims(TOKEN_A1), json({}, 401), ims(TOKEN_A2), () => { throw transportError("ECONNRESET", "reset"); });
    const result = await run();
    expectAccepted(result, "submit-unknown");
    expect(submits()).toHaveLength(2);
  });

  it("returns 499 with no request when the caller aborted first", async () => {
    serve();
    const controller = new AbortController();
    controller.abort();
    const result = await run({ signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("on a submit deadline, cancels the job a late answer accepted, on the fixed origin, and never polls it", async () => {
    useAdapter({ submitTimeoutMs: 20 });
    let resolveLate;
    const late = new Promise((resolve) => { resolveLate = resolve; });
    serve(ims(TOKEN_A1), () => late, json({}, 200));
    const result = await run();
    expectAccepted(result, "submit-unknown");
    await expectCleanError(result, 504);
    resolveLate(accepted());
    await vi.waitFor(() => expect(cancels()).toHaveLength(1));
    expect(cancels()[0]).toMatchObject({ url: CANCEL_URL, init: { method: "PUT", redirect: "error" } });
    expect(cancels()[0].init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN_A1}`, "x-api-key": CLIENT_A });
    expect(calls.some((call) => call.url === STATUS_URL)).toBe(false);
  });

  it("on a caller abort mid-submit, cleans up a late refusal without a cancel", async () => {
    const controller = new AbortController();
    let resolveLate;
    serve(ims(TOKEN_A1), () => new Promise((resolve) => { resolveLate = resolve; }));
    const pending = run({ signal: controller.signal });
    await vi.waitFor(() => expect(submits()).toHaveLength(1));
    controller.abort();
    const result = await pending;
    expectAccepted(result, "submit-unknown");
    expect(result.status).toBe(499);
    const refused = json({}, 429);
    const cancelBody = vi.spyOn(refused.body, "cancel");
    resolveLate(refused);
    await vi.waitFor(() => expect(cancelBody).toHaveBeenCalled());
    expect(cancels()).toHaveLength(0);
  });
});

describe("adobe-firefly-api video job outcomes", () => {
  it("reports a documented job failure code as an ordinary failure, without upstream text", async () => {
    serve(ims(TOKEN_A1), accepted(), failedJob("validation_error"));
    const result = await run();
    await expectCleanError(result, 422);
    expect(result.error).toMatch(/video job failed: validation_error/);
    expect(result.error).not.toMatch(/upstream says/);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("does not repeat an undocumented failure code", async () => {
    serve(ims(TOKEN_A1), accepted(), failedJob("<weird>"));
    const result = await run();
    expect(result).toMatchObject({ status: 502 });
    expect(result.error).toMatch(/unknown reason/);
  });

  it.each([
    ["cancelled", 502], ["timeout", 504],
  ])("reports a %s job as a failure", async (status, code) => {
    serve(ims(TOKEN_A1), accepted(), json({ status, jobId: JOB }));
    const result = await run();
    expect(result).toMatchObject({ success: false, status: code });
    expect(result.acceptedJob).toBeUndefined();
  });

  it.each([
    ["an unreadable submit answer", [new Response("not json", { status: 202 })]],
    ["a submit answer without a job id", [json({ statusUrl: "x" }, 202)]],
    ["a job id with a path", [accepted("../../v3/images/x")]],
    ["a success with no outputs", [accepted(), json({ status: "succeeded", jobId: JOB, result: { outputs: [] } })]],
    ["a success with an image output", [accepted(), json({ status: "succeeded", jobId: JOB, result: { outputs: [{ seed: 1, image: { url: VIDEO_1 } }] } })]],
    ["a success with two videos", [accepted(), succeeded([VIDEO_1, VIDEO_2])]],
    ["a success with an http URL", [accepted(), succeeded(["http://pre-signed.example/v.mp4"])]],
    ["a success with userinfo", [accepted(), succeeded(["https://user:pw@pre-signed.example/v.mp4"])]],
    ["an answer about another job", [accepted(), running(JOB_B)]],
    ["an unknown status", [accepted(), json({ status: "exploded", jobId: JOB })]],
    ["an unreadable status", [accepted(), new Response("{", { status: 200 })]],
    ["a poll 500", [accepted(), json({}, 500)]],
  ])("keeps the accepted job on %s, with no resubmit", async (_label, steps) => {
    serve(ims(TOKEN_A1), ...steps);
    const result = await run();
    expectAccepted(result);
    expectNoSecrets(result.error);
    expect(submits()).toHaveLength(1);
    expect(calls.every((call) => call.url.startsWith(API) || call.url === ADOBE_IMS_TOKEN_URL)).toBe(true);
  });

  it("waits out a poll 429 using its Retry-After, then finishes", async () => {
    serve(ims(TOKEN_A1), accepted(), json({}, 429, { "retry-after": "45" }), succeeded());
    const result = await run();
    expect(result.success).toBe(true);
    expect(virtual.waits).toEqual([10_000, 45_000]);
  });

  it("caps a long poll Retry-After at the gateway bound", async () => {
    serve(ims(TOKEN_A1), accepted(), json({}, 503, { "retry-after": "3600" }), succeeded());
    const result = await run();
    expect(result.success).toBe(true);
    expect(virtual.waits).toEqual([10_000, 60_000]);
  });

  it("gives up after repeated poll 429s as an unknown outcome and cancels", async () => {
    serve(ims(TOKEN_A1), accepted(), ...Array.from({ length: 6 }, () => json({}, 429)), json({}, 200));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(429);
    expect(submits()).toHaveLength(1);
  });

  it("re-mints once on a poll 401 and keeps polling the same job", async () => {
    serve(ims(TOKEN_A1), accepted(), json({}, 401), ims(TOKEN_A2), succeeded());
    const result = await run();
    expect(result.success).toBe(true);
    const polls = calls.filter((call) => call.url === STATUS_URL);
    expect(polls.map(authOf)).toEqual([`Bearer ${TOKEN_A1}`, `Bearer ${TOKEN_A2}`]);
    expect(submits()).toHaveLength(1);
  });

  it("passes a poll 403 as an unknown outcome", async () => {
    serve(ims(TOKEN_A1), accepted(), json({}, 403));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(403);
  });

  it("on a caller abort while polling, cancels the job on the fixed origin and keeps it accepted", async () => {
    const controller = new AbortController();
    serve(ims(TOKEN_A1), accepted(), () => { controller.abort(); return running(); }, json({}, 200));
    const result = await run({ signal: controller.signal });
    expectAccepted(result);
    expect(result.status).toBe(499);
    expect(cancels()).toHaveLength(1);
    expect(cancels()[0]).toMatchObject({ url: CANCEL_URL, init: { method: "PUT", redirect: "error" } });
    expect(calls.some((call) => call.url.includes("attacker.example"))).toBe(false);
  });

  it("at the poll deadline, cancels the job and reports a 504 unknown outcome", async () => {
    useAdapter({ timeoutMs: 25_000 });
    serve(ims(TOKEN_A1), accepted(), running(), running(), json({}, 200));
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(504);
    expect(result.error).toMatch(/did not finish in time/);
    expect(cancels()).toHaveLength(1);
    expect(virtual.waits).toEqual([10_000, 10_000]);
  });

  it("keeps the job accepted when the cancel itself fails", async () => {
    useAdapter({ timeoutMs: 15_000 });
    serve(ims(TOKEN_A1), accepted(), running(), () => { throw transportError("ECONNRESET", "reset"); });
    const result = await run();
    expectAccepted(result);
    expect(result.status).toBe(504);
  });
});
