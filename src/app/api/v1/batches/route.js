import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
// OpenAI Batches collection — create + list.
import { createOpenAIBatch, listBatches } from "open-sse/services/localFilesBatches.js";
import { makeDefaultExecutor } from "open-sse/handlers/localBatchExecutor.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { resolveResourceOwner } from "@/sse/services/resourceOwnership.js";
import { isString } from "../../../../shared/utils/typeChecks.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

const json = (body, status = 200) =>
new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function OPTIONSHandler() {
  return new Response(null, { headers: CORS });
}

async function HEADHandler() {
  return new Response(null, { status: 200, headers: CORS });
}

/** GET /v1/batches — list batches (most recent first). */
async function GETHandler(request) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  return json(await listBatches({ surface: "openai", ...ownership }));
}

/**
 * POST /v1/batches — create + start a local batch.
 * Body: { input_file_id, endpoint, completion_window?, metadata? }.
 * Per O-A convention: non-JSON POST → 415.
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
  if (!body || !isString(body.input_file_id)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "input_file_id is required");
  }
  try {
    const executor = makeDefaultExecutor(request);
    const view = await createOpenAIBatch(body, { executor, ...ownership });
    return json(view, 200);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const HEAD = withRequestCorrelation(HEADHandler);
export const GET = withRequestCorrelation(GETHandler);
export const POST = withRequestCorrelation(POSTHandler);
