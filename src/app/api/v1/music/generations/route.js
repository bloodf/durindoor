import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleMusicGeneration } from "@/sse/handlers/music.js";

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["POST", "OPTIONS"]),
    },
  });
}

/** POST /v1/music/generations - OpenAI-style music generation endpoint */
async function POSTHandler(request) {
  return await handleMusicGeneration(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
