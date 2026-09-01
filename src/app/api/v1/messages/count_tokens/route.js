import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleCountTokens } from "@/sse/handlers/countTokens.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/** Handle CORS preflight */
async function OPTIONSHandler() {
  return new Response(null, { headers: CORS_HEADERS });
}

/** POST /v1/messages/count_tokens — native for Claude-compatible providers, else heuristic estimate. */
async function POSTHandler(request) {
  return await handleCountTokens(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
