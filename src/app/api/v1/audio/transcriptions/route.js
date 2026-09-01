import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleStt } from "@/sse/handlers/stt.js";

// Allow large audio uploads — 5min for processing large files
export const maxDuration = 300;

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/audio/transcriptions - OpenAI Whisper compatible STT */
async function POSTHandler(request) {
  return await handleStt(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
