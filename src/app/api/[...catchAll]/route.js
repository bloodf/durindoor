import { jsonNotFoundResponse, headNotFoundResponse } from "open-sse/translator/validate.js";

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
