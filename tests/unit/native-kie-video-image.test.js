// KIE.AI native image and video adapters, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (executors/kie.ts, utils/kieTask.ts, handleKieImageGeneration and
// handleKieVideoGeneration). Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-kie-video-image/index.js";
import {
  KIE_IMAGE_MODELS,
  KIE_VIDEO_MODELS,
  KIE_VIDEO_UNSUPPORTED_MODELS,
  buildKieImageRequest,
  buildKieVideoRequest,
  createKieImageAdapter,
  createKieVideoAdapter,
  kieImageAdapter,
  kieTaskState,
  kieVideoAdapter,
} from "../../open-sse/services/providerParity/native-kie-video-image/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import kieRegistry from "../../open-sse/providers/registry/kie.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://api.kie.ai";
const CREATE = `${ORIGIN}/api/v1/jobs/createTask`;
const RECORD = `${ORIGIN}/api/v1/jobs/recordInfo`;
const KEY_A = "kie-SYNTHETIC-key-a-0001";
const KEY_B = "kie-SYNTHETIC-key-b-0002";
const PROMPT = "a red ball rolling on a white floor";
const VIDEO_A = "https://tempfile.aiquickdraw.com/v/video-a.mp4";
const VIDEO_B = "https://tempfile.aiquickdraw.com/v/video-b.mp4";
const IMAGE_A = "https://tempfile.aiquickdraw.com/i/image-a.png";
const IMAGE_B = "https://tempfile.aiquickdraw.com/i/image-b.png";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-kie-video-image/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const created = (taskId = "task-1") => json({ code: 200, msg: "success", data: { taskId } });
const record = (data, extra = {}) => json({ code: 200, msg: "success", data, ...extra });
const done = (urls, taskId = "task-1") => record({ taskId, state: "success", resultJson: JSON.stringify({ resultUrls: urls }) });
const leakyEnvelope = (code) => json({ code, msg: `upstream echo ${KEY_A} ${PROMPT}` });
const leaky = (status) => json({ code: status, msg: `upstream echo ${KEY_A} ${PROMPT}` }, status);
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
const video = (body = {}, { model = "veo/veo-3-1-fast", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createKieVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const image = (body = {}, { model = "google-imagen/nano-banana-2", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createKieImageAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
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

// Isolated registration block: the positive registry identity checks. Every
// other block works staged or registered.
describe("canonical registration (isolated)", () => {
  it("registers native media and preserves the existing kie chat entry", () => {
    expect(getImageAdapter("kie")).toBe(staged.kieImageAdapter);
    expect(getVideoGenerationAdapter("kie")).toBe(staged.kieVideoAdapter);
    expect(kieRegistry.serviceKinds).toEqual(["llm", "image", "video"]);
    expect(kieRegistry.authType).toBe("apikey");
    expect(kieRegistry.transport.baseUrl).toBe(`${ORIGIN}/v1/chat/completions`);
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.KIE_ORIGIN).toBe(ORIGIN);
    expect(staged.KIE_MARKET_STATUS_URL).toBe(RECORD);
    expect(staged.KIE_IMAGE_FORMAT).toBe("kie-image");
    expect(staged.KIE_VIDEO_FORMAT).toBe("kie-video");
    expect(staged.KIE_IMAGE_SIZES).toEqual(["1:1", "16:9", "9:16", "4:3", "3:4"]);
    expect(KIE_IMAGE_MODELS).toHaveLength(35);
    expect(KIE_VIDEO_MODELS).toHaveLength(16);
    expect(KIE_IMAGE_MODELS.filter((m) => m.kieFluxKontextModel).map((m) => [m.id, m.kieFluxKontextModel]))
      .toEqual([["flux/kontext", "flux-kontext-pro"], ["flux/kontext-max", "flux-kontext-max"]]);
    expect(KIE_VIDEO_UNSUPPORTED_MODELS).toEqual([
      "wan/2-7-image-to-video", "hailuo/2-3-image-to-video-pro", "grok-imagine/image-to-video",
      "happyhorse/image-to-video", "sora-2-image-to-video", "sora-2-pro-image-to-video",
    ]);
    expect(kieImageAdapter.responseFormats).toEqual(["url"]);
    expect(kieVideoAdapter.responseFormats).toEqual(["url"]);
    expect(isFunction(kieImageAdapter.generate) && isFunction(kieVideoAdapter.generate)).toBe(true);
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("kie");
    expect(REGISTRATION.provider.aliases).toEqual(["kie"]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["image", "video"]);
    expect(REGISTRATION.models.image.map((m) => m.id)).toEqual(KIE_IMAGE_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.video.map((m) => m.id)).toEqual(KIE_VIDEO_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.video.filter((m) => !m.supported).map((m) => m.id)).toEqual(KIE_VIDEO_UNSUPPORTED_MODELS);
    expect(REGISTRATION.endpoints.marketCreate.url).toBe(CREATE);
    expect(REGISTRATION.endpoints.marketStatus.url).toBe(`${RECORD}?taskId={taskId}`);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("task state normalization", () => {
  it.each([
    [{ state: "success" }, "success"], [{ status: "SUCCESS" }, "success"], [{ successFlag: 1 }, "success"],
    [{ status: "FIRST_SUCCESS" }, "success"], [{ state: "fail" }, "failed"], [{ successFlag: 2 }, "failed"],
    [{ successFlag: 3 }, "failed"], [{ status: "GENERATE_FAILED" }, "failed"], [{ state: "waiting" }, "pending"],
    [{ state: "queuing" }, "pending"], [{ successFlag: 0 }, "pending"], [{ status: "GENERATING" }, "pending"],
  ])("maps %j to %s", (data, expected) => {
    expect(kieTaskState({ code: 200, msg: "success", data })).toBe(expected);
  });

  it("does not read the envelope msg as a state", () => {
    expect(kieTaskState({ code: 200, msg: "success", data: { taskId: "t" } })).toBeNull();
  });
});

describe("video request contract", () => {
  it("submits the source Market body with Bearer auth and polls recordInfo by taskId", async () => {
    serve(created("vid-123"), record({ taskId: "vid-123", state: "generating" }), done([VIDEO_A], "vid-123"));
    const result = await video({ duration: 8, aspect_ratio: "9:16", sound: true, poll_interval_ms: 60000, timeout_ms: 5 });
    expect(result.success).toBe(true);
    expect(await payload(result)).toMatchObject({ data: [{ url: VIDEO_A, format: "mp4" }] });
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe(CREATE);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(calls[0].body).toEqual({
      model: "veo/veo-3-1-fast",
      input: { prompt: PROMPT, duration: "8", aspect_ratio: "9:16", sound: true },
    });
    expect(calls[1].url).toBe(`${RECORD}?taskId=vid-123`);
    expect(calls[1].init.method).toBe("GET");
    expect(calls[1].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
    expect(result.accounting.costStatus).toBe("unknown");
  });

  it("applies the source defaults", () => {
    expect(buildKieVideoRequest("kling-3.0/video", { prompt: "x" }))
      .toEqual({ model: "kling-3.0/video", input: { prompt: "x", duration: "5", aspect_ratio: "16:9", sound: false } });
    expect(buildKieVideoRequest("sora-2-text-to-video", { prompt: "x", duration: "10" }).input.duration).toBe("10");
  });

  it("reads videoUrls and data.response.resultUrls when resultUrls is absent", async () => {
    serve(created(), record({ taskId: "task-1", state: "success", resultJson: { videoUrls: [VIDEO_B] } }));
    expect((await payload(await video())).data[0].url).toBe(VIDEO_B);
    serve(created(), record({ taskId: "task-1", successFlag: 1, response: { resultUrls: [VIDEO_A, VIDEO_A] } }));
    expect((await payload(await video())).data).toEqual([{ url: VIDEO_A, format: "mp4" }]);
  });

  it.each([
    [{ duration: 1.5 }, /whole number/],
    [{ duration: 600 }, /whole number/],
    [{ aspect_ratio: "wide" }, /aspect_ratio/],
    [{ sound: "yes" }, /sound/],
    [{ image_url: "https://example.com/a.png" }, /text-to-video/],
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

  it("refuses image-to-video models, unknown models and a missing key before submit", async () => {
    for (const model of KIE_VIDEO_UNSUPPORTED_MODELS) {
      const result = await video({}, { model });
      expect(result.status).toBe(400);
      expect(await errorMessage(result)).toMatch(/input image/);
    }
    expect((await video({}, { model: "gpt4o-image" })).status).toBe(400);
    expect((await video({}, { credentials: { apiKey: "" } })).status).toBe(401);
    expect((await video({}, { credentials: { apiKey: "a\r\nX-Evil: 1" } })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("image request contract", () => {
  it("Market: maps the catalog id to the upstream id and sends the source input", async () => {
    serve(created("img-1"), record({ taskId: "img-1", state: "success", resultJson: JSON.stringify({ resultUrls: [IMAGE_A, IMAGE_B] }) }));
    const result = await image({ size: "1792x1024", image_url: "https://example.com/ref.png", response_format: "url" });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(CREATE);
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(calls[0].body).toEqual({
      model: "nano-banana-2",
      input: { prompt: PROMPT, aspect_ratio: "16:9", image_url: "https://example.com/ref.png" },
    });
    expect(calls[1].url).toBe(`${RECORD}?taskId=img-1`);
    expect(calls[1].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(await payload(result)).toMatchObject({ data: [{ url: IMAGE_A }, { url: IMAGE_B }] });
    expect(result.accounting.nativeUnits.images).toBe(2);
    expect(result.accounting.costStatus).toBe("unknown");
  });

  it("Flux Kontext: uses the dedicated API and catalog tier", async () => {
    serve(created("fk-1"), record({ taskId: "fk-1", successFlag: 1, response: { resultImageUrl: IMAGE_A } }));
    const result = await image({ size: "4:3", image: "https://example.com/in.png" }, { model: "flux/kontext-max" });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(`${ORIGIN}/api/v1/flux/kontext/generate`);
    expect(calls[0].body).toEqual({ prompt: PROMPT, aspectRatio: "4:3", model: "flux-kontext-max", inputImage: "https://example.com/in.png" });
    expect(calls[1].url).toBe(`${ORIGIN}/api/v1/flux/kontext/record-info?taskId=fk-1`);
  });

  it("direct 4o image: sends size and nVariants to its own API", async () => {
    serve(created("4o-1"), record({ taskId: "4o-1", status: "SUCCESS", response: { resultUrls: [IMAGE_A, IMAGE_B] } }));
    const result = await image({ n: 2 }, { model: "gpt4o-image" });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(`${ORIGIN}/api/v1/gpt4o-image/generate`);
    expect(calls[0].body).toEqual({ prompt: PROMPT, size: "1:1", nVariants: 2 });
    expect(calls[1].url).toBe(`${ORIGIN}/api/v1/gpt4o-image/record-info?taskId=4o-1`);
    expect((await payload(result)).data).toHaveLength(2);
  });

  it("keeps the source upstream id table", () => {
    const upstream = (model) => buildKieImageRequest(model, { prompt: "x" }).request.model;
    expect(upstream("gpt/gpt-image-1.5-text-to-image")).toBe("gpt-image/1.5-text-to-image");
    expect(upstream("flux/2-text-to-image")).toBe("flux-2/flex-text-to-image");
    expect(upstream("z-image/4.5-text-to-image")).toBe("z-image");
    expect(upstream("ideogram/v3-edit")).toBe("ideogram/v3-edit");
  });

  it.each([
    [{ size: "1536x1024" }, /size must be one of/],
    [{ size: "21:9" }, /size must be one of/],
    [{ aspect_ratio: "16:9" }, /aspect_ratio/],
    [{ n: 2 }, /n=1/],
    [{ mask: "https://example.com/m.png" }, /mask/],
    [{ quality: "hd" }, /quality/],
    [{ response_format: "b64_json" }, /url only/],
    [{ stream: true }, /streaming/],
    [{ image_url: "http://example.com/a.png" }, /public https/],
    [{ image_urls: ["https://127.0.0.1/a.png"] }, /public https/],
    [{ image: "data:image/png;base64,aGk=" }, /public https/],
    [{ image_urls: ["https://example.com/a.png", "https://example.com/b.png"] }, /one input image/],
  ])("refuses %j before anything is sent", async (extra, message) => {
    const result = await image(extra);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses direct-route inputs it would drop, unknown models and a missing key", async () => {
    expect((await image({ n: 3 }, { model: "gpt4o-image" })).status).toBe(400);
    expect((await image({ image_url: "https://example.com/a.png" }, { model: "gpt4o-image" })).status).toBe(400);
    expect((await image({}, { model: "veo/veo-3-1" })).status).toBe(400);
    expect((await image({}, { credentials: {} })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("outputs and failures", () => {
  it("drops unsafe result URLs and treats a success without a usable one as accepted work", async () => {
    serve(created(), done([IMAGE_A, "http://cdn.example.com/x.png", "https://10.0.0.1/x.png", "https://u:p@example.com/x.png"]));
    const ok = await image();
    expect((await payload(ok)).data).toEqual([{ url: IMAGE_A }]);
    expect(ok.accounting.nativeUnits.images).toBe(1);

    serve(created(), done(["https://169.254.169.254/latest"]));
    const unsafe = await video();
    expect(unsafe.status).toBe(502);
    expect(unsafe.acceptedJob.meta.jobState).toBe("accepted");
    expect(unsafe.acceptedJob.costStatus).toBe("unknown");
  });

  it.each([
    ["success without URLs", record({ taskId: "task-1", state: "success", resultJson: "{}" })],
    ["an unparseable resultJson", record({ taskId: "task-1", state: "success", resultJson: "{oops" })],
    ["another task's answer", done([VIDEO_A], "task-2")],
    ["no state", record({ taskId: "task-1" })],
    ["no data", json({ code: 200, msg: "success" })],
    ["an envelope error code", leakyEnvelope(500)],
    ["an unreadable body", new Response("<html>", { status: 200 })],
    ["a status 500", json({}, 500)],
    ["a redirect", new Response(null, { status: 302, headers: { location: "https://evil.example" } })],
  ])("keeps an accepted task with %s as acceptedJob and never resubmits", async (_name, answer) => {
    serve(created(), answer);
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(posts()).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("reports a failed task as an ordinary failure without quoting failMsg", async () => {
    serve(created(), record({ taskId: "task-1", state: "fail", failCode: "422", failMsg: `echo ${KEY_A}` }));
    const result = await image();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(await errorMessage(result)).toMatch(/failed \(422\)/);
    await assertNoLeak(result);
  });

  it("maps envelope refusals on submit without quoting msg", async () => {
    serve(leakyEnvelope(401));
    const auth = await video();
    expect(auth.status).toBe(401);
    expect(auth.acceptedJob).toBeUndefined();
    await assertNoLeak(auth);

    serve(leakyEnvelope(402));
    const quota = await image();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    expect(quota.acceptedJob).toBeUndefined();
    await assertNoLeak(quota);

    serve(leakyEnvelope(429));
    expect((await video()).status).toBe(429);

    serve(leakyEnvelope(422));
    const bad = await video();
    expect(bad.status).toBe(422);
    expect(bad.acceptedJob).toBeUndefined();

    serve(leakyEnvelope(455));
    const unavailable = await video();
    expect(unavailable.status).toBe(502);
    expect(unavailable.acceptedJob).toBeUndefined();

    serve(leakyEnvelope(501));
    const unknown = await image();
    expect(unknown.status).toBe(502);
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(unknown);
    expect(calls).toHaveLength(6);
  });

  it("maps HTTP refusals on submit without quoting the body", async () => {
    serve(leaky(401));
    const auth = await image();
    expect(auth.status).toBe(401);
    await assertNoLeak(auth);

    serve(leaky(402));
    const quota = await video();
    expect(quota.quotaExhausted).toBe(true);

    serve(json({}, 429, { "retry-after": "30" }));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.response.headers.get("retry-after")).toBeTruthy();

    serve(leaky(503));
    const unknown = await video();
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(unknown);
  });

  it("treats a submit without a usable task id as accepted work", async () => {
    serve(json({ code: 200, msg: "success", data: {} }));
    expect((await video()).acceptedJob.meta.jobState).toBe("accepted");
    serve(json({ code: 200, data: { taskId: "../../etc/passwd" } }));
    expect((await image()).acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("refuses a submit redirect without following it, and flags a followed one", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/" } }));
    const refused = await video();
    expect(refused.status).toBe(502);
    expect(refused.acceptedJob).toBeUndefined();

    const followed = created();
    Object.defineProperty(followed, "url", { value: "https://evil.example/api/v1/jobs/createTask" });
    serve(followed);
    const foreign = await video();
    expect(foreign.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(2);
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

  it("retries 429/503 status checks without using the poll budget", async () => {
    serve(created(), json({}, 429, { "retry-after": "2" }), json({}, 503), done([VIDEO_A]));
    const result = await video({}, { options: { maxPolls: 1 } });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it("stops at the poll budget and the task deadline with an unknown outcome", async () => {
    serve(created(), record({ taskId: "task-1", state: "waiting" }), record({ taskId: "task-1", state: "waiting" }));
    const byPolls = await video({}, { options: { maxPolls: 2 } });
    expect(byPolls.status).toBe(504);
    expect(byPolls.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(3);

    calls = [];
    serve(created(), record({ taskId: "task-1", state: "waiting" }));
    const byTime = await image({}, { options: { timeoutMs: 1_500 } });
    expect(byTime.status).toBe(504);
    expect(calls).toHaveLength(2);
  });

  it("passes a rejected status check's auth status on with acceptedJob", async () => {
    serve(created(), leaky(401));
    const result = await video();
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(result);
  });

  it("bounds the submit, aborts its socket and never replays it", async () => {
    let seen;
    serve((_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await video({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("bounds a status check and keeps the accepted task", async () => {
    let seen;
    serve(created(), (_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await image({}, { options: { requestTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(seen.aborted).toBe(true);
  });

  it("returns 499 on caller abort, with acceptedJob only once the submit was sent", async () => {
    const before = new AbortController();
    before.abort();
    const early = await video({}, { signal: before.signal });
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

    calls = [];
    const polling = new AbortController();
    serve(created(), () => { polling.abort(); return record({ taskId: "task-1", state: "waiting" }); });
    const mid = await video({}, { signal: polling.signal });
    expect(mid.status).toBe(499);
    expect(mid.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("keeps two connections' keys and tasks apart", async () => {
    const owner = (init) => (init.headers.Authorization.endsWith(KEY_A) ? "ta" : "tb");
    const finish = (url) => done([url.endsWith("ta") ? VIDEO_A : VIDEO_B], url.endsWith("ta") ? "ta" : "tb");
    serve((_u, init) => created(owner(init)), (_u, init) => created(owner(init)), finish, finish);
    const [a, b] = await Promise.all([
      video({}, { credentials: { apiKey: KEY_A } }),
      video({}, { credentials: { apiKey: KEY_B } }),
    ]);
    expect((await payload(a)).data[0].url).toBe(VIDEO_A);
    expect((await payload(b)).data[0].url).toBe(VIDEO_B);
    for (const call of calls.filter((c) => c.init.method === "GET")) {
      expect(call.init.headers.Authorization).toBe(`Bearer ${call.url.endsWith("ta") ? KEY_A : KEY_B}`);
    }
  });

  it("ignores a connection base URL and only talks to the fixed origin", async () => {
    serve(created(), done([IMAGE_A]));
    const result = await image({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example", providerSpecificData: { baseUrl: "https://evil.example" } } });
    expect(result.success).toBe(true);
    for (const call of calls) expect(new URL(call.url).origin).toBe(ORIGIN);
  });
});
