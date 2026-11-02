import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ key: "audio-client-key", combo: null, denied: false, ledgerFailure: false }));
vi.mock("@/lib/localDb", async () => {
  const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
  return {
    saveRequestUsage: async (...args) => {
      if (state.ledgerFailure) throw new Error("ledger unavailable");
      return saveRequestUsage(...args);
    },
    getSettings: async () => ({}),
    getApiKeyByKey: async () => null,
    getComboForModel: async () => null,
  };
});
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: state.key, auth: { ok: true, apiKeyId: state.key ? "audio-key-id" : null } }),
  hasValidCliToken: async () => false,
  getNoAuthProviderCredentials: vi.fn(async () => ({ connectionId: null })),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async (_provider, excluded) => ({ apiKey: "provider-secret", connectionId: excluded.size ? "account-b" : "account-a" })),
  markAccountUnavailable: vi.fn(async (_id, status) => ({ shouldFallback: status === 429 })),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = value.split("/"); return { provider, model: model.join("/") }; },
  getComboModels: async () => state.combo,
  getComboCanonicalName: async () => state.combo ? "audio-combo" : null,
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (model) => !model,
  resolveMediaRoute: async () => ({ models: state.combo }),
  defaultRouteComboOptions: () => ({}),
  supportsTranslation: () => true,
}));
vi.mock("open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: async () => ({ allowedConnectionIds: ["account-a", "account-b"], restrictionApplied: true }) }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: async ({ body, models, handleSingleModel }) => {
    let response;
    for (const model of models) { response = await handleSingleModel(body, model); if (response.ok) return response; }
    return response;
  },
}));
vi.mock("@/sse/services/apiKeyPolicy.js", async (original) => ({
  ...await original(),
  enforceApiKeyModelPolicy: async () => state.denied ? new Response("Denied", { status: 403 }) : null,
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));

let directory;
let previousDataDir;
let previousEngine;
let listeners;
let adapter;
let handleStt;
let handleTts;
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function sttRequest(model = "openai/whisper-1", kind = "transcriptions") {
  const body = new FormData();
  if (model) body.set("model", model);
  body.set("file", new Blob(["audio"], { type: "audio/wav" }), "input.wav");
  return new Request(`http://localhost/v1/audio/${kind}`, { method: "POST", body });
}
const ttsRequest = (model = "openai/tts-1/alloy", input = "  hello 🌍  ", options = {}, signal) => new Request("http://localhost/v1/audio/speech", { method: "POST", body: JSON.stringify({ model, input, ...options }), signal });
const rows = () => adapter.all("SELECT * FROM usageHistory ORDER BY timestamp");
const metadata = (row) => JSON.parse(row.meta);

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  previousDataDir = process.env.DATA_DIR;
  previousEngine = process.env.DURINDOOR_DATABASE_ENGINE;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "audio-usage-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  state.key = "audio-client-key"; state.combo = null; state.denied = false; state.ledgerFailure = false;
  vi.stubGlobal("fetch", vi.fn());
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)", ["audio-key-id", state.key, "Audio test", new Date().toISOString()]);
  ({ handleStt } = await import("@/sse/handlers/stt.js"));
  ({ handleTts } = await import("@/sse/handlers/tts.js"));
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
  if (previousEngine === undefined) delete process.env.DURINDOOR_DATABASE_ENGINE; else process.env.DURINDOOR_DATABASE_ENGINE = previousEngine;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("audio handlers commit normalized native usage", () => {
  it("retains Deepgram duration before reducing its provider response to text", async () => {
    fetch.mockResolvedValue(json({ metadata: { duration: 12.5 }, results: { channels: [{ alternatives: [{ transcript: "hello" }] }] } }));
    const response = await handleStt(sttRequest("deepgram/nova-3"));
    expect(await response.json()).toEqual({ text: "hello" });
    const [row] = rows();
    expect(row).toMatchObject({ provider: "deepgram", model: "nova-3", connectionId: "account-a", endpoint: "/v1/audio/transcriptions", cost: null });
    expect(metadata(row)).toMatchObject({ modality: "stt", nativeUnits: { audioSeconds: 12.5 }, costStatus: "unknown", costSource: "unavailable" });
  });

  it("retains AssemblyAI duration from the completed poll, not the upload", async () => {
    vi.useFakeTimers();
    fetch.mockResolvedValueOnce(json({ upload_url: "https://audio.invalid/upload" }))
      .mockResolvedValueOnce(json({ id: "transcript-id" }))
      .mockResolvedValueOnce(json({ status: "completed", text: "hello", audio_duration: 21 }));
    const { handleSttCore } = await import("open-sse/handlers/sttCore.js");
    const formData = new FormData();
    formData.set("file", new Blob(["audio"]), "audio.wav");
    const pending = handleSttCore({ provider: "assemblyai", model: "universal-2", formData, credentials: { apiKey: "test" }, sttConfig: { format: "assemblyai", baseUrl: "https://api.assemblyai.com/v2/transcript" } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.nativeUnits).toEqual({ audioSeconds: 21 });
    expect(await result.response.json()).toEqual({ text: "hello" });
  });

  it("keeps AssemblyAI terminal failures secret without recording successful usage", async () => {
    const { getProviderCredentialsWithQuotaPreflight, markAccountUnavailable } = await import("@/sse/services/auth.js");
    const token = "opaque-media-1150";
    getProviderCredentialsWithQuotaPreflight.mockResolvedValueOnce({ apiKey: token, connectionId: "account-a", connectionName: "Fixture" });
    const responses = [
      json({ upload_url: "https://audio.invalid/upload" }),
      json({ id: "transcript-id" }),
      json({ status: "error", error: `denied ${token} /home/fixture/private.ts:7` }),
    ];
    fetch.mockImplementation(async () => {
      if (!responses.length) throw new Error("Unexpected AssemblyAI fetch");
      return responses.shift();
    });
    vi.useFakeTimers();
    try {
      const pending = handleStt(sttRequest("assemblyai/universal-2"));
      // Multipart and Blob I/O may yield before the core registers its poll timer.
      for (let turn = 0; turn < 100 && vi.getTimerCount() === 0; turn++) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      const response = await pending;
      const wire = await response.text();
      const body = JSON.parse(wire);
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(body).not.toHaveProperty("text");
      expect(body.error.message).toContain("denied");
      // A secrecy failure must not hide account lifecycle or real ledger evidence.
      expect.soft(wire).not.toContain(token);
      expect.soft(wire).not.toContain("/home/fixture/private.ts:7");
      expect(fetch.mock.calls.map(([url, init]) => [String(url), init.method || "GET"])).toEqual([
        ["https://api.assemblyai.com/v2/upload", "POST"],
        ["https://api.assemblyai.com/v2/transcript", "POST"],
        ["https://api.assemblyai.com/v2/transcript/transcript-id", "GET"],
      ]);
      for (const [, init] of fetch.mock.calls) {
        expect(new Headers(init.headers).get("authorization")).toBe(token);
      }
      expect(getProviderCredentialsWithQuotaPreflight).toHaveBeenCalledExactlyOnceWith(
        "assemblyai", new Set(), "universal-2", { apiKeyId: "audio-key-id" },
      );
      expect(markAccountUnavailable).toHaveBeenCalledExactlyOnceWith(
        "account-a", 500, body.error.message, "assemblyai", "universal-2", null, { usedCredential: token },
      );
      expect(rows()).toEqual([]);
      expect(responses).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
      expect(rows()).toEqual([]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }, 5000);

  it("prices reported Whisper seconds and preserves translation scope and caller identity", async () => {
    fetch.mockResolvedValue(json({ text: "translated", duration: 60 }));
    const response = await handleStt(sttRequest("openai/whisper-1", "translations"), { kind: "translation" });
    expect(await response.json()).toEqual({ text: "translated", duration: 60 });
    expect(rows()[0]).toMatchObject({ apiKey: state.key, endpoint: "/v1/audio/translations", cost: 0.006, usageEventId: `${response.headers.get("x-request-id")}:stt` });
    expect(metadata(rows()[0]).costStatus).toBe("estimated");
    expect(String(fetch.mock.calls[0][0])).toContain("/audio/translations");
  });

  it("leaves missing duration unpriced without inventing tokens", async () => {
    fetch.mockResolvedValue(json({ text: "hello" }));
    const response = await handleStt(sttRequest());
    expect(response.status).toBe(200);
    expect(rows()[0]).toMatchObject({ promptTokens: 0, completionTokens: 0, cost: null });
    expect(metadata(rows()[0]).nativeUnits).toEqual({});
  });

  it.each([{ total_tokens: 17 }, { input_tokens: -1 }, { input_tokens: "12" }, 42])("rejects invalid or total-only provider usage without granting successful use: %j", async (usage) => {
    fetch.mockResolvedValue(json({ text: "hello", usage }));
    const response = await handleStt(sttRequest());
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(rows()).toEqual([]);
  });

  it("keeps binary synthesis unread and charges trimmed characters, not invented tokens", async () => {
    const audio = new Uint8Array([0, 255, 1, 128]);
    fetch.mockResolvedValue(new Response(audio, { headers: { "content-type": "audio/mpeg" } }));
    const response = await handleTts(ttsRequest());
    expect(response.bodyUsed).toBe(false);
    expect(rows()).toEqual([]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio);
    expect(rows()[0]).toMatchObject({ apiKey: state.key, provider: "openai", model: "tts-1/alloy", connectionId: "account-a", endpoint: "/v1/audio/speech", promptTokens: 0, completionTokens: 0, usageEventId: `${response.headers.get("x-request-id")}:tts` });
    expect(rows()[0].cost).toBeCloseTo(7 * 15 / 1_000_000);
    expect(metadata(rows()[0])).toMatchObject({ modality: "tts", nativeUnits: { characters: 7 }, costStatus: "estimated" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).input).toBe("hello 🌍");
  });

  it("bills raw OpenAI audio only once at clean EOF without pulling at headers", async () => {
    const audio = new Uint8Array([0, 255, 1, 128]);
    const pull = vi.fn((controller) => {
      if (pull.mock.calls.length === 1) controller.enqueue(audio);
      else controller.close();
    });
    fetch.mockResolvedValue(new Response(new ReadableStream({ pull }, { highWaterMark: 0 })));
    const response = await handleTts(ttsRequest());
    expect(pull).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
    const reader = response.body.getReader();
    expect(await reader.read()).toEqual({ done: false, value: audio });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual([]);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(rows()).toHaveLength(1);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(rows()).toHaveLength(1);
  });

  it.each(["error", "cancel"])("does not bill raw OpenAI audio after midstream %s", async (ending) => {
    const audio = new Uint8Array([1, 2]);
    const cancel = vi.fn();
    let sent = false;
    fetch.mockResolvedValue(new Response(new ReadableStream({
      pull(controller) {
        if (sent) controller.error(new Error("raw audio transport failed"));
        else { sent = true; controller.enqueue(audio); }
      },
      cancel,
    }, { highWaterMark: 0 })));
    const response = await handleTts(ttsRequest());
    expect(rows()).toEqual([]);
    const reader = response.body.getReader();
    expect(await reader.read()).toEqual({ done: false, value: audio });
    expect(rows()).toEqual([]);
    if (ending === "error") await expect(reader.read()).rejects.toThrow("raw audio transport failed");
    else {
      await reader.cancel("client left");
      expect(cancel).toHaveBeenCalledExactlyOnceWith("client left");
    }
    expect(rows()).toEqual([]);
  });

  it("propagates asynchronous ledger failure at raw OpenAI EOF", async () => {
    state.ledgerFailure = true;
    fetch.mockResolvedValue(new Response(new Uint8Array([1, 2])));
    const response = await handleTts(ttsRequest());
    expect(rows()).toEqual([]);
    await expect(response.arrayBuffer()).rejects.toThrow("ledger unavailable");
    expect(rows()).toEqual([]);
  });

  it.each([0, 0.003])("records nonstream provider receipts including known zero without consuming audio: %s", async (cost) => {
    const usage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8, cost };
    fetch.mockResolvedValue(new Response(`data: ${JSON.stringify({ id: "receipt-id", choices: [{ delta: { audio: { data: "AQI=" } } }] })}\n\ndata: ${JSON.stringify({ usage })}\n\ndata: [DONE]\n\n`));
    const response = await handleTts(ttsRequest("openrouter/openai/gpt-4o-mini-tts/alloy"));
    expect(response.bodyUsed).toBe(false);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: state.key, connectionId: "account-a", cost, promptTokens: 3, completionTokens: 5 });
    expect(metadata(rows()[0])).toMatchObject({ costStatus: "known", costSource: "provider:openrouter", providerReceipt: { id: "receipt-id", usage } });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it.each([true, false])("records only completed streams after EOF, not headers: terminal=%s", async (terminal) => {
    const wire = `data: ${JSON.stringify({ data: { status: terminal ? 2 : 1, audio: "00ff0180" }, extra_info: { audio_length: 1250, usage_characters: 6 }, trace_id: "stream-receipt" })}\n\n`;
    fetch.mockResolvedValue(new Response(wire, { headers: { "content-type": "text/event-stream" } }));
    const response = await handleTts(ttsRequest("minimax/speech-2.8-hd/English_expressive_narrator", "hello 🌍", { stream: true }));
    expect(response.bodyUsed).toBe(false);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(rows()).toEqual([]);
    expect(await response.text()).toBe(wire);
    if (!terminal) {
      expect(rows()).toEqual([]);
      return;
    }
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ apiKey: state.key, provider: "minimax", model: "speech-2.8-hd/English_expressive_narrator", connectionId: "account-a", endpoint: "/v1/audio/speech", usageEventId: `${response.headers.get("x-request-id")}:tts` });
    expect(metadata(rows()[0])).toMatchObject({ nativeUnits: { characters: 6, audioSeconds: 1.25 }, providerReceipt: { trace_id: "stream-receipt" } });
  });

  it.each(["consumer", "request"])("does not bill streams aborted by %s", async (source) => {
    const cancel = vi.fn();
    const controller = new AbortController();
    fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })));
    const response = await handleTts(ttsRequest("minimax/speech-2.8-hd/English_expressive_narrator", "hello", { stream: true }, controller.signal));
    if (source === "consumer") await response.body.cancel("client left");
    else {
      controller.abort();
      await expect(response.arrayBuffer()).rejects.toMatchObject({ name: "AbortError" });
    }
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(rows()).toEqual([]);
  });

  it("propagates upstream stream errors without successful usage", async () => {
    fetch.mockResolvedValue(new Response(new ReadableStream({ pull(controller) { controller.error(new Error("transport failed")); } }, { highWaterMark: 0 })));
    const response = await handleTts(ttsRequest("minimax/speech-2.8-hd/English_expressive_narrator", "hello", { stream: true }));
    await expect(response.arrayBuffer()).rejects.toThrow("transport failed");
    expect(rows()).toEqual([]);
  });

  it("fails stream consumption when final accounting cannot commit", async () => {
    state.ledgerFailure = true;
    fetch.mockResolvedValue(new Response('data: {"data":{"status":2,"audio":"0102"}}\n\n'));
    const response = await handleTts(ttsRequest("minimax/speech-2.8-hd/English_expressive_narrator", "hello", { stream: true }));
    expect(rows()).toEqual([]);
    await expect(response.arrayBuffer()).rejects.toThrow("ledger unavailable");
    expect(rows()).toEqual([]);
  });

  it("does not label an unpriced speech model free", async () => {
    fetch.mockResolvedValue(new Response("audio"));
    const response = await handleTts(ttsRequest("openai/gpt-4o-mini-tts/alloy"));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(rows()[0].cost).toBeNull();
    expect(metadata(rows()[0])).toMatchObject({ costStatus: "unknown", costSource: "unavailable" });
  });

  it("records only the successful fallback account with one logical event identity", async () => {
    fetch.mockResolvedValueOnce(json({ error: { message: "quota" } }, 429)).mockResolvedValueOnce(json({ text: "hello", duration: 2 }));
    const response = await handleStt(sttRequest());
    expect(response.status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ connectionId: "account-b", usageEventId: `${response.headers.get("x-request-id")}:stt` });
  });

  it("uses the same request identity through a speech combo and keeps its account restrictions", async () => {
    state.combo = ["openai/tts-1/alloy"];
    fetch.mockResolvedValue(new Response("audio"));
    const response = await handleTts(ttsRequest("audio-combo"));
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(rows()[0]).toMatchObject({ model: "tts-1/alloy", usageEventId: `${response.headers.get("x-request-id")}:tts` });
    const { getProviderCredentialsWithQuotaPreflight } = await import("@/sse/services/auth.js");
    expect(getProviderCredentialsWithQuotaPreflight).toHaveBeenCalledWith("openai", expect.any(Set), "tts-1/alloy", { apiKeyId: "audio-key-id", allowedConnectionIds: ["account-a", "account-b"], restrictionApplied: true });
  });

  it("records no-auth local usage without key or connection and without guessing free cost", async () => {
    state.key = null;
    // Use the real no-auth handler path with a fixed public OpenAI-compatible STT config.
    const { AI_PROVIDERS } = await import("@/shared/constants/providers");
    const config = AI_PROVIDERS["local-whisper"].sttConfig;
    const original = { ...config };
    try {
      Object.assign(config, { userConfigurableHost: false, baseUrl: "https://audio.invalid/v1/audio/transcriptions" });
      fetch.mockResolvedValue(json({ text: "local" }));
      const response = await handleStt(sttRequest("local-whisper/whisper-1"));
      expect(response.status).toBe(200);
      expect(rows()[0]).toMatchObject({ apiKey: null, connectionId: null, cost: null, usageEventId: `${response.headers.get("x-request-id")}:stt` });
    } finally { Object.assign(config, original); }
  });

  it("policy and input failures never reach transport or grant successful use", async () => {
    state.denied = true;
    expect((await handleTts(ttsRequest())).status).toBe(403);
    state.denied = false;
    expect((await handleTts(ttsRequest("openai/tts-1/alloy", {}))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });
});

