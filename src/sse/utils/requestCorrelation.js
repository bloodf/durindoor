import { isFunction, isObject, isString } from "../../shared/utils/typeChecks.js";
import { errorResponse, readBoundedResponseText, sanitizeErrorMessage } from "open-sse/utils/error.js";

const PROVIDER_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const requestIds = new WeakMap();

export function createRequestId() {
  return globalThis.crypto.randomUUID();
}

export function getRequestId(request, trustedRequestId = null) {
  if (!request || (!isObject(request) && !isFunction(request))) return trustedRequestId || createRequestId();
  let requestId = requestIds.get(request);
  if (!requestId) {
    requestId = trustedRequestId || createRequestId();
    requestIds.set(request, requestId);
  }
  return requestId;
}

export function validateProviderRequestId(value) {
  return isString(value) && PROVIDER_REQUEST_ID.test(value) ? value : null;
}

function responseInit(response, headers) {
  return { status: response.status, statusText: response.statusText, headers };
}

function sanitizeDiagnosticFields(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticFields(item));
  if (!value || !isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    (key === "message" || key === "details") && isString(nested) && nested ?
      sanitizeErrorMessage(nested) : sanitizeDiagnosticFields(nested),
  ]));
}

function providerRequestId(response, body) {
  const error = body?.error && isObject(body.error) ? body.error : null;
  const candidates = [
    error?.upstream_request_id, error?.request_id, body?.upstream_request_id, body?.request_id,
    response.headers.get("x-upstream-request-id"), response.headers.get("request-id"), response.headers.get("x-correlation-id"),
  ];
  return candidates.map(validateProviderRequestId).find(Boolean) || null;
}

async function correlateJsonError(response, requestId, headers) {
  let body;
  try { body = JSON.parse(await readBoundedResponseText(response.clone())); } catch { return null; }
  if (!body || !isObject(body) || Array.isArray(body)) return null;

  const upstreamRequestId = providerRequestId(response, body);
  const safeBody = sanitizeDiagnosticFields(body);
  const error = safeBody.error && isObject(safeBody.error) && !Array.isArray(safeBody.error) ? safeBody.error : safeBody;
  const correlationTarget = safeBody.type === "error" && error !== safeBody ? safeBody : error;
  delete safeBody.request_id;
  delete safeBody.upstream_request_id;
  delete error.request_id;
  delete error.upstream_request_id;
  correlationTarget.request_id = requestId;
  if (upstreamRequestId && upstreamRequestId !== requestId) correlationTarget.upstream_request_id = upstreamRequestId;

  headers.delete("content-length");
  return new Response(JSON.stringify(safeBody), responseInit(response, headers));
}

export async function correlateResponse(response, requestId = createRequestId()) {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  if (response.status >= 400) {
  headers.delete("x-upstream-request-id");
    const correlatedError = await correlateJsonError(response, requestId, headers);
    if (correlatedError) return correlatedError;
  }
  return new Response(response.body, responseInit(response, headers));
}

export function withRequestCorrelation(handler) {
  return async function correlatedRequestHandler(...args) {
    const requestId = getRequestId(args[0]);
    try { return await correlateResponse(await handler(...args), requestId); }
    catch (error) {
      console.error(`[RequestCorrelation] ${requestId}: ${sanitizeErrorMessage(error?.stack || error?.message || error)}`);
      return correlateResponse(errorResponse(500, "Request failed"), requestId);
    }
  };
}
