// RenderHour video and speech, staged. Closed mocks only: every request is answered
// below, an unexpected URL fails the test, and every key is synthetic. Passing here
// says nothing about the live service or about what a real account may use.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const staged = vi.hoisted(() => ({ tts: null }));

// While staged, TTS_ADAPTERS does not know this provider, so the speech core tests substitute that one lookup.
vi.mock("../../open-sse/handlers/ttsProviders/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getTtsAdapter: (id) => (id === "renderhour" && staged.tts ? staged.tts : actual.getTtsAdapter(id)),
  };
});

import provider, {
  RENDERHOUR_GENERATIONS_URL,
  RENDERHOUR_IMAGE_MODEL_IDS,
  RENDERHOUR_MODELS_BY_TASK,
  RENDERHOUR_SPEECH_MODEL_IDS,
  RENDERHOUR_STAGED_MEDIA,
  RENDERHOUR_VIDEO_MODEL_IDS,
  renderHourTaskOf,
} from "../../open-sse/providers/private/renderhour.js";
import * as job from "../../open-sse/services/renderhour/job.js";
import { discoverRenderHourModels } from "../../open-sse/services/renderhour/media.js";
import renderHourVideo, { buildRenderHourVideoRequest, createRenderHourVideoAdapter } from "../../open-sse/handlers/videoProviders/renderhour.js";
import renderHourTts, { createRenderHourTtsAdapter } from "../../open-sse/handlers/ttsProviders/renderhour.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { getVideoConfig } from "../../open-sse/handlers/videoCore.js";
import { resolveCredentialProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { hasSpecializedExecutor } from "../../open-sse/executors/index.js";

const KEY_A = "rh_synthetic_account_a";
const KEY_B = "rh_synthetic_account_b";
const VIDEO_A = "https://renderhour.com/files/v1";
const VIDEO_B = "https://renderhour.com/files/v2";
const AUDIO_A = "https://files.renderhour.com/a1";
const AUDIO_B = "https://files.renderhour.com/a2";
const AUDIO_BYTES = new Uint8Array(2048).map((_, index) => index % 251);

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const audio = (bytes = AUDIO_BYTES, status = 200) => new Response(bytes, { status, headers: { "content-type": "audio/mpeg" } });
const mp4 = (url = VIDEO_A) => ({ asset_id: "asset-v", content_type: "video/mp4", url });
const mp3 = (url = AUDIO_A) => ({ asset_id: "asset-a", content_type: "audio/mpeg", url });
const queued = (id = "job-1") => ({ id, status: "queued", outputs: [] });
const running = (id = "job-1") => ({ id, status: "running", outputs: [] });
const done = (outputs, id = "job-1") => ({ id, status: "succeeded", outputs });
const failed = (reason, id = "job-1") => ({ id, status: "failed", failure_reason: reason, outputs: [] });

const originalFetch = global.fetch;
let calls;

// Answers requests in order. A step is a Response or a function of the request.
function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return typeof step === "function" ? step(String(url), init) : step;
  });
}

// A virtual clock: waits are recorded and advance time without sleeping.
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

let video;
let tts;
let virtual;
function useAdapters(options = {}) {
  virtual = clock();
  video = createRenderHourVideoAdapter({ wait: virtual.wait, now: virtual.now, ...options });
  tts = createRenderHourTtsAdapter({ wait: virtual.wait, now: virtual.now, ...options });
  staged.tts = tts;
}

const runVideo = ({ body = {}, key = KEY_A, credentials = { apiKey: key }, model = "seedance-2.5", ...options } = {}) =>
  video.generate({ model, body: { prompt: "a fox running through snow", ...body }, credentials, log: null, ...options });

const runSpeech = ({ input = "Hello from the gate.", key = KEY_A, credentials = { apiKey: key }, model = "eleven-v4", ...options } = {}) =>
  tts.synthesize(input, model, credentials, "mp3", options);

const runSpeechCore = ({ input = "Hello from the gate.", key = KEY_A, model = "eleven-v4", ...options } = {}) =>
  handleTtsCore({ provider: "renderhour", model, input, credentials: { apiKey: key }, responseFormat: "mp3", ...options });

