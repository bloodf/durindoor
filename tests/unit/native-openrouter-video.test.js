// OpenRouter native video adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every key is synthetic. Wire shapes follow OmniRoute
// c71f0065 (config/videoRegistry.ts `openrouter`, handlers/videoGeneration.ts,
// handlers/videoGeneration/job.ts preset "openrouter-video-job",
// tests/unit/services/openrouter-video-job.test.ts). Passing here says nothing
// about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-openrouter-video/index.js";
import {
  OPENROUTER_VIDEO_MODELS,
  buildOpenrouterVideoRequest,
  createOpenrouterVideoAdapter,
  openrouterContentUrl,
  openrouterVideoAdapter,
  resolveOpenrouterTiming,
} from "../../open-sse/services/providerParity/native-openrouter-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { parseModel } from "../../open-sse/services/model.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const API = "https://openrouter.ai/api/v1";
const VIDEO_URL = `${API}/videos`;
const status = (id) => `${VIDEO_URL}/${id}`;
const content = (id, query = "?index=0") => `${VIDEO_URL}/${id}/content${query}`;
const KEY_A = "sk-or-v1-SYNTHETIC-key-a";
const KEY_B = "sk-or-v1-SYNTHETIC-key-b";
const PROMPT = "a paper boat drifting on a pond";
const MODEL = "alibaba/wan-3.0";
// The source test's 12-byte mp4 header (box size 32, type `ftyp`, brand isom).
const MP4 = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112, 105, 115, 111, 109]);
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-openrouter-video/registration.json", import.meta.url), "utf8"));

