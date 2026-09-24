// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/localDb";
import { consumeClaudeResetGrant } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { sanitizeErrorMessage } from "open-sse/utils/error.js";

// Spend one free Claude Code "limit reset" grant (irreversible). The
// dashboard only calls this from an explicit, confirmed user action.
export async function POST(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    const { grantId } = await request.json().catch(() => ({}));

    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }
    if (connection.provider !== "claude" || connection.authType !== "oauth") {
      return Response.json({ error: "Limit reset is only available for Claude OAuth connections." }, { status: 400 });
    }
    if (!grantId) {
      return Response.json({ error: "A grant id is required to reset a Claude limit." }, { status: 400 });
    }

    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: proxyConfig.strictProxy === true,
      disableEnvProxy: proxyConfig.disableEnvProxy === true
    };

    ({ connection } = await refreshAndUpdateCredentials(connection, false, proxyOptions));
    const result = await consumeClaudeResetGrant(connection.accessToken, grantId, proxyOptions);

    if (result.ok) return Response.json(result);
    const status = result.status >= 400 && result.status < 500 ? result.status : 409;
    return Response.json({
      ...result,
      message: result.message || `Reset not applied: ${result.reason || result.result || "unknown"}`
    }, { status });
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    const safeMessage = sanitizeErrorMessage(error?.message || error);
    console.warn(`[Claude Reset] ${provider}: ${safeMessage}`);
    return Response.json({ error: safeMessage }, { status: 500 });
  }
}
