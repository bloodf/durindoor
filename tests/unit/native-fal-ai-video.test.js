// fal.ai queue video generation, staged and unregistered. Closed mocks only:
// every request is answered below, an unexpected request fails the test, and
// every credential is synthetic. Passing here says nothing about the live
// service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import defaultAdapter, {
  createFalVideoAdapter,
  FAL_VIDEO_RESPONSE_FORMATS,
} from "../../open-sse/services/providerParity/native-fal-ai-video/adapter.js";
import {
  FAL_VIDEO_MODEL_IDS,
  FAL_VIDEO_PROVIDER_ALIASES,
  FAL_VIDEO_PROVIDER_ID,
  FAL_VIDEO_PROVIDER_METADATA,
  falVideoEndpoint,
} from "../../open-sse/services/providerParity/native-fal-ai-video/config.js";
import { buildFalVideoRequest } from "../../open-sse/services/providerParity/native-fal-ai-video/request.js";
import { falVideoCompatibilityInput } from "../../open-sse/services/providerParity/native-fal-ai-video/schema.js";
import {
  falVideoArtifact,
  falVideoResultUrl,
  falVideoTrackingUrl,
} from "../../open-sse/services/providerParity/native-fal-ai-video/job.js";
import * as bundle from "../../open-sse/services/providerParity/native-fal-ai-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import falRegistry from "../../open-sse/providers/registry/fal-ai.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const VEO = "veo3.1/lite";
const PROMPT = "a paper lantern drifting over a still mountain lake";
const KEY_A = "SYNTHETIC-fal-key-a:0001aaaa";
const KEY_B = "SYNTHETIC-fal-key-b:0002bbbb";
const REQ = "4b0e1a5c-77d2-4f3c-9a51-0c2d6e8f1a2b";
const QUEUE = "https://queue.fal.run";
const SUBMIT_VEO = `${QUEUE}/fal-ai/veo3.1/lite`;
const STATUS = `${QUEUE}/fal-ai/veo3.1/requests/${REQ}/status`;
const RESULT = `${QUEUE}/fal-ai/veo3.1/requests/${REQ}`;
const VIDEO_URL = "https://v3.fal.media/files/synthetic/out.mp4";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const queued = (extra = {}) => json({ request_id: REQ, status_url: STATUS, response_url: RESULT, ...extra });
const inQueue = () => json({ status: "IN_QUEUE", queue_position: 0 }, 202);
const inProgress = () => json({ status: "IN_PROGRESS" }, 202);
const completed = () => json({ status: "COMPLETED" });
const videoResult = (video = { url: VIDEO_URL, content_type: "video/mp4", file_name: "out.mp4" }) => json({ video, seed: 7 });
const echo = (status) => json({ detail: `upstream echo ${KEY_A} ${PROMPT}` }, status);
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
  timeoutMs: 10_000,
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const adapter = (options = {}) => createFalVideoAdapter({ ...polling(), ...options });
const generate = (body = {}, { model = VEO, credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  adapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payloadOf = async (result) => result.response.clone().json();
const assertNoSecrets = async (result) => {
  const text = await result.response.clone().text();
  for (const secret of [KEY_A, KEY_B, PROMPT, "upstream echo"]) expect(text).not.toContain(secret);
  expect(result.error ?? "").not.toContain(KEY_A);
};

// A discovered OpenAPI definition shaped like fal's /v1/models?expand=openapi-3.0 page.
const KLING = "fal-ai/kling-video/v2.1/pro/text-to-video";
const definition = ({ endpoint = KLING, category = "text-to-video", properties, required = ["prompt"], additional } = {}) => ({
  endpoint_id: endpoint,
  metadata: { category, display_name: "Synthetic" },
  openapi: {
    openapi: "3.0.4",
    paths: {
      [`/${endpoint}`]: { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Input" } } } } } },
      [`/${endpoint}/requests/{request_id}/status`]: { get: {} },
      [`/${endpoint}/requests/{request_id}`]: { get: {} },
    },
    components: {
      schemas: {
        Input: {
          type: "object",
          required,
          ...(additional === undefined ? {} : { additionalProperties: additional }),
          properties: properties ?? {
            prompt: { type: "string", maxLength: 2500 },
            duration: { type: "string", enum: ["5", "10"] },
            aspect_ratio: { $ref: "#/components/schemas/Ratio" },
            negative_prompt: { type: "string" },
            cfg_scale: { type: "number", minimum: 0, maximum: 1 },
            image_url: { type: "string" },
          },
        },
        Ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
      },
    },
  },
});
const catalog = (def = definition()) => json({ models: [def], has_more: false, next_cursor: null });
const DISCOVER = (endpoint = KLING) => `https://api.fal.ai/v1/models?endpoint_id=${encodeURIComponent(endpoint)}&expand=openapi-3.0`;

beforeEach(() => {
  calls = [];
  clock = 1_000_000;
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Isolated staging block: the only assertions that depend on the adapter being
// unregistered. The registration change replaces these with positive registry
// identity checks; every other block holds staged and registered alike.
describe("staging state (pre-registration only)", () => {
  it("is not registered: the public dispatch still has no fal video adapter", () => {
    expect(getVideoGenerationAdapter("fal-ai")).toBeNull();
    expect(getVideoGenerationAdapter("fal")).toBeNull();
    expect(falRegistry.serviceKinds).not.toContain("video");
  });
});

describe("metadata", () => {
  it("reuses the existing fal-ai provider id and alias and the three source models", () => {
    expect(FAL_VIDEO_PROVIDER_ID).toBe(falRegistry.id);
    expect(FAL_VIDEO_PROVIDER_ALIASES).toEqual(falRegistry.aliases);
    expect(FAL_VIDEO_MODEL_IDS).toEqual(["veo3.1/lite", "google/gemini-omni-flash", "xai/grok-imagine-video/text-to-video"]);
    expect(FAL_VIDEO_PROVIDER_METADATA).toMatchObject({ format: "fal-ai-video", serviceKinds: ["video"], responseFormats: ["url"] });
    expect(falRegistry.imageConfig.baseUrl).toBe("https://queue.fal.run");
  });

  it("registration.json describes the exports, ids, models and integration points", () => {
    const registration = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-fal-ai-video/registration.json", import.meta.url), "utf8"));
    expect(registration.status).toBe("staged-unregistered");
    expect(registration.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(registration.source.registryEntry).toEqual({
      id: "fal-ai", baseUrl: "https://queue.fal.run", authType: "apikey", authHeader: "key", format: "fal-ai-video",
    });
    expect(registration.provider).toMatchObject({ canonicalId: "fal-ai", aliases: ["fal"], serviceKindsToAdd: ["video"] });
    expect(registration.models.map((model) => model.id)).toEqual(FAL_VIDEO_MODEL_IDS);
    expect(registration.publicHandlerIntegration.map((entry) => entry.file)).toContain("open-sse/handlers/videoProviders/index.js");
    for (const name of ["createFalVideoAdapter", "falVideoAdapter", "runFalVideoJob", "FAL_VIDEO_PROVIDER_METADATA", "discoverFalVideoDefinition"]) {
      expect(bundle[name]).toBeDefined();
    }
  });

  it("the adapter offers url output only, for the core's pre-submit format check", () => {
    expect(defaultAdapter.async).toBe(true);
    expect(defaultAdapter.responseFormats).toEqual(["url"]);
    expect(FAL_VIDEO_RESPONSE_FORMATS).toEqual(["url"]);
    expect(defaultAdapter.defaultResponseFormat).toBe("url");
  });
});

describe("request contract", () => {
  it("Veo 3.1 Lite: the source defaults and the fal-ai owner", () => {
    expect(buildFalVideoRequest(VEO, { prompt: ` ${PROMPT} ` })).toEqual({
      endpoint: "fal-ai/veo3.1/lite",
      request: { prompt: PROMPT, aspect_ratio: "16:9", duration: "8s", resolution: "720p", generate_audio: true },
    });
    expect(buildFalVideoRequest("fal-ai/veo3.1/lite", {
      prompt: PROMPT, size: "720x1280", duration: 4, quality: "hd", generate_audio: false, negative_prompt: "blur", seed: 3, auto_fix: true, safety_tolerance: "4",
    })).toEqual({
      endpoint: "fal-ai/veo3.1/lite",
      request: { prompt: PROMPT, aspect_ratio: "9:16", duration: "4s", resolution: "1080p", generate_audio: false, negative_prompt: "blur", safety_tolerance: "4", seed: 3, auto_fix: true },
    });
  });

  it("Gemini Omni Flash picks image-to-video when an image is given", () => {
    expect(buildFalVideoRequest("google/gemini-omni-flash", { prompt: PROMPT, duration: "5s" })).toEqual({
      endpoint: "google/gemini-omni-flash", request: { prompt: PROMPT, aspect_ratio: "16:9", duration: 5 },
    });
    expect(buildFalVideoRequest("google/gemini-omni-flash", { prompt: PROMPT, image_urls: ["https://example.com/a.png"] })).toEqual({
      endpoint: "google/gemini-omni-flash/image-to-video",
      request: { prompt: PROMPT, aspect_ratio: "16:9", duration: 8, image_url: "https://example.com/a.png" },
    });
  });

  it("Grok Imagine follows the images actually sent", () => {
    const one = buildFalVideoRequest("xai/grok-imagine-video/text-to-video", { prompt: PROMPT, image_urls: ["https://example.com/a.png"] });
    expect(one).toEqual({
      endpoint: "xai/grok-imagine-video/image-to-video",
      request: { prompt: PROMPT, aspect_ratio: "16:9", duration: 6, resolution: "720p", image_url: "https://example.com/a.png" },
    });
    const many = buildFalVideoRequest("xai/grok-imagine-video/text-to-video", {
      prompt: PROMPT, duration: "10s", image_urls: ["https://example.com/a.png", "https://example.com/b.png"],
    });
    expect(many.endpoint).toBe("xai/grok-imagine-video/reference-to-video");
    expect(many.request).toMatchObject({ duration: 10, reference_image_urls: ["https://example.com/a.png", "https://example.com/b.png"] });
    expect(many.request.image_url).toBeUndefined();
  });

  it.each([
    ["n above 1", VEO, { n: 2 }],
    ["stream", VEO, { stream: true }],
    ["an image upload field", VEO, { image: "aGVsbG8=" }],
    ["an image for Veo Lite", VEO, { image_url: "https://example.com/a.png" }],
    ["a Veo duration out of range", VEO, { duration: 5 }],
    ["a Veo aspect ratio fal does not take", VEO, { aspect_ratio: "1:1" }],
    ["a Veo resolution fal does not take", VEO, { resolution: "4k" }],
    ["size and aspect_ratio that disagree", VEO, { size: "1280x720", aspect_ratio: "9:16" }],
    ["a Gemini duration above 10 s", "google/gemini-omni-flash", { duration: 12 }],
    ["two Gemini images", "google/gemini-omni-flash", { image_urls: ["https://example.com/a.png", "https://example.com/b.png"] }],
    ["a private image host", "google/gemini-omni-flash", { image_url: "https://169.254.169.254/latest" }],
    ["an http image URL", "google/gemini-omni-flash", { image_url: "http://example.com/a.png" }],
    ["a credentialed image URL", "google/gemini-omni-flash", { image_url: "https://user:pw@example.com/a.png" }],
    ["image-to-video without an image", "xai/grok-imagine-video/image-to-video", {}],
    ["a fractional Grok duration", "xai/grok-imagine-video/text-to-video", { duration: 2.5 }],
  ])("refuses %s before anything is sent", async (_label, model, body) => {
    const result = await generate(body, { model });
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("accepts a bounded base64 image data URI and refuses an oversized one", () => {
    const small = `data:image/png;base64,${"A".repeat(64)}`;
    expect(buildFalVideoRequest("google/gemini-omni-flash", { prompt: PROMPT, image_url: small }).request.image_url).toBe(small);
    const big = `data:image/png;base64,${"A".repeat(14 * 1024 * 1024)}`;
    expect(() => buildFalVideoRequest("google/gemini-omni-flash", { prompt: PROMPT, image_url: big })).toThrow(/larger than/);
  });

  it("maps model ids to fal endpoints like the source's falSelectionEndpoint", () => {
    expect(falVideoEndpoint("veo3.1/lite")).toBe("fal-ai/veo3.1/lite");
    expect(falVideoEndpoint("kling-video/v2.1/pro/text-to-video")).toBe(KLING);
    expect(falVideoEndpoint("bytedance/seedance-2.5/text-to-video")).toBe("bytedance/seedance-2.5/text-to-video");
    expect(() => falVideoEndpoint("fal-ai/../admin")).toThrow();
    expect(() => falVideoEndpoint("https://evil.example/x")).toThrow();
  });
});

describe("wire contract and success", () => {
  it("submits, polls and returns the video URL with the source's auth, headers and body", async () => {
    serve(queued(), inQueue(), inProgress(), completed(), videoResult());
    const result = await generate();
    expect(result.success).toBe(true);
    expect(await payloadOf(result)).toEqual({ created: expect.any(Number), data: [{ url: VIDEO_URL, format: "mp4" }] });
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      `POST ${SUBMIT_VEO}`, `GET ${STATUS}`, `GET ${STATUS}`, `GET ${STATUS}`, `GET ${RESULT}`,
    ]);
    const submit = calls[0];
    expect(submit.init.headers).toEqual({ Authorization: `Key ${KEY_A}`, "Content-Type": "application/json", "X-Fal-No-Retry": "1" });
    expect(submit.init.redirect).toBe("manual");
    expect(submit.body).toEqual({ prompt: PROMPT, aspect_ratio: "16:9", duration: "8s", resolution: "720p", generate_audio: true });
    for (const poll of calls.slice(1)) {
      expect(poll.init.headers).toEqual({ Authorization: `Key ${KEY_A}` });
      expect(poll.init.redirect).toBe("error");
      expect(poll.init.body).toBeUndefined();
    }
    expect(result.accounting).toMatchObject({
      modality: "video", nativeUnits: { videos: 1 }, cost: null, costStatus: "unknown",
      meta: { nativeUnitsSource: "returned-videos", endpoint: "fal-ai/veo3.1/lite" },
    });
    expect(clock - 1_000_000).toBe(3_000);
  });

  it("falls back to the source's tracking paths when fal omits them", async () => {
    serve(json({ request_id: REQ }), completed(), videoResult({ url: VIDEO_URL }));
    const result = await generate();
    expect(result.success).toBe(true);
    expect(calls[1].url).toBe(`${SUBMIT_VEO}/requests/${REQ}/status`);
    expect(calls[2].url).toBe(`${SUBMIT_VEO}/requests/${REQ}`);
    expect(await payloadOf(result)).toMatchObject({ data: [{ url: VIDEO_URL, format: "mp4" }] });
  });

  it("accepts a submit that already carries the video (runFalQueue's direct result)", async () => {
    serve(videoResult({ url: "https://v3.fal.media/files/x/clip.webm" }));
    const result = await generate();
    expect(result.success).toBe(true);
    expect((await payloadOf(result)).data).toEqual([{ url: "https://v3.fal.media/files/x/clip.webm", format: "webm" }]);
    expect(calls).toHaveLength(1);
  });

  it("returns only the validated URL, never the raw fal result", async () => {
    serve(queued(), completed(), json({ video: { url: VIDEO_URL, content_type: "video/mp4" }, timings: { secret: KEY_A }, extra: "https://other.example/x" }));
    const result = await generate();
    expect(JSON.stringify(await payloadOf(result))).not.toContain("other.example");
    expect(JSON.stringify(await payloadOf(result))).not.toContain(KEY_A);
  });

  it("uses each connection's own key with nothing shared between calls", async () => {
    serve(queued(), completed(), videoResult(), queued(), completed(), videoResult());
    const [a, b] = [await generate({}, { credentials: { apiKey: KEY_A } }), await generate({}, { credentials: { accessToken: KEY_B } })];
    expect(a.success && b.success).toBe(true);
    expect(calls.slice(0, 3).every((call) => call.init.headers.Authorization === `Key ${KEY_A}`)).toBe(true);
    expect(calls.slice(3).every((call) => call.init.headers.Authorization === `Key ${KEY_B}`)).toBe(true);
  });

  it("refuses locally without a key: nothing unauthenticated is sent", async () => {
    const result = await generate({}, { credentials: { apiKey: "  " } });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("submit failures", () => {
  it("a spent balance is a 402 quota exhaustion on this connection", async () => {
    serve(json({ detail: `User is locked. Reason: Exhausted balance. ${KEY_A}` }, 403));
    const result = await generate();
    expect(result.status).toBe(402);
    expect(result.quotaExhausted).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoSecrets(result);
  });

  it.each([
    [401, 401],
    [403, 401],
    [404, 404],
    [422, 400],
  ])("a %i is refused as %i without acceptedJob or upstream text", async (upstream, expected) => {
    serve(echo(upstream));
    const result = await generate();
    expect(result.status).toBe(expected);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
    await assertNoSecrets(result);
  });

  it("a 429 keeps a usable Retry-After", async () => {
    serve(json({ detail: "slow down" }, 429, { "retry-after": "30" }));
    const result = await generate();
    expect(result.status).toBe(429);
    expect(result.rateLimitEvidence?.source).toBe("retry_after");
    expect(result.response.headers.get("retry-after")).toBeTruthy();
  });

  it("a 5xx is an unknown submit, recorded and never resent", async () => {
    serve(echo(502));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", cost: null, meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
    await assertNoSecrets(result);
  });

  it("a submit timeout is unknown and never resent", async () => {
    serve(() => new Promise(() => {}));
    const result = await generate({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("a connection that never opened sent nothing", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoSecrets(result);
  });

  it("a reset after the request left is unknown", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const result = await generate();
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect without following it with the key", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } }));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("discards a submit answered by another origin and records it as unknown", async () => {
    const moved = queued();
    Object.defineProperty(moved, "url", { value: "https://evil.example/fal-ai/veo3.1/lite" });
    serve(moved);
    const result = await generate();
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });
});

describe("queued request outcomes", () => {
  it.each([
    ["an unusable request id", () => json({ request_id: "../x" })],
    ["a status URL off the fal queue", () => json({ request_id: REQ, status_url: `https://evil.example/requests/${REQ}/status` })],
    ["a response URL for another request", () => json({ request_id: REQ, status_url: STATUS, response_url: `${QUEUE}/fal-ai/veo3.1/requests/other` })],
    ["an unreadable submit body", () => new Response("<html>", { status: 200 })],
  ])("%s is an accepted job that is never polled elsewhere", async (_label, step) => {
    serve(step());
    const result = await generate();
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(1);
    await assertNoSecrets(result);
  });

  it.each([
    ["an unknown status", [json({ status: "FAILED", error: KEY_A })]],
    ["a failing result read", [completed(), echo(500)]],
    ["a result without a video", [completed(), json({ images: [{ url: VIDEO_URL }] })]],
    ["a result URL on a private host", [completed(), videoResult({ url: "https://10.0.0.5/out.mp4" })]],
    ["a result URL over http", [completed(), videoResult({ url: "http://v3.fal.media/out.mp4" })]],
    ["a result that is not a video", [completed(), videoResult({ url: VIDEO_URL, content_type: "image/png" })]],
    ["an unreadable status body", [new Response("not json", { status: 200 })]],
  ])("%s is reported with acceptedJob and no upstream text", async (_label, steps) => {
    serve(queued(), ...steps);
    const result = await generate();
    expect(result.success).toBe(false);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "accepted" } });
    await assertNoSecrets(result);
  });

  it("retries a 503 status check with backoff, then succeeds", async () => {
    serve(queued(), json({}, 503, { "retry-after": "3" }), completed(), videoResult());
    const result = await generate();
    expect(result.success).toBe(true);
    expect(clock - 1_000_000).toBe(1_000 + 3_000);
  });

  it("a status check refused with 401 passes the status on, with acceptedJob", async () => {
    serve(queued(), echo(401));
    const result = await generate();
    expect(result.status).toBe(401);
    expect(result.acceptedJob).toBeDefined();
  });

  it("stops at the job deadline with acceptedJob", async () => {
    serve(queued(), ...Array.from({ length: 20 }, () => inProgress()));
    const result = await generate({}, { options: { timeoutMs: 3_500 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(4);
  });
});

describe("cancellation", () => {
  it("abort before submit sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(calls).toHaveLength(0);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("abort during submit ends the wait and records an unknown submit", async () => {
    const controller = new AbortController();
    let seen;
    serve((_url, init) => {
      seen = init.signal;
      controller.abort();
      return new Promise(() => {});
    });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(seen.aborted).toBe(true);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });

  it("abort during a status check aborts that request and records the accepted job", async () => {
    const controller = new AbortController();
    serve(queued(), (_url, init) => {
      controller.abort();
      expect(init.signal.aborted).toBe(true);
      return inProgress();
    });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("abort while waiting between polls stops before the next request", async () => {
    const controller = new AbortController();
    serve(queued());
    const result = await generate({}, {
      signal: controller.signal,
      options: { wait: async () => { controller.abort(); throw controller.signal.reason; } },
    });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeDefined();
    expect(calls).toHaveLength(1);
  });
});

describe("schema discovery for other fal video endpoints", () => {
  const KLING_MODEL = "kling-video/v2.1/pro/text-to-video";
  const KLING_STATUS = `${QUEUE}/fal-ai/kling-video/requests/${REQ}/status`;
  const KLING_RESULT = `${QUEUE}/fal-ai/kling-video/requests/${REQ}`;
  const klingQueued = () => json({ request_id: REQ, status_url: KLING_STATUS, response_url: KLING_RESULT });

  it("discovers the schema with the connection's key, maps the body and submits once", async () => {
    serve(catalog(), klingQueued(), completed(), videoResult());
    const result = await generate({ duration: "5", size: "1280x720", quality: "hd", fal_input: { cfg_scale: 0.5 } }, { model: KLING_MODEL });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(DISCOVER());
    expect(calls[0].init).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: `Key ${KEY_A}` } });
    expect(calls[1].url).toBe(`${QUEUE}/${KLING}`);
    expect(calls[1].body).toEqual({ prompt: PROMPT, duration: "5", aspect_ratio: "16:9", cfg_scale: 0.5 });
  });

  it.each([
    ["an undocumented field", { motion: "fast" }, /Unsupported fal input: motion/],
    ["a value outside the enum", { duration: "7" }, /duration must be one of/],
    ["a referenced enum", { aspect_ratio: "4:3" }, /aspect_ratio must be one of/],
    ["a numeric bound", { fal_input: { cfg_scale: 2 } }, /cfg_scale must be at most 1/],
    ["a mistyped field", { negative_prompt: 5 }, /negative_prompt must be string/],
    ["a private image URL", { image_url: "https://127.0.0.1/x.png" }, /public host/],
    ["a size without an aspect_ratio target", { size: "1280x720" }, /does not support size/],
  ])("refuses %s after discovery and before any submit", async (_label, body, message) => {
    const def = _label.startsWith("a size")
      ? definition({ properties: { prompt: { type: "string" } } })
      : definition();
    serve(catalog(def));
    const result = await generate(body, { model: KLING_MODEL });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(1);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("refuses an endpoint whose category is not video", async () => {
    serve(catalog(definition({ endpoint: "fal-ai/flux/dev", category: "text-to-image" })));
    const result = await generate({}, { model: "flux/dev" });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/does not generate video/);
    expect(calls).toHaveLength(1);
  });

  it("refuses an incomplete or unlisted catalog without submitting", async () => {
    serve(json({ models: [], has_more: true }));
    expect((await generate({}, { model: KLING_MODEL })).status).toBe(502);
    serve(json({ models: [], has_more: false }));
    expect((await generate({}, { model: KLING_MODEL })).status).toBe(404);
    expect(calls.every((call) => call.url.startsWith("https://api.fal.ai/"))).toBe(true);
  });

  it("a refused key at discovery is a 401 without upstream text", async () => {
    serve(echo(403));
    const result = await generate({}, { model: KLING_MODEL });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(1);
    await assertNoSecrets(result);
  });

  it("retries a 429 discovery read once within the bounded Retry-After", async () => {
    serve(json({}, 429, { "retry-after": "2" }), catalog(), klingQueued(), completed(), videoResult());
    const result = await generate({}, { model: KLING_MODEL });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(calls[1].url);
  });

  it("refuses a discovery Retry-After above 5 s instead of waiting", async () => {
    serve(json({}, 503, { "retry-after": "60" }));
    const result = await generate({}, { model: KLING_MODEL });
    expect(result.status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it("fal_input on a built-in model goes through discovery", async () => {
    const veoDef = definition({ endpoint: "fal-ai/veo3.1/lite", properties: { prompt: { type: "string" }, duration: { type: "string" } } });
    serve(catalog(veoDef), queued(), completed(), videoResult());
    const result = await generate({ fal_input: { duration: "6s" } });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(DISCOVER("fal-ai/veo3.1/lite"));
    expect(calls[1].body).toEqual({ prompt: PROMPT, duration: "6s" });
  });

  it("a definition store is read and written per connection only", async () => {
    const saved = new Map();
    const store = {
      get: (connectionId, endpoint) => saved.get(`${connectionId}|${endpoint}`) ?? null,
      save: (connectionId, def) => saved.set(`${connectionId}|${def.endpoint_id}`, def),
    };
    serve(catalog(), klingQueued(), completed(), videoResult(), klingQueued(), completed(), videoResult(), catalog(), klingQueued(), completed(), videoResult());
    const run = (apiKey, connectionId) => generate({}, { model: KLING_MODEL, credentials: { apiKey, connectionId }, options: { store } });
    expect((await run(KEY_A, "conn-a")).success).toBe(true);
    expect((await run(KEY_A, "conn-a")).success).toBe(true);
    expect((await run(KEY_B, "conn-b")).success).toBe(true);
    const discoveries = calls.filter((call) => call.url.startsWith("https://api.fal.ai/"));
    expect(discoveries.map((call) => call.init.headers.Authorization)).toEqual([`Key ${KEY_A}`, `Key ${KEY_B}`]);
    expect([...saved.keys()].sort()).toEqual([`conn-a|${KLING}`, `conn-b|${KLING}`]);
  });

  it("abort during discovery sends no submit", async () => {
    const controller = new AbortController();
    serve((_url, init) => {
      controller.abort();
      expect(init.signal.aborted).toBe(true);
      return catalog();
    });
    const result = await generate({}, { model: KLING_MODEL, signal: controller.signal });
    expect(result.status).toBe(499);
    expect(calls).toHaveLength(1);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("maps image_urls onto the endpoint's documented field", () => {
    const def = definition({ properties: { prompt: { type: "string" }, reference_image_urls: { type: "array", maxItems: 4 } } });
    expect(falVideoCompatibilityInput({ prompt: PROMPT, image_urls: ["https://example.com/a.png"] }, def)).toEqual({
      prompt: PROMPT, reference_image_urls: ["https://example.com/a.png"],
    });
  });
});

describe("helpers", () => {
  it("pins tracking URLs to the queue origin and this request", () => {
    expect(falVideoTrackingUrl(STATUS, REQ)).toBe(STATUS);
    expect(falVideoTrackingUrl(`/fal-ai/veo3.1/requests/${REQ}`, REQ)).toBe(RESULT);
    for (const bad of [`https://queue.fal.run.evil.example/requests/${REQ}`, `https://u:p@queue.fal.run/requests/${REQ}`, `${STATUS}#x`, `${QUEUE}/requests/other`]) {
      expect(() => falVideoTrackingUrl(bad, REQ)).toThrow();
    }
  });

  it("returns only public https result URLs", () => {
    expect(falVideoResultUrl(VIDEO_URL)).toBe(VIDEO_URL);
    for (const bad of ["http://v3.fal.media/x.mp4", "https://localhost/x.mp4", "https://192.168.1.2/x.mp4", "https://a:b@v3.fal.media/x.mp4", "data:video/mp4;base64,AAAA", 5]) {
      expect(falVideoResultUrl(bad)).toBeNull();
    }
  });

  it("derives the format from content_type or the URL, and omits an unknown one", () => {
    expect(falVideoArtifact({ video: { url: VIDEO_URL, content_type: "video/quicktime" } })).toEqual({ url: VIDEO_URL, format: "mov" });
    expect(falVideoArtifact({ video: { url: "https://v3.fal.media/files/x/out" } })).toEqual({ url: "https://v3.fal.media/files/x/out" });
  });
});
