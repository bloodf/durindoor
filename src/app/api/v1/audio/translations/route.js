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

/**
 * POST /v1/audio/translations - OpenAI Whisper-compatible translation endpoint.
 * Forwards to the provider's /audio/translations endpoint; provider-specific STT
 * formats without a translation analog are rejected with 400.
 */
async function POSTHandler(request) {
  return await handleStt(request, { kind: "translation" });
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
