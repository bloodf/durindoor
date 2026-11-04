// #1135: Deepgram diarization and verbose_json. The fixture follows the shape in
// Deepgram's diarization and utterances docs; it is not a captured live response.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

const FIXTURE = JSON.parse(fs.readFileSync(new URL("../fixtures/deepgram-listen-diarized.docs-shaped.json", import.meta.url), "utf8"));
const CONFIG = { baseUrl: "https://api.deepgram.com/v1/listen", authType: "apikey", authHeader: "token", format: "deepgram" };

const run = async (fields = {}, upstream = FIXTURE, log) => {
  const formData = new FormData();
  formData.set("file", new Blob(["audio"], { type: "audio/wav" }), "input.wav");
  for (const [key, value] of Object.entries(fields)) {
    for (const item of [value].flat()) formData.append(key, item);
  }
  fetch.mockResolvedValue(new Response(JSON.stringify(upstream), { status: 200, headers: { "content-type": "application/json" } }));
  return handleSttCore({ provider: "deepgram", model: "nova-3", formData, credentials: { apiKey: "dg-key" }, sttConfig: CONFIG, log });
};
const sentQuery = () => Object.fromEntries(new URL(fetch.mock.calls[0][0]).searchParams);

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("Deepgram request parameters", () => {
  it("adds nothing to a plain request", async () => {
    await run();
    expect(sentQuery()).toEqual({ model: "nova-3", smart_format: "true", punctuate: "true", detect_language: "true" });
  });

  it("forwards diarize and asks for utterances", async () => {
    await run({ diarize: "true", response_format: "verbose_json", language: "en" });
    expect(sentQuery()).toEqual({ model: "nova-3", smart_format: "true", punctuate: "true", language: "en", diarize: "true", utterances: "true" });
  });

  it("forwards diarize_model without the deprecated diarize flag", async () => {
    await run({ diarize_model: "v2", response_format: "verbose_json" });
    expect(sentQuery()).toMatchObject({ diarize_model: "v2", utterances: "true" });
    expect(sentQuery()).not.toHaveProperty("diarize");
  });

  it("keeps client-only fields out of the provider request", async () => {
    await run({ response_format: "verbose_json", "timestamp_granularities[]": "word" });
    expect(Object.keys(sentQuery()).sort()).toEqual(["detect_language", "model", "punctuate", "smart_format"]);
  });
});

