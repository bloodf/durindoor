import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
// Anthropic Message Batch results — JSONL stream.
import { getAnthropicResultsJsonl } from "open-sse/services/localFilesBatches.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { resolveResourceOwner } from "@/sse/services/resourceOwnership.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

async function OPTIONSHandler() {
  return new Response(null, { headers: CORS });
}

/** GET /v1/messages/batches/<id>/results — JSONL {custom_id,result:{type,message|error}}. */
async function GETHandler(request, context) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  const { id } = await context.params;
  let text;
  try {
    text = await getAnthropicResultsJsonl(id, ownership);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (text === null) return errorResponse(HTTP_STATUS.NOT_FOUND, "message batch not found");
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", ...CORS },
  });
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const GET = withRequestCorrelation(GETHandler);
