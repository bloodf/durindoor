// DashScope video credential variants (qwen-cloud, qwen-cloud-token-plan,
// bailian-coding-plan), staged and unregistered (#2034). Closed mocks only:
// every request is answered below, an unexpected request fails the test, and
// every key is synthetic. Wire shapes follow OmniRoute c71f0065
// (videoRegistry.ts entries for the three identities, videoGeneration.ts
// format dispatch and videoGeneration/dashscopeHandler.ts). Passing here says
// nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-dashscope-video/index.js";
import {
  DASHSCOPE_VIDEO_IDENTITIES,
  bailianCodingPlanVideoAdapter,
  buildDashscopeVariantVideoRequest,
  createDashscopeVariantVideoAdapter,
  qwenCloudTokenPlanVideoAdapter,
  qwenCloudVideoAdapter,
} from "../../open-sse/services/providerParity/native-dashscope-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import qwenCloudRegistry from "../../open-sse/providers/registry/qwen-cloud.js";
import qwenCloudTokenPlanRegistry from "../../open-sse/providers/registry/qwen-cloud-token-plan.js";
import bailianCodingPlanRegistry from "../../open-sse/providers/registry/bailian-coding-plan.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const PIN = "c71f0065a7efe9230ec23b96a12253b050c4d7ad";
const HOSTS = {
  "qwen-cloud": "https://dashscope-intl.aliyuncs.com",
  "qwen-cloud-token-plan": "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
  "bailian-coding-plan": "https://coding-intl.dashscope.aliyuncs.com",
};
const ALIASES = { "qwen-cloud": "qwc", "qwen-cloud-token-plan": "qct", "bailian-coding-plan": "bcp" };
const HAPPYHORSE = ["happyhorse-1.1-i2v", "happyhorse-1.1-t2v", "happyhorse-1.1-r2v"];
const MODELS = {
  "qwen-cloud": [
    ...HAPPYHORSE,
    "happyhorse-1.0-video-edit",
    "wan2.7-t2v",
    "wan2.7-i2v",
    "wan2.7-r2v-2026-06-12",
    "wan2.7-videoedit",
  ],
  "qwen-cloud-token-plan": HAPPYHORSE,
  "bailian-coding-plan": HAPPYHORSE,
};
const IDS = Object.keys(HOSTS);
const REGISTRIES = {
  "qwen-cloud": qwenCloudRegistry,
  "qwen-cloud-token-plan": qwenCloudTokenPlanRegistry,
  "bailian-coding-plan": bailianCodingPlanRegistry,
};
const submitUrl = (id) => `${HOSTS[id]}/api/v1/services/aigc/video-generation/video-synthesis`;
const taskUrl = (id, taskId) => `${HOSTS[id]}/api/v1/tasks/${taskId}`;

