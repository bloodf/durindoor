import { getProviderConnectionById } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { isNonAdminApiKeyCaller } from "@/dashboardGuard";

/** Rotate a Codex credential through the shared serialized refresh path. */
export async function POST(request, { params }) {
  if (await isNonAdminApiKeyCaller(request)) return Response.json({ error: "Admin access required" }, { status: 403 });
  const { id } = await params;
  const connection = await getProviderConnectionById(id);
  if (!connection) return Response.json({ error: "Connection not found" }, { status: 404 });
  if (connection.provider !== "codex" || connection.authType !== "oauth" || !connection.refreshToken) {
    return Response.json({ error: "A Codex OAuth connection with a refresh token is required" }, { status: 400 });
  }
  try {
    const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const result = await refreshAndUpdateCredentials(connection, true, proxy);
    if (!result.refreshed) return Response.json({ error: "Credential refresh failed" }, { status: 502 });
    return Response.json({ ok: true, expiresAt: result.connection.expiresAt });
  } catch {
    return Response.json({ error: "Credential refresh failed" }, { status: 502 });
  }
}
