import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import registry from "../../open-sse/providers/registry/elevenlabs.js";
import { KIE_STT_MODELS } from "../../open-sse/services/providerParity/native-kie-tts-stt/config.js";
import { createElevenLabsSttAdapter } from "../../open-sse/services/providerParity/native-elevenlabs-stt/index.js";

function form(format = "json") {
  const body = new FormData();
  body.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "sample.wav");
  body.append("language", "en");
  body.append("response_format", format);
  return body;
}
const reply = () => Response.json({ text: "hello", language_code: "en", words: [{ text: "hello", start: 0, end: 1, type: "word" }] });

describe("staged ElevenLabs Scribe", () => {
  it.each(["json", "text", "verbose_json"])("sends the source wire and normalizes %s", async (format) => {
    const fetchImpl = vi.fn(async () => reply());
    const result = await createElevenLabsSttAdapter({ fetchImpl }).transcribe({ model: "scribe_v2", formData: form(format), credentials: { apiKey: "secret", baseUrl: "https://hostile.invalid" } });
    expect(result.success).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init.headers).toEqual({ "xi-api-key": "secret" });
    expect(init.redirect).toBe("manual");
    expect([...init.body.keys()]).toEqual(["model_id", "language_code", "file"]);
    expect(init.body.get("model_id")).toBe("scribe_v2");
    expect([...new Uint8Array(await init.body.get("file").arrayBuffer())]).toEqual([1, 2, 3]);
    if (format === "text") expect(await result.response.text()).toBe("hello");
    else expect((await result.response.json()).text).toBe("hello");
  });
  it("rejects unsupported options and KIE's bare model before network", async () => {
    const fetchImpl = vi.fn(); const adapter = createElevenLabsSttAdapter({ fetchImpl });
    expect((await adapter.transcribe({ model: "elevenlabs/speech-to-text", formData: form(), credentials: { apiKey: "a" } })).local).toBe(true);
    const input = form(); input.append("temperature", "0");
    expect((await adapter.transcribe({ model: "scribe_v1", formData: input, credentials: { apiKey: "a" } })).local).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([302, 500, 503])("retains uncertain work for HTTP %s", async (status) => {
    const result = await createElevenLabsSttAdapter({ fetchImpl: async () => new Response("secret", { status, headers: { location: "https://hostile.invalid" } }) }).transcribe({ model: "scribe_v1", formData: form(), credentials: { apiKey: "secret" } });
    expect(result.acceptedJob.costSource).toBe("accepted-job");
  });
  it("bounds an unresponsive transport and records unknown cost", async () => {
    const result = await createElevenLabsSttAdapter({ timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }).transcribe({ model: "scribe_v1", formData: form(), credentials: { apiKey: "a" } });
    expect(result.acceptedJob.costSource).toBe("accepted-job");
  });
});

describe("failure and connection boundaries", () => {
  it.each([{ apiKey: "account-a", providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-a.invalid" } }, { accessToken: "account-b", providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-b.invalid" } }])("uses the selected account snapshot", async (credentials) => {
    const fetchImpl = vi.fn(async () => reply());
    await createElevenLabsSttAdapter({ fetchImpl }).transcribe({ model: "scribe_v1", formData: form(), credentials });
    expect(fetchImpl.mock.calls[0][1].headers["xi-api-key"]).toBe(credentials.apiKey || credentials.accessToken);
    expect(fetchImpl.mock.calls[0][1].noTransportReplay).toBe(true);
    expect(fetchImpl.mock.calls[0][2].connectionProxyUrl).toBe(credentials.providerSpecificData.connectionProxyUrl);
  });
  it.each([401, 402, 403, 429])("redacts a refusal body for status %s", async (status) => {
    const result = await createElevenLabsSttAdapter({ fetchImpl: async () => new Response("secret upstream message", { status }) }).transcribe({ model: "scribe_v1", formData: form(), credentials: { apiKey: "secret" } });
    expect(JSON.stringify(result)).not.toContain("secret upstream message");
    expect(result.acceptedJob).toBeUndefined();
    if (status === 402) expect(result.quotaExhausted).toBe(true);
  });
  it("treats an unusable success as accepted work", async () => {
    const result = await createElevenLabsSttAdapter({ fetchImpl: async () => Response.json({ error: "secret" }) }).transcribe({ model: "scribe_v2", formData: form(), credentials: { apiKey: "secret" } });
    expect(result.acceptedJob.costSource).toBe("accepted-job");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("records a caller abort after dispatch", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(() => { controller.abort(); return new Promise(() => {}); });
    const result = await createElevenLabsSttAdapter({ fetchImpl }).transcribe({ model: "scribe_v1", formData: form(), credentials: { apiKey: "a" }, signal: controller.signal });
    expect(result.acceptedJob.costSource).toBe("accepted-job");
  });
  it("refuses an unsupported response format before dispatch", async () => {
    const fetchImpl = vi.fn();
    const result = await createElevenLabsSttAdapter({ fetchImpl }).transcribe({ model: "scribe_v1", formData: form("srt"), credentials: { apiKey: "a" } });
    expect(result.local).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// Isolated staging guard: registration replaces this block with public routing proof.
describe("staged registration boundary", () => {
  it("leaves the existing provider and KIE bare identifier untouched", () => {
    expect(registry.sttConfig).toBeUndefined();
    expect(registry.serviceKinds).not.toContain("stt");
    expect(KIE_STT_MODELS.some((row) => row.id === "elevenlabs/speech-to-text")).toBe(true);
    const core = readFileSync(new URL("../../open-sse/handlers/sttCore.js", import.meta.url), "utf8");
    expect(core).not.toContain("native-elevenlabs-stt");
  });
  it("bounds a stalled response body and retains accepted work", async () => {
    const fetchImpl = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"text":')); } }), { headers: { "content-type": "application/json" } });
    const result = await createElevenLabsSttAdapter({ fetchImpl, timeoutMs: 15 }).transcribe({ model: "scribe_v1", formData: form(), credentials: { apiKey: "a" } });
    expect(result.acceptedJob.costSource).toBe("accepted-job");
  });
  it("normalizes word timestamps without inventing duration", async () => {
    const result = await createElevenLabsSttAdapter({ fetchImpl: async () => reply() }).transcribe({ model: "scribe_v2", formData: form("verbose_json"), credentials: { apiKey: "a" } });
    expect(await result.response.json()).toEqual({ text: "hello", language: "en", words: [{ word: "hello", start: 0, end: 1 }] });
    expect(result.nativeUnits).toEqual({});
  });
});

describe("transcript bounds and accounting", () => {
  it("keeps provider usage without inventing audio seconds", async () => {
    const fetchImpl = async () => Response.json({ text: "hello", usage: { characters: 5 } });
    const result = await createElevenLabsSttAdapter({ fetchImpl }).transcribe({ model: "scribe_v1", formData: form(), credentials: { apiKey: "a" } });
    expect(result.usageValue).toEqual({ usage: { characters: 5 } });
    expect(result.nativeUnits).toEqual({});
  });
  it("marks an oversized 2xx response as accepted work", async () => {
    const fetchImpl = async () => Response.json({ text: "a long transcript" });
    const result = await createElevenLabsSttAdapter({ fetchImpl, maxTranscriptBytes: 4 }).transcribe({ model: "scribe_v1", formData: form(), credentials: { apiKey: "a" } });
    expect(result.acceptedJob.costSource).toBe("accepted-job");
  });
  it("does not submit when already aborted", async () => {
    const controller = new AbortController(); controller.abort();
    const fetchImpl = vi.fn();
    const result = await createElevenLabsSttAdapter({ fetchImpl }).transcribe({ model: "scribe_v1", formData: form(), credentials: { apiKey: "a" }, signal: controller.signal });
    expect(result.local).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
