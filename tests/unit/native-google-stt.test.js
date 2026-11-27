// Gemini Live (BidiGenerateContent) file-mode transcription adapter, staged
// and unregistered (#2034). Closed mocks only: every socket is a synthetic
// in-process WebSocket, no network or browser is touched, and every key is
// synthetic. Wire shapes follow OmniRoute c71f0065 (audioRegistry.ts `gemini`
// transcription row, audioTranscription.ts handleGeminiLiveTranscription,
// executors/geminiLiveTranscribe.ts). Passing here says nothing about the
// live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-google-stt/index.js";
import {
  GEMINI_LIVE_STT_CONFIG,
  GEMINI_LIVE_STT_MODELS,
  GEMINI_LIVE_WS_URL,
  buildGeminiLiveSetupFrame,
  createGeminiLiveSttAdapter,
  extractPcmFrom16kWav,
  geminiLiveSttAdapter,
} from "../../open-sse/services/providerParity/native-google-stt/index.js";
import geminiRegistry from "../../open-sse/providers/registry/gemini.js";

const KEY_A = "SYNTHETIC-gemini-key-a-0001";
const KEY_B = "SYNTHETIC-gemini-key-b-0002";
const TOKEN = "SYNTHETIC-gemini-oauth-token-0003";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MODEL = "gemini-3.5-transcribe-live";
const SOURCE_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const REGISTRATION = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-google-stt/registration.json", import.meta.url), "utf8"));
const FAST = { settleMs: 0, graceMs: 30 };

/** A 16 kHz, 16-bit, mono PCM WAV with `samples` bytes of PCM. */
function wav(pcmBytes = 6400, { rate = 16000, channels = 1, bits = 16, format = 1, extraChunk = false } = {}) {
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(format, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * channels * (bits / 8), 16);
  fmt.writeUInt16LE(channels * (bits / 8), 20);
  fmt.writeUInt16LE(bits, 22);
  const list = extraChunk ? Buffer.concat([Buffer.from("LIST"), Buffer.from([3, 0, 0, 0]), Buffer.from("abc"), Buffer.alloc(1)]) : Buffer.alloc(0);
  const pcm = Buffer.alloc(pcmBytes);
  for (let i = 0; i < pcmBytes; i += 1) pcm[i] = i % 251;
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(pcmBytes, 4);
  const body = Buffer.concat([Buffer.from("WAVE"), fmt, list, dataHeader, pcm]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function form(fields = {}, file = new Blob([wav()], { type: "audio/wav" })) {
  const fd = new FormData();
  if (file) fd.append("file", file, "clip.wav");
  for (const [name, value] of Object.entries(fields)) fd.append(name, value);
  return fd;
}

/**
 * A synthetic Gemini Live server. `script(socket, frame)` runs for every
 * client frame; `onConnect(socket)` runs after construction. Each socket
 * records its URL, options and sent frames.
 */
function liveServer({ onConnect = (s) => s.accept(), script = happyPath(), stallAfterAudio = false } = {}) {
  const sockets = [];
  class FakeSocket {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.readyState = 0;
      this.OPEN = 1;
      this.bufferedAmount = 0;
      this.sent = [];
      this.listeners = {};
      this.closedBy = null;
      sockets.push(this);
      queueMicrotask(() => onConnect(this));
    }
    on(name, fn) { this.listeners[name] = fn; }
    accept() { this.readyState = 1; this.onopen?.(); }
    reject(statusCode, headers = {}) {
      this.listeners["unexpected-response"]?.({}, { statusCode, headers, resume() {} });
    }
    push(value) { if (this.readyState === 1) this.onmessage?.({ data: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)) }); }
    serverClose(code = 1000, reason = "") { this.readyState = 3; this.onclose?.({ code, reason: Buffer.from(reason) }); }
    send(text) {
      if (this.readyState !== 1) throw new Error("not open");
      const frame = JSON.parse(text);
      this.sent.push(frame);
      // Simulate a congested socket so the send loop waits mid-stream.
      if (stallAfterAudio && frame.realtimeInput?.audio) this.bufferedAmount = 1e9;
      queueMicrotask(() => script(this, frame));
    }
    close(code) { this.closedBy = this.closedBy ?? `close:${code ?? ""}`; this.readyState = 3; }
    terminate() { this.closedBy = this.closedBy ?? "terminate"; this.readyState = 3; }
  }
  return { WebSocketImpl: FakeSocket, sockets };
}

