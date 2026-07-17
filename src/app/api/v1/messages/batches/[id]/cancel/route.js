// Anthropic Message Batch cancel.
import { cancelBatch } from "open-sse/services/localFilesBatches.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { resolveResourceOwner } from "@/sse/services/resourceOwnership.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

export async function OPTIONS() {
  return new Response(null, { headers: CORS });
}

/** POST /v1/messages/batches/<id>/cancel. */
export async function POST(request, context) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  const { id } = await context.params;
  let view;
  try {
    view = await cancelBatch(id, { surface: "anthropic", ...ownership });
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (!view) return errorResponse(HTTP_STATUS.NOT_FOUND, "message batch not found");
  return json(view);
}
