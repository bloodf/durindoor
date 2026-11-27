// MiniMax native video adapter, staged and unregistered (#2034). Closed mocks
// only: every request is answered below, an unexpected request fails the test,
// and every key is synthetic. Wire shapes follow OmniRoute c71f0065
// (videoRegistry.ts `minimax`, videoGeneration.ts format dispatch and
// videoGeneration/minimaxHandler.ts). Passing here says nothing about the live
// service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-minimax-video/index.js";
import {
  MINIMAX_VIDEO_MODELS,
  buildMinimaxVideoRequest,
  createMinimaxVideoAdapter,
  minimaxVideoAdapter,
  resolveMinimaxTiming,
} from "../../open-sse/services/providerParity/native-minimax-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import minimaxRegistry from "../../open-sse/providers/registry/minimax.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://api.minimax.io";
const CREATE = `${ORIGIN}/v1/video_generation`;
const QUERY = `${ORIGIN}/v1/query/video_generation`;
const FILES = `${ORIGIN}/v1/files/retrieve`;
const KEY_A = "minimax-SYNTHETIC-key-a-0001";
const KEY_B = "minimax-SYNTHETIC-key-b-0002";
const PROMPT = "a paper boat on a calm lake";
const OUT_A = "https://public-cdn-video.example.com/out-a.mp4?sig=1";
const OUT_B = "https://public-cdn-video.example.com/out-b.mp4?sig=2";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-minimax-video/registration.json", import.meta.url), "utf8"));

const ok = { status_code: 0, status_msg: "success" };
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const created = (taskId) => json({ task_id: taskId, base_resp: ok });
const refused = (code, status = 200, headers = {}) =>
  json({ base_resp: { status_code: code, status_msg: `upstream echo ${KEY_A} ${PROMPT}` } }, status, headers);
