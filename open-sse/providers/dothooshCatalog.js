// DotHoosh (https://gateway.dothoosh.com) — an Iranian AI gateway that is
// OpenAI- and Anthropic-compatible and bills a prepaid wallet in Toman.
//
// The endpoints, the auth scheme per path and the two model listings are
// fixed by the provider's own documentation
// (https://gateway.dothoosh.com/docs, /docs/openai, /docs/anthropic and
// /docs/models):
//
//   POST /v1/chat/completions   Authorization: Bearer <key>
//   POST /v1/responses           Authorization: Bearer <key>
//   POST /anthropic/v1/messages  x-api-key: <key> + anthropic-version: 2023-06-01
//                                (the Anthropic path takes x-api-key only —
//                                 sending Authorization as well is rejected)
//   GET  /v1/models              dynamic listing: public without a key, the
//                                key's own models with one
//   GET  /anthropic/v1/models    the same listing for the Anthropic path
//
// Every URL below sits on the provider host, so a stored key never leaves it.
// No URL is built from request data.

import { FORMATS } from "../translator/formats.js";
import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";

export const DOTHOOSH_BASE_URL = "https://gateway.dothoosh.com";
export const DOTHOOSH_CHAT_COMPLETIONS_URL = `${DOTHOOSH_BASE_URL}/v1/chat/completions`;
export const DOTHOOSH_RESPONSES_URL = `${DOTHOOSH_BASE_URL}/v1/responses`;
export const DOTHOOSH_MESSAGES_URL = `${DOTHOOSH_BASE_URL}/anthropic/v1/messages`;
export const DOTHOOSH_OPENAI_MODELS_URL = `${DOTHOOSH_BASE_URL}/v1/models`;
export const DOTHOOSH_ANTHROPIC_MODELS_URL = `${DOTHOOSH_BASE_URL}/anthropic/v1/models`;
export const DOTHOOSH_ANTHROPIC_VERSION = "2023-06-01";

// The listing protocol names map onto the wire formats the gateway serves.
const PROTOCOL_LANES = {
  "openai-chat-completions": FORMATS.OPENAI,
  "openai-responses": FORMATS.OPENAI_RESPONSES,
  "anthropic-messages": FORMATS.CLAUDE,
};

// Stable lane order: Chat Completions, then Responses, then the Anthropic lane.
const LANE_ORDER = [FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE];

const isPositive = (value) =>
  (isNumber(value) && Number.isFinite(value) && value > 0 ? value : undefined);

/** First positive number of the given candidates. */
function firstPositive(...values) {
  for (const value of values) {
    const positive = isPositive(value);
    if (positive !== undefined) return positive;
  }
  return undefined;
}

/**
 * Headers for one listing. The OpenAI listing takes the bearer scheme; the
 * Anthropic listing lives under /anthropic/*, which accepts x-api-key only.
 * @param {"openai"|"anthropic"} listing
 * @param {string} [apiKey]
 */
export function dotHooshListingHeaders(listing, apiKey) {
  if (listing === "anthropic") {
    return {
      Accept: "application/json",
      "anthropic-version": DOTHOOSH_ANTHROPIC_VERSION,
      ...(apiKey ? { "x-api-key": apiKey } : null),
    };
  }
  return {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : null),
  };
}

/** Protocol names of a listing row ("protocols[]" entries may be objects). */
export function dotHooshProtocols(row) {
  const listed = Array.isArray(row?.protocols) ? row.protocols : [];
  return listed
    .map((item) => (isString(item) ? item : item?.protocol))
    .filter((protocol) => isString(protocol));
}

/**
 * Wire formats a model is served on. The listing's protocols[] is the
 * authority; a row on the Anthropic listing is served on the Anthropic lane,
 * and a row that names no protocol sits on the OpenAI listing, i.e. Chat
 * Completions.
 */
export function dotHooshLanes(openaiRow, anthropicRow) {
  const lanes = new Set();
  for (const protocol of dotHooshProtocols(openaiRow)) {
    const lane = PROTOCOL_LANES[protocol];
    if (lane) lanes.add(lane);
  }
  if (anthropicRow) lanes.add(FORMATS.CLAUDE);
  if (lanes.size === 0 && openaiRow) lanes.add(FORMATS.OPENAI);
  return LANE_ORDER.filter((lane) => lanes.has(lane));
}

