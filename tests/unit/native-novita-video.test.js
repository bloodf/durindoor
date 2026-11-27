// Novita native video adapter, staged and unregistered (#2034). Closed mocks
// only: every request is answered below, an unexpected request fails the test,
// and every key is synthetic. Wire shapes follow OmniRoute c71f0065
// (videoRegistry.ts `novita`, videoGeneration.ts format dispatch,
// videoGeneration/novita.ts and videoGeneration/novitaHandler.ts). Passing here
// says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-novita-video/index.js";
import {
  NOVITA_VIDEO_MODELS,
  buildNovitaVideoRequest,
  createNovitaVideoAdapter,
  novitaVideoAdapter,
  resolveNovitaTiming,
} from "../../open-sse/services/providerParity/native-novita-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import novitaRegistry from "../../open-sse/providers/registry/novita.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://api.novita.ai";
const ASYNC = `${ORIGIN}/v3/async`;
const TASK_RESULT = `${ASYNC}/task-result`;
const KEY_A = "novita-SYNTHETIC-key-a-0001";
const KEY_B = "novita-SYNTHETIC-key-b-0002";
const PROMPT = "a paper boat on a calm lake";
const OUT_A = "https://faas-output-video.example.com/out-a.mp4?sig=1";
const OUT_B = "https://faas-output-video.example.com/out-b.mp4?sig=2";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-novita-video/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, reason, headers = {}) =>
  json({ code: status, reason, message: `upstream echo ${KEY_A} ${PROMPT}`, metadata: {} }, status, headers);
