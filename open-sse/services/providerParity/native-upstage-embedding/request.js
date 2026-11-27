// Upstage embeddings request validation and body construction (#2034). Every
// unsupported input is refused here, before anything billable is sent. See
// ./config.js for source attribution.
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  UPSTAGE_ENCODING_FORMATS, UPSTAGE_MAX_INPUT_CHARS, UPSTAGE_MAX_INPUT_ITEMS, upstageEmbeddingModel,
} from "./config.js";

// `model`, `input`, `encoding_format`, `dimensions` are the source's known
// fields. `user` is an OpenAI tag that does not change the vectors; it is
// accepted and not forwarded. Anything else (input_type, task, ...) is refused
// because the source forwarded it blindly and Upstage's handling is unknown.
// Query/passage asymmetry is chosen by model id, not by a parameter.
const ACCEPTED_FIELDS = new Set(["model", "input", "encoding_format", "dimensions", "user"]);

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * @returns {{ upstream: { model, input, encoding_format?: "float" }, items: number, encodingFormat: "float"|"base64", model, dimensions: number }}
 * @throws {Error} with `status: 400` for anything not supported
 */
export function buildUpstageEmbeddingRequest(modelId, body) {
  const model = upstageEmbeddingModel(modelId);
  if (!model) throw invalid(`Upstage embeddings do not support model ${isString(modelId) ? modelId.slice(0, 128) : "(none)"}`);
  if (!isRecord(body)) throw invalid("Embedding request body must be an object");
  const unknown = Object.keys(body).find((key) => !ACCEPTED_FIELDS.has(key) && body[key] !== undefined);
  if (unknown) throw invalid(`Upstage embeddings do not support the ${unknown.slice(0, 64)} field`);

  const { input } = body;
  const list = isString(input) ? [input] : input;
  if (!Array.isArray(list) || list.length === 0) throw invalid("input must be a non-empty string or array of strings");
  if (list.length > UPSTAGE_MAX_INPUT_ITEMS) throw invalid(`Upstage embeddings accept at most ${UPSTAGE_MAX_INPUT_ITEMS} inputs per request`);
  list.forEach((item, position) => {
    // Token arrays and structured (image/document) items: the models list no
    // modalities, so the source refused structured input; token ids are not
    // a documented Upstage input.
    if (!isString(item)) throw invalid(`Upstage embeddings accept text strings only (input ${position})`);
    if (!item.trim()) throw invalid(`input ${position} is empty`);
    if (item.length > UPSTAGE_MAX_INPUT_CHARS) throw invalid(`input ${position} exceeds ${UPSTAGE_MAX_INPUT_CHARS} characters`);
  });

  const encodingFormat = body.encoding_format ?? "float";
  if (!UPSTAGE_ENCODING_FORMATS.includes(encodingFormat)) throw invalid("encoding_format must be float or base64");
  // Both models have one fixed width; the source forwarded `dimensions`
  // blindly. Only the fixed width (or nothing) is accepted, and it is not sent.
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
