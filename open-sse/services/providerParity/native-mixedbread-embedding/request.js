// Mixedbread embeddings request validation and body construction (#2034). Every
// unsupported input is refused here, before anything billable is sent. See
// ./config.js for source attribution.
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  MIXEDBREAD_ENCODING_FORMATS, MIXEDBREAD_MAX_INPUT_CHARS, MIXEDBREAD_MAX_INPUT_ITEMS, mixedbreadEmbeddingModel,
} from "./config.js";

// `model`, `input`, `encoding_format`, `dimensions` are the source's known
// fields. `user` is an OpenAI tag that does not change the vectors; it is
// accepted and not forwarded. Anything else (prompt, normalized,
// truncation_strategy, input_type, ...) is refused: the source forwarded
// unknown fields blindly, and their effect on Mixedbread's vectors, billing and
// answer shape is not part of the pinned contract.
const ACCEPTED_FIELDS = new Set(["model", "input", "encoding_format", "dimensions", "user"]);

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * @returns {{ upstream: { model, input, encoding_format?: "float" }, items: number, encodingFormat: "float"|"base64", model, dimensions: number }}
 * @throws {Error} with `status: 400` for anything not supported
 */
export function buildMixedbreadEmbeddingRequest(modelId, body) {
  const model = mixedbreadEmbeddingModel(modelId);
  if (!model) throw invalid(`Mixedbread embeddings do not support model ${isString(modelId) ? modelId.slice(0, 128) : "(none)"}`);
  if (!isRecord(body)) throw invalid("Embedding request body must be an object");
  const unknown = Object.keys(body).find((key) => !ACCEPTED_FIELDS.has(key) && body[key] !== undefined);
  if (unknown) throw invalid(`Mixedbread embeddings do not support the ${unknown.slice(0, 64)} field`);

  const { input } = body;
  const list = isString(input) ? [input] : input;
  if (!Array.isArray(list) || list.length === 0) throw invalid("input must be a non-empty string or array of strings");
  if (list.length > MIXEDBREAD_MAX_INPUT_ITEMS) throw invalid(`Mixedbread embeddings accept at most ${MIXEDBREAD_MAX_INPUT_ITEMS} inputs per request`);
  list.forEach((item, position) => {
    // Token arrays and structured (image/document) items: the source models
    // list no modalities, so the source refused structured input; token ids
    // are not part of the pinned Mixedbread contract.
    if (!isString(item)) throw invalid(`Mixedbread embeddings accept text strings only (input ${position})`);
    if (!item.trim()) throw invalid(`input ${position} is empty`);
    if (item.length > MIXEDBREAD_MAX_INPUT_CHARS) throw invalid(`input ${position} exceeds ${MIXEDBREAD_MAX_INPUT_CHARS} characters`);
  });

  const encodingFormat = body.encoding_format ?? "float";
  if (!MIXEDBREAD_ENCODING_FORMATS.includes(encodingFormat)) throw invalid("encoding_format must be float or base64");
  // The source records one width (1024) per model and forwarded `dimensions`
  // blindly. Reduced (Matryoshka) widths are not in the pinned contract, so
  // only the recorded width (or nothing) is accepted, and it is not sent.
  if (body.dimensions !== undefined && body.dimensions !== null) {
    if (!isNumber(body.dimensions) || body.dimensions !== model.dimensions) {
      throw invalid(`${model.id} has a fixed dimension of ${model.dimensions}`);
    }
  }
  // Source body: `{ model, input }`, plus `encoding_format` only when the
  // client sent it. A base64 request is not forwarded: floats come back and
  // are validated, then packed locally (the source's packEmbeddingAsBase64).
  const upstream = { model: model.id, input };
  if (body.encoding_format === "float") upstream.encoding_format = "float";
  return { upstream, items: list.length, encodingFormat, model, dimensions: model.dimensions };
}
