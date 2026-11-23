import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleFetch } from "@/sse/handlers/fetch.js";

/**
 * Handle CORS preflight
 */
async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["POST", "OPTIONS"]),
    }
  });
}

/**
 * POST /v1/web/fetch - Web URL fetch/extract endpoint
 */
async function POSTHandler(request) {
  return await handleFetch(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
