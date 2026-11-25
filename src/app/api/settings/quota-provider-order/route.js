import { isString } from "@/shared/utils/typeChecks.js";
import { NextResponse } from "next/server";
import { isOperatorRequest } from "@/dashboardGuard";
import { getProviderConnections, updateSettings } from "@/lib/localDb";
import { isUsageEligible } from "@/app/api/providers/client/route";
import { moveQuotaProvider, quotaProviderOrder } from "@/shared/utils/quotaProviderOrder";

// Moves are merged inside the settings transaction, including concurrent moves.
export async function PATCH(request) {
  if (!(await isOperatorRequest(request))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || !isString(body.provider) || !isString(body.target) || body.provider.length > 128 || body.target.length > 128) {
    return NextResponse.json({ error: "Invalid provider move" }, { status: 400 });
  }
  try {
    const connections = (await getProviderConnections()).filter(isUsageEligible).sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) || a.provider.localeCompare(b.provider));
    const known = new Set(connections.map((connection) => connection.provider));
    if (!known.has(body.provider) || !known.has(body.target)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    const settings = await updateSettings((current) => ({
      quotaProviderOrder: moveQuotaProvider(quotaProviderOrder(connections, current.quotaProviderOrder), body.provider, body.target)
    }));
    return NextResponse.json({ order: settings.quotaProviderOrder });
  } catch {
    return NextResponse.json({ error: "Failed to save provider order" }, { status: 500 });
  }
}
