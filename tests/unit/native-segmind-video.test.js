// Segmind native video adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (videoRegistry.ts `segmind`, segmind/videoModels.ts,
// videoGeneration/providers/segmind.ts, utils/segmindClient.ts). Passing here
// says nothing about the live service.
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-segmind-video/index.js";
import {
  SEGMIND_PROVIDER_DEFINITION,
  SEGMIND_SOURCE_VIDEO_MODELS,
  SEGMIND_VIDEO_MODELS,
  SEGMIND_VIDEO_REFUSED_FIELDS,
  buildSegmindVideoRequest,
  createSegmindVideoAdapter,
  segmindVideoAdapter,
} from "../../open-sse/services/providerParity/native-segmind-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://api.segmind.com";
const KEY_A = "sg-SYNTHETIC-key-a-0001";
const KEY_B = "sg-SYNTHETIC-key-b-0002";
const PROMPT = "a paper boat on a calm lake";
const BUNDLE = "../../open-sse/services/providerParity/native-segmind-video/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${BUNDLE}registration.json`, import.meta.url), "utf8"));

// The first 24 bytes of an ISO BMFF file: a `ftyp` box, then payload.
const mp4 = (tag = "a") => Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(12), Buffer.from(`video-${tag}`, "latin1"),
]);
const videoResponse = (bytes = mp4(), headers = { "content-type": "video/mp4" }) => new Response(bytes, { status: 200, headers });
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, message = "upstream echo", headers = {}) =>
  json({ error: `${message} ${KEY_A} ${PROMPT} at /srv/app.py:12` }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
const fromOrigin = (response, url) => Object.defineProperty(response, "url", { value: url });

const originalFetch = global.fetch;
let calls;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

const run = (body = {}, { model = "wan2.1-t2v", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createSegmindVideoAdapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  for (const secret of [KEY_A, KEY_B, "upstream echo", "/srv/app.py", PROMPT]) expect(text).not.toContain(secret);
};
const stalledBody = () => new ReadableStream({ start(controller) { controller.enqueue(mp4().subarray(0, 8)); } });

beforeEach(() => {
  calls = [];
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Staging-only negatives. Registration replaces this block with positive
// registry identity checks; every other block works staged or registered.
describe("staging state (isolated)", () => {
  it("stays unregistered: no adapter, no registry file", () => {
    expect(getVideoGenerationAdapter("segmind")).toBeNull();
    expect(existsSync(new URL("../../open-sse/providers/registry/segmind.js", import.meta.url))).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryEntry).toEqual({
      id: "segmind", baseUrl: "https://api.segmind.com/v1", authType: "apikey", authHeader: "x-api-key", format: "segmind",
    });
    expect(staged.SEGMIND_PROVIDER_ID).toBe("segmind");
    expect(staged.SEGMIND_PROVIDER_ALIASES).toEqual([]);
    expect(staged.SEGMIND_BASE_URL).toBe(REGISTRATION.source.registryEntry.baseUrl);
    expect(staged.SEGMIND_AUTH_HEADER).toBe("x-api-key");
    expect(staged.SEGMIND_VIDEO_FORMAT).toBe("segmind");
  });

  it("keeps the five source models and serves the four text-to-video ones", () => {
    expect(SEGMIND_SOURCE_VIDEO_MODELS.map((m) => [m.id, m.name])).toEqual([
      ["wan2.1-t2v", "Wan 2.1 Text-to-Video"],
      ["wan2.7-i2v", "Wan 2.7 Image-to-Video"],
      ["hunyuan-video-t2v", "Hunyuan Video Text-to-Video"],
      ["ltx-video-t2v", "LTX Video Text-to-Video"],
      ["kling-video-t2v", "Kling Video Text-to-Video"],
    ]);
    expect(SEGMIND_VIDEO_MODELS.map((m) => m.id)).toEqual(["wan2.1-t2v", "hunyuan-video-t2v", "ltx-video-t2v", "kling-video-t2v"]);
    expect(SEGMIND_VIDEO_MODELS.every((m) => m.kind === "video")).toBe(true);
    expect(REGISTRATION.models.filter((m) => m.status === "supported").map((m) => m.id)).toEqual(staged.SEGMIND_VIDEO_MODEL_IDS);
  });

  it("stages an API-key provider definition with the video kind only", () => {
    expect(SEGMIND_PROVIDER_DEFINITION).toMatchObject({
      id: "segmind", category: "apikey", authType: "apikey", serviceKinds: ["video"],
      display: { name: "Segmind", website: "https://segmind.com", textIcon: "SG" },
      transport: { baseUrl: "https://api.segmind.com/v1", authHeader: "x-api-key", auth: { header: "x-api-key", scheme: "raw" } },
    });
    expect(SEGMIND_PROVIDER_DEFINITION.oauth).toBeUndefined();
    expect(staged.SEGMIND_VIDEO_PROVIDER_METADATA.responseFormats).toEqual(["b64_json"]);
  });

  it("follows the job-adapter contract", () => {
    expect(segmindVideoAdapter.async).toBe(true);
    expect(segmindVideoAdapter.responseFormats).toEqual(["b64_json"]);
    expect(segmindVideoAdapter.defaultResponseFormat).toBe("b64_json");
    expect(isFunction(segmindVideoAdapter.generate)).toBe(true);
  });
});

describe("request contract", () => {
  it("sends the source body, x-api-key and JSON content type to the fixed model URL", async () => {
    serve(videoResponse());
    const result = await run({ negative_prompt: "blur", seed: 42, duration: "5", aspect_ratio: "16:9", n: 1, response_format: "b64_json", model: "segmind/wan2.1-t2v" });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(`${ORIGIN}/v1/wan2.1-t2v`);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(call.init.headers).toEqual({ "Content-Type": "application/json", "x-api-key": KEY_A });
    expect(call.body).toEqual({ prompt: PROMPT, negative_prompt: "blur", seed: 42, duration: 5, aspect_ratio: "16:9" });
  });

  it("sends only the prompt when nothing else is given, and accepts prefixed and custom slugs", async () => {
    serve(videoResponse(), videoResponse());
    expect((await run({}, { model: "segmind/ltx-video-t2v" })).success).toBe(true);
    expect((await run({}, { model: "mochi-1" })).success).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([`${ORIGIN}/v1/ltx-video-t2v`, `${ORIGIN}/v1/mochi-1`]);
    expect(calls[0].body).toEqual({ prompt: PROMPT });
  });

  it("ignores any connection base URL", async () => {
    serve(videoResponse());
    await run({}, { credentials: { apiKey: KEY_A, providerSpecificData: { baseUrl: "https://evil.example/v1" }, baseUrl: "https://evil.example" } });
    expect(calls[0].url).toBe(`${ORIGIN}/v1/wan2.1-t2v`);
  });

  it.each([
    [{ n: 2 }, "n must be 1"],
    [{ stream: true }, "does not stream"],
    [{ seed: 1.5 }, "seed"],
    [{ seed: "7" }, "seed"],
    [{ duration: "5s" }, "duration"],
    [{ duration: 0 }, "duration"],
    [{ duration: 61 }, "duration"],
    [{ aspect_ratio: "wide" }, "aspect_ratio"],
    [{ negative_prompt: 3 }, "negative_prompt"],
    [{ prompt: "   " }, "prompt"],
    [{ prompt: "x".repeat(10_001) }, "prompt"],
    [{ seconds: 5 }, "Use duration"],
    [{ image_url: "https://cdn.example/a.png" }, "image_url"],
    [{ size: "1280x720" }, "size"],
  ])("refuses %j before submit", async (body, text) => {
    const result = await run(body);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toContain(text);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("refuses every dropped media/size field", () => {
    for (const field of SEGMIND_VIDEO_REFUSED_FIELDS) {
      expect(() => buildSegmindVideoRequest("wan2.1-t2v", { prompt: PROMPT, [field]: "x" })).toThrow();
    }
  });

  it.each(["wan2.7-i2v", "segmind/wan2.7-i2v", "foo-image-to-video", "../v2/x", "a/b", "", "..", "with space", 7])(
    "refuses model %j before submit", async (model) => {
      const result = await run({}, { model });
      expect(result.status).toBe(400);
      expect(calls).toHaveLength(0);
    }
  );

  it("refuses response_format url before submit", async () => {
    const result = await run({ response_format: "url" });
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("success normalization and usage", () => {
  it("returns { created, data: [{ b64_json, format: mp4 }] } with one video and unknown cost", async () => {
    const bytes = mp4("ok");
    serve(videoResponse(bytes));
    const result = await run();
    expect(result.success).toBe(true);
    const body = await payload(result);
    expect(Number.isInteger(body.created)).toBe(true);
    expect(body.data).toEqual([{ b64_json: bytes.toString("base64"), format: "mp4" }]);
    expect(result.accounting).toMatchObject({
      state: "complete", modality: "video", cost: null, costStatus: "unknown", costSource: "unavailable",
      nativeUnits: { videos: 1 }, meta: { nativeUnitsSource: "returned-videos", model: "wan2.1-t2v" },
    });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("accepts an octet-stream or untyped MP4 body", async () => {
    serve(videoResponse(mp4(), { "content-type": "application/octet-stream" }), videoResponse(mp4(), {}));
    expect((await run()).success).toBe(true);
    expect((await run()).success).toBe(true);
  });
});

describe("credentials", () => {
  it("uses the selected connection's key on each call, never another one", async () => {
    serve(videoResponse(mp4("a")), videoResponse(mp4("b")));
    await run({}, { credentials: { apiKey: KEY_A, connectionId: "conn-a" } });
    await run({}, { credentials: { apiKey: KEY_B, connectionId: "conn-b" } });
    expect(calls.map((c) => c.init.headers["x-api-key"])).toEqual([KEY_A, KEY_B]);
  });

  it("falls back to accessToken like the source", async () => {
    serve(videoResponse());
    await run({}, { credentials: { accessToken: KEY_B } });
    expect(calls[0].init.headers["x-api-key"]).toBe(KEY_B);
  });

  it.each([{}, { apiKey: "  " }, { apiKey: `${KEY_A}\r\nX-Injected: 1` }])("refuses %j locally with 401", async (credentials) => {
    const result = await run({}, { credentials });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
    await assertNoLeak(result);
  });
});

describe("refused answers", () => {
  it.each([
    [401, 401],
    [403, 401],
    [404, 404],
    [400, 400],
    [422, 400],
    [413, 413],
  ])("maps %i to %i without quoting the body", async (upstream, local) => {
    serve(leaky(upstream));
    const result = await run({}, { credentials: { apiKey: KEY_A } });
    expect(result.status).toBe(local);
    expect(result.acceptedJob).toBeUndefined();
    expect(result.quotaExhausted).toBeUndefined();
    await assertNoLeak(result);
  });

  it.each([402, 403, 406])("marks spent credits (%i) as quota on this connection", async (status) => {
    serve(leaky(status, "Not enough credits"));
    const result = await run();
    expect(result.status).toBe(402);
    expect(result.quotaExhausted).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("keeps a Retry-After on a 429", async () => {
    serve(leaky(429, "slow down", { "retry-after": "30" }));
    const result = await run();
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
    expect(result.response.headers.get("retry-after")).toBeTruthy();
    await assertNoLeak(result);
  });

  it.each([500, 503])("treats %i as an unknown outcome with acceptedJob and no resend", async (status) => {
    serve(leaky(status));
    const result = await run();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, modality: "video", meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });
});

describe("redirects and origins", () => {
  it("refuses a redirect without following it", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/collect" } }));
    const result = await run();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("discards an answer from another origin and records acceptedJob", async () => {
    serve(fromOrigin(videoResponse(), "https://evil.example/v1/wan2.1-t2v"));
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });
});

describe("malformed and unsafe outputs", () => {
  it.each([
    ["JSON on 200", () => json({ status: "ok", url: "http://169.254.169.254/latest" })],
    ["image on 200", () => new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), { headers: { "content-type": "image/png" } })],
    ["non-MP4 bytes", () => new Response(Buffer.from("not a video at all"), { headers: { "content-type": "video/mp4" } })],
    ["empty body", () => new Response(new Uint8Array(0), { headers: { "content-type": "video/mp4" } })],
  ])("reports %s as an unusable completed request", async (_label, make) => {
    serve(make());
    const result = await run();
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("completed-unusable");
    await assertNoLeak(result);
  });

  it("refuses an oversized body by declared length and by streamed length", async () => {
    serve(
      videoResponse(mp4(), { "content-type": "video/mp4", "content-length": "1000" }),
      videoResponse(Buffer.concat([mp4(), Buffer.alloc(200)]), { "content-type": "video/mp4" }),
    );
    for (let i = 0; i < 2; i++) {
      const result = await run({}, { options: { maxBytes: 64 } });
      expect(result.status).toBe(502);
      expect(result.acceptedJob?.meta.jobState).toBe("completed-unusable");
    }
  });
});

describe("transport, deadline and abort", () => {
  it("does not record work for a failure before connecting", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await run();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("records an interrupted send as an unknown outcome and never resends it", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const result = await run();
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("bounds a hung request even when the transport ignores its signal", async () => {
    serve(() => new Promise(() => {}));
    const result = await run({}, { options: { timeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("aborts the fetch signal at the deadline", async () => {
    let seen;
    serve((_url, init) => new Promise((_, reject) => {
      seen = init.signal;
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    }));
    const result = await run({}, { options: { timeoutMs: 20 } });
    expect(seen.aborted).toBe(true);
    expect(result.status).toBe(504);
  });

  it("bounds a stalled video body by the same deadline", async () => {
    serve(new Response(stalledBody(), { headers: { "content-type": "video/mp4" } }));
    const result = await run({}, { options: { timeoutMs: 30 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
  });

  it("returns 499 without sending when the caller already left", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await run({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("aborts an in-flight send and records the unknown outcome", async () => {
    const controller = new AbortController();
    let seen;
    serve((_url, init) => {
      seen = init.signal;
      setTimeout(() => controller.abort(), 5);
      return new Promise(() => {});
    });
    const result = await run({}, { signal: controller.signal });
    expect(seen.aborted).toBe(true);
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("aborts a body read and records the accepted request", async () => {
    const controller = new AbortController();
    serve(() => {
      setTimeout(() => controller.abort(), 5);
      return new Response(stalledBody(), { headers: { "content-type": "video/mp4" } });
    });
    const result = await run({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
  });
});
