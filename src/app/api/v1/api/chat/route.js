import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";
import { copyClientAdmissionFailure } from "open-sse/services/operationalMetrics.js";


async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["POST", "OPTIONS"]),
    }
  });
}

async function POSTHandler(request) {
  
  const clonedReq = request.clone();
  let modelName = "llama3.2";
  try {
    const body = await clonedReq.json();
    modelName = body.model || "llama3.2";
  } catch {}

  const response = await handleChat(request);
  return copyClientAdmissionFailure(response, transformToOllama(response, modelName));
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withHttpRequestCorrelation(POSTHandler);
