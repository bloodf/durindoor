import { corsHeaders } from "@/lib/http/cors.js";
import { handleCodexAlphaSearch } from "@/sse/handlers/codexAlphaSearch.js";
import { withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";

export const POST = withHttpRequestCorrelation(handleCodexAlphaSearch);

export function OPTIONS() {
  return new Response(null, { headers: corsHeaders(["POST", "OPTIONS"]) });
}
