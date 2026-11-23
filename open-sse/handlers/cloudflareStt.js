// Cloudflare Workers AI speech-to-text (Deepgram Nova-3). Workers AI answers in
// Deepgram's shape wrapped in the usual Cloudflare envelope
// ({ success, errors, result }), and it does not return utterances, so speaker
// segments are derived from runs of words that share a speaker label.
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const finite = (value) => isNumber(value) && Number.isFinite(value);

/** Group consecutive words with the same speaker into Deepgram-style utterances. */
export function wordsToUtterances(words) {
  const utterances = [];
  for (const entry of Array.isArray(words) ? words : []) {
    if (!isObject(entry) || !finite(entry.start) || !finite(entry.end)) continue;
    const text = isString(entry.punctuated_word) && entry.punctuated_word ?
    entry.punctuated_word :
    isString(entry.word) ? entry.word : "";
    if (!text) continue;
    const speaker = Number.isInteger(entry.speaker) ? entry.speaker : undefined;
    const last = utterances[utterances.length - 1];
    if (last && last.speaker === speaker) {
      last.end = entry.end;
      last.transcript += ` ${text}`;
    } else {
      utterances.push({ start: entry.start, end: entry.end, transcript: text, ...(speaker === undefined ? null : { speaker }) });
    }
  }
  return utterances;
}

/** First Cloudflare error as a one-line message, or null when the envelope reports success. */
export function cloudflareEnvelopeError(data) {
  if (!isObject(data) || data.success !== false) return null;
  const first = Array.isArray(data.errors) && isObject(data.errors[0]) ? data.errors[0] : null;
  const message = isString(first?.message) && first.message ? first.message : "unknown error";
  return `Cloudflare: ${message}${finite(first?.code) ? ` (code ${first.code})` : ""}`;
}

/**
 * Re-shape the Workers AI result as a Deepgram response, so the shared
 * deepgramToVerboseJson mapping (words, segments, speakers) applies unchanged.
 */
export function cloudflareResultToDeepgram(result) {
  const channels = Array.isArray(result?.results?.channels) ? result.results.channels : [];
  const words = channels[0]?.alternatives?.[0]?.words;
  return { results: { channels, utterances: wordsToUtterances(words) } };
}
