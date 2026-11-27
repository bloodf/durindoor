// Model resolution and the request fields every upscale adapter shares.
//
// Source (OmniRoute c71f0065 config/upscaleRegistry.ts parseUpscaleModel via
// registryUtils parseModelFromRegistry; handlers/imageUpscale.ts): a
// `provider/model` (or `alias/model`) prefix wins, else a bare model id is
// looked up across the registry; unknown provider or model is a 400. Each
// handler reads its own fields (factor aliases, creativity aliases, prompt,
// output_format, response_format) and drops what it does not use.
//
// Fork deviations: nothing the caller sends is dropped. A field the selected
// model does not use, a factor the model does not offer (the source snapped
// 3x to 4x), conflicting factor/creativity aliases, n other than 1,
// streaming, an unknown response_format (the source fell back to url) and an
// unknown output_format (the source fell back to png) are refused before any
// network call. A bare model id that two providers share is ambiguous and
// refused. The source's Adobe Firefly rows resolve to the precise unavailable
// disposition in ./adobeFirefly.js.
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  ADOBE_FIREFLY_SERVICES_ID, ADOBE_FIREFLY_SOURCE_ALIAS, ADOBE_FIREFLY_SOURCE_ID, ADOBE_FIREFLY_SOURCE_MODELS,
  CREATIVITY_FIELDS, FACTOR_FIELDS, MAX_PROMPT_CHARS, MAX_TIMEOUT_OVERRIDE_MS, OUTPUT_FORMATS, RESPONSE_FORMATS,
  SOURCE_IMAGE_FIELDS, UPSCALE_PROVIDERS,
} from "./config.js";
import { reject } from "./media.js";

const SAFE_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const FACTOR_RE = /^\s*[xX]?\s*(\d+(?:\.\d+)?)\s*[xX]?\s*$/;

export const present = (value) => value !== undefined && value !== null && !(isString(value) && value.trim() === "");

/** Fields every adapter accepts: the source image aliases and the envelope. */
export const COMMON_FIELDS = Object.freeze(["model", "response_format", "n", "stream", "user", "provider_options", "messages", ...SOURCE_IMAGE_FIELDS]);

/**
 * `{ provider, model, entry }` for an active row, `{ unavailable }` for the
 * source's Adobe Firefly rows, or throws 400.
 */
export function resolveUpscaleModel(raw) {
  if (!isString(raw) || !raw.trim()) throw reject("Invalid upscale model: (missing). Use format: provider/model (e.g. topaz/topaz-enhance).");
  const text = raw.trim();
  if (!SAFE_MODEL_RE.test(text) || text.includes("..") || text.includes("//")) throw reject("Invalid upscale model id");
  for (const prefix of [ADOBE_FIREFLY_SOURCE_ID, ADOBE_FIREFLY_SOURCE_ALIAS, ADOBE_FIREFLY_SERVICES_ID]) {
    if (text.startsWith(`${prefix}/`)) return { unavailable: prefix === ADOBE_FIREFLY_SERVICES_ID ? "services" : "consumer", provider: prefix, model: text.slice(prefix.length + 1) };
  }
  for (const config of Object.values(UPSCALE_PROVIDERS)) {
    for (const prefix of [config.id, ...config.aliases]) {
      if (!text.startsWith(`${prefix}/`)) continue;
      const model = text.slice(prefix.length + 1);
      const entry = config.models.find((row) => row.id === model);
      if (!entry) {
        throw reject(`Unsupported upscale model for ${config.id}: ${model}. Available: ${config.models.map((row) => row.id).join(", ")}.`);
      }
      return { provider: config.id, model, entry, config };
    }
  }
  const matches = [];
  for (const config of Object.values(UPSCALE_PROVIDERS)) {
    const entry = config.models.find((row) => row.id === text);
    if (entry) matches.push({ provider: config.id, model: text, entry, config });
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw reject(`Ambiguous upscale model ${text}; prefix it with its provider`);
  if (ADOBE_FIREFLY_SOURCE_MODELS.includes(text)) return { unavailable: "consumer", provider: ADOBE_FIREFLY_SOURCE_ID, model: text };
  throw reject(`Invalid upscale model: ${text}. Use format: provider/model (e.g. topaz/topaz-enhance).`);
}

/** Refuse any present field outside `allowed`, and any non-image provider option. */
export function assertKnownFields(body, allowed, label) {
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (!allowed.has(key)) throw reject(`${label} does not support ${key}`);
  }
  if (present(body.provider_options)) {
    if (!isRecord(body.provider_options)) throw reject("provider_options must be an object");
    for (const [key, value] of Object.entries(body.provider_options)) {
      if (value !== undefined && value !== null && !SOURCE_IMAGE_FIELDS.includes(key)) throw reject(`${label} does not support provider_options.${key}`);
    }
  }
}

