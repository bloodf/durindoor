import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { parseJsonBody } from "@/shared/utils/parseJsonBody";
import { MEDIA_ROUTE_KINDS, MEDIA_ROUTE_ENDPOINTS, isMediaRouteKind, normalizeRouteModels, describeMediaRoute } from "@/sse/services/mediaRoutes.js";

export const dynamic = "force-dynamic";

async function routeView(kind, settings) {
  const meta = MEDIA_ROUTE_KINDS.find((k) => k.id === kind);
  const { saved, candidates, models } = await describeMediaRoute(kind, { settings });
  // Endpoints that run only part of the kind (async video jobs, translations)
  // show their own effective list, so a route one endpoint cannot use is visible.
  const endpoints = await Promise.all((MEDIA_ROUTE_ENDPOINTS[kind] || []).map(async ({ path, supports }) => ({
    path,
    effective: (await describeMediaRoute(kind, { settings, supports })).models
  })));
  return {
    ...meta,
    saved,
    candidates: candidates.map((m) => ({ id: m.id, name: m.name || m.id, provider: m.owned_by })),
    effective: models,
    endpoints
  };
}

// GET /api/media-providers/routes - every endpoint's default route
export async function GET() {
  try {
    const settings = await getSettings();
    const routes = await Promise.all(MEDIA_ROUTE_KINDS.map((k) => routeView(k.id, settings)));
    return NextResponse.json({ routes });
  } catch (error) {
    console.log("Error reading media routes:", error?.message);
    return NextResponse.json({ error: "Failed to read media routes" }, { status: 500 });
  }
}

// PUT /api/media-providers/routes - { kind, models: ["provider/model", ...] }; [] resets to automatic
export async function PUT(request) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { kind, models } = parsed.body || {};
  if (!isMediaRouteKind(kind)) {
    return NextResponse.json({ error: "Unknown media route kind" }, { status: 400 });
  }
  const normalized = normalizeRouteModels(models);
  if (!normalized) {
    return NextResponse.json({ error: "models must be a list of provider/model ids" }, { status: 400 });
  }
  try {
    // Merged inside the settings transaction so saves of different kinds never drop each other.
    const settings = await updateSettings((current) => ({
      mediaRoutes: { ...(current.mediaRoutes || {}), [kind]: normalized }
    }));
    return NextResponse.json({ route: await routeView(kind, settings) });
  } catch (error) {
    console.log("Error saving media route:", error?.message);
    return NextResponse.json({ error: "Failed to save media route" }, { status: 500 });
  }
}
