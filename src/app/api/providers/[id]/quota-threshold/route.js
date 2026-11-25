import { isNumber, isString } from "@/shared/utils/typeChecks.js";
import { NextResponse } from "next/server";
import { isOperatorRequest } from "@/dashboardGuard";
import { getProviderConnectionById, listProviderQuotaSnapshots, updateSettings } from "@/lib/localDb";

// Percentages are stored as connection/window routing floors, shared by routing and reservations.
export async function PUT(request, { params }) {
  if (!(await isOperatorRequest(request))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || !isString(body.dimensionKey) || !(body.percent === null || isNumber(body.percent) && Number.isFinite(body.percent) && body.percent > 0 && body.percent <= 100)) {
    return NextResponse.json({ error: "Invalid threshold" }, { status: 400 });
  }
  const connection = await getProviderConnectionById(id);
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  const snapshots = await listProviderQuotaSnapshots({ connectionId: id, includeStale: true });
  if (!snapshots.some((snapshot) => snapshot.identity.dimensionKey === body.dimensionKey)) {
    return NextResponse.json({ error: "Unknown quota window" }, { status: 400 });
  }
  await updateSettings((current) => {
    const config = current.quotaSelection || {};
    const connections = config.connections || {};
    const existing = connections[id] || {};
    const dimensions = { ...existing.dimensions };
    const previous = dimensions[body.dimensionKey] || {};
    if (body.percent === null) {
      const { routingFloorEnabled, routingFloorRatio, ...rest } = previous;
      if (Object.keys(rest).length) dimensions[body.dimensionKey] = rest;
      else delete dimensions[body.dimensionKey];
    } else {
      dimensions[body.dimensionKey] = { ...previous, routingFloorEnabled: true, routingFloorRatio: body.percent / 100 };
    }
    return { quotaSelection: { ...config, connections: { ...connections, [id]: { ...existing, dimensions } } } };
  });
  return NextResponse.json({ ok: true });
}
