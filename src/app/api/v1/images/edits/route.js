import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleImageEdit } from "@/sse/handlers/imageEdit.js";

export const maxDuration = 300;

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["POST", "OPTIONS"]),
    },
  });
}

/** POST /v1/images/edits - OpenAI-compatible image-edit multipart passthrough. */
async function POSTHandler(request) {
  return await handleImageEdit(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