function rowName(openaiRow, anthropicRow, id) {
  const label = (value) => (isString(value) && value.trim() ? value.trim() : undefined);
  return label(openaiRow?.name) || label(anthropicRow?.name) ||
    label(anthropicRow?.display_name) || id;
}

function rowVision(openaiRow, anthropicRow) {
  const modalities = openaiRow?.architecture?.input_modalities || anthropicRow?.architecture?.input_modalities;
  if (!Array.isArray(modalities)) return undefined;
  return modalities.includes("image");
}

/**
 * Merge the two listings into one catalog. A model listed on both paths keeps
 * the OpenAI row's metadata (it carries the richer limits) and the union of
 * the lanes it is served on; a model only on the Anthropic path is added from
 * that listing.
 *
 * @param {{ openai?: object[], anthropic?: object[] }} listings
 * @returns {object[]} catalog rows with id, name and the live limits
 */
export function mergeDotHooshListings({ openai = [], anthropic = [] } = {}) {
  const byId = new Map();
  const index = (rows) => {
    const map = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = isString(row?.id) ? row.id.trim() : "";
      if (!id) continue;
      map.set(id.toLowerCase(), row);
    }
    return map;
  };

  const openaiRows = index(openai);
  const anthropicRows = index(anthropic);
  for (const key of new Set([...openaiRows.keys(), ...anthropicRows.keys()])) {
    const openaiRow = openaiRows.get(key) || null;
    const anthropicRow = anthropicRows.get(key) || null;
    const id = String(openaiRow?.id || anthropicRow?.id).trim();
    const contextLength = firstPositive(
      openaiRow?.context_window,
      openaiRow?.context_length,
      openaiRow?.top_provider?.context_length,
      anthropicRow?.context_length,
      anthropicRow?.context_window,
      anthropicRow?.top_provider?.context_length
    );
    const maxOutput = firstPositive(
      openaiRow?.max_output_tokens,
      openaiRow?.top_provider?.max_completion_tokens,
      anthropicRow?.max_output_tokens,
      anthropicRow?.top_provider?.max_completion_tokens
    );
    const protocols = [...new Set([
      ...dotHooshProtocols(openaiRow),
      ...dotHooshProtocols(anthropicRow)
    ])];
    const vision = rowVision(openaiRow, anthropicRow);

    byId.set(key, {
      id,
      name: rowName(openaiRow, anthropicRow, id),
      ...(contextLength !== undefined ? { contextLength } : null),
      ...(maxOutput !== undefined ? { maxOutput } : null),
      ...(vision !== undefined ? { vision } : null),
      ...(protocols.length > 0 ? { protocols } : null),
      supportedFormats: dotHooshLanes(openaiRow, anthropicRow)
    });
  }
  return [...byId.values()];
}

// DotHoosh serves every model on one key, but not every model on every lane:
// Claude only on /anthropic/v1/messages, GPT also on /v1/responses, DeepSeek
// also on the Anthropic lane, everything else on Chat Completions. The
// listing's protocols[] is the authority (mergeDotHooshListings), but the
// registry carries no static model list, so dispatch needs a name-based
// fallback for ids the listing does not carry yet. First match wins; an id no
// family claims stays on Chat Completions, the lane every listed model serves.
const DOTHOOSH_FAMILIES = [
  { match: /^claude-/i, supportedFormats: [FORMATS.CLAUDE], targetFormat: FORMATS.CLAUDE },
  { match: /^gpt-/i, supportedFormats: [FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES] },
  { match: /^deepseek-/i, supportedFormats: [FORMATS.OPENAI, FORMATS.CLAUDE] },
];

/**
 * Wire formats a model id is served on, by model family.
 * @param {string} modelId
 * @returns {{ supportedFormats: string[], targetFormat?: string }|null}
 */
export function dothooshFamilyFormats(modelId) {
  if (!isString(modelId) || !modelId) return null;
  const base = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  return DOTHOOSH_FAMILIES.find((family) => family.match.test(base)) ||
    { supportedFormats: [FORMATS.OPENAI] };
}
