// CLOVA Studio embeddings request validation and per-call body construction
// (#2034). Every unsupported input is refused here, before anything billable
// is sent. See ./config.js for source attribution.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { CLOVA_ENCODING_FORMATS, CLOVA_MAX_INPUT_CHARS, CLOVA_MAX_INPUT_ITEMS, clovaEmbeddingModel } from "./config.js";

// `model`, `input`, `encoding_format`, `dimensions` are the source's known
// fields. `user` is an OpenAI tag that does not change the vectors; it is
// accepted and not forwarded (the source never forwarded anything but `text`).
// Anything else is refused because the v2 body has no place for it and the
// source dropped it silently.
const ACCEPTED_FIELDS = new Set(["model", "input", "encoding_format", "dimensions", "user"]);

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * @returns {{ texts: string[], bodies: Array<{ text: string }>, items: number, encodingFormat: "float"|"base64", model, dimensions: 1024 }}
 * @throws {Error} with `status: 400` for anything not supported
 */
export function buildClovaEmbeddingRequest(modelId, body) {
  const model = clovaEmbeddingModel(modelId);
  if (!model) throw invalid(`CLOVA Studio embeddings do not support model ${isString(modelId) ? modelId.slice(0, 128) : "(none)"}`);
  if (!isRecord(body)) throw invalid("Embedding request body must be an object");
  const unknown = Object.keys(body).find((key) => !ACCEPTED_FIELDS.has(key) && body[key] !== undefined);
  if (unknown) throw invalid(`CLOVA Studio embeddings do not support the ${unknown.slice(0, 64)} field`);

  const { input } = body;
  const list = isString(input) ? [input] : input;
  if (!Array.isArray(list) || list.length === 0) throw invalid("input must be a non-empty string or array of strings");
  if (list.length > CLOVA_MAX_INPUT_ITEMS) throw invalid(`CLOVA Studio embeddings accept at most ${CLOVA_MAX_INPUT_ITEMS} inputs per request`);
  list.forEach((item, position) => {
    // Source: "CLOVA Studio embedding v2 accepts non-empty text strings only".
    // Token arrays and structured items have no v2 representation.
    if (!isString(item)) throw invalid(`CLOVA Studio embedding v2 accepts non-empty text strings only (input ${position})`);
    if (!item.trim()) throw invalid(`CLOVA Studio embedding v2 accepts non-empty text strings only (input ${position} is empty)`);
    if (item.length > CLOVA_MAX_INPUT_CHARS) throw invalid(`input ${position} exceeds ${CLOVA_MAX_INPUT_CHARS} characters`);
  });

  const encodingFormat = body.encoding_format ?? "float";
  if (!CLOVA_ENCODING_FORMATS.includes(encodingFormat)) throw invalid("encoding_format must be float or base64");
  // Source: `dimensions !== undefined && Number(dimensions) !== 1024` is refused.
  // Only the number 1024 (or an absent value) is accepted here; it is never forwarded.
  if (body.dimensions !== undefined && body.dimensions !== null && body.dimensions !== model.dimensions) {
    throw invalid(`CLOVA Studio embedding v2 has a fixed dimension of ${model.dimensions}`);
  }
  return { texts: list, bodies: list.map((text) => ({ text })), items: list.length, encodingFormat, model, dimensions: model.dimensions };
}
