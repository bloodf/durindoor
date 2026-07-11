import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { requireJsonContentType } from "open-sse/translator/validate.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {
  // #6414: reject non-JSON Content-Type with 415 before touching the body.
  const ctRejection = requireJsonContentType(request);
  if (ctRejection) return ctRejection;

  // Fallback to local handling
  await ensureInitialized();

  return await handleChat(request);
}

