import { NextResponse } from "next/server";
import { canAccessLocalOnlyRoute } from "@/dashboardGuard";
import { sendToChild, findPlugin } from "@/lib/mcp/stdioSseBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * JSON-RPC POST companion for a local stdio MCP plugin SSE session.
 *
 * Same LOCAL_ONLY policy as `/sse`: machine-bound CLI token, or loopback
 * with dashboard auth / open-dashboard login policy. Defense in depth —
 * middleware already gates `/api/mcp/`, but the handler must not forward
 * frames to a spawned child without re-checking.
 */
export async function POST(request, { params }) {
  if (!(await canAccessLocalOnlyRoute(request))) {
    return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
  }

  const { plugin } = await params;
  if (!findPlugin(plugin)) {
    return NextResponse.json({ error: `Unknown plugin: ${plugin}` }, { status: 404 });
  }
  try {
    const body = await request.json();
    sendToChild(plugin, body);
    return new Response(null, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