const task = (taskId, status, extra = {}) => json({ task: { task_id: taskId, status, reason: `echo ${KEY_A}` }, ...extra });
const succeeded = (taskId, url) => task(taskId, "TASK_STATUS_SUCCEED", { videos: [{ video_url: url, video_type: "mp4" }] });
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
const video = (body = {}, { model = "wan-t2v", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createNovitaVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("echo");
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
  it("stays unregistered and leaves the existing novita entry unchanged", () => {
    expect(getVideoGenerationAdapter("novita")).toBeNull();
    expect(novitaRegistry.serviceKinds).toBeUndefined();
    expect(novitaRegistry.models.some((m) => m.kind === "video")).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.NOVITA_PROVIDER_ID).toBe("novita");
    expect(staged.NOVITA_ASYNC_BASE_URL).toBe(ASYNC);
    expect(staged.NOVITA_TASK_RESULT_URL).toBe(TASK_RESULT);
    expect(staged.NOVITA_AUTH_HEADER).toBe("Authorization");
    expect(staged.NOVITA_AUTH_SCHEME).toBe("Bearer");
    expect(staged.NOVITA_VIDEO_FORMAT).toBe("novita-video");
    expect(NOVITA_VIDEO_MODELS.map((m) => [m.id, m.name])).toEqual([
      ["wan-t2v", "Wan 2.1 Text-to-Video"],
      ["kling-v1.6-t2v", "Kling V1.6 Text-to-Video"],
    ]);
    expect(staged.NOVITA_JOB_TIMEOUT_MS).toBe(300_000);
    expect(staged.NOVITA_POLL_INTERVAL_MS).toBe(2_500);
    expect(novitaVideoAdapter.provider).toBe("novita");
    expect(novitaVideoAdapter.responseFormats).toEqual(["url"]);
    expect(novitaVideoAdapter.async).toBe(true);
    expect(isFunction(novitaVideoAdapter.generate)).toBe(true);
  });

  it("matches the existing provider identity and auth mode", () => {
    expect(novitaRegistry.id).toBe(staged.NOVITA_PROVIDER_ID);
    expect(novitaRegistry.alias).toBe(staged.NOVITA_ALIAS);
    expect(novitaRegistry.authType).toBe("apikey");
    expect(novitaRegistry.transport.auth).toBeUndefined();
    expect(new URL(novitaRegistry.transport.baseUrl).origin).toBe(ORIGIN);
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("novita");
    expect(REGISTRATION.provider.aliases).toEqual(["novita"]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["llm", "video"]);
    expect(REGISTRATION.provider.auth).toEqual({ header: "Authorization", scheme: "Bearer", credentialFields: ["apiKey", "accessToken"] });
    expect(REGISTRATION.models.video.map((m) => m.id)).toEqual(NOVITA_VIDEO_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.submit.url).toBe(`${ASYNC}/{model}`);
    expect(REGISTRATION.endpoints.status.url).toBe(`${TASK_RESULT}?task_id={task_id}`);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("video request contract", () => {
  it("submits the source body with a Bearer key to /v3/async/{model} and polls task-result", async () => {
    serve(json({ task_id: "t-1" }), task("t-1", "TASK_STATUS_QUEUED"), task("t-1", "TASK_STATUS_PROCESSING"), succeeded("t-1", OUT_A));
    const result = await video({ negative_prompt: "blur", duration: 5, size: "832x480" });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(`${ASYNC}/wan-t2v`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(calls[0].body).toEqual({ prompt: PROMPT, negative_prompt: "blur", duration: 5, width: 832, height: 480 });
    expect(calls[1].url).toBe(`${TASK_RESULT}?task_id=t-1`);
    expect(calls[1].init.method).toBe("GET");
    expect(calls[1].init.redirect).toBe("manual");
    expect(calls[1].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(calls).toHaveLength(4);
    expect(await payload(result)).toMatchObject({ data: [{ url: OUT_A, format: "mp4" }] });
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.accounting.meta.jobId).toBe("t-1");
  });

  it("uses the model id as the submit path and sends only the prompt when nothing optional is given", async () => {
    serve(json({ task_id: "t-2" }), succeeded("t-2", OUT_B));
    const result = await video({}, { model: "kling-v1.6-t2v" });
    expect(calls[0].url).toBe(`${ASYNC}/kling-v1.6-t2v`);
    expect(calls[0].body).toEqual({ prompt: PROMPT });
    expect((await payload(result)).data[0].url).toBe(OUT_B);
  });

  it("accepts every source success state", async () => {
    for (const status of ["TASK_STATUS_SUCCEED", "SUCCEED", "SUCCEEDED"]) {
      serve(json({ task_id: "t-3" }), task("t-3", status, { videos: [{ video_url: OUT_A }] }));
      expect((await video()).success).toBe(true);
    }
  });

  it("maps seconds to duration, size with *, and skips an empty negative prompt", () => {
    expect(buildNovitaVideoRequest("wan-t2v", { prompt: "x", seconds: "5", size: "1280*720", negative_prompt: "" }))
      .toEqual({ prompt: "x", duration: 5, width: 1280, height: 720 });
    expect(buildNovitaVideoRequest("wan-t2v", { prompt: "x", seconds: 5, duration: 5 })).toEqual({ prompt: "x", duration: 5 });
  });

  it("reads timeout_ms and poll_interval_ms with the source ceilings and never forwards them", async () => {
    expect(resolveNovitaTiming({})).toEqual({ timeoutMs: 300_000, pollIntervalMs: 2_500 });
    expect(resolveNovitaTiming({ timeout_ms: 9e9, poll_interval_ms: 9e9 })).toEqual({ timeoutMs: 600_000, pollIntervalMs: 120_000 });
    expect(resolveNovitaTiming({ timeout_ms: 5_000, poll_interval_ms: 1 })).toEqual({ timeoutMs: 5_000, pollIntervalMs: 1_000 });
    const waits = [];
    serve(json({ task_id: "t-4" }), succeeded("t-4", OUT_A));
    const result = await createNovitaVideoAdapter({ wait: async (ms) => { waits.push(ms); clock += ms; }, now: () => clock })
      .generate({ model: "wan-t2v", body: { prompt: PROMPT, poll_interval_ms: 4_000, timeout_ms: 60_000 }, credentials: { apiKey: KEY_A } });
    expect(result.success).toBe(true);
    expect(waits).toEqual([4_000]);
    expect(calls[0].body).toEqual({ prompt: PROMPT });
  });

  it.each([
    [{ prompt: "" }, /prompt/],
    [{ prompt: 42 }, /prompt/],
    [{ n: 2 }, /n=1/],
    [{ stream: true }, /streaming/],
    [{ response_format: "b64_json" }, /url only/],
    [{ image: "https://example.com/a.png" }, /does not support image/],
    [{ image_url: "https://example.com/a.png" }, /does not support image_url/],
    [{ seed: 1 }, /does not support seed/],
    [{ aspect_ratio: "16:9" }, /does not support aspect_ratio/],
    [{ duration: 5.5 }, /duration must be a whole number/],
    [{ duration: 0 }, /duration must be a whole number/],
    [{ duration: 999 }, /duration must be a whole number/],
    [{ seconds: "ten" }, /seconds must be a whole number/],
    [{ duration: 5, seconds: 10 }, /disagree/],
    [{ size: "1280x720 extra" }, /size must be WIDTHxHEIGHT/],
    [{ size: "16:9" }, /size must be WIDTHxHEIGHT/],
    [{ size: "10x10" }, /size must be WIDTHxHEIGHT/],
    [{ negative_prompt: 3 }, /negative_prompt/],
    [{ timeout_ms: -1 }, /timeout_ms/],
    [{ poll_interval_ms: "fast" }, /poll_interval_ms/],
  ])("refuses %j before submit", async (extra, message) => {
    const result = await video(extra);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses unknown models and a missing or unsafe key before submit", async () => {
    expect((await video({}, { model: "wan-i2v" })).status).toBe(400);
    expect((await video({}, { model: "../task-result" })).status).toBe(400);
    expect((await video({}, { credentials: { apiKey: "" } })).status).toBe(401);
    expect((await video({}, { credentials: {} })).status).toBe(401);
    expect((await video({}, { credentials: { apiKey: "a\r\nX-Injected: 1" } })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("falls back to accessToken as the source did", async () => {
    serve(json({ task_id: "t-5" }), succeeded("t-5", OUT_A));
    const result = await video({}, { credentials: { accessToken: KEY_B } });
    expect(result.success).toBe(true);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
    expect(calls[1].init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
  });
});

describe("task outcomes", () => {
  it("reports a failed task as an ordinary failure without leaking the reason", async () => {
    for (const status of ["TASK_STATUS_FAILED", "FAILED"]) {
      serve(json({ task_id: "t1" }), task("t1", status));
      const result = await video();
      expect(result.status).toBe(502);
      expect(result.acceptedJob).toBeUndefined();
      await assertNoLeak(result);
    }
  });

  it.each([
    ["UNKNOWN_ERROR", () => task("t1", "UNKNOWN_ERROR")],
    ["succeeded without videos", () => task("t1", "TASK_STATUS_SUCCEED")],
    ["succeeded with an empty video URL", () => succeeded("t1", "")],
    ["a metadata result URL", () => succeeded("t1", "https://169.254.169.254/latest")],
    ["a loopback result URL", () => succeeded("t1", "https://127.0.0.1/x.mp4")],
    ["a plain http result URL", () => succeeded("t1", "http://cdn.example.com/x.mp4")],
    ["a result URL with userinfo", () => succeeded("t1", "https://u:p@cdn.example.com/x.mp4")],
    ["a data URL", () => succeeded("t1", "data:video/mp4;base64,AAAA")],
    ["another task's answer", () => succeeded("t2", OUT_A)],
    ["no task", () => json({ videos: [{ video_url: OUT_A }] })],
    ["no status", () => json({ task: { task_id: "t1" } })],
    ["an unreadable body", () => new Response(`<html>${KEY_A}`, { status: 200 })],
    ["a status 500", () => leaky(500, "SERVER_ERROR")],
    ["a redirect", () => new Response(null, { status: 302, headers: { location: "https://evil.example" } })],
  ])("keeps an accepted task with %s as acceptedJob and never resubmits", async (_name, answer) => {
    serve(json({ task_id: "t1" }), answer());
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(result.acceptedJob.costSource).toBe("accepted-job");
    expect(result.acceptedJob.costStatus).toBe("unknown");
    expect(result.acceptedJob.modality).toBe("video");
    expect(posts()).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("retries 429/503 status checks a bounded number of times", async () => {
    serve(json({ task_id: "t1" }), json({}, 429, { "retry-after": "2" }), json({}, 503), succeeded("t1", OUT_A));
    const result = await video();
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(4);

    calls = [];
    serve(json({ task_id: "t1" }), ...Array.from({ length: 6 }, () => json({}, 429)));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(7);
    expect(posts()).toHaveLength(1);
  });

  it("stops at the job deadline with an unknown outcome", async () => {
    serve(json({ task_id: "t1" }), task("t1", "TASK_STATUS_QUEUED"));
    const result = await video({}, { options: { timeoutMs: 1_500 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("bounds a hanging status check", async () => {
    let seen;
    serve(json({ task_id: "t1" }), (_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await video({}, { options: { requestTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(seen.aborted).toBe(true);
  });

  it("passes a rejected status check's auth status on with acceptedJob", async () => {
    serve(json({ task_id: "t1" }), leaky(401, "INVALID_API_KEY"));
    const result = await video();
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(result);
  });

  it("maps submit refusals, quota and rate limits without leaking", async () => {
    serve(leaky(402, "PAYMENT_REQUIRED"));
    const quota = await video();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    expect(quota.acceptedJob).toBeUndefined();
    await assertNoLeak(quota);

    serve(leaky(403, "NOT_ENOUGH_BALANCE"));
    const balance = await video();
    expect(balance.status).toBe(402);
    expect(balance.quotaExhausted).toBe(true);
    expect(await errorMessage(balance)).toContain("NOT_ENOUGH_BALANCE");

    serve(leaky(401, "INVALID_API_KEY"));
    const auth = await video();
    expect(auth.status).toBe(401);
    expect(auth.acceptedJob).toBeUndefined();
    await assertNoLeak(auth);

    serve(leaky(429, "RATE_LIMITED", { "retry-after": "30" }));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob).toBeUndefined();
    await assertNoLeak(limited);

    serve(leaky(400, "INVALID_REQUEST_BODY"));
    const bad = await video();
    expect(bad.status).toBe(400);
    expect(bad.acceptedJob).toBeUndefined();
    await assertNoLeak(bad);

    serve(leaky(502, "BAD_GATEWAY"));
    const unknown = await video();
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(unknown);
    expect(calls).toHaveLength(6);
  });

  it("refuses a submit redirect without following it", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats an answer from another origin as submit-unknown", async () => {
    const foreign = json({ task_id: "t1" });
    Object.defineProperty(foreign, "url", { value: "https://evil.example/v3/async/wan-t2v" });
    serve(foreign);
    const result = await video();
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("treats a submit without a usable task id as accepted work", async () => {
    serve(json({ code: 0 }));
    const missing = await video();
    expect(missing.acceptedJob.meta.jobState).toBe("accepted");
    serve(json({ task_id: "../../etc/passwd" }));
    const unsafe = await video();
    expect(unsafe.acceptedJob.meta.jobState).toBe("accepted");
    serve(new Response(`not json ${KEY_A}`, { status: 200 }));
    const unreadable = await video();
    expect(unreadable.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(unreadable);
    expect(calls).toHaveLength(3);
  });

  it("bounds the submit and never replays an uncertain one", async () => {
    let seen;
    serve((_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await video({}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
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

  it("aborts polling on the caller's signal and keeps the accepted task", async () => {
    const controller = new AbortController();
    serve(json({ task_id: "t1" }), () => { controller.abort(); return task("t1", "TASK_STATUS_QUEUED"); });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("aborts an in-flight status socket on the caller's signal", async () => {
    const controller = new AbortController();
    let seen;
    serve(json({ task_id: "t1" }), (_url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(seen.aborted).toBe(true);
  });

  it("aborts an in-flight submit and keeps it as submit-unknown", async () => {
    const controller = new AbortController();
    let seen;
    serve((_url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
  });

  it("returns 499 without acceptedJob when aborted before submit", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("keeps two connections' keys and tasks apart", async () => {
    const idFor = (init) => (init.headers.Authorization === `Bearer ${KEY_A}` ? "ta" : "tb");
    const done = (url) => (url.endsWith("=ta") ? succeeded("ta", OUT_A) : succeeded("tb", OUT_B));
    serve((_u, init) => json({ task_id: idFor(init) }), (_u, init) => json({ task_id: idFor(init) }), done, done);
    const [a, b] = await Promise.all([video({}, { credentials: { apiKey: KEY_A } }), video({}, { credentials: { apiKey: KEY_B } })]);
    expect((await payload(a)).data[0].url).toBe(OUT_A);
    expect((await payload(b)).data[0].url).toBe(OUT_B);
    expect(a.accounting.meta.jobId).toBe("ta");
    expect(b.accounting.meta.jobId).toBe("tb");
    for (const call of calls.filter((c) => c.init.method === "GET")) {
      expect(call.init.headers.Authorization).toBe(call.url.endsWith("=ta") ? `Bearer ${KEY_A}` : `Bearer ${KEY_B}`);
    }
  });

  it("ignores a connection base URL and only talks to the fixed origin", async () => {
    serve(json({ task_id: "t1" }), succeeded("t1", OUT_A));
    const result = await video({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example", providerSpecificData: { baseUrl: "https://evil.example" } } });
    expect(result.success).toBe(true);
    for (const call of calls) expect(new URL(call.url).origin).toBe(ORIGIN);
  });
});
