// Wire contracts from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/handlers/embeddings.ts and rerank.ts. Text/float subset only.
import { isRecord, isString, isBoolean } from "../../../../src/shared/utils/typeChecks.js";
import { embeddingConfig, rerankConfig } from "./config.js";

export const invalid = () => { throw new Error("Unsupported DeepInfra request or response"); };
const text = (v) => isString(v) && v.trim().length > 0 && v.length <= 20_000;
export function safeModel(model) {
  // Slash is part of hosted model identity; URL syntax, traversal and escapes are not.
  if (!isString(model) || model.length > 200 || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(model) || model.includes("..")) invalid();
  return model;
}
export function deepinfraHeaders(credentials) {
  const key = credentials?.apiKey || credentials?.accessToken;
  if (!isString(key) || !key.trim() || /[^\x21-\x7e]/.test(key)) invalid();
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}
function fields(body, allowed) {
  if (!isRecord(body) || Object.keys(body).some((k) => !allowed.includes(k) && body[k] !== undefined)) invalid();
}
export function buildEmbeddingBody(model, body) {
  safeModel(model);
  fields(body, ["model", "input", "dimensions", "encoding_format"]);
  const inputs = Array.isArray(body.input) ? body.input : [body.input];
  if (!inputs.length || inputs.length > 2048 || !inputs.every(text)) invalid();
  if (body.encoding_format !== undefined && body.encoding_format !== "float") invalid();
  if (body.dimensions !== undefined && (!Number.isSafeInteger(body.dimensions) || body.dimensions < 1 || body.dimensions > 65536)) invalid();
  const request = { model, input: body.input };
  if (body.dimensions !== undefined) request.dimensions = body.dimensions;
  if (body.encoding_format !== undefined) request.encoding_format = body.encoding_format;
  return request;
}
export function normalizeEmbedding(data, model, body) {
  const count = Array.isArray(body.input) ? body.input.length : 1;
  if (data?.error || !Array.isArray(data?.data) || data.data.length !== count) invalid();
  const seen = new Set();
  let width;
  const vectors = data.data.map((row) => {
    if (!Number.isInteger(row?.index) || row.index < 0 || row.index >= count || seen.has(row.index)) invalid();
    seen.add(row.index);
    const vector = row.embedding;
    if (!Array.isArray(vector) || !vector.length || vector.length > 65536 || !vector.every(Number.isFinite)) invalid();
    width ??= vector.length;
    if (vector.length !== width || (body.dimensions !== undefined && vector.length !== body.dimensions)) invalid();
    return { object: "embedding", index: row.index, embedding: vector };
  });
  return { object: "list", model, data: vectors.sort((a, b) => a.index - b.index) };
}
export function buildRerankBody(model, body) {
  safeModel(model);
  fields(body, ["model", "query", "documents", "top_n", "return_documents"]);
  if (!text(body.query) || !Array.isArray(body.documents) || !body.documents.length || body.documents.length > 2048) invalid();
  const documents = body.documents.map((doc) => {
    if (isRecord(doc)) fields(doc, ["text"]);
    const value = isString(doc) ? doc : doc?.text;
    if (!text(value)) invalid();
    return value;
  });
  if (body.top_n !== undefined && (!Number.isSafeInteger(body.top_n) || body.top_n < 1 || body.top_n > documents.length)) invalid();
  if (body.return_documents !== undefined && !isBoolean(body.return_documents)) invalid();
  return { queries: [body.query], documents };
}
export function normalizeRerank(data, model, body) {
  const request = buildRerankBody(model, body);
  if (data?.error || !Array.isArray(data?.scores) || data.scores.length !== request.documents.length || !data.scores.every(Number.isFinite)) invalid();
  const results = data.scores.map((score, index) => {
    const result = { index, relevance_score: score };
    if (body.return_documents !== false) result.document = { text: request.documents[index] };
    return result;
  });
  results.sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index);
  // Do not copy the source's synthetic billed_units: no actual receipt supports it.
  return { id: `rerank-${Date.now()}`, results: results.slice(0, body.top_n ?? results.length) };
}
export const deepinfraEmbeddingAdapter = Object.freeze({
  buildUrl: () => embeddingConfig.baseUrl, buildHeaders: deepinfraHeaders,
  buildBody: buildEmbeddingBody, normalize: normalizeEmbedding,
});
export const deepinfraRerankAdapter = Object.freeze({
  buildUrl: (model) => `${rerankConfig.baseUrl}/${safeModel(model)}`, buildHeaders: deepinfraHeaders,
  buildBody: buildRerankBody, normalize: normalizeRerank,
});
