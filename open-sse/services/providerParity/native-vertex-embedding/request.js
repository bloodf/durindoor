import { isRecord, isString, isNumber } from "../../../../src/shared/utils/typeChecks.js";
import { VERTEX_EMBEDDING_MODELS, VERTEX_EMBEDDING_TASK_TYPE } from "./config.js";
const invalid = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
/** Source text-only plan; refuse unsupported fields before token exchange or billable POST. */
export function buildVertexEmbeddingPlan(model, body) {
  const spec = VERTEX_EMBEDDING_MODELS.find((entry) => entry.id === model);
  if (!spec) invalid("Unsupported Vertex embedding model");
  if (!isRecord(body)) invalid("Invalid embedding body");
  if (Object.keys(body).some((key) => !["model", "input", "dimensions", "encoding_format", "user"].includes(key))) invalid("Unsupported Vertex embedding parameter");
  if (body.encoding_format !== undefined && !["float", "base64"].includes(body.encoding_format)) invalid("Vertex embeddings support float or base64 encoding");
  const items = isString(body.input) ? [body.input] : body.input;
  if (!Array.isArray(items) || !items.length || items.length > 250 || !items.every((text) => isString(text) && text.length > 0)) invalid("Vertex embeddings need 1..250 non-empty text inputs");
  // Source coerces dimensions through Number; stricter JSON integer validation avoids silent coercion.
  if (body.dimensions !== undefined && (!Number.isSafeInteger(body.dimensions) || body.dimensions <= 0)) invalid("dimensions must be a positive integer");
  const upstream = {
    instances: items.map((content) => ({ content, task_type: VERTEX_EMBEDDING_TASK_TYPE })),
  };
  if (body.dimensions !== undefined) upstream.parameters = { outputDimensionality: body.dimensions };
  return { model, encodingFormat: body.encoding_format ?? "float", itemCount: items.length, dimensions: body.dimensions ?? spec.dimensions, body: upstream,
    bodies: model === "gemini-embedding-001" ? upstream.instances.map((instance) => ({ ...upstream, instances: [instance] })) : [upstream] };
}
/** Count, width and finite numbers are mandatory; source estimates are not provider usage. */
export function mapVertexEmbeddingResponse(raw, plan) {
  if (raw?.error || !Array.isArray(raw?.predictions) || raw.predictions.length !== plan.itemCount) throw new Error("Invalid Vertex predictions");
  const data = raw.predictions.map((prediction, index) => {
    const vector = prediction?.embeddings?.values;
    if (!Array.isArray(vector) || vector.length !== plan.dimensions || !vector.length || !vector.every((n) => isNumber(n) && Number.isFinite(n))) throw new Error("Invalid Vertex vector");
    const bytes = plan.encodingFormat === "base64" ? Buffer.alloc(vector.length * 4) : null;
    if (bytes) vector.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
    return { object: "embedding", index, embedding: bytes ? bytes.toString("base64") : vector };
  });
  return { object: "list", data, model: plan.model, usage: { prompt_tokens: 0, total_tokens: 0 } };
}
