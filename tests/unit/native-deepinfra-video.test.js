// DeepInfra native video adapter, registered on deepinfra (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (videoRegistry.ts `deepinfra`, videoGeneration.ts format dispatch,
// videoGeneration/deepinfraHandler.ts). Passing here says nothing about the
// live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-deepinfra-video/index.js";
import {
  DEEPINFRA_VIDEO_MODELS,
  buildDeepinfraVideoRequest,
  createDeepinfraVideoAdapter,
  deepinfraVideoAdapter,
} from "../../open-sse/services/providerParity/native-deepinfra-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { supportsVideoGeneration } from "../../open-sse/handlers/videoGenerationCore.js";
import { getVideoConfig } from "../../open-sse/handlers/videoCore.js";
import deepinfraRegistry from "../../open-sse/providers/registry/deepinfra.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://api.deepinfra.com";
const INFERENCE = `${ORIGIN}/v1/inference`;
const T2V = "Wan-AI/Wan2.2-T2V-A14B";
const TI2V = "Wan-AI/Wan2.2-TI2V-5B";
const KEY_A = "deepinfra-SYNTHETIC-key-a-0001";
const KEY_B = "deepinfra-SYNTHETIC-key-b-0002";
const PROMPT = "a paper boat on a calm lake";
const OUT_A = "https://cdn.deepinfra.example/out-a.mp4";
const OUT_B = "https://cdn.deepinfra.example/out-b.mp4";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-deepinfra-video/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const done = (url = OUT_A, extra = {}) =>
  json({ video_url: url, seed: 7, request_id: "req-1", inference_status: { status: "succeeded", runtime_ms: 1200, cost: 0.05 }, ...extra });
const leaky = (status, headers = {}) => json({ detail: { error: `upstream echo ${KEY_A} ${PROMPT}` } }, status, headers);
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

