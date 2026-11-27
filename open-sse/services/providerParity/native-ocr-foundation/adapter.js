// The provider adapter interface for the staged OCR foundation (#2034). It is
// the source's OcrTransformation (open-sse/config/ocrRegistry.ts at OmniRoute
// c71f0065: buildRequest, parseResponse, pollUrl) plus the parts the source
// kept in the handler or the registry entry: the models, the origins the key
// may be sent to, the auth headers, and the poll status test.
//
// The foundation never invents provider auth. An adapter turns the selected
// connection's credentials into headers itself; when it returns null the
// request is refused before anything is sent.
import { isBoolean, isFunction, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { OCR_DOCUMENT_TYPES, OCR_INLINE_MEDIA_TYPES, OCR_POLL_INTERVAL_MS, OCR_POLL_MAX_ATTEMPTS } from "./config.js";

/** Poll states an adapter's pollState may return. */
export const OCR_POLL_STATES = Object.freeze(["running", "succeeded", "failed"]);

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED_FIELDS = new Set(["model", "document"]);

const fail = (id, message) => {
  throw new TypeError(`OCR adapter${id ? ` ${id}` : ""}: ${message}`);
};

function httpsOrigin(id, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || url.origin !== value) fail(id, `origin ${String(value)} must be a bare https origin`);
  return url.origin;
}

function subset(id, name, values, allowed) {
  if (!Array.isArray(values) || !values.length || values.some((v) => !allowed.includes(v))) {
    fail(id, `${name} must be a non-empty subset of ${allowed.join(", ")}`);
  }
  return Object.freeze([...new Set(values)]);
}

/**
 * Validate and freeze an adapter.
 *
 * @param {object} spec
 * @param {string} spec.id provider id (lowercase)
 * @param {string} [spec.label] display name used in error messages
 * @param {string[]} spec.origins the only https origins requests and polls may target
 * @param {{ id: string, name: string }[]} spec.models static model rows
 * @param {(id: string) => boolean} [spec.acceptsModel] passthrough test for ids outside `models`
 * @param {string[]} [spec.documentTypes] subset of OCR_DOCUMENT_TYPES
 * @param {string[]} [spec.inlineMediaTypes] subset of OCR_INLINE_MEDIA_TYPES; [] refuses inline documents
 * @param {boolean} [spec.acceptsUrl] false refuses remote document URLs
 * @param {Record<string, (value: unknown) => unknown>} [spec.options] extra top-level request fields and their validators (throw to refuse)
 * @param {(credentials: object) => Record<string, string> | null} spec.authHeaders
 * @param {(args: { model: string, document: object, options: object }) => { url: string, method?: string, headers?: Record<string, string>, body?: unknown }} spec.buildRequest
 * @param {(raw: unknown, ctx: { model: string }) => { model?: string, pages: unknown[], usage_info?: object }} spec.parseResponse
 * @param {(response: Response) => string | null} [spec.pollUrl] async jobs: the status URL from the submit answer
 * @param {(json: unknown) => "running" | "succeeded" | "failed"} [spec.pollState] required with pollUrl
 * @param {{ maxAttempts?: number, intervalMs?: number }} [spec.poll]
 */
export function defineOcrAdapter(spec) {
  if (!isRecord(spec)) fail(null, "spec must be an object");
  const { id } = spec;
  if (!isString(id) || !ID_RE.test(id)) fail(null, "id must be a lowercase provider id");
  if (spec.label !== undefined && (!isString(spec.label) || !spec.label.trim())) fail(id, "label must be a non-empty string");
  if (!Array.isArray(spec.origins) || !spec.origins.length) fail(id, "origins must list at least one https origin");
  const origins = Object.freeze(spec.origins.map((origin) => httpsOrigin(id, origin)));
  if (!Array.isArray(spec.models)) fail(id, "models must be an array");
  const models = Object.freeze(spec.models.map((row) => {
    if (!isRecord(row) || !isString(row.id) || !row.id || !isString(row.name)) fail(id, "each model needs a string id and name");
    return Object.freeze({ id: row.id, name: row.name });
  }));
  if (new Set(models.map((m) => m.id)).size !== models.length) fail(id, "model ids must be unique");
  for (const name of ["authHeaders", "buildRequest", "parseResponse"]) {
    if (!isFunction(spec[name])) fail(id, `${name} must be a function`);
  }
  if (spec.acceptsModel !== undefined && !isFunction(spec.acceptsModel)) fail(id, "acceptsModel must be a function");
  if (!models.length && !spec.acceptsModel) fail(id, "needs models or acceptsModel");
  if ((spec.pollUrl === undefined) !== (spec.pollState === undefined)) fail(id, "pollUrl and pollState go together");
  if (spec.pollUrl !== undefined && (!isFunction(spec.pollUrl) || !isFunction(spec.pollState))) fail(id, "pollUrl and pollState must be functions");
  const poll = { maxAttempts: OCR_POLL_MAX_ATTEMPTS, intervalMs: OCR_POLL_INTERVAL_MS, ...(spec.poll ?? {}) };
  if (!Number.isSafeInteger(poll.maxAttempts) || poll.maxAttempts < 1 || !Number.isSafeInteger(poll.intervalMs) || poll.intervalMs < 0) {
    fail(id, "poll needs a positive maxAttempts and a non-negative intervalMs");
  }
  const options = spec.options ?? {};
  if (!isRecord(options)) fail(id, "options must map field names to validators");
  for (const [field, check] of Object.entries(options)) {
    if (RESERVED_FIELDS.has(field) || !isFunction(check)) fail(id, `option ${field} must be a non-reserved field with a validator`);
  }
  const inlineMediaTypes = spec.inlineMediaTypes === undefined ? OCR_INLINE_MEDIA_TYPES
    : Array.isArray(spec.inlineMediaTypes) && !spec.inlineMediaTypes.length ? Object.freeze([])
      : subset(id, "inlineMediaTypes", spec.inlineMediaTypes, OCR_INLINE_MEDIA_TYPES);
  const acceptsUrl = spec.acceptsUrl ?? true;
  if (!isBoolean(acceptsUrl)) fail(id, "acceptsUrl must be a boolean");
  if (!acceptsUrl && !inlineMediaTypes.length) fail(id, "accepts neither URLs nor inline documents");

  return Object.freeze({
    id,
    label: spec.label ?? id,
    origins,
    models,
    acceptsModel: spec.acceptsModel ?? null,
    documentTypes: spec.documentTypes === undefined ? OCR_DOCUMENT_TYPES : subset(id, "documentTypes", spec.documentTypes, OCR_DOCUMENT_TYPES),
    inlineMediaTypes,
    acceptsUrl,
    options: Object.freeze({ ...options }),
    authHeaders: spec.authHeaders,
    buildRequest: spec.buildRequest,
    parseResponse: spec.parseResponse,
    pollUrl: spec.pollUrl ?? null,
    pollState: spec.pollState ?? null,
    poll: Object.freeze(poll),
  });
}
