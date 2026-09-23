import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleSystemone } from "@/sse/handlers/systemone.js";

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/systemone - System One (Jev) decision endpoint */
async function POSTHandler(request) {
  return await handleSystemone(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
