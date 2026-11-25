import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleCompletions } from "@/sse/handlers/completions.js";

export { adaptLegacyBody, mapCompletionResponse } from "@/sse/handlers/completions.js";


/**
 * Handle CORS preflight
 */
async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["POST", "HEAD", "OPTIONS"]),
    }
  });
}

/**
 * HEAD /v1/completions — explicit handler (kills ~6s hang on HEAD probes).
 */
async function HEADHandler() {
  return new Response(null, {
    status: 200,
    headers: {
      ...corsHeaders(["POST", "HEAD", "OPTIONS"]),
    }
  });
}

export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const HEAD = withHttpRequestCorrelation(HEADHandler);
export const POST = withHttpRequestCorrelation(handleCompletions);
