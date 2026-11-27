// #2034 DashScope regional parity for the staged native image, video and
// speech adapters. Source: OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad
// src/shared/constants/alibabaProviderRegions.ts (region values, spellings,
// chat presets, media roots), open-sse/handlers/imageGeneration/providers/alibabaImage.ts,
// open-sse/handlers/videoGeneration/dashscopeHandler.ts (+ utils/pollBounds.ts)
// and open-sse/executors/dashscopeTts.ts. Every network call is mocked; the
// existing native-dashscope-{image,video,tts} suites keep the pinned contract.
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as image from "../../open-sse/services/providerParity/native-dashscope-image/index.js";
import * as video from "../../open-sse/services/providerParity/native-dashscope-video/index.js";
import * as tts from "../../open-sse/services/providerParity/native-dashscope-tts/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { isFunction, isString } from "../../src/shared/utils/typeChecks.js";

const KEY_A = "sk-SYNTHETIC-region-a-0001";
const KEY_B = "sk-SYNTHETIC-region-b-0002";
const PROMPT = "a quiet stone gate in a silver forest";
const IMAGE_OUT = "https://dashscope-result.example.com/out.png?sig=1";
const VIDEO_OUT = "https://dashscope-result.example.com/out.mp4?sig=1";
const AUDIO_URL = "https://dashscope-result.example.com/speech.mp3?sig=1";
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32, 1)]);

/** Source media roots (resolveAlibabaProviderMediaBaseUrl) minus /api/v1, per identity and region. */
const ORIGINS = {
  alibaba: { "global-sg": "https://dashscope-intl.aliyuncs.com", "china-beijing": "https://dashscope.aliyuncs.com" },
  "qwen-cloud": { "global-sg": "https://dashscope-intl.aliyuncs.com", "china-beijing": "https://dashscope.aliyuncs.com" },
  "qwen-cloud-token-plan": {
    "global-sg": "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    "china-beijing": "https://token-plan.cn-beijing.maas.aliyuncs.com",
  },
  "bailian-coding-plan": { "global-sg": "https://coding-intl.dashscope.aliyuncs.com", "china-beijing": "https://coding.dashscope.aliyuncs.com" },
};
const ALIASES = { alibaba: "ali", "qwen-cloud": "qwc", "qwen-cloud-token-plan": "qct", "bailian-coding-plan": "bcp" };
const REGIONS = ["global-sg", "china-beijing"];
const IMAGE_IDS = ["alibaba", "qwen-cloud", "qwen-cloud-token-plan", "bailian-coding-plan"];
const VIDEO_IDS = ["qwen-cloud", "qwen-cloud-token-plan", "bailian-coding-plan"];
const IMAGE_PATH = "/api/v1/services/aigc/multimodal-generation/generation";
const SUBMIT_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const TTS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
const readJson = (path) => JSON.parse(readFileSync(new URL(`../../open-sse/services/providerParity/${path}`, import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}, url) => {
  const response = new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
};
const leaky = (status, code) => json({ code, message: `upstream echo ${KEY_A} ${KEY_B}`, request_id: "r" }, status);
const cred = (apiKey, region, extra = {}) => ({ apiKey, providerSpecificData: { ...(region === undefined ? {} : { region }), ...extra } });
const expectNoLeak = async (result) => {
  const text = `${result.response ? await result.response.clone().text() : ""} ${JSON.stringify(result)}`;
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};

/** A recording transport answering each request with the next step. */
function transport(...steps) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init, proxyOptions) => {
    calls.push({ url: String(url), init, proxyOptions, body: isString(init?.body) ? JSON.parse(init.body) : undefined });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    const value = isFunction(step) ? await step(String(url), init) : step;
    if (value instanceof Error) throw value;
    return value;
  });
  return { fetchImpl, calls };
}
const hang = (_url, init) => new Promise((_, reject) => {
  init?.signal?.addEventListener("abort", () => reject(init.signal.reason ?? new DOMException("aborted", "AbortError")), { once: true });
});

