import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { isOperatorRequest } from "@/dashboardGuard";
import { scanLanDiscovery } from "@/lib/lanDiscovery";
import { isObject } from "@/shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/lan-discovery
 *
 * Opt-in scan for Ollama (`GET /api/tags`) and OpenAI-compatible
 * (`GET /v1/models`) endpoints on operator-named hosts or one CIDR.
 * Requires `lanDiscoveryEnabled` and an operator session. Never creates
 * connections and never runs in the background.
 *
 * Body: `{ hosts?: string[], cidr?: string, ports?: number[] }`
 * Exactly one of `hosts` or `cidr` is required.
 */
export async function POST(request) {
  try {
    if (!(await isOperatorRequest(request))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settings = await getSettings();
    if (settings.lanDiscoveryEnabled !== true) {
      return NextResponse.json({ error: "lan_discovery_disabled" }, { status: 403 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (body !== null && !isObject(body)) {
      return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
    }

    const result = await scanLanDiscovery(body || {});
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ candidates: result.candidates });
  } catch (error) {
    console.log("LAN discovery failed:", error);
    return NextResponse.json({ error: "LAN discovery failed" }, { status: 500 });
  }
}
