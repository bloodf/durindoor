import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { requireJsonContentType } from "open-sse/translator/validate.js";
import { SSE_KEEPALIVE_MS } from "open-sse/config/runtimeConfig.js";
import { ANTHROPIC_PING_FRAME, withEarlyStreamKeepalive } from "open-sse/utils/earlyStreamKeepalive.js";

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

/**
 * POST /v1/messages - Claude format (auto convert via handleChat).
 * Streaming requests emit Anthropic ping events while provider setup is silent.
 */
export async function POST(request) {
  // #6414: reject non-JSON Content-Type with 415 before touching the body.
  const ctRejection = requireJsonContentType(request);
  if (ctRejection) return ctRejection;

  await ensureInitialized();
  const body = await request.clone().json().catch(() => null);
  const handlerPromise = handleChat(request);
  if (body?.stream !== true) return await handlerPromise;

  return await withEarlyStreamKeepalive(handlerPromise, {
    signal: request.signal,
    intervalMs: SSE_KEEPALIVE_MS,
    keepaliveFrame: ANTHROPIC_PING_FRAME
  });
}

