import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { jsonNotFoundResponse, headNotFoundResponse } from "open-sse/translator/validate.js";

/**
 * Catch-all for unknown `/v1/*` paths (OmniRoute #6405 / PR #6435).
 *
 * Without this route, unmatched `/v1/*` paths fall through to the Next.js
 * app-router `not-found.tsx`, which returns the dashboard HTML shell to API
 * clients. OpenAI-compatible SDKs expect JSON with `error.type === "not_found"`.
 * Static/dynamic segments under `/api/v1/` (e.g. `/v1/models`,
 * `/v1/chat/completions`) take precedence over this catch-all in App Router
 * matching, so real routes are unaffected.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

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
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const GET = withRequestCorrelation(GETHandler);
export const POST = withRequestCorrelation(POSTHandler);
export const PUT = withRequestCorrelation(PUTHandler);
export const PATCH = withRequestCorrelation(PATCHHandler);
export const DELETE = withRequestCorrelation(DELETEHandler);
export const HEAD = withRequestCorrelation(HEADHandler);
