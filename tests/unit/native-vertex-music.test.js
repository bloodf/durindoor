// Closed-network contract tests for the staged native Vertex Lyria music adapter.
// Source: OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad
// open-sse/config/musicRegistry.ts, open-sse/handlers/musicGeneration.ts,
// open-sse/executors/vertexMedia.ts (vertexGenerateMusic).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  VERTEX_MUSIC_CONFIG,
  buildVertexMusicEndpoint,
  buildVertexMusicRequest,
  classifyVertexMusicAuth,
  handleVertexMusicGeneration,
  isVertexMusicProvider,
  listVertexMusicModels,
  vertexMusicOrigin,
  wavDurationSeconds,
} from "../../open-sse/services/providerParity/native-vertex-music/index.js";

const STAGING_DIR = new URL("../../open-sse/services/providerParity/native-vertex-music/", import.meta.url);

function wav(seconds = 1, byteRate = 192000) {
  const dataSize = Math.round(seconds * byteRate);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(48000, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf.toString("base64");
}

const SA_A = { type: "service_account", project_id: "proj-alpha", client_email: "a@proj-alpha.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nA\n-----END PRIVATE KEY-----\n" };
const SA_B = { type: "service_account", project_id: "proj-bravo", client_email: "b@proj-bravo.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nB\n-----END PRIVATE KEY-----\n" };
const ADC = { type: "authorized_user", client_id: "adc-client", client_secret: "adc-secret", refresh_token: "adc-refresh", quota_project_id: "proj-charlie" };

const saCreds = (sa = SA_A, psd = {}, connectionId = "conn-a") => ({ apiKey: JSON.stringify(sa), providerSpecificData: psd, connectionId });
const expressCreds = (key = "AQ.express-key-123", connectionId = "conn-x") => ({ apiKey: key, providerSpecificData: {}, connectionId });

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function harness(responder) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init, proxyOptions) => {
    calls.push({ url, init, proxyOptions });
    return responder(calls.length - 1, { url, init });
  });
  const mintServiceAccountToken = vi.fn(async (sa) => ({ accessToken: `token-for-${sa.project_id}`, expiresAt: Date.now() + 3600_000 }));
  const refreshAdcToken = vi.fn(async () => ({ accessToken: "adc-access-token" }));
  return { calls, deps: { fetchImpl, mintServiceAccountToken, refreshAdcToken } };
}

async function bodyOf(result) {
  return JSON.parse(await result.response.text());
}

