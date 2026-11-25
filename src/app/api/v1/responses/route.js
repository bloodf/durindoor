import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleResponses } from "@/sse/handlers/chat/keepalive.js";


async function OPTIONSHandler() {
  return new Response(null, {
    headers: corsHeaders(["POST", "OPTIONS"])
  });
}

export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(handleResponses);
