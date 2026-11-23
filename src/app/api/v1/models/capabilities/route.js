import { corsHeaders } from "@/lib/http/cors.js";
import { CAPABILITY_ENDPOINTS, getCapabilityCatalog } from "@/sse/services/autoModel.js";

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders(["GET", "OPTIONS"]) });
}

/** GET /v1/models/capabilities lists discoverable models under the caller's access policy. */
export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind");
    const kinds = kind ? (CAPABILITY_ENDPOINTS[kind] ? [kind] : []) : Object.keys(CAPABILITY_ENDPOINTS);
    let models = await getCapabilityCatalog(request, kinds);
    if (params.get("available") === "true") models = models.filter((m) => m.availability.status === "available");
    const groupedByKind = Object.fromEntries(Object.keys(CAPABILITY_ENDPOINTS).map((k) => [k, models.filter((m) => m.kind === k)]));
    const summary = Object.fromEntries(Object.entries(groupedByKind).map(([k, rows]) => [k, { count: rows.length, availableCount: rows.filter((m) => m.availability.status === "available").length, endpoint: CAPABILITY_ENDPOINTS[k] }]));
    return Response.json({ object: "capability_catalog", summary, data: models, groupedByKind }, { headers: corsHeaders(["GET", "OPTIONS"]) });
  } catch {
    return Response.json({ error: { message: "Unable to fetch model capabilities", type: "server_error" } }, { status: 500, headers: corsHeaders(["GET", "OPTIONS"]) });
  }
}