const video = (body = {}, { model = T2V, credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createDeepinfraVideoAdapter({ now: () => clock, ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};
// A fetch that only settles on abort, like a stalled render.
const hang = () => (_url, init) => new Promise((_, reject) => {
  init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
});

beforeEach(() => {
  calls = [];
  clock = 1_000_000_000;
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Isolated registration block: the positive registry identity checks. Every
// other block works staged or registered.
describe("canonical registration (isolated)", () => {
  it("registers the video adapter on the existing deepinfra entry and keeps chat listed", () => {
    expect(getVideoGenerationAdapter("deepinfra")).toBe(deepinfraVideoAdapter);
    expect(supportsVideoGeneration("deepinfra")).toBe(true);
    expect(deepinfraRegistry.serviceKinds).toEqual(expect.arrayContaining(REGISTRATION.provider.addServiceKinds));
    expect(deepinfraRegistry.serviceKinds[0]).toBe("llm");
    expect(deepinfraRegistry.models.filter((m) => m.kind === "video").map((m) => [m.id, m.name]))
      .toEqual(DEEPINFRA_VIDEO_MODELS.map((m) => [m.id, m.name]));
    expect(deepinfraRegistry.modelsFetcher).toEqual({ url: "https://api.deepinfra.com/v1/openai/models", type: "openai" });
    expect(deepinfraRegistry.videoConfig).toBeUndefined();
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.DEEPINFRA_PROVIDER_ID).toBe("deepinfra");
    expect(staged.DEEPINFRA_INFERENCE_URL).toBe(INFERENCE);
    expect(staged.DEEPINFRA_AUTH_HEADER).toBe("Authorization");
    expect(staged.DEEPINFRA_AUTH_SCHEME).toBe("Bearer");
    expect(staged.DEEPINFRA_VIDEO_FORMAT).toBe("deepinfra-video");
    expect(DEEPINFRA_VIDEO_MODELS.map((m) => [m.id, m.name])).toEqual([
      ["Wan-AI/Wan2.2-T2V-A14B", "Wan 2.2 T2V A14B"],
      ["Wan-AI/Wan2.2-TI2V-5B", "Wan 2.2 TI2V 5B"],
      ["Wan-AI/Wan2.7-T2V", "Wan 2.7 T2V"],
      ["Lightricks/LTX-2.3-Distilled", "LTX 2.3 Distilled"],
    ]);
    expect(DEEPINFRA_VIDEO_MODELS.filter((m) => m.acceptsImage).map((m) => m.id)).toEqual([TI2V]);
    expect(deepinfraVideoAdapter.provider).toBe("deepinfra");
    expect(deepinfraVideoAdapter.responseFormats).toEqual(["url"]);
    expect(deepinfraVideoAdapter.defaultResponseFormat).toBe("url");
    expect(isFunction(deepinfraVideoAdapter.generate)).toBe(true);
  });

  it("matches the existing provider identity and auth mode", () => {
    expect(deepinfraRegistry.id).toBe(staged.DEEPINFRA_PROVIDER_ID);
    expect(deepinfraRegistry.alias).toBe(staged.DEEPINFRA_ALIAS);
    expect(deepinfraRegistry.authType).toBe("apikey");
    expect(deepinfraRegistry.transport.authHeader).toBe("bearer");
    expect(new URL(deepinfraRegistry.transport.baseUrl).origin).toBe(ORIGIN);
    // Not an equivalent: the existing transport is the OpenAI chat path, not /v1/inference.
    expect(deepinfraRegistry.transport.baseUrl).not.toContain("/v1/inference");
    expect(getVideoConfig("deepinfra")).toBeNull();
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("deepinfra");
    expect(REGISTRATION.provider.aliases).toEqual([]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["llm", "video"]);
    expect(REGISTRATION.provider.auth).toEqual({ header: "Authorization", scheme: "Bearer", credentialFields: ["apiKey", "accessToken"] });
    expect(REGISTRATION.models.video.map((m) => [m.id, m.name, m.acceptsImage]))
      .toEqual(DEEPINFRA_VIDEO_MODELS.map((m) => [m.id, m.name, m.acceptsImage]));
    expect(REGISTRATION.endpoints.generate).toEqual({ method: "POST", url: `${INFERENCE}/{model}`, synchronous: true });
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name]).toBeDefined();
  });
});

describe("request contract", () => {
  it("sends the source envelope: POST /v1/inference/{model}, Bearer key, JSON body", async () => {
    serve(done());
    const result = await video({ negative_prompt: "blur", seed: 42 });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(`${INFERENCE}/${T2V}`);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(call.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(call.body).toEqual({ prompt: PROMPT, negative_prompt: "blur", seed: 42 });
  });

  it("sends image for the TI2V model from image or image_url", async () => {
    const img = "https://images.example.com/frame.png";
    serve(done(), done());
    await video({ image: img }, { model: TI2V });
    await video({ image_url: img }, { model: TI2V });
    expect(calls.map((c) => c.url)).toEqual([`${INFERENCE}/${TI2V}`, `${INFERENCE}/${TI2V}`]);
    expect(calls.map((c) => c.body)).toEqual([{ prompt: PROMPT, image: img }, { prompt: PROMPT, image: img }]);
    const data = "data:image/png;base64,iVBORw0KGgo=";
    expect(buildDeepinfraVideoRequest(TI2V, { prompt: PROMPT, image: data })).toEqual({ prompt: PROMPT, image: data });
  });

  it("ignores the connection base URL and always uses the fixed origin", async () => {
    serve(done());
    await video({}, { credentials: { apiKey: KEY_A, providerSpecificData: { baseUrl: "https://evil.example/v1" } } });
    expect(calls[0].url).toBe(`${INFERENCE}/${T2V}`);
  });

  it.each([
    ["unknown model", { model: "Wan-AI/Unknown" }, {}],
    ["empty prompt", {}, { prompt: "  " }],
    ["non-string prompt", {}, { prompt: 12 }],
    ["n > 1", {}, { n: 2 }],
    ["stream", {}, { stream: true }],
    ["b64_json", {}, { response_format: "b64_json" }],
    ["unsupported field", {}, { duration: 5 }],
    ["string seed", {}, { seed: "7" }],
    ["negative seed", {}, { seed: -1 }],
    ["non-string negative_prompt", {}, { negative_prompt: 3 }],
    ["image on a text-only model", {}, { image: "https://images.example.com/a.png" }],
    ["http image", { model: TI2V }, { image: "http://images.example.com/a.png" }],
    ["private image host", { model: TI2V }, { image: "https://127.0.0.1/a.png" }],
    ["userinfo image", { model: TI2V }, { image: "https://u:p@images.example.com/a.png" }],
    ["non-image data URL", { model: TI2V }, { image: "data:text/html;base64,PGI+" }],
    ["image and image_url disagree", { model: TI2V }, { image: "https://a.example/a.png", image_url: "https://a.example/b.png" }],
  ])("refuses %s with 400 before any send", async (_name, opts, body) => {
    const result = await video(body, opts);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing key before any send", async () => {
    for (const credentials of [{}, { apiKey: "" }, { apiKey: "bad\r\nX-Injected: 1" }, null]) {
      const result = await video({}, { credentials });
      expect(result.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("success normalization and accounting", () => {
  it("returns one url-format video and honest unknown-cost accounting", async () => {
    serve(done());
    const result = await video();
    expect(result.success).toBe(true);
    const body = await payload(result);
    expect(body.data).toEqual([{ url: OUT_A, format: "mp4" }]);
    expect(body.created).toBe(Math.floor(clock / 1000));
    expect(result.accounting).toMatchObject({
      state: "complete", modality: "video", nativeUnits: { videos: 1 }, cost: null, costStatus: "unknown",
    });
    expect(result.accounting.meta).toEqual({
      nativeUnitsSource: "returned-videos",
      requestId: "req-1",
      providerMetadata: { path: "inference_status", value: { status: "succeeded", runtime_ms: 1200, cost: 0.05 } },
    });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("uses each call's own key with two credentials and shares nothing", async () => {
    serve(done(OUT_A), done(OUT_B));
    const a = await video({}, { credentials: { apiKey: KEY_A } });
    const b = await video({}, { credentials: { apiKey: KEY_B } });
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    expect((await payload(a)).data[0].url).toBe(OUT_A);
    expect((await payload(b)).data[0].url).toBe(OUT_B);
  });

  it("falls back to accessToken like the source", async () => {
    serve(done());
    await video({}, { credentials: { accessToken: KEY_B } });
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
  });
});

describe("refused answers (never quote upstream, never replay)", () => {
  it("maps 401/403 to an auth failure without acceptedJob", async () => {
    for (const status of [401, 403]) {
      serve(leaky(status));
      const result = await video();
      expect(result.status).toBe(status);
      expect(result.acceptedJob).toBeUndefined();
      await assertNoLeak(result);
    }
  });

  it("maps 402 to quota exhaustion on this connection", async () => {
    serve(leaky(402));
    const result = await video();
    expect(result.status).toBe(402);
    expect(result.quotaExhausted).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("maps 429 with Retry-After to a rate limit", async () => {
    serve(leaky(429, { "retry-after": "30" }));
    const result = await video();
    expect(result.status).toBe(429);
    await assertNoLeak(result);
  });

  it("passes 4xx validation failures through without the upstream body", async () => {
    serve(leaky(422));
    const result = await video();
    expect(result.status).toBe(422);
    expect(await errorMessage(result)).toBe("DeepInfra refused the video request with 422");
    await assertNoLeak(result);
  });

  it("marks 5xx as uncertain accepted work and does not resend", async () => {
    serve(leaky(500));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("refuses a redirect without following it", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/x" } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats an answer from a foreign origin as uncertain", async () => {
    const res = done();
    Object.defineProperty(res, "url", { value: "https://evil.example/v1/inference/x" });
    serve(res);
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });
});

describe("malformed and unsafe 2xx answers", () => {
  it.each([
    ["non-JSON body", () => new Response(`<html>${KEY_A}</html>`, { status: 200 })],
    ["JSON array", () => json([OUT_A])],
    ["no video_url", () => json({ inference_status: { status: "succeeded", error: `upstream echo ${KEY_A}` } })],
    ["http video_url", () => done("http://cdn.deepinfra.example/a.mp4")],
    ["private host video_url", () => done("https://169.254.169.254/latest")],
    ["data URL video_url", () => done("data:video/mp4;base64,AAAA")],
    ["userinfo video_url", () => done("https://user:pw@cdn.deepinfra.example/a.mp4")],
    ["oversized body", () => json({ video_url: OUT_A, pad: "x".repeat(300 * 1024) })],
  ])("%s carries acceptedJob and is not resent", async (_name, make) => {
    serve(make());
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costStatus: "unknown", meta: { jobState: "completed-unusable" } });
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("reports an inference_status failure without quoting its error", async () => {
    serve(json({ inference_status: { status: "failed", error: `upstream echo ${KEY_A}` } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("failed-reported");
    expect(await errorMessage(result)).toBe("DeepInfra reported the video inference as failed");
    await assertNoLeak(result);
  });

  it("drops a malformed request_id and non-numeric status fields from metadata", async () => {
    serve(json({ video_url: OUT_A, request_id: "bad id\n", inference_status: { status: "succeeded", cost: "free", runtime_ms: null } }));
    const result = await video();
    expect(result.accounting.meta.requestId).toBeUndefined();
    expect(result.accounting.meta.providerMetadata.value).toEqual({ status: "succeeded" });
  });
});

describe("cancellation, deadline and transport", () => {
  it("returns 499 without sending when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("aborts the socket on caller abort mid-render and records uncertain work", async () => {
    const controller = new AbortController();
    let seenSignal;
    serve((url, init) => {
      seenSignal = init.signal;
      setTimeout(() => controller.abort(), 5);
      return hang()(url, init);
    });
    const result = await video({}, { signal: controller.signal });
    expect(seenSignal.aborted).toBe(true);
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("bounds the call with the deadline and records uncertain work", async () => {
    let seenSignal;
    serve((url, init) => {
      seenSignal = init.signal;
      return hang()(url, init);
    });
    const result = await video({}, { options: { timeoutMs: 20 } });
    expect(seenSignal.aborted).toBe(true);
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("ends the wait even when the transport ignores its signal", async () => {
    serve(() => new Promise(() => {}));
    const result = await video({}, { options: { timeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toBeDefined();
  });

  it("aborts a stalled body read as accepted work", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"video_url":')); } });
    serve(new Response(stream, { status: 200, headers: { "content-type": "application/json" } }));
    setTimeout(() => controller.abort(), 10);
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("treats a pre-connect failure as not sent and a mid-flight failure as uncertain", async () => {
    serve(() => Promise.reject(transportError("ECONNREFUSED")));
    const unsent = await video();
    expect(unsent.status).toBe(502);
    expect(unsent.acceptedJob).toBeUndefined();
    await assertNoLeak(unsent);

    serve(() => Promise.reject(transportError("ECONNRESET")));
    const reset = await video();
    expect(reset.status).toBe(502);
    expect(reset.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(reset);
    expect(calls).toHaveLength(2);
  });
});
