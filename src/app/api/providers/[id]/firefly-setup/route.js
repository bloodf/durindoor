import { NextResponse } from "next/server";
import { isOperatorRequest } from "@/dashboardGuard";
import { getProviderConnectionById } from "@/lib/localDb";
import { DATA_DIR } from "@/lib/dataDir.js";
import { openFireflyWebUiSetup, fireflySetupStatus, closeConnectionFireflySetup } from "open-sse/services/fireflyWebUi/setup.js";

export const dynamic = "force-dynamic";

async function setupRequest(request, { params }, action) {
  // Route-level defense: management/gateway API-key access never grants host browser control.
  if (!(await isOperatorRequest(request))) return NextResponse.json({ error: "Dashboard operator required" }, { status: 403 });
  const { id } = await params;
  const connection = await getProviderConnectionById(id);
  if (!connection || connection.provider !== "adobe-firefly-web") return NextResponse.json({ error: "Firefly browser connection not found" }, { status: 404 });
  try {
    if (action === "status") return NextResponse.json(fireflySetupStatus(id));
    if (action === "close") return NextResponse.json({ closed: closeConnectionFireflySetup(id), ...fireflySetupStatus(id) });
    // No client body or client setup id is used: ownership is the stored connection.
    const opened = await openFireflyWebUiSetup({ credentials: { ...connection, connectionId: id }, operator: { authenticated: true }, deps: { dataDir: DATA_DIR } });
    return NextResponse.json({ ...opened, outcome: "needs_operator", note: "Browser opens on the DurinDoor host and requires a display. Sign in manually; live state is unknown." });
  } catch (error) {
    return NextResponse.json({ error: error?.outcome ? error.message : "Firefly setup failed", outcome: error?.outcome || "unknown" }, { status: error?.status || 502 });
  }
}

export const GET = (request, context) => setupRequest(request, context, "status");
export const POST = (request, context) => setupRequest(request, context, "start");
export const DELETE = (request, context) => setupRequest(request, context, "close");
