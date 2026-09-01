import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
// OpenAI Batch detail — retrieve.
import { getBatch } from "open-sse/services/localFilesBatches.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { resolveResourceOwner } from "@/sse/services/resourceOwnership.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function OPTIONSHandler() {
  return new Response(null, { headers: CORS });
}

/** GET /v1/batches/<id>. */
async function GETHandler(request, context) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  const { id } = await context.params;
  let view;
  try {
    view = await getBatch(id, { surface: "openai", ...ownership });
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (!view) return errorResponse(HTTP_STATUS.NOT_FOUND, "batch not found");
  return json(view);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const GET = withRequestCorrelation(GETHandler);
