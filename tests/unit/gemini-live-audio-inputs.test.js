// Gemini Live uploaded-audio conversion (#2034), staged and unregistered.
// Closed mocks only: ffmpeg is a synthetic in-process child injected through
// `spawn`/`access`, every socket is a synthetic in-process WebSocket, every
// key is synthetic, and no binary, network or browser is touched. Behavior
// follows OmniRoute c71f0065 open-sse/executors/geminiLiveTranscribe.ts
// (convertToPcm16k / runFfmpegPcm16k). Passing here says nothing about a real
// ffmpeg build or the live service.
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-google-stt/index.js";
import {
  GEMINI_LIVE_FFMPEG_CANDIDATES,
  GEMINI_LIVE_FFMPEG_ENV,
  GEMINI_LIVE_UPLOAD_CONTAINERS,
  buildGeminiLiveSetupFrame,
  createGeminiLiveAudioConverter,
  createGeminiLiveConvertingSttAdapter,
  createGeminiLiveSttAdapter,
  encodePcm16kWav,
  extractPcmFrom16kWav,
  geminiLiveConvertingSttAdapter,
  geminiLiveFfmpegArgs,
  geminiLiveSttAdapter,
  sniffGeminiLiveUpload,
} from "../../open-sse/services/providerParity/native-google-stt/index.js";

const KEY_A = "SYNTHETIC-gemini-key-a-0001";
const KEY_B = "SYNTHETIC-gemini-key-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MODEL = "gemini-3.5-transcribe-live";
const FFMPEG = "/usr/bin/ffmpeg";
const FAST = { settleMs: 0, graceMs: 30 };
const REGISTRATION = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-google-stt/registration.json", import.meta.url), "utf8"));

const pad = (head, length = 256) => Buffer.concat([Buffer.isBuffer(head) ? head : Buffer.from(head, "latin1"), Buffer.alloc(Math.max(0, length - head.length), 0x55)]);
/** Synthetic uploads that only carry each container's magic bytes. */
const UPLOADS = {
  mp3: pad("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000"),
  mp3sync: pad(Buffer.from([0xff, 0xfb, 0x90, 0x64])),
  flac: pad("fLaC\u0000\u0000\u0000\u0010"),
  ogg: pad("OggS\u0000\u0002"),
  m4a: pad(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A \u0000\u0000\u0000\u0000", "latin1")])),
  webm: pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])),
  aac: pad(Buffer.from([0xff, 0xf1, 0x50, 0x80])),
};

