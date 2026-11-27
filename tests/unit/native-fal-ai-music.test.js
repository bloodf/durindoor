// fal.ai ACE-Step music generation, staged and unregistered. Closed mocks only:
// every request is answered below, an unexpected request fails the test, and
// every credential is synthetic. Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import defaultAdapter, { createFalMusicAdapter } from "../../open-sse/services/providerParity/native-fal-ai-music/adapter.js";
import {
  FAL_MUSIC_FORMAT,
  FAL_MUSIC_MODEL_IDS,
  FAL_MUSIC_PROVIDER_ALIASES,
  FAL_MUSIC_PROVIDER_ID,
  FAL_MUSIC_PROVIDER_METADATA,
  FAL_MUSIC_RESPONSE_FORMATS,
  falMusicModel,
} from "../../open-sse/services/providerParity/native-fal-ai-music/config.js";
import { buildFalMusicRequest } from "../../open-sse/services/providerParity/native-fal-ai-music/request.js";
import { falDiscoveryUrl, validateFalInput } from "../../open-sse/services/providerParity/native-fal-ai-music/discovery.js";
import { falTrackingUrl, isFalRequestId } from "../../open-sse/services/providerParity/native-fal-ai-music/transport.js";
import { normalizeFalMusicResult } from "../../open-sse/services/providerParity/native-fal-ai-music/result.js";
import { runFalMusicJob } from "../../open-sse/services/providerParity/native-fal-ai-music/job.js";
import * as bundle from "../../open-sse/services/providerParity/native-fal-ai-music/index.js";
import { MUSIC_ADAPTERS, handleMusicGenerationCore } from "../../open-sse/handlers/musicGenerationCore.js";
import falRegistry from "../../open-sse/providers/registry/fal-ai.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const KEY_A = "SYNTHETIC-fal-key-a:0001aaaa";
const KEY_B = "SYNTHETIC-fal-key-b:0002bbbb";
const PROMPT = "lo-fi hip hop, mellow piano, rainy evening";
const REQ_ID = "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7";
const SUBMIT = "https://queue.fal.run/fal-ai/ace-step";
const STATUS = `${SUBMIT}/requests/${REQ_ID}/status`;
const RESULT = `${SUBMIT}/requests/${REQ_ID}`;
const AUDIO = "https://v3.fal.media/files/zebra/abc123_output.wav";
const SECRET_ECHO = `upstream echo ${KEY_A} ${PROMPT}`;

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const accepted = (extra = {}) => json({ request_id: REQ_ID, status_url: STATUS, response_url: RESULT, cancel_url: `${RESULT}/cancel`, ...extra });
const status = (value) => json({ status: value, request_id: REQ_ID });
const result = (audio = { url: AUDIO, content_type: "audio/wav", file_name: "output.wav", file_size: 1234 }, extra = {}) =>
  json({ audio, seed: 42, tags: PROMPT, ...extra });
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });

// A minimal fal catalog page for the ACE-Step endpoint with its OpenAPI document.
const ACE_SCHEMA = {
  openapi: "3.0.4",
  paths: {
    "/fal-ai/ace-step": { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/AceStepInput" } } } } } },
    "/fal-ai/ace-step/requests/{request_id}/status": { get: {} },
  },
  components: {
    schemas: {
      AceStepInput: {
        type: "object",
        required: ["tags"],
        properties: {
          tags: { type: "string", minLength: 1 },
          lyrics: { type: "string" },
          duration: { type: "number", minimum: 5, maximum: 240 },
          number_of_steps: { type: "integer", minimum: 3, maximum: 60 },
          seed: { type: "integer" },
          scheduler: { $ref: "#/components/schemas/Scheduler" },
          guidance_type: { type: "string", enum: ["cfg", "apg", "cfg_star"] },
        },
      },
      Scheduler: { type: "string", enum: ["euler", "heun"] },
    },
  },
};
const catalog = (models = [{ endpoint_id: "fal-ai/ace-step", metadata: { category: "text-to-audio" }, openapi: ACE_SCHEMA }], extra = {}) =>
  json({ models, has_more: false, next_cursor: null, ...extra });

const originalFetch = global.fetch;
let calls;
let clock;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined, auth: init?.headers?.Authorization });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

