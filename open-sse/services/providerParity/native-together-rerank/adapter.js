// Wire contract from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/handlers/rerank.ts (default Cohere-compatible branch used by `together`).
// Text documents only; upstream output is validated and rebuilt, never relayed.
import { isRecord, isString, isBoolean } from "../../../../src/shared/utils/typeChecks.js";
import { rerankConfig } from "./config.js";

export const invalid = () => { throw new Error("Unsupported Together rerank request or response"); };
const text = (v) => isString(v) && v.trim().length > 0 && v.length <= 20_000;
const MAX_DOCUMENTS = 1024;

/** Hosted IDs keep vendor slashes; URL syntax, traversal, escapes and control bytes are refused. */
export function safeModel(model) {
  if (!isString(model) || model.length > 200 || model.includes("..") ||
      !/^[A-Za-z0-9_-][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._:-]*)*$/.test(model)) invalid();
  return model;
}
/** Source buildAuthHeader: bearer from apiKey, then accessToken. */
export function togetherHeaders(credentials) {
  const key = credentials?.apiKey || credentials?.accessToken;
  if (!isString(key) || !key.trim() || /[^\x21-\x7e]/.test(key)) invalid();
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}
function fields(body, allowed) {
  if (!isRecord(body) || Object.keys(body).some((k) => !allowed.includes(k) && body[k] !== undefined)) invalid();
}
function documentTexts(body) {
  if (!Array.isArray(body.documents) || !body.documents.length || body.documents.length > MAX_DOCUMENTS) invalid();
  return body.documents.map((doc) => {
    if (isRecord(doc)) fields(doc, ["text"]);
    const value = isString(doc) ? doc : doc?.text;
    if (!text(value)) invalid();
    return value;
  });
}

/**
 * Source envelope: { model, query, documents, top_n: top_n || documents.length,
 * return_documents: return_documents !== false }. Documents are forwarded in the
 * caller's accepted form (string or { text }), as the source does.
 */
export function buildRerankBody(model, body) {
  safeModel(model);
  fields(body, ["model", "query", "documents", "top_n", "return_documents"]);
  if (!text(body.query)) invalid();
  const texts = documentTexts(body);
  if (body.top_n !== undefined && (!Number.isSafeInteger(body.top_n) || body.top_n < 1 || body.top_n > texts.length)) invalid();
  if (body.return_documents !== undefined && !isBoolean(body.return_documents)) invalid();
  const documents = body.documents.map((doc, i) => (isString(doc) ? doc : { text: texts[i] }));
  return { model, query: body.query, documents, top_n: body.top_n ?? texts.length, return_documents: body.return_documents !== false };
}

/** Validate Cohere-shaped results and rebuild them from caller-owned document text. */
export function normalizeRerank(data, model, body) {
  const request = buildRerankBody(model, body);
  const texts = documentTexts(body);
  if (!isRecord(data) || data.error || !Array.isArray(data.results) || !data.results.length || data.results.length > request.top_n) invalid();
  const seen = new Set();
  const results = data.results.map((row) => {
    if (!isRecord(row) || !Number.isSafeInteger(row.index) || row.index < 0 || row.index >= texts.length || seen.has(row.index) ||
        !Number.isFinite(row.relevance_score)) invalid();
    seen.add(row.index);
    const result = { index: row.index, relevance_score: row.relevance_score };
    if (request.return_documents) result.document = { text: texts[row.index] };
    return result;
  });
  results.sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index);
  const id = isString(data.id) && /^[A-Za-z0-9._:-]{1,128}$/.test(data.id) ? data.id : `rerank-${Date.now()}`;
  // No synthetic billed_units: only a real upstream usage receipt is reported (service.js).
  return { id, model, results };
}

export const togetherRerankAdapter = Object.freeze({
  buildUrl: () => rerankConfig.baseUrl, buildHeaders: togetherHeaders,
  buildBody: buildRerankBody, normalize: normalizeRerank,
});