/** A WAV with the given fmt fields (the 16 kHz mono 16-bit default is the bypass shape). */
function wav(pcmBytes = 6400, { rate = 16000, channels = 1, bits = 16, format = 1 } = {}) {
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(format, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * channels * (bits / 8), 16);
  fmt.writeUInt16LE(channels * (bits / 8), 20);
  fmt.writeUInt16LE(bits, 22);
  const pcm = Buffer.alloc(pcmBytes, 7);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(pcmBytes, 4);
  const body = Buffer.concat([Buffer.from("WAVE"), fmt, dataHeader, pcm]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Decoded PCM the fake ffmpeg emits: 2.5 frames of 3200 bytes, a recognizable pattern. */
function decodedPcm(bytes = 8000) {
  const pcm = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) pcm[i] = (i * 7) % 253;
  return pcm;
}

function form(fields = {}, bytes = UPLOADS.mp3, { name = "clip.mp3", type = "audio/mpeg" } = {}) {
  const fd = new FormData();
  if (bytes) fd.append("file", new Blob([bytes], { type }), name);
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

/**
 * A synthetic ffmpeg. `script(child, input)` runs once stdin ends. The child
 * records kills; by default a kill closes it with signal SIGKILL.
 */
function fakeFfmpeg(script = decodes(), { present = [FFMPEG], closeOnKill = true, onSpawn = null } = {}) {
  const calls = [];
  const children = [];
  const access = vi.fn(async (path) => {
    if (!present.includes(path)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
  const spawn = vi.fn((command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kills = [];
    child.closed = false;
    child.input = Buffer.alloc(0);
    child.close = (code, signal = null) => {
      if (child.closed) return;
      child.closed = true;
      child.emit("close", code, signal);
    };
    child.kill = (signal) => {
      child.kills.push(signal);
      if (closeOnKill) queueMicrotask(() => child.close(null, signal));
      return true;
    };
    const parts = [];
    child.stdin.on("data", (chunk) => parts.push(chunk));
    child.stdin.on("end", () => {
      child.input = Buffer.concat(parts);
      script(child, child.input);
    });
    calls.push({ command, args, options });
    children.push(child);
    onSpawn?.(child);
    return child;
  });
  return { spawn, access, calls, children };
}

/** Successful decode: PCM on stdout in uneven chunks, then exit 0. */
function decodes(pcm = decodedPcm(), { stderr = "" } = {}) {
  return (child) => {
    if (stderr) child.stderr.write(stderr);
    for (let offset = 0; offset < pcm.length; offset += 1500) child.stdout.write(pcm.subarray(offset, offset + 1500));
    child.stdout.end();
    queueMicrotask(() => child.close(0));
  };
}
const exits = (code, stderr = "") => (child) => {
  if (stderr) child.stderr.write(stderr);
  queueMicrotask(() => child.close(code));
};
const hangs = () => () => {};

/** Synthetic Gemini Live server (same shape as native-google-stt.test.js). */
function liveServer({ onConnect = (s) => s.accept(), script = happyPath() } = {}) {
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
    push(value) { if (this.readyState === 1) this.onmessage?.({ data: Buffer.from(JSON.stringify(value)) }); }
    send(text) {
      if (this.readyState !== 1) throw new Error("not open");
      const frame = JSON.parse(text);
      this.sent.push(frame);
      queueMicrotask(() => script(this, frame));
    }
    close(code) { this.closedBy = this.closedBy ?? `close:${code ?? ""}`; this.readyState = 3; }
    terminate() { this.closedBy = this.closedBy ?? "terminate"; this.readyState = 3; }
  }
  return { WebSocketImpl: FakeSocket, sockets };
}

function happyPath({ text = ["converted", "speech"] } = {}) {
  return (socket, frame) => {
    if (frame.setup) return socket.push({ setupComplete: {} });
    if (frame.realtimeInput?.audioStreamEnd) {
      for (const part of text) socket.push({ serverContent: { inputTranscription: { text: part } } });
      socket.push({ serverContent: { turnComplete: true }, usageMetadata: { promptTokenCount: 5 } });
    }
  };
}

const converting = (server, ffmpeg, { converterOptions = {}, ...extra } = {}) => createGeminiLiveConvertingSttAdapter({
  WebSocketImpl: server.WebSocketImpl, socketOptions: FAST, agentFactory: vi.fn(async () => null),
  converterOptions: { spawn: ffmpeg.spawn, access: ffmpeg.access, reapMs: 50, ...converterOptions }, ...extra,
});
const audioFrames = (socket) => socket.sent.filter((frame) => frame.realtimeInput?.audio);
/** The exact source frame sequence for `pcm`: setup, 3200-byte base64 chunks, audioStreamEnd. */
function sourceFrames(pcm, setup = buildGeminiLiveSetupFrame({ model: MODEL })) {
  const frames = [setup];
  for (let offset = 0; offset < pcm.length; offset += 3200) {
    frames.push({ realtimeInput: { audio: { data: pcm.subarray(offset, offset + 3200).toString("base64"), mimeType: "audio/pcm;rate=16000" } } });
  }
  frames.push({ realtimeInput: { audioStreamEnd: true } });
  return frames;
}
const expectLocalNoSocket = (result, server, status) => {
  expect(result.status).toBe(status);
  expect(result.local).toBe(true);
  expect(result.acceptedJob).toBeUndefined();
  expect(result.success).not.toBe(true);
  expect(server.sockets).toHaveLength(0);
};
const expectReaped = (child) => {
  expect(child.kills).toContain("SIGKILL");
  expect(child.closed).toBe(true);
  for (const stream of [child.stdin, child.stdout, child.stderr]) expect(stream.destroyed).toBe(true);
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Gemini Live conversion wiring", () => {
  it("keeps the default adapter WAV-only and wires the converting adapter for registration", async () => {
    const server = liveServer();
    const result = await createGeminiLiveSttAdapter({ WebSocketImpl: server.WebSocketImpl, socketOptions: FAST }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.status).toBe(415);
    expect(result.error).toMatch(/16 kHz, 16-bit, mono PCM WAV/);
    expect(server.sockets).toHaveLength(0);
    expect(geminiLiveSttAdapter.provider).toBe("gemini");
    expect(geminiLiveConvertingSttAdapter.provider).toBe("gemini");
    expect(geminiLiveConvertingSttAdapter).not.toBe(geminiLiveSttAdapter);
  });

  it("registration.json names the converting adapter and every new export", () => {
    expect(REGISTRATION.status).toBe("staged-unregistered");
    const sttCore = REGISTRATION.integrationPoints.find((point) => point.file === "open-sse/handlers/sttCore.js");
    expect(sttCore.change).toMatch(/geminiLiveConvertingSttAdapter\.transcribe/);
    expect(REGISTRATION.conversion.wiredBy).toMatch(/geminiLiveConvertingSttAdapter/);
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(REGISTRATION.exports).toHaveProperty("createGeminiLiveConvertingSttAdapter");
    expect(REGISTRATION.exports).toHaveProperty("geminiLiveConvertingSttAdapter");
  });

  it("uses only fixed absolute executable locations", () => {
    expect(GEMINI_LIVE_FFMPEG_CANDIDATES.length).toBeGreaterThan(0);
    for (const path of GEMINI_LIVE_FFMPEG_CANDIDATES) expect(path).toMatch(/^\/[a-z/]+\/ffmpeg$/);
    expect(Object.isFrozen(GEMINI_LIVE_FFMPEG_CANDIDATES)).toBe(true);
    expect(Object.isFrozen(GEMINI_LIVE_FFMPEG_ENV)).toBe(true);
  });
});

describe("Gemini Live uploaded-audio conversion (source convertToPcm16k)", () => {
  const cases = [
    ["mp3 (ID3)", UPLOADS.mp3, "mp3"],
    ["mp3 (frame sync)", UPLOADS.mp3sync, "mp3"],
    ["flac", UPLOADS.flac, "flac"],
    ["ogg", UPLOADS.ogg, "ogg"],
    ["m4a", UPLOADS.m4a, "mov"],
    ["webm", UPLOADS.webm, "matroska"],
    ["aac (ADTS)", UPLOADS.aac, "aac"],
    ["44.1 kHz stereo wav", wav(8820, { rate: 44100, channels: 2 }), "wav"],
    ["float wav", wav(6400, { format: 3, bits: 32 }), "wav"],
  ];
  for (const [name, bytes, demuxer] of cases) {
    it(`converts ${name} and streams the exact source Live frames`, async () => {
      const pcm = decodedPcm();
      const ffmpeg = fakeFfmpeg(decodes(pcm));
      const server = liveServer();
      const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form({}, bytes), credentials: CRED_A });

      expect(result.success).toBe(true);
      expect(JSON.parse(await result.response.text())).toEqual({ text: "converted speech" });
      expect(result.nativeUnits).toEqual({ audioSeconds: pcm.length / 32_000 });
      expect(ffmpeg.calls).toHaveLength(1);
      const [{ command, args, options }] = ffmpeg.calls;
      expect(command).toBe(FFMPEG);
      expect(args).toEqual([
        "-nostdin", "-hide_banner", "-nostats", "-loglevel", "error",
        "-protocol_whitelist", "pipe", "-format_whitelist", demuxer, "-f", demuxer,
        "-threads", "1", "-i", "pipe:0", "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", "601",
        "-threads", "1", "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000", "pipe:1",
      ]);
      expect(options).toMatchObject({ shell: false, cwd: "/", stdio: ["pipe", "pipe", "pipe"], detached: false });
      expect(ffmpeg.children[0].input.equals(bytes)).toBe(true);
      expect(server.sockets).toHaveLength(1);
      expect(server.sockets[0].sent).toEqual(sourceFrames(pcm));
      expect(server.sockets[0].options.headers).toEqual({ "x-goog-api-key": KEY_A });
    });
  }

  it("passes language and prompt into the setup frame for converted audio", async () => {
    const pcm = decodedPcm(3200);
    const ffmpeg = fakeFfmpeg(decodes(pcm));
    const server = liveServer();
    const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form({ language: "pt-BR", prompt: "Names: Durin" }, UPLOADS.flac), credentials: CRED_A });
    expect(result.success).toBe(true);
    expect(server.sockets[0].sent).toEqual(sourceFrames(pcm, buildGeminiLiveSetupFrame({ model: MODEL, language: "pt-BR", prompt: "Names: Durin" })));
  });

  it("lets a normalized 16 kHz mono 16-bit PCM WAV bypass ffmpeg entirely", async () => {
    const ffmpeg = fakeFfmpeg(decodes(), { present: [] });
    const server = liveServer();
    const upload = wav(6400);
    const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form({}, upload, { name: "clip.wav", type: "audio/wav" }), credentials: CRED_A });
    expect(result.success).toBe(true);
    expect(ffmpeg.access).not.toHaveBeenCalled();
    expect(ffmpeg.spawn).not.toHaveBeenCalled();
    expect(server.sockets[0].sent).toEqual(sourceFrames(extractPcmFrom16kWav(upload)));
  });

  it("frames converted PCM as an exact 44-byte WAV that reads back unchanged", () => {
    const pcm = decodedPcm(6402);
    const framed = encodePcm16kWav(pcm);
    expect(framed.length).toBe(44 + pcm.length);
    expect(framed.toString("ascii", 0, 4)).toBe("RIFF");
    expect(framed.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(framed.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect([framed.readUInt32LE(16), framed.readUInt16LE(20), framed.readUInt16LE(22), framed.readUInt32LE(24), framed.readUInt32LE(28), framed.readUInt16LE(32), framed.readUInt16LE(34)])
      .toEqual([16, 1, 1, 16000, 32000, 2, 16]);
    expect(framed.toString("ascii", 36, 40)).toBe("data");
    expect(framed.readUInt32LE(40)).toBe(pcm.length);
    expect(extractPcmFrom16kWav(framed).equals(pcm)).toBe(true);
  });

  it("drains a flood of stderr without surfacing it", async () => {
    const ffmpeg = fakeFfmpeg(decodes(decodedPcm(), { stderr: `${"x".repeat(64 * 1024)} ${KEY_A} /etc/passwd` }));
    const server = liveServer();
    const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/xxxx|passwd/);
  });
});

