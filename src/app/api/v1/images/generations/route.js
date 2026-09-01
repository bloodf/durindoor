import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/images/generations - OpenAI-compatible image generation endpoint */
async function POSTHandler(request) {
  return await handleImageGeneration(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
