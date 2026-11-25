import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { decodeAnthropicRequest } from "@/sse/utils/inboundGzip.js";
import { handleCountTokens } from "@/sse/handlers/countTokens.js";

const CORS_HEADERS = {
  ...corsHeaders(["POST", "OPTIONS"]),
};

/** Handle CORS preflight */
async function OPTIONSHandler() {
  return new Response(null, { headers: CORS_HEADERS });
}

/** POST /v1/messages/count_tokens — native for Claude-compatible providers, else heuristic estimate. */
async function POSTHandler(request) {
  const decoded = await decodeAnthropicRequest(request);
  if (decoded.response) return decoded.response;
  return await handleCountTokens(decoded.request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