const clockOptions = () => ({
  pollIntervalMs: 1_000,
  timeoutMs: 10_000,
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const adapter = (options = {}) => createFalMusicAdapter({ ...clockOptions(), ...options });
const generate = (body = {}, { model = "ace-step", credentials = { apiKey: KEY_A, connectionId: "conn-a" }, signal, options } = {}) =>
  adapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const errorBody = async (res) => (await res.response.clone().json()).error;
const assertNoSecrets = async (res) => {
  const text = await res.response.clone().text();
  for (const secret of [KEY_A, KEY_B, PROMPT, "upstream echo"]) expect(text).not.toContain(secret);
};

beforeEach(() => {
  calls = [];
  clock = 1_000_000;
  serve();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Isolated staging block: the only assertions that depend on the adapter being
// unregistered. The registration change replaces these with positive registry
// identity checks; every other block holds staged and registered alike.
describe("canonical registration (isolated)", () => {
  it("dispatches canonical and alias native music separately from cookie adapters", async () => {
    expect(MUSIC_ADAPTERS["fal-ai"]).toBeUndefined();
    expect(MUSIC_ADAPTERS.fal).toBeUndefined();
    expect(falRegistry.serviceKinds).toContain("music");
    serve(result(), result());
    for (const provider of ["fal-ai", "fal"]) {
      const res = await handleMusicGenerationCore({ provider, model: "ace-step", body: { prompt: PROMPT }, credentials: { apiKey: KEY_A } });
      expect(res.success).toBe(true);
      expect(res.response.status).toBe(200);
    }
    expect(calls).toHaveLength(2);
  });
});

describe("metadata", () => {
  it("uses the existing fal-ai provider id and alias and the source model", () => {
    expect(FAL_MUSIC_PROVIDER_ID).toBe(falRegistry.id);
    expect(FAL_MUSIC_PROVIDER_ALIASES).toEqual(falRegistry.aliases);
    expect(falRegistry.authType).toBe("apikey");
    expect(FAL_MUSIC_FORMAT).toBe("fal-ai-music");
    expect(FAL_MUSIC_MODEL_IDS).toEqual(["ace-step"]);
    expect(falMusicModel("fal-ai/ace-step")?.endpoint).toBe("fal-ai/ace-step");
    expect(falMusicModel("ace-step")?.name).toBe("ACE-Step");
    expect(falMusicModel("fal-ai/flux/dev")).toBeNull();
    expect(FAL_MUSIC_RESPONSE_FORMATS).toEqual(["url"]);
    expect(FAL_MUSIC_PROVIDER_METADATA.musicConfig.baseUrl).toBe("https://queue.fal.run");
    expect(FAL_MUSIC_PROVIDER_METADATA.serviceKinds).toEqual(["music"]);
  });

  it("registration.json matches the exported metadata and the pinned source entry", () => {
    const reg = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-fal-ai-music/registration.json", import.meta.url), "utf8"));
    expect(reg.status).toBe("staged-unregistered");
    expect(reg.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(reg.source.registryEntry).toEqual({ id: "fal-ai", baseUrl: "https://queue.fal.run", authType: "apikey", authHeader: "key", format: "fal-ai-music" });
    expect(reg.provider.canonicalId).toBe(FAL_MUSIC_PROVIDER_ID);
    expect(reg.provider.aliases).toEqual([...FAL_MUSIC_PROVIDER_ALIASES]);
    expect(reg.models.map((m) => m.id)).toEqual([...FAL_MUSIC_MODEL_IDS]);
    expect(reg.provider.serviceKindsToAdd).toEqual(["music"]);
  });

  it("the index re-exports the adapter and helpers; the default adapter is usable", () => {
    expect(bundle.falMusicAdapter).toBe(defaultAdapter);
    expect(isFunction(defaultAdapter.generate)).toBe(true);
    for (const name of ["buildFalMusicRequest", "runFalMusicJob", "discoverFalDefinition", "normalizeFalMusicResult", "falTrackingUrl"]) {
      expect(isFunction(bundle[name])).toBe(true);
    }
  });
});

describe("request contract (source buildFalMusicRequestBody)", () => {
  it("maps prompt to tags and forwards the documented controls verbatim", () => {
    expect(buildFalMusicRequest("ace-step", { prompt: ` ${PROMPT} ` })).toEqual({ tags: PROMPT });
    const body = {
      tags: "rock", lyrics: "[verse]\nla la", duration: 60, seed: 7,
      number_of_steps: 27, granularity_scale: 10, guidance_interval: 0.5, guidance_interval_decay: 0,
      tag_guidance_scale: 0, lyric_guidance_scale: 0, minimum_guidance_scale: 3, guidance_scale: 15,
      scheduler: "heun", guidance_type: "apg",
    };
    expect(buildFalMusicRequest("fal-ai/ace-step", body)).toEqual({ ...body, lyrics: "[verse]\nla la" });
  });

  it.each([
    [{}, /prompt or tags/],
    [{ prompt: "   " }, /prompt or tags/],
    [{ prompt: "a", tags: "b" }, /disagree/],
    [{ prompt: "a", duration: 4 }, /duration/],
    [{ prompt: "a", duration: 241 }, /duration/],
    [{ prompt: "a", duration: "30" }, /duration/],
    [{ prompt: "a", seed: 1.5 }, /seed/],
    [{ prompt: "a", guidance_scale: "high" }, /guidance_scale/],
    [{ prompt: "a", scheduler: "ddim" }, /scheduler/],
    [{ prompt: "a", guidance_type: "x" }, /guidance_type/],
    [{ prompt: "a", stream: true }, /stream/],
    [{ prompt: "a", n: 2 }, /n must be 1/],
    [{ prompt: "a", response_format: "b64_json" }, /response_format/],
    [{ prompt: "a", audio_url: "https://example.com/a.wav" }, /audio_url/],
    [{ prompt: "a", image: "data:image/png;base64,AA==" }, /image/],
    [{ prompt: "a", size: "1024x1024" }, /size/],
    [{ prompt: "a", make_instrumental: true }, /instrumental/],
    [{ prompt: 5 }, /prompt/],
  ])("refuses %j before anything is sent", async (body, message) => {
    expect(() => buildFalMusicRequest("ace-step", body)).toThrow(message);
    const res = await adapter().generate({ model: "ace-step", body, credentials: { apiKey: KEY_A } });
    expect(res.success).toBe(false);
    expect(res.status).toBe(400);
    expect(res.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("refuses an unknown model before anything is sent", async () => {
    const res = await generate({}, { model: "stable-audio" });
    expect(res.status).toBe(400);
    expect((await errorBody(res)).message).toMatch(/Unsupported fal music model/);
    expect(calls).toHaveLength(0);
  });

  it("a missing key is a local 401 (source contract) with nothing sent", async () => {
    const res = await generate({}, { credentials: { apiKey: "" } });
    expect(res.status).toBe(401);
    expect((await errorBody(res)).message).toBe("Fal API key is required");
    expect(calls).toHaveLength(0);
  });
});

describe("success", () => {
  it("submits to the fixed queue with Key auth, polls, reads the result and normalizes the track", async () => {
    serve(accepted(), status("IN_QUEUE"), status("IN_PROGRESS"), status("COMPLETED"), result());
    const res = await generate({ duration: 30 });
    expect(res.success).toBe(true);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", SUBMIT], ["GET", STATUS], ["GET", STATUS], ["GET", STATUS], ["GET", RESULT],
    ]);
    const [submit, ...reads] = calls;
    expect(submit.init.headers).toEqual({ Authorization: `Key ${KEY_A}`, "Content-Type": "application/json" });
    expect(submit.body).toEqual({ tags: PROMPT, duration: 30 });
    expect(submit.init.redirect).toBe("manual");
    for (const read of reads) {
      expect(read.auth).toBe(`Key ${KEY_A}`);
      expect(read.init.redirect).toBe("error");
      expect(read.init.body).toBeUndefined();
    }
    expect(clock).toBe(1_000_000 + 2_000);
    const payload = await res.response.json();
    expect(payload).toEqual({
      object: "music.generation", provider: "fal-ai", model: "ace-step", status: "completed", created: 1_002,
      data: [{ id: REQ_ID, audio_url: AUDIO, url: AUDIO, format: "wav", content_type: "audio/wav", file_name: "output.wav", file_size: 1234, seed: 42 }],
    });
    expect(res.accounting).toMatchObject({
      state: "complete", modality: "music", nativeUnits: { tracks: 1 }, cost: null, costStatus: "unknown",
      meta: { nativeUnitsSource: "returned-tracks" },
    });
    expect(res.acceptedJob).toBeUndefined();
  });

  it("falls back to the source queue paths when the accept body omits tracking URLs", async () => {
    serve(json({ request_id: REQ_ID }), status("COMPLETED"), result());
    const res = await generate();
    expect(res.success).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([SUBMIT, STATUS, RESULT]);
  });

  it("an accept body without request_id is the finished result (source contract)", async () => {
    serve(result({ url: AUDIO, content_type: "audio/mpeg" }));
    const res = await generate();
    expect(res.success).toBe(true);
    const payload = await res.response.json();
    expect(payload.data[0]).toMatchObject({ id: null, audio_url: AUDIO, format: "mpeg" });
    expect(calls).toHaveLength(1);
  });

  it("two credentials: each call uses only its own selected key", async () => {
    serve(accepted(), status("COMPLETED"), result(), accepted(), status("COMPLETED"), result());
    const [a, b] = [await generate({}, { credentials: { apiKey: KEY_A } }), await generate({}, { credentials: { accessToken: KEY_B } })];
    expect(a.success && b.success).toBe(true);
    expect(calls.slice(0, 3).every((c) => (c.auth ?? c.init.headers.Authorization) === `Key ${KEY_A}`)).toBe(true);
    expect(calls.slice(3).every((c) => (c.auth ?? c.init.headers.Authorization) === `Key ${KEY_B}`)).toBe(true);
  });
});

describe("submit failures", () => {
  it.each([
    [401, 401, /credential/],
    [403, 403, /credential/],
    [404, 404, /refused the music request with 404/],
    [400, 400, /refused the music request with 400/],
  ])("%i is refused without acceptedJob and without upstream text", async (upstream, expected, message) => {
    serve(json({ detail: SECRET_ECHO }, upstream));
    const res = await generate();
    expect(res.status).toBe(expected);
    expect((await errorBody(res)).message).toMatch(message);
    expect(res.acceptedJob).toBeUndefined();
    await assertNoSecrets(res);
    expect(calls).toHaveLength(1);
  });

  it("a locked or exhausted balance is 402 with quotaExhausted on this connection", async () => {
    serve(json({ detail: "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing." }, 403));
    const res = await generate();
    expect(res.status).toBe(402);
    expect(res.quotaExhausted).toBe(true);
    expect(res.acceptedJob).toBeUndefined();
  });

  it("429 carries Retry-After evidence and is not retried", async () => {
    serve(json({ detail: SECRET_ECHO }, 429, { "retry-after": "30" }));
    const res = await generate();
    expect(res.status).toBe(429);
    expect(res.rateLimitEvidence?.source).toBe("retry_after");
    expect(calls).toHaveLength(1);
    await assertNoSecrets(res);
  });

  it("422 names only safe-shaped field names", async () => {
    serve(json({ detail: [{ loc: ["body", "duration"], msg: SECRET_ECHO }, { loc: ["body", "<script>"], msg: "x" }] }, 422));
    const res = await generate();
    expect(res.status).toBe(422);
    expect((await errorBody(res)).message).toBe("fal rejected the music input: duration");
    await assertNoSecrets(res);
  });

  it("5xx is an unknown submit: acceptedJob, never resent", async () => {
    serve(json({ detail: SECRET_ECHO }, 502));
    const res = await generate();
    expect(res.status).toBe(502);
    expect(res.acceptedJob).toMatchObject({ modality: "music", costSource: "accepted-job", cost: null, meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
    await assertNoSecrets(res);
  });

  it("a reset after send is an unknown submit; a pre-connect failure is not", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const reset = await generate();
    expect(reset.acceptedJob?.meta.jobState).toBe("submit-unknown");
    await assertNoSecrets(reset);
    serve(() => { throw transportError("ECONNREFUSED"); });
    const refused = await generate();
    expect(refused.status).toBe(502);
    expect(refused.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it("a submit that never answers times out as an unknown submit", async () => {
    serve(() => new Promise(() => {}));
    const res = await generate({}, { options: { submitTimeoutMs: 20 } });
    expect(res.status).toBe(504);
    expect(res.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("a redirect is refused and never followed with the key", async () => {
    serve(new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } }));
    const res = await generate();
    expect(res.status).toBe(502);
    expect((await errorBody(res)).message).toMatch(/redirect refused/);
    expect(calls).toHaveLength(1);
  });

  it("an answer from another origin (followed redirect) is discarded as an unknown submit", async () => {
    const moved = accepted();
    Object.defineProperty(moved, "url", { value: "https://evil.example/fal-ai/ace-step" });
    serve(moved);
    const res = await generate();
    expect(res.status).toBe(502);
    expect(res.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });
});

describe("accepted request outcomes", () => {
  it.each([
    ["tracking URL on another host", accepted({ status_url: `https://evil.example/requests/${REQ_ID}/status` })],
    ["tracking URL for another request", accepted({ status_url: `${SUBMIT}/requests/11111111-2222-3333-4444-555555555555/status` })],
    ["tracking URL with credentials", accepted({ response_url: `https://user:pw@queue.fal.run/fal-ai/ace-step/requests/${REQ_ID}` })],
    ["unusable request id", json({ request_id: "../../x" })],
    ["unreadable accept body", new Response("not json", { status: 200 })],
  ])("%s: the key is never sent anywhere else and the job is accepted-unknown", async (_name, response) => {
    serve(response);
    const res = await generate();
    expect(res.success).toBe(false);
    expect(res.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(1);
  });

  it("a status error is a lost observation with acceptedJob, not a resubmit", async () => {
    serve(accepted(), json({ detail: SECRET_ECHO }, 500));
    const res = await generate();
    expect(res.status).toBe(502);
    expect(res.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    await assertNoSecrets(res);
  });

  it("status reads retry 429 at most twice with a short Retry-After", async () => {
    serve(accepted(), json({}, 429, { "retry-after": "1" }), json({}, 429, { "retry-after": "1" }), status("COMPLETED"), result());
    const res = await generate();
    expect(res.success).toBe(true);
    serve(accepted(), json({}, 429, { "retry-after": "1" }), json({}, 429, { "retry-after": "1" }), json({}, 429, { "retry-after": "1" }));
    const res2 = await generate();
    expect(res2.status).toBe(429);
    expect(res2.acceptedJob).toBeDefined();
  });

  it("a long Retry-After on a read is not waited out", async () => {
    serve(accepted(), json({}, 503, { "retry-after": "60" }));
    const res = await generate();
    expect(res.status).toBe(502);
    expect(res.acceptedJob).toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it("an unknown status ends the job with acceptedJob and only a safe status name", async () => {
    serve(accepted(), status("FAILED"));
    const res = await generate();
    expect((await errorBody(res)).message).toBe("fal music request ended with status FAILED");
    expect(res.acceptedJob).toBeDefined();
    serve(accepted(), status(SECRET_ECHO));
    const res2 = await generate();
    expect((await errorBody(res2)).message).toBe("fal music request ended with status unknown");
  });

  it("the job deadline bounds polling", async () => {
    serve(accepted(), ...Array.from({ length: 20 }, () => status("IN_PROGRESS")));
    const res = await generate({}, { options: { timeoutMs: 5_000 } });
    expect(res.status).toBe(504);
    expect(res.acceptedJob?.meta.jobState).toBe("accepted");
    expect(clock - 1_000_000).toBeLessThanOrEqual(5_000);
  });

  it("a failed result read keeps acceptedJob and drops the upstream body", async () => {
    serve(accepted(), status("COMPLETED"), json({ detail: SECRET_ECHO }, 422));
    const res = await generate();
    expect(res.status).toBe(422);
    expect(res.acceptedJob).toBeDefined();
    await assertNoSecrets(res);
  });

  it.each([
    ["no audio", { seed: 1 }],
    ["http URL", { audio: { url: "http://v3.fal.media/a.wav" } }],
    ["private host", { audio: { url: "https://127.0.0.1/a.wav" } }],
    ["metadata host", { audio: { url: "https://169.254.169.254/latest" } }],
    ["userinfo", { audio: { url: "https://u:p@v3.fal.media/a.wav" } }],
    ["not audio", { audio: { url: AUDIO, content_type: "text/html" } }],
    ["data URI", { audio: { url: "data:audio/wav;base64,AAAA" } }],
  ])("an unusable result (%s) is 502 with acceptedJob completed", async (_name, payload) => {
    serve(accepted(), status("COMPLETED"), json(payload));
    const res = await generate();
    expect(res.status).toBe(502);
    expect(res.acceptedJob?.meta.jobState).toBe("completed");
  });

  it("an oversized result body is unreadable, not parsed", async () => {
    serve(accepted(), status("COMPLETED"), json({ audio: { url: AUDIO }, pad: "x".repeat(4096) }));
    const res = await generate({}, { options: { maxResultBytes: 1024 } });
    expect(res.status).toBe(502);
    expect(res.acceptedJob).toBeDefined();
  });
});

describe("cancellation", () => {
  it("abort before submit sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await generate({}, { signal: controller.signal });
    expect(res.status).toBe(499);
    expect(res.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("abort during submit ends the wait and records an unknown submit", async () => {
    const controller = new AbortController();
    let seen;
    serve((_url, init) => {
      seen = init.signal;
      controller.abort();
      return new Promise(() => {});
    });
    const res = await generate({}, { signal: controller.signal });
    expect(res.status).toBe(499);
    expect(seen.aborted).toBe(true);
    expect(res.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });

  it("abort during a status read aborts the socket and records the accepted job", async () => {
    const controller = new AbortController();
    serve(accepted(), (_url, init) => {
      controller.abort();
      expect(init.signal.aborted).toBe(true);
      return status("IN_PROGRESS");
    });
    const res = await generate({}, { signal: controller.signal });
    expect(res.status).toBe(499);
    expect(res.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("abort while waiting between polls stops before the next request", async () => {
    const controller = new AbortController();
    serve(accepted(), status("IN_QUEUE"));
    const res = await generate({}, {
      signal: controller.signal,
      options: { wait: async () => { controller.abort(); throw controller.signal.reason; } },
    });
    expect(res.status).toBe(499);
    expect(res.acceptedJob).toBeDefined();
    expect(calls).toHaveLength(2);
  });
});

describe("dynamic discovery (fal_input)", () => {
  it("discovers the schema with the selected key on the fixed catalog origin, then submits the validated input", async () => {
    serve(catalog(), accepted(), status("COMPLETED"), result());
    const res = await generate({ fal_input: { lyrics: "[inst]", number_of_steps: 30, scheduler: "euler" } });
    expect(res.success).toBe(true);
    expect(calls[0].url).toBe("https://api.fal.ai/v1/models?endpoint_id=fal-ai%2Face-step&expand=openapi-3.0");
    expect(calls[0].url).toBe(falDiscoveryUrl("fal-ai/ace-step"));
    expect(calls[0].auth).toBe(`Key ${KEY_A}`);
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[1].body).toEqual({ tags: PROMPT, lyrics: "[inst]", number_of_steps: 30, scheduler: "euler" });
  });

  it.each([
    [{ bogus: 1 }, /Unsupported fal input: bogus/],
    [{ number_of_steps: 2 }, /number_of_steps must be >= 3/],
    [{ scheduler: "ddim" }, /scheduler is not an allowed value/],
    [{ duration: "30" }, /duration must be number/],
    [{ tags: "" }, /tags is too short/],
  ])("refuses fal_input %j after discovery, before submit", async (falInput, message) => {
    serve(catalog());
    const res = await generate({ fal_input: falInput });
    expect(res.status).toBe(400);
    expect((await errorBody(res)).message).toMatch(message);
    expect(res.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["endpoint not listed", catalog([]), 404],
    ["incomplete page", json({ models: [] }), 502],
    ["no OpenAPI document", catalog([{ endpoint_id: "fal-ai/ace-step", openapi: {} }]), 502],
    ["catalog 401", json({ detail: SECRET_ECHO }, 401), 401],
    ["catalog 500", json({ detail: SECRET_ECHO }, 500), 502],
  ])("%s: discovery fails without submitting or leaking", async (_name, response, expected) => {
    serve(response);
    const res = await generate({ fal_input: { lyrics: "x" } });
    expect(res.status).toBe(expected);
    expect(res.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
    await assertNoSecrets(res);
  });

  it("a connection-scoped store reuses a definition only for the same connection", async () => {
    const saved = new Map();
    const store = { get: (c, e) => saved.get(`${c}|${e}`) ?? null, save: (c, d) => saved.set(`${c}|${d.endpoint_id}`, d) };
    serve(catalog(), accepted(), status("COMPLETED"), result(), accepted(), status("COMPLETED"), result(), catalog(), accepted(), status("COMPLETED"), result());
    const options = { definitionStore: store };
    expect((await generate({ fal_input: { lyrics: "a" } }, { options })).success).toBe(true);
    expect((await generate({ fal_input: { lyrics: "b" } }, { options })).success).toBe(true);
    expect((await generate({ fal_input: { lyrics: "c" } }, { options, credentials: { apiKey: KEY_B, connectionId: "conn-b" } })).success).toBe(true);
    expect(calls.filter((c) => c.url.startsWith("https://api.fal.ai/")).map((c) => c.auth)).toEqual([`Key ${KEY_A}`, `Key ${KEY_B}`]);
  });

  it("abort during discovery sends nothing billable", async () => {
    const controller = new AbortController();
    serve(() => {
      controller.abort();
      throw controller.signal.reason;
    });
    const res = await generate({ fal_input: { lyrics: "x" } }, { signal: controller.signal });
    expect(res.status).toBe(499);
    expect(res.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("validateFalInput enforces required fields", () => {
    const definition = { endpoint_id: "fal-ai/ace-step", openapi: ACE_SCHEMA };
    expect(() => validateFalInput(definition, { lyrics: "x" })).toThrow(/tags is required/);
    expect(validateFalInput(definition, { tags: "x" })).toEqual({ tags: "x" });
  });
});

describe("helpers", () => {
  it("falTrackingUrl pins queue URLs to the origin and request id", () => {
    expect(falTrackingUrl(STATUS, REQ_ID, "status", null)).toBe(STATUS);
    expect(falTrackingUrl(undefined, REQ_ID, "status", "fallback")).toBe("fallback");
    expect(falTrackingUrl(`${STATUS}#x`, REQ_ID, "status", null)).toBeNull();
    expect(falTrackingUrl(`${STATUS}?redirect=https://evil.example`, REQ_ID, "status", null)).toBeNull();
    expect(falTrackingUrl(RESULT, REQ_ID, "status", null)).toBeNull();
    expect(falTrackingUrl(`https://fal.run/fal-ai/ace-step/requests/${REQ_ID}`, REQ_ID, "result", null)).toBeNull();
  });

  it("isFalRequestId accepts UUID-like ids only", () => {
    expect(isFalRequestId(REQ_ID)).toBe(true);
    for (const bad of ["", "short", "../../etc", `${REQ_ID}/x`, 42]) expect(isFalRequestId(bad)).toBe(false);
  });

  it("normalizeFalMusicResult derives the format like the source", () => {
    const fmt = (audio) => normalizeFalMusicResult({ audio }, { model: "ace-step", requestId: null, created: 1 }).payload?.data[0].format;
    expect(fmt({ url: AUDIO, content_type: "audio/flac" })).toBe("flac");
    expect(fmt({ url: "https://v3.fal.media/files/x/out.mp3" })).toBe("mp3");
    expect(fmt({ url: "https://v3.fal.media/files/x/out" })).toBe("wav");
  });

  it("runFalMusicJob refuses a missing key before any request", async () => {
    const res = await runFalMusicJob({ endpoint: "fal-ai/ace-step", request: { tags: "x" }, credentials: {} });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
