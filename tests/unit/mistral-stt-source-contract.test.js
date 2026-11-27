// Mistral transcription vendor contract (#2034): fixtures shaped from the
// primary vendor sources, checked against the staged, unregistered adapter.
// Closed mocks only: synthetic keys, an injected transport, no live calls.
//
// Sources, read 2026-11-27 with public GETs:
// - https://docs.mistral.ai/openapi.yaml
//   sha256 acf0efcbee4617601df77fc40185516ed6aae4369ce090034099317d5866b2db
//   operationId audio_api_v1_transcriptions_post (POST /v1/audio/transcriptions),
//   request schema AudioTranscriptionRequest (multipart/form-data), 200 schema
//   TranscriptionResponse with the `userExample` example. It documents no
//   error response for the operation.
// - mistralai/client-python 6e9e31ac6f982c1fdfe177787ded223f458c9f69:
//   src/mistralai/client/models/audiotranscriptionrequest.py,
//   src/mistralai/client/utils/forms.py (serialize_multipart_form sends a list
//   field as one repeated form name, no `[]`),
//   src/mistralai/client/transcriptions.py (4XX and 5XX are both SDKError).
// - https://docs.mistral.ai/getting-started/models/models_overview/
//   sha256 1f764d4e7755a688d06dc5f1a9e01a1b27af807977884f83e5c1b634fd9e3807
//   modelIds: Transcribe 2 [voxtral-mini-2602, voxtral-mini-latest];
//   Transcribe 3 [voxtral-mini-transcribe-3-0, voxtral-mini-transcribe-3,
//   voxtral-mini-transcribe-latest].
//
// The pinned OmniRoute c71f0065 port is compared in native-mistral-stt.test.js;
// where it differs from these sources, these sources win.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  MISTRAL_GRANULARITY_WIRE_FIELD,
  MISTRAL_STT_MODELS,
  createMistralSttAdapter,
  mistralSttRefusal,
} from "../../open-sse/services/providerParity/native-mistral-stt/index.js";
import { isFunction, isString } from "../../src/shared/utils/typeChecks.js";

const TRANSCRIPTION_URL = "https://api.mistral.ai/v1/audio/transcriptions";
const KEY_A = "SYNTHETIC-mistral-contract-key-a-0001";
const KEY_B = "SYNTHETIC-mistral-contract-key-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(32, 1)]);
const MODEL = "voxtral-mini-transcribe-3";
const REGISTRATION = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-mistral-stt/registration.json", import.meta.url), "utf8"));

/** AudioTranscriptionRequest properties (openapi.yaml). Anything else is not part of the contract. */
const VENDOR_REQUEST_FIELDS = Object.freeze([
  "model", "file", "file_url", "file_id", "language", "temperature", "stream",
  "diarize", "context_bias", "speaker_references", "timestamp_granularities",
]);
/** TimestampGranularity enum (openapi.yaml). */
const VENDOR_GRANULARITIES = Object.freeze(["segment", "word"]);
/** modelIds on the models overview page. */
const VENDOR_TRANSCRIBE_MODEL_IDS = Object.freeze([
  "voxtral-mini-2602", "voxtral-mini-latest",
  "voxtral-mini-transcribe-3-0", "voxtral-mini-transcribe-3", "voxtral-mini-transcribe-latest",
]);

/**
 * TranscriptionResponse shaped like the operation's `userExample`, with one
 * TranscriptionSegmentChunk and the optional UsageInfo fields filled in.
 */
const DOCS_RESPONSE = Object.freeze({
  model: "voxtral-mini-2507",
  text: "This week, I traveled to Chicago to deliver my final farewell address to the nation.",
  language: "en",
  segments: [{ type: "transcription_segment", text: "This week,", start: 0, end: 0.8, score: null, speaker_id: null }],
  usage: {
    prompt_audio_seconds: 203, prompt_tokens: 4, total_tokens: 3264, completion_tokens: 635,
    prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 }, service_tier: "standard",
  },
});

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

function transport(...steps) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    const value = isFunction(step) ? await step(url, init) : step;
    if (value instanceof Error) throw value;
    return value;
  });
  return { fetchImpl, calls };
}

function form(entries, file = new File([WAV], "clip.wav", { type: "audio/wav" })) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
}

/** The request body as it goes on the wire, and its Content-Type. */
async function wire(call) {
  const encoded = new Response(call.init.body);
  return { contentType: encoded.headers.get("content-type"), raw: await encoded.text() };
}

