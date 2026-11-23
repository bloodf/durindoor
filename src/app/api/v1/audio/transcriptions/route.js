import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleStt } from "@/sse/handlers/stt.js";

// Allow large audio uploads — 5min for processing large files
export const maxDuration = 300;

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["POST", "OPTIONS"]),
    },
  });
}

/** POST /v1/audio/transcriptions - OpenAI Whisper compatible STT */
async function POSTHandler(request) {
  return await handleStt(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
