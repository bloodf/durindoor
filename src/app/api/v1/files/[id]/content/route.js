// OpenAI File content — raw bytes download.
import path from "node:path";
import { getFileContent } from "open-sse/services/localFilesBatches.js";
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

/** GET /v1/files/<id>/content — raw file bytes. */
export async function GET(_request, context) {
  const { id } = await context.params;
  let found;
  try {
    found = await getFileContent(id);
  } catch (e) {
    return errorResponse(e.statusCode || HTTP_STATUS.BAD_REQUEST, e.message);
  }
  if (!found) return errorResponse(HTTP_STATUS.NOT_FOUND, "file not found");
  // Sanitize filename for the response header: basename only, strip quotes + CRLF
  // to prevent header injection from a caller-controlled upload name.
  const safeName = path.basename(found.meta.filename || "download").replace(/["\r\n\\]/g, "_");
  return new Response(found.buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      ...CORS,
    },
  });
}