const task = (taskId, status, extra = {}) => json({ task_id: taskId, status, base_resp: ok, ...extra });
const succeeded = (taskId, fileId) => task(taskId, "Success", { file_id: fileId, video_width: 1366, video_height: 768 });
const file = (fileId, url) => json({ file: { file_id: fileId, filename: "out.mp4", download_url: url }, base_resp: ok });
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
const video = (body = {}, { model = "MiniMax-Hailuo-02", credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createMinimaxVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain(PROMPT);
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
  it("stays unregistered and leaves the existing minimax entry unchanged", () => {
    expect(getVideoGenerationAdapter("minimax")).toBeNull();
    expect(minimaxRegistry.models.some((m) => m.id === "T2V-01-Director")).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.MINIMAX_PROVIDER_ID).toBe("minimax");
    expect(staged.MINIMAX_VIDEO_CREATE_URL).toBe(CREATE);
    expect(staged.MINIMAX_VIDEO_QUERY_URL).toBe(QUERY);
    expect(staged.MINIMAX_FILES_RETRIEVE_URL).toBe(FILES);
    expect(staged.MINIMAX_AUTH_HEADER).toBe("Authorization");
    expect(staged.MINIMAX_AUTH_SCHEME).toBe("Bearer");
    expect(staged.MINIMAX_VIDEO_FORMAT).toBe("minimax-video");
    expect(MINIMAX_VIDEO_MODELS.map((m) => [m.id, m.name])).toEqual([
      ["MiniMax-Hailuo-2.3", "Hailuo 2.3"],
      ["MiniMax-Hailuo-02", "Hailuo 02"],
      ["T2V-01-Director", "T2V 01 Director"],
    ]);
    expect(staged.MINIMAX_JOB_TIMEOUT_MS).toBe(300_000);
    expect(staged.MINIMAX_POLL_INTERVAL_MS).toBe(5_000);
    expect(staged.MINIMAX_MAX_PROMPT_CHARS).toBe(2_000);
    expect(minimaxVideoAdapter.provider).toBe("minimax");
    expect(minimaxVideoAdapter.responseFormats).toEqual(["url"]);
    expect(minimaxVideoAdapter.async).toBe(true);
    expect(isFunction(minimaxVideoAdapter.generate)).toBe(true);
  });

  it("matches the existing provider identity, auth mode and v1 endpoints", () => {
    expect(minimaxRegistry.id).toBe(staged.MINIMAX_PROVIDER_ID);
    expect(minimaxRegistry.alias).toBe(staged.MINIMAX_ALIAS);
    expect(minimaxRegistry.category).toBe("apikey");
    expect(minimaxRegistry.serviceKinds).toContain("video");
    // The async /v1/videos proxy already reaches the same three endpoints.
    expect(minimaxRegistry.videoConfig.legacyCreateUrl).toBe(CREATE);
    expect(minimaxRegistry.videoConfig.legacyQueryUrl).toBe(QUERY);
    expect(minimaxRegistry.videoConfig.legacyFileRetrieveUrl).toBe(FILES);
    for (const id of ["MiniMax-Hailuo-2.3", "MiniMax-Hailuo-02"]) {
      expect(minimaxRegistry.models.find((m) => m.id === id)?.kind).toBe("video");
      expect(minimaxRegistry.videoConfig.legacyT2vConstraints[id]).toEqual(staged.minimaxVideoModel(id).textToVideo);
      expect(minimaxRegistry.videoConfig.legacyI2vConstraints[id]).toEqual(staged.minimaxVideoModel(id).imageToVideo);
    }
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.provider.canonicalId).toBe("minimax");
    expect(REGISTRATION.provider.aliases).toEqual(["minimax"]);
    expect(REGISTRATION.provider.authModes).toEqual(["apikey"]);
    expect(REGISTRATION.provider.auth).toEqual({ header: "Authorization", scheme: "Bearer", credentialFields: ["apiKey", "accessToken"] });
    expect(REGISTRATION.models.video.map((m) => m.id)).toEqual(MINIMAX_VIDEO_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.submit.url).toBe(CREATE);
    expect(REGISTRATION.endpoints.status.url).toBe(`${QUERY}?task_id={task_id}`);
    expect(REGISTRATION.endpoints.file.url).toBe(`${FILES}?file_id={file_id}`);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("video request contract", () => {
  it("creates with a Bearer key, polls the query endpoint and resolves the file", async () => {
    serve(created("t-1"), task("t-1", "Preparing"), task("t-1", "Queueing"), task("t-1", "Processing"), succeeded("t-1", "f-1"), file("f-1", OUT_A));
    const result = await video({ duration: 6, resolution: "1080p", prompt_optimizer: false, fast_pretreatment: true });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(CREATE);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(calls[0].body).toEqual({
      model: "MiniMax-Hailuo-02", prompt: PROMPT, duration: 6, resolution: "1080P", prompt_optimizer: false, fast_pretreatment: true,
    });
    expect(calls[1].url).toBe(`${QUERY}?task_id=t-1`);
    expect(calls[1].init.method).toBe("GET");
    expect(calls[1].init.redirect).toBe("manual");
    expect(calls[1].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(calls[5].url).toBe(`${FILES}?file_id=f-1`);
    expect(calls[5].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(calls).toHaveLength(6);
    expect(await payload(result)).toEqual({ created: Math.floor(clock / 1000), data: [{ url: OUT_A, format: "mp4" }] });
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
    expect(result.accounting.costStatus).toBe("unknown");
    expect(result.accounting.meta).toMatchObject({ jobId: "t-1", fileId: "f-1", nativeUnitsSource: "returned-videos" });
  });

  it("sends only model and prompt when nothing optional is given, and accepts numeric ids", async () => {
    serve(json({ task_id: 106916112212032, base_resp: ok }), task(106916112212032, "success", { file_id: 205258526306433 }), file(205258526306433, OUT_B));
    const result = await video({}, { model: "T2V-01-Director" });
    expect(calls[0].body).toEqual({ model: "T2V-01-Director", prompt: PROMPT });
    expect(calls[1].url).toBe(`${QUERY}?task_id=106916112212032`);
    expect(calls[2].url).toBe(`${FILES}?file_id=205258526306433`);
    expect((await payload(result)).data[0].url).toBe(OUT_B);
  });

  it("maps the first frame aliases to first_frame_image for image-to-video models", async () => {
    for (const field of ["first_frame_image", "image_url", "image"]) {
      calls = [];
      serve(created("t"), succeeded("t", "f"), file("f", OUT_A));
      const result = await video({ [field]: " https://img.example.com/a.png ", duration: 10, resolution: "512P" });
      expect(result.success).toBe(true);
      expect(calls[0].body).toEqual({ model: "MiniMax-Hailuo-02", prompt: PROMPT, duration: 10, resolution: "512P", first_frame_image: "https://img.example.com/a.png" });
    }
    expect(buildMinimaxVideoRequest("MiniMax-Hailuo-2.3", { prompt: "x", image: "data:image/png;base64,AAAA", seconds: "6" }))
      .toEqual({ model: "MiniMax-Hailuo-2.3", prompt: "x", duration: 6, first_frame_image: "data:image/png;base64,AAAA" });
  });

  it("reads timeout_ms and poll_interval_ms with the source ceilings and never forwards them", async () => {
    expect(resolveMinimaxTiming({})).toEqual({ timeoutMs: 300_000, pollIntervalMs: 5_000 });
    expect(resolveMinimaxTiming({ timeout_ms: 9e9, poll_interval_ms: 9e9 })).toEqual({ timeoutMs: 600_000, pollIntervalMs: 120_000 });
    expect(resolveMinimaxTiming({ timeout_ms: 5_000, poll_interval_ms: 1 })).toEqual({ timeoutMs: 5_000, pollIntervalMs: 1_000 });
    const waits = [];
    serve(created("t"), succeeded("t", "f"), file("f", OUT_A));
    const result = await createMinimaxVideoAdapter({ wait: async (ms) => { waits.push(ms); clock += ms; }, now: () => clock })
      .generate({ model: "MiniMax-Hailuo-02", body: { prompt: PROMPT, poll_interval_ms: 4_000, timeout_ms: 60_000 }, credentials: { apiKey: KEY_A } });
    expect(result.success).toBe(true);
    expect(waits).toEqual([4_000]);
    expect(calls[0].body).toEqual({ model: "MiniMax-Hailuo-02", prompt: PROMPT });
  });

  it.each([
    [{ prompt: "" }, /requires a prompt/],
    [{ prompt: 42 }, /requires a prompt/],
    [{ prompt: "x".repeat(2_001) }, /2000 characters/],
    [{ n: 2 }, /n=1/],
    [{ stream: true }, /streaming/],
    [{ response_format: "b64_json" }, /url only/],
    [{ callback_url: "https://hook.example.com" }, /does not support callback_url/],
    [{ aspect_ratio: "16:9" }, /does not support aspect_ratio/],
    [{ size: "1280x720" }, /does not support size/],
    [{ duration: 5 }, /duration must be one of: 6, 10/],
    [{ duration: 6.5 }, /whole number/],
    [{ duration: 6, seconds: 10 }, /disagree/],
    [{ resolution: "720P" }, /resolution must be one of: 768P, 1080P/],
    [{ duration: 10, resolution: "1080P" }, /at 10s resolution must be one of: 768P/],
    [{ resolution: 768 }, /resolution must be one of/],
    [{ prompt_optimizer: "yes" }, /prompt_optimizer must be true or false/],
    [{ first_frame_image: "http://img.example.com/a.png" }, /public https URL/],
    [{ first_frame_image: "https://127.0.0.1/a.png" }, /public https URL/],
    [{ first_frame_image: "https://169.254.169.254/latest" }, /public https URL/],
    [{ first_frame_image: "https://u:p@img.example.com/a.png" }, /public https URL/],
    [{ first_frame_image: "data:text/html;base64,AAAA" }, /data URL/],
    [{ first_frame_image: "https://img.example.com/a.png", image: "https://img.example.com/b.png" }, /disagree/],
    [{ first_frame_image: 7 }, /non-empty string/],
    [{ timeout_ms: -1 }, /timeout_ms/],
    [{ poll_interval_ms: "fast" }, /poll_interval_ms/],
  ])("refuses %j before submit", async (extra, message) => {
    const result = await video(extra);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses model-specific combinations the model does not offer", async () => {
    const director = await video({ first_frame_image: "https://img.example.com/a.png" }, { model: "T2V-01-Director" });
    expect(await errorMessage(director)).toMatch(/text-to-video only/);
    const directorRes = await video({ resolution: "768P" }, { model: "T2V-01-Director" });
    expect(await errorMessage(directorRes)).toMatch(/720P/);
    const directorLong = await video({ duration: 10 }, { model: "T2V-01-Director" });
    expect(await errorMessage(directorLong)).toMatch(/duration must be one of: 6/);
    const i2v512 = await video({ first_frame_image: "https://img.example.com/a.png", resolution: "512P" }, { model: "MiniMax-Hailuo-2.3" });
    expect(await errorMessage(i2v512)).toMatch(/768P, 1080P/);
    expect(calls).toHaveLength(0);
  });

  it("refuses unknown models and a missing or unsafe key before submit", async () => {
    expect((await video({}, { model: "MiniMax-Hailuo-2.3-Fast" })).status).toBe(400);
    expect((await video({}, { model: "MiniMax-H3" })).status).toBe(400);
    expect((await video({}, { credentials: { apiKey: "" } })).status).toBe(401);
    expect((await video({}, { credentials: {} })).status).toBe(401);
    expect((await video({}, { credentials: { apiKey: "a\r\nX-Injected: 1" } })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("falls back to accessToken as the source did", async () => {
    serve(created("t"), succeeded("t", "f"), file("f", OUT_A));
    const result = await video({}, { credentials: { accessToken: KEY_B } });
    expect(result.success).toBe(true);
    for (const call of calls) expect(call.init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
  });
});

describe("task outcomes", () => {
  it("reports a failed task as an ordinary failure without leaking the reason", async () => {
    for (const status of ["Fail", "failed"]) {
      serve(created("t1"), json({ task_id: "t1", status, base_resp: { status_code: 1027, status_msg: `upstream echo ${KEY_A}` } }));
      const result = await video();
      expect(result.status).toBe(502);
      expect(result.acceptedJob).toBeUndefined();
      expect(await errorMessage(result)).toContain("code 1027");
      await assertNoLeak(result);
    }
  });

  it.each([
    ["succeeded without file_id", () => task("t1", "Success")],
    ["an unsafe file_id", () => succeeded("t1", "../../etc/passwd")],
    ["another task's answer", () => succeeded("t2", "f")],
    ["no status", () => json({ task_id: "t1", base_resp: ok })],
    ["a non-zero base_resp", () => json({ task_id: "t1", status: "Processing", base_resp: { status_code: 1000, status_msg: `upstream echo ${KEY_A}` } })],
    ["a malformed base_resp", () => json({ task_id: "t1", status: "Processing", base_resp: "oops" })],
    ["an unreadable body", () => new Response(`<html>${KEY_A}`, { status: 200 })],
    ["a status 500", () => refused(1000, 500)],
    ["a redirect", () => new Response(null, { status: 302, headers: { location: "https://evil.example" } })],
  ])("keeps an accepted task with %s as acceptedJob and never resubmits", async (_name, answer) => {
    serve(created("t1"), answer());
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(result.acceptedJob.meta.jobId).toBe("t1");
    expect(result.acceptedJob.costSource).toBe("accepted-job");
    expect(result.acceptedJob.costStatus).toBe("unknown");
    expect(result.acceptedJob.modality).toBe("video");
    expect(posts()).toHaveLength(1);
    await assertNoLeak(result);
  });

  it.each([
    ["no file", () => json({ base_resp: ok })],
    ["no download_url", () => json({ file: { file_id: "f" }, base_resp: ok })],
    ["another file's answer", () => file("g", OUT_A)],
    ["a refusal code", () => refused(1004)],
    ["a metadata download URL", () => file("f", "https://169.254.169.254/latest")],
    ["a loopback download URL", () => file("f", "https://127.0.0.1/x.mp4")],
    ["a plain http download URL", () => file("f", "http://cdn.example.com/x.mp4")],
    ["a download URL with userinfo", () => file("f", "https://u:p@cdn.example.com/x.mp4")],
    ["a data URL", () => file("f", "data:video/mp4;base64,AAAA")],
    ["a status 404", () => refused(1000, 404)],
    ["a redirect", () => new Response(null, { status: 301, headers: { location: "https://evil.example" } })],
  ])("keeps a succeeded task whose file lookup has %s as acceptedJob", async (_name, answer) => {
    serve(created("t1"), succeeded("t1", "f"), answer());
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(posts()).toHaveLength(1);
    expect(calls).toHaveLength(3);
    await assertNoLeak(result);
  });

  it("passes an auth refusal on the file lookup with its status", async () => {
    serve(created("t1"), succeeded("t1", "f"), refused(1004));
    const result = await video();
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("retries 429/503 and code 1002 a bounded number of times on query and file lookup", async () => {
    serve(created("t1"), json({}, 429, { "retry-after": "2" }), json({}, 503), refused(1002), succeeded("t1", "f"), json({}, 503), file("f", OUT_A));
    const result = await video();
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(7);

    calls = [];
    serve(created("t1"), ...Array.from({ length: 6 }, () => json({}, 429)));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(7);
    expect(posts()).toHaveLength(1);

    calls = [];
    serve(created("t1"), ...Array.from({ length: 6 }, () => refused(1002)));
    const coded = await video();
    expect(coded.status).toBe(429);
    expect(coded.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(7);
  });

  it("stops at the job deadline with an unknown outcome", async () => {
    serve(created("t1"), task("t1", "Processing"));
    const result = await video({}, { options: { timeoutMs: 1_500 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("bounds a hanging status check", async () => {
    let seen;
    serve(created("t1"), (_url, init) => new Promise(() => { seen = init.signal; }));
    const result = await video({}, { options: { requestTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(seen.aborted).toBe(true);
  });

  it("passes a rejected status check's auth status on with acceptedJob", async () => {
    serve(created("t1"), refused(1004, 401));
    const result = await video();
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(result);
  });

  it("maps HTTP submit refusals, quota and rate limits without leaking", async () => {
    serve(refused(1008, 402));
    const quota = await video();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    expect(quota.acceptedJob).toBeUndefined();
    await assertNoLeak(quota);

    serve(refused(0, 401));
    const auth = await video();
    expect(auth.status).toBe(401);
    expect(auth.acceptedJob).toBeUndefined();
    await assertNoLeak(auth);

    serve(refused(0, 429, { "retry-after": "30" }));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob).toBeUndefined();
    await assertNoLeak(limited);

    serve(refused(2013, 400));
    const bad = await video();
    expect(bad.status).toBe(400);
    expect(await errorMessage(bad)).toContain("code 2013");
    expect(bad.acceptedJob).toBeUndefined();
    await assertNoLeak(bad);

    serve(refused(1000, 502));
    const unknown = await video();
    expect(unknown.status).toBe(502);
    expect(unknown.acceptedJob.meta.jobState).toBe("submit-unknown");
    await assertNoLeak(unknown);
    expect(calls).toHaveLength(5);
  });

  it.each([
    [1004, 401, false],
    [2049, 401, false],
    [1008, 402, true],
    [1002, 429, false],
    [1039, 429, false],
    [1026, 400, false],
    [2013, 400, false],
  ])("maps HTTP 200 create base_resp %i to %i without acceptedJob", async (code, status, quota) => {
    serve(refused(code));
    const result = await video();
    expect(result.status).toBe(status);
    expect(Boolean(result.quotaExhausted)).toBe(quota);
    expect(result.acceptedJob).toBeUndefined();
    expect(await errorMessage(result)).toContain(`code ${code}`);
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("treats an unknown HTTP 200 create base_resp code as submit-unknown", async () => {
    serve(refused(1000));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("refuses a submit redirect without following it", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats an answer from another origin as submit-unknown", async () => {
    const foreign = created("t1");
    Object.defineProperty(foreign, "url", { value: "https://evil.example/v1/video_generation" });
    serve(foreign);
    const result = await video();
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("treats a submit without a usable task id as accepted work", async () => {
    serve(json({ base_resp: ok }));
    const missing = await video();
    expect(missing.acceptedJob.meta.jobState).toBe("accepted");
    serve(json({ task_id: "../../etc/passwd", base_resp: ok }));
    const unsafe = await video();
    expect(unsafe.acceptedJob.meta.jobState).toBe("accepted");
    serve(new Response(`not json ${KEY_A}`, { status: 200 }));
    const unreadable = await video();
    expect(unreadable.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(unreadable);
    serve(json({ task_id: "t1", base_resp: { status_code: "x" } }));
    const malformed = await video();
    expect(malformed.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(4);
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
    serve(created("t1"), () => { controller.abort(); return task("t1", "Processing"); });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("aborts an in-flight status socket on the caller's signal", async () => {
    const controller = new AbortController();
    let seen;
    serve(created("t1"), (_url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(seen.aborted).toBe(true);
  });

  it("aborts an in-flight file lookup on the caller's signal", async () => {
    const controller = new AbortController();
    let seen;
    serve(created("t1"), succeeded("t1", "f"), (_url, init) => { seen = init.signal; setTimeout(() => controller.abort(), 5); return new Promise(() => {}); });
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

  it("keeps two connections' keys, tasks and files apart", async () => {
    const tag = (init) => (init.headers.Authorization === `Bearer ${KEY_A}` ? "a" : "b");
    const respond = (url, init) => {
      const who = tag(init);
      if (url === CREATE) return created(`t${who}`);
      if (url.startsWith(QUERY)) {
        expect(url).toBe(`${QUERY}?task_id=t${who}`);
        return succeeded(`t${who}`, `f${who}`);
      }
      expect(url).toBe(`${FILES}?file_id=f${who}`);
      return file(`f${who}`, who === "a" ? OUT_A : OUT_B);
    };
    serve(...Array.from({ length: 6 }, () => respond));
    const [a, b] = await Promise.all([video({}, { credentials: { apiKey: KEY_A } }), video({}, { credentials: { apiKey: KEY_B } })]);
    expect((await payload(a)).data[0].url).toBe(OUT_A);
    expect((await payload(b)).data[0].url).toBe(OUT_B);
    expect(a.accounting.meta).toMatchObject({ jobId: "ta", fileId: "fa" });
    expect(b.accounting.meta).toMatchObject({ jobId: "tb", fileId: "fb" });
    expect(calls).toHaveLength(6);
  });

  it("ignores a connection base URL and only talks to the fixed origin", async () => {
    serve(created("t1"), succeeded("t1", "f"), file("f", OUT_A));
    const result = await video({}, { credentials: { apiKey: KEY_A, baseUrl: "https://evil.example", providerSpecificData: { baseUrl: "https://evil.example" } } });
    expect(result.success).toBe(true);
    for (const call of calls) expect(new URL(call.url).origin).toBe(ORIGIN);
  });
});