const submits = () => calls.filter((call) => call.init.method === "POST");

function expectAccepted(result, modality, jobState = "accepted") {
  expect(result.success).toBe(false);
  expect(result.acceptedJob).toMatchObject({
    modality, cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState },
  });
}

beforeEach(() => {
  calls = [];
  useAdapters();
});
afterEach(() => {
  global.fetch = originalFetch;
  staged.tts = null;
});

describe("renderhour media staging", () => {
  it("keeps the staged default export image-only and stages video and speech beside it", () => {
    expect(provider).toMatchObject({ id: "renderhour", authType: "apikey", transport: null, serviceKinds: ["image"] });
    expect(provider).not.toHaveProperty("videoConfig");
    expect(provider).not.toHaveProperty("ttsConfig");
    expect(RENDERHOUR_VIDEO_MODEL_IDS).toHaveLength(16);
    expect(RENDERHOUR_SPEECH_MODEL_IDS).toEqual(["eleven-v4", "eleven-v4-turbo", "minimax-speech-2.8-hd"]);
    expect(RENDERHOUR_STAGED_MEDIA.serviceKinds).toEqual(["image", "video", "tts"]);
    expect(RENDERHOUR_STAGED_MEDIA.models).toHaveLength(11 + 16 + 3);
    expect(RENDERHOUR_STAGED_MEDIA).not.toHaveProperty("videoConfig");
    expect(RENDERHOUR_STAGED_MEDIA).not.toHaveProperty("ttsConfig");
  });

  it("gives every model id exactly one task", () => {
    const all = Object.values(RENDERHOUR_MODELS_BY_TASK).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const id of RENDERHOUR_IMAGE_MODEL_IDS) expect(renderHourTaskOf(id)).toBe("image");
    for (const id of RENDERHOUR_VIDEO_MODEL_IDS) expect(renderHourTaskOf(id)).toBe("video");
    for (const id of RENDERHOUR_SPEECH_MODEL_IDS) expect(renderHourTaskOf(id)).toBe("speech");
    expect(renderHourTaskOf("gpt-4o")).toBeNull();
  });

  it("is not reachable through the registry, the media maps, the video proxy or a chat executor", async () => {
    const actual = await vi.importActual("../../open-sse/handlers/ttsProviders/index.js");
    expect(actual.getTtsAdapter("renderhour")).toBeNull();
    expect(getVideoConfig("renderhour")).toBeNull();
    expect(PROVIDER_MEDIA.renderhour).toBeUndefined();
    expect(REGISTRY.some((entry) => entry.id === "renderhour")).toBe(false);
    expect(hasSpecializedExecutor("renderhour")).toBe(false);
  });

  it("ships the pinned video and speech poll bounds", () => {
    expect(job.RENDERHOUR_VIDEO_POLL_INTERVAL_MS).toBe(5_000);
    expect(job.RENDERHOUR_VIDEO_POLL_TIMEOUT_MS).toBe(900_000);
    expect(job.RENDERHOUR_SPEECH_POLL_INTERVAL_MS).toBe(2_000);
    expect(job.RENDERHOUR_SPEECH_POLL_TIMEOUT_MS).toBe(180_000);
    expect(renderHourVideo.async).toBe(true);
    expect(renderHourTts.async).toBe(true);
  });
});

