// Closed-network contract tests for the staged native ElevenLabs Eleven Music adapter.
// Source: OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad
// open-sse/config/musicRegistry.ts (`elevenlabs`), open-sse/handlers/musicGeneration.ts (`elevenlabs-music`),
// open-sse/handlers/mediaGeneration/elevenLabsMusic.ts, open-sse/handlers/mediaGeneration/elevenLabsSchemas.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import elevenLabsMusicAdapter, {
  ELEVENLABS_MUSIC_CONFIG,
  audioMatchesFormat,
  buildElevenLabsMusicAuth,
  buildElevenLabsMusicRequest,
  buildElevenLabsMusicUrl,
  elevenLabsMusicFormat,
  handleElevenLabsMusicGeneration,
  isElevenLabsMusicModel,
  isElevenLabsMusicProvider,
  listElevenLabsMusicModels,
} from "../../open-sse/services/providerParity/native-elevenlabs-music/index.js";

const STAGING_DIR = new URL("../../open-sse/services/providerParity/native-elevenlabs-music/", import.meta.url);
const ENDPOINT = (format = "mp3_44100_128") => `https://api.elevenlabs.io/v1/music?output_format=${format}`;

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(64)]);
function wav(seconds = 1, byteRate = 176400) {
  const dataSize = Math.round(seconds * byteRate);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

const creds = (key = "sk_el_alpha", connectionId = "conn-a") => ({ apiKey: key, connectionId, providerSpecificData: {} });
const audioResponse = (bytes = MP3, contentType = "audio/mpeg", status = 200, headers = {}) =>
  new Response(bytes, { status, headers: contentType ? { "Content-Type": contentType, ...headers } : headers });
const jsonResponse = (payload, status, headers = {}) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...headers } });

function harness(responder) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init, proxyOptions) => {
    calls.push({ url, init, proxyOptions });
    return responder(calls.length - 1, { url, init });
  });
  return { calls, deps: { fetchImpl } };
}

const run = (body, extra = {}) => handleElevenLabsMusicGeneration({ model: "music_v1", body: { prompt: "Calm piano", ...body }, credentials: creds(), ...extra });
const bodyOf = async (result) => JSON.parse(await result.response.text());

