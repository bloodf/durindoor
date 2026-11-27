// Vertex AI Veo video generation, staged and unregistered. Closed mocks only:
// every request is answered below, an unexpected request fails the test, the
// token minter is injected, and every credential is synthetic. Passing here
// says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import defaultAdapter, {
  createVertexVideoAdapter,
  VERTEX_VIDEO_RESPONSE_FORMATS,
} from "../../open-sse/services/providerParity/native-vertex-video/adapter.js";
import {
  VERTEX_VIDEO_MODEL_IDS,
  VERTEX_VIDEO_PROVIDER_ALIASES,
  VERTEX_VIDEO_PROVIDER_ID,
  VERTEX_VIDEO_PROVIDER_METADATA,
} from "../../open-sse/services/providerParity/native-vertex-video/config.js";
import { buildVertexVideoRequest } from "../../open-sse/services/providerParity/native-vertex-video/request.js";
import { vertexVideoScope } from "../../open-sse/services/providerParity/native-vertex-video/auth.js";
import {
  isVertexVideoOperationName,
  vertexVideoMp4Base64,
} from "../../open-sse/services/providerParity/native-vertex-video/job.js";
import * as bundle from "../../open-sse/services/providerParity/native-vertex-video/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { handleVideoGenerationCore } from "../../open-sse/handlers/videoGenerationCore.js";
import vertexRegistry from "../../open-sse/providers/registry/vertex.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const MODEL = "veo-3.1-generate-001";
const PROJECT_A = "synthetic-proj-a";
const PROJECT_B = "synthetic-proj-b";
const PROMPT = "a paper lantern drifting over a still mountain lake";
const TOKEN_A = "ya29.SYNTHETIC-token-a-0001";
const TOKEN_B = "ya29.SYNTHETIC-token-b-0002";
const EXPRESS_KEY = "AQ.SYNTHETIC-express-key-0003";
const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nSYNTHETICKEYMATERIAL\\n-----END PRIVATE KEY-----\\n";
const saJson = (project) => JSON.stringify({
  type: "service_account",
  project_id: project,
  client_email: `video@${project}.iam.gserviceaccount.com`,
  private_key: PRIVATE_KEY,
});
const SA_A = saJson(PROJECT_A);
const SA_B = saJson(PROJECT_B);
const ADC = JSON.stringify({ type: "authorized_user", client_id: "cid", client_secret: "csecret-SYNTHETIC", refresh_token: "1//SYNTHETIC-refresh", quota_project_id: PROJECT_B });

const regional = (project = PROJECT_A, location = "us-central1", model = MODEL) =>
  `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}`;
const SUBMIT_A = `${regional()}:predictLongRunning`;
const POLL_A = `${regional()}:fetchPredictOperation`;
const opName = (project = PROJECT_A, location = "us-central1", model = MODEL, id = "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7") =>
  `projects/${project}/locations/${location}/publishers/google/models/${model}/operations/${id}`;
const OP_A = opName();

// A minimal ISO BMFF header: size, "ftyp", brand.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(12, 1)]).toString("base64");

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const accepted = (name = OP_A) => json({ name });
const running = (name = OP_A) => json({ name, done: false });
const done = (response, name = OP_A) => json({ name, done: true, response });
const videoDone = (video = { bytesBase64Encoded: MP4, mimeType: "video/mp4" }, name = OP_A) =>
  done({ "@type": "type.googleapis.com/cloud.ai.large_models.vision.GenerateVideoResponse", videos: [video] }, name);
