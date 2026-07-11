// OpenAI Batch detail — retrieve.
import { getBatch } from "open-sse/services/localFilesBatches.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

export async function OPTIONS() {
  return new Response(null, { headers: CORS });
}

/** GET /v1/batches/<id>. */
export async function GET(_request, context) {
  const { id } = await context.params;
  let view;
  try {
    view = await getBatch(id, { surface: "openai" });
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (!view) return errorResponse(HTTP_STATUS.NOT_FOUND, "batch not found");
  return json(view);
}
