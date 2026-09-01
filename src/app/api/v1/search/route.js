import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleSearch } from "@/sse/handlers/search.js";

/**
 * Handle CORS preflight
 */
async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/search - Web search endpoint
 */
async function POSTHandler(request) {
  return await handleSearch(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