const googleError = (status, code, reason, message = `upstream echo ${TOKEN_A} ${PROMPT}`, headers = {}) =>
  json({ error: { code: status, message, status: code, ...(reason ? { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] } : null) } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${TOKEN_A}`), { code }) });

const originalFetch = global.fetch;
let calls;
let clock;
let mints;

function serve(...steps) {
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    return isFunction(step) ? step(String(url), init) : step;
  });
}

const minter = (tokens = { [PROJECT_A]: TOKEN_A, [PROJECT_B]: TOKEN_B }) => async ({ sa, adc }) => {
  mints.push(sa ? `sa:${sa.project_id}` : `adc:${adc.quota_project_id}`);
  return tokens[sa?.project_id ?? adc?.quota_project_id] ?? null;
};
const polling = () => ({
  pollIntervalMs: 1_000,
  timeoutMs: 10_000,
  mintToken: minter(),
  wait: async (ms, signal) => {
    signal?.throwIfAborted();
    clock += ms;
  },
  now: () => clock,
});
const adapter = (options = {}) => createVertexVideoAdapter({ ...polling(), ...options });
const generate = (body = {}, { model = MODEL, credentials = { apiKey: SA_A }, signal, options } = {}) =>
  adapter(options).generate({ model, body: { prompt: PROMPT, ...body }, credentials, signal });
const errorBody = async (result) => (await result.response.clone().json()).error;
const assertNoSecrets = async (result) => {
  const text = await result.response.clone().text();
  for (const secret of [TOKEN_A, TOKEN_B, EXPRESS_KEY, PROMPT, "SYNTHETICKEYMATERIAL", "upstream echo"]) expect(text).not.toContain(secret);
};

beforeEach(() => {
  calls = [];
  mints = [];
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
describe("staging state (pre-registration only)", () => {
  it("is not registered: the public dispatch still has no vertex video adapter", () => {
    expect(getVideoGenerationAdapter("vertex")).toBeNull();
    expect(getVideoGenerationAdapter("vx")).toBeNull();
    expect(vertexRegistry.serviceKinds).not.toContain("video");
  });
});

describe("metadata", () => {
  it("uses the existing vertex provider id, aliases and the five source model ids", () => {
    expect(VERTEX_VIDEO_PROVIDER_ID).toBe(vertexRegistry.id);
    expect(VERTEX_VIDEO_PROVIDER_ALIASES).toEqual(vertexRegistry.aliases);
    expect(VERTEX_VIDEO_MODEL_IDS).toEqual([
      "veo-3.1-generate-001", "veo-3.1-fast-generate-001", "veo-3.0-generate-001", "veo-3.0-fast-generate-001", "veo-2.0-generate-001",
    ]);
    expect(VERTEX_VIDEO_PROVIDER_METADATA).toMatchObject({ format: "vertex-veo", serviceKinds: ["video"], responseFormats: ["b64_json"] });
    expect(defaultAdapter).toMatchObject({ async: true, responseFormats: VERTEX_VIDEO_RESPONSE_FORMATS, defaultResponseFormat: "b64_json" });
    expect(bundle.vertexVideoAdapter).toBe(defaultAdapter);
  });

  it("registration.json describes the exports, ids, models and integration points", () => {
    const registration = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-vertex-video/registration.json", import.meta.url), "utf8"));
    expect(registration.status).toBe("staged-unregistered");
    expect(registration.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(registration.source.registryEntry).toEqual({
      id: "vertex", baseUrl: "https://us-central1-aiplatform.googleapis.com/v1", authType: "apikey", authHeader: "bearer", format: "vertex-veo",
    });
    expect(registration.provider).toMatchObject({ canonicalId: "vertex", aliases: ["vx"], serviceKindsToAdd: ["video"] });
    expect(registration.models.map((model) => model.id)).toEqual(VERTEX_VIDEO_MODEL_IDS);
    for (const name of ["createVertexVideoAdapter", "buildVertexVideoRequest", "runVertexVideoJob", "VERTEX_VIDEO_PROVIDER_METADATA"]) {
      expect(bundle[name]).toBeDefined();
    }
    expect(registration.publicHandlerIntegration.map((entry) => entry.file)).toContain("open-sse/handlers/videoProviders/index.js");
  });
});

describe("request contract", () => {
  it("builds the source body with sampleCount 1", () => {
    expect(buildVertexVideoRequest(MODEL, { prompt: PROMPT })).toEqual({ instances: [{ prompt: PROMPT }], parameters: { sampleCount: 1 } });
    expect(buildVertexVideoRequest(MODEL, { prompt: PROMPT, aspect_ratio: "9:16", duration: 8, negative_prompt: "rain" })).toEqual({
      instances: [{ prompt: PROMPT }],
      parameters: { sampleCount: 1, aspectRatio: "9:16", durationSeconds: 8, negativePrompt: "rain" },
    });
    expect(buildVertexVideoRequest("veo-2.0-generate-001", { prompt: PROMPT, aspectRatio: "16:9", durationSeconds: 5 }).parameters)
      .toEqual({ sampleCount: 1, aspectRatio: "16:9", durationSeconds: 5 });
    expect(buildVertexVideoRequest(MODEL, { prompt: PROMPT, size: "16:9" }).parameters.aspectRatio).toBe("16:9");
  });

  it.each([
    [{ prompt: "  " }, /nonempty text prompt/],
    [{ prompt: PROMPT, image: "data:image/png;base64,AAAA" }, /text-to-video only; remove image/],
    [{ prompt: PROMPT, input_reference: "x" }, /text-to-video only/],
    [{ prompt: PROMPT, n: 2 }, /n must be 1/],
    [{ prompt: PROMPT, stream: true }, /does not stream/],
    [{ prompt: PROMPT, size: "1280x720" }, /aspect ratio must be one of: 16:9, 9:16/],
    [{ prompt: PROMPT, aspect_ratio: "1:1" }, /aspect ratio/],
    [{ prompt: PROMPT, aspect_ratio: "16:9", size: "9:16" }, /disagree/],
    [{ prompt: PROMPT, duration: 5 }, /duration must be one of: 4, 6, 8/],
    [{ prompt: PROMPT, duration: "8" }, /duration must be one of/],
    [{ prompt: PROMPT, negative_prompt: 3 }, /negative_prompt must be a string/],
  ])("refuses %j before anything is sent", async (body, message) => {
    const result = await adapter().generate({ model: MODEL, body, credentials: { apiKey: SA_A } });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(0);
    expect(mints).toHaveLength(0);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("refuses models outside the source list, including chat models and Gemini-API preview names", async () => {
    for (const model of ["gemini-2.5-flash", "veo-3.1-generate-preview", "veo-2.0-generate-001 "]) {
      const result = await generate({}, { model });
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/Unsupported Vertex video model/);
    }
    expect(calls).toHaveLength(0);
  });

  it("checks durations per model", () => {
    expect(() => buildVertexVideoRequest("veo-2.0-generate-001", { prompt: PROMPT, duration: 4 })).toThrow(/5, 6, 7, 8/);
    expect(() => buildVertexVideoRequest("veo-3.0-fast-generate-001", { prompt: PROMPT, duration: 7 })).toThrow(/4, 6, 8/);
  });

  it("offers b64_json only, and the public core sends nothing for response_format url", async () => {
    // Holds staged (provider not dispatched) and registered (format refused by generateWithAdapter).
    expect(defaultAdapter.responseFormats).toEqual(["b64_json"]);
    const result = await handleVideoGenerationCore({ provider: "vertex", model: MODEL, body: { prompt: PROMPT, response_format: "url" }, credentials: { apiKey: SA_A } });
    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("credential scope", () => {
  it("SA JSON: project-scoped regional endpoint with Bearer token", () => {
    expect(vertexVideoScope({ apiKey: SA_A })).toMatchObject({ mode: "bearer", project: PROJECT_A, location: "us-central1", origin: "https://us-central1-aiplatform.googleapis.com" });
  });

  it("keeps the connection's location and project", () => {
    expect(vertexVideoScope({ apiKey: SA_A, providerSpecificData: { location: "europe-west4" } })).toMatchObject({ location: "europe-west4", origin: "https://europe-west4-aiplatform.googleapis.com" });
    expect(vertexVideoScope({ apiKey: ADC })).toMatchObject({ mode: "bearer", project: PROJECT_B });
    expect(vertexVideoScope({ accessToken: TOKEN_A, providerSpecificData: { projectId: PROJECT_B } })).toMatchObject({ mode: "bearer", project: PROJECT_B });
    expect(vertexVideoScope({ apiKey: EXPRESS_KEY })).toMatchObject({ mode: "express", origin: "https://aiplatform.googleapis.com" });
  });

  it.each([
    [{ apiKey: SA_A, providerSpecificData: { location: "global" } }, 400, /regional location/],
    [{ apiKey: SA_A, providerSpecificData: { location: "evil.example.com/x" } }, 400, /regional location/],
    [{ accessToken: TOKEN_A }, 400, /project id/],
    [{ apiKey: "{\"web\":{\"client_secret\":\"x\"}}" }, 401, /not a Service Account/],
    [{ apiKey: "{not json" }, 401, /malformed credential JSON/],
    [{}, 401, /requires a Service Account JSON/],
  ])("refuses %j before submit", async (credentials, status, message) => {
    const result = await generate({}, { credentials });
    expect(result.status).toBe(status);
    expect(result.error).toMatch(message);
    expect(calls).toHaveLength(0);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("a failed token mint is a 401 with nothing sent", async () => {
    const result = await generate({}, { options: { mintToken: async () => null } });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("a hung token mint is bounded and abortable", async () => {
    const hung = () => new Promise(() => {});
    const timed = await generate({}, { options: { mintToken: hung, tokenTimeoutMs: 5 } });
    expect(timed.status).toBe(504);
    const controller = new AbortController();
    const pending = generate({}, { signal: controller.signal, options: { mintToken: hung } });
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(calls).toHaveLength(0);
  });
});

describe("success", () => {
  it("submits, polls and returns the inline MP4 with exact wire shape", async () => {
    serve(accepted(), running(), videoDone());
    const result = await generate({ aspect_ratio: "16:9", duration: 6, negative_prompt: "blur" });
    expect(result.success).toBe(true);
    const payload = await result.response.json();
    expect(payload.data).toEqual([{ b64_json: MP4, format: "mp4" }]);
    expect(Number.isInteger(payload.created)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "video", nativeUnits: { videos: 1 }, cost: null, costStatus: "unknown" });
    expect(result.accounting.meta.nativeUnitsSource).toBe("returned-videos");

    expect(calls.map((call) => [call.url, call.init.method])).toEqual([[SUBMIT_A, "POST"], [POLL_A, "POST"], [POLL_A, "POST"]]);
    const [submit, poll] = calls;
    expect(submit.init.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${TOKEN_A}` });
    expect(submit.init.redirect).toBe("manual");
    expect(submit.body).toEqual({
      instances: [{ prompt: PROMPT }],
      parameters: { sampleCount: 1, aspectRatio: "16:9", durationSeconds: 6, negativePrompt: "blur" },
    });
    expect(poll.init.headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(poll.init.redirect).toBe("error");
    expect(poll.body).toEqual({ operationName: OP_A });
    expect(mints).toEqual([`sa:${PROJECT_A}`]);
  });

  it("Express key goes on the project-less global endpoint as ?key= with no Authorization header", async () => {
    const op = opName("123456789012", "us-central1");
    serve(accepted(op), videoDone(undefined, op));
    const result = await generate({}, { credentials: { apiKey: EXPRESS_KEY } });
    expect(result.success).toBe(true);
    const base = `https://aiplatform.googleapis.com/v1/publishers/google/models/${MODEL}`;
    expect(calls.map((call) => call.url)).toEqual([
      `${base}:predictLongRunning?key=${encodeURIComponent(EXPRESS_KEY)}`,
      `${base}:fetchPredictOperation?key=${encodeURIComponent(EXPRESS_KEY)}`,
    ]);
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(mints).toHaveLength(0);
  });

  it("a preset access token with a project id is used as is", async () => {
    serve(accepted(opName(PROJECT_B)), videoDone(undefined, opName(PROJECT_B)));
    const result = await generate({}, { credentials: { accessToken: TOKEN_B, providerSpecificData: { projectId: PROJECT_B } } });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe(`${regional(PROJECT_B)}:predictLongRunning`);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
    expect(mints).toHaveLength(0);
  });

  it("two credentials stay in their own project, location and token", async () => {
    const opB = opName(PROJECT_B, "europe-west4", "veo-2.0-generate-001");
    serve(accepted(), videoDone(), accepted(opB), videoDone(undefined, opB));
    const a = await generate({}, { credentials: { apiKey: SA_A } });
    const b = await generate({}, { model: "veo-2.0-generate-001", credentials: { apiKey: SA_B, providerSpecificData: { location: "europe-west4" } } });
    expect(a.success && b.success).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      SUBMIT_A, POLL_A,
      `${regional(PROJECT_B, "europe-west4", "veo-2.0-generate-001")}:predictLongRunning`,
      `${regional(PROJECT_B, "europe-west4", "veo-2.0-generate-001")}:fetchPredictOperation`,
    ]);
    expect(calls.slice(0, 2).every((call) => call.init.headers.Authorization === `Bearer ${TOKEN_A}`)).toBe(true);
    expect(calls.slice(2).every((call) => call.init.headers.Authorization === `Bearer ${TOKEN_B}`)).toBe(true);
    expect(mints).toEqual([`sa:${PROJECT_A}`, `sa:${PROJECT_B}`]);
  });

  it("ADC credentials mint through the ADC refresher scope", async () => {
    const op = opName(PROJECT_B);
    serve(accepted(op), videoDone(undefined, op));
    const result = await generate({}, { credentials: { apiKey: ADC } });
    expect(result.success).toBe(true);
    expect(mints).toEqual([`adc:${PROJECT_B}`]);
    expect(calls[0].url).toBe(`${regional(PROJECT_B)}:predictLongRunning`);
  });
});