const KEY_A = "sk-SYNTHETIC-dashscope-key-a-0001";
const KEY_B = "sk-SYNTHETIC-dashscope-key-b-0002";
const PROMPT = "a lantern drifting over a quiet harbor";
const IMAGE = "https://public-media.example.com/frame.png";
const OUT_A = "https://dashscope-result.example.com/out-a.mp4?sig=1";
const OUT_B = "https://dashscope-result.example.com/out-b.mp4?sig=2";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-dashscope-video/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const accepted = (taskId) => json({ request_id: "req-1", output: { task_id: taskId, task_status: "PENDING" } });
const task = (taskId, status, extra = {}) => json({ request_id: "req-2", output: { task_id: taskId, task_status: status, ...extra } });
const succeeded = (taskId, url) => task(taskId, "SUCCEEDED", { video_url: url });
const refused = (status, code, headers = {}) =>
  json({ code, message: `upstream echo ${KEY_A} ${PROMPT}`, request_id: "req-x" }, status, headers);

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
const video = (provider, model, body = {}, { credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createDashscopeVariantVideoAdapter(provider, { ...polling(), ...options })
    .generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
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
const inputFor = (model) => (/-(i2v|r2v)(-|$)/.test(model) ? { image: IMAGE } :
  model.includes("edit") ? { video: "https://public-media.example.com/source.mp4" } : {});

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
  it("stays unregistered: no video adapter, video models or video kind for the three identities", () => {
    for (const id of IDS) {
      expect(getVideoGenerationAdapter(id)).toBeNull();
      expect(getVideoGenerationAdapter(ALIASES[id])).toBeNull();
      const registry = REGISTRIES[id];
      expect(registry.serviceKinds ?? []).not.toContain("video");
      expect(registry.videoConfig).toBeUndefined();
      expect((registry.models ?? []).some((m) => m.kind === "video")).toBe(false);
    }
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields for each identity", () => {
    expect(Object.keys(DASHSCOPE_VIDEO_IDENTITIES)).toEqual(IDS);
    for (const id of IDS) {
      const identity = DASHSCOPE_VIDEO_IDENTITIES[id];
      expect(identity).toMatchObject({
        id,
        alias: ALIASES[id],
        baseUrl: `${HOSTS[id]}/api/v1`,
        statusUrl: `${HOSTS[id]}/api/v1/tasks`,
        authType: "apikey",
        authHeader: "bearer",
        format: "dashscope-video",
      });
      expect(identity.models.map((m) => m.id)).toEqual(MODELS[id]);
      expect(Object.isFrozen(identity)).toBe(true);
    }
    expect(staged.DASHSCOPE_VIDEO_FORMAT).toBe("dashscope-video");
    expect(staged.DASHSCOPE_VIDEO_POLL_INTERVAL_MS).toBe(2_500);
    expect(staged.DASHSCOPE_VIDEO_TIMEOUT_MS).toBe(300_000);
    for (const [adapter, id] of [[qwenCloudVideoAdapter, "qwen-cloud"], [qwenCloudTokenPlanVideoAdapter, "qwen-cloud-token-plan"], [bailianCodingPlanVideoAdapter, "bailian-coding-plan"]]) {
      expect(adapter.provider).toBe(id);
      expect(adapter.async).toBe(true);
      expect(adapter.responseFormats).toEqual(["url"]);
      expect(adapter.models.map((m) => m.id)).toEqual(MODELS[id]);
      expect(isFunction(adapter.generate)).toBe(true);
    }
    expect(() => createDashscopeVariantVideoAdapter("alibaba")).toThrow();
  });

  it("matches the existing provider identities and API-key auth mode", () => {
    for (const id of IDS) {
      expect(REGISTRIES[id].id).toBe(id);
      expect(REGISTRIES[id].alias).toBe(ALIASES[id]);
      expect(REGISTRIES[id].category).toBe("apikey");
    }
  });

  it("describes the same ids, aliases, endpoints and models in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe(PIN);
    expect(REGISTRATION.source.files).toContain("open-sse/config/videoRegistry.ts");
    expect(REGISTRATION.source.files).toContain("open-sse/handlers/videoGeneration/dashscopeHandler.ts");
    expect(REGISTRATION.providers.map((p) => p.canonicalId)).toEqual(IDS);
    for (const entry of REGISTRATION.providers) {
      const id = entry.canonicalId;
      expect(entry.aliases).toEqual([ALIASES[id]]);
      expect(entry.endpoints.submit.url).toBe(submitUrl(id));
      expect(entry.endpoints.status.url).toBe(taskUrl(id, "{task_id}"));
      expect(entry.models.map((m) => m.id)).toEqual(MODELS[id]);
      expect(entry.connectionBaseUrlHonored).toBe(false);
    }
    for (const name of ["qwenCloudVideoAdapter", "qwenCloudTokenPlanVideoAdapter", "bailianCodingPlanVideoAdapter", "buildDashscopeVariantVideoRequest", "runDashscopeVariantVideoJob"]) {
      expect(Object.keys(REGISTRATION.exports)).toContain(name);
      expect(staged[name]).toBeDefined();
    }
  });
});