const partNames = (raw) => [...raw.matchAll(/Content-Disposition: form-data; name="([^"]*)"/g)].map((m) => m[1]);

const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  for (const secret of [KEY_A, KEY_B, "upstream echo", "/srv/app"]) expect(text).not.toContain(secret);
};

const run = (adapter, extra = {}) => adapter.transcribe({ model: MODEL, formData: form([]), credentials: CRED_A, ...extra });

describe("Mistral transcription vendor request contract", () => {
  it("records the vendor sources in registration.json", () => {
    expect(REGISTRATION.vendorContract.openapi).toMatchObject({
      url: "https://docs.mistral.ai/openapi.yaml",
      sha256: "acf0efcbee4617601df77fc40185516ed6aae4369ce090034099317d5866b2db",
      operationId: "audio_api_v1_transcriptions_post",
    });
    expect(REGISTRATION.vendorContract.sdk.commit).toBe("6e9e31ac6f982c1fdfe177787ded223f458c9f69");
    expect(REGISTRATION.vendorContract.retrieved).toBe("2026-11-27");
  });

  it("stages only transcription model ids the vendor models page lists", () => {
    for (const model of MISTRAL_STT_MODELS) expect(VENDOR_TRANSCRIBE_MODEL_IDS).toContain(model.id);
  });

  it("sends a docs-shaped multipart body with only declared fields and the repeated granularity name", async () => {
    const { fetchImpl, calls } = transport(json(DOCS_RESPONSE));
    const fd = form([
      ["language", "en"],
      ["temperature", "0"],
      ["response_format", "json"],
      ["timestamp_granularities[]", "segment"],
      ["timestamp_granularities", "word"],
    ]);
    const result = await createMistralSttAdapter({ fetchImpl }).transcribe({ model: MODEL, formData: fd, credentials: CRED_A });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TRANSCRIPTION_URL);
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });

    const { contentType, raw } = await wire(calls[0]);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    const names = partNames(raw);
    expect(names).toEqual(["model", "language", "temperature", "timestamp_granularities", "timestamp_granularities", "file"]);
    for (const name of names) expect(VENDOR_REQUEST_FIELDS).toContain(name);
    expect(MISTRAL_GRANULARITY_WIRE_FIELD).toBe("timestamp_granularities");
    expect(raw).not.toContain('name="timestamp_granularities[]"');
    expect(raw).not.toContain('name="response_format"');
    expect(raw).not.toContain('name="prompt"');
    expect(raw).not.toContain('name="stream"');
    expect(raw).toContain(`name="model"\r\n\r\n${MODEL}\r\n`);
    expect(raw).toContain('name="language"\r\n\r\nen\r\n');
    expect(raw).toContain('name="file"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n');
    const granularityValues = [...raw.matchAll(/name="timestamp_granularities"\r\n\r\n([^\r]*)\r\n/g)].map((m) => m[1]);
    expect(granularityValues).toEqual(["segment", "word"]);
    for (const value of granularityValues) expect(VENDOR_GRANULARITIES).toContain(value);
    expect(raw).not.toContain(KEY_A);
  });

  it.each([["eng"], ["en-US"], ["e"], ["e n"]])("refuses language %j, which fails the vendor ^\\w{2}$ pattern, before submit", async (language) => {
    const { fetchImpl } = transport();
    const result = await run(createMistralSttAdapter({ fetchImpl }), { formData: form([["language", language]]) });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([["0"], ["1"], ["0.35"]])("forwards temperature %j as given", async (temperature) => {
    const { fetchImpl, calls } = transport(json(DOCS_RESPONSE));
    await run(createMistralSttAdapter({ fetchImpl }), { formData: form([["temperature", temperature]]) });
    expect((await wire(calls[0])).raw).toContain(`name="temperature"\r\n\r\n${temperature}\r\n`);
  });
});

describe("Mistral transcription vendor response contract", () => {
  it("passes a docs-shaped TranscriptionResponse through unchanged and reads usage", async () => {
    const { fetchImpl } = transport(json(DOCS_RESPONSE));
    const result = await run(createMistralSttAdapter({ fetchImpl }));
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(await result.response.json()).toEqual(DOCS_RESPONSE);
    expect(result.usageValue).toEqual({ usage: DOCS_RESPONSE.usage });
    expect(result.nativeUnits).toEqual({ audioSeconds: 203 });
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown" });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("keeps the 200 path free of usage when the optional prompt_audio_seconds is null", async () => {
    const answer = { ...DOCS_RESPONSE, usage: { ...DOCS_RESPONSE.usage, prompt_audio_seconds: null } };
    const { fetchImpl } = transport(json(answer));
    const result = await run(createMistralSttAdapter({ fetchImpl }));
    expect(result.success).toBe(true);
    expect(result.nativeUnits).toEqual({});
  });
});

