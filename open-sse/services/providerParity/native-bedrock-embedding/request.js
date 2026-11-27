import { BEDROCK_EMBEDDING_MODELS } from "./config.js";
const invalid = () => { throw Object.assign(new Error("Unsupported Bedrock embedding input or options"), { status: 400 }); };
/** Text subset of source native envelopes; validate the entire batch before submission. */
export function buildBedrockEmbeddingRequest(modelId, body) {
  const model = BEDROCK_EMBEDDING_MODELS.find(row => row.id === modelId);
  if (!model || !body || typeof body !== "object" || Array.isArray(body)) invalid();
  if (Object.keys(body).some(key => !["model", "input", "dimensions", "encoding_format", "input_type", "normalize", "user"].includes(key) && body[key] !== undefined)) invalid();
  const texts = typeof body.input === "string" ? [body.input] : body.input;
  if (!Array.isArray(texts) || !texts.length || texts.length > 96 || texts.some(text => typeof text !== "string" || !text.trim() || text.length > 20000)) invalid();
  if (![undefined, "float", "base64"].includes(body.encoding_format)) invalid();
  const cohere = modelId.startsWith("cohere.");
  const multimodal = modelId.includes("embed-image");
  const v2 = modelId.includes("text-v2");
  const allowedDimensions = v2 ? [256, 512, 1024] : multimodal ? [256, 384, 1024] : modelId === "cohere.embed-v4:0" ? [256, 512, 1024, 1536] : [model.dimensions];
  if (body.dimensions !== undefined && !allowedDimensions.includes(body.dimensions)) invalid();
  if (body.normalize !== undefined && (!v2 || typeof body.normalize !== "boolean")) invalid();
  if (body.input_type !== undefined && (!cohere || !["search_document", "search_query", "classification", "clustering"].includes(body.input_type))) invalid();
  const bodies = cohere ? [{ texts, input_type: body.input_type ?? "search_document", ...(body.dimensions === undefined ? {} : { output_dimension: body.dimensions }) }] : texts.map(inputText => ({ inputText,
    ...(body.dimensions === undefined ? {} : multimodal ? { embeddingConfig: { outputEmbeddingLength: body.dimensions } } : v2 ? { dimensions: body.dimensions } : {}),
    ...(body.normalize === undefined ? {} : { normalize: body.normalize }),
  }));
  return { model, bodies, cohere, items: texts.length, dimensions: body.dimensions ?? model.dimensions, encodingFormat: body.encoding_format ?? "float" };
}
