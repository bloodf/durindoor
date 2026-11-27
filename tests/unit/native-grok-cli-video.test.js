// Grok CLI (Grok Build) native video adapter, staged and unregistered (#2034).
// Closed mocks only: every request is answered below, an unexpected request
// fails the test, and every token is synthetic. Wire shapes follow OmniRoute
// c71f0065 (videoRegistry.ts `grok-cli`, grokBuildEndpoints.ts,
// videoGeneration.ts `xai-video` dispatch, videoGeneration/xaiGrokImagineHandler.ts
// and grokMedia.ts). Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-grok-cli-video/index.js";
import {
  GROK_CLI_VIDEO_MODELS,
  buildGrokCliVideoRequest,
  createGrokCliVideoAdapter,
  grokCliVideoAdapter,
  resolveGrokCliTiming,
} from "../../open-sse/services/providerParity/native-grok-cli-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { getVideoConfig } from "../../open-sse/handlers/videoCore.js";
import grokCliRegistry from "../../open-sse/providers/registry/grok-cli.js";
import xaiRegistry from "../../open-sse/providers/registry/xai.js";
import { GROK_CLI_SHELL_USER_AGENT, GROK_CLI_VERSION } from "../../open-sse/config/grokCli.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://cli-chat-proxy.grok.com";
const VIDEOS = `${ORIGIN}/v1/videos`;
const CREATE = `${VIDEOS}/generations`;
const TOKEN_A = "grok-SYNTHETIC-oauth-token-a-0001";
const TOKEN_B = "grok-SYNTHETIC-oauth-token-b-0002";
const REFRESH_A = "grok-SYNTHETIC-refresh-a-0001";
const API_KEY = "xai-SYNTHETIC-api-key-0003";
const PROMPT = "a lantern drifting through a misty forest";
const OUT_A = "https://vidgen.x.ai/out-a.mp4?sig=1";
const OUT_B = "https://vidgen.x.ai/out-b.mp4?sig=2";
const REGISTRATION = JSON.parse(readFileSync(new URL(
  "../../open-sse/services/providerParity/native-grok-cli-video/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, code, headers = {}) =>
  json({ code, error: { message: `upstream echo ${TOKEN_A} ${PROMPT}` }, message: `echo ${TOKEN_A}` }, status, headers);
const job = (status, extra = {}) => json({ status, ...extra });
const done = (url, extra = {}) => job("done", { video: { url, duration: 6, ...extra } });
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${TOKEN_A}`), { code }) });

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
const creds = (token = TOKEN_A, extra = {}) => ({ accessToken: token, refreshToken: REFRESH_A, connectionId: "conn-a", ...extra });
const video = (body = {}, { model = "grok-imagine-video", credentials = creds(), signal, options } = {}) =>
  createGrokCliVideoAdapter({ ...polling(), ...options }).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const payload = async (result) => result.response.clone().json();
const errorMessage = async (result) => (await payload(result)).error.message;
const assertNoLeak = async (result) => {
  const text = await result.response.clone().text();
  for (const secret of [TOKEN_A, TOKEN_B, REFRESH_A, API_KEY, "upstream echo", "echo"]) expect(text).not.toContain(secret);
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
  it("stays unregistered and leaves the existing grok-cli entry unchanged", () => {
    expect(getVideoGenerationAdapter("grok-cli")).toBeNull();
    expect(getVideoConfig("grok-cli")).toBeNull();
    expect(grokCliRegistry.serviceKinds).toBeUndefined();
    expect(grokCliRegistry.models.some((m) => m.kind === "video")).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("staged module metadata", () => {
  it("exports the pinned source registry fields", () => {
    expect(staged.GROK_CLI_PROVIDER_ID).toBe("grok-cli");
    expect(staged.GROK_CLI_SOURCE_ALIAS).toBe("gc");
    expect(staged.GROK_CLI_PROXY_BASE_URL).toBe(`${ORIGIN}/v1`);
    expect(staged.GROK_CLI_VIDEOS_URL).toBe(VIDEOS);
    expect(staged.GROK_CLI_VIDEO_GENERATIONS_URL).toBe(CREATE);
    expect(staged.GROK_CLI_AUTH_TYPE).toBe("oauth");
    expect(staged.GROK_CLI_VIDEO_FORMAT).toBe("xai-video");
    expect(GROK_CLI_VIDEO_MODELS.map((m) => [m.id, m.name])).toEqual([["grok-imagine-video", "Grok Imagine Video (OAuth)"]]);
    expect(staged.GROK_CLI_JOB_TIMEOUT_MS).toBe(300_000);
    expect(staged.GROK_CLI_MAX_JOB_TIMEOUT_MS).toBe(1_800_000);
    expect(staged.GROK_CLI_POLL_INTERVAL_MS).toBe(2_500);
    expect(staged.GROK_CLI_MAX_POLLS).toBe(300);
    expect(grokCliVideoAdapter.provider).toBe("grok-cli");
    expect(grokCliVideoAdapter.responseFormats).toEqual(["url"]);
    expect(grokCliVideoAdapter.async).toBe(true);
    expect(isFunction(grokCliVideoAdapter.generate)).toBe(true);
  });

  it("matches the existing provider identity, aliases and OAuth-only mode", () => {
    expect(grokCliRegistry.id).toBe(staged.GROK_CLI_PROVIDER_ID);
    expect([grokCliRegistry.alias, ...grokCliRegistry.aliases]).toEqual([...staged.GROK_CLI_ALIASES]);
    expect(staged.GROK_CLI_ALIASES).not.toContain("gc");
    expect(grokCliRegistry.authModes).toEqual(["oauth"]);
    expect(new URL(grokCliRegistry.transport.baseUrl).origin).toBe(ORIGIN);
    // API-key xAI video is the separate xai provider on another origin.
    expect(xaiRegistry.videoConfig.baseUrl).toBe("https://api.x.ai/v1/videos");
  });

  it("describes the same ids, models and endpoints in registration.json", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.sourceRegistryEntry).toMatchObject({
      id: "grok-cli", alias: "gc", authType: "oauth", authHeader: "bearer", format: "xai-video",
      GROK_BUILD_PROXY_BASE_URL: `${ORIGIN}/v1`,
    });
    expect(REGISTRATION.provider.canonicalId).toBe("grok-cli");
    expect(REGISTRATION.provider.aliases).toEqual([...staged.GROK_CLI_ALIASES]);
    expect(REGISTRATION.provider.addServiceKinds).toEqual(["llm", "video"]);
    expect(REGISTRATION.provider.auth.credentialFields).toEqual(["accessToken"]);
    expect(REGISTRATION.models.video.map((m) => m.id)).toEqual(GROK_CLI_VIDEO_MODELS.map((m) => m.id));
    expect(REGISTRATION.endpoints.create.url).toBe(CREATE);
    expect(REGISTRATION.endpoints.status.url).toBe(`${VIDEOS}/{request_id}`);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged).toHaveProperty(name);
  });
});

describe("video request contract", () => {
  it("creates with the source Grok media headers and body, then polls /videos/{request_id}", async () => {
    serve(json({ request_id: "req_1" }), job("pending"), job("processing"), done(OUT_A));
    const result = await video({
      image: "https://images.example.com/start.png",
      reference_images: [{ url: "https://images.example.com/ref.png" }, "data:image/png;base64,iVBORw0KGgo="],
      duration: 6, aspect_ratio: "16:9", resolution: "720p",
    });
    expect(result.success).toBe(true);
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", CREATE], ["GET", `${VIDEOS}/req_1`], ["GET", `${VIDEOS}/req_1`], ["GET", `${VIDEOS}/req_1`],
    ]);
    const media = {
      "x-grok-client-version": GROK_CLI_VERSION,
      "x-grok-client-identifier": "grok-shell",
      "x-grok-client-mode": "headless",
      "User-Agent": GROK_CLI_SHELL_USER_AGENT,
      "X-XAI-Token-Auth": "xai-grok-cli",
      Authorization: `Bearer ${TOKEN_A}`,
    };
    expect(calls[0].init.headers).toEqual({ ...media, "Content-Type": "application/json" });
    expect(calls[1].init.headers).toEqual(media);
    expect(calls[0].body).toEqual({
      model: "grok-imagine-video",
      prompt: PROMPT,
      image: { url: "https://images.example.com/start.png" },
      reference_images: [{ url: "https://images.example.com/ref.png" }, { url: "data:image/png;base64,iVBORw0KGgo=" }],
      duration: 6, aspect_ratio: "16:9", resolution: "720p",
    });
    for (const call of calls) expect(call.init.redirect).toBe("manual");
    expect(await payload(result)).toEqual({ created: Math.floor(clock / 1000), data: [{ url: OUT_A, format: "mp4" }] });
  });

  it("sends only model and prompt for a bare request and never forwards polling knobs", async () => {
    serve(json({ request_id: "req_1" }), done(OUT_A));
    await video({ timeout_ms: 50_000, poll_interval_ms: 2_000, max_polls: 4, n: 1, response_format: "url" });
    expect(calls[0].body).toEqual({ model: "grok-imagine-video", prompt: PROMPT });
  });

  it("ignores apiKey and any connection base URL; the token goes only to the fixed origin", async () => {
    serve(json({ request_id: "req_1" }), done(OUT_A));
    const result = await video({}, { credentials: creds(TOKEN_A, { apiKey: API_KEY, baseUrl: "https://evil.example.com", providerSpecificData: { baseUrl: "https://evil.example.com" } }) });
    expect(result.success).toBe(true);
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe(ORIGIN);
      expect(JSON.stringify(call.init.headers)).not.toContain(API_KEY);
    }
  });
});

describe("input validation before any billable request", () => {
  const refused = [
    [{ prompt: "" }, "text prompt"],
    [{ prompt: 42 }, "text prompt"],
    [{ n: 2 }, "n=1"],
    [{ stream: true }, "streaming"],
    [{ response_format: "b64_json" }, "response_format url"],
    [{ seconds: 5 }, "does not support seconds"],
    [{ size: "1280x720" }, "does not support size"],
    [{ image: "http://images.example.com/a.png" }, "public https URL"],
    [{ image: "https://127.0.0.1/a.png" }, "public https URL"],
    [{ image: "https://user:pw@images.example.com/a.png" }, "public https URL"],
    [{ image: "data:text/html;base64,PHA+" }, "public https URL"],
    [{ image: { url: "https://images.example.com/a.png", detail: "x" } }, "only a url"],
    [{ reference_images: [] }, "reference_images"],
    [{ reference_images: "https://images.example.com/a.png" }, "reference_images"],
    [{ duration: 0 }, "duration"],
    [{ duration: 2.5 }, "duration"],
    [{ duration: 16 }, "duration"],
    [{ aspect_ratio: "wide" }, "aspect_ratio"],
    [{ resolution: "HD" }, "resolution"],
    [{ timeout_ms: 0 }, "timeout_ms"],
    [{ timeout_ms: 1_800_001 }, "timeout_ms"],
    [{ poll_interval_ms: 999 }, "poll_interval_ms"],
    [{ max_polls: 301 }, "max_polls"],
    [{ max_polls: "many" }, "max_polls"],
  ];
  it.each(refused)("refuses %j with 400 and sends nothing", async (body, fragment) => {
    const result = await video(body);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(await errorMessage(result)).toContain(fragment);
    expect(calls).toHaveLength(0);
  });

  it("refuses an unknown model before sending", async () => {
    const result = await video({}, { model: "grok-imagine-video-1.5" });
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing, expired or header-unsafe OAuth token with 401 before sending", async () => {
    for (const credentials of [
      { apiKey: API_KEY },
      creds(TOKEN_A, { expiresAt: new Date(clock - 1).toISOString() }),
      creds(TOKEN_A, { expiresAt: "not-a-date" }),
      creds(`${TOKEN_A}\r\nX-Evil: 1`),
    ]) {
      const result = await createGrokCliVideoAdapter({ ...polling(), now: () => clock }).generate({
        model: "grok-imagine-video", body: { prompt: PROMPT }, credentials,
      });
      expect(result.status).toBe(401);
      await assertNoLeak(result);
    }
    expect(calls).toHaveLength(0);
  });

  it("accepts a token that has not expired yet", async () => {
    serve(json({ request_id: "req_1" }), done(OUT_A));
    const result = await createGrokCliVideoAdapter({ ...polling() }).generate({
      model: "grok-imagine-video", body: { prompt: PROMPT }, credentials: creds(TOKEN_A, { expiresAt: new Date(clock + 60_000).toISOString() }),
    });
    expect(result.success).toBe(true);
  });

  it("resolves the source timing defaults and caps polls to the deadline", () => {
    expect(resolveGrokCliTiming({})).toEqual({ timeoutMs: 300_000, pollIntervalMs: 2_500, maxPolls: 120 });
    expect(resolveGrokCliTiming({ timeout_ms: 10_000, poll_interval_ms: 1_000, max_polls: 300 })).toEqual({ timeoutMs: 10_000, pollIntervalMs: 1_000, maxPolls: 10 });
    expect(resolveGrokCliTiming({ max_polls: 3 }).maxPolls).toBe(3);
    expect(buildGrokCliVideoRequest("grok-imagine-video", { prompt: "p", duration: "8" }).duration).toBe(8);
  });
});

describe("success and usage accounting", () => {
  it("records one returned video and its reported seconds with unknown cost", async () => {
    serve(json({ request_id: "req_1" }), done(OUT_A));
    const result = await video();
    expect(result.accounting).toMatchObject({
      modality: "video", nativeUnits: { videos: 1, videoSeconds: 6 }, cost: null, costStatus: "unknown",
      meta: { jobId: "req_1", nativeUnitsSource: "returned-videos" },
    });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps two connections' tokens and results apart", async () => {
    serve(json({ request_id: "req_a" }), done(OUT_A), json({ request_id: "req_b" }), done(OUT_B));
    const a = await video({}, { credentials: creds(TOKEN_A) });
    const b = await video({}, { credentials: creds(TOKEN_B, { connectionId: "conn-b" }) });
    expect((await payload(a)).data[0].url).toBe(OUT_A);
    expect((await payload(b)).data[0].url).toBe(OUT_B);
    expect(calls.slice(0, 2).every((c) => c.init.headers.Authorization === `Bearer ${TOKEN_A}`)).toBe(true);
    expect(calls.slice(2).every((c) => c.init.headers.Authorization === `Bearer ${TOKEN_B}`)).toBe(true);
    expect(calls[3].url).toBe(`${VIDEOS}/req_b`);
  });
});

describe("refused create answers (no job, or unknown job)", () => {
  it("maps 401/403 to the same status without quoting the upstream body or retrying", async () => {
    for (const status of [401, 403]) {
      calls = [];
      serve(leaky(status, "unauthorized"));
      const result = await video();
      expect(result.status).toBe(status);
      expect(result.acceptedJob).toBeUndefined();
      expect(posts()).toHaveLength(1);
      await assertNoLeak(result);
    }
  });

  it("marks 402 spending-limit as quota on this connection only", async () => {
    serve(leaky(402, "personal-team-blocked:spending-limit"));
    const result = await video();
    expect(result.status).toBe(402);
    expect(result.quotaExhausted).toBe(true);
    expect(await errorMessage(result)).toContain("personal-team-blocked:spending-limit");
    await assertNoLeak(result);
  });

  it("passes a bounded Retry-After on 429", async () => {
    serve(leaky(429, "rate_limited", { "retry-after": "30" }));
    const result = await video();
    expect(result.status).toBe(429);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("treats a 5xx create as an unknown outcome with acceptedJob and never resends", async () => {
    serve(leaky(502, "bad_gateway"));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", meta: { jobState: "submit-unknown" } });
    expect(posts()).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("refuses a redirect without following it and without acceptedJob", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example.com/v1/videos/generations" } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats a create without a usable request_id as accepted unknown work", async () => {
    for (const answer of [json({}), json({ request_id: "../escape" }), new Response("not json", { status: 200 })]) {
      calls = [];
      serve(answer);
      const result = await video();
      expect(result.success).toBe(false);
      expect(result.acceptedJob?.meta.jobState).toBe("accepted");
      expect(calls).toHaveLength(1);
    }
  });

  it("does not resend after an uncertain transport failure or create timeout", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const reset = await video();
    expect(reset.status).toBe(502);
    expect(reset.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(posts()).toHaveLength(1);
    await assertNoLeak(reset);

    calls = [];
    serve((url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
    const slow = await video({}, { options: { submitTimeoutMs: 5 } });
    expect(slow.status).toBe(504);
    expect(slow.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(posts()).toHaveLength(1);
  });

  it("reports a proven pre-connect failure without acceptedJob", async () => {
    serve(() => { throw transportError("ENOTFOUND"); });
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("refuses an oversized create answer as unknown accepted work", async () => {
    serve(new Response("{}", { status: 200, headers: { "content-length": String(2 * 1024 * 1024) } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeDefined();
  });
});

describe("polling outcomes", () => {
  it("ends a failed job as an ordinary failure without acceptedJob or upstream text", async () => {
    serve(json({ request_id: "req_1" }), job("failed", { error: { message: `echo ${TOKEN_A}` } }));
    const result = await video();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    await assertNoLeak(result);
  });

  it("refuses a done job with a missing, private, http or credentialed URL", async () => {
    for (const url of [undefined, "http://vidgen.x.ai/a.mp4", "https://10.0.0.1/a.mp4", "https://u:p@vidgen.x.ai/a.mp4", "javascript:alert(1)"]) {
      calls = [];
      serve(json({ request_id: "req_1" }), job("done", { video: { url } }));
      const result = await video();
      expect(result.success).toBe(false);
      expect(result.acceptedJob?.meta.jobState).toBe("accepted");
      expect(calls).toHaveLength(2);
    }
  });

  it("refuses a status answer about another job", async () => {
    serve(json({ request_id: "req_1" }), json({ request_id: "req_2", status: "done", video: { url: OUT_A } }));
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.acceptedJob).toBeDefined();
  });

  it("retries 429/503 status answers a bounded number of times, then succeeds", async () => {
    serve(json({ request_id: "req_1" }), json({}, 503), json({}, 429, { "retry-after": "2" }), done(OUT_A));
    const result = await video();
    expect(result.success).toBe(true);
    expect(posts()).toHaveLength(1);
  });

  it("keeps an accepted job on a 401 status answer and does not resubmit", async () => {
    serve(json({ request_id: "req_1" }), leaky(401, "unauthorized"));
    const result = await video();
    expect(result.status).toBe(401);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(posts()).toHaveLength(1);
    await assertNoLeak(result);
  });

  it("stops at the poll cap and the deadline with 504 and acceptedJob", async () => {
    serve(json({ request_id: "req_1" }), job("pending"), job("pending"));
    const capped = await video({ max_polls: 2 });
    expect(capped.status).toBe(504);
    expect(capped.acceptedJob).toBeDefined();
    expect(calls).toHaveLength(3);

    calls = [];
    serve(json({ request_id: "req_1" }), job("pending"), job("pending"), job("pending"));
    const late = await video({}, { options: { timeoutMs: 3_500 } });
    expect(late.status).toBe(504);
    expect(calls).toHaveLength(4);
  });

  it("refuses a redirected status check as unknown accepted work", async () => {
    serve(json({ request_id: "req_1" }), new Response(null, { status: 302, headers: { location: "https://evil.example.com" } }));
    const result = await video();
    expect(result.success).toBe(false);
    expect(result.acceptedJob).toBeDefined();
    expect(calls).toHaveLength(2);
  });
});

describe("cancellation", () => {
  it("returns 499 without sending when the caller already left", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("aborts an in-flight create and keeps it as unknown accepted work", async () => {
    const controller = new AbortController();
    serve((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
      controller.abort();
    }));
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(posts()).toHaveLength(1);
  });

  it("stops polling when the caller leaves and keeps the accepted job", async () => {
    const controller = new AbortController();
    serve(json({ request_id: "req_1" }), () => {
      controller.abort();
      return job("pending");
    });
    const result = await video({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("aborts the poll wait itself", async () => {
    const controller = new AbortController();
    serve(json({ request_id: "req_1" }));
    const result = await video({}, {
      signal: controller.signal,
      options: { wait: async (ms, signal) => { controller.abort(); signal.throwIfAborted(); } },
    });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeDefined();
    expect(calls).toHaveLength(1);
  });
});
