import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { withEarlyStreamKeepalive } from "open-sse/utils/earlyStreamKeepalive.js";

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
 * POST /v1/responses - OpenAI Responses API format.
 * Explicit `stream: true` requests open an early SSE response even when clients
 * omit the Accept header, keeping slow provider setup alive until data arrives.
 */
async function POSTHandler(request) {
  await ensureInitialized();
  const body = await request.clone().json().catch(() => null);

  // Codex CLI and other Responses API consumers may drop the connection if no
  // bytes arrive within a few seconds. Explicit stream intent is authoritative;
  // Accept remains a compatibility fallback for clients that omit `stream`.
  const accept = String(request.headers.get("accept") || "").toLowerCase();
  if (body?.stream === true || accept.includes("text/event-stream")) {
    return await withEarlyStreamKeepalive(handleChat(request), {
      signal: request.signal,
    });
  }

  return await handleChat(request);
}
export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const POST = withRequestCorrelation(POSTHandler);
