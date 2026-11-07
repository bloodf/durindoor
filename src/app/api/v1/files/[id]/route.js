import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
// OpenAI File detail — metadata + delete.
import { getFile, deleteFile } from "open-sse/services/localFilesBatches.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { resolveResourceOwner } from "@/sse/services/resourceOwnership.js";
import { annotateClientAdmissionFailure } from "open-sse/services/operationalMetrics.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function OPTIONSHandler() {
  return new Response(null, { headers: CORS });
}

async function HEADHandler(request, context) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return annotateClientAdmissionFailure(new Response(null, { status: 401, headers: CORS }), ownership.denialReason);
  const { id } = await context.params;
  const meta = await getFile(id, ownership).catch(() => null);
  return new Response(null, { status: meta ? 200 : 404, headers: CORS });
}

/** GET /v1/files/<id> — metadata. */
async function GETHandler(request, context) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return annotateClientAdmissionFailure(errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key"), ownership.denialReason);
  const { id } = await context.params;
  let meta;
  try {
    meta = await getFile(id, ownership);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (!meta) return errorResponse(HTTP_STATUS.NOT_FOUND, "file not found");
  return json(meta);
}

/** DELETE /v1/files/<id>. */
async function DELETEHandler(request, context) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return annotateClientAdmissionFailure(errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key"), ownership.denialReason);
  const { id } = await context.params;
  let result;
  try {
    result = await deleteFile(id, ownership);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (!result) return errorResponse(HTTP_STATUS.NOT_FOUND, "file not found");
  return json(result);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const HEAD = withHttpRequestCorrelation(HEADHandler);
export const GET = withHttpRequestCorrelation(GETHandler);
export const DELETE = withHttpRequestCorrelation(DELETEHandler);
