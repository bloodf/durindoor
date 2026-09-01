import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleMusicGeneration } from "@/sse/handlers/music.js";

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/music/generations - OpenAI-style music generation endpoint */
async function POSTHandler(request) {
  return await handleMusicGeneration(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
