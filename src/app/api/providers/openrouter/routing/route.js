import { isRecord } from "@/shared/utils/typeChecks.js";
import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { canModifySecurityCriticalSettings } from "@/lib/settings/settingsPatchAuth";
import { normalizeOpenRouterRouting } from "open-sse/services/openrouterRouting.js";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request) {
  if (!await canModifySecurityCriticalSettings(request)) return NextResponse.json({ error: "Operator session required" }, { status: 403, headers });
  const settings = await getSettings();
  return NextResponse.json({ routing: settings.openrouterRouting || null }, { headers });
}

export async function PUT(request) {
  if (!await canModifySecurityCriticalSettings(request)) return NextResponse.json({ error: "Operator session required" }, { status: 403, headers });
  let routing;
  try {
    const body = await request.json();
    if (!isRecord(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "routing")) throw new Error("Expected a routing field");
    routing = normalizeOpenRouterRouting(body.routing);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400, headers });
  }
  await updateSettings({ openrouterRouting: routing });
  return NextResponse.json({ routing }, { headers });
}
