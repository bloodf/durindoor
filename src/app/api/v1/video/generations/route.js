import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleVideoGeneration } from "@/sse/handlers/video.js";

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/video/generations - OpenAI-style video generation endpoint */
async function POSTHandler(request) {
  return await handleVideoGeneration(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
