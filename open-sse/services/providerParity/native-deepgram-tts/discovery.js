// Deepgram speech model discovery: one bounded GET of
// https://api.deepgram.com/v1/models with `Authorization: Token <key>`.
//
// The pinned OmniRoute source (c71f0065, open-sse/config/audioRegistry.ts)
// lists the three Deepgram speech models statically and has no discovery.
// DurinDoor's dashboard route src/app/api/media-providers/tts/deepgram/voices/route.js
// already reads this endpoint (unbounded, follows redirects, quotes the
// upstream text). This is the bounded equivalent with the same grouping, for
// that route to adopt at registration. Discovery is free: no acceptedJob.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult } from "../../../utils/error.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { DEEPGRAM_DISCOVERY_TIMEOUT_MS, DEEPGRAM_MAX_DISCOVERY_BYTES, DEEPGRAM_MODELS_URL, isDeepgramTtsModel } from "./config.js";
import { deepgramToken, sendOnce } from "./http.js";

const LABEL = "model discovery";
const MAX_NAME = 80;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const cleanName = (value, fallback) => (isString(value) && value.trim() && !/[\u0000-\u001f<>]/.test(value) ? value.trim().slice(0, MAX_NAME) : fallback);

/** Speech models from a /v1/models answer: only well-formed Aura ids, deduplicated. */
export function parseDeepgramTtsModels(payload) {
  const rows = isRecord(payload) && Array.isArray(payload.tts) ? payload.tts : [];
  const seen = new Set();
  const models = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = row.canonical_name;
    if (!isDeepgramTtsModel(id) || seen.has(id)) continue;
    seen.add(id);
    const languages = (Array.isArray(row.languages) ? row.languages : []).filter((code) => isString(code) && LANGUAGE.test(code));
    const tags = Array.isArray(row.metadata?.tags) ? row.metadata.tags : [];
    models.push({
      id,
      name: cleanName(row.name, id),
      kind: "tts",
      languages: languages.length ? languages : [id.slice(-2)],
      gender: tags.find((tag) => tag === "masculine" || tag === "feminine") ?? "",
    });
  }
  return models;
}

/** The dashboard voices route shape: `{ languages, byLang }`, one voice per model. */
export function groupDeepgramVoices(models) {
  const byLang = {};
  for (const model of models) {
    for (const code of model.languages) {
      byLang[code] ??= { code, name: code, voices: [] };
      byLang[code].voices.push({ id: model.id, name: model.name, gender: model.gender, lang: code });
    }
  }
  const languages = Object.values(byLang).sort((a, b) => a.code.localeCompare(b.code));
  return { languages, byLang };
}

/**
 * @param {object} credentials - the selected connection
 * @param {object} [options] - { fetchImpl, signal, timeoutMs, maxBytes }
 * @returns {Promise<{ models } | error result>}
 */
export async function listDeepgramTtsModels(credentials, { fetchImpl, signal, timeoutMs = DEEPGRAM_DISCOVERY_TIMEOUT_MS, maxBytes = DEEPGRAM_MAX_DISCOVERY_BYTES } = {}) {
  const token = deepgramToken(credentials);
  if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Deepgram API key on this connection");
  const sent = await sendOnce(DEEPGRAM_MODELS_URL, { method: "GET", headers: { Authorization: `Token ${token}` } },
    { modality: "tts", label: LABEL, credentials, signal, timeoutMs, fetchImpl, billable: false });
  if (sent.failure) return sent.failure;
  try {
    let payload;
    try {
      const bytes = await readBounded(sent.response.body, maxBytes, sent.fetchSignal, HTTP_STATUS.BAD_GATEWAY);
      payload = JSON.parse(bytes.toString("utf8"));
    } catch {
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Deepgram ${LABEL} answer was unreadable, too large or not JSON`);
    }
    if (!isRecord(payload) || !Array.isArray(payload.tts)) {
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Deepgram ${LABEL} answer has no tts list`);
    }
    return { models: parseDeepgramTtsModels(payload) };
  } finally {
    sent.clear();
  }
}
