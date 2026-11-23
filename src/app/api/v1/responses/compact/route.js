import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleChat } from "@/sse/handlers/chat.js";


async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["POST", "OPTIONS"]),
    }
  });
}

/**
 * POST /v1/responses/compact - Compact conversation context
 * The original Request is preserved. The chat pipeline derives compact routing
 * from the endpoint instead of injecting an internal field into client JSON.
 */
async function POSTHandler(request) {
  return await handleChat(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
