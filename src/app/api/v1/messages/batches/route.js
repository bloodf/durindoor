// Anthropic Message Batches collection — create + list.
import { createAnthropicBatch, listBatches } from "open-sse/services/localFilesBatches.js";
import { makeDefaultExecutor } from "open-sse/handlers/localBatchExecutor.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

export async function OPTIONS() {
  return new Response(null, { headers: CORS });
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: CORS });
}

/** GET /v1/messages/batches — list Anthropic batches. */
export async function GET() {
  return json(await listBatches({ surface: "anthropic" }));
}

/**
 * POST /v1/messages/batches — create + start.
 * Body: { requests: [{ custom_id, params }] }. Non-JSON → 415.
 */
export async function POST(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return errorResponse(415, "Content-Type must be application/json");
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  if (!body || !Array.isArray(body.requests)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "requests array is required");
  }
  try {
    const executor = makeDefaultExecutor(request.headers);
    const view = await createAnthropicBatch(body, { executor });
    return json(view, 200);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
}
