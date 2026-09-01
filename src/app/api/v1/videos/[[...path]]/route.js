import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleVideoCreate, handleVideoGet } from "@/sse/handlers/video.js";

/**
 * /v1/videos — async video generation API (xAI Grok Imagine).
 *
 * Endpoints:
 *   POST /v1/videos/generations   Create an async video job from a text prompt.
 *   POST /v1/videos/edits         Create an async video edit job (multipart supported).
 *   POST /v1/videos/extensions    Create an async video extension job.
 *   GET  /v1/videos/{request_id}  Poll job status until done/failed.
 *
 * Auth: standard gateway API key (`Authorization: Bearer <key>`); enforced when
 * `requireApiKey` is on. The request body is forwarded to the upstream provider
 * byte-for-byte (JSON or multipart); `model` may carry a `provider/` prefix,
 * which is resolved and stripped before forwarding.
 *
 * Job flow: POST returns `{ request_id, status, ... }` and an
 * `x-9router-connection-id` header. Poll with GET, echoing that value back as
 * `x-connection-id` — upstream jobs are account-bound, so polls must hit the
 * same connection that created the job. On completion the GET response carries
 * `video.url`.
 *
 * Ported from decolua/9router#2593 (CLI `9router xai video` drives these same
 * endpoints through the running gateway).
 */
async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function badRequest(message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

async function POSTHandler(request, { params }) {
  const { path = [] } = await params;
  if (path.length !== 1) return badRequest("Expected /v1/videos/{generations|edits|extensions}");
  return await handleVideoCreate(request, path[0]);
}

async function GETHandler(request, { params }) {
  const { path = [] } = await params;
  if (path.length !== 1) return badRequest("Expected /v1/videos/{request_id}");
  return await handleVideoGet(request, path[0]);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
export const GET = withRequestCorrelation(GETHandler);
