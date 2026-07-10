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

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function GET(request) {
  return jsonNotFoundResponse(request);
}
export async function POST(request) {
  return jsonNotFoundResponse(request);
}
export async function PUT(request) {
  return jsonNotFoundResponse(request);
}
export async function PATCH(request) {
  return jsonNotFoundResponse(request);
}
export async function DELETE(request) {
  return jsonNotFoundResponse(request);
}
export async function HEAD() {
  return headNotFoundResponse();
}