describe("TTS core preserves internal provider accounting without wire changes", () => {
  const synthesize = async (provider, model, options = {}) => {
    const { handleTtsCore } = await import("open-sse/handlers/ttsCore.js");
    return handleTtsCore({ provider, model, input: " hello 🌍 ", credentials: { apiKey: "test" }, ...options });
  };
  const geminiAudio = { candidates: [{ content: { parts: [{ inlineData: { data: "AQI=", mimeType: "audio/pcm" } }] } }] };

  it("includes Gemini thoughts in output once and preserves the original receipt", async () => {
    const usageMetadata = { promptTokenCount: 3, candidatesTokenCount: 5, thoughtsTokenCount: 2, cachedContentTokenCount: 1, totalTokenCount: 10 };
    fetch.mockResolvedValue(json({ ...geminiAudio, responseId: "gemini-receipt", usageMetadata }));
    const result = await synthesize("gemini", "gemini-2.5-flash-preview-tts/Kore");
    expect(result.success).toBe(true);
    expect(result.accounting).toMatchObject({ tokens: { input_tokens: 3, output_tokens: 7, reasoning_tokens: 2, cached_tokens: 1, total_tokens: 10 }, nativeUnits: { characters: 7 }, meta: { providerReceipt: { responseId: "gemini-receipt", usage: usageMetadata } }, cost: null, costStatus: "unknown" });
    expect(result.response.bodyUsed).toBe(false);
    const bytes = new Uint8Array(await result.response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(bytes.subarray(44)).toEqual(new Uint8Array([1, 2]));
  });

  it.each([
    { totalTokenCount: 10 },
    { promptTokenCount: 3, candidatesTokenCount: 5, thoughtsTokenCount: 2, totalTokenCount: 8 },
    { promptTokenCount: "3", candidatesTokenCount: 5 },
    { promptTokenCount: 3, thoughtsTokenCount: 2 },
    { promptTokenCount: 3, candidatesTokenCount: -1 },
  ])("rejects ambiguous or invalid Gemini components: %j", async (usageMetadata) => {
    fetch.mockResolvedValue(json({ ...geminiAudio, usageMetadata }));
    const result = await synthesize("gemini", "gemini-2.5-flash-preview-tts/Kore");
    expect(result.success).toBe(false);
    expect(result.accounting).toBeUndefined();
  });

  it("keeps absent Gemini usage absent rather than creating a zero receipt", async () => {
    fetch.mockResolvedValue(json(geminiAudio));
    const result = await synthesize("gemini", "gemini-2.5-flash-preview-tts/Kore");
    expect(result.success).toBe(true);
    expect(result.accounting.tokens).toEqual({});
    expect(result.accounting.meta).toBeUndefined();
    expect(result.accounting.cost).toBeNull();
  });

  it("retains interactions usage and reported duration outside the JSON audio body", async () => {
    fetch.mockResolvedValue(json({ id: "interaction-id", usage: { total_input_tokens: 3, total_output_tokens: 5, total_tokens: 8 }, steps: [{ type: "model_output", content: [{ type: "audio", data: "AQI=", mime_type: "audio/pcm", duration_seconds: 1.25 }] }] }));
    const result = await synthesize("gemini", "gemini-3.8-flash-tts/Kore", { responseFormat: "json" });
    expect(result.accounting).toMatchObject({ tokens: { input_tokens: 3, output_tokens: 5, total_tokens: 8 }, nativeUnits: { audioSeconds: 1.25, characters: 7 }, meta: { providerReceipt: { id: "interaction-id" } } });
    expect(result.response.bodyUsed).toBe(false);
    expect(Object.keys(await result.response.json()).sort()).toEqual(["audio", "format"]);
  });

  it("retains MiniMax millisecond duration and receipt before hex conversion", async () => {
    const extra_info = { audio_length: 1250, audio_format: "mp3", usage_characters: 6 };
    fetch.mockResolvedValue(json({ data: { audio: "00ff0180" }, extra_info, trace_id: "minimax-receipt", base_resp: { status_code: 0 } }));
    const result = await synthesize("minimax", "speech-2.8-hd/English_expressive_narrator");
    expect(result.accounting).toMatchObject({ tokens: {}, nativeUnits: { characters: 6, audioSeconds: 1.25 }, meta: { providerReceipt: { extra_info, trace_id: "minimax-receipt" } }, cost: null });
    expect(result.response.bodyUsed).toBe(false);
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(new Uint8Array([0, 255, 1, 128]));
  });

  it.each([0, 0.003])("retains OpenRouter's actual USD receipt including explicit zero: %s", async (cost) => {
    const usage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8, cost };
    fetch.mockResolvedValue(new Response(`data: ${JSON.stringify({ id: "router-id", choices: [{ delta: { audio: { data: "AQI=" } } }] })}\r\n\r\ndata:${JSON.stringify({ usage })}\n\ndata: [DONE]`));
    const result = await synthesize("openrouter", "openai/gpt-4o-mini-tts/alloy");
    expect(result.accounting).toMatchObject({ tokens: usage, cost, costStatus: "known", costSource: "provider:openrouter", meta: { providerReceipt: { id: "router-id", usage } } });
    expect(result.response.bodyUsed).toBe(false);
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it.each(["", 'data: {"error":{"message":"failed"}}\n\n'])("does not return partial OpenRouter audio as successful completion: %s", async (ending) => {
    fetch.mockResolvedValue(new Response(`data: {"choices":[{"delta":{"audio":{"data":"AQI="}}}]}\n\n${ending}`));
    const result = await synthesize("openrouter", "openai/gpt-4o-mini-tts/alloy");
    expect(result.success).toBe(false);
  });

  it.each([true, false])("defers MiniMax accounting until consumption and distinguishes terminal from EOF: %s", async (terminal) => {
    const wire = `data: ${JSON.stringify({ data: { status: terminal ? 2 : 1, audio: "0102" }, extra_info: { audio_length: 1250 }, trace_id: "stream-id" })}\n\n`;
    fetch.mockResolvedValue(new Response(wire, { headers: { "content-type": "text/event-stream" } }));
    const result = await synthesize("minimax", "speech-2.8-hd/English_expressive_narrator", { stream: true });
    let settled = false;
    result.accountingCompletion.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(result.response.bodyUsed).toBe(false);
    expect(await result.response.text()).toBe(wire);
    expect(await result.accountingCompletion).toMatchObject({ status: terminal ? "completed" : "incomplete", accounting: { nativeUnits: { characters: 7, audioSeconds: 1.25 }, meta: { providerReceipt: { trace_id: "stream-id" } } } });
  });

  it("marks downstream MiniMax cancellation aborted, not completed", async () => {
    const cancel = vi.fn();
    fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })));
    const result = await synthesize("minimax", "speech-2.8-hd/English_expressive_narrator", { stream: true });
    await result.response.body.cancel("client left");
    expect(await result.accountingCompletion).toMatchObject({ status: "aborted" });
    expect(cancel).toHaveBeenCalledWith("client left");
  });

  it("marks request-signal cancellation aborted before the stream is read", async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })));
    const result = await synthesize("minimax", "speech-2.8-hd/English_expressive_narrator", { stream: true, signal: controller.signal });
    controller.abort();
    expect(await result.accountingCompletion).toMatchObject({ status: "aborted" });
    expect(result.response.bodyUsed).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });

  it("does not invent an OpenRouter cost receipt when usage is absent", async () => {
    fetch.mockResolvedValue(new Response('data: {"choices":[{"delta":{"audio":{"data":"AQI="}}}]}\n\ndata: [DONE]\n\n'));
    const result = await synthesize("openrouter", "openai/gpt-4o-mini-tts/alloy");
    expect(result.accounting).toMatchObject({ tokens: {}, cost: null, costStatus: "unknown" });
    expect(result.accounting.meta).toBeUndefined();
  });

  it("does not complete OpenRouter synthesis after an abort", async () => {
    const controller = new AbortController();
    fetch.mockResolvedValue(new Response('data: {"choices":[{"delta":{"audio":{"data":"AQI="}}}]}\n\ndata: [DONE]\n\n'));
    controller.abort();
    const result = await synthesize("openrouter", "openai/gpt-4o-mini-tts/alloy", { signal: controller.signal });
    expect(result.success).toBe(false);
  });

  it("marks MiniMax upstream read failures error", async () => {
    fetch.mockResolvedValue(new Response(new ReadableStream({ pull(controller) { controller.error(new Error("transport failed")); } }, { highWaterMark: 0 })));
    const result = await synthesize("minimax", "speech-2.8-hd/English_expressive_narrator", { stream: true });
    await expect(result.response.text()).rejects.toThrow("transport failed");
    expect(await result.accountingCompletion).toMatchObject({ status: "error" });
  });
});
