import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["POST", "OPTIONS"]),
    },
  });
}

/** POST /v1/images/generations - OpenAI-compatible image generation endpoint */
async function POSTHandler(request) {
  return await handleImageGeneration(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