/** The envelope fields: n, stream and response_format (url | b64_json, default url). */
export function parseEnvelope(body, label) {
  if (present(body.stream) && body.stream !== false) throw reject(`${label} does not support streaming`);
  if (present(body.n) && body.n !== 1) throw reject(`${label} returns one image (n = 1 only)`);
  if (present(body.user) && !isString(body.user)) throw reject("user must be a string");
  const responseFormat = present(body.response_format) ? body.response_format : "url";
  if (!RESPONSE_FORMATS.includes(responseFormat)) throw reject(`${label} supports response_format ${RESPONSE_FORMATS.join(", ")} only`);
  return responseFormat;
}

/** The single present value among `fields`; differing values are refused. */
export function readAliased(body, fields, label) {
  let found;
  let foundField;
  for (const field of fields) {
    if (!present(body[field])) continue;
    if (foundField !== undefined && String(body[field]).trim() !== String(found).trim()) {
      throw reject(`${label}: ${foundField} and ${field} disagree`);
    }
    if (foundField === undefined) {
      found = body[field];
      foundField = field;
    }
  }
  return foundField === undefined ? undefined : { value: found, field: foundField };
}

/**
 * The requested factor as one of the model's factors, or null when none was
 * sent. Accepts 2, "2", "2x", "x2", "4X"; anything else is refused.
 */
export function parseFactor(body, entry, { fields = FACTOR_FIELDS, numberOnly = false, label }) {
  const found = readAliased(body, fields, label);
  if (!found) return null;
  let n = NaN;
  if (isNumber(found.value)) n = found.value;
  else if (!numberOnly && isString(found.value)) {
    const match = FACTOR_RE.exec(found.value);
    if (match) n = Number(match[1]);
  }
  if (!Number.isFinite(n) || !entry.factors.includes(n)) {
    throw reject(`${label} supports ${found.field} ${entry.factors.join(" or ")}${numberOnly ? " (a number)" : ""}`);
  }
  return n;
}

/** Trimmed prompt or undefined; refuses non-strings and oversize prompts. */
export function parsePrompt(body, field = "prompt") {
  if (!present(body[field])) return undefined;
  if (!isString(body[field])) throw reject(`${field} must be a string`);
  const prompt = body[field].trim();
  if (prompt.length > MAX_PROMPT_CHARS) throw reject(`${field} must not exceed ${MAX_PROMPT_CHARS} characters`);
  return prompt;
}

/** "png" (default) | "jpeg" | "webp" from output_format / format; "jpg" is jpeg. */
export function parseOutputFormat(body, label) {
  const found = readAliased(body, ["output_format", "format"], label);
  if (!found) return "png";
  const raw = isString(found.value) ? found.value.trim().toLowerCase() : "";
  const format = raw === "jpg" ? "jpeg" : raw;
  if (!OUTPUT_FORMATS.includes(format)) throw reject(`${label} supports output_format ${OUTPUT_FORMATS.join(", ")} only`);
  return format;
}

/** A finite number from a number or numeric string (optional trailing %), else null. */
export function numeric(value) {
  if (isNumber(value)) return Number.isFinite(value) ? value : null;
  if (!isString(value) || !value.trim()) return null;
  const n = Number(value.replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

/** The creativity value as sent (number or string), via the source aliases. */
export function readCreativity(body, label, fields = CREATIVITY_FIELDS) {
  return readAliased(body, fields, label);
}

/** A positive integer timeout_ms override within the gateway bound, or null. */
export function parseTimeoutOverride(body, label) {
  if (!present(body.timeout_ms)) return null;
  const n = numeric(body.timeout_ms);
  if (n === null || !Number.isInteger(n) || n <= 0 || n > MAX_TIMEOUT_OVERRIDE_MS) {
    throw reject(`${label} timeout_ms must be a positive integer up to ${MAX_TIMEOUT_OVERRIDE_MS}`);
  }
  return n;
}