describe("submit failures", () => {
  it.each([
    [400, "INVALID_ARGUMENT", null, 400],
    [403, "PERMISSION_DENIED", "IAM_PERMISSION_DENIED", 403],
    [404, "NOT_FOUND", null, 404],
    [401, "UNAUTHENTICATED", null, 401],
  ])("%i %s is refused without acceptedJob or upstream text", async (status, code, reason, expected) => {
    serve(googleError(status, code, reason));
    const result = await generate();
    expect(result.status).toBe(expected);
    expect(result.error).toContain(code);
    expect(result.acceptedJob).toBeUndefined();
    expect(result.quotaExhausted).toBeUndefined();
    await assertNoSecrets(result);
    expect(calls).toHaveLength(1);
  });

  it("billing disabled is a 402 quota exhaustion on this connection", async () => {
    serve(googleError(403, "PERMISSION_DENIED", "BILLING_DISABLED"));
    const result = await generate();
    expect(result).toMatchObject({ status: 402, quotaExhausted: true });
    expect(result.acceptedJob).toBeUndefined();
    await assertNoSecrets(result);
  });

  it("429 carries Retry-After evidence", async () => {
    serve(googleError(429, "RESOURCE_EXHAUSTED", null, "quota", { "retry-after": "30" }));
    const result = await generate();
    expect(result.status).toBe(429);
    expect(result.rateLimitEvidence?.source).toBe("retry_after");
    expect(result.response.headers.get("Retry-After")).toBeTruthy();
  });

  it("5xx submit is unknown: acceptedJob and no replay", async () => {
    serve(googleError(503, "UNAVAILABLE", null));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expect(calls).toHaveLength(1);
    await assertNoSecrets(result);
  });

  it("a connection error after send is unknown and never resent; a pre-connect failure is not", async () => {
    serve(() => { throw transportError("ECONNRESET"); });
    const reset = await generate();
    expect(reset.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
    await assertNoSecrets(reset);

    calls = [];
    serve(() => { throw transportError("ECONNREFUSED"); });
    const refusedConnect = await generate();
    expect(refusedConnect.status).toBe(502);
    expect(refusedConnect.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("a hung submit is bounded by the submit deadline and reported as unknown", async () => {
    serve(() => new Promise(() => {}));
    const result = await generate({}, { options: { submitTimeoutMs: 5 } });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it("redirects are refused and never followed with the credential", async () => {
    serve(new Response(null, { status: 302, headers: { location: "https://evil.example.com/" } }));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/redirect refused/);
    expect(calls).toHaveLength(1);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("a response from another origin is discarded as an unknown submit", async () => {
    serve(() => {
      const response = accepted();
      Object.defineProperty(response, "url", { value: "https://evil.example.com/v1/x" });
      return response;
    });
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["missing", {}],
    ["another model", { name: opName(PROJECT_A, "us-central1", "veo-2.0-generate-001") }],
    ["another location", { name: opName(PROJECT_A, "europe-west4") }],
    ["path traversal", { name: `${OP_A}/../../x` }],
  ])("an unusable operation name (%s) is unknown and not polled", async (_label, body) => {
    serve(json(body));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(1);
  });

  it("an unreadable accept body is unknown", async () => {
    serve(new Response("<html>oops</html>", { status: 200 }));
    const result = await generate();
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    await assertNoSecrets(result);
  });
});

describe("operation outcomes", () => {
  it("a failed operation is an ordinary failure with only the rpc code", async () => {
    serve(accepted(), json({ name: OP_A, done: true, error: { code: 3, message: `blocked ${PROMPT}` } }));
    const result = await generate();
    expect(result.status).toBe(400);
    expect(result.error).toBe("Vertex Veo operation failed (code 3)");
    expect(result.acceptedJob).toBeUndefined();
    await assertNoSecrets(result);
  });

  it.each([
    ["no video", { videos: [] }, /without a video/],
    ["safety filtered", { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["x"] }, /safety filters/],
    ["gcs only", { videos: [{ gcsUri: "gs://bucket/out.mp4", mimeType: "video/mp4" }] }, /Cloud Storage location/],
    ["not mp4 mime", { videos: [{ bytesBase64Encoded: MP4, mimeType: "video/webm" }] }, /not MP4/],
    ["not base64", { videos: [{ bytesBase64Encoded: "!!!!not-base64!!!!" }] }, /unreadable video bytes/],
    ["not an mp4 container", { videos: [{ bytesBase64Encoded: Buffer.from("<html>not a video at all</html>").toString("base64") }] }, /unreadable video bytes/],
  ])("%s is a completed but unusable job: acceptedJob", async (_label, response, message) => {
    serve(accepted(), done(response));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.error).toMatch(message);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("an answer about another operation is unknown", async () => {
    serve(accepted(), videoDone(undefined, opName(PROJECT_A, "us-central1", MODEL, "other")));
    const result = await generate();
    expect(result.error).toMatch(/different operation/);
    expect(result.acceptedJob).toBeDefined();
  });

  it("poll 429/503 backs off within bounds, then succeeds", async () => {
    serve(accepted(), json({}, 429, { "retry-after": "2" }), json({}, 503), videoDone());
    const start = clock;
    const result = await generate();
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(4);
    expect(clock - start).toBe(1_000 + 2_000 + 2_000);
  });

  it("poll 404 or 500 loses sight of the job: acceptedJob, no resubmit", async () => {
    serve(accepted(), json({}, 404));
    const result = await generate();
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls.filter((call) => call.url.endsWith(":predictLongRunning"))).toHaveLength(1);
  });

  it("the job deadline ends polling with 504 and acceptedJob", async () => {
    serve(accepted(), ...Array.from({ length: 20 }, () => running()));
    const result = await generate();
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls.length).toBeLessThanOrEqual(11);
  });

  it("an oversized poll body is unknown, not parsed", async () => {
    serve(accepted(), () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
        controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    })));
    const job = await import("../../open-sse/services/providerParity/native-vertex-video/job.js");
    expect(job.VERTEX_VIDEO_MAX_RESULT_BYTES).toBe(64 * 1024 * 1024);
    const result = await generate({}, { options: { maxResultBytes: 1500 } });
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/unreadable operation response/);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
  });
});

describe("cancellation", () => {
  it("abort before submit sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(calls).toHaveLength(0);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("abort during submit ends the wait and records an unknown submit", async () => {
    const controller = new AbortController();
    let seen;
    serve((_url, init) => {
      seen = init.signal;
      controller.abort();
      return new Promise(() => {});
    });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(seen.aborted).toBe(true);
    expect(result.acceptedJob?.meta.jobState).toBe("submit-unknown");
  });

  it("abort during polling stops the poll and records the accepted job", async () => {
    const controller = new AbortController();
    serve(accepted(), (_url, init) => {
      controller.abort();
      expect(init.signal.aborted).toBe(true);
      return running();
    });
    const result = await generate({}, { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted");
    expect(calls).toHaveLength(2);
  });

  it("abort while waiting between polls stops before the next request", async () => {
    const controller = new AbortController();
    serve(accepted());
    const result = await generate({}, {
      signal: controller.signal,
      options: { wait: async () => { controller.abort(); throw controller.signal.reason; } },
    });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeDefined();
    expect(calls).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("operation names must be of this model and location", () => {
    expect(isVertexVideoOperationName(OP_A, { model: MODEL, location: "us-central1" })).toBe(true);
    expect(isVertexVideoOperationName(OP_A, { model: MODEL })).toBe(true);
    expect(isVertexVideoOperationName(OP_A, { model: "veo-2.0-generate-001" })).toBe(false);
    expect(isVertexVideoOperationName(`https://evil.example.com/${OP_A}`, { model: MODEL })).toBe(false);
    expect(isVertexVideoOperationName(123, { model: MODEL })).toBe(false);
  });

  it("MP4 detection needs base64 with an ftyp box", () => {
    expect(vertexVideoMp4Base64(MP4)).toBe(MP4);
    expect(vertexVideoMp4Base64("AAAA")).toBeNull();
    expect(vertexVideoMp4Base64(`${MP4}\n`)).toBeNull();
  });
});