describe("renderhour model discovery", () => {
  it("returns the static list for the selected key without any request", () => {
    serve();
    const result = discoverRenderHourModels({ apiKey: KEY_A });
    expect(result).toMatchObject({ success: true, source: "static", accountVerified: false });
    expect(result.data).toHaveLength(30);
    expect(result.data.find((model) => model.id === "veo-3.1")).toEqual({
      id: "veo-3.1", name: "Google Veo 3.1", kind: "video", task: "video", owned_by: "renderhour",
    });
    expect(calls).toHaveLength(0);
  });

  it.each([["video", 16], ["speech", 3], ["image", 11]])("filters by task %s", (task, count) => {
    const result = discoverRenderHourModels({ apiKey: KEY_A }, { task });
    expect(result.data).toHaveLength(count);
    expect(new Set(result.data.map((model) => model.task))).toEqual(new Set([task]));
  });

  it("refuses an unknown task and a missing or foreign key", () => {
    expect(discoverRenderHourModels({ apiKey: KEY_A }, { task: "chat" })).toMatchObject({ success: false, status: 400 });
    for (const credentials of [{}, { accessToken: "rh_synthetic_oauth" }, { apiKey: "sk-synthetic" }]) {
      const result = discoverRenderHourModels(credentials);
      expect(result).toMatchObject({ success: false, status: 401 });
      expect(result.error).not.toContain("synthetic");
    }
  });

  it("builds a separate result per account", () => {
    const a = discoverRenderHourModels({ apiKey: KEY_A });
    const b = discoverRenderHourModels({ apiKey: KEY_B });
    expect(a.data).toEqual(b.data);
    expect(a.data).not.toBe(b.data);
    a.data[0].name = "changed";
    expect(b.data[0].name).not.toBe("changed");
    expect(JSON.stringify(a)).not.toContain(KEY_A);
  });
});

