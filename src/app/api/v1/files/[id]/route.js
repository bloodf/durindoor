// OpenAI File detail — metadata + delete.
import { getFile, deleteFile } from "open-sse/services/localFilesBatches.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

export async function OPTIONS() {
  return new Response(null, { headers: CORS });
}

export async function HEAD(_request, context) {
  const { id } = await context.params;
  const meta = await getFile(id).catch(() => null);
  return new Response(null, { status: meta ? 200 : 404, headers: CORS });
}

/** GET /v1/files/<id> — metadata. */
export async function GET(_request, context) {
  const { id } = await context.params;
  let meta;
  try {
    meta = await getFile(id);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (!meta) return errorResponse(HTTP_STATUS.NOT_FOUND, "file not found");
  return json(meta);
}

/** DELETE /v1/files/<id>. */
export async function DELETE(_request, context) {
  const { id } = await context.params;
  let result;
  try {
    result = await deleteFile(id);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (!result) return errorResponse(HTTP_STATUS.NOT_FOUND, "file not found");
  return json(result);
}