describe("native-elevenlabs-music: source-derived wire contract", () => {
  it("exposes the pinned registry entry verbatim", () => {
    expect(ELEVENLABS_MUSIC_CONFIG).toMatchObject({
      id: "elevenlabs",
      baseUrl: "https://api.elevenlabs.io/v1/music",
      authType: "apikey",
      authHeader: "xi-api-key",
      format: "elevenlabs-music",
    });
    expect(ELEVENLABS_MUSIC_CONFIG.models.map((m) => [m.id, m.name])).toEqual([
      ["music_v1", "Eleven Music V1"],
      ["music_v2", "Eleven Music V2"],
      ["music_v2_5", "Eleven Music V2.5"],
    ]);
    expect(listElevenLabsMusicModels().every((m) => m.provider === "elevenlabs" && m.serviceKinds[0] === "music")).toBe(true);
  });

  it("matches the source key and the local registry alias only", () => {
    expect(isElevenLabsMusicProvider("elevenlabs")).toBe(true);
    expect(isElevenLabsMusicProvider("el")).toBe(true);
    for (const other of ["eleven", "ElevenLabs", "suno", "udio", "minimax", "fal-ai", ""]) expect(isElevenLabsMusicProvider(other)).toBe(false);
    for (const model of ["music_v1", "music_v2", "music_v2_5"]) expect(isElevenLabsMusicModel(model)).toBe(true);
    for (const model of ["eleven_v3", "eleven_text_to_sound_v2", "music_v3", "../music_v1"]) expect(isElevenLabsMusicModel(model)).toBe(false);
  });

  it("exact URL, headers and source body: seconds map to ms, instrumental maps to force_instrumental", async () => {
    const { calls, deps } = harness(() => audioResponse());
    const result = await run({ model: "elevenlabs/music_v1", duration: 3, instrumental: true, sign_with_c2pa: true }, { now: () => 1_700_000_000_000, ...deps });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ENDPOINT());
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", "xi-api-key": "sk_el_alpha" });
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(calls[0].init.body)).toEqual({
      model_id: "music_v1", prompt: "Calm piano", music_length_ms: 3000, force_instrumental: true, sign_with_c2pa: true,
    });
    expect(result.success).toBe(true);
    expect(result.connectionId).toBe("conn-a");
    expect(await bodyOf(result)).toEqual({
      object: "music.generation", created: 1_700_000_000, provider: "elevenlabs", model: "music_v1", status: "completed",
      data: [{ b64_json: MP3.toString("base64"), format: "mp3", mime_type: "audio/mpeg" }],
    });
  });

  it("native music_length_ms and force_instrumental win over the unified aliases; output_format reaches the query", async () => {
    const { calls, deps } = harness(() => audioResponse(wav(1), "audio/wav"));
    const result = await handleElevenLabsMusicGeneration({
      model: "music_v2_5",
      body: { prompt: "piano", duration: 3, music_length_ms: 5000, force_instrumental: false, instrumental: true, output_format: "wav_44100" },
      credentials: creds(), ...deps,
    });
    expect(calls[0].url).toBe(ENDPOINT("wav_44100"));
    expect(JSON.parse(calls[0].init.body)).toEqual({ model_id: "music_v2_5", prompt: "piano", music_length_ms: 5000, force_instrumental: false });
    const out = await bodyOf(result);
    expect(out.data[0]).toMatchObject({ format: "wav", mime_type: "audio/wav", duration_seconds: 1 });
    expect(result.accounting.nativeUnits.audioSeconds).toBe(1);
  });

  it("composition_plan and every source native field are forwarded unchanged", async () => {
    const plan = { positive_global_styles: ["lo-fi"], sections: [{ section_name: "intro", duration_ms: 4000, lines: [] }] };
    const { calls, deps } = harness(() => audioResponse());
    const result = await handleElevenLabsMusicGeneration({
      model: "music_v2",
      body: { composition_plan: plan, seed: 42, finetune_id: "ft_1", respect_sections_durations: true, store_for_inpainting: false },
      credentials: creds(), ...deps,
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      model_id: "music_v2", composition_plan: plan, seed: 42, finetune_id: "ft_1", respect_sections_durations: true, store_for_inpainting: false,
    });
  });

  it("two credentials stay isolated: each call carries only its own key and connection identity", async () => {
    const { calls, deps } = harness(() => audioResponse());
    const a = await handleElevenLabsMusicGeneration({ model: "music_v1", body: { prompt: "a" }, credentials: creds("sk_el_alpha", "conn-a"), ...deps });
    const b = await handleElevenLabsMusicGeneration({ model: "music_v1", body: { prompt: "b" }, credentials: creds("sk_el_beta", "conn-b"), ...deps });
    expect(calls.map((c) => c.init.headers["xi-api-key"])).toEqual(["sk_el_alpha", "sk_el_beta"]);
    expect([a.connectionId, b.connectionId]).toEqual(["conn-a", "conn-b"]);
  });

  it("source credential precedence: apiKey wins, accessToken is the fallback, both sent as xi-api-key", () => {
    expect(buildElevenLabsMusicAuth({ apiKey: " k1 ", accessToken: "t1" })).toEqual({ mode: "api_key", headers: { "Content-Type": "application/json", "xi-api-key": "k1" } });
    expect(buildElevenLabsMusicAuth({ accessToken: "t1" })).toEqual({ mode: "access_token", headers: { "Content-Type": "application/json", "xi-api-key": "t1" } });
    expect(buildElevenLabsMusicAuth({ apiKey: "  " })).toBeNull();
  });

  it("maps source content types; falls back to the requested codec for octet-stream or no content type", () => {
    expect(elevenLabsMusicFormat("audio/mpeg; charset=binary", "wav_44100")).toBe("mp3");
    expect(elevenLabsMusicFormat("audio/x-wav", "mp3_44100_128")).toBe("wav");
    expect(elevenLabsMusicFormat("audio/pcm", "mp3_44100_128")).toBe("pcm");
    expect(elevenLabsMusicFormat("application/octet-stream", "opus_48000_128")).toBe("opus");
    expect(elevenLabsMusicFormat("", "pcm_44100")).toBe("pcm");
  });

  it("container signatures are checked per format; raw codecs only need bytes", () => {
    expect(audioMatchesFormat(MP3, "mp3")).toBe(true);
    expect(audioMatchesFormat(wav(), "wav")).toBe(true);
    expect(audioMatchesFormat(Buffer.from("OggS\0\0\0\0"), "opus")).toBe(true);
    expect(audioMatchesFormat(Buffer.from("fLaC\0\0\0\0"), "flac")).toBe(true);
    expect(audioMatchesFormat(Buffer.from([1, 2]), "pcm")).toBe(true);
    expect(audioMatchesFormat(Buffer.from("<html>"), "mp3")).toBe(false);
    expect(audioMatchesFormat(Buffer.alloc(0), "pcm")).toBe(false);
    expect(audioMatchesFormat(MP3, "aac")).toBe(false);
  });

  it("the endpoint is the fixed origin; output_format is the only query parameter", () => {
    const url = new URL(buildElevenLabsMusicUrl("pcm_44100"));
    expect(url.origin).toBe("https://api.elevenlabs.io");
    expect(url.pathname).toBe("/v1/music");
    expect([...url.searchParams.keys()]).toEqual(["output_format"]);
  });
});