describe("native-vertex-music: source-derived wire contract", () => {
  it("exposes the pinned registry fields", () => {
    expect(VERTEX_MUSIC_CONFIG).toMatchObject({
      id: "vertex",
      baseUrl: "https://us-central1-aiplatform.googleapis.com/v1",
      authType: "apikey",
      authHeader: "bearer",
      format: "vertex-lyria",
    });
    expect(listVertexMusicModels()).toEqual([{ id: "lyria-002", name: "Lyria 2 (Vertex)", provider: "vertex", serviceKinds: ["music"] }]);
    expect(isVertexMusicProvider("vertex")).toBe(true);
    expect(isVertexMusicProvider("vx")).toBe(true);
    expect(isVertexMusicProvider("gemini")).toBe(false);
  });

  it("Service Account: project-scoped regional :predict with Bearer and exact body", async () => {
    const audio = wav(2);
    const { calls, deps } = harness(() => jsonResponse({ predictions: [{ bytesBase64Encoded: audio, mimeType: "audio/wav" }] }));
    const result = await handleVertexMusicGeneration({
      model: "lyria-002",
      body: { model: "vertex/lyria-002", prompt: "relaxing sax", negative_prompt: "drums", seed: 42 },
      credentials: saCreds(),
      ...deps,
    });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://us-central1-aiplatform.googleapis.com/v1/projects/proj-alpha/locations/us-central1/publishers/google/models/lyria-002:predict");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer token-for-proj-alpha" });
    expect(JSON.parse(calls[0].init.body)).toEqual({ instances: [{ prompt: "relaxing sax", negative_prompt: "drums", seed: 42 }], parameters: {} });
    expect(deps.mintServiceAccountToken).toHaveBeenCalledWith(SA_A, null, calls[0].proxyOptions);

    const body = await bodyOf(result);
    expect(body).toMatchObject({ object: "music.generation", provider: "vertex", model: "lyria-002", status: "completed" });
    expect(body.data).toEqual([{ b64_json: audio, format: "wav", mime_type: "audio/wav", duration_seconds: 2 }]);
    expect(body.raw).toBeUndefined();
    expect(result.connectionId).toBe("conn-a");
    expect(result.accounting).toMatchObject({ state: "complete", modality: "music", cost: null, costStatus: "unknown", nativeUnits: { audioSeconds: 2 } });
    expect(result.accounting.meta.clips).toBe(1);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("Express key: project-less publisher endpoint with ?key= and no Authorization", async () => {
    const { calls, deps } = harness(() => jsonResponse({ predictions: [{ bytesBase64Encoded: wav(1) }] }));
    const result = await handleVertexMusicGeneration({ model: "", body: { prompt: "lofi", sample_count: 2 }, credentials: expressCreds(), ...deps });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe("https://aiplatform.googleapis.com/v1/publishers/google/models/lyria-002:predict?key=AQ.express-key-123");
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(calls[0].init.body)).toEqual({ instances: [{ prompt: "lofi" }], parameters: { sample_count: 2 } });
    expect(deps.mintServiceAccountToken).not.toHaveBeenCalled();
  });

  it("ADC uses quota_project_id and refresh token; preset OAuth token uses providerSpecificData.projectId", async () => {
    const { calls, deps } = harness(() => jsonResponse({ predictions: [{ bytesBase64Encoded: wav(1) }] }));
    await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "a" }, credentials: { apiKey: JSON.stringify(ADC), connectionId: "conn-adc" }, ...deps });
    expect(deps.refreshAdcToken).toHaveBeenCalledWith("adc-refresh", "adc-client", "adc-secret", null, calls[0].proxyOptions);
    expect(calls[0].url).toContain("/projects/proj-charlie/locations/us-central1/");
    expect(calls[0].init.headers.Authorization).toBe("Bearer adc-access-token");

    await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "b" }, credentials: { accessToken: "preset-oauth", providerSpecificData: { projectId: "proj-delta", location: "europe-west4" } }, ...deps });
    expect(calls[1].url).toBe("https://europe-west4-aiplatform.googleapis.com/v1/projects/proj-delta/locations/europe-west4/publishers/google/models/lyria-002:predict");
    expect(calls[1].init.headers.Authorization).toBe("Bearer preset-oauth");
  });

  it("honours the source `region` field and local multi-region hosts", () => {
    expect(classifyVertexMusicAuth(saCreds(SA_A, { region: "asia-southeast1" }))).toMatchObject({ location: "asia-southeast1", origin: "https://asia-southeast1-aiplatform.googleapis.com" });
    expect(vertexMusicOrigin("us")).toBe("https://aiplatform.us.rep.googleapis.com");
    expect(vertexMusicOrigin("global")).toBe("https://aiplatform.googleapis.com");
    const auth = classifyVertexMusicAuth(saCreds(SA_A, { location: "eu" }));
    expect(buildVertexMusicEndpoint(auth, "lyria-002", "t").url).toBe("https://aiplatform.eu.rep.googleapis.com/v1/projects/proj-alpha/locations/eu/publishers/google/models/lyria-002:predict");
  });

  it("two credentials keep their own project, token and connection identity", async () => {
    const { calls, deps } = harness(() => jsonResponse({ predictions: [{ bytesBase64Encoded: wav(1) }] }));
    const a = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(SA_A, {}, "conn-a"), ...deps });
    const b = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(SA_B, { location: "us-east4" }, "conn-b"), ...deps });
    expect(calls[0].url).toContain("/projects/proj-alpha/locations/us-central1/");
    expect(calls[0].init.headers.Authorization).toBe("Bearer token-for-proj-alpha");
    expect(calls[1].url).toBe("https://us-east4-aiplatform.googleapis.com/v1/projects/proj-bravo/locations/us-east4/publishers/google/models/lyria-002:predict");
    expect(calls[1].init.headers.Authorization).toBe("Bearer token-for-proj-bravo");
    expect([a.connectionId, b.connectionId]).toEqual(["conn-a", "conn-b"]);
  });

  it("normalizes multiple clips and sums measured WAV seconds", async () => {
    const { deps } = harness(() => jsonResponse({ predictions: [{ bytesBase64Encoded: wav(1.5) }, { bytesBase64Encoded: wav(0.5) }] }));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x", sample_count: 2 }, credentials: expressCreds(), ...deps });
    expect((await bodyOf(result)).data.map((d) => d.duration_seconds)).toEqual([1.5, 0.5]);
    expect(result.accounting.nativeUnits.audioSeconds).toBe(2);
    expect(result.accounting.meta.clips).toBe(2);
  });
});

