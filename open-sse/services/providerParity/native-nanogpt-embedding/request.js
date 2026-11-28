// NanoGPT embeddings request validation and body construction (#2034). Every
// unsupported input is refused here, before anything billable is sent. See
// ./config.js for source attribution.
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  NANOGPT_ENCODING_FORMATS, NANOGPT_MAX_INPUT_CHARS, NANOGPT_MAX_INPUT_ITEMS, nanogptEmbeddingModel,
} from "./config.js";

// `model`, `input`, `encoding_format`, `dimensions` are the source's known
// fields. `user` is an OpenAI tag that does not change the vectors; it is
// accepted and not forwarded. Anything else (input_type, task, ...) is refused
// because the source forwarded it blindly and NanoGPT's handling is unknown.
const ACCEPTED_FIELDS = new Set(["model", "input", "encoding_format", "dimensions", "user"]);

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * @returns {{ upstream: { model, input, dimensions?, encoding_format: "float" }, items: number, encodingFormat: "float"|"base64", model, dimensions: number }}
 * @throws {Error} with `status: 400` for anything not supported
 */
export function buildNanogptEmbeddingRequest(modelId, body) {
  const model = nanogptEmbeddingModel(modelId);
  if (!model) throw invalid(`NanoGPT embeddings do not support model ${isString(modelId) ? modelId.slice(0, 128) : "(none)"}`);
  if (!isRecord(body)) throw invalid("Embedding request body must be an object");
  const unknown = Object.keys(body).find((key) => !ACCEPTED_FIELDS.has(key) && body[key] !== undefined);
  if (unknown) throw invalid(`NanoGPT embeddings do not support the ${unknown.slice(0, 64)} field`);

  const { input } = body;
  const list = isString(input) ? [input] : input;
  if (!Array.isArray(list) || list.length === 0) throw invalid("input must be a non-empty string or array of strings");
  if (list.length > NANOGPT_MAX_INPUT_ITEMS) throw invalid(`NanoGPT embeddings accept at most ${NANOGPT_MAX_INPUT_ITEMS} inputs per request`);
  list.forEach((item, position) => {
    // Token arrays and structured (image/audio) items: the models list no
    // modalities, so the source refused structured input; token ids are not
    // a documented NanoGPT input.
    if (!isString(item)) throw invalid(`NanoGPT embeddings accept text strings only (input ${position})`);
    if (!item.trim()) throw invalid(`input ${position} is empty`);
    if (item.length > NANOGPT_MAX_INPUT_CHARS) throw invalid(`input ${position} exceeds ${NANOGPT_MAX_INPUT_CHARS} characters`);
  });

  const encodingFormat = body.encoding_format ?? "float";
  if (!NANOGPT_ENCODING_FORMATS.includes(encodingFormat)) throw invalid("encoding_format must be float or base64");
  // The source forwarded `dimensions` as sent. text-embedding-3 models take a
  // reduced width (1..full); anything else is refused before the send, and the
  // answer must then carry vectors of exactly that width.
  let dimensions = model.dimensions;
  const forwarded = {};
  if (body.dimensions !== undefined && body.dimensions !== null) {
    if (!isNumber(body.dimensions) || !Number.isInteger(body.dimensions) || body.dimensions < 1 || body.dimensions > model.dimensions) {
      throw invalid(`dimensions for ${model.id} must be an integer from 1 to ${model.dimensions}`);
    }
    dimensions = body.dimensions;
    forwarded.dimensions = dimensions;
  }
  // Same order as the source body. Upstream is always asked for floats so
  // vectors can be validated before a base64 pack.
  return { upstream: { model: model.id, input, ...forwarded, encoding_format: "float" }, items: list.length, encodingFormat, model, dimensions };
}
