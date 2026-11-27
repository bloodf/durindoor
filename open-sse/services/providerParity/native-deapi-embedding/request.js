// deAPI embeddings request validation and body construction (#2034). Every
// unsupported input is refused here, before anything billable is sent. See
// ./config.js for source attribution.
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DEAPI_ENCODING_FORMATS, DEAPI_MAX_INPUT_CHARS, DEAPI_MAX_INPUT_ITEMS, deapiEmbeddingModel,
} from "./config.js";

// `model`, `input`, `encoding_format`, `dimensions` are the source's known
// fields. `user` is an OpenAI tag that does not change the vectors; it is
// accepted and not forwarded. Anything else (input_type, task, ...) is refused
// because the source forwarded it blindly and deAPI's handling is unknown.
const ACCEPTED_FIELDS = new Set(["model", "input", "encoding_format", "dimensions", "user"]);

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * @returns {{ upstream: { model, input, encoding_format: "float" }, items: number, encodingFormat: "float"|"base64", model }}
 * @throws {Error} with `status: 400` for anything not supported
 */
export function buildDeapiEmbeddingRequest(modelId, body) {
  const model = deapiEmbeddingModel(modelId);
  if (!model) throw invalid(`deAPI embeddings do not support model ${isString(modelId) ? modelId.slice(0, 128) : "(none)"}`);
  if (!isRecord(body)) throw invalid("Embedding request body must be an object");
  const unknown = Object.keys(body).find((key) => !ACCEPTED_FIELDS.has(key) && body[key] !== undefined);
  if (unknown) throw invalid(`deAPI embeddings do not support the ${unknown.slice(0, 64)} field`);

  const { input } = body;
  const list = isString(input) ? [input] : input;
  if (!Array.isArray(list) || list.length === 0) throw invalid("input must be a non-empty string or array of strings");
  if (list.length > DEAPI_MAX_INPUT_ITEMS) throw invalid(`deAPI embeddings accept at most ${DEAPI_MAX_INPUT_ITEMS} inputs per request`);
  list.forEach((item, position) => {
    // Token arrays and structured (image/audio) items: the model lists no
    // modalities, so the source refused structured input; token ids are not
    // a documented deAPI input.
    if (!isString(item)) throw invalid(`deAPI embeddings accept text strings only (input ${position})`);
    if (!item.trim()) throw invalid(`input ${position} is empty`);
    if (item.length > DEAPI_MAX_INPUT_CHARS) throw invalid(`input ${position} exceeds ${DEAPI_MAX_INPUT_CHARS} characters`);
  });

  const encodingFormat = body.encoding_format ?? "float";
  if (!DEAPI_ENCODING_FORMATS.includes(encodingFormat)) throw invalid("encoding_format must be float or base64");
  if (body.dimensions !== undefined && body.dimensions !== null) {
    if (!isNumber(body.dimensions) || body.dimensions !== model.dimensions) {
      throw invalid(`${model.id} has a fixed dimension of ${model.dimensions}`);
    }
  }
  // Same order and value as the source's string-input body. Upstream is always
  // asked for floats so vectors can be validated before a base64 pack.
  return { upstream: { model: model.id, input, encoding_format: "float" }, items: list.length, encodingFormat, model };
}
