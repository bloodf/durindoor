import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { requireJsonContentType } from "open-sse/translator/validate.js";
import { corsHeaders } from "@/lib/http/cors.js";


/**
 * Handle CORS preflight
 */
async function OPTIONSHandler() {
  return new Response(null, {
    headers: corsHeaders(["POST", "OPTIONS"])
  });
}

async function POSTHandler(request) {
  // #6414: reject non-JSON Content-Type with 415 before touching the body.
  const ctRejection = requireJsonContentType(request);
  if (ctRejection) return ctRejection;

  // Fallback to local handling

  return await handleChat(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
