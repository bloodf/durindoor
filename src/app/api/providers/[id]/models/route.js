import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";
import { hasValidCliToken, hasValidToken, isLocalRequest } from "@/dashboardGuard";
import { hasExactRequestOrigin } from "@/lib/auth/requestOrigin";
import { getRequestModelDiscoveryOptions } from "@/sse/services/modelAccess";
import { resolveChatgptPlanDispatch } from "@/sse/services/chatgptPlanDispatch";
import { PROVIDERS } from "open-sse/config/providers.js";
import { fetchConnectionModels } from "./fetchConnectionModels.js";

/**
 * GET /api/providers/[id]/models - Get models list from provider
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (connection.provider === "chatgpt-plan") {
      if (process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT !== "1" || !isLocalRequest(request) ||
          !hasExactRequestOrigin(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!await hasValidCliToken(request) && !await hasValidToken(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const { verifiedKey } = await getRequestModelDiscoveryOptions(request);
      const dispatch = await resolveChatgptPlanDispatch({
        planRequest: { verifiedKey }, providerRegistered: Boolean(PROVIDERS["chatgpt-plan"]),
        preferredConnectionId: id, signal: request.signal,
      });
      if (!dispatch) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const models = (await dispatch.listModels()).map((row) => ({ id: row.slug, name: row.display_name || row.slug }));
      return NextResponse.json({ provider: connection.provider, connectionId: id, models }, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await fetchConnectionModels(connection, { requestUrl: request.url, signal: request.signal });
    if (result.error) {
      // A provider that classifies its probe outcome reports it, so a caller
      // can tell an auth rejection from a transient upstream failure.
      return NextResponse.json({
        error: result.error,
        ...(result.classification ? { classification: result.classification } : null)
      }, { status: result.status || 500 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const safeMessage = sanitizeErrorMessage(error?.message || "Internal server error");
    console.error("Error fetching provider models:", safeMessage);
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
