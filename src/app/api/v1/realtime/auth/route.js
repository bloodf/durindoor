import { extractApiKey, evaluateApiKeyAuth } from "@/sse/services/auth.js";
import { getSettings } from "@/lib/localDb";

/**
 * Auth bridge for the `/v1/realtime` WebSocket endpoint.
 *
 * The realtime socket is owned by `custom-server.js` running under plain Node,
 * where the `@/` and `open-sse/` import aliases do not resolve — so it cannot
 * import `src/sse/services/auth.js` directly. This tiny Next-owned route reuses
 * the EXACT auth primitives the HTTP chat path uses and answers a loopback
 * probe from the server wrapper:
 *
 *   - 200 { ok: true }            → key admitted (or not required)
 *   - 401 { error: { message } }  → missing (when required) / invalid / expired
 *
 * `/v1/models` is NOT used as the probe because it does not consult
 * `requireApiKey` or validate the key at all.
 */
export async function GET(request) {
  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  const auth = await evaluateApiKeyAuth(apiKey, { required: settings.requireApiKey === true, request });
  if (auth.ok) {
    return Response.json({ ok: true }, { headers: { "Access-Control-Allow-Origin": "*" } });
  }
  const message = auth.reason === "missing" ? "Missing API key" : "Invalid API key";
  return Response.json(
    { ok: false, error: { message, type: "invalid_request_error", code: "invalid_api_key" } },
    { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