/** Gemini's documented happy path: setupComplete, transcription frames, turnComplete with usage. */
function happyPath({ text = ["hello", "world"], usage = { promptTokenCount: 12, responseTokenCount: 0, totalTokenCount: 12, promptTokensDetails: [{ modality: "AUDIO", tokenCount: 12 }] } } = {}) {
  return (socket, frame) => {
    if (frame.setup) return socket.push({ setupComplete: {} });
    if (frame.realtimeInput?.audioStreamEnd) {
      for (const part of text) socket.push({ serverContent: { inputTranscription: { text: part } } });
      socket.push({ serverContent: { turnComplete: true }, ...(usage ? { usageMetadata: usage } : null) });
    }
  };
}

const adapterWith = (server, extra = {}) => createGeminiLiveSttAdapter({ WebSocketImpl: server.WebSocketImpl, socketOptions: FAST, ...extra });
const audioFrames = (socket) => socket.sent.filter((f) => f.realtimeInput?.audio);
const bodyOf = async (result) => JSON.parse(await result.response.text());
const leakFree = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain("upstream-secret-detail");
};

// ---------------------------------------------------------------------------
// Isolated staging block: the only assertions that depend on the module not
// being registered. Registration promotes this block to positive identity
// assertions; nothing else in this file reads registry state.
describe("Gemini Live stt staging state (promote at registration)", () => {
  it("is not registered: gemini's sttConfig does not route the Live model and the row stays kind live", () => {
    expect(geminiRegistry.sttConfig.format).toBe("gemini-stt");
    expect(geminiRegistry.sttConfig.models.some((m) => m.id === MODEL)).toBe(false);
    expect(geminiRegistry.models.find((m) => m.id === MODEL)?.kind).toBe("live");
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});
// ---------------------------------------------------------------------------

describe("Gemini Live stt staged metadata", () => {
  it("exports the source endpoint, auth and model identity", () => {
    expect(GEMINI_LIVE_WS_URL).toBe(SOURCE_URL);
    expect(GEMINI_LIVE_STT_CONFIG).toMatchObject({ baseUrl: SOURCE_URL, authType: "apikey", authHeader: "x-goog-api-key", format: "gemini-live-stt" });
    expect(GEMINI_LIVE_STT_CONFIG.translationModels).toEqual([]);
    expect(GEMINI_LIVE_STT_MODELS).toEqual([{ id: MODEL, name: "Gemini 3.5 Transcribe Live", kind: "stt" }]);
    expect(staged.GEMINI_PROVIDER_ID).toBe("gemini");
    expect(staged.GEMINI_LIVE_SOURCE_FORMAT).toBe("gemini-live");
    expect(geminiLiveSttAdapter.provider).toBe("gemini");
  });

  it("registration.json matches the exports and pins the source", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.stt).toMatchObject({ id: "gemini", baseUrl: SOURCE_URL, authHeader: "x-goog-api-key", format: "gemini-live" });
    expect(REGISTRATION.source.registryFields.inventoryRowGoogle).toMatchObject({ id: "google", format: "gemini-tts", baseUrl: "https://generativelanguage.googleapis.com/v1beta/models" });
    expect(REGISTRATION.provider.canonicalId).toBe("gemini");
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual([MODEL]);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
  });
});

