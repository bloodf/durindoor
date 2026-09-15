/**
 * Local Whisper is a self-hosted OpenAI-compatible transcription server, so its
 * host belongs to the user rather than the registry. These guards pin the two
 * things that make the connection dialog's base-URL field meaningful: the
 * stored origin is actually used, and only the origin is honored so a stored
 * path cannot redirect audio to an unintended route.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import {
  LOCAL_WHISPER_DEFAULT_HOST,
  resolveLocalWhisperHost,
} from "../../open-sse/config/providers.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { PROVIDER_MODELS, PROVIDERS } from "../../open-sse/providers/index.js";

const originalFetch = global.fetch;
const TRANSCRIPTION_PATH = "/v1/audio/transcriptions";

function sttConfig() {
  return REGISTRY.find((entry) => entry.id === "local-whisper").sttConfig;
}

function formDataWithAudio() {
  const fd = new FormData();
  fd.append("file", new File(["fake-audio"], "clip.wav", { type: "audio/wav" }));
  return fd;
}

async function transcribe(credentials) {
  return handleSttCore({
    provider: "local-whisper",
    model: "whisper-1",
    formData: formDataWithAudio(),
    credentials,
    sttConfig: sttConfig(),
  });
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ text: "hello" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("resolveLocalWhisperHost", () => {
  it("defaults when no base URL is stored", () => {
    expect(resolveLocalWhisperHost(null)).toBe(LOCAL_WHISPER_DEFAULT_HOST);
    expect(resolveLocalWhisperHost({})).toBe(LOCAL_WHISPER_DEFAULT_HOST);
    expect(resolveLocalWhisperHost({ providerSpecificData: { baseUrl: "   " } })).toBe(
      LOCAL_WHISPER_DEFAULT_HOST,
    );
  });

  it("honors a user-supplied host and port", () => {
    expect(
      resolveLocalWhisperHost({ providerSpecificData: { baseUrl: "http://192.168.1.50:9000" } }),
    ).toBe("http://192.168.1.50:9000");
  });

  it("keeps only the origin so a stored path cannot redirect audio", () => {
    expect(
      resolveLocalWhisperHost({
        providerSpecificData: { baseUrl: "http://127.0.0.1:11500/some/other/route?x=1#f" },
      }),
    ).toBe("http://127.0.0.1:11500");
  });

  it("rejects a non-http scheme rather than building a bogus endpoint", () => {
    expect(
      resolveLocalWhisperHost({ providerSpecificData: { baseUrl: "file:///etc/passwd" } }),
    ).toBe(LOCAL_WHISPER_DEFAULT_HOST);
    expect(resolveLocalWhisperHost({ providerSpecificData: { baseUrl: "not a url" } })).toBe(
      LOCAL_WHISPER_DEFAULT_HOST,
    );
  });
});

describe("local-whisper STT requests", () => {
  it("posts transcriptions to the stored host", async () => {
    const result = await transcribe({
      connectionId: "conn-1",
      providerSpecificData: { baseUrl: "http://192.168.1.50:9000" },
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(`http://192.168.1.50:9000${TRANSCRIPTION_PATH}`);
  });

  it("falls back to the default host when none is stored", async () => {
    await transcribe({ connectionId: "conn-2" });
    expect(global.fetch.mock.calls[0][0]).toBe(`${LOCAL_WHISPER_DEFAULT_HOST}${TRANSCRIPTION_PATH}`);
  });

  it("sends no Authorization header for the keyless local server", async () => {
    await transcribe({ connectionId: "conn-3" });
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("transcribes without credentials instead of demanding a key", async () => {
    const result = await transcribe(null);
    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe(`${LOCAL_WHISPER_DEFAULT_HOST}${TRANSCRIPTION_PATH}`);
  });

  it("returns the server's transcription text", async () => {
    const result = await transcribe({ connectionId: "conn-4" });
    await expect(result.response.json()).resolves.toEqual({ text: "hello" });
  });

  it("refuses a cloud-metadata target instead of fetching it", async () => {
    // A saved base URL is operator input that reaches fetch() directly, so the
    // outbound guard must reject the instance-credentials endpoint. Loopback
    // and LAN stay allowed under the default policy (covered above).
    const result = await transcribe({
      connectionId: "conn-ssrf",
      providerSpecificData: { baseUrl: "http://169.254.169.254" },
    });

    expect(result.success).toBeFalsy();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("local-whisper registry entry", () => {
  it("declares a keyless OpenAI-format STT provider with a user-configurable host", () => {
    const entry = REGISTRY.find((r) => r.id === "local-whisper");
    expect(entry.serviceKinds).toEqual(["stt"]);
    expect(entry.sttConfig).toMatchObject({
      authType: "none",
      format: "openai",
      userConfigurableHost: true,
    });
  });

  it("is reachable through the exact lookup the STT route performs", () => {
    // src/sse/handlers/stt.js resolves sttConfig via AI_PROVIDERS[provider].
    // Registry `models` and `sttConfig` reach it directly, which is why this
    // provider needs no entry in config/providerModels.js — same as every other
    // self-hosted provider (ollama-local, lm-studio).
    expect(AI_PROVIDERS["local-whisper"]?.sttConfig).toMatchObject({
      format: "openai",
      authType: "none",
      userConfigurableHost: true,
    });
    expect(AI_PROVIDERS["local-whisper"]?.serviceKinds).toEqual(["stt"]);
    expect(PROVIDER_MODELS["local-whisper"].map((m) => m.id)).toEqual(["whisper-1"]);
  });

  it("exposes no chat surface", () => {
    // No transport block, so the provider never enters the default-executor
    // URL/header matrix. A transport would let /v1/chat/completions target a
    // transcription server that cannot answer it — while models and the STT
    // config must stay reachable.
    expect(PROVIDERS["local-whisper"]).toBeUndefined();
    expect(PROVIDER_MODELS["local-whisper"].map((m) => m.id)).toEqual(["whisper-1"]);
    expect(AI_PROVIDERS["local-whisper"]?.sttConfig).toBeDefined();
  });
});
