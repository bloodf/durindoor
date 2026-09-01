import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
// Anthropic Message Batches collection — create + list.
import { createAnthropicBatch, listBatches } from "open-sse/services/localFilesBatches.js";
import { makeDefaultExecutor } from "open-sse/handlers/localBatchExecutor.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { resolveResourceOwner } from "@/sse/services/resourceOwnership.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function OPTIONSHandler() {
  return new Response(null, { headers: CORS });
}

async function HEADHandler() {
  return new Response(null, { status: 200, headers: CORS });
}

/** GET /v1/messages/batches — list Anthropic batches. */
async function GETHandler(request) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  return json(await listBatches({ surface: "anthropic", ...ownership }));
}

/**
 * POST /v1/messages/batches — create + start.
 * Body: { requests: [{ custom_id, params }] }. Non-JSON → 415.
 */
async function POSTHandler(request) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
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
    const executor = makeDefaultExecutor(request);
    const view = await createAnthropicBatch(body, { executor, ...ownership });
    return json(view, 200);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const HEAD = withRequestCorrelation(HEADHandler);
export const GET = withRequestCorrelation(GETHandler);
export const POST = withRequestCorrelation(POSTHandler);