describe("Gemini Live transcription wire contract", () => {
  it("sends the source setup, PCM chunks and audioStreamEnd with the key in a header only", async () => {
    const server = liveServer();
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form({ language: "en-US", prompt: "  Names: Durin  " }), credentials: CRED_A });
    expect(result.success).toBe(true);
    const [socket] = server.sockets;
    expect(socket.url).toBe(SOURCE_URL);
    expect(socket.url).not.toContain("key=");
    expect(socket.options.headers).toEqual({ "x-goog-api-key": KEY_A });
    expect(socket.options).toMatchObject({ followRedirects: false, maxRedirects: 0, perMessageDeflate: false });
    expect(socket.sent[0]).toEqual({
      setup: {
        model: `models/${MODEL}`,
        generationConfig: { responseModalities: ["TEXT"] },
        inputAudioTranscription: { languageCodes: ["en-US"] },
        systemInstruction: { parts: [{ text: "Names: Durin" }] },
      },
    });
    const audio = audioFrames(socket);
    expect(audio).toHaveLength(2); // 6400 PCM bytes in 3200-byte chunks
    expect(audio[0].realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    const pcm = extractPcmFrom16kWav(wav());
    expect(Buffer.from(audio[0].realtimeInput.audio.data, "base64")).toEqual(pcm.subarray(0, 3200));
    expect(Buffer.from(audio[1].realtimeInput.audio.data, "base64")).toEqual(pcm.subarray(3200));
    expect(socket.sent.at(-1)).toEqual({ realtimeInput: { audioStreamEnd: true } });
  });

  it("omits systemInstruction and sends empty languageCodes without prompt or language", async () => {
    const server = liveServer();
    await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(server.sockets[0].sent[0]).toEqual({ setup: { model: `models/${MODEL}`, generationConfig: { responseModalities: ["TEXT"] }, inputAudioTranscription: { languageCodes: [] } } });
    expect(buildGeminiLiveSetupFrame({ model: `models/${MODEL}` }).setup.model).toBe(`models/${MODEL}`);
  });

  it("waits for setupComplete before streaming audio", async () => {
    let release;
    const server = liveServer({ script: (socket, frame) => {
      if (frame.setup) release = () => socket.push({ setup_complete: {} });
      else happyPath()(socket, frame);
    } });
    const pending = adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(audioFrames(server.sockets[0])).toHaveLength(0);
    release();
    expect((await pending).success).toBe(true);
  });

  it("normalizes collected transcription to JSON { text } with usage and honest unknown cost", async () => {
    const server = liveServer({ script: happyPath({ text: [" hello ", "", "world  "] }) });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(await bodyOf(result)).toEqual({ text: "hello world" });
    expect(result.nativeUnits).toEqual({ audioSeconds: 0.2 });
    expect(result.usageValue.usage).toMatchObject({ promptTokenCount: 12, totalTokenCount: 12 });
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", nativeUnits: { audioSeconds: 0.2 } });
    expect(result.accounting.tokens).toMatchObject({ input_tokens: 12, total_tokens: 12 });
    expect(result.accounting.meta).toMatchObject({ model: MODEL, completion: "turn-complete" });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("accepts snake_case server fields and ignores non-JSON frames, as the source does", async () => {
    const server = liveServer({ script: (socket, frame) => {
      if (frame.setup) { socket.push("not json"); return socket.push({ setup_complete: true }); }
      if (frame.realtimeInput?.audioStreamEnd) {
        socket.push({ server_content: { input_transcription: { text: "snake" } } });
        socket.push({ server_content: { input_transcription: { text: 42 } } });
        socket.push({ server_content: { generation_complete: true } });
      }
    } });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(await bodyOf(result)).toEqual({ text: "snake" });
    expect(result.usageValue).toBeUndefined();
  });

  it("finishes with the collected text after the grace period when no turnComplete arrives", async () => {
    const server = liveServer({ script: (socket, frame) => {
      if (frame.setup) return socket.push({ setupComplete: {} });
      if (frame.realtimeInput?.audioStreamEnd) socket.push({ serverContent: { inputTranscription: { text: "partial grace" } } });
    } });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(await bodyOf(result)).toEqual({ text: "partial grace" });
    expect(result.accounting.meta.completion).toBe("grace");
  });

  it("finishes on a clean close after audioStreamEnd and returns an empty transcript for silence", async () => {
    const server = liveServer({ script: (socket, frame) => {
      if (frame.setup) return socket.push({ setupComplete: {} });
      if (frame.realtimeInput?.audioStreamEnd) socket.serverClose(1000);
    } });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(await bodyOf(result)).toEqual({ text: "" });
    expect(result.accounting.meta.completion).toBe("close");
  });

  it("uses Authorization: Bearer for an access token only when there is no API key", async () => {
    const server = liveServer();
    await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: { accessToken: TOKEN } });
    await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: { apiKey: KEY_A, accessToken: TOKEN } });
    expect(server.sockets[0].options.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(server.sockets[1].options.headers).toEqual({ "x-goog-api-key": KEY_A });
  });

  it("keeps two connections' keys and proxy routes separate and ignores a stored base URL", async () => {
    const server = liveServer();
    const agentFactory = vi.fn(async (proxyUrl) => ({ proxyUrl }));
    const adapter = adapterWith(server, { agentFactory });
    const credA = { ...CRED_A, providerSpecificData: { baseUrl: "wss://attacker.invalid/ws", connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-a.test:8080" } };
    const credB = { ...CRED_B, providerSpecificData: { disableEnvProxy: true } };
    const [a, b] = await Promise.all([
      adapter.transcribe({ model: MODEL, formData: form(), credentials: credA }),
      adapter.transcribe({ model: MODEL, formData: form(), credentials: credB }),
    ]);
    expect(a.success && b.success).toBe(true);
    const byKey = Object.fromEntries(server.sockets.map((s) => [s.options.headers["x-goog-api-key"], s]));
    expect(byKey[KEY_A].url).toBe(SOURCE_URL);
    expect(byKey[KEY_B].url).toBe(SOURCE_URL);
    expect(byKey[KEY_A].options.agent).toEqual({ proxyUrl: "http://proxy-a.test:8080" });
    expect(byKey[KEY_B].options.agent).toBeUndefined();
    expect(agentFactory).toHaveBeenCalledTimes(1);
  });

  it("refuses when the connection's required proxy is unavailable, before connecting", async () => {
    const server = liveServer();
    const result = await adapterWith(server, { agentFactory: async () => null }).transcribe({
      model: MODEL, formData: form(), credentials: { ...CRED_A, providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-a.test:8080" } },
    });
    expect(result.status).toBe(502);
    expect(server.sockets).toHaveLength(0);
  });
});

describe("Gemini Live transcription input checks (before any socket)", () => {
  const cases = [
    ["unknown model", { model: "gemini-2.5-flash" }, 400, /Unsupported Gemini Live transcription model/],
    ["translation", { kind: "translation" }, 400, /translations are not supported/],
    ["missing file", { formData: form({}, null) }, 400, /Missing required field: file/],
    ["url input", { formData: form({ url: "https://example.test/a.wav" }, null) }, 400, /not a url/],
    ["stream", { formData: form({ stream: "true" }) }, 400, /does not stream/],
    ["response_format text", { formData: form({ response_format: "verbose_json" }) }, 400, /response_format json/],
    ["timestamp granularities", { formData: form({ "timestamp_granularities[]": "word" }) }, 400, /timestamp_granularities/],
    ["temperature", { formData: form({ temperature: "0.2" }) }, 400, /temperature/],
    ["bad language", { formData: form({ language: "english please" }) }, 400, /BCP-47/],
    ["mp3 upload", { formData: form({}, new Blob([Buffer.from("ID3\u0003\u0000junk-mp3-bytes".padEnd(64, "x"))], { type: "audio/mpeg" })) }, 415, /16 kHz, 16-bit, mono PCM WAV/],
    ["44.1 kHz wav", { formData: form({}, new Blob([wav(6400, { rate: 44100 })])) }, 415, /PCM WAV/],
    ["stereo wav", { formData: form({}, new Blob([wav(6400, { channels: 2 })])) }, 415, /PCM WAV/],
    ["float wav", { formData: form({}, new Blob([wav(6400, { format: 3 })])) }, 415, /PCM WAV/],
    ["empty file", { formData: form({}, new Blob([])) }, 400, /empty/],
    ["no samples", { formData: form({}, new Blob([wav(0)])) }, 400, /no audio samples/],
    ["too long", { formData: form({}, new Blob([wav(16_000 * 2 * 600 + 2)])) }, 413, /maximum duration/],
  ];
  for (const [name, override, status, message] of cases) {
    it(`refuses ${name} locally`, async () => {
      const server = liveServer();
      const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A, ...override });
      expect(result.status).toBe(status);
      expect(result.error).toMatch(message);
      expect(result.local).toBe(true);
      expect(result.acceptedJob).toBeUndefined();
      expect(server.sockets).toHaveLength(0);
    });
  }

  it("refuses an oversized upload by its declared size before reading it", async () => {
    const server = liveServer();
    const file = { size: 25 * 1024 * 1024 + 1, arrayBuffer: vi.fn() };
    const fd = { get: (name) => (name === "file" ? file : null) };
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: fd, credentials: CRED_A });
    expect(result.status).toBe(413);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it("parses a WAV with an extra chunk ahead of data", () => {
    expect(extractPcmFrom16kWav(wav(100, { extraChunk: true }))).toHaveLength(100);
  });

  it("returns 401 without a usable credential and opens no socket", async () => {
    const server = liveServer();
    for (const credentials of [{}, { apiKey: "  " }, { apiKey: "a\r\nb" }, null]) {
      const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials });
      expect(result.status).toBe(401);
    }
    expect(server.sockets).toHaveLength(0);
  });
});

