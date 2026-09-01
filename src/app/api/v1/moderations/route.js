import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleModerations } from "@/sse/handlers/moderations.js";

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/moderations - OpenAI-compatible moderation passthrough. */
async function POSTHandler(request) {
  return await handleModerations(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