describe("native-vertex-music: input rejection before any billable call", () => {
  const cases = [
    [{ prompt: "" }, /prompt/],
    [{ prompt: "x", stream: true }, /stream/],
    [{ prompt: "x", lyrics: "la" }, /lyrics/],
    [{ prompt: "x", audio_url: "https://e.x/a.wav" }, /audio_url/],
    [{ prompt: "x", duration: 60 }, /duration/],
    [{ prompt: "x", response_format: "url" }, /b64_json/],
    [{ prompt: "x", output_format: "mp3" }, /WAV/],
    [{ prompt: "x", is_instrumental: false }, /instrumental/],
    [{ prompt: "x", seed: 1, sample_count: 2 }, /seed cannot be combined/],
    [{ prompt: "x", sample_count: 5 }, /sample_count/],
    [{ prompt: "x", seed: -1 }, /seed/],
    [{ prompt: "x", negative_prompt: 3 }, /negative_prompt/],
  ];
  it.each(cases)("rejects %j", async (body, message) => {
    const { calls, deps } = harness(() => { throw new Error("must not be called"); });
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body, credentials: saCreds(), ...deps });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(message);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(deps.mintServiceAccountToken).not.toHaveBeenCalled();
  });

  it("rejects unknown models and missing project/invalid location", async () => {
    expect(buildVertexMusicRequest("lyria-3-pro-preview", { prompt: "x" }).error).toMatch(/Unsupported Vertex music model/);
    const { calls, deps } = harness(() => { throw new Error("must not be called"); });
    const noProject = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: { accessToken: "t" }, ...deps });
    expect(noProject.status).toBe(401);
    const badLocation = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(SA_A, { location: "evil.example.com/x" }), ...deps });
    expect(badLocation.status).toBe(401);
    expect(badLocation.error).toMatch(/invalid location/);
    const oauthClient = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: { apiKey: JSON.stringify({ web: { client_id: "c", client_secret: "s" } }) }, ...deps });
    expect(oauthClient.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("fails closed when token minting yields nothing", async () => {
    const { calls, deps } = harness(() => jsonResponse({}));
    deps.mintServiceAccountToken.mockResolvedValueOnce(null);
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), ...deps });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("native-vertex-music: upstream failures, quota and secrecy", () => {
  it("429 keeps quota status, Retry-After reset and no accepted job; body is not echoed", async () => {
    const { deps } = harness(() => jsonResponse({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for project proj-alpha secret-detail" } }, 429, { "Retry-After": "30" }));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), now: () => 1_000_000, ...deps });
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBe(1_030_000);
    expect(result.error).toBe("Vertex Lyria refused the request (HTTP 429 RESOURCE_EXHAUSTED)");
    expect(result.error).not.toMatch(/secret-detail/);
    expect(result.acceptedJob).toBeUndefined();
    expect(result.outcome).toBe("refused");
  });

  it("400/403 are refusals; unknown 4xx collapse to 502", async () => {
    for (const [status, expected] of [[400, 400], [403, 403], [409, 502]]) {
      const { deps } = harness(() => jsonResponse({ error: { status: "X" } }, status));
      const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), ...deps });
      expect(result.status).toBe(expected);
      expect(result.acceptedJob).toBeUndefined();
    }
  });

  it("500 is an uncertain submit with an unknown-cost accepted job and is not replayed", async () => {
    const { calls, deps } = harness(() => new Response("<html>internal</html>", { status: 500 }));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), ...deps });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.outcome).toBe("outcome_unknown");
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", cost: null, modality: "music", meta: { jobState: "submit_outcome_unknown", httpStatus: 500 } });
    expect(result.error).not.toMatch(/internal/);
  });

  it("network failure after dispatch is uncertain and not resubmitted", async () => {
    const { calls, deps } = harness(() => { throw new TypeError("socket hang up"); });
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: expressCreds("AQ.super-secret-key"), ...deps });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("submit_outcome_unknown");
    expect(JSON.stringify(result.response ? await result.response.text() : "")).not.toMatch(/super-secret-key/);
    expect(result.error).not.toMatch(/super-secret-key/);
  });

  it("redirects are refused without following", async () => {
    const { calls, deps } = harness(() => new Response(null, { status: 307, headers: { Location: "https://evil.example.com/" } }));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), ...deps });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.outcome).toBe("refused");
    expect(result.error).toMatch(/redirect was not followed/);
  });

  it.each([
    ["no predictions", { predictions: [] }],
    ["invalid base64", { predictions: [{ bytesBase64Encoded: "@@not-base64@@" }] }],
    ["not a WAV container", { predictions: [{ bytesBase64Encoded: Buffer.from("ID3 mp3 data here").toString("base64") }] }],
    ["unexpected mime type", { predictions: [{ bytesBase64Encoded: wav(1), mimeType: "text/html" }] }],
  ])("malformed 2xx (%s) is an accepted job, never a success", async (reason, payload) => {
    const { deps } = harness(() => jsonResponse(payload));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), ...deps });
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain(reason);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted_malformed");
  });

  it("more clips than requested is malformed", async () => {
    const { deps } = harness(() => jsonResponse({ predictions: [{ bytesBase64Encoded: wav(1) }, { bytesBase64Encoded: wav(1) }] }));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x", sample_count: 1 }, credentials: saCreds(), ...deps });
    expect(result.acceptedJob?.meta.jobState).toBe("accepted_malformed");
  });

  it("unparseable 2xx body is an accepted unreadable job", async () => {
    const { deps } = harness(() => new Response("not json", { status: 200 }));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), ...deps });
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted_unreadable");
  });

  it("wavDurationSeconds rejects truncated data chunks", () => {
    const full = Buffer.from(wav(1), "base64");
    expect(wavDurationSeconds(full)).toBe(1);
    expect(wavDurationSeconds(full.subarray(0, 100))).toBeNull();
  });
});