describe("native-elevenlabs-music: input rejection before any billable submit", () => {
  it.each([
    ["duration below 3 s", { duration: 2 }, /music_length_ms/],
    ["music_length_ms above 600000", { music_length_ms: 600001 }, /music_length_ms/],
    ["non-integer ms", { music_length_ms: 3000.5 }, /music_length_ms/],
    ["string duration", { duration: "30" }, /duration/],
    ["stream=true", { stream: true }, /streaming/],
    ["non-string output_format", { output_format: 123 }, /output_format must be a string/],
    ["unknown output_format codec", { output_format: "aac_44100" }, /Unsupported output_format/],
    ["output_format with injection", { output_format: "mp3_44100&x=1" }, /Unsupported output_format/],
    ["empty prompt", { prompt: "" }, /prompt/],
    ["blank prompt", { prompt: "   " }, /prompt/],
    ["prompt over 4100 chars", { prompt: "x".repeat(4101) }, /4100/],
    ["prompt and composition_plan", { composition_plan: { sections: [] } }, /exactly one/],
    ["neither prompt nor plan", { prompt: undefined }, /exactly one/],
    ["array composition_plan", { prompt: undefined, composition_plan: [] }, /composition_plan must be an object/],
    ["seed out of range", { seed: -1 }, /seed/],
    ["non-boolean instrumental", { instrumental: "yes" }, /force_instrumental/],
    ["non-boolean sign_with_c2pa", { sign_with_c2pa: 1 }, /sign_with_c2pa/],
    ["response_format url", { response_format: "url" }, /b64_json/],
    ["unknown field", { lyrics: "la la" }, /Unsupported field/],
  ])("%s is 400 and nothing is sent", async (_label, body, pattern) => {
    const { calls, deps } = harness(() => audioResponse());
    const result = await run(body, deps);
    expect(calls).toHaveLength(0);
    expect(result.status).toBe(400);
    expect(result.outcome).toBe("rejected");
    expect(result.error).toMatch(pattern);
  });

  it("unsupported models are 400 and nothing is sent", async () => {
    const { calls, deps } = harness(() => audioResponse());
    for (const model of ["eleven_v3", "", "music_v1/../x"]) {
      const result = await handleElevenLabsMusicGeneration({ model, body: { prompt: "x" }, credentials: creds(), ...deps });
      expect(result.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("missing credentials is 401 and nothing is sent", async () => {
    const { calls, deps } = harness(() => audioResponse());
    const result = await handleElevenLabsMusicGeneration({ model: "music_v1", body: { prompt: "x" }, credentials: { apiKey: "" }, ...deps });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("an already-aborted caller is 499 and nothing is sent", async () => {
    const { calls, deps } = harness(() => audioResponse());
    const controller = new AbortController();
    controller.abort();
    const result = await run({}, { signal: controller.signal, ...deps });
    expect(result.status).toBe(499);
    expect(result.outcome).toBe("aborted");
    expect(result.acceptedJob).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("native-elevenlabs-music: usage accounting", () => {
  it("records unknown cost, audio bytes and the requested length without inventing a measured duration", async () => {
    const { deps } = harness(() => audioResponse());
    const result = await run({ duration: 30 }, deps);
    expect(result.accounting).toMatchObject({
      state: "complete", modality: "music", cost: null, costStatus: "unknown", nativeUnits: {},
      meta: { clips: 1, audioBytes: MP3.length, outputFormat: "mp3_44100_128", requestedMusicLengthMs: 30000 },
    });
    expect(result.accounting.nativeUnits.audioSeconds).toBeUndefined();
  });
});

describe("native-elevenlabs-music: upstream failures, quota and secrecy", () => {
  it("402 paid-plan and 429 quota keep their status; only the detail.status slug is surfaced", async () => {
    for (const status of [402, 429]) {
      const { deps } = harness(() => jsonResponse({ detail: { status: "paid_plan_required", message: "A paid plan is required secret-detail sk_el_alpha" } }, status, { "Retry-After": "45" }));
      const result = await run({}, { now: () => 1_000_000, ...deps });
      expect(result.status).toBe(status);
      expect(result.outcome).toBe("refused");
      expect(result.error).toBe(`ElevenLabs music refused the request (HTTP ${status} paid_plan_required)`);
      expect(await result.response.text()).not.toMatch(/secret-detail|sk_el_alpha/);
      expect(result.acceptedJob).toBeUndefined();
      expect(result.resetsAtMs).toBe(status === 429 ? 1_045_000 : undefined);
    }
  });

  it("400/401/403/404/422 are refusals; unknown 4xx collapse to 502; unsafe slugs are dropped", async () => {
    for (const [status, expected] of [[400, 400], [401, 401], [403, 403], [404, 404], [422, 422], [418, 502]]) {
      const { deps } = harness(() => jsonResponse({ detail: { status: "Bad <b>leak</b>", message: "leak" } }, status));
      const result = await run({}, deps);
      expect(result.status).toBe(expected);
      expect(result.acceptedJob).toBeUndefined();
      expect(result.error).toBe(`ElevenLabs music refused the request (HTTP ${status})`);
    }
  });

  it.each([500, 502, 503])("%i is an uncertain submit with an unknown-cost accepted job and is not replayed", async (status) => {
    const { calls, deps } = harness(() => new Response("<html>internal trace</html>", { status }));
    const result = await run({}, deps);
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.outcome).toBe("outcome_unknown");
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", costStatus: "unknown", cost: null, modality: "music", meta: { jobState: "submit_outcome_unknown", httpStatus: status } });
    expect(result.error).not.toMatch(/internal trace/);
  });

  it("network failure after dispatch is uncertain, never resubmitted, and never leaks the key", async () => {
    const { calls, deps } = harness(() => { throw new TypeError("socket hang up for sk_el_secret"); });
    const result = await handleElevenLabsMusicGeneration({ model: "music_v1", body: { prompt: "x" }, credentials: creds("sk_el_secret"), ...deps });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.acceptedJob?.meta.jobState).toBe("submit_outcome_unknown");
    expect(result.error).not.toMatch(/sk_el_secret/);
    expect(await result.response.text()).not.toMatch(/sk_el_secret/);
  });

  it("redirects are refused without following", async () => {
    const { calls, deps } = harness(() => new Response(null, { status: 302, headers: { Location: "https://evil.example.com/" } }));
    const result = await run({}, deps);
    expect(calls).toHaveLength(1);
    expect(result.status).toBe(502);
    expect(result.outcome).toBe("refused");
    expect(result.error).toMatch(/redirect was not followed/);
  });
});

describe("native-elevenlabs-music: malformed and unsafe 2xx outputs stay accepted jobs", () => {
  it.each([
    ["JSON instead of audio", () => jsonResponse({ detail: "bad" }, 200), /non-audio response/],
    ["HTML instead of audio", () => audioResponse(Buffer.from("<html>"), "text/html"), /non-audio response/],
    ["empty audio", () => audioResponse(Buffer.alloc(0)), /empty audio/],
    ["HTML disguised as mp3", () => audioResponse(Buffer.from("<html><script>x</script></html>")), /not a mp3 container/],
    ["WAV header without data", () => audioResponse(Buffer.from("RIFF\0\0\0\0WAVE"), "audio/wav"), /not a wav container/],
    ["opus bytes that are not Ogg", () => audioResponse(Buffer.from("not-ogg-data"), "application/octet-stream"), /not a opus container/],
  ])("%s", async (_label, responder, pattern) => {
    const { calls, deps } = harness(responder);
    const result = await run({ output_format: _label.startsWith("opus") ? "opus_48000_128" : undefined }, deps);
    expect(calls).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.outcome).toBe("accepted_malformed");
    expect(result.error).toMatch(pattern);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: "accepted_malformed", httpStatus: 200 } });
  });

  it("raw PCM with no content type is accepted as the requested codec", async () => {
    const pcm = Buffer.from([0, 1, 2, 3, 4, 5]);
    const { deps } = harness(() => audioResponse(pcm, null));
    const result = await run({ output_format: "pcm_44100" }, deps);
    expect((await bodyOf(result)).data[0]).toEqual({ b64_json: pcm.toString("base64"), format: "pcm", mime_type: "audio/pcm" });
  });
});

describe("native-elevenlabs-music: cancellation and deadlines", () => {
  it("caller abort during submit aborts the socket signal and is 499 + accepted job, not replayed", async () => {
    const controller = new AbortController();
    let seenSignal;
    const fetchImpl = vi.fn((url, init) => {
      seenSignal = init.signal;
      return new Promise(() => {});
    });
    const pending = run({}, { signal: controller.signal, fetchImpl });
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    const result = await pending;
    expect(seenSignal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(499);
    expect(result.outcome).toBe("outcome_unknown");
    expect(result.acceptedJob.meta.jobState).toBe("submit_outcome_unknown");
  });

  it("total deadline bounds a hung submit with 504", async () => {
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = await run({}, { totalTimeoutMs: 30, fetchImpl });
    expect(result.status).toBe(504);
    expect(result.acceptedJob.meta.jobState).toBe("submit_outcome_unknown");
  });

  it("total deadline bounds a stalled 2xx audio read and cancels the stream", async () => {
    let cancelled = false;
    const stalled = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MP3)); }, cancel() { cancelled = true; } });
    const fetchImpl = vi.fn(async () => new Response(stalled, { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    const result = await run({}, { totalTimeoutMs: 30, fetchImpl });
    expect(result.status).toBe(504);
    expect(result.outcome).toBe("accepted_unreadable");
    expect(result.acceptedJob.meta.jobState).toBe("accepted_unreadable");
    expect(cancelled).toBe(true);
  });

  it("caller abort during the audio read is 499 accepted_unreadable", async () => {
    const controller = new AbortController();
    const stalled = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MP3)); } });
    const fetchImpl = vi.fn(async () => new Response(stalled, { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    const pending = run({}, { signal: controller.signal, fetchImpl });
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    const result = await pending;
    expect(result.status).toBe(499);
    expect(result.outcome).toBe("accepted_unreadable");
  });
});

describe("native-elevenlabs-music: request builder", () => {
  it("returns the validated model, output format and payload without undefined keys", () => {
    expect(buildElevenLabsMusicRequest("music_v1", { prompt: "x" })).toEqual({
      model: "music_v1", outputFormat: "mp3_44100_128", payload: { model_id: "music_v1", prompt: "x" },
    });
    expect(buildElevenLabsMusicRequest("music_v1", null)).toEqual({ error: "Request body must be a JSON object" });
  });
});

// Staging block: the only assertions that depend on the unregistered state.
// Registration promotes these to positive identity assertions.
describe("native-elevenlabs-music: staging (unregistered) state", () => {
  const registration = JSON.parse(readFileSync(fileURLToPath(new URL("registration.json", STAGING_DIR)), "utf8"));

  it("registration.json describes the staged exports and identity", async () => {
    expect(registration).toMatchObject({
      status: "staged-unregistered",
      provider: "elevenlabs",
      aliases: ["el"],
      serviceKinds: ["music"],
      models: [{ id: "music_v1" }, { id: "music_v2" }, { id: "music_v2_5" }],
      source: { commit: "c71f0065a7efe9230ec23b96a12253b050c4d7ad", registryEntry: { id: "elevenlabs", format: "elevenlabs-music", authHeader: "xi-api-key" } },
    });
    const mod = await import("../../open-sse/services/providerParity/native-elevenlabs-music/index.js");
    for (const name of registration.exports) expect(mod[name], name).toBeDefined();
    expect(elevenLabsMusicAdapter.generate).toBe(handleElevenLabsMusicGeneration);
  });

  it("is not wired into the live music core or the elevenlabs registry yet", async () => {
    const core = readFileSync(fileURLToPath(new URL("../../open-sse/handlers/musicGenerationCore.js", import.meta.url)), "utf8");
    expect(core).not.toMatch(/native-elevenlabs-music/);
    const elevenlabs = (await import("../../open-sse/providers/registry/elevenlabs.js")).default;
    expect(elevenlabs.serviceKinds).not.toContain("music");
    expect(elevenlabs.musicConfig).toBeUndefined();
  });
});
