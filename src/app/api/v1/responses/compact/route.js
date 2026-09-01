import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/responses/compact - Compact conversation context
 * The original Request is preserved. The chat pipeline derives compact routing
 * from the endpoint instead of injecting an internal field into client JSON.
 */
async function POSTHandler(request) {
  await ensureInitialized();
  return await handleChat(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