describe("native-vertex-music: cancellation and deadlines", () => {
  it("pre-aborted signal submits nothing", async () => {
    const { calls, deps } = harness(() => jsonResponse({}));
    const controller = new AbortController();
    controller.abort();
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), signal: controller.signal, ...deps });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(deps.mintServiceAccountToken).not.toHaveBeenCalled();
  });

  it("token mint deadline stops before submit", async () => {
    const { calls, deps } = harness(() => jsonResponse({}));
    deps.mintServiceAccountToken.mockImplementationOnce(() => new Promise(() => {}));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), tokenTimeoutMs: 20, ...deps });
    expect(result.status).toBe(504);
    expect(result.error).toMatch(/nothing was submitted/);
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("caller abort during submit aborts the socket signal and records an uncertain job", async () => {
    const controller = new AbortController();
    let seenSignal;
    const { calls, deps } = harness((_i, { init }) => {
      seenSignal = init.signal;
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    });
    const pending = handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: saCreds(), signal: controller.signal, ...deps });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort();
    const result = await pending;
    expect(seenSignal.aborted).toBe(true);
    expect(result.status).toBe(499);
    expect(result.outcome).toBe("outcome_unknown");
    expect(result.acceptedJob?.meta.jobState).toBe("submit_outcome_unknown");
    expect(calls).toHaveLength(1);
  });

  it("total deadline during submit yields 504 and no replay", async () => {
    const { calls, deps } = harness((_i, { init }) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: expressCreds(), totalTimeoutMs: 30, ...deps });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("submit_outcome_unknown");
    expect(calls).toHaveLength(1);
  });

  it("deadline while reading a 2xx body cancels the stream and keeps the accepted job", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } });
    const { deps } = harness(() => new Response(stream, { status: 200 }));
    const result = await handleVertexMusicGeneration({ model: "lyria-002", body: { prompt: "x" }, credentials: expressCreds(), totalTimeoutMs: 30, ...deps });
    expect(result.status).toBe(504);
    expect(result.acceptedJob?.meta.jobState).toBe("accepted_unreadable");
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });
});

// ── Staging block: unregistered state. Registration promotes ONLY this block. ──
describe("native-vertex-music: staging (unregistered) state", () => {
  const registration = JSON.parse(readFileSync(fileURLToPath(new URL("registration.json", STAGING_DIR)), "utf8"));

  it("registration.json describes the staged exports and identity", () => {
    expect(registration).toMatchObject({
      provider: "vertex",
      aliases: ["vx"],
      serviceKinds: ["music"],
      models: [{ id: "lyria-002" }],
      status: "staged-unregistered",
    });
    expect(registration.exports).toEqual(expect.arrayContaining(["handleVertexMusicGeneration", "VERTEX_MUSIC_CONFIG", "listVertexMusicModels"]));
  });

  it("is not wired into the live music core or vertex registry yet", async () => {
    const { MUSIC_ADAPTERS } = await import("../../open-sse/handlers/musicGenerationCore.js");
    expect(Object.keys(MUSIC_ADAPTERS)).not.toContain("vertex");
    const vertex = (await import("../../open-sse/providers/registry/vertex.js")).default;
    expect(vertex.serviceKinds).toContain("music");
  });
});