describe("region map (alibabaProviderRegions.ts parity)", () => {
  it("maps every source identity and region to one literal origin", () => {
    expect(image.DASHSCOPE_REGIONS).toEqual(REGIONS);
    expect(JSON.parse(JSON.stringify(image.DASHSCOPE_MEDIA_ORIGINS))).toEqual(ORIGINS);
    for (const id of IMAGE_IDS) {
      for (const region of REGIONS) {
        expect(image.dashscopeMediaOrigin(id, region)).toBe(ORIGINS[id][region]);
        expect(image.resolveDashscopeConnectionRegion(id, cred(KEY_A, region))).toEqual({ region, origin: ORIGINS[id][region] });
      }
    }
    expect(Object.isFrozen(image.DASHSCOPE_MEDIA_ORIGINS)).toBe(true);
    expect(Object.isFrozen(image.DASHSCOPE_MEDIA_ORIGINS.alibaba)).toBe(true);
  });

  it("reads the source spellings and defaults a missing region to global-sg", () => {
    for (const value of ["global-sg", "Global", " international ", "SINGAPORE", "ap-southeast-1"]) expect(image.normalizeDashscopeRegion(value)).toBe("global-sg");
    for (const value of ["china-beijing", "China", "cn", " Beijing ", "cn-beijing"]) expect(image.normalizeDashscopeRegion(value)).toBe("china-beijing");
    for (const credentials of [{ apiKey: KEY_A }, cred(KEY_A, null), cred(KEY_A, ""), cred(KEY_A, "  "), { apiKey: KEY_A, providerSpecificData: "x" }]) {
      expect(image.resolveDashscopeConnectionRegion("qwen-cloud", credentials).region).toBe("global-sg");
    }
  });

  it("refuses unknown regions, custom base URLs and foreign identities explicitly", () => {
    for (const region of ["eu-central-1", "us", "mars", "toString", "__proto__", 7, true, {}]) {
      expect(image.resolveDashscopeConnectionRegion("alibaba", cred(KEY_A, region)).error, String(region)).toMatch(/unknown region/);
    }
    for (const baseUrl of ["https://evil.example.com/api/v1", "https://dashscope.aliyuncs.com.evil.example/api/v1", "http://dashscope.aliyuncs.com/compatible-mode/v1", 42]) {
      expect(image.resolveDashscopeConnectionRegion("alibaba", cred(KEY_A, "cn", { baseUrl })).error).toMatch(/custom base URL/);
    }
    // A preset of another identity is a custom base URL for this one.
    expect(image.resolveDashscopeConnectionRegion("alibaba", cred(KEY_A, "cn", { baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" })).error)
      .toMatch(/custom base URL/);
    for (const id of ["alibaba-cn", "qwen", "alicode", "", "constructor"]) expect(image.resolveDashscopeConnectionRegion(id, cred(KEY_A, "cn")).error).toBeDefined();
    expect(image.resolveDashscopeConnectionRegion("alibaba", cred(KEY_A, "global-sg"), ["global-sg"]).error).toBeUndefined();
    expect(image.resolveDashscopeConnectionRegion("alibaba", cred(KEY_A, "cn"), ["global-sg"]).error).toMatch(/not served in region china-beijing/);
  });

  it("treats a saved source preset (current or retired) as no base URL; the region still decides", () => {
    const presets = [
      ["alibaba", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/", "china-beijing"],
      ["qwen-cloud", "https://DASHSCOPE.aliyuncs.com/compatible-mode/v1/chat/completions", "global-sg"],
      ["qwen-cloud-token-plan", "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "china-beijing"],
      ["bailian-coding-plan", "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1", "china-beijing"],
      ["bailian-coding-plan", "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1/messages", "global-sg"],
    ];
    for (const [id, baseUrl, region] of presets) {
      expect(image.isDashscopePresetBaseUrl(id, baseUrl), baseUrl).toBe(true);
      expect(image.resolveDashscopeConnectionRegion(id, cred(KEY_A, region, { baseUrl }))).toEqual({ region, origin: ORIGINS[id][region] });
    }
  });
});

describe("staging stays inert", () => {
  it("activates no production registration", () => {
    for (const id of IMAGE_IDS) {
      expect(getImageAdapter(id), id).toBeNull();
      expect(getImageAdapter(ALIASES[id]), id).toBeNull();
    }
    for (const id of VIDEO_IDS) expect(getVideoGenerationAdapter(id), id).toBeNull();
    for (const path of ["native-dashscope-image/registration.json", "native-dashscope-video/registration.json", "native-dashscope-tts/registration.json"]) {
      expect(readJson(path).status).toBe("staged-unregistered");
    }
  });

  it("registration.json describes the regional instances and the region map", () => {
    const img = readJson("native-dashscope-image/registration.json");
    expect(img.regionParity.adapters).toBe("dashscopeRegionalImageAdapters");
    for (const entry of img.providers) expect(entry.regionalUrls).toEqual(Object.fromEntries(REGIONS.map((r) => [r, `${ORIGINS[entry.canonicalId][r]}${IMAGE_PATH}`])));
    const vid = readJson("native-dashscope-video/registration.json");
    expect(vid.regionParity.adapters).toBe("dashscopeRegionalVideoAdapters");
    for (const entry of vid.providers) {
      expect(entry.regionalEndpoints).toEqual(Object.fromEntries(REGIONS.map((r) => [r, {
        submit: `${ORIGINS[entry.canonicalId][r]}${SUBMIT_PATH}`, status: `${ORIGINS[entry.canonicalId][r]}/api/v1/tasks/{task_id}`,
      }])));
    }
    const speech = readJson("native-dashscope-tts/registration.json");
    expect(speech.regionParity.adapter).toBe("dashscopeRegionalTtsAdapter");
    expect(speech.regionParity.urls).toEqual(Object.fromEntries(REGIONS.map((r) => [r, `${ORIGINS["qwen-cloud-token-plan"][r]}${TTS_PATH}`])));
    for (const [mod, reg] of [[image, img], [video, vid], [tts, speech]]) {
      for (const name of Object.keys(reg.exports)) expect(mod[name], name).toBeDefined();
    }
  });
});

// ── Image ──────────────────────────────────────────────────────────────
describe("image: regional adapters", () => {
  const imageSuccess = (url) => json({
    request_id: "req-image-1",
    output: { choices: [{ message: { role: "assistant", content: [{ image: IMAGE_OUT }] } }] },
    usage: { image_count: 1, width: 1024, height: 1024 },
  }, 200, {}, url);
  const make = (id, api, options = {}) => image.createDashscopeImageAdapter(id, { fetchImpl: api.fetchImpl, now: () => 1_700_000_000_000, regional: true, ...options });
  const run = (id, api, { model = image.DASHSCOPE_IMAGE_IDENTITIES[id].models[0].id, credentials = cred(KEY_A, "cn"), body = {}, signal, options } = {}) =>
    make(id, api, options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });

  it("exposes one regional instance per identity and the url helper", () => {
    expect(Object.keys(image.dashscopeRegionalImageAdapters)).toEqual(IMAGE_IDS);
    for (const id of IMAGE_IDS) {
      const adapter = image.dashscopeRegionalImageAdapters[id];
      expect(adapter.provider).toBe(id);
      expect(adapter.regions).toEqual(REGIONS);
      expect(adapter.url).toBe(`${ORIGINS[id]["global-sg"]}${IMAGE_PATH}`);
      for (const region of REGIONS) expect(image.dashscopeImageUrl(id, region)).toBe(`${ORIGINS[id][region]}${IMAGE_PATH}`);
    }
    expect(image.alibabaImageAdapter.regions).toEqual(["global-sg"]);
    expect(image.dashscopeImageUrl("alibaba-cn", "china-beijing")).toBeNull();
  });

  for (const id of IMAGE_IDS) {
    for (const region of REGIONS) {
      it(`${id} ${region}: exact origin, Bearer key and envelope; alias prefix resolves to the bare id`, async () => {
        const url = `${ORIGINS[id][region]}${IMAGE_PATH}`;
        const api = transport(imageSuccess(url));
        const entry = image.DASHSCOPE_IMAGE_IDENTITIES[id].models[0];
        const result = await run(id, api, { model: `${ALIASES[id]}/${entry.id}`, credentials: cred(KEY_A, region === "global-sg" ? "Singapore" : "cn-beijing"), body: { size: "1024x1024", n: 1 } });
        expect(result.success).toBe(true);
        expect(api.calls).toHaveLength(1);
        const [call] = api.calls;
        expect(call.url).toBe(url);
        expect(call.init.method).toBe("POST");
        expect(call.init.redirect).toBe("manual");
        expect(call.init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
        expect(call.body).toEqual({
          model: entry.id,
          input: { messages: [{ role: "user", content: [{ text: PROMPT }] }] },
          parameters: { size: "1024*1024", n: 1 },
        });
        expect(result.accounting.meta.region).toBe(region);
        expect(result.accounting.nativeUnits).toMatchObject({ images: 1 });
        expect(await result.response.json()).toMatchObject({ data: [{ url: IMAGE_OUT }] });
      });
    }
  }

  it("refuses another identity's alias or an unlisted model before the network, in every region", async () => {
    const api = transport();
    for (const region of REGIONS) {
      for (const model of ["qwc/z-image-turbo", "qct/wan2.7-image", "alibaba-cn/qwen-image-2.0", "wan2.7-image"]) {
        const result = await run("alibaba", api, { model, credentials: cred(KEY_A, region) });
        expect(result.status, model).toBe(400);
      }
    }
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an unknown region, a custom base URL and a missing key before the network", async () => {
    const api = transport();
    const results = [
      await run("qwen-cloud", api, { credentials: cred(KEY_A, "eu-central-1") }),
      await run("qwen-cloud", api, { credentials: cred(KEY_A, 3) }),
      await run("bailian-coding-plan", api, { credentials: cred(KEY_A, "cn", { baseUrl: "https://evil.example.com/api/v1" }) }),
      await run("alibaba", api, { credentials: { providerSpecificData: { region: "cn" } } }),
    ];
    expect(results.map((r) => r.status)).toEqual([400, 400, 400, 401]);
    for (const result of results) expect(result.acceptedJob).toBeUndefined();
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a redirect without following it and keeps the key on the regional origin", async () => {
    const api = transport(new Response(null, { status: 302, headers: { location: "https://evil.example.com/steal" } }));
    const result = await run("qwen-cloud-token-plan", api);
    expect(result.status).toBe(502);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].url).toBe(`${ORIGINS["qwen-cloud-token-plan"]["china-beijing"]}${IMAGE_PATH}`);
    await expectNoLeak(result);
  });

  it("treats an answer from the other region's origin as an unknown outcome, never resent", async () => {
    const api = transport(imageSuccess(`${ORIGINS.alibaba["global-sg"]}${IMAGE_PATH}`));
    const result = await run("alibaba", api, { credentials: cred(KEY_A, "china-beijing") });
    expect(result.success).toBe(false);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expect(api.calls).toHaveLength(1);
  });

  it("isolates two accounts in different regions on the same identity", async () => {
    const api = transport(
      (url) => imageSuccess(url),
      (url) => imageSuccess(url),
    );
    const adapter = make("qwen-cloud", api);
    const [a, b] = await Promise.all([
      adapter.generate({ model: "wan2.7-image", body: { prompt: PROMPT }, credentials: cred(KEY_A, "global-sg") }),
      adapter.generate({ model: "wan2.7-image", body: { prompt: PROMPT }, credentials: cred(KEY_B, "china-beijing") }),
    ]);
    expect(a.accounting.meta.region).toBe("global-sg");
    expect(b.accounting.meta.region).toBe("china-beijing");
    const byKey = Object.fromEntries(api.calls.map((c) => [c.init.headers.Authorization, c.url]));
    expect(byKey).toEqual({
      [`Bearer ${KEY_A}`]: `${ORIGINS["qwen-cloud"]["global-sg"]}${IMAGE_PATH}`,
      [`Bearer ${KEY_B}`]: `${ORIGINS["qwen-cloud"]["china-beijing"]}${IMAGE_PATH}`,
    });
  });

  it("maps an unpaid regional account to quota exhaustion on that connection only", async () => {
    const api = transport(leaky(400, "Arrearage"));
    const result = await run("bailian-coding-plan", api);
    expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(result.acceptedJob).toBeUndefined();
    await expectNoLeak(result);
  });

  it("keeps a 5xx as an accepted job and never replays it", async () => {
    const api = transport(leaky(500, "InternalError"), imageSuccess());
    const result = await run("alibaba", api);
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(api.calls).toHaveLength(1);
    await expectNoLeak(result);
  });

  it("honors cancellation and the deadline after the send, with acceptedJob and one call", async () => {
    const controller = new AbortController();
    const aborting = transport((url, init) => {
      setTimeout(() => controller.abort(), 5);
      return hang(url, init);
    });
    const aborted = await run("qwen-cloud", aborting, { signal: controller.signal });
    expect(aborted.status).toBe(499);
    expect(aborted.acceptedJob).toBeDefined();
    expect(aborting.calls).toHaveLength(1);

    const slow = transport(hang);
    const late = await run("qwen-cloud", slow, { options: { submitTimeoutMs: 20, timeoutMs: 40 } });
    expect(late.status).toBe(504);
    expect(late.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(slow.calls).toHaveLength(1);
  });

  it("does not read caller timeout fields: the source image handler has none", async () => {
    const api = transport();
    const result = await run("alibaba", api, { body: { timeout_ms: 1000 } });
    expect(result.status).toBe(400);
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });
});

// ── Video ──────────────────────────────────────────────────────────────
describe("video: regional adapters and polling options", () => {
  const originalFetch = global.fetch;
  let calls;
  let clock;
  let waits;
  const serve = (...steps) => {
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init, body: isString(init?.body) ? JSON.parse(init.body) : undefined });
      const step = steps.shift();
      if (!step) throw new Error(`Unexpected request: ${url}`);
      const value = isFunction(step) ? await step(String(url), init) : step;
      if (value instanceof Error) throw value;
      return value;
    });
  };
  const accepted = (id, url) => json({ request_id: "req-v1", output: { task_id: id, task_status: "PENDING" } }, 200, {}, url);
  const status = (id, state, extra = {}) => json({ request_id: "req-v2", output: { task_id: id, task_status: state, ...extra } });
  const succeeded = (id) => status(id, "SUCCEEDED", { video_url: VIDEO_OUT });
  const clockOptions = () => ({
    wait: async (ms, signal) => {
      signal?.throwIfAborted();
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  const make = (id, options = {}) => video.createDashscopeVariantVideoAdapter(id, { ...clockOptions(), regional: true, ...options });
  const run = (id, { model = "happyhorse-1.1-t2v", credentials = cred(KEY_A, "cn"), body = {}, signal, options } = {}) =>
    make(id, options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });

  beforeEach(() => {
    calls = [];
    waits = [];
    clock = 5_000_000;
    serve();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exposes one regional instance per identity and fixed regional endpoints", () => {
    expect(Object.keys(video.dashscopeRegionalVideoAdapters)).toEqual(VIDEO_IDS);
    for (const id of VIDEO_IDS) {
      expect(video.dashscopeRegionalVideoAdapters[id].regions).toEqual(REGIONS);
      for (const region of REGIONS) {
        expect(video.dashscopeVideoEndpoint(id, region)).toEqual({
          origin: ORIGINS[id][region], baseUrl: `${ORIGINS[id][region]}/api/v1`, statusUrl: `${ORIGINS[id][region]}/api/v1/tasks`,
        });
      }
    }
    expect(video.dashscopeVideoEndpoint("alibaba", "china-beijing")).toBeNull();
    expect(video.qwenCloudVideoAdapter.regions).toEqual(["global-sg"]);
  });

  for (const id of VIDEO_IDS) {
    for (const region of REGIONS) {
      it(`${id} ${region}: submit and poll on the regional origin with the selected key`, async () => {
        const origin = ORIGINS[id][region];
        serve(accepted("task-1", `${origin}${SUBMIT_PATH}`), status("task-1", "RUNNING"), succeeded("task-1"));
        const result = await run(id, { credentials: cred(KEY_A, region === "global-sg" ? "international" : "china") });
        expect(result.success).toBe(true);
        expect(calls.map((c) => c.url)).toEqual([`${origin}${SUBMIT_PATH}`, `${origin}/api/v1/tasks/task-1`, `${origin}/api/v1/tasks/task-1`]);
        expect(calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" });
        expect(calls[0].init.redirect).toBe("manual");
        expect(calls[0].body).toMatchObject({ model: "happyhorse-1.1-t2v", input: { prompt: PROMPT } });
        for (const poll of calls.slice(1)) expect(poll.init).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: `Bearer ${KEY_A}` } });
        expect(result.accounting.meta).toMatchObject({ region, jobId: "task-1", pollTimeoutMs: 300_000, pollIntervalMs: 2_500 });
        expect(waits).toEqual([2_500, 2_500]);
      });
    }
  }

  it("refuses alias-prefixed and foreign models before the network", async () => {
    for (const [id, model] of [["qwen-cloud", "qwc/happyhorse-1.1-t2v"], ["qwen-cloud-token-plan", "wan2.7-t2v"], ["bailian-coding-plan", "qct/happyhorse-1.1-t2v"]]) {
      const result = await run(id, { model });
      expect(result.status, model).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses an unknown region or a custom base URL before the network", async () => {
    for (const credentials of [cred(KEY_A, "eu"), cred(KEY_A, "cn", { baseUrl: "https://attacker.example.com/api/v1" })]) {
      const result = await run("qwen-cloud", { credentials });
      expect(result.status).toBe(400);
      expect(result.acceptedJob).toBeUndefined();
    }
    expect(calls).toHaveLength(0);
  });

  it("honors timeout_ms and poll_interval_ms within the source ceilings", async () => {
    serve(accepted("t"), status("t", "RUNNING"), succeeded("t"));
    const honored = await run("qwen-cloud", { body: { timeout_ms: 90_000, poll_interval_ms: "4000" } });
    expect(honored.success).toBe(true);
    expect(waits).toEqual([4_000, 4_000]);
    expect(honored.accounting.meta).toMatchObject({ pollTimeoutMs: 90_000, pollIntervalMs: 4_000 });

    expect(video.resolveDashscopeVideoPolling({ timeout_ms: 9e9, poll_interval_ms: 9e9 })).toMatchObject({ timeoutMs: 600_000, pollIntervalMs: 120_000 });
    expect(video.resolveDashscopeVideoPolling({ poll_interval_ms: 5 })).toMatchObject({ timeoutMs: 300_000, pollIntervalMs: 1_000 });
    expect(video.resolveDashscopeVideoPolling({ timeout_ms: 61_234.9 })).toMatchObject({ timeoutMs: 61_234, pollIntervalMs: 2_500 });
    expect(video.resolveDashscopeVideoPolling({})).toMatchObject({ timeoutMs: 300_000, pollIntervalMs: 2_500 });
  });

  it("refuses unusable polling options before any submit", async () => {
    for (const body of [
      { timeout_ms: "soon" }, { timeout_ms: 0 }, { timeout_ms: -5 }, { poll_interval_ms: Number.NaN }, { poll_interval_ms: {} },
      { poll_timeout_ms: 1000 }, { timeout_ms: 2_000 }, { timeout_ms: 10_000, poll_interval_ms: 10_000 },
    ]) {
      const result = await run("qwen-cloud-token-plan", { body });
      expect(result.status, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("stops at the caller deadline with an accepted job and no resubmit", async () => {
    serve(accepted("slow"), status("slow", "RUNNING"), status("slow", "RUNNING"), status("slow", "RUNNING"));
    const result = await run("bailian-coding-plan", { body: { timeout_ms: 10_000, poll_interval_ms: 3_000 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "accepted" } });
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([3_000, 3_000, 3_000]);
  });

  it("cancels while polling: 499 with an accepted job, one submit, no further polls", async () => {
    const controller = new AbortController();
    serve(accepted("c"), () => {
      controller.abort();
      return status("c", "RUNNING");
    });
    const result = await run("qwen-cloud", { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toMatchObject({ meta: { jobState: "accepted" } });
    expect(calls).toHaveLength(2);
  });

  it("refuses a submit redirect and treats the other region's origin as unknown", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example.com/" } }));
    const redirected = await run("qwen-cloud-token-plan");
    expect(redirected.status).toBe(502);
    expect(calls).toHaveLength(1);

    calls = [];
    serve(accepted("x", `${ORIGINS["qwen-cloud-token-plan"]["global-sg"]}${SUBMIT_PATH}`));
    const foreign = await run("qwen-cloud-token-plan", { credentials: cred(KEY_A, "china-beijing") });
    expect(foreign.status).toBe(502);
    expect(foreign.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
  });

  it("maps an unpaid regional account to quota exhaustion and leaks nothing", async () => {
    serve(leaky(403, "AccessDenied.Unpurchased"));
    const result = await run("qwen-cloud");
    expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(calls).toHaveLength(1);
    await expectNoLeak(result);
  });

  it("isolates two accounts in different regions", async () => {
    serve(
      (url) => accepted(url.includes("cn-beijing") ? "b" : "a"),
      (url) => accepted(url.includes("cn-beijing") ? "b" : "a"),
      (url) => succeeded(url.endsWith("/b") ? "b" : "a"),
      (url) => succeeded(url.endsWith("/b") ? "b" : "a"),
    );
    const adapter = make("qwen-cloud-token-plan");
    const [a, b] = await Promise.all([
      adapter.generate({ model: "happyhorse-1.1-t2v", body: { prompt: PROMPT }, credentials: cred(KEY_A, "global-sg") }),
      adapter.generate({ model: "happyhorse-1.1-t2v", body: { prompt: PROMPT }, credentials: cred(KEY_B, "china-beijing") }),
    ]);
    expect([a.accounting.meta.region, b.accounting.meta.region]).toEqual(["global-sg", "china-beijing"]);
    for (const call of calls) {
      const key = call.init.headers.Authorization;
      const origin = new URL(call.url).origin;
      expect(origin).toBe(key === `Bearer ${KEY_A}` ? ORIGINS["qwen-cloud-token-plan"]["global-sg"] : ORIGINS["qwen-cloud-token-plan"]["china-beijing"]);
    }
  });
});

// ── Speech ─────────────────────────────────────────────────────────────
describe("tts: regional adapter", () => {
  const inline = (url) => json({ request_id: "req-t", output: { audio: { data: MP3.toString("base64"), url: "" } }, usage: { characters: 12 } }, 200, {}, url);
  const make = (api, download = transport(), options = {}) =>
    tts.createDashscopeTtsAdapter({ fetchImpl: api.fetchImpl, downloadFetchImpl: download.fetchImpl, regional: true, ...options });
  const say = (adapter, credentials = cred(KEY_A, "cn"), options = {}, model = "qwen-audio-3.0-tts-plus") =>
    adapter.synthesize("Hello there.", model, credentials, "mp3", options);

  it("exposes the regional instance and URL map", () => {
    expect(tts.dashscopeRegionalTtsAdapter.regions).toEqual(REGIONS);
    expect(tts.dashscopeTtsAdapter.regions).toEqual(["global-sg"]);
    for (const region of REGIONS) expect(tts.dashscopeTtsUrl(region)).toBe(`${ORIGINS["qwen-cloud-token-plan"][region]}${TTS_PATH}`);
    expect(tts.dashscopeTtsUrl("eu")).toBeNull();
  });

  for (const region of REGIONS) {
    it(`${region}: exact SpeechSynthesizer URL, Bearer key and source envelope`, async () => {
      const url = `${ORIGINS["qwen-cloud-token-plan"][region]}${TTS_PATH}`;
      const api = transport(inline(url));
      const result = await say(make(api), cred(KEY_A, region === "global-sg" ? "global" : "beijing"), { voice: "longanlufeng" });
      expect(result.format).toBe("mp3");
      expect(api.calls).toHaveLength(1);
      expect(api.calls[0].url).toBe(url);
      expect(api.calls[0].init.redirect).toBe("manual");
      expect(api.calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
      expect(api.calls[0].body).toEqual({
        model: "qwen-audio-3.0-tts-plus",
        input: { text: "Hello there.", voice: "longanlufeng" },
        parameters: { format: "mp3", sample_rate: 24000 },
      });
      expect(result.accounting.meta.region).toBe(region);
      expect(result.accounting.nativeUnits).toEqual({ characters: 12 });
    });
  }

  it("refuses a model/voice suffix, an unknown region and a custom base URL before the network", async () => {
    const api = transport();
    const adapter = make(api);
    for (const [credentials, model] of [
      [cred(KEY_A, "cn"), "qct/longanlufeng"],
      [cred(KEY_A, "eu-central-1"), undefined],
      [cred(KEY_A, "cn", { baseUrl: "https://evil.invalid/api/v1" }), undefined],
    ]) {
      const result = await say(adapter, credentials, {}, model);
      expect(result).toMatchObject({ success: false, status: 400, local: true });
    }
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses redirects and other-origin answers as unknown outcomes without replay", async () => {
    const redirect = transport(new Response(null, { status: 302, headers: { location: "https://evil.example.com/" } }));
    const r1 = await say(make(redirect));
    expect(r1.status).toBe(502);
    expect(r1.acceptedJob).toBeDefined();
    expect(redirect.calls).toHaveLength(1);

    const foreign = transport(inline(`${ORIGINS["qwen-cloud-token-plan"]["global-sg"]}${TTS_PATH}`));
    const r2 = await say(make(foreign), cred(KEY_A, "china-beijing"));
    expect(r2.status).toBe(502);
    expect(r2.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(foreign.calls).toHaveLength(1);
  });

  it("maps quota and keeps 5xx and cancellation as accepted jobs sent once", async () => {
    const unpaid = transport(leaky(400, "Arrearage"));
    expect(await say(make(unpaid))).toMatchObject({ status: 402, quotaExhausted: true });

    const failing = transport(leaky(500, "InternalError"), inline());
    const failed = await say(make(failing));
    expect(failed.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(failing.calls).toHaveLength(1);
    await expectNoLeak(failed);

    const controller = new AbortController();
    const aborting = transport((url, init) => {
      setTimeout(() => controller.abort(), 5);
      return hang(url, init);
    });
    const aborted = await say(make(aborting), cred(KEY_A, "cn"), { signal: controller.signal });
    expect(aborted.status).toBe(499);
    expect(aborted.acceptedJob).toBeDefined();
    expect(aborting.calls).toHaveLength(1);

    const slow = transport(hang);
    const late = await say(make(slow, transport(), { timeoutMs: 20 }));
    expect(late.status).toBe(504);
    expect(late.acceptedJob).toBeDefined();
    expect(slow.calls).toHaveLength(1);
  });

  it("isolates two accounts in different regions", async () => {
    const api = transport((url) => inline(url), (url) => inline(url));
    const adapter = make(api);
    const [a, b] = await Promise.all([say(adapter, cred(KEY_A, "global-sg")), say(adapter, cred(KEY_B, "china-beijing"))]);
    expect([a.accounting.meta.region, b.accounting.meta.region]).toEqual(["global-sg", "china-beijing"]);
    const byKey = Object.fromEntries(api.calls.map((c) => [c.init.headers.Authorization, c.url]));
    expect(byKey).toEqual({
      [`Bearer ${KEY_A}`]: `${ORIGINS["qwen-cloud-token-plan"]["global-sg"]}${TTS_PATH}`,
      [`Bearer ${KEY_B}`]: `${ORIGINS["qwen-cloud-token-plan"]["china-beijing"]}${TTS_PATH}`,
    });
  });
});