const json = (value, code = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status: code, headers: { "content-type": "application/json", ...headers } });
const leaky = (code, vendor, headers = {}) =>
  json({ error: { code: vendor, message: `upstream echo ${KEY_A} ${PROMPT}` } }, code, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
// Source submit answer: 202 with { id, polling_url, status }.
const accepted = (id = "job-123") => json({ id, polling_url: status(id), status: "pending" }, 202);
const job = (statusText, id = "job-123", extra = {}) => json({ id, status: statusText, ...extra });
const done = (id = "job-123", urls = [content(id)]) => job("completed", id, { unsigned_urls: urls });
const clip = (bytes = MP4, headers = { "content-type": "video/mp4" }) => new Response(bytes, { status: 200, headers });

const originalFetch = global.fetch;
let calls;
let clock;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

// A request that never answers; it rejects only when its signal aborts.
const stalled = (_url, init) => new Promise((_, rejectWait) => {
  init.signal.addEventListener("abort", () => rejectWait(init.signal.reason), { once: true });
});

const polling = () => ({
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const video = (body = {}, { model = MODEL, credentials = { apiKey: KEY_A }, signal, options } = {}) =>
  createOpenrouterVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
};
const header = (call, name) => new Headers(call.init.headers).get(name);

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
  it("stays unregistered: no video adapter, kind, model rows or videoConfig for openrouter", () => {
    expect(getVideoGenerationAdapter("openrouter")).toBeNull();
    const entry = REGISTRY.find((e) => e.id === "openrouter");
    expect(entry.serviceKinds).not.toContain("video");
    expect(entry.models.some((m) => m.kind === "video")).toBe(false);
    expect(PROVIDER_MODELS.openrouter.some((m) => m.kind === "video")).toBe(false);
    expect(PROVIDER_MEDIA.openrouter?.videoConfig).toBeUndefined();
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.OPENROUTER_PROVIDER_ID).toBe("openrouter");
    expect(staged.OPENROUTER_ALIAS).toBe("openrouter");
    expect(staged.OPENROUTER_API_BASE).toBe(API);
    expect(staged.OPENROUTER_VIDEO_URL).toBe(VIDEO_URL);
    expect(staged.OPENROUTER_AUTH_TYPE).toBe("apikey");
    expect(staged.OPENROUTER_AUTH_HEADER).toBe("bearer");
    expect(staged.OPENROUTER_VIDEO_FORMAT).toBe("openrouter-video-job");
    expect(OPENROUTER_VIDEO_MODELS.map((m) => m.id)).toEqual([
      "google/veo-3.1", "google/veo-3.1-fast", "google/veo-3.1-lite", "openai/sora-2-pro",
      "kwaivgi/kling-v3.0-pro", "kwaivgi/kling-v3.0-std", "bytedance/seedance-2.5", "bytedance/seedance-2.0",
      "minimax/hailuo-3-max", "minimax/hailuo-3", "alibaba/wan-3.0", "alibaba/wan-3.0-prime",
      "x-ai/grok-imagine-video-1.5", "runway/gen-4.5",
    ]);
    for (const model of OPENROUTER_VIDEO_MODELS) expect(model.kind).toBe("video");
    expect(staged.OPENROUTER_POLL_INTERVAL_MS).toBe(2_000);
    expect(staged.OPENROUTER_MAX_POLLS).toBe(180);
  });

  it("the existing openrouter provider keeps its identity and API-key mode", () => {
    const entry = REGISTRY.find((e) => e.id === "openrouter");
    expect(entry.alias).toBe("openrouter");
    expect(entry.authType ?? "apikey").toBe("apikey");
    expect(entry.oauth).toBeUndefined();
    expect(entry.transport.baseUrl.startsWith(`${API}/`)).toBe(true);
    // Slugs keep their vendor slash: the provider prefix is split off once.
    expect(parseModel("openrouter/google/veo-3.1")).toMatchObject({ provider: "openrouter", model: "google/veo-3.1" });
  });

  it("the default adapter follows the video adapter contract", () => {
    expect(openrouterVideoAdapter.async).toBe(true);
    expect(openrouterVideoAdapter.provider).toBe("openrouter");
    expect(isFunction(openrouterVideoAdapter.generate)).toBe(true);
    expect(openrouterVideoAdapter.models).toBe(OPENROUTER_VIDEO_MODELS);
    expect(openrouterVideoAdapter.responseFormats).toEqual(["b64_json"]);
    expect(openrouterVideoAdapter.defaultResponseFormat).toBe("b64_json");
  });

  it("registration.json matches the exports and the module", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields).toEqual({
      id: "openrouter", baseUrl: API, authType: "apikey", authHeader: "bearer", format: "openrouter-video-job",
    });
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(REGISTRATION.provider.canonicalId).toBe("openrouter");
    expect(REGISTRATION.provider.aliases).toEqual(["openrouter"]);
    expect(REGISTRATION.provider.authModes).toEqual(["apikey"]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["video"]);
    expect(REGISTRATION.serviceKinds).toEqual(["video"]);
    expect(REGISTRATION.models.video).toEqual(OPENROUTER_VIDEO_MODELS.map(({ id, name }) => ({ id, name })));
    expect(REGISTRATION.endpoints.submit.url).toBe(VIDEO_URL);
    expect(REGISTRATION.endpoints.status.url).toBe(`${VIDEO_URL}/{id}`);
    expect(REGISTRATION.responseFormats).toEqual({ video: ["b64_json"] });
  });
});

