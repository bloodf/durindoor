import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleMusicGet } from "@/sse/handlers/music.js";

/** Poll with the submission's request_id, original API key and
 * x-9router-connection-id. Only confirmed terminal success records usage.
 */
async function GETHandler(request, { params }) {
  const { request_id } = await params;
  return handleMusicGet(request, request_id);
}

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export const GET = withRequestCorrelation(GETHandler);
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