describe("Gemini Live conversion refusals (nothing sent, nothing billed)", () => {
  it("refuses playlists, URLs, scripts, paths and unknown bytes before spawning", async () => {
    const payloads = [
      "#EXTM3U\n#EXT-X-VERSION:3\nhttps://evil.example/seg.ts\n",
      "ffconcat version 1.0\nfile '/etc/passwd'\n",
      "concat:/etc/passwd|/etc/shadow",
      "file:///etc/passwd",
      "https://evil.example/audio.mp3",
      "/etc/passwd",
      "<html><body>not audio</body></html>",
      "[playlist]\nFile1=http://evil.example/a.mp3\n",
      Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]),
    ];
    for (const payload of payloads) {
      const ffmpeg = fakeFfmpeg();
      const server = liveServer();
      const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form({}, bytes, { name: "a.m3u8", type: "application/x-mpegurl" }), credentials: CRED_A });
      expectLocalNoSocket(result, server, 415);
      expect(ffmpeg.spawn).not.toHaveBeenCalled();
      expect(sniffGeminiLiveUpload(bytes)).toBeNull();
    }
  });

  it("never lets the filename, content type or a url field reach ffmpeg or the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const hostile = ["../../etc/passwd", "http://evil.example/x.m3u8", "-i /etc/passwd", "concat:a|b", "$(touch /tmp/pwned).mp3", "x;rm -rf ~"];
    for (const name of hostile) {
      const ffmpeg = fakeFfmpeg();
      const server = liveServer();
      const result = await converting(server, ffmpeg).transcribe({
        model: MODEL, formData: form({ url: "https://evil.example/a.mp3" }, UPLOADS.mp3, { name, type: "application/vnd.apple.mpegurl" }), credentials: CRED_A,
      });
      expect(result.success).toBe(true);
      expect(ffmpeg.calls[0].command).toBe(FFMPEG);
      expect(ffmpeg.calls[0].args).toEqual(geminiLiveFfmpegArgs("mp3"));
      expect(JSON.stringify(ffmpeg.calls[0])).not.toContain("evil");
      expect(ffmpeg.calls[0].args.join(" ")).not.toContain(name);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forces one demuxer and a pipe-only protocol for a polyglot upload", async () => {
    // Starts as MP3 (ID3) but carries an HLS playlist and a file URL in its body.
    const polyglot = Buffer.concat([Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000", "latin1"), Buffer.from("#EXTM3U\nfile:///etc/passwd\nhttps://evil.example/a.ts\n")]);
    const ffmpeg = fakeFfmpeg(exits(1, "Invalid data found when processing input /etc/passwd"));
    const server = liveServer();
    const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form({}, polyglot), credentials: CRED_A });
    expectLocalNoSocket(result, server, 400);
    expect(result.error).toMatch(/could not decode/);
    expect(result.error).not.toMatch(/passwd|Invalid data/);
    const { args } = ffmpeg.calls[0];
    expect(args.slice(args.indexOf("-protocol_whitelist"), args.indexOf("-protocol_whitelist") + 2)).toEqual(["-protocol_whitelist", "pipe"]);
    expect(args.filter((arg) => arg === "-f")).toHaveLength(2);
    expect(args).not.toContain("hls");
    expect(args).not.toContain("concat");
    expect(args.filter((arg) => /^(?:file|https?|tcp|udp|crypto|data|concat|subfile)(?::|$)/.test(arg))).toEqual([]);
    expect(Object.values(GEMINI_LIVE_UPLOAD_CONTAINERS)).not.toContain("hls");
  });

  it("refuses an oversized upload before reading or spawning", async () => {
    const ffmpeg = fakeFfmpeg();
    const server = liveServer();
    const big = Buffer.alloc(25 * 1024 * 1024 + 1, 0x55);
    big.write("ID3", 0, "latin1");
    const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form({}, big), credentials: CRED_A });
    expectLocalNoSocket(result, server, 413);
    expect(ffmpeg.spawn).not.toHaveBeenCalled();
    const direct = await createGeminiLiveAudioConverter({ spawn: ffmpeg.spawn, access: ffmpeg.access, maxInputBytes: 100 })(UPLOADS.mp3);
    expect(direct.status).toBe(413);
    expect(ffmpeg.spawn).not.toHaveBeenCalled();
  });

  it("kills and reaps the child when decoded audio exceeds the duration cap", async () => {
    const ffmpeg = fakeFfmpeg((child) => {
      const timer = setInterval(() => {
        if (child.stdout.destroyed) return clearInterval(timer);
        child.stdout.write(Buffer.alloc(4000));
      }, 1);
    });
    const server = liveServer();
    const result = await converting(server, ffmpeg, { converterOptions: { maxPcmBytes: 32_000 } }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expectLocalNoSocket(result, server, 413);
    expect(result.error).toMatch(/maximum duration/);
    expectReaped(ffmpeg.children[0]);
  });

  it("refuses odd-length PCM, empty output and a failed decode without quoting stderr", async () => {
    const outcomes = [
      [decodes(Buffer.alloc(3201)), 500, /malformed PCM/],
      [decodes(Buffer.alloc(0)), 400, /no audio samples/],
      [exits(1, `Error opening ${KEY_A}`), 400, /could not decode/],
      [exits(null), 400, /could not decode/],
    ];
    for (const [script, status, message] of outcomes) {
      const ffmpeg = fakeFfmpeg(script);
      const server = liveServer();
      const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
      expectLocalNoSocket(result, server, status);
      expect(result.error).toMatch(message);
      expect(JSON.stringify(result)).not.toContain(KEY_A);
    }
  });

  it("sends a WAV with a malformed header through ffmpeg instead of the bypass", async () => {
    // RIFF/WAVE with a 16 kHz mono PCM fmt chunk but no data chunk.
    const truncated = wav(0).subarray(0, 36);
    const ffmpeg = fakeFfmpeg(exits(1));
    const server = liveServer();
    const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form({}, Buffer.concat([truncated, Buffer.alloc(16)])), credentials: CRED_A });
    expectLocalNoSocket(result, server, 400);
    expect(ffmpeg.calls[0].args).toEqual(geminiLiveFfmpegArgs("wav"));
  });

  it("refuses a converter answer that is not a valid 16 kHz WAV", async () => {
    const server = liveServer();
    for (const answer of [{ wav: wav(6400, { rate: 44100 }) }, { wav: Buffer.from("RIFFxxxxWAVE") }, {}, null]) {
      const adapter = createGeminiLiveSttAdapter({ WebSocketImpl: server.WebSocketImpl, socketOptions: FAST, convertAudio: async () => answer });
      const result = await adapter.transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
      expectLocalNoSocket(result, server, 500);
    }
  });

  it("times out a hung conversion and kills it", async () => {
    const ffmpeg = fakeFfmpeg(hangs());
    const server = liveServer();
    const result = await converting(server, ffmpeg, { converterOptions: { timeoutMs: 30 } }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expectLocalNoSocket(result, server, 504);
    expectReaped(ffmpeg.children[0]);
  });

  it("caps conversion by the session's total deadline and gives the socket only what is left", async () => {
    const hung = fakeFfmpeg(hangs());
    const server = liveServer();
    const started = Date.now();
    const result = await converting(server, hung, { timeoutMs: 40 }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expectLocalNoSocket(result, server, 504);
    expect(Date.now() - started).toBeLessThan(1000);
    expectReaped(hung.children[0]);

    // A slow decode uses most of the deadline; the stalled session then times out on the remainder.
    const slow = fakeFfmpeg((child, input) => setTimeout(() => decodes()(child, input), 400));
    const stalled = liveServer({ script: () => {} });
    const begun = Date.now();
    const late = await converting(stalled, slow, { timeoutMs: 600, socketOptions: { ...FAST, setupTimeoutMs: 60_000 } }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(late.status).toBe(504);
    expect(late.acceptedJob).toBeUndefined();
    expect(Date.now() - begun).toBeLessThan(1000);
  });

  it("aborts during conversion: kills the child, closes its pipes, opens no socket", async () => {
    const controller = new AbortController();
    const ffmpeg = fakeFfmpeg(hangs(), { onSpawn: () => setTimeout(() => controller.abort(), 10) });
    const server = liveServer();
    const agentFactory = vi.fn(async () => null);
    const result = await converting(server, ffmpeg, { agentFactory }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A, signal: controller.signal });
    expectLocalNoSocket(result, server, 499);
    expectReaped(ffmpeg.children[0]);
    expect(agentFactory).not.toHaveBeenCalled();

    const already = new AbortController();
    already.abort();
    const idle = fakeFfmpeg();
    const before = await converting(server, idle).transcribe({ model: MODEL, formData: form(), credentials: CRED_A, signal: already.signal });
    expect(before.status).toBe(499);
    expect(idle.spawn).not.toHaveBeenCalled();
  });

  it("returns once the reap window passes even if a killed child never closes", async () => {
    const ffmpeg = fakeFfmpeg(hangs(), { closeOnKill: false });
    const server = liveServer();
    const result = await converting(server, ffmpeg, { converterOptions: { timeoutMs: 20, reapMs: 20 } }).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expectLocalNoSocket(result, server, 504);
    expect(ffmpeg.children[0].kills).toEqual(["SIGKILL"]);
    for (const stream of [ffmpeg.children[0].stdin, ffmpeg.children[0].stdout, ffmpeg.children[0].stderr]) expect(stream.destroyed).toBe(true);
  });

  it("reports a missing ffmpeg as a local capability error without needing an account", async () => {
    const missing = fakeFfmpeg(decodes(), { present: [] });
    const server = liveServer();
    for (const credentials of [CRED_A, null]) {
      const result = await converting(server, missing).transcribe({ model: MODEL, formData: form(), credentials });
      expectLocalNoSocket(result, server, 503);
      expect(result.error).toMatch(/needs ffmpeg/);
    }
    expect(missing.access.mock.calls.map(([path]) => path)).toEqual([...GEMINI_LIVE_FFMPEG_CANDIDATES, ...GEMINI_LIVE_FFMPEG_CANDIDATES]);
    expect(missing.spawn).not.toHaveBeenCalled();

    // A binary that disappears between the check and the spawn.
    const vanished = fakeFfmpeg();
    vanished.spawn.mockImplementation(() => {
      const child = new EventEmitter();
      Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
      return child;
    });
    const gone = await converting(server, vanished).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expectLocalNoSocket(gone, server, 503);
  });

  it("uses a later fixed location when the first is absent", async () => {
    const ffmpeg = fakeFfmpeg(decodes(), { present: ["/usr/local/bin/ffmpeg"] });
    const server = liveServer();
    const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(result.success).toBe(true);
    expect(ffmpeg.calls[0].command).toBe("/usr/local/bin/ffmpeg");
  });

  it("gives the child a fixed credential-free environment", async () => {
    vi.stubEnv("GEMINI_API_KEY", "SYNTHETIC-env-secret-gemini");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/SYNTHETIC/creds.json");
    vi.stubEnv("NPM_TOKEN", "SYNTHETIC-env-secret-npm");
    vi.stubEnv("LD_PRELOAD", "/SYNTHETIC/evil.so");
    const ffmpeg = fakeFfmpeg();
    const server = liveServer();
    const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form(), credentials: { ...CRED_A, accessToken: "SYNTHETIC-token" } });
    expect(result.success).toBe(true);
    const { options } = ffmpeg.calls[0];
    expect(options.env).toEqual({ LC_ALL: "C", AV_LOG_FORCE_NOCOLOR: "1" });
    const spawned = JSON.stringify(ffmpeg.calls[0]);
    for (const secret of ["SYNTHETIC-env-secret", "creds.json", "evil.so", KEY_A, "SYNTHETIC-token", "PATH"]) expect(spawned).not.toContain(secret);
  });

  it("converts before reading credentials: no credential still spends no socket", async () => {
    const ffmpeg = fakeFfmpeg();
    const server = liveServer();
    const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form(), credentials: {} });
    expect(result.status).toBe(401);
    expect(ffmpeg.spawn).toHaveBeenCalledTimes(1);
    expect(server.sockets).toHaveLength(0);
  });

  it("checks request fields before spawning", async () => {
    const ffmpeg = fakeFfmpeg();
    const server = liveServer();
    for (const override of [{ model: "gemini-2.5-flash" }, { kind: "translation" }, { formData: form({ stream: "true" }) }, { formData: form({ temperature: "0.2" }) }]) {
      const result = await converting(server, ffmpeg).transcribe({ model: MODEL, formData: form(), credentials: CRED_A, ...override });
      expectLocalNoSocket(result, server, 400);
    }
    expect(ffmpeg.spawn).not.toHaveBeenCalled();
  });
});

