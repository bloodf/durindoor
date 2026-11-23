import { jsonNotFoundResponse, headNotFoundResponse } from "open-sse/translator/validate.js";
import { correlateResponse, getRequestId } from "@/sse/utils/requestCorrelation.js";

/**
 * Catch-all for unknown `/api/*` paths (OmniRoute #6424 / PR #6516).
 *
 * Extends the `/v1/*` catch-all (#6405) to the whole `/api/` tree so unknown
 * management-ish paths return JSON 404 instead of the dashboard HTML shell.
 * Real `/api/*` routes (static/dynamic segments) take precedence in App Router
 * matching, so existing endpoints are unaffected.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function preserveBodyWithRequestCorrelation(handler) {
  return async (...args) => {
    const requestId = getRequestId(args[0]);
    const response = await handler(...args);
    const correlated = await correlateResponse(response, requestId);
    if (!(response instanceof Response) || !(correlated instanceof Response)) return correlated;
    return new Response(response.body, {
      status: correlated.status,
      statusText: correlated.statusText,
      headers: correlated.headers,
    });
  };
}

async function OPTIONSHandler() {
  return new Response(null, { headers: CORS_HEADERS });
}

async function GETHandler(request) {
  return jsonNotFoundResponse(request);
}
async function POSTHandler(request) {
  return jsonNotFoundResponse(request);
}
async function PUTHandler(request) {
  return jsonNotFoundResponse(request);
}
async function PATCHHandler(request) {
  return jsonNotFoundResponse(request);
}
async function DELETEHandler(request) {
  return jsonNotFoundResponse(request);
}
async function HEADHandler() {
  return headNotFoundResponse();
}

export const OPTIONS = preserveBodyWithRequestCorrelation(OPTIONSHandler);
export const GET = preserveBodyWithRequestCorrelation(GETHandler);
export const POST = preserveBodyWithRequestCorrelation(POSTHandler);
export const PUT = preserveBodyWithRequestCorrelation(PUTHandler);
export const PATCH = preserveBodyWithRequestCorrelation(PATCHHandler);
export const DELETE = preserveBodyWithRequestCorrelation(DELETEHandler);
export const HEAD = preserveBodyWithRequestCorrelation(HEADHandler);
