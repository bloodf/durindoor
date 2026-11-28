// Fish Audio voice-model discovery: GET https://api.fish.audio/model with the
// selected connection's Bearer key. Staged and not registered.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// src/app/api/v1/_shared/fishAudioProxy.ts proxyFishAudioRequest (fixed base
// https://api.fish.audio, `Authorization: Bearer <apiKey || accessToken>`, the
// caller's query string forwarded) and
// src/app/api/v1/providers/[provider]/voices/route.ts GET (path `/model`).
//
// Fork deviations: the source streams Fish's answer back unchanged and forwards
// any query string. Here only Fish's documented listing parameters are
// accepted and validated, the answer is read to a bounded size, and each voice
// is reduced to plain fields (id, name, type, languages, tags, visibility,
// state); ids that fail the source's safe voice-id pattern are dropped, and no
// upstream URL (cover image, samples) is passed on. Discovery is not billable,
// so a failure carries no acceptedJob. The source's POST (clone creation from
// multipart audio) is not staged; see ../../../../internal/docs/port-reports/native-fishaudio-tts.md.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult } from "../../../utils/error.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FISH_AUDIO_MAX_VOICES_BYTES, FISH_AUDIO_VOICES_TIMEOUT_MS, FISH_AUDIO_VOICES_URL } from "./config.js";
import { discard, fishAudioToken, invalid, sendOnce } from "./http.js";
import { isSafeFishAudioId } from "./tts.js";

const LABEL = "voice listing";
const MODALITY = "tts";
const MAX_VOICES = 200;
const MAX_TEXT = 200;
const MAX_LIST = 32;
const SORT_BY = Object.freeze(["score", "task_count", "created_at"]);
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

/** Fish listing parameters this adapter forwards, with their validators. */
export const FISH_AUDIO_VOICE_QUERY_KEYS = Object.freeze([
  "page_size", "page_number", "title", "tag", "self", "author_id", "language", "title_language", "sort_by",
]);

const integerIn = (name, min, max) => (value) => {
  if (!isNumber(value) || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return String(value);
};
const text = (name) => (value) => {
  if (!isString(value) || !value.trim() || value.length > MAX_TEXT || /[\u0000-\u001f]/.test(value)) throw new Error(`${name} must be a short string`);
  return value.trim();
};
const list = (name, check) => (value) => {
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0 || items.length > MAX_LIST) throw new Error(`${name} must have 1-${MAX_LIST} values`);
  return items.map((item) => check(item));
};
const language = (name) => (value) => {
  if (!isString(value) || !LANGUAGE.test(value)) throw new Error(`${name} must be a language code`);
  return value;
};

const VALIDATORS = {
  page_size: integerIn("page_size", 1, 100),
  page_number: integerIn("page_number", 1, 10_000),
  title: text("title"),
  tag: list("tag", text("tag")),
  self: (value) => {
    if (!isBoolean(value)) throw new Error("self must be a boolean");
    return String(value);
  },
  author_id: (value) => {
    if (!isSafeFishAudioId(value)) throw new Error("author_id must be a Fish id");
    return value;
  },
  language: list("language", language("language")),
  title_language: list("title_language", language("title_language")),
  sort_by: (value) => {
    if (!SORT_BY.includes(value)) throw new Error(`sort_by must be one of: ${SORT_BY.join(", ")}`);
    return value;
  },
};

/** The fixed listing URL with validated parameters. Throws on anything else. */
export function buildFishAudioVoicesUrl(query = {}) {
  if (query !== null && !isRecord(query)) throw new Error("voice query must be an object");
  const url = new URL(FISH_AUDIO_VOICES_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    const validate = VALIDATORS[key];
    if (!validate) throw new Error(`Unsupported Fish Audio voice query parameter: ${key}`);
    const out = validate(value);
    for (const item of Array.isArray(out) ? out : [out]) url.searchParams.append(key, item);
  }
  return url;
}

const plain = (value) => (isString(value) ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_TEXT) : null);
const plainList = (value) => (Array.isArray(value) ? value.map(plain).filter(Boolean).slice(0, MAX_LIST) : []);

/** Reduce Fish's `{ total, items }` to plain voice rows. Returns null for a malformed answer. */
export function normalizeFishAudioVoices(data) {
  if (!isRecord(data) || !Array.isArray(data.items)) return null;
  const voices = [];
  let dropped = 0;
  for (const item of data.items.slice(0, MAX_VOICES)) {
    const id = isRecord(item) ? item._id ?? item.id : null;
    if (!isSafeFishAudioId(id)) {
      dropped += 1;
      continue;
    }
    voices.push({
      id,
      name: plain(item.title) ?? id,
      type: plain(item.type),
      languages: plainList(item.languages),
      tags: plainList(item.tags),
      visibility: plain(item.visibility),
      state: plain(item.state),
    });
  }
  dropped += Math.max(0, data.items.length - MAX_VOICES);
  const total = isNumber(data.total) && Number.isInteger(data.total) && data.total >= 0 ? data.total : null;
  return { total, voices, dropped };
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxBytes] - answer cap
 */
export function createFishAudioVoiceLister({ fetchImpl, timeoutMs = FISH_AUDIO_VOICES_TIMEOUT_MS, maxBytes = FISH_AUDIO_MAX_VOICES_BYTES } = {}) {
  /**
   * List the voice models visible to the selected connection.
   * @returns {Promise<{ success: true, total: number|null, voices: object[], dropped: number } | object>}
   */
  return async function listFishAudioVoices(credentials, query = {}, { signal } = {}) {
    let url;
    try {
      url = buildFishAudioVoicesUrl(query);
    } catch (error) {
      return invalid(error.message);
    }
    const token = fishAudioToken(credentials);
    if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Fish Audio API key on this connection");
    const sent = await sendOnce(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl, billable: false });
    if (sent.failure) return sent.failure;
    const { response, fetchSignal } = sent;
    try {
      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (type && !/json/.test(type)) {
        discard(response);
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Fish Audio voice listing answered without JSON");
      }
      let raw;
      try {
        raw = await readBounded(response.body, maxBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
      } catch {
        if (signal?.aborted) return { ...createErrorResult(499, "Fish Audio voice listing aborted"), local: true };
        if (sent.timedOut()) return createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "Fish Audio voice listing timed out");
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Fish Audio voice listing was unreadable or too large");
      }
      let data = null;
      try {
        data = JSON.parse(raw.toString("utf8"));
      } catch {
        // The parser's message quotes the body, so it is dropped.
      }
      const normalized = normalizeFishAudioVoices(data);
      if (!normalized) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Fish Audio voice listing was malformed");
      return { success: true, ...normalized };
    } finally {
      sent.clear();
    }
  };
}
