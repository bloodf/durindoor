// Deepgram pre-recorded transcription: client option parsing and the
// OpenAI-style verbose_json mapping. Field names follow
// https://developers.deepgram.com/docs/diarization and /docs/utterances.
// Provider responses are untrusted. Timing, speakers and duration appear only
// when Deepgram returned them; nothing is estimated or defaulted to 0.

import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

// Fields that shape the response are validated. Anything else (temperature,
// prompt, chunking_strategy, include[], unknown fields) cannot change the shape,
// so it is ignored and logged by name, keeping Deepgram usable as a fallback for
// clients written against OpenAI.
const HANDLED_FIELDS = new Set([
  "file", "model", "language", "response_format", "stream", "diarize", "diarize_model",
  "timestamp_granularities", "timestamp_granularities[]",
]);
const RESPONSE_FORMATS = new Set(["json", "text", "verbose_json"]);
const DIARIZE_MODELS = new Set(["latest", "v1", "v2"]);
const GRANULARITIES = new Set(["segment", "word"]);

const present = (value) => value !== null && value !== "";
const fail = (error) => ({ error });

/**
 * Validate client fields before any audio is sent.
 * @returns {{error: string} | {responseFormat: string, query: Record<string, string>, ignored: string[], diarized: boolean, segments: boolean, words: boolean}}
 */
export function parseDeepgramOptions(formData) {
  const ignored = [...new Set([...formData.entries()]
    .filter(([key, value]) => !HANDLED_FIELDS.has(key) && present(value))
    .map(([key]) => key))];
  if (["true", "1"].includes(String(formData.get("stream") ?? "").trim().toLowerCase())) {
    return fail("Deepgram transcription does not support stream=true");
  }

  const format = formData.get("response_format");
  const responseFormat = present(format) ? String(format).trim() : "json";
  if (!RESPONSE_FORMATS.has(responseFormat)) {
    return fail("Deepgram transcription response_format must be json, text or verbose_json");
  }
  const verbose = responseFormat === "verbose_json";

  const diarizeField = formData.get("diarize");
  const modelField = formData.get("diarize_model");
  if (present(diarizeField) && present(modelField)) return fail("Set diarize or diarize_model, not both");
  const diarizeValue = present(diarizeField) ? String(diarizeField).trim().toLowerCase() : "false";
  if (diarizeValue !== "true" && diarizeValue !== "false") return fail("diarize must be true or false");
  const diarizeModel = present(modelField) ? String(modelField).trim() : null;
  if (diarizeModel !== null && !DIARIZE_MODELS.has(diarizeModel)) return fail("diarize_model must be latest, v1 or v2");
  const diarized = diarizeValue === "true" || diarizeModel !== null;
  if (diarized && !verbose) return fail("Speaker labels are only returned with response_format=verbose_json");

  const granularities = [...formData.getAll("timestamp_granularities"), ...formData.getAll("timestamp_granularities[]")]
    .filter(present).map(String);
  if (granularities.some((value) => !GRANULARITIES.has(value))) return fail("timestamp_granularities must be segment or word");
  if (granularities.length && !verbose) return fail("timestamp_granularities requires response_format=verbose_json");

  const words = granularities.includes("word");
  const segments = verbose && (!granularities.length || granularities.includes("segment"));
  const query = {};
  if (diarizeModel !== null) query.diarize_model = diarizeModel;
  else if (diarized) query.diarize = "true";
  if (segments) query.utterances = "true";
  return { responseFormat, query, ignored, diarized, segments, words };
}

const isTime = (value) => Number.isFinite(value) && value >= 0;
const hasTiming = (entry) => isTime(entry.start) && isTime(entry.end) && entry.start <= entry.end;
const speakerOf = (entry) => Number.isInteger(entry.speaker) && entry.speaker >= 0 ? { speaker: entry.speaker } : null;
const list = (value) => Array.isArray(value) ? value.filter((entry) => entry && isObject(entry)) : [];

function mapSegments(utterances) {
  return list(utterances)
    .filter((u) => hasTiming(u) && isString(u.transcript))
    .map((u, id) => ({ id, start: u.start, end: u.end, text: u.transcript, ...speakerOf(u) }));
}

function mapWords(words) {
  return list(words)
    .filter((w) => hasTiming(w) && isString(w.word))
    .map((w) => ({ word: w.word, start: w.start, end: w.end, ...speakerOf(w) }));
}

/** Map a Deepgram response to OpenAI-style verbose_json plus speaker labels. */
export function deepgramToVerboseJson(data, text, options, duration) {
  const channel = data?.results?.channels?.[0];
  const language = isString(channel?.detected_language) ? channel.detected_language : null;
  const segments = options.segments ? mapSegments(data?.results?.utterances) : null;
  const words = options.words ? mapWords(channel?.alternatives?.[0]?.words) : null;
  const speakers = [...new Set([...(segments ?? []), ...(words ?? [])].map((e) => e.speaker).filter((s) => s !== undefined))]
    .sort((a, b) => a - b);
  return {
    task: "transcribe",
    ...(language ? { language } : null),
    ...(duration === undefined ? null : { duration }),
    text,
    ...(segments ? { segments } : null),
    ...(words ? { words } : null),
    ...(options.diarized ? { speakers } : null),
  };
}