describe("Deepgram response formats", () => {
  it("json returns only the transcript", async () => {
    const result = await run();
    expect(await result.response.json()).toEqual({ text: "Hello there. Hi, how are you?" });
  });

  it("text returns the transcript as plain text and keeps the duration", async () => {
    const result = await run({ response_format: "text" });
    expect(result.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await result.response.text()).toBe("Hello there. Hi, how are you?");
    expect(result.nativeUnits).toEqual({ audioSeconds: 8.04 });
  });

  it("verbose_json maps utterances to segments, speakers and duration", async () => {
    const result = await run({ response_format: "verbose_json", diarize: "true" });
    expect(await result.response.json()).toEqual({
      task: "transcribe",
      language: "en",
      duration: 8.04,
      text: "Hello there. Hi, how are you?",
      segments: [
        { id: 0, start: 0.08, end: 0.96, text: "Hello there.", speaker: 0 },
        { id: 1, start: 4.1, end: 5.2, text: "Hi, how are you?", speaker: 1 },
      ],
      speakers: [0, 1],
    });
    expect(result.nativeUnits).toEqual({ audioSeconds: 8.04 });
  });

  it("verbose_json returns words only when asked for them", async () => {
    const both = await (await run({ response_format: "verbose_json", diarize: "true", "timestamp_granularities[]": ["segment", "word"] })).response.json();
    expect(both.segments).toHaveLength(2);
    expect(both.words).toHaveLength(6);
    expect(both.words[2]).toEqual({ word: "hi", start: 4.1, end: 4.4, speaker: 1 });
    vi.mocked(fetch).mockClear();
    const wordsOnly = await (await run({ response_format: "verbose_json", "timestamp_granularities[]": "word" })).response.json();
    expect(wordsOnly).not.toHaveProperty("segments");
    expect(wordsOnly.words).toHaveLength(6);
  });

  it("returns 502 for a non-string transcript without penalising the account", async () => {
    const upstream = { metadata: { duration: 1 }, results: { channels: [{ alternatives: [{ transcript: { nested: true } }] }] } };
    for (const response_format of ["json", "text", "verbose_json"]) {
      expect(await run({ response_format }, upstream)).toMatchObject({ success: false, status: 502, local: true, error: "Deepgram returned a non-string transcript" });
    }
  });

  it("keeps the transcript and omits a malformed duration", async () => {
    const upstream = { metadata: { duration: "8.04" }, results: { channels: [{ alternatives: [{ transcript: "kept" }] }] } };
    const verbose = await run({ response_format: "verbose_json" }, upstream);
    expect(await verbose.response.json()).toEqual({ task: "transcribe", text: "kept", segments: [] });
    expect(verbose.nativeUnits).toEqual({});
    const text = await run({ response_format: "text" }, upstream);
    expect(await text.response.text()).toBe("kept");
  });

  it("does not echo a requested language Deepgram did not report", async () => {
    const upstream = { results: { channels: [{ alternatives: [{ transcript: "oi" }] }] } };
    const body = await (await run({ response_format: "verbose_json", language: "pt" }, upstream)).response.json();
    expect(body).not.toHaveProperty("language");
  });

  it("drops backwards utterances and words", async () => {
    const upstream = { results: {
      channels: [{ alternatives: [{ transcript: "ok", words: [{ word: "bad", start: 3, end: 2 }, { word: "ok", start: 0, end: 1 }] }] }],
      utterances: [{ start: 5, end: 4, transcript: "bad" }, { start: 0, end: 1, transcript: "ok" }],
    } };
    const body = await (await run({ response_format: "verbose_json", "timestamp_granularities[]": ["segment", "word"] }, upstream)).response.json();
    expect(body.segments).toEqual([{ id: 0, start: 0, end: 1, text: "ok" }]);
    expect(body.words).toEqual([{ word: "ok", start: 0, end: 1 }]);
  });

  it("does not claim speakers, duration or language Deepgram did not return", async () => {
    const upstream = { results: {
      channels: [{ alternatives: [{ transcript: "plain" }] }],
      utterances: [
        null,
        { start: 1, transcript: "no end" },
        { start: 1, end: 2, transcript: "no speaker" },
      ],
    } };
    const plain = await run({ response_format: "verbose_json" }, upstream);
    expect(await plain.response.json()).toEqual({
      task: "transcribe", text: "plain", segments: [{ id: 0, start: 1, end: 2, text: "no speaker" }],
    });
    expect(plain.nativeUnits).toEqual({});
    const diarized = await run({ response_format: "verbose_json", diarize: "true" }, upstream);
    expect((await diarized.response.json()).speakers).toEqual([]);
  });
});

describe("Deepgram ignored parameters", () => {
  it("ignores fields that do not change the response, and logs their names only", async () => {
    const log = { warn: vi.fn() };
    const fields = { temperature: "0", prompt: "secret prompt", stream: "false", chunking_strategy: "auto", "include[]": "logprobs", custom: "x" };
    const result = await run(fields, FIXTURE, log);
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "Hello there. Hi, how are you?" });
    expect(Object.keys(sentQuery()).sort()).toEqual(["detect_language", "model", "punctuate", "smart_format"]);
    const logged = log.warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain('["temperature","prompt","chunking_strategy","include[]","custom"]');
    expect(logged).not.toContain("secret prompt");
  });
});

describe("Deepgram unsupported parameters", () => {
  it.each([
    ["stream=true", { stream: "true" }, /does not support stream=true/],
    ["srt", { response_format: "srt" }, /response_format must be json, text or verbose_json/],
    ["vtt", { response_format: "vtt" }, /response_format must be json, text or verbose_json/],
    ["diarize value", { diarize: "yes", response_format: "verbose_json" }, /diarize must be true or false/],
    ["diarize_model value", { diarize_model: "whisper", response_format: "verbose_json" }, /diarize_model must be latest, v1 or v2/],
    ["both diarize fields", { diarize: "true", diarize_model: "v1", response_format: "verbose_json" }, /not both/],
    ["diarize with json", { diarize: "true" }, /only returned with response_format=verbose_json/],
    ["diarize_model with text", { diarize_model: "latest", response_format: "text" }, /only returned with response_format=verbose_json/],
    ["granularity value", { "timestamp_granularities[]": "sentence", response_format: "verbose_json" }, /must be segment or word/],
    ["granularity with json", { "timestamp_granularities[]": "word" }, /requires response_format=verbose_json/],
  ])("rejects %s with 400 before calling Deepgram", async (_name, fields, message) => {
    const result = await run(fields);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.error).toMatch(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats empty fields and diarize=false as absent", async () => {
    const result = await run({ temperature: "", diarize: "false" });
    expect(result.success).toBe(true);
    expect(sentQuery()).not.toHaveProperty("diarize");
  });
});
