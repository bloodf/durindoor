import { NextResponse } from "next/server";
import { getGatewayKeyById } from "@/lib/localDb";
import { isLocalRequest } from "@/dashboardGuard";

// GET /api/mcp-gateway/keys/[id]/reveal — return the full gateway-key secret.
//
// Mirrors the create route's posture: revealing the raw key is restricted to
// local requests (remote callers must not be able to exfiltrate gateway keys),
// on top of the dashboard guard. The list view masks the key; this is the
// on-demand reveal-and-copy path.
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  try {
    if (!isLocalRequest(request)) {
      return NextResponse.json(
        { error: "Key reveal is only available from local requests." },
        { status: 403 }
      );
    }
    const { id } = await context.params;
    const record = await getGatewayKeyById(id);
    if (!record) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: record.key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
