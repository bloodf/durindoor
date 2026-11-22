import { NextResponse } from "next/server";
import { resolveClientApiKey } from "@/sse/services/auth.js";
import {
  getApiKeyById,
  getApiKeyProviderConnectionIds,
  getApiKeyUsageLimitStatus,
  getApiKeyUsageTotals,
  getProviderConnections,
  listProviderQuotaSnapshots
} from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage/me — self-service usage for the calling API key.
 *
 * Sits under the `/api/usage` management-auth prefix (dashboardGuard.js), so a
 * dashboard JWT, the CLI token, or a valid application API key all pass the
 * outer gate. This handler then re-resolves the credential itself and scopes
 * the response to exactly that key: it never returns another key's totals,
 * the key secret, or provider-connection credentials. A caller with no
 * resolvable key identity (CLI token, open loopback dashboard with no key
 * header) gets 401 rather than an operator-wide view.
 *
 * `?format=json` is accepted for forward compatibility; any other explicit
 * value is rejected. JSON is the only representation served today.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");
  if (format !== null && format !== "json") {
    return NextResponse.json({ error: "Unsupported format. Use format=json." }, { status: 400 });
  }

  const { apiKey, auth } = await resolveClientApiKey(request, { required: true });
  if (!auth.ok || !auth.stored || !auth.apiKeyId) {
    return NextResponse.json({ error: "A valid application API key is required." }, { status: 401 });
  }

  const record = await getApiKeyById(auth.apiKeyId);
  if (!record) {
    return NextResponse.json({ error: "A valid application API key is required." }, { status: 401 });
  }

  const [totals, limitStatus, scopedConnectionIds] = await Promise.all([
    getApiKeyUsageTotals(record.id),
    getApiKeyUsageLimitStatus(apiKey),
    getApiKeyProviderConnectionIds(record.id)
  ]);

  // An unrestricted inference key has no owner-specific provider connection
  // scope, so it must not receive the operator-wide connection inventory.
  const visibleConnections = scopedConnectionIds.length === 0
    ? []
    : (await getProviderConnections({ isActive: true }))
      .filter((connection) => scopedConnectionIds.includes(connection.id));

  const connections = await Promise.all(
    visibleConnections.map(async (connection) => ({
      id: connection.id,
      provider: connection.provider,
      name: connection.name || null,
      quota: await listProviderQuotaSnapshots({ connectionId: connection.id })
    }))
  );

  return NextResponse.json({
    id: record.id,
    name: record.name,
    isActive: record.isActive,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    dailyLimitTokens: record.dailyLimitTokens,
    policy: record.policy,
    usage: {
      lifetime: totals,
      daily: limitStatus
    },
    connections
  });
}
