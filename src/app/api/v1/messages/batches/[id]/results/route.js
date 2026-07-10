// Anthropic Message Batch results — JSONL stream.
import { getAnthropicResultsJsonl } from "open-sse/services/localFilesBatches.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS });
}

/** GET /v1/messages/batches/<id>/results — JSONL {custom_id,result:{type,message|error}}. */
export async function GET(_request, context) {
  const { id } = await context.params;
  let text;
  try {
    text = await getAnthropicResultsJsonl(id);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (text === null) return errorResponse(HTTP_STATUS.NOT_FOUND, "message batch not found");
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", ...CORS },
  });
}
