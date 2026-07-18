// OpenAI Files collection — local filesystem store under ~/.9router/files/<id>. (DurinDoor data directory)
import { uploadFile, listFiles } from "open-sse/services/localFilesBatches.js";
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

export async function OPTIONS() {
  return new Response(null, { headers: CORS });
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: CORS });
}

/** GET /v1/files — list uploaded files. */
export async function GET(request) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  return json(await listFiles(ownership));
}

/**
 * POST /v1/files — multipart upload (fields: file, purpose).
 * Per O-A convention: non-multipart POST → 415.
 */
export async function POST(request) {
  const ownership = await resolveResourceOwner(request);
  if (!ownership.authorized) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("multipart/form-data")) {
    return errorResponse(415, "Content-Type must be multipart/form-data");
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart body");
  }
  const file = form.get("file");
  const purpose = form.get("purpose") || "batch";
  if (!file || typeof file === "string") {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "file field is required");
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const meta = await uploadFile({ filename: file.name || "upload", bytes: buf, purpose }, ownership);
  return json(meta, 201);
}