describe("per-identity protocol: exact URL, auth, body and model", () => {
  it.each(IDS)("%s: one Bearer submit to its own host, task polls, the URL, usage once", async (id) => {
    serve(accepted("task-1"), task("task-1", "RUNNING"), succeeded("task-1", OUT_A));
    const result = await video(id, "happyhorse-1.1-t2v", { resolution: "1080p", ratio: "16:9", duration: 5, seed: 7 });
    expect(result.success).toBe(true);
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", submitUrl(id)],
      ["GET", taskUrl(id, "task-1")],
      ["GET", taskUrl(id, "task-1")],
    ]);
    expect(calls[0].init.headers).toMatchObject({
      Authorization: `Bearer ${KEY_A}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    });
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].body).toEqual({
      model: "happyhorse-1.1-t2v",
      input: { prompt: PROMPT },
      parameters: { resolution: "1080P", ratio: "16:9", duration: 5, seed: 7 },
    });
    expect(calls[1].init.headers).toMatchObject({ Authorization: `Bearer ${KEY_A}` });
    expect(calls[1].init.redirect).toBe("error");
    expect(await payload(result)).toMatchObject({ data: [{ url: OUT_A, format: "mp4" }] });
    expect(result.accounting).toMatchObject({
      state: "complete",
      modality: "video",
      nativeUnits: { videos: 1 },
      cost: null,
      costStatus: "unknown",
      meta: { jobId: "task-1", nativeUnitsSource: "returned-videos" },
    });
    expect(result.acceptedJob).toBeUndefined();
    expect(posts()).toHaveLength(1);
  });

  it.each(IDS)("%s: image-to-video sends only the first frame and no ratio", async (id) => {
    serve(accepted("task-2"), succeeded("task-2", OUT_A));
    const result = await video(id, "happyhorse-1.1-i2v", { image: IMAGE, resolution: "720P" });
    expect(result.success).toBe(true);
    expect(calls[0].body).toEqual({
      model: "happyhorse-1.1-i2v",
      input: { prompt: PROMPT, media: [{ type: "first_frame", url: IMAGE }] },
      parameters: { resolution: "720P" },
    });
  });

  it.each(IDS)("%s: reference-to-video sends reference images", async (id) => {
    serve(accepted("task-3"), succeeded("task-3", OUT_A));
    const second = "https://public-media.example.com/second.png";
    const result = await video(id, "happyhorse-1.1-r2v", { reference_images: [IMAGE, second] });
    expect(result.success).toBe(true);
    expect(calls[0].body.input.media).toEqual([
      { type: "reference_image", url: IMAGE },
      { type: "reference_image", url: second },
    ]);
  });

  it("qwen-cloud undated wan2.7 ids keep their exact id on the wire", async () => {
    serve(accepted("t2v"), succeeded("t2v", OUT_A), accepted("i2v"), succeeded("i2v", OUT_B));
    const t2v = await video("qwen-cloud", "wan2.7-t2v", { ratio: "9:16", audio_url: "https://public-media.example.com/a.mp3" });
    const i2v = await video("qwen-cloud", "wan2.7-i2v", { image: IMAGE });
    expect(t2v.success).toBe(true);
    expect(i2v.success).toBe(true);
    expect(calls[0].body).toEqual({
      model: "wan2.7-t2v",
      input: { prompt: PROMPT, audio_url: "https://public-media.example.com/a.mp3" },
      parameters: { ratio: "9:16" },
    });
    expect(calls[2].body).toEqual({
      model: "wan2.7-i2v",
      input: { prompt: PROMPT, media: [{ type: "first_frame", url: IMAGE }] },
      parameters: {},
    });
    expect(JSON.stringify(calls.map((c) => c.body ?? null))).not.toMatch(/2026-0[46]-/);
  });

  it("qwen-cloud video edit and dated r2v follow the source builders", async () => {
    const source = "https://public-media.example.com/source.mp4";
    serve(accepted("e"), succeeded("e", OUT_A), accepted("r"), succeeded("r", OUT_B));
    await video("qwen-cloud", "wan2.7-videoedit", { video: source, image: IMAGE });
    await video("qwen-cloud", "wan2.7-r2v-2026-06-12", { reference_images: [IMAGE], reference_videos: [source] });
    expect(calls[0].body.model).toBe("wan2.7-videoedit");
    expect(calls[0].body.input.media).toEqual([{ type: "video", url: source }, { type: "reference_image", url: IMAGE }]);
    expect(calls[2].body.model).toBe("wan2.7-r2v-2026-06-12");
    expect(calls[2].body.input.media).toEqual([{ type: "reference_image", url: IMAGE }, { type: "reference_video", url: source }]);
  });

  it.each(IDS.flatMap((id) => MODELS[id].map((model) => [id, model])))("%s builds %s with the exact id", (id, model) => {
    const built = buildDashscopeVariantVideoRequest(id, model, { prompt: PROMPT, ...inputFor(model) });
    expect(built.model).toBe(model);
    expect(built.input.prompt).toBe(PROMPT);
  });
});

describe("model isolation between identities (refused before network)", () => {
  it.each([
    ["qwen-cloud-token-plan", "wan2.7-t2v"],
    ["qwen-cloud-token-plan", "happyhorse-1.0-video-edit"],
    ["bailian-coding-plan", "wan2.7-videoedit"],
    ["bailian-coding-plan", "wan2.7-r2v-2026-06-12"],
    ["qwen-cloud", "wan2.7-t2v-2026-06-12"],
    ["qwen-cloud", "wan2.7-i2v-2026-04-25"],
    ["qwen-cloud", "wan2.6-i2v-flash"],
    ["qwen-cloud", "qwc/happyhorse-1.1-t2v"],
    ["qwen-cloud", "qwen3.8-max"],
    ["qwen-cloud-token-plan", "qwen3.8-max"],
    ["bailian-coding-plan", "HappyHorse-1.1-T2V"],
  ])("%s refuses %s", async (id, model) => {
    const result = await video(id, model, { image: IMAGE });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toContain(`Unsupported ${id} video model`);
    expect(calls).toHaveLength(0);
    expect(result.acceptedJob).toBeUndefined();
  });
});

describe("two credentials stay isolated", () => {
  it("sends each connection's key only to its own identity's host", async () => {
    serve(
      (url) => (url === submitUrl("qwen-cloud") ? accepted("qa") : accepted("qb")),
      (url) => (url === submitUrl("qwen-cloud") ? accepted("qa") : accepted("qb")),
      (url) => (url.endsWith("/qa") ? succeeded("qa", OUT_A) : succeeded("qb", OUT_B)),
      (url) => (url.endsWith("/qa") ? succeeded("qa", OUT_A) : succeeded("qb", OUT_B)),
    );
    const [a, b] = await Promise.all([
      video("qwen-cloud", "happyhorse-1.1-t2v", {}, { credentials: { apiKey: KEY_A } }),
      video("qwen-cloud-token-plan", "happyhorse-1.1-t2v", {}, { credentials: { apiKey: KEY_B } }),
    ]);
    expect((await payload(a)).data[0].url).toBe(OUT_A);
    expect((await payload(b)).data[0].url).toBe(OUT_B);
    for (const call of calls) {
      const auth = call.init.headers.Authorization;
      if (call.url.startsWith(HOSTS["qwen-cloud"])) expect(auth).toBe(`Bearer ${KEY_A}`);
      else {
        expect(call.url.startsWith(HOSTS["qwen-cloud-token-plan"])).toBe(true);
        expect(auth).toBe(`Bearer ${KEY_B}`);
      }
    }
    expect(calls).toHaveLength(4);
  });

  it("uses only the selected connection's key per call on the same identity", async () => {
    serve(accepted("x1"), succeeded("x1", OUT_A), accepted("x2"), succeeded("x2", OUT_B));
    await video("bailian-coding-plan", "happyhorse-1.1-t2v", {}, { credentials: { apiKey: KEY_A } });
    await video("bailian-coding-plan", "happyhorse-1.1-t2v", {}, { credentials: { apiKey: KEY_B } });
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([
      `Bearer ${KEY_A}`, `Bearer ${KEY_A}`, `Bearer ${KEY_B}`, `Bearer ${KEY_B}`,
    ]);
  });

  it("falls back to accessToken only when no apiKey is present", async () => {
    serve(accepted("x3"), succeeded("x3", OUT_A));
    await video("qwen-cloud", "happyhorse-1.1-t2v", {}, { credentials: { accessToken: KEY_B } });
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
  });
});

describe("pre-bill input refusal (no request sent)", () => {
  it.each([
    ["no key", "qwen-cloud", "happyhorse-1.1-t2v", {}, { credentials: {} }, 401],
    ["a key with a newline", "qwen-cloud", "happyhorse-1.1-t2v", {}, { credentials: { apiKey: `${KEY_A}\nX: y` } }, 401],
    ["a china-beijing connection", "qwen-cloud", "happyhorse-1.1-t2v", {}, { credentials: { apiKey: KEY_A, providerSpecificData: { region: "china-beijing" } } }, 400],
    ["a token-plan china-beijing connection", "qwen-cloud-token-plan", "happyhorse-1.1-t2v", {}, { credentials: { apiKey: KEY_A, providerSpecificData: { region: "china-beijing" } } }, 400],
    ["a custom base URL", "bailian-coding-plan", "happyhorse-1.1-t2v", {}, { credentials: { apiKey: KEY_A, providerSpecificData: { baseUrl: "https://attacker.example.com/api/v1" } } }, 400],
    ["b64_json output", "qwen-cloud", "happyhorse-1.1-t2v", { response_format: "b64_json" }, {}, 400],
    ["two videos", "qwen-cloud", "happyhorse-1.1-t2v", { n: 2 }, {}, 400],
    ["no prompt", "qwen-cloud", "happyhorse-1.1-t2v", { prompt: "" }, {}, 400],
    ["a chat body", "qwen-cloud", "happyhorse-1.1-t2v", { messages: [{ role: "user", content: "hi" }] }, {}, 400],
    ["i2v without an image", "qwen-cloud-token-plan", "happyhorse-1.1-i2v", {}, {}, 400],
    ["an image for t2v", "bailian-coding-plan", "happyhorse-1.1-t2v", { image: IMAGE }, {}, 400],
    ["a private media host", "qwen-cloud", "wan2.7-i2v", { image: "https://127.0.0.1/a.png" }, {}, 400],
    ["an http media URL", "qwen-cloud", "wan2.7-i2v", { image: "http://public-media.example.com/a.png" }, {}, 400],
    ["a ratio for i2v", "qwen-cloud", "wan2.7-i2v", { image: IMAGE, ratio: "16:9" }, {}, 400],
    ["an unknown resolution", "qwen-cloud-token-plan", "happyhorse-1.1-t2v", { resolution: "480P" }, {}, 400],
    ["a raw parameters object", "bailian-coding-plan", "happyhorse-1.1-t2v", { parameters: { watermark: false } }, {}, 400],
  ])("refuses %s", async (_name, id, model, body, opts, status) => {
    const result = await video(id, model, body, opts);
    expect(result.success).toBe(false);
    expect(result.status).toBe(status);
    expect(calls).toHaveLength(0);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("names the requested undated id, not the builder sibling, in refusals", async () => {
    const result = await video("qwen-cloud", "wan2.7-i2v", {});
    expect(await errorMessage(result)).toBe("Image input is required for video model: wan2.7-i2v");
    const ratio = await video("qwen-cloud", "wan2.7-i2v", { image: IMAGE, ratio: "16:9" });
    expect(await errorMessage(ratio)).toContain("wan2.7-i2v takes its ratio");
    expect(await errorMessage(ratio)).not.toContain("2026-04-25");
    const label = await video("qwen-cloud-token-plan", "happyhorse-1.1-t2v", { resolution: "480P" });
    expect(await errorMessage(label)).toMatch(/^Qwen Cloud Token Plan video resolution/);
    expect(calls).toHaveLength(0);
  });

  it("accepts a global-sg connection region", async () => {
    serve(accepted("g"), succeeded("g", OUT_A));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v", {}, { credentials: { apiKey: KEY_A, providerSpecificData: { region: "global-sg" } } });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(submitUrl("qwen-cloud"));
  });
});

describe("submit refusals, quota and errors", () => {
  it("maps a refused key to 401 without leaking upstream text", async () => {
    serve(refused(401, "InvalidApiKey"));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.status).toBe(401);
    expect(await errorMessage(result)).toBe("Qwen Cloud refused the API key for video generation (InvalidApiKey)");
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
    expect(calls).toHaveLength(1);
  });

  it.each(["Arrearage", "AccessDenied.Unpurchased"])("maps %s to 402 quota exhaustion for this account only", async (code) => {
    serve(refused(400, code));
    const result = await video("qwen-cloud-token-plan", "happyhorse-1.1-t2v");
    expect(result.status).toBe(402);
    expect(result.quotaExhausted).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("maps 429 with Retry-After to a rate limit with a reset time", async () => {
    serve(refused(429, "Throttling.RateQuota", { "retry-after": "30" }));
    const before = Date.now();
    const result = await video("bailian-coding-plan", "happyhorse-1.1-t2v");
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBeGreaterThanOrEqual(before + 29_000);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("passes a 400 parameter refusal with a safe vendor code only", async () => {
    serve(refused(400, "InvalidParameter"));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toBe("Qwen Cloud refused the video request with 400 (InvalidParameter)");
    expect(result.acceptedJob).toBeUndefined();
  });

  it("drops an unsafe vendor code", async () => {
    serve(refused(400, `bad code ${KEY_A}`));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(await errorMessage(result)).toBe("Qwen Cloud refused the video request with 400");
    await assertNoLeak(result);
  });

  it("treats a 5xx submit as uncertain: acceptedJob, never resent", async () => {
    serve(refused(503, "ServiceUnavailable"));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", modality: "video", meta: { jobState: "submit-unknown" } });
    expect(posts()).toHaveLength(1);
  });

  it("treats an accepted response without a task id as uncertain", async () => {
    serve(json({ output: {} }));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(posts()).toHaveLength(1);
  });

  it("refuses a redirect without following it (nothing accepted)", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://elsewhere.example.com/" } }));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats a response from another origin as uncertain", async () => {
    const response = accepted("r1");
    Object.defineProperty(response, "url", { value: "https://elsewhere.example.com/api/v1/x" });
    serve(response);
    const result = await video("bailian-coding-plan", "happyhorse-1.1-t2v");
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("reports a pre-connect transport failure as unsent", async () => {
    serve(() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); });
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("reports a mid-flight transport failure as uncertain", async () => {
    serve(() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); });
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(posts()).toHaveLength(1);
  });
});

describe("task outcomes: accepted or uncertain work is never replayed", () => {
  it("a FAILED task is an ordinary failure with a safe code", async () => {
    serve(accepted("f1"), task("f1", "FAILED", { code: "DataInspectionFailed", message: `echo ${KEY_A}` }));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toBe("Qwen Cloud video task failed (DataInspectionFailed)");
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
    expect(posts()).toHaveLength(1);
  });

  it.each(["UNKNOWN_ERROR", "CANCELED", "SOMETHING_NEW"])("a %s task is an unknown outcome with acceptedJob", async (status) => {
    serve(accepted("u1"), task("u1", status));
    const result = await video("qwen-cloud-token-plan", "happyhorse-1.1-t2v");
    expect(result.success).toBe(false);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "accepted" } });
    expect(posts()).toHaveLength(1);
  });

  it("a status answer about another task is an unknown outcome", async () => {
    serve(accepted("mine"), task("other", "SUCCEEDED", { video_url: OUT_A }));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("retries 429/503 task checks only, never the submit", async () => {
    serve(accepted("p1"), new Response("", { status: 503 }), new Response("", { status: 429, headers: { "retry-after": "3" } }), succeeded("p1", OUT_A));
    const result = await video("bailian-coding-plan", "happyhorse-1.1-t2v");
    expect(result.success).toBe(true);
    expect(posts()).toHaveLength(1);
    expect(calls.filter((c) => c.init.method === "GET")).toHaveLength(3);
  });

  it("a persistent poll 401 is an unknown outcome passed as 401", async () => {
    serve(accepted("p2"), new Response("", { status: 401 }));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("the job deadline ends polling with 504 and acceptedJob", async () => {
    serve(accepted("d1"), task("d1", "RUNNING"), task("d1", "RUNNING"));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v", {}, { options: { timeoutMs: 2_500 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(posts()).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });
});

describe("abort, deadline and cancel", () => {
  it("an already aborted signal sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v", {}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("an abort while polling stops at once and records the accepted task", async () => {
    const controller = new AbortController();
    let waits = 0;
    serve(accepted("a1"), task("a1", "RUNNING"));
    const result = await video("qwen-cloud-token-plan", "happyhorse-1.1-t2v", {}, {
      signal: controller.signal,
      options: {
        wait: async (ms, signal) => {
          waits += 1;
          if (waits === 2) controller.abort();
          signal?.throwIfAborted();
          clock += ms;
        },
      },
    });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
    expect(posts()).toHaveLength(1);
  });

  it("an abort during the submit is uncertain and never resent", async () => {
    const controller = new AbortController();
    serve(() => {
      controller.abort();
      return new Promise(() => {});
    });
    const result = await video("bailian-coding-plan", "happyhorse-1.1-t2v", {}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(posts()).toHaveLength(1);
  });

  it("a submit that never answers times out as uncertain", async () => {
    serve(() => new Promise(() => {}));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v", {}, { options: { submitTimeoutMs: 20 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(posts()).toHaveLength(1);
  });

  it("never cancels a task upstream (the source has no cancel)", async () => {
    const controller = new AbortController();
    serve(accepted("c1"));
    await video("qwen-cloud", "happyhorse-1.1-t2v", {}, {
      signal: controller.signal,
      options: { wait: async () => { controller.abort(); controller.signal.throwIfAborted(); } },
    });
    expect(calls.map((c) => c.init.method)).toEqual(["POST"]);
    expect(calls.some((c) => /cancel/i.test(c.url))).toBe(false);
  });
});

describe("truthful usage and safe artifacts", () => {
  it("records usage under the identity that ran the job, once", async () => {
    for (const id of IDS) {
      serve(accepted(`u-${id}`), succeeded(`u-${id}`, OUT_A));
      const result = await video(id, "happyhorse-1.1-t2v");
      expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
      expect(result.accounting.meta.jobId).toBe(`u-${id}`);
      expect(result.accounting.tokens).toEqual({});
      expect(result.acceptedJob).toBeUndefined();
    }
    expect(staged.dashscopeVariantAcceptedJob("qwen-cloud", "accepted")).toMatchObject({ costSource: "accepted-job", cost: null, meta: { jobState: "accepted" } });
  });

  it("returns the result URL without fetching it", async () => {
    serve(accepted("s1"), succeeded("s1", OUT_A));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.success).toBe(true);
    expect(calls.some((c) => c.url === OUT_A)).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["an http URL", "http://dashscope-result.example.com/out.mp4"],
    ["a private host", "https://10.0.0.5/out.mp4"],
    ["a URL with userinfo", "https://user:pass@dashscope-result.example.com/out.mp4"],
    ["no URL", undefined],
  ])("an unusable result (%s) is an unknown outcome, not returned", async (_name, url) => {
    serve(accepted("s2"), task("s2", "SUCCEEDED", url ? { video_url: url } : {}));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    if (url) expect(await result.response.clone().text()).not.toContain(url);
  });

  it("an oversized or unreadable task body is an unknown outcome", async () => {
    serve(accepted("s3"), new Response("not json", { status: 200 }));
    const result = await video("qwen-cloud", "happyhorse-1.1-t2v");
    expect(result.success).toBe(false);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});