describe("Gemini Live converted audio across accounts", () => {
  it("keeps two accounts separate and never replays converted audio after it was accepted", async () => {
    const pcm = decodedPcm(6400);
    const ffmpeg = fakeFfmpeg(decodes(pcm));
    // Account A: Gemini answers the first audio frame with an in-band error.
    const failing = liveServer({
      script: (socket, frame) => {
        if (frame.setup) return socket.push({ setupComplete: {} });
        if (frame.realtimeInput?.audio && !socket.erred) {
          socket.erred = true;
          socket.push({ error: { code: 500, status: "INTERNAL", message: `boom ${KEY_A}` } });
        }
      },
    });
    const first = await converting(failing, ffmpeg).transcribe({ model: MODEL, formData: form(), credentials: CRED_A });
    expect(first.success).not.toBe(true);
    expect(first.acceptedJob).toMatchObject({ costSource: "accepted-job", meta: { jobState: expect.stringMatching(/^(?:accepted|submit-unknown)$/) } });
    expect(first.local).toBeUndefined();
    expect(failing.sockets).toHaveLength(1);
    expect(audioFrames(failing.sockets[0]).length).toBeGreaterThanOrEqual(1);
    expect(failing.sockets[0].options.headers).toEqual({ "x-goog-api-key": KEY_A });
    expect(ffmpeg.spawn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain(KEY_A);

    // Account B: a fresh request converts once more and uses only B's key.
    const healthy = liveServer();
    const second = await converting(healthy, ffmpeg).transcribe({ model: MODEL, formData: form(), credentials: CRED_B });
    expect(second.success).toBe(true);
    expect(healthy.sockets).toHaveLength(1);
    expect(healthy.sockets[0].options.headers).toEqual({ "x-goog-api-key": KEY_B });
    expect(healthy.sockets[0].sent).toEqual(sourceFrames(pcm));
    expect(ffmpeg.spawn).toHaveBeenCalledTimes(2);
    expect(failing.sockets).toHaveLength(1);
  });
});