describe("renderhour text-to-video success", () => {
  it("submits once, polls to success and returns video URLs with returned-video usage", async () => {
    serve(json(queued(), 201), json(running()), json(done([mp4()])));
    const result = await runVideo({ body: { seconds: "8s", size: "1280x720", resolution: "1080p", response_format: "b64_json" } });

    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.data).toEqual([{ url: VIDEO_A, format: "mp4" }]);
    expect(Number.isInteger(payload.created)).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      RENDERHOUR_GENERATIONS_URL, `${RENDERHOUR_GENERATIONS_URL}/job-1`, `${RENDERHOUR_GENERATIONS_URL}/job-1`,
    ]);
    const [submit, poll] = calls;
    expect(submit.init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(submit.init.headers).toMatchObject({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(submit.init.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(submit.init.body)).toEqual({
      model: "seedance-2.5", prompt: "a fox running through snow", duration_s: 8, aspect_ratio: "16:9", config: { resolution: "1080p" },
    });
    expect(poll.init).toMatchObject({ method: "GET", redirect: "error" });
    expect(poll.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, Accept: "application/json" });
    expect(virtual.waits).toEqual([5_000, 5_000]);
    expect(result.accounting).toMatchObject({
      state: "complete", modality: "video", tokens: {}, nativeUnits: { videos: 1 }, cost: null, costStatus: "unknown",
      meta: { nativeUnitsSource: "returned-videos" },
    });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("ignores undocumented receipts and keeps cost unknown", async () => {
    serve(json({ ...done([mp4(), { ...mp4(VIDEO_B), content_type: "video/webm" }]), usage: { cost_usd: 3 } }));
    const result = await runVideo();
    expect((await result.response.json()).data).toEqual([{ url: VIDEO_A, format: "mp4" }, { url: VIDEO_B, format: "webm" }]);
    expect(result.accounting).toMatchObject({ nativeUnits: { videos: 2 }, cost: null, costStatus: "unknown" });
    expect(calls).toHaveLength(1);
  });

  it("uses a new idempotency key for each request", async () => {
    serve(json(done([mp4()])), json(done([mp4()])));
    await runVideo();
    await runVideo();
    expect(calls[0].init.headers["Idempotency-Key"]).not.toBe(calls[1].init.headers["Idempotency-Key"]);
  });

  it.each([
    [{}, {}],
    [{ duration: 5 }, { duration_s: 5 }],
    [{ duration_s: "6" }, { duration_s: 6 }],
    [{ size: "720x1280" }, { aspect_ratio: "9:16" }],
    [{ size: "1024x1024" }, { aspect_ratio: "1:1" }],
    [{ aspect_ratio: "9:16", size: "1280x720" }, { aspect_ratio: "9:16" }],
    [{ quality: "hd", n: 3 }, {}],
    [{ mode: "pro", audio: true }, { config: { mode: "pro", audio: true } }],
    [{ resolution: "720p", config: { resolution: "1080p", duration_s: 10, seed: 4 } }, { config: { resolution: "1080p", duration_s: 10 } }],
  ])("maps %j onto the submit body", (body, expected) => {
    expect(buildRenderHourVideoRequest("kling-3.0", { prompt: "p", ...body })).toEqual({ model: "kling-3.0", prompt: "p", ...expected });
  });
});

describe("renderhour text-to-speech success", () => {
  it("submits text once, polls, downloads the file without the key and returns audio through the speech core", async () => {
    serve(json(queued(), 201), json(done([mp3()])), audio());
    const result = await runSpeechCore({ input: "  Hello from the gate.  ", voice: "alloy" });

    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toBe("audio/mp3");
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(AUDIO_BYTES);
    expect(calls.map((call) => call.url)).toEqual([RENDERHOUR_GENERATIONS_URL, `${RENDERHOUR_GENERATIONS_URL}/job-1`, AUDIO_A]);
    expect(JSON.parse(submits()[0].init.body)).toEqual({ model: "eleven-v4", text: "Hello from the gate." });
    const download = calls[2].init;
    expect(download).toMatchObject({ method: "GET", redirect: "error" });
    expect(download.headers).toBeUndefined();
    expect(JSON.stringify(download)).not.toContain(KEY_A);
    expect(virtual.waits).toEqual([2_000]);
    expect(result.accounting).toMatchObject({ modality: "tts", nativeUnits: { characters: 20 }, cost: null, costStatus: "unknown" });
    expect(result.acceptedJob).toBeUndefined();
  });

  it.each([["audio/wav", "wav"], ["audio/ogg", "ogg"], ["audio/flac", "flac"]])("reports %s audio as %s", async (type, format) => {
    serve(json(done([{ ...mp3(), content_type: type }])), audio());
    expect(await runSpeech()).toMatchObject({ format });
  });
});

describe("renderhour refusals before dispatch", () => {
  const BAD_KEYS = [
    ["no credential", {}],
    ["a subscription OAuth token", { accessToken: "rh_synthetic_oauth" }],
    ["a key without the rh_ prefix", { apiKey: "sk-synthetic" }],
    ["a key with a line break", { apiKey: "rh_synthetic\r\nX-Extra: 1" }],
  ];

  it.each(BAD_KEYS)("refuses video with %s with 401", async (_name, credentials) => {
    serve();
    const result = await runVideo({ credentials });
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(result.error).not.toContain("synthetic");
    expect(calls).toHaveLength(0);
  });

  it.each(BAD_KEYS)("refuses speech with %s with 401", async (_name, credentials) => {
    serve();
    const result = await runSpeech({ credentials });
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(result.error).not.toContain("synthetic");
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["z-image", /image model, not a video model/],
    ["eleven-v4", /speech model, not a video model/],
    ["gpt-4o", /Unsupported RenderHour video model/],
    ["../uploads", /Unsupported/],
  ])("refuses %s as a video model", async (model, message) => {
    serve();
    const result = await runVideo({ model });
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["seedance-2.5", /video model, not a speech model/],
    ["nano-banana-pro", /image model, not a speech model/],
    ["claude-sonnet-4", /Unsupported RenderHour speech model/],
    ["eleven-v4/rachel", /send the model id alone/],
  ])("refuses %s as a speech model", async (model, message) => {
    serve();
    const result = await runSpeech({ model });
    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses chat-shaped bodies for both tasks", async () => {
    serve();
    expect(await runVideo({ body: { messages: [{ role: "user", content: "hi" }] } })).toMatchObject({ status: 400, error: expect.stringMatching(/no chat/) });
    expect(await runSpeech({ messages: [] })).toMatchObject({ status: 400, error: expect.stringMatching(/no chat/) });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["no prompt", { prompt: "" }],
    ["a start frame", { image: "https://example.com/a.png" }],
    ["an end frame", { last_frame: "data:image/png;base64,AAAA" }],
    ["references", { reference_images: ["https://example.com/a.png"] }],
    ["an input reference", { input_reference: "https://example.com/a.png" }],
    ["an unsupported ratio", { aspect_ratio: "4:3" }],
    ["a negative duration", { duration: -4 }],
    ["an unreadable duration", { seconds: "long" }],
  ])("refuses a video request with %s", async (_name, body) => {
    serve();
    expect(await runVideo({ body })).toMatchObject({ success: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("refuses empty speech input", async () => {
    serve();
    expect(await runSpeech({ input: "   " })).toMatchObject({ success: false, status: 400 });
    expect(calls).toHaveLength(0);
  });
});

describe("renderhour media submit errors", () => {
  it.each([401, 403, 429])("keeps a refused video submit's %i, sends once and records no accepted job", async (status) => {
    serve(json({ error: { code: "refused", message: `refused for ${KEY_A}` } }, status));
    const result = await runVideo();
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toBeUndefined();
    expect(result.error).not.toContain(KEY_A);
    expect(JSON.stringify(await result.response.json())).not.toContain(KEY_A);
    expect(calls).toHaveLength(1);
  });

  it.each([401, 403, 429])("keeps a refused speech submit's %i through the speech core", async (status) => {
    serve(json({ error: { message: `refused for ${KEY_A}` } }, status));
    const result = await runSpeechCore();
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toBeUndefined();
    expect(result.error).not.toContain(KEY_A);
    expect(calls).toHaveLength(1);
  });

  it("replaces a 429 message", async () => {
    serve(json({ error: { message: "quota for account 42 exceeded" } }, 429));
    expect((await runVideo()).error).not.toContain("account 42");
  });

  it.each([
    ["seconds", () => "7"],
    ["an HTTP date", () => new Date(Date.now() + 9_000).toUTCString()],
  ])("passes a 429 Retry-After in %s to cooldown and to the client", async (_name, header) => {
    serve(json({ error: { message: "slow down" } }, 429, { "retry-after": header() }));
    const before = Date.now();
    const result = await runVideo();
    expect(result.status).toBe(429);
    expect(result.rateLimitEvidence).toMatchObject({ source: "retry_after" });
    expect(result.resetsAtMs).toBe(result.rateLimitEvidence.resetAtMs);
    expect(result.resetsAtMs).toBeGreaterThan(before + 5_000);
    expect(Number(result.response.headers.get("retry-after"))).toBeGreaterThanOrEqual(6);
  });

  it("claims no reset without Retry-After", async () => {
    serve(json({}, 429));
    const result = await runSpeech();
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBeUndefined();
    expect(result.response.headers.get("retry-after")).toBeNull();
  });

  it.each([
    ["a 302", () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/v1/generations" } })],
    ["an opaque redirect", () => ({ type: "opaqueredirect", status: 0, ok: false, body: null, headers: new Headers() })],
  ])("refuses %s on submit without following it or recording a job", async (_name, answer) => {
    serve(answer);
    const result = await runVideo();
    expect(result).toMatchObject({ success: false, status: 502, error: "renderhour video submit redirect refused" });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it.each(["ECONNREFUSED", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"])("treats a %s submit as unsent", async (code) => {
    serve(() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code } }); });
    const result = await runVideo();
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
  });

  it.each(["ECONNRESET", "UND_ERR_SOCKET"])("treats a %s submit as possibly accepted, never resubmitted", async (code) => {
    serve(() => { throw Object.assign(new TypeError(`fetch failed Bearer ${KEY_A}`), { cause: { code } }); });
    const result = await runSpeech();
    expectAccepted(result, "tts", "submit-unknown");
    expect(result).toMatchObject({ status: 502, error: "renderhour speech submit was interrupted; whether it was accepted is unknown" });
    expect(submits()).toHaveLength(1);
  });

  it("bounds a submit that never answers and records it as possibly accepted", async () => {
    useAdapters({ submitTimeoutMs: 20 });
    serve(() => new Promise(() => {}));
    const result = await runVideo();
    expectAccepted(result, "video", "submit-unknown");
    expect(result).toMatchObject({ status: 504, error: "renderhour video submit timed out; whether it was accepted is unknown" });
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("renderhour media failed jobs", () => {
  it.each([["moderation", 422], ["invalid_input", 422], ["timeout", 504], ["expired", 504]])(
    "maps a video failure reason %s to %i without an accepted job",
    async (reason, status) => {
      serve(json(queued()), json(failed(reason)));
      const result = await runVideo();
      expect(result).toMatchObject({ success: false, status, error: `RenderHour video job failed: ${reason}` });
      expect(result.acceptedJob).toBeUndefined();
      expect(calls).toHaveLength(2);
    }
  );

  it.each([KEY_A, "supplier exploded at /home/x", undefined])("never repeats an unrecognized speech reason %j", async (reason) => {
    serve(json(failed(reason)));
    const result = await runSpeech();
    expect(result).toMatchObject({ success: false, status: 502, error: "RenderHour speech job failed: unknown reason" });
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});

describe("renderhour media malformed jobs", () => {
  async function expectUnknown(run, modality, ...steps) {
    const expected = steps.length;
    serve(...steps);
    const result = await run();
    expectAccepted(result, modality);
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/^RenderHour /);
    expect(result.error).not.toContain("synthetic");
    expect(submits()).toHaveLength(1);
    expect(calls).toHaveLength(expected);
  }

  it.each([
    ["is not JSON", `<html>${KEY_A}`],
    ["has no id", JSON.stringify({ status: "queued" })],
    ["has a path in its id", JSON.stringify(queued("../uploads"))],
    ["has an unknown status", JSON.stringify({ id: "job-1", status: "paused" })],
  ])("treats a 2xx video submit that %s as accepted, and never polls", async (_name, body) => {
    await expectUnknown(() => runVideo(), "video", new Response(body, { status: 201 }));
  });

  it.each([
    ["an image", [{ content_type: "image/png", url: VIDEO_A }]],
    ["audio", [mp3(VIDEO_A)]],
    ["no outputs", []],
    ["a plain HTTP URL", [mp4("http://renderhour.com/files/v1")]],
    ["URL credentials", [mp4("https://user:synthetic@renderhour.com/files/v1")]],
    ["the key in its URL", [mp4(`https://renderhour.com/files/v1?k=${KEY_A}`)]],
    ["more than four files", Array.from({ length: 5 }, () => mp4())],
  ])("rejects a video success with %s", async (_name, outputs) => {
    await expectUnknown(() => runVideo(), "video", json(queued()), json(done(outputs)));
  });

  it.each([
    ["a video", [mp4(AUDIO_A)]],
    ["an image", [{ content_type: "image/png", url: AUDIO_A }]],
    ["the encoded key in its URL", [mp3(`${AUDIO_A}?k=${encodeURIComponent(KEY_A)}`)]],
  ])("rejects a speech success with %s and downloads nothing", async (_name, outputs) => {
    await expectUnknown(() => runSpeech(), "tts", json(done(outputs)));
  });

  it("stops on a status response about another job", async () => {
    await expectUnknown(() => runSpeech(), "tts", json(queued()), json(done([mp3()], "job-2")));
  });
});

describe("renderhour media poll errors and timeout", () => {
  it.each([401, 403])("passes poll status %i on as an accepted video job without resubmitting", async (status) => {
    serve(json(queued()), json({ error: { message: `refused ${KEY_A}` } }, status));
    const result = await runVideo();
    expectAccepted(result, "video");
    expect(result.status).toBe(status);
    expect(result.error).not.toContain(KEY_A);
    expect(submits()).toHaveLength(1);
  });

  it("backs off on 429 with Retry-After while polling speech, then succeeds", async () => {
    serve(json(queued()), json({}, 429, { "retry-after": "7" }), json({}, 503), json(done([mp3()])), audio());
    const result = await runSpeech();
    expect(result.format).toBe("mp3");
    expect(virtual.waits).toEqual([2_000, 7_000, 4_000]);
    expect(submits()).toHaveLength(1);
  });

  it("stops a video at its poll deadline and records an accepted job", async () => {
    useAdapters({ timeoutMs: 20_000 });
    serve(json(queued()), ...Array.from({ length: 4 }, () => () => json(running())));
    const result = await runVideo();
    expectAccepted(result, "video");
    expect(result).toMatchObject({ status: 504, error: "RenderHour video job did not finish in time" });
    expect(virtual.waits).toEqual([5_000, 5_000, 5_000, 5_000]);
    expect(submits()).toHaveLength(1);
  });
});

describe("renderhour speech file download", () => {
  it.each([
    ["off RenderHour's hosts", [mp3("https://cdn.example.com/a1")], []],
    ["refused", [mp3()], [audio(new Uint8Array(10), 404)]],
    ["empty", [mp3()], [audio(new Uint8Array(0))]],
    ["redirected", [mp3()], [() => { throw new TypeError("redirect mode is set to error"); }]],
  ])("keeps the accepted job when the file is %s", async (_name, outputs, download) => {
    serve(json(done(outputs)), ...download);
    const result = await runSpeech();
    expectAccepted(result, "tts");
    expect(result.status).toBe(502);
    expect(submits()).toHaveLength(1);
    expect(calls).toHaveLength(1 + download.length);
  });

  it("bounds the file size", async () => {
    useAdapters({ maxAudioBytes: 1_000 });
    serve(json(done([mp3()])), audio());
    const result = await runSpeech();
    expectAccepted(result, "tts");
    expect(result.error).toBe("RenderHour speech file was unreadable or too large");
  });

  it("bounds a download that never answers", async () => {
    useAdapters({ downloadTimeoutMs: 20 });
    serve(json(done([mp3()])), (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    const result = await runSpeech();
    expectAccepted(result, "tts");
    expect(result.status).toBe(504);
  });
});

describe("renderhour media cancellation", () => {
  it.each([["video", () => runVideo], ["speech", () => runSpeech]])(
    "sends nothing and claims no %s job when cancelled before the submit",
    async (_task, pick) => {
      const controller = new AbortController();
      controller.abort();
      serve();
      const result = await pick()({ signal: controller.signal });
      expect(result).toMatchObject({ success: false, status: 499 });
      expect(result.acceptedJob).toBeUndefined();
      expect(calls).toHaveLength(0);
    }
  );

  it("aborts an in-flight video submit at the transport and keeps the possibly accepted job", async () => {
    const controller = new AbortController();
    const reason = new Error("client left");
    serve((_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      controller.abort(reason);
    }));
    const result = await runVideo({ signal: controller.signal });
    expectAccepted(result, "video", "submit-unknown");
    expect(result.status).toBe(499);
    expect(calls[0].init.signal.reason).toBe(reason);
    expect(calls).toHaveLength(1);
  });

  it("stops polling a speech job on cancellation and keeps the accepted job", async () => {
    const controller = new AbortController();
    serve(json(queued()), () => {
      controller.abort();
      return json(done([mp3()]));
    });
    const result = await runSpeech({ signal: controller.signal });
    expectAccepted(result, "tts");
    expect(result.status).toBe(499);
    expect(calls).toHaveLength(2);
  });

  it("aborts the speech download and keeps the accepted job", async () => {
    const controller = new AbortController();
    serve(json(done([mp3()])), (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      controller.abort();
    }));
    const result = await runSpeech({ signal: controller.signal });
    expectAccepted(result, "tts");
    expect(result.status).toBe(499);
    expect(submits()).toHaveLength(1);
  });
});

describe("renderhour media account isolation", () => {
  const accounts = {
    [KEY_A]: { id: "job-a", video: VIDEO_A, audio: AUDIO_A, bytes: new Uint8Array(512).fill(1) },
    [KEY_B]: { id: "job-b", video: VIDEO_B, audio: AUDIO_B, bytes: new Uint8Array(512).fill(2) },
  };
  const credentialsFor = (key, port) => ({
    apiKey: key,
    providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: `http://127.0.0.1:${port}` },
  });
  const credentials = { [KEY_A]: credentialsFor(KEY_A, 9001), [KEY_B]: credentialsFor(KEY_B, 9002) };

  // Each key only ever sees its own job; any crossed key, id or file fails.
  function serveAccounts(kind, override = () => null) {
    const polls = { "job-a": 0, "job-b": 0 };
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      const file = Object.values(accounts).find((account) => account.audio === String(url));
      if (file) return audio(file.bytes);
      const account = accounts[init.headers.Authorization.replace("Bearer ", "")];
      if (!account) throw new Error("Unknown key");
      const forced = override(account, init);
      if (forced) return forced;
      if (init.method === "POST") return json(queued(account.id), 201);
      if (String(url) !== `${RENDERHOUR_GENERATIONS_URL}/${account.id}`) return json({}, 404);
      polls[account.id] += 1;
      const output = kind === "video" ? mp4(account.video) : mp3(account.audio);
      return json(polls[account.id] < (account.id === "job-a" ? 3 : 2) ? running(account.id) : done([output], account.id));
    });
  }

  it("keeps concurrent video keys, job ids, proxies and results apart", async () => {
    useAdapters({ pollIntervalMs: 1 });
    serveAccounts("video");
    const [a, b] = await Promise.all([runVideo({ credentials: credentials[KEY_A] }), runVideo({ credentials: credentials[KEY_B] })]);
    expect((await a.response.json()).data).toEqual([{ url: VIDEO_A, format: "mp4" }]);
    expect((await b.response.json()).data).toEqual([{ url: VIDEO_B, format: "mp4" }]);
    expect(a.accounting).not.toBe(b.accounting);
    for (const { url, init } of calls) {
      const key = url.endsWith("/job-a") ? KEY_A : url.endsWith("/job-b") ? KEY_B : init.headers.Authorization.slice(7);
      expect(init.headers.Authorization).toBe(`Bearer ${key}`);
      expect(init.proxyOptions).toEqual(resolveCredentialProxyOptions(credentials[key]));
    }
    expect(resolveCredentialProxyOptions(credentials[KEY_A])).not.toEqual(resolveCredentialProxyOptions(credentials[KEY_B]));
  });

  it("keeps concurrent speech jobs and their downloads apart", async () => {
    useAdapters({ pollIntervalMs: 1 });
    serveAccounts("speech");
    const [a, b] = await Promise.all([
      runSpeech({ credentials: credentials[KEY_A] }), runSpeech({ credentials: credentials[KEY_B] }),
    ]);
    expect(Buffer.from(a.base64, "base64")).toEqual(Buffer.from(accounts[KEY_A].bytes));
    expect(Buffer.from(b.base64, "base64")).toEqual(Buffer.from(accounts[KEY_B].bytes));
    for (const { url, init } of calls.filter((call) => call.url === AUDIO_A || call.url === AUDIO_B)) {
      const key = url === AUDIO_A ? KEY_A : KEY_B;
      expect(init.headers).toBeUndefined();
      expect(init.proxyOptions).toEqual(resolveCredentialProxyOptions(credentials[key]));
    }
  });

  it.each([401, 429])("does not let one account's submit %i affect the other", async (status) => {
    useAdapters({ pollIntervalMs: 1 });
    serveAccounts("video", (account, init) => (account.id === "job-a" && init.method === "POST" ? json({}, status) : null));
    const [a, b] = await Promise.all([runVideo({ key: KEY_A }), runVideo({ key: KEY_B })]);
    expect(a).toMatchObject({ success: false, status });
    expect(b.success).toBe(true);
  });

  it("does not let one account's cancellation stop the other", async () => {
    useAdapters({ pollIntervalMs: 1 });
    const controller = new AbortController();
    serveAccounts("speech", (account, init) => {
      if (account.id === "job-a" && init.method === "GET") controller.abort();
      return null;
    });
    const [a, b] = await Promise.all([runSpeech({ key: KEY_A, signal: controller.signal }), runSpeech({ key: KEY_B })]);
    expect(a.status).toBe(499);
    expect(b.format).toBe("mp3");
  });
});
