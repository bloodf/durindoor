import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleRerank } from "@/sse/handlers/rerank.js";

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/rerank - Cohere/Jina/Voyage-style rerank passthrough. */
async function POSTHandler(request) {
  return await handleRerank(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