describe("Gemini Live transcription failures", () => {
  it.each([
    [401, 401, false],
    [403, 403, false],
    [429, 429, true],
    [503, 503, false],
    [404, 404, false],
    [500, 502, false],
    [302, 502, false],
  ])("maps a %i upgrade refusal to %i without accepted work", async (upstream, status, quota) => {
    const server = liveServer({ onConnect: (s) => s.reject(upstream, { "retry-after": "7" }) });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.status).toBe(status);
    expect(Boolean(result.quotaExhausted)).toBe(quota);
    expect(result.acceptedJob).toBeUndefined();
    expect(server.sockets[0].sent).toHaveLength(0);
    if (upstream === 429) expect(result.resetsAtMs).toBeGreaterThan(Date.now());
    leakFree(result);
  });

  it("maps an in-band quota error before audio to 429 without quoting it", async () => {
    const server = liveServer({ script: (socket, frame) => {
      if (frame.setup) socket.push({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: `quota exceeded upstream-secret-detail ${KEY_A}` } });
    } });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.status).toBe(429);
    expect(result.quotaExhausted).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    expect(audioFrames(server.sockets[0])).toHaveLength(0);
    leakFree(result);
  });

  it("maps a 1008 policy close before audio to 403 and a 4429 close to 429", async () => {
    const policy = liveServer({ script: (socket, frame) => frame.setup && socket.serverClose(1008, `API key not valid upstream-secret-detail`) });
    const r1 = await adapterWith(policy).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(r1.status).toBe(403);
    expect(r1.quotaExhausted).toBeUndefined();
    leakFree(r1);
    const quota = liveServer({ script: (socket, frame) => frame.setup && socket.serverClose(4429, "") });
    const r2 = await adapterWith(quota).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(r2.status).toBe(429);
    expect(r2.quotaExhausted).toBe(true);
    expect(r2.acceptedJob).toBeUndefined();
  });

  it("marks an upstream error after audio left as uncertain accepted work and never replays it", async () => {
    const server = liveServer({ stallAfterAudio: true, script: (socket, frame) => {
      if (frame.setup) return socket.push({ setupComplete: {} });
      if (frame.realtimeInput?.audio) socket.push({ error: { code: 500, message: `internal upstream-secret-detail ${KEY_A}` } });
    } });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, costStatus: "unknown", meta: { jobState: "submit-unknown" } });
    expect(audioFrames(server.sockets[0])).toHaveLength(1);
    expect(server.sockets[0].sent.some((f) => f.realtimeInput?.audioStreamEnd)).toBe(false);
    expect(server.sockets).toHaveLength(1);
    expect(server.sockets[0].closedBy).toBe("terminate");
    leakFree(result);
  });

  it("treats an abnormal close after audioStreamEnd and before turnComplete as a lost result", async () => {
    const server = liveServer({ script: (socket, frame) => {
      if (frame.setup) return socket.push({ setupComplete: {} });
      if (frame.realtimeInput?.audioStreamEnd) {
        socket.push({ serverContent: { inputTranscription: { text: "half" } } });
        socket.serverClose(1011, "internal");
      }
    } });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.status).toBe(502);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
    expect(result.success).toBe(false);
  });

  it("aborts before connect locally and terminates a session aborted mid-stream with accepted work", async () => {
    const pre = liveServer();
    const controller = new AbortController();
    controller.abort();
    const r1 = await adapterWith(pre).transcribe({ model: MODEL, formData: form(), credentials: CRED_A, signal: controller.signal });
    expect(r1).toMatchObject({ status: 499, local: true });
    expect(pre.sockets).toHaveLength(0);

    const mid = new AbortController();
    const server = liveServer({ script: (socket, frame) => {
      if (frame.setup) return socket.push({ setupComplete: {} });
      if (frame.realtimeInput?.audioStreamEnd) mid.abort();
    } });
    const r2 = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A, signal: mid.signal });
    expect(r2.status).toBe(499);
    expect(r2.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(server.sockets[0].closedBy).toBe("terminate");
  });

  it("aborts during setup without accepted work", async () => {
    const controller = new AbortController();
    const server = liveServer({ script: (_socket, frame) => frame.setup && controller.abort() });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A, signal: controller.signal });
    expect(result).toMatchObject({ status: 499, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(server.sockets[0].closedBy).toBe("terminate");
  });

  it("bounds the handshake, setup and total deadlines", async () => {
    const silent = liveServer({ onConnect: () => {} });
    const r1 = await adapterWith(silent, { socketOptions: { ...FAST, handshakeTimeoutMs: 20 } }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(r1.status).toBe(504);
    expect(r1.acceptedJob).toBeUndefined();
    expect(silent.sockets[0].closedBy).toBe("terminate");

    const noSetup = liveServer({ script: () => {} });
    const r2 = await adapterWith(noSetup, { socketOptions: { ...FAST, setupTimeoutMs: 20 } }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(r2.status).toBe(504);
    expect(r2.acceptedJob).toBeUndefined();

    const stuck = liveServer({ script: (socket, frame) => frame.setup && socket.push({ setupComplete: {} }) });
    const r3 = await adapterWith(stuck, { timeoutMs: 40, socketOptions: { settleMs: 0, graceMs: 10_000 } }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(r3.status).toBe(504);
    expect(r3.acceptedJob.meta.jobState).toBe("accepted");
    expect(stuck.sockets).toHaveLength(1);
  });

  it("refuses an oversized frame and an oversized transcript", async () => {
    const bigFrame = liveServer({ script: (socket, frame) => {
      if (frame.setup) return socket.push({ setupComplete: {} });
      if (frame.realtimeInput?.audioStreamEnd) socket.push({ serverContent: { inputTranscription: { text: "x".repeat(2048) } } });
    } });
    const r1 = await adapterWith(bigFrame, { socketOptions: { ...FAST, maxFrameBytes: 1024 } }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(r1.status).toBe(502);
    expect(r1.acceptedJob.meta.jobState).toBe("accepted");

    const longText = liveServer({ script: (socket, frame) => {
      if (frame.setup) return socket.push({ setupComplete: {} });
      if (frame.realtimeInput?.audioStreamEnd) for (let i = 0; i < 10; i += 1) socket.push({ serverContent: { inputTranscription: { text: "y".repeat(200) } } });
    } });
    const r2 = await adapterWith(longText, { socketOptions: { ...FAST, maxTranscriptBytes: 1000 } }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(r2.status).toBe(502);
    expect(r2.success).toBe(false);
  });

  it("reports a connection failure before setup as not sent", async () => {
    const server = liveServer({ onConnect: (s) => s.onerror?.(new Error(`getaddrinfo ${KEY_A}`)) });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    leakFree(result);
  });

  it("drops malformed usageMetadata values instead of trusting them", async () => {
    const server = liveServer({ script: happyPath({ usage: { promptTokenCount: -1, totalTokenCount: "9", responseTokenCount: 3 } }) });
    const result = await adapterWith(server).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.usageValue.usage).toEqual({ responseTokenCount: 3 });
    expect(result.accounting.cost).toBeNull();
  });
});