describe("request contract", () => {
  it("submits, polls and downloads the key-gated content (source flow)", async () => {
    serve(accepted(), job("pending"), job("in_progress"), done(), clip());
    const result = await video({ duration: 5, aspect_ratio: "16:9" });
    expect(result.success).toBe(true);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `POST ${VIDEO_URL}`, `GET ${status("job-123")}`, `GET ${status("job-123")}`, `GET ${status("job-123")}`, `GET ${content("job-123")}`,
    ]);
    // Source buildJobHeaders: JSON content type and the bearer key on every leg; nothing else.
    for (const call of calls) {
      expect(header(call, "authorization")).toBe(`Bearer ${KEY_A}`);
      expect(header(call, "content-type")).toBe("application/json");
      expect(header(call, "http-referer")).toBeNull();
      expect(header(call, "x-title")).toBeNull();
      expect(call.init.redirect).toBe("manual");
    }
    // `duration` is a plain integer on this API; aspect_ratio passes through.
    expect(calls[0].body).toEqual({ model: MODEL, prompt: PROMPT, duration: 5, aspect_ratio: "16:9" });
    const body = await payload(result);
    expect(body.data).toEqual([{ b64_json: Buffer.from(MP4).toString("base64"), format: "mp4", mime_type: "video/mp4" }]);
    expect(result.accounting).toMatchObject({
      modality: "video", nativeUnits: { videos: 1 }, cost: null, costStatus: "unknown",
    });
    expect(result.accounting.meta.jobId).toBe("job-123");
    expect(result.acceptedJob).toBeUndefined();
  });

  it("never bills the requested duration", async () => {
    serve(accepted(), done(), clip());
    const result = await video({ seconds: "8" });
    expect(calls[0].body.duration).toBe(8);
    expect(result.accounting.nativeUnits).toEqual({ videos: 1 });
  });

  it("builds the minimal body and accepts matching seconds and duration", () => {
    expect(buildOpenrouterVideoRequest("google/veo-3.1", { prompt: PROMPT })).toEqual({ model: "google/veo-3.1", prompt: PROMPT });
    expect(buildOpenrouterVideoRequest("runway/gen-4.5", { prompt: PROMPT, seconds: 6, duration: 6 }).duration).toBe(6);
  });

  it("refuses inputs this subset cannot honor before any request", async () => {
    const cases = [
      [{ response_format: "url" }, /b64_json only/],
      [{ n: 2 }, /n=1/],
      [{ stream: true }, /streaming/],
      [{ duration: 5.5 }, /whole number/],
      [{ duration: 0 }, /whole number/],
      [{ seconds: "99" }, /whole number/],
      [{ seconds: 5, duration: 6 }, /disagree/],
      [{ aspect_ratio: "wide" }, /aspect_ratio/],
      [{ size: "1280x720" }, /does not support size/],
      [{ resolution: "1080p" }, /does not support resolution/],
      [{ image: "https://example.com/a.png" }, /does not support image/],
      [{ input_references: ["x"] }, /does not support input_references/],
      [{ poll_interval_ms: -1 }, /positive number/],
      [{ prompt: "   " }, /text prompt/],
    ];
    for (const [body, message] of cases) {
      const result = await video(body);
      expect(result.status, JSON.stringify(body)).toBe(400);
      expect(await errorMessage(result)).toMatch(message);
    }
    for (const model of ["openai/gpt-4o", "veo-3.1", "openrouter/google/veo-3.1"]) {
      const unknownModel = await video({}, { model });
      expect(unknownModel.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("bounds caller polling overrides to the source window and never forwards them", async () => {
    expect(resolveOpenrouterTiming({})).toEqual({ pollIntervalMs: 2_000, maxPolls: 180 });
    expect(resolveOpenrouterTiming({ poll_interval_ms: 10 })).toEqual({ pollIntervalMs: 1_000, maxPolls: 180 });
    expect(resolveOpenrouterTiming({ poll_interval_ms: 10_000, max_polls: 1_000 })).toEqual({ pollIntervalMs: 10_000, maxPolls: 60 });
    expect(resolveOpenrouterTiming({ poll_interval_ms: 999_999 }).pollIntervalMs).toBe(120_000);
    serve(accepted(), job("pending"), job("pending"));
    const result = await video({ max_polls: 2, poll_interval_ms: 3_000 });
    expect(result.status).toBe(504);
    expect(calls).toHaveLength(3);
    expect(calls[0].body).toEqual({ model: MODEL, prompt: PROMPT });
  });

  it("requires a usable key and sends nothing without one", async () => {
    for (const credentials of [{}, { apiKey: "" }, { apiKey: "a\r\nX-Evil: 1" }, null]) {
      const result = await video({}, { credentials });
      expect(result.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it("uses each connection's own key on every leg and ignores connection base URLs", async () => {
    serve(accepted("a"), done("a"), clip(), accepted("b"), done("b"), clip());
    await video({}, { credentials: { apiKey: KEY_A } });
    await video({}, { credentials: { accessToken: KEY_B, baseUrl: "https://evil.example", providerSpecificData: { baseUrl: "https://evil.example/v1" } } });
    expect(calls.slice(0, 3).map((c) => header(c, "authorization"))).toEqual(Array(3).fill(`Bearer ${KEY_A}`));
    expect(calls.slice(3).map((c) => header(c, "authorization"))).toEqual(Array(3).fill(`Bearer ${KEY_B}`));
    for (const call of calls) expect(call.url.startsWith(`${API}/`)).toBe(true);
  });
});

describe("job outcomes", () => {
  it("failed, cancelled and expired jobs are reported, not downloaded, and claim no accepted job", async () => {
    for (const state of ["failed", "cancelled", "expired"]) {
      serve(accepted(), job(state, "job-123", { error: `echo ${KEY_A}` }));
      const result = await video();
      expect(result.status).toBe(502);
      expect(await errorMessage(result)).toBe("OpenRouter video job failed");
      expect(result.acceptedJob).toBeUndefined();
      await assertNoLeak(result);
    }
    expect(calls.some((c) => c.url.includes("/content"))).toBe(false);
  });

  it("maps refused submits without quoting the upstream body", async () => {
    serve(leaky(402, "insufficient_credits"));
    const quota = await video();
    expect(quota.status).toBe(402);
    expect(quota.quotaExhausted).toBe(true);
    expect(quota.acceptedJob).toBeUndefined();
    await assertNoLeak(quota);

    serve(leaky(401, "invalid_api_key"));
    const auth = await video();
    expect(auth.status).toBe(401);
    expect(auth.quotaExhausted).toBeUndefined();
    await assertNoLeak(auth);

    serve(leaky(429, "rate_limited", { "retry-after": "30" }));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob).toBeUndefined();

    serve(leaky(400, "bad_request"));
    const bad = await video();
    expect(bad.status).toBe(400);
    await assertNoLeak(bad);
    expect(calls).toHaveLength(4);
  });

  it("a 5xx submit is uncertain and not replayed", async () => {
    serve(leaky(500, "server_error"));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ modality: "video", costSource: "accepted-job", cost: null, meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("a submit answer without a usable job id is an accepted unknown outcome", async () => {
    for (const answer of [json({ status: "pending" }, 202), json({ id: "../../etc" }, 202), new Response("nope", { status: 202 })]) {
      serve(answer);
      const result = await video();
      expect(result.status).toBe(502);
      expect(result.acceptedJob.meta.jobState).toBe("accepted");
    }
  });

  it("an answer about another job or without a status is an unknown outcome", async () => {
    serve(accepted(), done("other"));
    const other = await video();
    expect(await errorMessage(other)).toMatch(/different video job/);
    expect(other.acceptedJob.meta.jobState).toBe("accepted");
    serve(accepted(), json({ id: "job-123" }));
    const missing = await video();
    expect(await errorMessage(missing)).toMatch(/without a status/);
  });

  it("retries poll 429/503 within bounds, then gives up as unknown", async () => {
    serve(accepted(), json({}, 503), json({}, 429, { "retry-after": "2" }), done(), clip());
    const ok = await video();
    expect(ok.success).toBe(true);
    serve(accepted(), ...Array(6).fill(0).map(() => json({}, 429)));
    const limited = await video();
    expect(limited.status).toBe(429);
    expect(limited.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("other poll errors pass auth statuses through as unknown outcomes", async () => {
    serve(accepted(), leaky(401, "invalid_api_key"));
    const result = await video();
    expect(result.status).toBe(401);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    await assertNoLeak(result);
  });

  it("stops at the job deadline and at the poll budget", async () => {
    serve(accepted(), ...Array(4).fill(0).map(() => job("in_progress")));
    const late = await video({}, { options: { timeoutMs: 7_000 } });
    expect(late.status).toBe(504);
    expect(late.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls.length).toBeLessThanOrEqual(5);
    calls = [];
    serve(accepted(), job("pending"), job("in_progress"));
    const budget = await video({}, { options: { maxPolls: 2 } });
    expect(budget.status).toBe(504);
    expect(calls).toHaveLength(3);
  });

  it("refuses unsafe or missing result URLs without sending the key elsewhere", async () => {
    const unsafe = [
      [],
      ["https://cdn.example.com/job-123.mp4"],
      ["http://openrouter.ai/api/v1/videos/job-123/content"],
      ["https://user:pw@openrouter.ai/api/v1/videos/job-123/content"],
      [content("other-job")],
      [`${API}/files/job-123`],
      [content("job-123", "?index=0&redirect=https://evil.example")],
      [content("job-123", "?index=../x")],
      ["https://openrouter.ai.evil.example/api/v1/videos/job-123/content"],
      ["javascript:alert(1)"],
      [42],
    ];
    for (const urls of unsafe) {
      serve(accepted(), done("job-123", urls));
      const result = await video();
      expect(result.success, JSON.stringify(urls)).toBeFalsy();
      expect(await errorMessage(result)).toMatch(/usable content URL/);
      expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
    }
    serve(accepted(), job("completed"));
    const none = await video();
    expect(none.acceptedJob.meta.jobState).toBe("completed-unread");
    expect(calls.every((c) => c.url.startsWith(`${API}/videos`))).toBe(true);
    expect(calls.some((c) => c.url.includes("/content"))).toBe(false);
  });

  it("accepts the bare content route and a numeric index only", () => {
    expect(openrouterContentUrl(`${VIDEO_URL}/job-1/content`, "job-1")).toBe(`${VIDEO_URL}/job-1/content`);
    expect(openrouterContentUrl(`${VIDEO_URL}/job-1/content?index=2`, "job-1")).toBe(`${VIDEO_URL}/job-1/content?index=2`);
    expect(openrouterContentUrl(`${VIDEO_URL}/job-1/content#x`, "job-1")).toBeNull();
    expect(openrouterContentUrl(`${VIDEO_URL}/job-1/content?index=1&index=2`, "job-1")).toBeNull();
  });

  it("unusable content after completion is an unread completed job", async () => {
    const bad = [
      clip(new Uint8Array(0)),
      clip(new TextEncoder().encode("<html>not a video</html>"), { "content-type": "video/mp4" }),
      clip(MP4, { "content-type": "text/html" }),
      clip(MP4, { "content-type": "video/mp4", "content-length": String(64 * 1024 * 1024 + 1) }),
      new Response(null, { status: 302, headers: { location: "https://storage.example/clip.mp4" } }),
      leaky(404, "not_found"),
    ];
    for (const answer of bad) {
      serve(accepted(), done(), answer);
      const result = await video();
      expect(result.success).toBeFalsy();
      expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
      await assertNoLeak(result);
    }
  });

  it("an oversized streamed body is cut off and not buffered", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulled = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    serve(accepted(), done(), new Response(stream, { headers: { "content-type": "video/mp4" } }));
    const result = await video();
    expect(await errorMessage(result)).toMatch(/larger than/);
    expect(pulled).toBeLessThan(70);
  });
});

describe("transport, redirects, abort and deadlines", () => {
  it("a submit redirect is refused, not followed", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(await errorMessage(result)).toMatch(/redirect refused/);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("an answer from another origin is treated as possibly accepted", async () => {
    const foreign = accepted();
    Object.defineProperty(foreign, "url", { value: "https://evil.example/api/v1/videos" });
    serve(foreign);
    const result = await video();
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("a poll redirect is an accepted unknown outcome", async () => {
    serve(accepted(), new Response(null, { status: 307, headers: { location: "https://evil.example/" } }));
    const result = await video();
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("a pre-connect failure is provably unsent: no acceptedJob", async () => {
    serve(() => { throw transportError("ECONNREFUSED"); });
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("a mid-send failure may have been accepted: acceptedJob and no replay", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("a stalled submit times out as uncertain, sent once", async () => {
    serve(stalled);
    const result = await video({}, { options: { submitTimeoutMs: 10 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal.aborted).toBe(true);
  });

  it("a stalled status request is bounded and aborted", async () => {
    serve(accepted(), stalled);
    const result = await video({}, { options: { requestTimeoutMs: 10 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls[1].init.signal.aborted).toBe(true);
  });

  it("a stalled content download is bounded and aborted", async () => {
    serve(accepted(), done(), stalled);
    const result = await video({}, { options: { contentTimeoutMs: 10 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
    expect(calls[2].init.signal.aborted).toBe(true);
  });

  it("an abort before send sends nothing and claims no job", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("an abort during the submit tears the socket down and keeps the uncertain job", async () => {
    const controller = new AbortController();
    serve((url, init) => {
      setTimeout(() => controller.abort(), 1);
      return stalled(url, init);
    });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(calls[0].init.signal.aborted).toBe(true);
  });

  it("an abort while polling stops the poll and keeps the accepted job", async () => {
    const controller = new AbortController();
    serve(accepted(), (url, init) => {
      setTimeout(() => controller.abort(), 1);
      return stalled(url, init);
    });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
    expect(calls[1].init.signal.aborted).toBe(true);
  });

  it("an abort during the content download keeps the completed job", async () => {
    const controller = new AbortController();
    serve(accepted(), done(), (url, init) => {
      setTimeout(() => controller.abort(), 1);
      return stalled(url, init);
    });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob.meta.jobState).toBe("completed-unread");
    expect(calls[2].init.signal.aborted).toBe(true);
  });
});