describe("Mistral transcription 503 accounting", () => {
  // The operation documents no error response at all, so there is no
  // documented structured body that proves a 503 was rejected before
  // processing. Every post-dispatch 503 is therefore an unknown outcome.
  const leaky503 = (body, headers = {}) => new Response(body, { status: 503, headers });
  const errorBody = (extra = {}) => JSON.stringify({ object: "error", message: `upstream echo ${KEY_A} at /srv/app/x.js:1`, type: "service_unavailable", ...extra });
  const shapes = [
    ["a Mistral-style JSON error with Retry-After", () => leaky503(errorBody(), { "content-type": "application/json", "retry-after": "7" })],
    ["a JSON body that claims nothing was processed", () => leaky503(errorBody({ message: "request not processed", code: "not_processed" }), { "content-type": "application/json", "retry-after": "7" })],
    ["an HTML gateway page", () => leaky503("<html>upstream echo 503</html>", { "content-type": "text/html", "retry-after": "7" })],
    ["an empty body", () => leaky503(null, { "retry-after": "7" })],
  ];

  it.each(shapes)("records %s once as an accepted job, keeps Retry-After and never replays", async (_label, make) => {
    const { fetchImpl, calls } = transport(make());
    const before = Date.now();
    const result = await run(createMistralSttAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 503 });
    expect(result.local).toBeUndefined();
    expect(result.acceptedJob).toMatchObject({
      modality: "stt", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" },
    });
    expect(result.response.headers.get("retry-after")).toBe("7");
    expect(result.resetsAtMs).toBeGreaterThanOrEqual(before + 6_000);
    expect(result.quotaExhausted).toBeUndefined();
    expectNoLeak(result);
  });

  it("drops an unusable Retry-After but still records the accepted job", () => {
    const result = mistralSttRefusal(503, { secrets: {}, retryAfter: "soon" });
    expect(result.status).toBe(503);
    expect(result.resetsAtMs).toBeUndefined();
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("keeps a 503 on the selected connection: the next connection's request is its own", async () => {
    const { fetchImpl, calls } = transport(leaky503(errorBody(), { "content-type": "application/json", "retry-after": "7" }), json(DOCS_RESPONSE));
    const adapter = createMistralSttAdapter({ fetchImpl });
    const onA = await run(adapter);
    const onB = await run(adapter, { credentials: CRED_B });
    expect(calls).toHaveLength(2);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(calls[1].init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
    expect(onA.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(onB.success).toBe(true);
    expect(onB.acceptedJob).toBeUndefined();
    expectNoLeak(onA);
  });

  it("cancels an oversized 503 body and still records the accepted job", async () => {
    let cancelled = false;
    const chunk = new TextEncoder().encode("x".repeat(8 * 1024));
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(chunk); },
      cancel() { cancelled = true; },
    });
    const { fetchImpl } = transport(new Response(body, { status: 503, headers: { "content-type": "application/json" } }));
    const result = await run(createMistralSttAdapter({ fetchImpl }));
    expect(cancelled).toBe(true);
    expect(result).toMatchObject({ success: false, status: 503 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("stops reading a stalled 503 body when the caller leaves and still records the accepted job", async () => {
    let cancelled = false;
    const controller = new AbortController();
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
    const { fetchImpl, calls } = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return new Response(body, { status: 503, headers: { "content-type": "application/json", "retry-after": "7" } });
    });
    const result = await run(createMistralSttAdapter({ fetchImpl }), { signal: controller.signal });
    expect(calls).toHaveLength(1);
    expect(cancelled).toBe(true);
    expect(result).toMatchObject({ success: false, status: 503 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("leaves no-replay 5xx accounting unchanged for other statuses and no accepted job on 4xx or 429", () => {
    for (const status of [500, 502, 504]) {
      const result = mistralSttRefusal(status, { secrets: {} });
      expect(result.status).toBe(502);
      expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    }
    for (const status of [400, 401, 403, 422, 429]) expect(mistralSttRefusal(status, { secrets: {} }).acceptedJob).toBeUndefined();
    expect(isString(mistralSttRefusal(503, { secrets: {} }).error)).toBe(true);
  });
});
