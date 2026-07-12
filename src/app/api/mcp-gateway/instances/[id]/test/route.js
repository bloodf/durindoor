import { NextResponse } from "next/server";
import { getInstanceById } from "@/lib/localDb";
import { clientFor } from "@/lib/mcp/gateway/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mcp-gateway/instances/[id]/test
 *
 * Probe a registered upstream MCP instance by listing its tools. Failure
 * responses use the `{ error: string, ok: false }` shape (same convention as
 * `src/app/api/settings/route.js:60`) so the dashboard can render the error.
 *
 * Status codes:
 * - 200 success → `{ ok: true, toolCount, sample }` (existing shape preserved)
 * - 400 invalid transport config (unknown `transport` value)
 * - 404 unknown instance id
 * - 502 upstream connect/init failure
 */
export async function POST(_request, context) {
  const { id } = await context.params;
  const inst = await getInstanceById(id);
  if (!inst) {
    return NextResponse.json({ error: "instance not found", ok: false }, { status: 404 });
  }
  let mcpClient;
  try {
    mcpClient = clientFor(inst);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message, ok: false }, { status: 400 });
  }
  try {
    const tools = await mcpClient.listTools(inst);
    return NextResponse.json({
      ok: true,
      toolCount: tools.length,
      sample: tools.slice(0, 5).map((t) => ({ name: t.name, description: t.description || "" })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message, ok: false }, { status: 502 });
  }
}
