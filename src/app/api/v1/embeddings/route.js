import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleEmbeddings } from "@/sse/handlers/embeddings.js";

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
 * POST /v1/embeddings - OpenAI-compatible embeddings endpoint
 */
async function POSTHandler(request) {
  return await handleEmbeddings(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
